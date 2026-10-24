#!/bin/sh
# Installs .githooks/* into this repo's .git/hooks (the global core.hooksPath chains to them).
# Runs on `pnpm install` via the `prepare` script. Safe to re-run; no-op outside a git checkout.
# An existing hook we did not install is kept as <name>.local and run first by our hook.
set -eu
git rev-parse --git-common-dir >/dev/null 2>&1 || exit 0
dest="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$dest"
for hook in .githooks/*; do
	name=$(basename "$hook")
	target="$dest/$name"
	case "$name" in
		pre-commit | pre-push)
			if [ -e "$target" ] && ! grep -q 'managed-by: scripts/install-hooks.sh' "$target"; then
				[ -e "$target.local" ] || mv "$target" "$target.local"
			fi
			;;
	esac
	cp "$hook" "$target"
	chmod +x "$target"
done
echo "git hooks installed: $(ls .githooks | tr '\n' ' ')"
