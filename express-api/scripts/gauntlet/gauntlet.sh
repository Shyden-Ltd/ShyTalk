#!/usr/bin/env bash
# gauntlet.sh — ONE command from cold boot to a running ShyTalk gauntlet.
#
# Assumes NOTHING is running (machine just switched on): starts Docker
# Desktop, sweeps stale ports, brings up the full local stack, reseeds +
# verifies data, preps devices, optionally runs the non-device framework
# suites, then dispatches the detached journey matrix.
#
# Usage: gauntlet.sh [options]
#   --detach        run under nohup + caffeinate and return immediately
#                   (log + DONE/FAIL sentinel in /tmp/shytalk-gauntlet/<runId>/)
#   --fresh         full teardown (90-stop.sh) before bring-up
#   --frameworks    also run non-device suites in gauntlet order:
#                   gradle unit+detekt → ktlint → express jest → eslint →
#                   RESEED → playwright e2e → playwright integration → RESEED
#   --android-bdd   also run the instrumented BDD suite (~235 scenarios; long)
#   --ios           prep iPhone + Appium so real-iOS matrix cells can run
#   --install-apk   (re)build + install the local APK on the Android device
#   --reset-app     pm clear the app (signed-out state) during Android prep
#   --no-matrix     stop after prep/frameworks; don't dispatch the matrix
#   --target <t>    matrix target: local (default) | dev
#
# The journey matrix itself runs DETACHED via 50-matrix.sh (zero terminal
# attachment) — this script's DONE sentinel means "prep + dispatch
# succeeded"; matrix progress is checked with:
#   bash express-api/scripts/gauntlet/50-matrix.sh status
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib.sh"

DETACH=0 FRESH=0 FRAMEWORKS=0 ANDROID_BDD=0 IOS=0 INSTALL_APK=0 RESET_APP=0 MATRIX=1
TARGET="local"
PASSTHRU=()
while [ $# -gt 0 ]; do
  case "$1" in
    --detach) DETACH=1 ;;
    --fresh) FRESH=1; PASSTHRU+=("$1") ;;
    --frameworks) FRAMEWORKS=1; PASSTHRU+=("$1") ;;
    --android-bdd) ANDROID_BDD=1; PASSTHRU+=("$1") ;;
    --ios) IOS=1; PASSTHRU+=("$1") ;;
    --install-apk) INSTALL_APK=1; PASSTHRU+=("$1") ;;
    --reset-app) RESET_APP=1; PASSTHRU+=("$1") ;;
    --no-matrix) MATRIX=0; PASSTHRU+=("$1") ;;
    --target) shift; TARGET="${1:?--target needs a value}"; PASSTHRU+=(--target "$TARGET") ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1 (see --help)" ;;
  esac
  shift
done
case "$TARGET" in local|dev) ;; *) die "--target must be local or dev" ;; esac

RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$GAUNTLET_TMP/$RUN_ID"
mkdir -p "$RUN_DIR"

# --- detach mode: re-exec self under nohup + caffeinate ---------------------
if [ "$DETACH" = "1" ]; then
  log "detaching: log → $RUN_DIR/gauntlet.log"
  ( nohup caffeinate -i "$0" "${PASSTHRU[@]}" >"$RUN_DIR/gauntlet.log" 2>&1 </dev/null &
    echo $! >"$RUN_DIR/pid" )
  ln -sfn "$RUN_DIR" "$GAUNTLET_TMP/latest"
  echo "detached. check: tail -20 $RUN_DIR/gauntlet.log ; sentinel: $RUN_DIR/{DONE,FAIL}"
  exit 0
fi

# Attached run: keep the Mac awake for as long as this script lives (a
# lid-sleep mid-run kills the :8888 server → mass CONNECTION_REFUSED).
caffeinate -i -w $$ &
ln -sfn "$RUN_DIR" "$GAUNTLET_TMP/latest"

on_fail() {
  touch "$RUN_DIR/FAIL"
  printf '\033[1;31mGAUNTLET FAILED at phase: %s — log dir: %s\033[0m\n' "${PHASE:-startup}" "$RUN_DIR" >&2
}
trap on_fail ERR
set -e

phase() { PHASE="$1"; log "━━━ PHASE: $1 ━━━"; }

