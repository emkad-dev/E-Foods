#!/usr/bin/env bash
# Guards against shipping a client build in RPC "split" mode before the five
# domain-scoped backend Edge Functions it depends on are actually deployed.
#
# Why this exists: apps/{admin-web,customer,partner} build with
# EXPO_PUBLIC_RPC_MODE=split, which makes callBackendRpc target
# feasty-orders / feasty-dispatch / feasty-partner / feasty-admin /
# feasty-account directly instead of app-rpc (see
# packages/domain/src/rpcRoutes.ts). Those five functions deploy from their
# own path-filtered GitHub Actions workflows
# (.github/workflows/deploy-feasty-*.yml), which are separate workflow runs
# from any client's deploy workflow. GitHub Actions gives no ordering
# guarantee between independently-triggered workflows on the same push, so a
# client deploy could in principle finish (and go live) before the backend
# functions it now depends on exist - every RPC call from that build would
# fail. This script is the safety net: called as the first step of each
# client deploy workflow, it fails loudly, before any build/deploy work runs,
# if any of the five aren't answering yet.
#
# An OPTIONS request is enough to tell "deployed" from "not deployed" without
# needing a service-role key or a real payload: _shared/rpc/serve.ts answers
# any OPTIONS request with a bare 204 before any auth/dispatch logic runs
# (see createRpcHttpHandler), so a live function always answers OPTIONS with
# 204 regardless of auth state, while an undeployed function slug gets a 404
# from the Supabase gateway itself, before it ever reaches user code.

set -euo pipefail

if [ -z "${EXPO_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "verify-split-functions-live: EXPO_PUBLIC_SUPABASE_URL must be set" >&2
  exit 1
fi

FUNCTIONS=(feasty-orders feasty-dispatch feasty-partner feasty-admin feasty-account)

failed=0
for fn in "${FUNCTIONS[@]}"; do
  url="${EXPO_PUBLIC_SUPABASE_URL%/}/functions/v1/${fn}"
  status="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$url")" || status="000"
  if [ "$status" = "204" ] || [ "$status" = "200" ]; then
    echo "OK   $fn -> HTTP $status"
  else
    echo "FAIL $fn -> HTTP $status (expected 204) - not deployed yet?"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo ""
  echo "One or more split-mode backend functions are not answering yet. Deploy" >&2
  echo "them first - each has its own path-filtered workflow" >&2
  echo "(.github/workflows/deploy-feasty-*.yml, or run 'gh workflow run'), or" >&2
  echo "deploy locally with scripts/deploy-function.ps1 <name> - then re-run" >&2
  echo "this client deploy." >&2
  exit 1
fi

echo "All five split-mode backend functions are live."
