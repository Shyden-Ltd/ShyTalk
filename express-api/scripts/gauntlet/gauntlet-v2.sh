#!/usr/bin/env bash
# gauntlet-v2.sh — overlapped, visible release gauntlet (EPIC-0009 / SHY-0238).
#
# v1 (gauntlet.sh) runs the Mac framework suites to completion BEFORE the device
# journey matrix — so the phones sit idle while the Mac grinds, and a detached
# run only writes to a file. v2 fixes both, without the per-lane data-isolation
# rewrite (operator's "Pragmatic v2" decision):
#
#   1. Dispatch the device matrix FIRST (it reseeds + preps devices + runs
#      detached, writing its own DONE/FAIL sentinel), so the phones start
#      immediately.
#   2. Overlap ONLY the state-independent suites (gradle unit+detekt, ktlint,
#      eslint — zero emulator contact) concurrently with the live matrix.
#   3. Keep the stack-coupled suites (express jest [wipes Auth], playwright
#      e2e + integration) OUT of the live-matrix window — they run AFTER the
#      matrix finishes, so their stack mutations never corrupt the journeys.
#   4. Stream everything live to the console (source-prefixed) AND to the file.
#
# Usage: gauntlet-v2.sh [options]
#   --frameworks    also run the framework suites (overlap-safe ones during the
#                   matrix; stack-coupled ones after it)
#   --android-bdd   also run the instrumented BDD suite after the matrix (long)
#   --ios           prep iPhone so real-iOS matrix cells run (else --skip-ios-check)
#   --install-apk   (re)build + install the local APK during matrix device prep
#   --reset-app     pm clear the app (signed-out) during device prep
#   --fresh         full teardown before bring-up
#   --no-matrix     don't dispatch the matrix (frameworks only)
#   --no-pin-gate   skip the PIN-ready start gate (devices already prepared)
#   --target <t>    matrix target: local (default) | dev
#   --status [dir]  print the current run state (complete/failed/pin-wait/
#                   running/died) for the latest run (or <dir>) and exit
#
# Before dispatch a PIN-ready gate pauses + pings (console + phone) until the
# operator confirms the devices are unlocked + secure-lock-disabled (SHY-0239);
# the run then self-notifies (console + phone) on the first failure, on
# completion, and on any abort. The phone leg is assistant-mediated: the script
# emits events, the orchestrating assistant bridges them to PushNotification.
# The pre-flight smoke + cross-platform coverage arrive in SHY-0240.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

# ── shared, unit-testable helpers ──────────────────────────────────────────
# Echo a pid + ALL its descendants, deepest-first (bash-3.2-safe recursion).
# Mirrors 50-matrix.sh's _pid_tree (kept local so SHY-0236's file + its pin stay
# untouched — the two are intentionally independent copies of a tiny idiom).
_pid_tree() {
  local p="$1" c
  [ -n "$p" ] || return 0
  for c in $(pgrep -P "$p" 2>/dev/null); do _pid_tree "$c"; done
  printf '%s\n' "$p"
}

# ONLY suites that never touch the emulator stack may be started here — they
# run CONCURRENTLY with the live device matrix. Each streams its output
# source-prefixed to the console AND its own log file (line-flushed via awk so
# the console stays live). The suite's real exit code (not tee/awk's) is
# preserved for wait_overlapped via PIPESTATUS.
OVERLAP_PIDS=()
OVERLAP_NAMES=()
start_overlapped() { # <name> <cmd...>
  local name="$1"; shift
  local logf="$RUN_DIR/$name.log"
  log "▷ overlap: $name  (log: $logf)"
  ( "$@" 2>&1 | awk -v p="[$name] " '{ print p $0; fflush() }' | tee "$logf"
    exit "${PIPESTATUS[0]}" ) &
  OVERLAP_PIDS+=("$!")
  OVERLAP_NAMES+=("$name")
}

# Wait for every overlapped suite; record failures (never fatal — the tally at
# the end owns the pass/fail). Cleared after so reap_overlapped is a no-op.
wait_overlapped() {
  local i
  # bash-3.2 + set -u: expanding ${!arr[@]} on a declared-but-empty array aborts
  # ("unbound variable"). Guard the empty case (nothing to wait for).
  [ "${#OVERLAP_PIDS[@]}" -gt 0 ] || return 0
  for i in "${!OVERLAP_PIDS[@]}"; do
    if wait "${OVERLAP_PIDS[$i]}"; then
      ok "${OVERLAP_NAMES[$i]} passed"
    else
      warn "${OVERLAP_NAMES[$i]} FAILED — $RUN_DIR/${OVERLAP_NAMES[$i]}.log"
      FAILED_STEPS+=("${OVERLAP_NAMES[$i]}")
      notify_first_fail "${OVERLAP_NAMES[$i]}"
    fi
  done
  OVERLAP_PIDS=()
  OVERLAP_NAMES=()
}

