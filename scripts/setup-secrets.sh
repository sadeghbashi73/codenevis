#!/usr/bin/env bash
#
# Interactive setup for the three agent API keys.
#
# Keys are written straight into GitHub Actions secrets through the `gh` CLI —
# they are never written to disk, never echoed, and never committed. GitHub
# encrypts them and masks them in workflow logs.
#
#   ./scripts/setup-secrets.sh
#
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "The GitHub CLI is required: https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not signed in. Run: gh auth login" >&2
  exit 1
fi

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "Repository: $REPO"
echo

set_secret() {
  local name="$1" label="$2" value
  printf '%s\n' "$label"
  read -rsp "  $name (leave empty to skip): " value
  echo
  if [[ -z "$value" ]]; then
    echo "  skipped"
  else
    gh secret set "$name" --repo "$REPO" --body "$value"
    echo "  set"
  fi
  echo
}

echo "Each agent uses its own API key, so you can give them different"
echo "providers, different models, and separate rate limits and billing."
echo "Set CODENEVIS_API_KEY instead if you would rather use one key for all three."
echo

set_secret PO_API_KEY  "Product Owner agent — writes the PRD and the backlog"
set_secret DEV_API_KEY "Developer agent — writes the code"
set_secret QC_API_KEY  "QC agent — reviews and merges"
set_secret CODENEVIS_API_KEY "Shared fallback, used only where a dedicated key is missing"

echo "Optional: a personal access token with 'repo' and 'workflow' scopes."
echo "Without it the pipeline still works; with it the agents' commits can"
echo "trigger other workflows, and QC can post a real approval instead of a comment."
set_secret GH_PAT "Personal access token"

echo "Current secrets:"
gh secret list --repo "$REPO"

echo
echo "Optional per-agent overrides, set as repository variables:"
echo "  gh variable set DEV_MODEL    --repo $REPO --body 'claude-opus-5'"
echo "  gh variable set QC_PROVIDER  --repo $REPO --body 'openai'"
echo "  gh variable set QC_BASE_URL  --repo $REPO --body 'https://openrouter.ai/api/v1'"
echo
echo "Done. Open an issue with the 'Project brief' template to start a project."
