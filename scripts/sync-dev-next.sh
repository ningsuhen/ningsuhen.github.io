#!/bin/sh
# Local-only sync: keeps branch dev/next at origin/master (a mirror for local preview, never a PR base, never pushed),
# checks it out in the primary checkout when that is clean, and deletes local branches already merged into origin/master.
# Usage: pnpm sync
set -eu
set -f

upstream=origin/master
zero=0000000000000000000000000000000000000000
worktrees=$(git worktree list --porcelain)
primary=$(printf '%s\n' "$worktrees" | awk '/^worktree /{print substr($0, 10); exit}')
dev_wt=$(printf '%s\n' "$worktrees" | awk '/^worktree /{p=substr($0, 10)} /^branch refs\/heads\/dev\/next$/{print p}')
busy=$(printf '%s\n' "$worktrees" | awk '/^branch /{sub("refs/heads/", "", $2); printf "%s ", $2}')

git fetch --quiet origin
git rev-parse --verify --quiet "$upstream" >/dev/null || { echo "sync: $upstream is missing; run git fetch origin" >&2; exit 1; }
target=$(git rev-parse "$upstream")

if ! git rev-parse --verify --quiet refs/heads/dev/next >/dev/null; then
	git branch dev/next "$target"
	echo "created local dev/next at $upstream"
fi

tip=$(git rev-parse refs/heads/dev/next)
if [ "$tip" != "$target" ]; then
	if ! git merge-base --is-ancestor "$tip" "$target"; then
		echo "sync: refusing to move dev/next: it has local commits that are not on $upstream:" >&2
		git log --oneline "$target..$tip" | sed 's/^/  /' >&2
		echo "Move them to a branch (git branch <name> dev/next), then rerun pnpm sync." >&2
		exit 1
	fi
	if [ -n "$dev_wt" ]; then
		if [ -n "$(git -C "$dev_wt" status --porcelain)" ]; then
			echo "sync: dev/next has uncommitted changes in $dev_wt; commit or stash them, then rerun pnpm sync." >&2
			exit 1
		fi
		git -C "$dev_wt" merge --ff-only --quiet "$upstream"
	else
		# Compare-and-swap: fails if dev/next moved since we read it.
		git update-ref refs/heads/dev/next "$target" "$tip"
	fi
	echo "fast-forwarded dev/next to $upstream"
fi

# Switch the primary checkout to dev/next when it is clean and dev/next is not checked out elsewhere.
if [ -z "$dev_wt" ] && [ -z "$(git -C "$primary" status --porcelain)" ]; then
	git -C "$primary" switch --quiet dev/next
	echo "switched $primary to dev/next"
fi

deleted=0
for b in $(git branch --merged "$upstream" --format='%(refname:short)'); do
	case "$b" in master | dev/next) continue ;; esac
	case " $busy" in *" $b "*) continue ;; esac
	if git branch -d "$b" >/dev/null 2>&1; then
		echo "deleted merged branch $b"
		deleted=$((deleted + 1))
	else
		echo "kept $b (not fully merged)"
	fi
done
echo "sync done: dev/next=$(git rev-parse --short refs/heads/dev/next), $deleted merged branch(es) deleted"
