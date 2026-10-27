#!/bin/sh
# Squash-merges a PR into master, then syncs the local dev/next mirror. Usage: pnpm merge-pr <number>
#
# Guard: a merge only goes through when the PR's `check` and `gitleaks` are green on its current head.
# Branch protection does NOT enforce this for admin merges — `enforce_admins` is off and every session
# uses the owner's admin token — so a bare `gh pr merge` lands a red PR (that is how #210 merged with a
# red `check`). This script refuses a red PR and arms auto-merge (--auto) while the checks are still
# running, so the merge happens only once both are green.
#
# Auto-merge and new pushes: arming --auto does NOT track later pushes. If you push more commits to the
# branch after arming, the PR still merges at the older head once the checks pass (that is how #221 and
# #225 orphaned later commits). Before pushing, disarm with `gh pr merge <n> --disable-auto`, push, then
# re-arm. merge_guard refuses to arm or merge while the local branch is ahead of the PR head.
set -eu
case "${1:-}" in
	'' | *[!0-9]*) echo "Usage: pnpm merge-pr <number>" >&2; exit 1 ;;
esac
PR="$1"

# The state of a required check on the PR's current head: pass / fail / pending / skip (empty if unreadable).
check_state() {
	gh pr checks "$PR" 2>/dev/null | awk -v name="$1" '$1 == name { print $2; exit }'
}
fail() { echo "merge-pr: refusing to merge #$PR — $1" >&2; exit 1; }

# Given a head SHA, the local branch that contains it must be exactly at that head with nothing unpushed.
# Returns 0 (safe) when there is no local branch at this head, or when the branch tip equals the head and
# is not ahead of origin. Returns 1 with a reason on stderr otherwise. Pure git — no API — so it is
# testable in a local repo (see test-merge-guard.sh).
branch_at_head() {
	head="$1"
	branch="$(git branch --contains "$head" --format '%(refname:short)' 2>/dev/null | head -n1)"
	[ -n "$branch" ] && {
		ahead="$(git rev-list --count "refs/remotes/origin/$branch..$branch" 2>/dev/null || echo 1)"
		[ "$ahead" -eq 0 ] || { echo "branch $branch has $ahead unpushed commit(s)"; return 1; }
		local_tip="$(git rev-parse "$branch" 2>/dev/null)"
		[ "$local_tip" = "$head" ] || { echo "head is not the tip of $branch"; return 1; }
	}
	return 0
}

# Refuse to arm or merge a PR whose head is not the tip of the local branch it was opened from. Arming
# auto-merge while checks are pending and then pushing more commits to the branch does NOT disarm it, so
# the PR would merge at the older head once those checks pass (that is how #221 and #225 orphaned later
# commits).
merge_guard() {
	head="$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)"
	[ -n "$head" ] || { fail "could not read the PR head"; }
	msg="$(branch_at_head "$head")" || fail "$msg"
}

state_check="$(check_state check)"
state_leaks="$(check_state gitleaks)"
echo "merge-pr #$PR: check=$state_check gitleaks=$state_leaks"

# Can't read the states (PR not found, API error): refuse rather than guess.
if [ -z "$state_check" ] || [ -z "$state_leaks" ]; then
	fail "could not read the check states for PR #$PR"
fi

# Red: refuse.
case "$state_check $state_leaks" in
	*fail*) fail "a required check is red (check=$state_check gitleaks=$state_leaks)" ;;
esac

# The PR head must be the tip of the local branch (nothing unpushed), else a later push would be orphaned.
merge_guard

# Still running: arm auto-merge; it lands once both are green.
case "$state_check $state_leaks" in
	*pending*)
		head="$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)"
		echo "merge-pr: checks still running — arming auto-merge on head $head (merges once check + gitleaks are green)"
		echo "merge-pr: if you push to the branch now, first run: gh pr merge $PR --disable-auto"
		gh pr merge "$PR" --auto --squash
		exit 0
		;;
esac

# Both must be green to merge now.
if [ "$state_check" != "pass" ] || [ "$state_leaks" != "pass" ]; then
	fail "checks are not both green (check=$state_check gitleaks=$state_leaks)"
fi

gh pr merge "$PR" --squash
sh "$(dirname "$0")/sync-dev-next.sh"