# Kill any still-running overlapped suite tree + the matrix tail on exit/interrupt
# (never the detached matrix itself — it survives + carries its own sentinel).
reap_overlapped() {
  local pid p
  for pid in ${OVERLAP_PIDS[@]+"${OVERLAP_PIDS[@]}"}; do
    for p in $(_pid_tree "$pid"); do kill -TERM "$p" 2>/dev/null || true; done
  done
  # TAIL_PID is the `( tail -F | awk ) &` subshell — kill its TREE, not just the
  # subshell, or the orphaned `tail -F` runs forever.
  if [ -n "${TAIL_PID:-}" ]; then
    for p in $(_pid_tree "$TAIL_PID"); do kill -TERM "$p" 2>/dev/null || true; done
    TAIL_PID=""
  fi
}

# A bare INT/TERM trap that only cleans up would RESUME the script after the
# handler returns (standard bash semantics) — so Ctrl-C during the overlap phase
# would kill the suites yet march on into the hours-long matrix-wait. Reap, then
# actually terminate with the conventional 128+signal code.
on_signal() { # <exit-code>
  emit_event aborted "interrupted (signal ${1:-})"
  reap_overlapped
  trap - EXIT INT TERM
  exit "${1:-143}"
}

# Serial suite runner (prep + the post-matrix stack-coupled suites): stream +
# capture, record failure, keep going (SHY-0236 best-effort contract).
run_logged() { # <name> <cmd...>
  local name="$1"; shift
  local logf="$RUN_DIR/$name.log"
  log "▶ $name  (log: $logf)"
  if ( "$@" ) 2>&1 | awk -v p="[$name] " '{ print p $0; fflush() }' | tee "$logf"; then
    ok "$name passed"
  else
    warn "$name FAILED — $logf"
    FAILED_STEPS+=("$name")
    notify_first_fail "$name"
  fi
}

# ── SHY-0239: phase banner + self-notify + PIN-ready gate + status reader ────
# phase() lives here (above the lib-mode return) so pin_ready_gate can set the
# run phase when the behavioural tests drive it in lib mode.
phase() { PHASE="$1"; log "━━━ PHASE: $1 ━━━"; }