run_logged() { # <name> <cmd...> — stream + capture, fail loud with log path
  local name="$1"; shift
  local logf="$RUN_DIR/$name.log"
  log "▶ $name  (log: $logf)"
  if ( "$@" ) 2>&1 | tee "$logf"; then
    ok "$name passed"
  else
    die "$name FAILED — full output: $logf"
  fi
}

# --- 1. prerequisites --------------------------------------------------------
phase "prereqs"
bash "$HERE/00-prereqs.sh"

# --- 2. services ---------------------------------------------------------------
phase "services"
if [ "$FRESH" = "1" ]; then bash "$HERE/10-services.sh" --fresh; else bash "$HERE/10-services.sh"; fi

# --- 3. seed -------------------------------------------------------------------
phase "reseed"
bash "$HERE/20-reseed.sh"

# --- 4. Android prep (best-effort: web cells still run without a device) -------
phase "android-prep"
ANDROID_ARGS=()
[ "$INSTALL_APK" = "1" ] && ANDROID_ARGS+=(--install)
[ "$RESET_APP" = "1" ] && ANDROID_ARGS+=(--reset)
if bash "$HERE/30-android.sh" "${ANDROID_ARGS[@]}"; then
  ANDROID_OK=1
else
  ANDROID_OK=0
  warn "Android prep failed — continuing (web cells unaffected); device cells will skip/fail"
fi

# --- 5. iOS prep (opt-in) --------------------------------------------------------
if [ "$IOS" = "1" ]; then
  phase "ios-prep"
  bash "$HERE/40-ios.sh" || warn "iOS prep failed — continuing; iOS cells will skip/fail"
fi

# --- 6. framework suites (opt-in, gauntlet order) ---------------------------------
if [ "$FRAMEWORKS" = "1" ]; then
  phase "frameworks"
  run_logged gradle-unit-detekt bash -c "cd '$REPO' && ./gradlew testDevDebugUnitTest :shared:jvmTest detekt --console=plain"
  (cd "$REPO" && ./gradlew --stop >/dev/null 2>&1) || true
  run_logged ktlint bash -c "cd '$REPO' && ktlint --relative"
  run_logged express-jest bash -c "cd '$REPO/express-api' && npm test"
  run_logged eslint bash -c "cd '$REPO/express-api' && npm run lint"
  # Jest wipes emulator users/Auth — reseed BEFORE any web suite (hard rule).
  phase "reseed-post-jest"
  bash "$HERE/20-reseed.sh"
  run_logged playwright-e2e bash -c "cd '$REPO' && npx playwright test"
  run_logged playwright-integration bash -c "cd '$REPO' && npx playwright test --config=playwright.integration.config.ts"
  phase "reseed-post-web"
  bash "$HERE/20-reseed.sh"
fi

# --- 7. instrumented Android BDD (opt-in, needs device, long) ----------------------
if [ "$ANDROID_BDD" = "1" ]; then
  phase "android-bdd"
  [ "${ANDROID_OK:-0}" = "1" ] || die "--android-bdd requested but Android prep failed"
  run_logged connected-bdd bash -c "cd '$REPO' && ./gradlew connectedDevDebugAndroidTest --console=plain"
  (cd "$REPO" && ./gradlew --stop >/dev/null 2>&1) || true
fi

# --- 8. journey matrix (detached) ---------------------------------------------------
if [ "$MATRIX" = "1" ]; then
  phase "matrix-dispatch"
  MATRIX_ARGS=("$TARGET")
  [ "$IOS" = "0" ] && MATRIX_ARGS+=(--skip-ios-check)
  bash "$HERE/50-matrix.sh" launch "${MATRIX_ARGS[@]}" 2>&1 | tee "$RUN_DIR/matrix-dispatch.log"
  ok "matrix dispatched (detached)"
  echo
  echo "  matrix progress : bash $HERE/50-matrix.sh status"
  echo "  matrix results  : bash $HERE/50-matrix.sh results"
  echo "  stop the matrix : bash $HERE/50-matrix.sh stop"
fi

touch "$RUN_DIR/DONE"
trap - ERR
phase "done"
log "gauntlet prep+dispatch complete — artifacts in $RUN_DIR"
