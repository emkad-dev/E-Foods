#!/usr/bin/env bash
# Usage: gh auth login (interactive) or set GH_TOKEN env for non-interactive
# Example: GH_TOKEN=... ./gh_set_secrets.sh

set -euo pipefail

# Required secrets to set (update values or export env vars before running):
SECRETS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "PAYSTACK_SECRET_KEY"
  "PAYSTACK_PUBLIC_KEY"
  "PAYSTACK_CALLBACK_URL"
  "SUPABASE_ACCESS_TOKEN"
  "SUPABASE_PROJECT_REF"
  "VERCEL_TOKEN"
  "VERCEL_ORG_ID"
  "VERCEL_PROJECT_ID"
)

for name in "${SECRETS[@]}"; do
  val="${!name:-}"
  if [ -z "$val" ]; then
    echo "Secret $name not provided as env var; skipping. To set, export $name and rerun."
  else
    echo "Setting secret $name via gh..."
    gh secret set "$name" --body "$val"
  fi
done

echo "Done. Verify in GitHub -> Settings -> Secrets & variables -> Actions."
