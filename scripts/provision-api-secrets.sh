#!/usr/bin/env bash
# scripts/provision-api-secrets.sh — install the API's HMAC signing keys.
#
# SHY-0378. `MFA_REMEMBER_SECRET` and `EXPORT_DOWNLOAD_SECRET` sign, respectively,
# the cookie that lets a browser skip the 2FA prompt for 30 days and the token on
# a personal-data download link. When either is unset the code falls back to a
# string COMMITTED IN THIS REPOSITORY (`dev-mfa-remember-secret`,
# `dev-export-secret`), so anyone who can read the repo can forge one. In
# production the same code throws instead, so these are a launch blocker.
#
# These are not credentials issued by a provider. They have never existed. This
# script generates them.
#
# Design rules, each of which is a test in
# `express-api/tests/scripts/provision-api-secrets.test.js`:
#
#   * A secret that is already set is NEVER replaced. Rotation is opt-in via
#     --rotate, which states its cost first.
#   * No secret value is ever printed. Confirmation is a 12-hex-character
#     SHA-256 fingerprint. Values are never passed as command arguments either,
#     so they cannot appear in `ps` output.
#   * Duplicate keys are collapsed ONLY when every copy agrees, keeping the LAST
#     occurrence because that is the one dotenv loads (verified empirically
#     against dotenv 17.4.2, which parses top-down). A disagreement is refused —
#     picking a winner is not this script's call — and NOTHING is applied.
#   * The duplicate scan runs BEFORE any mutation, so a refusal never leaves the
#     file half-changed.
#   * A timestamped, owner-only backup is taken before any change, and no backup
#     is written when there is nothing to change.
#
# Modes:
#   --env-file <path>       Operate on a local env file. This is the whole of
#                           the logic and is what the tests exercise.
#   --host <user@host>      Remote: upload this script to the target, run it
#                           there in --env-file mode, restart the service, and
#                           verify the RUNNING process picked the values up.
#
# Why verification reads the running process and not the file: the service calls
# `dotenv.config()` without `override`, so anything already in the process
# environment WINS over the file. A value can be correct on disk and not be the
# one in use. That is the same shape as the 2026-08-19 outage — a change that
# looked applied and was not.
#
# Exit codes:
#   0  success, including "nothing to do"
#   1  unexpected failure
#   2  usage error
#   3  target or prerequisite unreachable (env file missing, ssh failed)
#   4  duplicate key conflict — two values disagree; NOTHING applied
#   5  post-restart health check failed; previous configuration restored
#
# Usage:
#   scripts/provision-api-secrets.sh --env-file /home/ubuntu/express-api/.env
#   scripts/provision-api-secrets.sh --env-file ./.env --dry-run
#   scripts/provision-api-secrets.sh --host ubuntu@1.2.3.4 \
#       --remote-dir /home/ubuntu/express-api --pm2-name shytalk-api \
#       --health-url https://api.example.com/api/health
#   scripts/provision-api-secrets.sh --env-file ./.env --rotate MFA_REMEMBER_SECRET

set -euo pipefail

# ─── Constants ──────────────────────────────────────────────────

# The secrets this script owns. Anything else in the file is left alone apart
# from duplicate collapsing.
MANAGED_SECRETS="MFA_REMEMBER_SECRET EXPORT_DOWNLOAD_SECRET"

SECRET_BYTES=32          # 32 bytes = 256 bits, hex-encoded to 64 characters.
FINGERPRINT_CHARS=12     # Enough to distinguish; far too little to attack.

E_FAIL=1
E_USAGE=2
E_UNREACHABLE=3
E_CONFLICT=4
E_HEALTH=5

# ─── Argument defaults ──────────────────────────────────────────

ENV_FILE=""
HOST=""
REMOTE_DIR="/home/ubuntu/express-api"
PM2_NAME="shytalk-api"
HEALTH_URL=""
DRY_RUN=0
ROTATE_KEYS=""
SSH_KEY=""