# Append-only, timestamped, tab-separated event trail under RUN_DIR. Pure append
# (guarded) so it is safe to call from the ERR/signal traps without re-entering.
emit_event() { # <event> <detail>
  { printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$1" "${PHASE:-}" "${2:-}" \
      >> "$RUN_DIR/events.log"; } 2>/dev/null || true
}

# Loud, colour-distinct console line (+ terminal bell) AND an event — the self-
# notify. The console half is pure bash; the phone half is the orchestrating
# assistant bridging events.log to PushNotification (operator's channel choice).
notify() { # <event> <detail>
  emit_event "$1" "${2:-}"
  printf '\033[1;35m[notify] %s\033[0m %s\a\n' "$1" "${2:-}"
}

# Fail-fast: the FIRST recorded step failure pings once (phone-worthy); later
# failures stay console WARNs only — no per-failure notification spam.
NOTIFIED_FIRST_FAIL=0
notify_first_fail() { # <failed-step-name>
  [ "$NOTIFIED_FIRST_FAIL" = "1" ] && return 0
  NOTIFIED_FIRST_FAIL=1
  notify suite-fail "first failure: $1 (run continues best-effort; see final tally)"
}

# PIN-ready START gate: pause + ping + await explicit confirm BEFORE any device
# is touched. The real PIN fix is up-front prep (secure lock disabled, iPhone
# unlocked + trusted), so this is the checkpoint — not a mid-run pause (the
# detached runner is unattended by design). Bounded by PIN_GATE_TIMEOUT: a gate
# that never returns is worse than a FAIL (the SHY-0238 matrix-wait liveness).
#   TTY     → interactive `read -t` (operator presses Enter).
#   non-TTY → wait for a PIN_READY token file (operator/assistant touches it).
pin_ready_gate() {
  [ "${PIN_GATE:-1}" = "1" ] || return 0
  [ "${MATRIX:-1}" = "1" ] || return 0
  phase "pin-ready-gate"
  local reason="Unlock BOTH devices, DISABLE the Android secure lock, unlock + trust the iPhone, then confirm."
  printf '%s\n' "$reason" > "$RUN_DIR/PIN_WAIT"
  notify pin-wait "$reason"
  local timeout="${PIN_GATE_TIMEOUT:-1800}"
  # Fail-safe the bound: a non-integer timeout makes `read -t` / the numeric
  # compare error every iteration and the gate would hang FOREVER — the very
  # thing the bound exists to prevent. Clamp bad input to the default, loudly.
  case "$timeout" in ''|*[!0-9]*) warn "PIN_GATE_TIMEOUT='$timeout' is not a non-negative integer — using 1800"; timeout=1800 ;; esac
  if [ -t 0 ]; then
    if read -t "$timeout" -r -p "▶ Press Enter when the devices are PIN-ready (Ctrl-C to abort)… " _; then
      touch "$RUN_DIR/PIN_READY"
    else
      # not confirmed: fail the run. Write FAIL explicitly (belt) so the sentinel
      # is guaranteed even in lib mode (no ERR trap); the bare call ALSO fires
      # ERR→on_fail (suspenders). Matches gauntlet.sh's proven mid-run idiom.
      rm -f "$RUN_DIR/PIN_WAIT"
      notify aborted "PIN-ready gate timed out after ${timeout}s with no confirm"
      touch "$RUN_DIR/FAIL"; return 1
    fi
  else
    local waited=0
    while [ ! -e "$RUN_DIR/PIN_READY" ]; do
      if [ "$waited" -ge "$timeout" ]; then
        rm -f "$RUN_DIR/PIN_WAIT"
        notify aborted "PIN-ready gate timed out after ${timeout}s with no confirm"
        touch "$RUN_DIR/FAIL"; return 1
      fi
      sleep 1
      waited=$((waited + 1))
    done
  fi
  rm -f "$RUN_DIR/PIN_WAIT"
  notify pin-ready "devices confirmed PIN-ready — dispatching"
}

# Single-shot run-state reader for the assistant's per-checkpoint wake (no loop,
# no polling). Precedence: DONE > FAIL > PIN_WAIT > live-pid running > died.
cmd_status() { # [run_dir]
  local dir="${1:-}"
  [ -n "$dir" ] || dir="$(readlink "$GAUNTLET_TMP/latest-v2" 2>/dev/null || true)"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "unknown"; return 0; fi
  if [ -e "$dir/DONE" ]; then echo "complete"; return 0; fi
  if [ -e "$dir/FAIL" ]; then echo "failed"; return 0; fi
  if [ -e "$dir/PIN_WAIT" ]; then printf 'pin-wait\t%s\n' "$(cat "$dir/PIN_WAIT" 2>/dev/null | head -1)"; return 0; fi
  local pid; pid="$(cat "$dir/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "running"; else echo "died"; fi
}

# Library mode: sourced by the behavioural tests to exercise the helpers above
# without running the orchestration. MUST stay after the helper defs + before
# any orchestration side effect.
[ -n "${GAUNTLET_V2_LIB:-}" ] && return 0 2>/dev/null

# --status [dir]: single-shot state read for the assistant's per-checkpoint wake
# (resolve + print + exit before any orchestration side effect).
[ "${1:-}" = "--status" ] && { cmd_status "${2:-}"; exit 0; }

# ── flags ──────────────────────────────────────────────────────────────────
FRAMEWORKS=0 ANDROID_BDD=0 IOS=0 INSTALL_APK=0 RESET_APP=0 FRESH=0 MATRIX=1
PIN_GATE=1 TARGET="local"
while [ $# -gt 0 ]; do
  case "$1" in
    --frameworks) FRAMEWORKS=1 ;;
    --android-bdd) ANDROID_BDD=1 ;;
    --ios) IOS=1 ;;
    --install-apk) INSTALL_APK=1 ;;
    --reset-app) RESET_APP=1 ;;
    --fresh) FRESH=1 ;;
    --no-matrix) MATRIX=0 ;;
    --no-pin-gate) PIN_GATE=0 ;;
    --target) shift; TARGET="${1:?--target needs a value}" ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1 (see --help)" ;;
  esac
  shift
