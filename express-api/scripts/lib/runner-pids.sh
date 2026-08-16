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
  local scope="${1:-}" excl
  excl="$(_runner_self_and_ancestors)"
  # -ww: never truncate. A truncated command line silently loses the script
  # token and turns a genuine runner into a miss.
  ps -Aww -o pid=,command= 2>/dev/null | awk -v scope="$scope" -v excl="$excl" '
    BEGIN {
      # Built here rather than passed via -v: awk applies escape processing to
      # -v assignments, which would eat the backslash in \. and let
      # "manual-qa-runner-js" match.
      re = "(^|[[:space:]/])node[0-9._@-]*[[:space:]].*[[:space:]/]manual-qa-runner\\.js([[:space:]]|$)"
      n = split(excl, e, " ")
      for (i = 1; i <= n; i++) skip[e[i]] = 1
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
    # A new record starts with the pid column; anything else continues the
    # previous one (the launcher embeds newlines in its command).
    /^[ \t]*[0-9]+[ \t]/ {
      flush()
      pid = $1
      cmd = $0
      sub(/^[ \t]*[0-9]+[ \t]+/, "", cmd)
      next
    }
    { cmd = cmd " " $0 }
    END { flush() }
  '
}

# runner_ps_lines <newline-separated-pids> — pid + command for each, for an
# operator-facing report. Silent when the list is empty.
runner_ps_lines() {
  local csv
  csv="$(printf '%s\n' "${1:-}" | tr '\n' ',' | sed 's/,,*/,/g; s/^,//; s/,$//')"
  [ -n "$csv" ] || return 0
  ps -ww -o pid=,command= -p "$csv" 2>/dev/null || true
}
