#!/bin/sh
# Squash-merges a PR into master, then syncs the local dev/next mirror. Usage: pnpm merge-pr <number>
set -eu
case "${1:-}" in
	'' | *[!0-9]*) echo "Usage: pnpm merge-pr <number>" >&2; exit 1 ;;
esac
gh pr merge "$1" --squash
sh "$(dirname "$0")/sync-dev-next.sh"
