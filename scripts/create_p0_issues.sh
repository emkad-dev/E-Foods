#!/usr/bin/env bash
# Create GitHub issues from P0_ISSUES.md entries using `gh` CLI.
# Usage: gh auth login, then ./create_p0_issues.sh

set -euo pipefail

FILE="P0_ISSUES.md"
if [ ! -f "$FILE" ]; then
  echo "$FILE not found"
  exit 1
fi

# This script will create one issue per top-level bullet under 'High-priority issues'
# Customize parsing as needed.

grep -n "^[0-9]\. " "$FILE" | while IFS= read -r line; do
  num=$(echo "$line" | cut -d: -f1)
  title=$(sed -n "$num,${num}p" "$FILE" | sed -n '1p' | sed 's/^[0-9]\+\. //')
  body=$(sed -n "$num,${num}p" "$FILE" | tail -n +2 | sed -n '1,10p')
  echo "Creating issue: $title"
  gh issue create --title "$title" --body "$body" --label p0,security || true
done

echo "Finished creating issues (check GitHub)."
