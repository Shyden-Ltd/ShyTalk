#!/usr/bin/env bash
#
# Shellcheck the `run:` bodies of composite actions.
#
# WHY THIS EXISTS (SHY-0298 R1/I3). `actionlint` embeds shellcheck and the
# lint job runs it — but with no path arguments it lints `.github/workflows/**`
# ONLY. Composite action metadata files are not workflow files, so every line
# of shell under `.github/actions/**` was unlinted. Verified by mutation: a
# valid-YAML `rm -rf "$UNSET"/x` injected into a composite action leaves
# `actionlint` exiting 0 with the file unmentioned.
#
# It was worse than a passive gap. `.husky/pre-push` TRIGGERS on
# `^\.github/(workflows|actions)/` and then runs a command that does not read
# `.github/actions/**` at all — so changing an action.yml printed
# "actionlint passed" having checked nothing in the changed file.
#
# SHY-0298 then moved ~65 lines of new shell into exactly that surface.
#
# Usage:  bash scripts/check-action-shell.sh
# Exit:   0 clean · 1 shellcheck findings · 2 usage or environment error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIONS_DIR="$ROOT/.github/actions"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "::error::shellcheck is not installed — it is required to lint composite-action shell"
  exit 2
fi

if [ ! -d "$ACTIONS_DIR" ]; then
  echo "no .github/actions directory — nothing to check"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Same SC2086 suppression the workflow lint uses, and for the same reason:
# GitHub manages $RUNNER_TEMP and friends, and quoting them repo-wide is noise.
#
# `--severity=warning` is a deliberate choice, not laziness. At `info` the
# existing, device-proven actions report SC2012 ("use find instead of ls") and
# SC2016 ("expressions don't expand in single quotes") — the first on an
# `ls` inside an ERROR MESSAGE and on the Xcode-version glob that SHY-0195
# device-proved, the second on backticks that are deliberately markdown for a
# step summary. All three are correct as written. Sprinkling `disable=`
# comments through working code to satisfy an info rule is worse than the rule.
#
# Measured, not assumed: against the existing actions, `warning` and the
# default report the SAME real defects — SC2115 (`rm -rf "$X/"` where X may be
# empty) and SC2045 (iterating `ls`) both fire — and differ only on the three
# info-level false positives above. Note SC2164 (unchecked `cd`) does NOT fire
# either way, and correctly so: these blocks run under `set -e`, where a failed
# cd aborts the step. See the test file for the probes.
SHELLCHECK_OPTS="${SHELLCHECK_OPTS:--e SC2086 --severity=warning}"

blocks=0
expected=0
files=0
failed=0

while IFS= read -r action; do
  files=$((files + 1))
  rel="${action#"$ROOT"/}"

  # Extract every `run:` body with its own step index, so a finding names the
  # step it came from rather than a line number in a temp file.
  counts=$(
    python3 - "$action" "$WORK" "$rel" <<'PY'
import sys, os, re, yaml

action, work, rel = sys.argv[1], sys.argv[2], sys.argv[3]
with open(action) as fh:
    doc = yaml.safe_load(fh)

steps = ((doc or {}).get("runs") or {}).get("steps") or []
n = 0
bash_steps = sum(
    1 for st in steps if st.get("run") and (st.get("shell") or "bash") == "bash"
)
for i, step in enumerate(steps):
    body = step.get("run")
    if not body:
        continue
    # `shell: bash` is what GitHub runs these under; anything else (pwsh,
    # python) is not shellcheck's business.
    if (step.get("shell") or "bash") != "bash":
        continue
    # `${{ ... }}` is expanded by Actions before bash ever sees it, and its
    # syntax is not shell. Replace with an inert placeholder so shellcheck
    # parses the real script rather than tripping over the expression.
    body = re.sub(r"\$\{\{[^}]*\}\}", "GH_EXPR", body)
    # The real path travels in a sidecar. Encoding it into the filename was
    # lossy — a hyphen in the action's own name came back as a slash — and a
    # finding that misnames its source costs more time than it saves.
    safe = f"{abs(hash(rel)) % 10**8}-{i}"
    out = os.path.join(work, f"{safe}.sh")
    with open(out + ".origin", "w") as fh:
        fh.write(f"{rel}\tstep {i}")
    with open(out, "w") as fh:
        fh.write("#!/usr/bin/env bash\n")
        # GitHub runs `run:` steps as `bash --noprofile --norc -eo pipefail`.
        fh.write("set -eo pipefail\n")
        fh.write(body)
    n += 1
# Two numbers, because they answer different questions: `bash_steps` is how
# many blocks SHOULD have been extracted, `n` is how many were. An action with
# only pwsh steps has 0 of both, which is fine; 0 of a non-zero total is a
# broken extractor.
print(f"{n} {bash_steps}")
PY
  )
  blocks=$((blocks + ${counts%% *}))
  expected=$((expected + ${counts##* }))
done < <(find "$ACTIONS_DIR" -name action.yml -type f | sort)

if [ "$blocks" -ne "$expected" ]; then
  # A silent zero is how a checker quietly stops checking. Compare against what
  # SHOULD have been extracted rather than against zero: an action with only
  # pwsh steps legitimately yields nothing, while 0 of a non-zero total means
  # the extractor broke and every block is going unchecked.
  echo "::error::extracted $blocks of $expected bash run-blocks from $files action.yml file(s) — the extractor is broken"
  exit 2
fi

if [ "$blocks" -eq 0 ]; then
  echo "check-action-shell: no bash run-blocks in $files action.yml file(s)"
  exit 0
fi

for script in "$WORK"/*.sh; do
  [ -e "$script" ] || continue
  origin="$(cat "$script.origin" 2>/dev/null || echo "unknown")"
  # shellcheck disable=SC2086 # SHELLCHECK_OPTS is a deliberate word-split
  if ! output=$(shellcheck -s bash $SHELLCHECK_OPTS "$script" 2>&1); then
    failed=$((failed + 1))
    printf '::error::shellcheck findings in %s\n' "$origin"
    echo "$output"
  fi
done

if [ "$failed" -gt 0 ]; then
  echo "check-action-shell: $failed of $blocks shell block(s) have findings"
  exit 1
fi

echo "check-action-shell: clean — $blocks shell block(s) across $files action.yml file(s)"
