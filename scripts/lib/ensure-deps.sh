# Shared helper (sourced by dev-server.sh and sync-dev-next.sh): reinstall dependencies when pnpm-lock.yaml
# changed since the last install done here. Stamp: node_modules/.dev-server-lock-hash. Returns non-zero if the install fails.
ensure_deps() {
	_ed_root=$1
	_ed_stamp="$_ed_root/node_modules/.dev-server-lock-hash"
	_ed_hash=$(shasum -a 256 "$_ed_root/pnpm-lock.yaml" | awk '{print $1}')
	if [ "$(cat "$_ed_stamp" 2>/dev/null)" = "$_ed_hash" ]; then
		return 0
	fi
	echo "deps: pnpm-lock.yaml changed or stamp missing, running pnpm install --frozen-lockfile"
	(cd "$_ed_root" && pnpm install --frozen-lockfile) || return 1
	mkdir -p "$_ed_root/node_modules"
	printf '%s\n' "$_ed_hash" >"$_ed_stamp"
}
