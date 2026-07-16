#!/usr/bin/env bash
# 50-matrix.sh — detached journey-matrix launcher (manual-qa-runner.js --matrix).
#
# Subcommands:
#   launch [local|dev] [--skip-ios-check]   start a detached matrix run
#   status [runId]                          PID alive/dead + log tail + sentinel
#   stop   [runId]                          SIGTERM the runner (SIGKILL after 5s)
#   results [runId]                         print the matrix-report JSON summary
#   list                                    show all known runs
#
# The run is FULLY detached (nohup + disown): closing the terminal does not
# kill it. Exactly one sentinel file (DONE or FAIL) appears in the run dir
# when it finishes. Runs live at /tmp/shytalk-gauntlet/matrix-<runId>/.
#
# Faithful port of the proven launcher recipe (frozen runner flags, env
# prefixes, iPhone gate) so anyone can dispatch the matrix from the repo.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib.sh"
require_repo

SECRETS_ENV="${HOME}/.shytalk/dev-personas.env"
ADMIN_SDK_DEV="${HOME}/.shytalk/firebase-admin-dev.json"

resolve_run_dir() {
  local id="${1:-}"
  if [ -z "$id" ]; then
    [ -L "$GAUNTLET_TMP/matrix-latest" ] || die "no latest run; pass a runId"
    readlink "$GAUNTLET_TMP/matrix-latest"
    return
  fi
  local dir="$GAUNTLET_TMP/matrix-${id}"
  [ -d "$dir" ] || die "no such run: $id (looked for $dir)"
  echo "$dir"
}

cmd_launch() {
  local target="local" skip_ios=0 a
  for a in "$@"; do
    case "$a" in
      local|dev) target="$a" ;;
      prod) die "never run mutating journeys against prod" ;;
      --skip-ios-check) skip_ios=1 ;;
      *) die "unknown launch arg: $a" ;;
    esac
  done

  # --- secrets ---------------------------------------------------------
  [ -f "$SECRETS_ENV" ] || die "$SECRETS_ENV missing (PERSONAS_PASSWORD + FIREBASE_*_API_KEY)"
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_ENV"
  set +a
  [ -n "${PERSONAS_PASSWORD:-}" ] || die "PERSONAS_PASSWORD not in $SECRETS_ENV"
  local upper_target fb_key_var
  upper_target="$(echo "$target" | tr '[:lower:]' '[:upper:]')"
  fb_key_var="FIREBASE_${upper_target}_API_KEY"
  [ -n "${!fb_key_var:-}" ] || die "${fb_key_var} not set (source from $SECRETS_ENV or export inline)"
  if [ "$target" = "dev" ]; then
    [ -f "$ADMIN_SDK_DEV" ] || die "$ADMIN_SDK_DEV missing (dev state-verification needs it)"
    export GOOGLE_APPLICATION_CREDENTIALS="$ADMIN_SDK_DEV"
  fi

  # --- run layout --------------------------------------------------------
  local run_id tmpdir logf pid_file report_dir
  run_id="$(date +%Y%m%d-%H%M%S)-${target}"
  tmpdir="$GAUNTLET_TMP/matrix-${run_id}"
  logf="$tmpdir/log"
  pid_file="$tmpdir/pid"
  report_dir="$tmpdir/report"
  mkdir -p "$report_dir"

  # --- local pre-flights ---------------------------------------------------
  if [ "$target" = "local" ]; then
    curl -fs -m 2 -o /dev/null http://localhost:4000 2>/dev/null \
      || die "local stack is down — run 10-services.sh first"
    curl -fs -m 2 -o /dev/null http://localhost:8888 2>/dev/null \
      || die "web server :8888 is down — run 10-services.sh first"
    log "reseeding (idempotent) so users/data are always present"
    bash "$HERE/20-reseed.sh" || die "reseed failed — aborting before burning cell timeouts"
  fi

  # --- device pre-flights -----------------------------------------------------
  # Android: best-effort tunnels + wake (web cells run without a device).
  bash "$HERE/30-android.sh" || warn "Android prep failed — device cells will skip/fail"
  # iPhone: gate on devicectl availability (NOT the misleading xctrace
  # offline label). --driver=all includes iOS cells; a missing phone burns
  # hours of cell timeouts, so abort early unless explicitly skipped.
  if [ "$skip_ios" = "0" ]; then
    local ios_present
    ios_present="$(xcrun devicectl list devices 2>/dev/null \
      | grep -iE 'available|connected' | grep -ic 'physical' || true)"
    if [ "${ios_present:-0}" -lt 1 ]; then
      die "no physical iPhone available to CoreDevice (xcrun devicectl list devices). Connect + unlock it, or pass --skip-ios-check"
    fi
    ok "iPhone present + available to CoreDevice"
    bash "$HERE/40-ios.sh" || warn "iOS prep failed — iOS cells will skip/fail"
  fi

  # --- env prefix (target-specific, empirically frozen) -------------------------
  # local: NODE_ENV=local wires firebase.js to the emulators; WDA_TEAM_ID
  # overrides the stale value in dev-personas.env (F3XX4PM3MF is the only
  # signable team on this Mac); IOS_BUNDLE_ID: the Debug-Local build's real
  # bundle id (pbxproj never applies the .local suffix).
  # dev: explicit RTDB URL (region-specific) or every cell dies at init.
  local env_prefix=""
  [ "$target" = "local" ] && env_prefix="NODE_ENV=local WDA_TEAM_ID=F3XX4PM3MF IOS_BUNDLE_ID=com.shyden.shytalk "
  [ "$target" = "dev" ] && env_prefix="FIREBASE_DATABASE_URL=https://shytalk-dev-default-rtdb.europe-west1.firebasedatabase.app WDA_TEAM_ID=F3XX4PM3MF "

  # --- fork detached ---------------------------------------------------------------
  (
    cd "$REPO/express-api" || exit 1
    nohup bash -c "
      ${env_prefix}node scripts/manual-qa-runner.js \
        --matrix \
        --parallel \
        --target='$target' \
        --driver=all \
        --report-format=json \
        --report-dir='$report_dir' \
        --report-output='$report_dir/matrix-report.json' \
        --cell-timeout=7200 \
        --retry=1 \
        --bail=3 \
        && touch '$tmpdir/DONE' \
        || touch '$tmpdir/FAIL'
    " >"$logf" 2>&1 </dev/null &
    echo $! >"$pid_file"
    disown
  )
  ln -sfn "$tmpdir" "$GAUNTLET_TMP/matrix-latest"

  cat <<EOF
