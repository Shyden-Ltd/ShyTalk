#!/usr/bin/env bash
#
# SHY-0465 — choose the address LiveKit advertises to clients.
#
# LiveKit puts this address in its ICE candidates. Get it wrong and signalling
# still connects — so the room opens — while media never flows. That reads as
# flakiness rather than as a wall, which is why it is worth probing rather than
# assuming.
#
# SHY-0273 taught the stack to advertise this machine's LAN address instead of
# the Docker bridge address. That answered "what is my LAN IP" and never
# "can the phone reach it". The two can differ: on 2026-08-26 the phone and
# this host sat on the same SSID and the same /24 and could not exchange a
# packet —
#
#   phone -> 192.168.1.1  (gateway)   0% loss     the phone's Wi-Fi is fine
#   phone -> 192.168.1.3  (this host) unreachable and this one is not
#
# It cleared hours later after both devices took new DHCP leases. AP client
# isolation, a stale lease and a band split all fit and none was proven — which
# is exactly why this script probes instead of diagnosing. It does not need to
# know WHY the phone cannot reach the host, only WHETHER it can.
#
# So this script ASKS the phone, and falls back to loopback when the answer is
# no. Loopback works because `adb reverse` carries LiveKit's TCP media port
# (7881) over USB; `adb reverse` forwards TCP only, which is why the UDP
# range alone never worked over the cable.
#
# The probe is ICMP, not a port check, because this runs BEFORE the containers
# start — nothing is listening on 7880 yet, so a port check would report
# "unreachable" on a perfectly healthy network.
#
# Contract:
#   stdout  the chosen address, and nothing else (callers capture it)
#   stderr  the reason, for the operator
#   exit    always 0 — a stack that will not start is worse than one that
#           starts on the wrong address and says so
#
# Inputs (all optional):
#   LIVEKIT_NODE_IP   set by hand; wins outright and skips the probe
#   LIVEKIT_HOST_IP   this machine's LAN address; detected when unset
#   LIVEKIT_PROBE     probe command, called as `$LIVEKIT_PROBE <address>`;
#                     exit 0 means reachable. Defaults to the adb probe below
#   ADB               adb binary (default: adb)
#   ANDROID_SERIAL    device to ask, when more than one is attached
#
# Pinned by express-api/tests/scripts/livekit-node-ip-reachability.test.js.

set -uo pipefail

LOOPBACK="127.0.0.1"

say() { echo "$*" >&2; }

# `route get` picks the interface actually carrying traffic, which is correct
# when Wi-Fi and Ethernet are both up; en0/en1 guesswork is not.
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

# ---------------------------------------------------------------------------
# 1. An address set by hand wins. This is the documented USB-only escape
#    hatch (`LIVEKIT_NODE_IP=127.0.0.1 bash local/start.sh`) and it must keep
#    working verbatim, without a probe overriding the operator.
# ---------------------------------------------------------------------------
if [ -n "${LIVEKIT_NODE_IP:-}" ]; then
  say "  LiveKit will advertise ${LIVEKIT_NODE_IP} (set by hand; no reachability probe run)."
  echo "$LIVEKIT_NODE_IP"
  exit 0
fi

HOST_IP="${LIVEKIT_HOST_IP:-$(detect_lan_ip)}"

if [ -z "$HOST_IP" ]; then
  # Loud, not fatal. Emulator-less desktop runs still work on loopback, and a
  # silent empty value is how this cost an evening the first time.
  say "  WARNING: could not detect a LAN address for this machine."
  say "           Advertising ${LOOPBACK}; a device on Wi-Fi will not reach media."
  echo "$LOOPBACK"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Decide whether we can ask a phone at all. "No device" must NOT be read as
#    "unreachable": that would flip every desktop-only run onto loopback for a
#    reason that was never tested.
# ---------------------------------------------------------------------------
ADB_BIN="${ADB:-adb}"
PROBE="${LIVEKIT_PROBE:-}"

probe_is_runnable() {
  [ -n "$PROBE" ] && command -v "$PROBE" >/dev/null 2>&1
}

device_attached() {
  command -v "$ADB_BIN" >/dev/null 2>&1 || return 1
  "$ADB_BIN" devices 2>/dev/null | grep -qE '\sdevice$'
}

# The default probe: ask the phone to ping this machine. ICMP needs nothing
# listening, which is what makes it usable before the containers start.
adb_ping_probe() {
  local target="$1"
  local -a serial=()
  [ -n "${ANDROID_SERIAL:-}" ] && serial=(-s "$ANDROID_SERIAL")
  "$ADB_BIN" "${serial[@]}" shell "ping -c 1 -W 2 $target" 2>/dev/null |
    grep -qE '1 (packets )?received|bytes from'
}

if [ -n "$PROBE" ]; then
  if ! probe_is_runnable; then
    # Fail soft: a broken probe must not decide the address. Keeping the LAN
    # address preserves today's behaviour rather than inventing a fallback.
    say "  WARNING: reachability probe '${PROBE}' could not be run."
    say "           Advertising ${HOST_IP} untested."
    echo "$HOST_IP"
    exit 0
  fi
  if "$PROBE" "$HOST_IP" >/dev/null 2>&1; then
    say "  The phone can reach ${HOST_IP} — LiveKit will advertise it (media over Wi-Fi)."
    echo "$HOST_IP"
  else
    say "  The phone could not reach ${HOST_IP} (AP client isolation, or a"
    say "  different network). LiveKit will advertise ${LOOPBACK} instead, so"
    say "  ICE uses the TCP candidate that 'adb reverse tcp:7881' carries."
    echo "$LOOPBACK"
  fi
  exit 0
fi

if ! device_attached; then
  say "  No device attached — could not test whether a phone can reach ${HOST_IP}."
  say "  Advertising it untested; attach the phone before the voice journeys."
  echo "$HOST_IP"
  exit 0
fi

if adb_ping_probe "$HOST_IP"; then
  say "  The phone can reach ${HOST_IP} — LiveKit will advertise it (media over Wi-Fi)."
  echo "$HOST_IP"
else
  say "  The phone could not reach ${HOST_IP} (AP client isolation, or a"
  say "  different network). LiveKit will advertise ${LOOPBACK} instead, so"
  say "  ICE uses the TCP candidate that 'adb reverse tcp:7881' carries."
  echo "$LOOPBACK"
fi
exit 0
