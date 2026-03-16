#!/bin/bash
# Block git commit/push on main branch — all changes must go through PRs
COMMAND="$CLAUDE_BASH_COMMAND"
BRANCH=$(git branch --show-current 2>/dev/null)

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  if echo "$COMMAND" | grep -qE "git (commit|push)"; then
    echo "BLOCK: Cannot commit/push directly to main. Create a branch first."
    exit 2
  fi
fi
