#!/usr/bin/env bash
# Retry a check command on browser-launch (infra) failures only, never on assertion failures.
#
# A check that fails an assertion prints a clean marker ("… FAILED", "… checks failed", "leak finding(s)")
# and exits 1 with no stack trace — that is a real failure and must not be retried. A check whose browser
# fails to launch throws a node stack trace with a Playwright launch error — that is infra and is retried.
#
# Usage: ci-check.sh <label> <command...>
#   bash scripts/ci-check.sh standalone "pnpm check:standalone"
#   bash scripts/ci-check.sh theme-nav "pnpm check:theme && pnpm check:navigation"
set -uo pipefail

label="$1"
shift
script="$*"
log="$label.log"
max=3
infra_re='browserType\.launch:|Executable doesn.t exist|Failed to launch chromium|spawn [^ ]*ENOENT'

attempt=1
while [ "$attempt" -le "$max" ]; do
  echo "::group::$label (attempt $attempt/$max)"
  bash -c "$script" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then
    exit 0
  fi
  if grep -Eq "$infra_re" "$log"; then
    echo "$label: browser-launch (infra) failure; retrying in 5s"
    attempt=$((attempt + 1))
    sleep 5
    continue
  fi
  echo "$label: non-infra failure (assertion or other); not retrying"
  exit "$rc"
done
echo "$label: exhausted $max attempts on infra failures"
exit 1
