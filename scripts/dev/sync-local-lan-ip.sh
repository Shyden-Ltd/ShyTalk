#!/usr/bin/env bash
#
# Point the LAN-dependent entries of express-api/.env.local at THIS machine.
#
# Two settings in .env.local carry the host's LAN address rather than
# `localhost`, because a real phone cannot reach `localhost`:
#
#   MINIO_ENDPOINT   the S3 endpoint signed upload URLs are minted against
#   CDN_URL          the base URL attachments are served from
#
# Both were hand-written, and a laptop's DHCP lease is not a constant. On
# 2026-08-24 they still named 192.168.1.9 while the machine had become
# 192.168.1.5, so every signed upload URL pointed at a host that was not there.
# Uploads did not error — they hung until the caller timed out, which reads like
# a slow network rather than a wrong address. Two browser attachment tests were
# failing on it, and every device journey that attaches a file would have too.
#
# Run before local testing, or let `local/start.sh` call it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/express-api/.env.local}"

# The same detector as local/start.sh and scripts/dev/ios-local-install.sh:
# follow the DEFAULT ROUTE rather than guessing en0, which is what makes it
# correct on a machine with both Wi-Fi and Ethernet up.
detect_lan_ip() {
  if [ "$(uname -s)" = "Darwin" ]; then
    local iface
    iface=$(route -n get default 2>/dev/null | awk '/interface: /{print $2; exit}')
    [ -n "$iface" ] && ipconfig getifaddr "$iface" 2>/dev/null && return 0
    for i in en0 en1; do ipconfig getifaddr "$i" 2>/dev/null && return 0; done
  else
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

LAN_IP="${LOCAL_HOST:-$(detect_lan_ip || true)}"

if [ -z "$LAN_IP" ]; then
  # Fatal. Rewriting these to something wrong is worse than leaving them, and
  # carrying on silently is how the stale address survived in the first place.
  echo "ERROR: could not detect a LAN address for this machine." >&2
  echo "       Re-run with LOCAL_HOST=<this machine's LAN IP>." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE does not exist." >&2
  exit 1
fi

changed=0
for key in MINIO_ENDPOINT CDN_URL; do
  current=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  if [ -z "$current" ]; then
    echo "  $key is not set in $(basename "$ENV_FILE") — leaving it alone."
    continue
  fi
  # Replace only the host portion, so the port and path are whatever the file
  # already says. Rewriting the whole value would bake this script's idea of
  # the port into everybody's environment.
  updated=$(printf '%s' "$current" | sed -E "s#//[0-9]{1,3}(\.[0-9]{1,3}){3}#//${LAN_IP}#")
  if [ "$updated" = "$current" ]; then
    echo "  $key already points at $LAN_IP"
    continue
  fi
  # `sed -i ''` for BSD sed; the value can contain `/`, so `#` is the delimiter.
  sed -i '' -E "s#^${key}=.*#${key}=${updated}#" "$ENV_FILE"
  echo "  $key: $current -> $updated"
  changed=$((changed + 1))
done

if [ "$changed" -gt 0 ]; then
  echo
  echo "Updated $changed setting(s). RESTART the API so it signs URLs against the new host:"
  echo "  (cd express-api && node --env-file=.env.local src/index.js)"
else
  echo "Nothing to change — $(basename "$ENV_FILE") already matches $LAN_IP."
fi
