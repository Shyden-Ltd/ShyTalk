#!/usr/bin/env bash
# runner-pids.sh — identify QA matrix-runner processes by IDENTITY (SHY-0304).
#
# Sourced by `gauntlet/50-matrix.sh` (stop) and `qa-cleanup-orphans.sh`
# (sweep). Both used to ask `pgrep -f manual-qa-runner`, which matches any
# process whose command line MENTIONS the runner: the Jest process running its
# tests, the npm wrapper, the invoking shell, an editor, a `tail -f` on its
# log. One of those two callers kills, in its DEFAULT mode, so a false positive
# was a real kill — measured at 50 innocent processes in one sweep.
#
# Three rules, all deliberate:
#
#   1. Identity, not mention. A match needs a node executable token AND a whole
#      argv token whose path ends in `manual-qa-runner.js`. That admits
#      `node …/manual-qa-runner.js --matrix` and the `bash -c "… node
#      …/manual-qa-runner.js …"` wrapper the launcher creates; it rejects
#      `manual-qa-runner.test.js`, `manual-qa-runner-shard-flag.test.js`, and
#      anything merely reading or naming the file.
#
#   2. `ps -A`, not `pgrep`. BSD pgrep silently excludes the caller AND every
#      one of its ancestors; GNU pgrep excludes only the caller. Reaping
#      through pgrep is therefore safe on macOS and kills its own npm/shell
#      ancestry on Linux — and a test asserting "it spares my ancestors"
#      passes VACUOUSLY on macOS, proving nothing. `ps` has no hidden
#      exclusions on either platform, so the exclusion is explicit here and
#      behaves identically everywhere.
#
#   3. One record per line, MEASURED rather than assumed. The launcher does
#      build its command with embedded newlines, so it is natural to expect a
#      process to span several lines of `ps` output — and an earlier version of
#      this file carried a continuation-folding parser for exactly that. Both
#      supported platforms were then measured and NEITHER produces it:
#
#        macOS 27 (BSD ps)             newline → the literal escape `\012`
#        Ubuntu 24.04 (procps-ng 4.0.4) newline → a space
#
#      The folding was therefore guarding a shape that does not occur, and it
#      was not free: disambiguating a continuation line from a new record
#      needed a second `ps` snapshot to say which leading integers were real
#      pids, and the two snapshots race. A process forked between them was
#      absent from the pid set, so its line failed the new-record test, was
#      appended to the PREVIOUS record, and made an innocent neighbour match
#      the runner pattern — which `qa-cleanup-orphans.sh` would then KILL in
#      its default mode. Speculative defence built a worse bug than the one it
#      imagined. Deleted; `runner-process-identity.test.js` pins the platform
#      behaviour that makes it unnecessary, so a future platform that DOES
#      emit multi-line records fails loudly instead of silently misparsing.

# _runner_self_and_ancestors — this shell's pid and every ancestor of it,
# space-separated. Bounded so a malformed process table cannot spin.
_runner_self_and_ancestors() {
  local p="$$" out="" guard=0
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && [ "$guard" -lt 64 ]; do
    out="$out $p"
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d '[:space:]')"
    guard=$((guard + 1))
  done
  printf '%s' "${out# }"
}

# runner_pids [scope] — pids genuinely executing manual-qa-runner.js, one per
# line. With a non-empty scope, additionally require that literal string on the
# command line (a run id), scoping the answer to one run. Never returns this
# shell or any of its ancestors.
runner_pids() {
  local excl
  excl="$(_runner_self_and_ancestors)"
  # ONE snapshot. An earlier version took a second one to list real pids, and
  # the two raced — see rule 3 in the header.
  # -ww: never truncate. A truncated command line silently loses the script
  # token and turns a genuine runner into a miss.
  ps -Aww -o pid=,command= 2>/dev/null | _runner_filter "${1:-}" "$excl"
}

# _runner_filter <scope> <excluded-pids> — the predicate itself, reading
# `ps -o pid=,command=` records on stdin, one record per line.
#
# Split out from runner_pids so a test can drive the parser with exact record
# text rather than only with whatever this machine's process table happens to
# contain. It is the real awk program either way.
_runner_filter() {
  local scope="${1:-}" excl="${2:-}"
  awk -v scope="$scope" -v excl="$excl" '
    BEGIN {
      # Built here rather than passed via -v: awk applies escape processing to
      # -v assignments, which would eat the backslash in \. and let
      # "manual-qa-runner-js" match.
      #
      # `[ \t]` rather than `[[:space:]]`: both are correct on the awks in play
      # (mawk 1.3.4 on Ubuntu CI supports POSIX classes — verified), but every
      # record is one line, so space and tab are the only whitespace that can
      # occur and the simpler form has no version surface at all.
      #
      # `node(js)?`: Debian and older Ubuntu ship the binary as `nodejs` with
      # no `node` symlink. This project always launches with a literal `node`,
      # so this is defensive, but the failure direction is the dangerous one —
      # an unrecognised runner keeps driving a real phone.
      re = "(^|[ \t/])node(js)?[0-9._@-]*[ \t].*[ \t/]manual-qa-runner\\.js([ \t]|$)"
      n = split(excl, e, " ")
      for (i = 1; i <= n; i++) skip[e[i]] = 1
    }
    # One record per line on every supported platform (header rule 3). A line
    # that is not shaped like a record is ignored rather than folded into its
    # neighbour: attaching unrecognised text to the PREVIOUS pid is how an
    # innocent process gets reported — and, via qa-cleanup-orphans, killed.
    $1 ~ /^[0-9]+$/ {
      pid = $1
      cmd = $0
      sub(/^[ \t]*[0-9]+[ \t]+/, "", cmd)
      if (pid in skip) next
      if (cmd !~ re) next
      if (scope != "" && index(cmd, scope) == 0) next
      print pid
    }
  ' || true
  # `|| true`: qa-cleanup-orphans.sh runs under `set -e`, and every other
  # shell-out in that script guards itself the same way. A `ps` failure should
  # degrade this one section to "found nothing", not abort a cleanup sweep
  # half-done with adb forwards already torn down.
}

# runner_ps_lines <newline-separated-pids> — pid + command for each, for an
# operator-facing report. Silent when the list is empty.
runner_ps_lines() {
  local csv
  csv="$(printf '%s\n' "${1:-}" | tr '\n' ',' | sed 's/,,*/,/g; s/^,//; s/,$//')"
  [ -n "$csv" ] || return 0
  ps -ww -o pid=,command= -p "$csv" 2>/dev/null || true
}