done
case "$TARGET" in local|dev) ;; *) die "--target must be local or dev" ;; esac

RUN_ID="$(date +%Y%m%d-%H%M%S)-v2"
RUN_DIR="$GAUNTLET_TMP/$RUN_ID"
mkdir -p "$RUN_DIR"
echo $$ > "$RUN_DIR/pid"   # the orchestrator's own pid — cmd_status liveness check
ln -sfn "$RUN_DIR" "$GAUNTLET_TMP/latest-v2"
caffeinate -i -w $$ &   # keep the Mac awake while this run lives

TAIL_PID=""
on_fail() {
  touch "$RUN_DIR/FAIL"
  emit_event failed "fatal at phase ${PHASE:-startup}"
  printf '\033[1;31mGAUNTLET v2 FAILED at phase: %s — log dir: %s\033[0m\n' "${PHASE:-startup}" "$RUN_DIR" >&2
}
trap on_fail ERR
trap reap_overlapped EXIT
trap 'on_signal 130' INT    # reap + exit (130 = 128+SIGINT) — an interrupt must abort
trap 'on_signal 143' TERM   # reap + exit (143 = 128+SIGTERM)
set -e   # arm AFTER the traps (SHY-0236: a die before the trap writes no sentinel)

FAILED_STEPS=()
notify start "gauntlet v2 run $RUN_ID (target=$TARGET)"

MATRIX_DIR="" MATRIX_LOG="" MATRIX_PID=""

# ── 1-2. infra (die-fast) ──────────────────────────────────────────────────
phase "prereqs"; bash "$HERE/00-prereqs.sh"
phase "services"
if [ "$FRESH" = "1" ]; then bash "$HERE/10-services.sh" --fresh; else bash "$HERE/10-services.sh"; fi

# PIN-ready gate: pause + ping until the operator confirms the devices are
# unlocked + secure-lock-disabled, BEFORE any device is touched (SHY-0239).
# No-op under --no-pin-gate or --no-matrix.
pin_ready_gate

# Optional APK (re)build / app reset must happen BEFORE dispatch — 50-matrix's
# own device prep (30-android.sh with no args) does not install/reset. Its
# re-tunnel inside the launch is idempotent, so a double prep is harmless.
if [ "$MATRIX" = "1" ] && { [ "$INSTALL_APK" = "1" ] || [ "$RESET_APP" = "1" ]; }; then
  phase "android-prep"
  APREP=()
  [ "$INSTALL_APK" = "1" ] && APREP+=(--install)
  [ "$RESET_APP" = "1" ] && APREP+=(--reset)
  bash "$HERE/30-android.sh" ${APREP[@]+"${APREP[@]}"} || warn "android install/reset prep failed — continuing"
fi

# ── 3. dispatch the device matrix FIRST (it reseeds + preps devices itself) ──
if [ "$MATRIX" = "1" ]; then
  phase "matrix-dispatch"
  MATRIX_ARGS=("$TARGET")
  [ "$IOS" = "0" ] && MATRIX_ARGS+=(--skip-ios-check)
  bash "$HERE/50-matrix.sh" launch "${MATRIX_ARGS[@]}" 2>&1 | tee "$RUN_DIR/matrix-dispatch.log"
  MATRIX_DIR="$(readlink "$GAUNTLET_TMP/matrix-latest" 2>/dev/null || true)"
  [ -n "$MATRIX_DIR" ] && MATRIX_LOG="$MATRIX_DIR/log"
  [ -n "$MATRIX_DIR" ] && MATRIX_PID="$(cat "$MATRIX_DIR/pid" 2>/dev/null || true)"
  ok "matrix dispatched (detached) — the phones are working now"
  # Stream the detached matrix log live to the console (still self-logged in its
  # own dir). Line-flushed + source-prefixed so it interleaves readably.
  if [ -n "$MATRIX_LOG" ]; then
    ( tail -n +1 -F "$MATRIX_LOG" 2>/dev/null | awk '{ print "[matrix] " $0; fflush() }' ) &
    TAIL_PID=$!
  fi
fi

# ── 4. overlap-safe framework suites — CONCURRENT with the live matrix ──────
if [ "$FRAMEWORKS" = "1" ]; then
  phase "overlap-suites"
  # State-INDEPENDENT only (host JVM + static analysis; zero emulator contact).
  start_overlapped gradle-unit-detekt bash -c "cd '$REPO' && ./gradlew testDevDebugUnitTest :shared:jvmTest detekt --console=plain"
  start_overlapped ktlint bash -c "cd '$REPO' && ktlint --relative"
  start_overlapped eslint bash -c "cd '$REPO/express-api' && npm run lint"
  wait_overlapped
  (cd "$REPO" && ./gradlew --stop >/dev/null 2>&1) || true
