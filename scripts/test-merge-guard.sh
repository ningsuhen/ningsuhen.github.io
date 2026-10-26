#!/bin/sh
# Tests merge-pr.sh's branch_at_head guard: it must refuse to arm/merge a PR whose head is not the tip of
# the local branch (unpushed commits, or a branch that moved past the head), and stay silent when there is
# no local branch at the head. Pure git in a throwaway repo — no API, no push to a protected branch.
# Usage: pnpm test:merge-guard   (or sh scripts/test-merge-guard.sh)
set -u
top="$(git rev-parse --show-toplevel)"
fails=0

# Pull just the branch_at_head() function out of merge-pr.sh and define it here.
eval "$(awk '/^branch_at_head\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$top/scripts/merge-pr.sh")"
[ "$(command -v branch_at_head)" ] || { echo "FAIL could not extract branch_at_head"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q --bare origin.git
# Populate the bare repo from a throwaway seed, then work in a real CLONE so refs/remotes/origin/* exist.
git init -q seed && cd seed
git config user.name t && git config user.email t@t.t
git commit -q --allow-empty -m A
git commit -q --allow-empty -m A2
git branch -M feature
git push -q ../origin.git feature
# A second branch pushed to origin only (never checked out locally) — its tip is in no local branch.
git checkout -q --orphan other
git commit -q --allow-empty -m B
git push -q ../origin.git other
git checkout -q feature
cd ..
git clone -q --branch feature origin.git work && cd work

# safe <label> <head>: branch_at_head must return 0.
safe() {
	if branch_at_head "$2" 2>/dev/null; then echo "ok   safe: $1"; else echo "FAIL not safe: $1"; fails=$((fails + 1)); fi
}
# refused <label> <head>: branch_at_head must return 1.
refused() {
	if branch_at_head "$2" 2>/dev/null; then echo "FAIL not refused: $1"; fails=$((fails + 1)); else echo "ok   refused: $1"; fi
}

tip="$(git rev-parse feature)"
first="$(git rev-list --max-parents=0 feature)"
other_tip="$(git rev-parse refs/remotes/origin/other)"

safe "branch is at the PR head, fully pushed" "$tip"

# A commit ahead of the head, not pushed: the branch contains the head but is ahead of origin.
git commit -q --allow-empty -m C
refused "branch has an unpushed commit past the head" "$tip"
git reset -q --hard "$tip"

# The head is an ancestor the branch has moved past: tip != head.
refused "head is not the tip of the branch" "$first"

# The head lives only on an origin branch with no local branch containing it: nothing to compare.
safe "no local branch contains the head" "$other_tip"

[ "$fails" -eq 0 ]
