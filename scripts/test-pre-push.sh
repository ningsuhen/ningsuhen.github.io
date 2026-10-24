#!/bin/sh
# Tests the pre-push guard that refuses dev/next (local-only). Runs .githooks/pre-push itself; pushes nothing.
# Usage: pnpm test:hooks   (or sh scripts/test-pre-push.sh)
set -u
hook="$(git rev-parse --show-toplevel)/.githooks/pre-push"
sha=$(git rev-parse HEAD)
zero=0000000000000000000000000000000000000000
fails=0

# refused <label> <pre-push input line>: the hook must exit non-zero with the dev/next message.
refused() {
	out=$(printf '%s\n' "$2" | sh "$hook" origin 2>&1)
	rc=$?
	if [ "$rc" -ne 0 ] && [ "$out" != "${out#*refusing to push dev/next}" ]; then
		echo "ok   refused: $1"
	else
		echo "FAIL not refused: $1 (exit $rc)"
		fails=$((fails + 1))
	fi
}

# allowed <label> <pre-push input line>: the dev/next guard must stay silent (gitleaks may still judge the push).
allowed() {
	out=$(printf '%s\n' "$2" | sh "$hook" origin 2>&1)
	if [ "${out#*dev/next}" = "$out" ]; then
		echo "ok   not blocked by dev/next guard: $1"
	else
		echo "FAIL dev/next guard fired on: $1"
		fails=$((fails + 1))
	fi
}

refused "push to dev/next" "refs/heads/dev/next $sha refs/heads/dev/next $zero"
refused "push local dev/next to another branch" "refs/heads/dev/next $sha refs/heads/master $zero"
refused "delete dev/next on the remote" "(delete) $zero refs/heads/dev/next $sha"
allowed "a branch whose name only starts with dev/next" "refs/heads/dev/next-notes $sha refs/heads/dev/next-notes $zero"
[ "$fails" -eq 0 ]