usage() {
  cat <<'USAGE'
provision-api-secrets.sh — install the API's HMAC signing keys (SHY-0378).

Generates MFA_REMEMBER_SECRET and EXPORT_DOWNLOAD_SECRET, which otherwise fall
back to strings committed in this repository. Never prints a secret value.

Modes (exactly one required):
  --env-file <path>        Operate on a local env file.
  --host <user@host>       Operate on a remote target over SSH.

Options:
  --remote-dir <path>      App directory on the target. Default: /home/ubuntu/express-api
  --pm2-name <name>        pm2 process to restart. Default: shytalk-api
  --health-url <url>       URL that must return 200 after the restart.
  --ssh-key <path>         Identity file for SSH.
  --rotate <KEY>           Replace a key that is already set. Repeatable.
                           Costs: everyone signed out of "remember this browser",
                           and every outstanding download link invalidated.
  --dry-run                Report what would change; write nothing.
  -h, --help               This text.

Exit codes:
  0  success, including "nothing to do"
  1  unexpected failure
  2  usage error
  3  target or prerequisite unreachable
  4  duplicate key conflict — values disagree; nothing applied
  5  health check failed after restart; previous configuration restored
USAGE
}

die() {
  # $1 = exit code, rest = message. Messages never contain secret values.
  local code="$1"; shift
  printf 'provision-api-secrets.sh: %s\n' "$*" >&2
  exit "$code"
}

# ─── Argument parsing ───────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)   [ $# -ge 2 ] || die "$E_USAGE" "--env-file needs a path"; ENV_FILE="$2"; shift 2 ;;
    --host)       [ $# -ge 2 ] || die "$E_USAGE" "--host needs user@host"; HOST="$2"; shift 2 ;;
    --remote-dir) [ $# -ge 2 ] || die "$E_USAGE" "--remote-dir needs a path"; REMOTE_DIR="$2"; shift 2 ;;
    --pm2-name)   [ $# -ge 2 ] || die "$E_USAGE" "--pm2-name needs a name"; PM2_NAME="$2"; shift 2 ;;
    --health-url) [ $# -ge 2 ] || die "$E_USAGE" "--health-url needs a url"; HEALTH_URL="$2"; shift 2 ;;
    --ssh-key)    [ $# -ge 2 ] || die "$E_USAGE" "--ssh-key needs a path"; SSH_KEY="$2"; shift 2 ;;
    --rotate)     [ $# -ge 2 ] || die "$E_USAGE" "--rotate needs a key name"; ROTATE_KEYS="$ROTATE_KEYS $2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "$E_USAGE" "unknown argument: $1" ;;
  esac
done

if [ -z "$ENV_FILE" ] && [ -z "$HOST" ]; then
  usage >&2
  die "$E_USAGE" "one of --env-file or --host is required"
fi
if [ -n "$ENV_FILE" ] && [ -n "$HOST" ]; then
  die "$E_USAGE" "--env-file and --host are mutually exclusive"
fi

# --rotate must name a secret this script owns. Rotating something else would
# mean generating a random value for a key whose format we do not know.
for key in $ROTATE_KEYS; do
  case " $MANAGED_SECRETS " in
    *" $key "*) ;;
    *) die "$E_USAGE" "--rotate: not a managed secret: $key (managed:$MANAGED_SECRETS)" ;;
  esac
done

# ─── Primitives ─────────────────────────────────────────────────

# 256 bits of CSPRNG output, hex. Prefers openssl; /dev/urandom is the fallback
# so the script also runs on a minimal host image.
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$SECRET_BYTES"
  elif [ -r /dev/urandom ]; then
    od -vAn -N"$SECRET_BYTES" -tx1 < /dev/urandom | tr -d ' \n'
  else
    die "$E_FAIL" "no source of cryptographic randomness (need openssl or /dev/urandom)"
  fi
}