fi

# ── 5. wait for the device matrix to finish, then stop the live tail ────────
if [ "$MATRIX" = "1" ] && [ -n "$MATRIX_DIR" ]; then
  phase "matrix-wait"
  log "waiting for the device journey matrix to finish (pid ${MATRIX_PID:-?}, sentinel in $MATRIX_DIR)"
  while [ ! -e "$MATRIX_DIR/DONE" ] && [ ! -e "$MATRIX_DIR/FAIL" ]; do
    # Liveness escape: if the detached runner died (OOM/kill) WITHOUT writing a
    # sentinel, don't wait forever — a release gate that never returns is worse
    # than a FAIL. Grace-sleep first so a just-finishing runner can still write.
    if [ -n "$MATRIX_PID" ] && ! kill -0 "$MATRIX_PID" 2>/dev/null; then
      sleep 2
      if [ ! -e "$MATRIX_DIR/DONE" ] && [ ! -e "$MATRIX_DIR/FAIL" ]; then
        warn "matrix runner (pid $MATRIX_PID) exited without a sentinel — treating as FAIL"
        touch "$MATRIX_DIR/FAIL"
      fi
      break
    fi
    sleep 5
  done
  [ -n "$TAIL_PID" ] && { kill "$TAIL_PID" 2>/dev/null || true; TAIL_PID=""; }
  if [ -e "$MATRIX_DIR/FAIL" ]; then
    warn "device journey matrix FAILED — results: bash $HERE/50-matrix.sh results"
    FAILED_STEPS+=("journey-matrix")
    notify_first_fail "journey-matrix"
  else
    ok "device journey matrix passed"
  fi
fi

# ── 6. stack-coupled framework suites — AFTER the matrix (stack now free) ────
# express-jest WIPES emulator Auth, so it must never overlap a live matrix; it
# only reaches here once the matrix has finished. reseed heals its wipe before
# the web suites, exactly as v1 does.
if [ "$FRAMEWORKS" = "1" ]; then
  phase "stack-coupled-suites"
  # Reseed BEFORE jest: the device matrix (and --no-matrix) leaves the emulator
  # in a mutated/unknown state; v1 guaranteed jest a clean baseline (gauntlet.sh
  # reseeds immediately before jest), so v2 must too.
  phase "reseed-pre-jest"; bash "$HERE/20-reseed.sh"
  run_logged express-jest bash -c "cd '$REPO/express-api' && npm test"
  phase "reseed-post-jest"; bash "$HERE/20-reseed.sh"
  run_logged playwright-e2e bash -c "cd '$REPO' && API_BASE_URL=http://localhost:3000 npx playwright test"
  run_logged playwright-integration bash -c "cd '$REPO' && API_BASE_URL=http://localhost:3000 npx playwright test --config=playwright.integration.config.ts"
  phase "reseed-post-web"; bash "$HERE/20-reseed.sh"
fi

# ── 7. instrumented Android BDD (opt-in, needs the device the matrix just freed) ──
if [ "$ANDROID_BDD" = "1" ]; then
  phase "android-bdd"
  run_logged connected-bdd bash -c "cd '$REPO' && ./gradlew connectedDevDebugAndroidTest --console=plain"
  (cd "$REPO" && ./gradlew --stop >/dev/null 2>&1) || true
fi

# ── 8. aggregated tally + sentinel (SHY-0236 contract) ──────────────────────
if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
  touch "$RUN_DIR/FAIL"
  trap - ERR
  notify failed "${#FAILED_STEPS[@]} step(s) failed: ${FAILED_STEPS[*]}"
  printf '\033[1;31mGAUNTLET v2 completed WITH %d FAILED STEP(S): %s\033[0m\n' \
    "${#FAILED_STEPS[@]}" "${FAILED_STEPS[*]}" >&2
  log "artifacts in $RUN_DIR"
  exit 1
fi

touch "$RUN_DIR/DONE"
trap - ERR
notify complete "all green — artifacts in $RUN_DIR"
phase "done"
log "gauntlet v2 complete — artifacts in $RUN_DIR"