Launched detached. run-id: $run_id
PID:        $(cat "$pid_file")
Log:        $logf
Report dir: $report_dir
Status:     bash $HERE/50-matrix.sh status $run_id
Stop:       bash $HERE/50-matrix.sh stop $run_id
Results:    bash $HERE/50-matrix.sh results $run_id
EOF
}

cmd_status() {
  local dir; dir="$(resolve_run_dir "${1:-}")"
  echo "Run dir: $dir"
  if [ -f "$dir/pid" ]; then
    local pid; pid="$(cat "$dir/pid")"
    if kill -0 "$pid" 2>/dev/null; then echo "Status: RUNNING (pid $pid)"; else echo "Status: EXITED (pid $pid gone)"; fi
  fi
  [ -f "$dir/DONE" ] && echo "Sentinel: DONE"
  [ -f "$dir/FAIL" ] && echo "Sentinel: FAIL"
  echo "--- log tail ---"
  tail -30 "$dir/log" 2>/dev/null || echo "(no log yet)"
}

cmd_stop() {
  local dir; dir="$(resolve_run_dir "${1:-}")"
  [ -f "$dir/pid" ] || die "no pid file in $dir"
  local pid; pid="$(cat "$dir/pid")"
  kill -0 "$pid" 2>/dev/null || { echo "already exited"; return 0; }
  kill "$pid" 2>/dev/null || true
  sleep 5
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  echo "stopped pid $pid"
}

cmd_results() {
  local dir; dir="$(resolve_run_dir "${1:-}")"
  local report="$dir/report/matrix-report.json"
  [ -f "$report" ] || die "no report yet at $report (still running? check status)"
  if command -v jq >/dev/null 2>&1; then
    jq '{cells: (.cells | length), summary: .summary}' "$report" 2>/dev/null || cat "$report"
  else
    cat "$report"
  fi
}

case "${1:-}" in
  launch) shift; cmd_launch "$@" ;;
  status) shift; cmd_status "${1:-}" ;;
  stop)   shift; cmd_stop "${1:-}" ;;
  results) shift; cmd_results "${1:-}" ;;
  list)   ls -1dt "$GAUNTLET_TMP"/matrix-2* 2>/dev/null || echo "(no runs)" ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