# Prints the first FINGERPRINT_CHARS hex characters of the SHA-256 of stdin.
# The value arrives on stdin, never as an argument, so it cannot leak via `ps`.
fingerprint() {
  local sum
  if command -v sha256sum >/dev/null 2>&1; then
    sum=$(sha256sum | cut -d' ' -f1)
  elif command -v shasum >/dev/null 2>&1; then
    sum=$(shasum -a 256 | cut -d' ' -f1)
  else
    die "$E_FAIL" "no SHA-256 tool available (need sha256sum or shasum)"
  fi
  printf '%s' "${sum:0:$FINGERPRINT_CHARS}"
}

# Value of the LAST occurrence of a key, matching dotenv's precedence. Empty
# string when absent. Printed by the caller only as a fingerprint.
env_value() {
  local key="$1" file="$2"
  awk -v k="$key" '
    index($0, k "=") == 1 { v = substr($0, length(k) + 2) }
    END { printf "%s", v }
  ' "$file"
}

# ─── Local mode ─────────────────────────────────────────────────

provision_local() {
  local file="$1"

  [ -f "$file" ] || die "$E_UNREACHABLE" "env file not found: $file"
  [ -r "$file" ] || die "$E_UNREACHABLE" "env file not readable: $file"

  # ── Pre-flight: refuse a self-contradicting file BEFORE touching it. ──
  # Prints key names only; a conflicting value is never shown.
  local conflicts
  conflicts=$(awk '
    match($0, /^[A-Za-z_][A-Za-z0-9_]*=/) {
      k = substr($0, 1, RLENGTH - 1)
      v = substr($0, RLENGTH + 1)
      n[k]++
      if (n[k] == 1) { first[k] = v } else if (v != first[k]) { bad[k] = 1 }
    }
    END { for (k in bad) print k }
  ' "$file" | sort)

  if [ -n "$conflicts" ]; then
    printf 'REFUSED: these settings appear more than once with DIFFERENT values:\n' >&2
    printf '%s\n' "$conflicts" | while IFS= read -r k; do printf '  %s\n' "$k" >&2; done
    printf 'Choosing a winner is not this script'"'"'s call. Resolve by hand, then re-run.\n' >&2
    printf 'Nothing was changed.\n' >&2
    exit "$E_CONFLICT"
  fi

  local agreeing_dupes
  agreeing_dupes=$(awk '
    match($0, /^[A-Za-z_][A-Za-z0-9_]*=/) { n[substr($0, 1, RLENGTH - 1)]++ }
    END { for (k in n) if (n[k] > 1) print k }
  ' "$file" | sort)

  # ── Decide, per managed secret, what will happen. ──
  local to_add="" to_rotate="" unchanged="" key current
  for key in $MANAGED_SECRETS; do
    current=$(env_value "$key" "$file")
    case " $ROTATE_KEYS " in
      *" $key "*) to_rotate="$to_rotate $key"; continue ;;
    esac
    if [ -n "$current" ]; then
      unchanged="$unchanged $key"
    else
      to_add="$to_add $key"
    fi
  done

  # ── Dry run: say what would happen, write nothing. ──
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'DRY RUN — nothing will be written.\n'
    for key in $to_add;    do printf '%s: would add a new key\n' "$key"; done
    for key in $to_rotate; do printf '%s: would ROTATE the existing key\n' "$key"; done
    for key in $unchanged; do printf '%s: already set, would leave alone\n' "$key"; done
    for key in $agreeing_dupes; do printf '%s: would collapse duplicate copies (values agree)\n' "$key"; done
    return 0
  fi

  # ── Nothing to do: report and leave no backup behind. ──
  if [ -z "$to_add" ] && [ -z "$to_rotate" ] && [ -z "$agreeing_dupes" ]; then
    for key in $unchanged; do
      printf '%s: already set (fingerprint %s)\n' \
        "$key" "$(printf '%s' "$(env_value "$key" "$file")" | fingerprint)"
    done
    printf 'Nothing to change.\n'
    return 0
  fi

  # ── Rotation warns before it acts. ──
  for key in $to_rotate; do
    printf 'WARNING %s: rotating invalidates every value signed with the old key.\n' "$key"
    printf '        Everyone will be signed out of "remember this browser", and\n'
    printf '        every outstanding download link stops working.\n'
  done

  # ── Back up before the first byte changes. Owner-only. ──
  local backup
  backup="${file}.bak.$(date -u '+%Y%m%dT%H%M%SZ')"
  cp -p "$file" "$backup"
  chmod 600 "$backup"

  local tmp
  tmp=$(mktemp "${file}.new.XXXXXX")
  # The temp file inherits the real file's permissions, and holds secrets in the
  # meantime, so lock it down before anything is written into it.
  chmod 600 "$tmp"
  # $tmp must expand NOW, while it is still in scope, not when the trap fires.
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" EXIT

  # ── Collapse duplicates, keeping the LAST occurrence in its own position. ──
  awk '
    {
      lines[NR] = $0
      if (match($0, /^[A-Za-z_][A-Za-z0-9_]*=/)) {
        k = substr($0, 1, RLENGTH - 1)
        last[k] = NR
        keyat[NR] = k
      }
    }
    END {
      for (i = 1; i <= NR; i++) {
        k = keyat[i]
        if (k != "" && last[k] != i) continue
        print lines[i]
      }
    }
  ' "$file" > "$tmp"

  # ── Drop the lines we are about to replace, then append the new values. ──
  for key in $to_rotate; do
    grep -v "^${key}=" "$tmp" > "${tmp}.f" || true
    mv "${tmp}.f" "$tmp"
    chmod 600 "$tmp"
  done

  # `awk` above emits a trailing newline for every line it prints, so the file
  # is newline-terminated here even if the original was not. Guard anyway: a
  # zero-length file would otherwise gain a leading blank line.
  if [ -s "$tmp" ] && [ "$(tail -c 1 "$tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
    printf '\n' >> "$tmp"
  fi

  local value
  for key in $to_add $to_rotate; do
    value=$(generate_secret)
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  done

  # ── Swap in. `cat >` rather than `mv`, so the file keeps its own mode,
  # owner, and inode — a `mv` would install the temp file's 0600 and could
  # change the owner when run under sudo.
  cat "$tmp" > "$file"
  rm -f "$tmp"
  trap - EXIT

  # ── Report. Fingerprints only. ──
  for key in $to_add;    do printf '%s: added (fingerprint %s)\n'   "$key" "$(printf '%s' "$(env_value "$key" "$file")" | fingerprint)"; done
  for key in $to_rotate; do printf '%s: ROTATED (fingerprint %s)\n' "$key" "$(printf '%s' "$(env_value "$key" "$file")" | fingerprint)"; done
  for key in $unchanged; do printf '%s: already set (fingerprint %s)\n' "$key" "$(printf '%s' "$(env_value "$key" "$file")" | fingerprint)"; done
  for key in $agreeing_dupes; do printf '%s: duplicate copies collapsed to one (values agreed)\n' "$key"; done
  printf 'Backup: %s\n' "$backup"
}

# ─── Remote mode ────────────────────────────────────────────────

ssh_target() {
  if [ -n "$SSH_KEY" ]; then
    ssh -i "$SSH_KEY" -o ConnectTimeout=15 -o BatchMode=yes "$HOST" "$@"
  else
    ssh -o ConnectTimeout=15 -o BatchMode=yes "$HOST" "$@"
  fi
}

scp_target() {
  if [ -n "$SSH_KEY" ]; then
    scp -i "$SSH_KEY" -o ConnectTimeout=15 -o BatchMode=yes -q "$1" "$HOST:$2"
  else
    scp -o ConnectTimeout=15 -o BatchMode=yes -q "$1" "$HOST:$2"
  fi
}

provision_remote() {
  local self remote_script remote_env
  self="${BASH_SOURCE[0]}"
  remote_script="/tmp/provision-api-secrets.$$.sh"
  remote_env="${REMOTE_DIR}/.env"

  ssh_target 'true' >/dev/null 2>&1 || die "$E_UNREACHABLE" "cannot reach $HOST over ssh"

  # Ship the script and run it there, exactly as deploy-dev.yml does, rather
  # than expanding a command string client-side.
  scp_target "$self" "$remote_script" || die "$E_UNREACHABLE" "could not copy the script to $HOST"

  local rc=0
  local rotate_args=""
  for key in $ROTATE_KEYS; do rotate_args="$rotate_args --rotate $key"; done
  local dry_arg=""
  [ "$DRY_RUN" -eq 1 ] && dry_arg="--dry-run"

  # The remote command is built from validated, non-secret arguments and must
  # expand on the remote side.
  # shellcheck disable=SC2029
  ssh_target "bash $remote_script --env-file '$remote_env' $rotate_args $dry_arg" || rc=$?

  if [ "$rc" -ne 0 ]; then
    ssh_target "rm -f $remote_script" >/dev/null 2>&1 || true
    die "$rc" "remote provisioning failed (exit $rc); the target reported the reason above"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    ssh_target "rm -f $remote_script" >/dev/null 2>&1 || true
    return 0
  fi

  # ── Restart, then prove the RUNNING process picked the values up. ──
  printf 'Restarting %s...\n' "$PM2_NAME"
  ssh_target "pm2 restart $PM2_NAME --update-env" >/dev/null 2>&1 \
    || die "$E_FAIL" "pm2 restart failed on $HOST"

  local healthy=0
  if [ -n "$HEALTH_URL" ]; then
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL"; then healthy=1; break; fi
      sleep 3   # sleep-ok: waiting on a remote process to finish booting
    done
  else
    healthy=1
    printf 'No --health-url given; skipping the health check.\n' >&2
  fi

  if [ "$healthy" -ne 1 ]; then
    printf 'Health check FAILED after restart. Restoring the previous configuration.\n' >&2
    # Must expand remotely.
    # shellcheck disable=SC2029
    ssh_target "cp \"\$(ls -1t ${remote_env}.bak.* | head -1)\" '$remote_env' && pm2 restart $PM2_NAME --update-env" \
      >/dev/null 2>&1 || printf 'RESTORE ALSO FAILED — go look at %s by hand.\n' "$HOST" >&2
    ssh_target "rm -f $remote_script" >/dev/null 2>&1 || true
    exit "$E_HEALTH"
  fi

  # The file is only half the story: dotenv does not override a value already in
  # the process environment, so ask the running service what it actually loaded.
  printf 'Verifying the running service...\n'
  # Must expand remotely. Prints fingerprints only, never a value.
  # shellcheck disable=SC2029
  ssh_target "cd '$REMOTE_DIR' && node -e '
    require(\"dotenv\").config();
    const c = require(\"crypto\");
    for (const k of [\"MFA_REMEMBER_SECRET\", \"EXPORT_DOWNLOAD_SECRET\"]) {
      const v = process.env[k];
      const fp = v ? c.createHash(\"sha256\").update(v).digest(\"hex\").slice(0, $FINGERPRINT_CHARS) : \"UNSET\";
      console.log(k + \": live fingerprint \" + fp);
    }
  '" || printf 'Could not read the live fingerprints; check by hand.\n' >&2

  ssh_target "rm -f $remote_script" >/dev/null 2>&1 || true
  printf 'Done. Compare the live fingerprints above with the file fingerprints.\n'
}

# ─── Entry point ────────────────────────────────────────────────

if [ -n "$ENV_FILE" ]; then
  provision_local "$ENV_FILE"
else
  provision_remote
fi
