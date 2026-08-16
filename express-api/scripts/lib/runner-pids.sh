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
#   3. Whole records, not lines. The launcher builds its command with embedded
#      newlines, so one process occupies several lines of `ps` output.
#      Continuation lines are folded back into the record they belong to;
#      matching them independently would both miss the wrapper and emit
#      non-numeric junk into a list that gets passed to `kill`.

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
  local excl live
  excl="$(_runner_self_and_ancestors)"
  # The authoritative set of pids that actually exist. A record's first token
  # looking like a pid is NOT enough to prove it starts a new record — see
  # _runner_filter — so the parse is anchored on real pids instead of on shape.
  live="$(ps -Aww -o pid= 2>/dev/null | tr -d ' ' | tr '\n' ' ')"
  # -ww: never truncate. A truncated command line silently loses the script
  # token and turns a genuine runner into a miss.
  ps -Aww -o pid=,command= 2>/dev/null | _runner_filter "${1:-}" "$excl" "$live"
}

# _runner_filter <scope> <excluded-pids> [live-pids] — the predicate itself,
# reading `ps -o pid=,command=` records on stdin.
#
# Split from runner_pids so the record parsing can be driven with input this
# machine cannot produce. macOS `ps` renders an embedded newline as the escape
# `\012`, keeping every record on one line, so the continuation-folding branch
# below is UNREACHABLE here — and a test that spawns a fixture and asserts it
# is found passes identically with the folding removed, which is how two such
# tests were caught being decorations. Feeding records in directly is the only
# way to exercise the branch on this platform, and it is still the real awk
# program against real record text, not a stand-in for it.
_runner_filter() {
  local scope="${1:-}" excl="${2:-}" live="${3:-}"
  awk -v scope="$scope" -v excl="$excl" -v live="$live" '
    BEGIN {
      # Built here rather than passed via -v: awk applies escape processing to
      # -v assignments, which would eat the backslash in \. and let
      # "manual-qa-runner-js" match.
      #
      # `[ \t]` rather than `[[:space:]]`: Ubuntu CI resolves `awk` to mawk,
      # whose POSIX-class support has varied across versions, and a class it
      # does not understand degrades to a literal character set — which would
      # make this pattern match NOTHING and let every genuine runner escape,
      # silently, on Linux only. Records are folded into a single line before
      # matching, so space and tab are the only whitespace that can occur.
      #
      # `node(js)?`: Debian and older Ubuntu ship the binary as `nodejs` with
      # no `node` symlink. This project always launches with a literal `node`,
      # so this is defensive, but the failure direction is the dangerous one —
      # an unrecognised runner keeps driving a real phone.
      re = "(^|[ \t/])node(js)?[0-9._@-]*[ \t].*[ \t/]manual-qa-runner\\.js([ \t]|$)"
      n = split(excl, e, " ")
      for (i = 1; i <= n; i++) skip[e[i]] = 1
      have_live = 0
      m = split(live, L, " ")
      for (i = 1; i <= m; i++) { alive[L[i]] = 1; have_live = 1 }
      pid = ""
      cmd = ""
    }
    function flush(   ) {
      if (pid == "") return
      if (pid in skip) return
      if (cmd !~ re) return
      if (scope != "" && index(cmd, scope) == 0) return
      print pid
    }
    # A new record starts with the pid column — but LOOKING like a pid column
    # is not enough. A continuation line beginning with digits and whitespace
    # is shape-identical to a new record, and treating one as a record both
    # invents a pid no process owns (which would be handed to `kill`) and cuts
    # the real record in half so its runner escapes. Measured: the record
    # ["5150 bash -c ", "99999 node …/manual-qa-runner.js"] reported 99999 and
    # missed 5150. So the split is anchored on pids that ACTUALLY EXIST.
    #
    # `have_live` keeps the shape-only behaviour when no live set is supplied,
    # so the function stays usable standalone.
    /^[ \t]*[0-9]+[ \t]/ && (!have_live || ($1 in alive)) {
      flush()
      pid = $1
      cmd = $0
      sub(/^[ \t]*[0-9]+[ \t]+/, "", cmd)
      next
    }
    { cmd = cmd " " $0 }
    END { flush() }
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
