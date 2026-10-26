#!/bin/sh
# Squash-merges a PR into master, then syncs the local dev/next mirror. Usage: pnpm merge-pr <number>
#
# Guard: a merge only goes through when the PR's `check` and `gitleaks` are green on its current head.
# Branch protection does NOT enforce this for admin merges — `enforce_admins` is off and every session
# uses the owner's admin token — so a bare `gh pr merge` lands a red PR (that is how #210 merged with a
# red `check`). This script refuses a red PR and arms auto-merge (--auto) while the checks are still
# running, so the merge happens only once both are green.
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

# Still running: arm auto-merge; it lands once both are green.
case "$state_check $state_leaks" in
	*pending*)
		echo "merge-pr: checks still running — arming auto-merge (merges once check + gitleaks are green)"
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
