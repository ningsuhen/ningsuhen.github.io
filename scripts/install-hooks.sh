#!/bin/sh
# Installs .githooks/* into this repo's .git/hooks (the global core.hooksPath chains to them).
# Runs on `pnpm install` via the `prepare` script. Safe to re-run; no-op outside a git checkout.
git rev-parse --git-common-dir >/dev/null 2>&1 || exit 0
dest="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$dest"
for hook in .githooks/*; do
	name=$(basename "$hook")
	cp "$hook" "$dest/$name" && chmod +x "$dest/$name"
done
echo "git hooks installed: $(ls .githooks | tr '\n' ' ')"
