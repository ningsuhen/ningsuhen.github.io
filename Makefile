# Local dev helpers for ningsuhen.github.io.
# The always-on dev server is the LaunchAgent com.ningsuhen.github-io.dev; it serves the
# branch checked out in the project root on the default port 8050 (override: ASTRO_DEV_PORT).

DEV_LABEL := com.ningsuhen.github-io.dev

.PHONY: refresh build restart

# Rebuild the site, then restart the always-on dev server.
refresh: build restart

build:
	pnpm build

restart:
	launchctl kickstart -k gui/$$(id -u)/$(DEV_LABEL)
