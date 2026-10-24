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

# run_gitleaks <args...>: fails closed (non-zero) on findings, scan errors, or a missing gitleaks.
run_gitleaks() {
	if ! command -v gitleaks >/dev/null 2>&1; then
		echo "gitleaks not found (brew install gitleaks). Failing closed." >&2
		return 1
	fi
	dir=$(clean_git_dir) || dir=""
	out=$(PATH="$dir:$PATH" gitleaks "$@" --no-banner --no-color --redact -v 2>&1)
	rc=$?
	case "$out" in
		*" ERR "*) rc=1; out="$out
scan error (see ERR above) - failing closed." ;;
	esac
	[ "$rc" -ne 0 ] && printf '%s\n' "$out" >&2
	return "$rc"
}
