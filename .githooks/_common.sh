# Shared helpers, sourced by the hooks.

# Some git wrappers log to stderr; gitleaks treats any git stderr as a failed scan and reports
# "no leaks". Resolve a git that is silent on stderr and put its directory first on PATH.
clean_git_dir() {
	old_ifs=$IFS
	IFS=:
	for dir in $PATH; do
		if [ -x "$dir/git" ] && [ -z "$("$dir/git" rev-parse --git-dir 2>&1 >/dev/null)" ]; then
			IFS=$old_ifs
			printf '%s' "$dir"
			return 0
		fi
	done
	IFS=$old_ifs
	return 1
}

# repo_config: echo "--config <repo>/.gitleaks.toml" when it exists; otherwise gitleaks' default rules apply.
repo_config() {
	cfg="$(git rev-parse --show-toplevel)/.gitleaks.toml"
	[ -f "$cfg" ] && printf -- '--config\n%s\n' "$cfg"
}

# run_gitleaks <args...>: fails closed (non-zero) on findings, scan errors, or a missing gitleaks.
run_gitleaks() {
	gl=$(command -v gitleaks 2>/dev/null || true)
	top=$(git rev-parse --show-toplevel 2>/dev/null || true)
	case "$gl" in
		"") echo "gitleaks not found (brew install gitleaks). Failing closed." >&2; return 1 ;;
		# Never run a scanner that lives inside the checkout (planted via a relative/empty PATH entry).
		"$top"/*) echo "refusing gitleaks found inside the repository ($gl). Failing closed." >&2; return 1 ;;
		/*) ;;
		*) echo "gitleaks resolved to a non-absolute path ($gl). Failing closed." >&2; return 1 ;;
	esac
	if dir=$(clean_git_dir) && [ -n "$dir" ]; then
		out=$(PATH="$dir:$PATH" "$gl" "$@" --no-banner --no-color --redact -v 2>&1)
	else
		# No stderr-clean git: run as-is; a noisy git surfaces as ERR below and fails closed.
		out=$("$gl" "$@" --no-banner --no-color --redact -v 2>&1)
	fi
	rc=$?
	case "$out" in
		*" ERR "*) rc=1; out="$out
scan error (see ERR above) - failing closed." ;;
	esac
	[ "$rc" -ne 0 ] && printf '%s\n' "$out" >&2
	return "$rc"
}

# run_local_hook <hook-name> [args...]: run a pre-existing hook that install-hooks.sh preserved as <name>.local.
run_local_hook() {
	name=$1; shift
	local_hook="$(dirname "$0")/$name.local"
	[ -x "$local_hook" ] || return 0
	"$local_hook" "$@"
}
