#!/bin/zsh
# Entry point for the always-on dev server (LaunchAgent com.ningsuhen.github-io.dev).
# Serves whatever branch is checked out in the project root, with live reload, on http://127.0.0.1:4321.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 # current default node, survives upgrades
cd "${0:A:h}/.." || exit 1
exec pnpm dev --host 127.0.0.1 --port 4321
