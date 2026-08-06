[CmdletBinding()]
param(
  [string]$ProjectRef
)

# This script has never synced Supabase secrets (that behaviour lived only
# in deploy-realtime-email-functions.ps1) - nothing to make opt-in here.
# It now delegates to deploy-function.ps1 for the actual deploy so the
# known-function-name guard applies uniformly across every deploy script.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployFunctionScript = Join-Path $PSScriptRoot 'deploy-function.ps1'
$functionsEnv = Join-Path $repoRoot 'functions\.env'

if (-not (Test-Path -LiteralPath $deployFunctionScript)) {
  throw 'scripts\deploy-function.ps1 was not found.'
}

. (Join-Path $PSScriptRoot 'lib\DeploySecrets.ps1')

$resolvedProjectRef = Resolve-SupabaseProjectRef -ProjectRef $ProjectRef -EnvPath $functionsEnv

& $deployFunctionScript -Name 'payment-verification' -ProjectRef $resolvedProjectRef
& $deployFunctionScript -Name 'paystack-webhook' -ProjectRef $resolvedProjectRef

Write-Host ''
Write-Host 'Paystack function deploy complete.' -ForegroundColor Green
Write-Host "Webhook URL: https://$resolvedProjectRef.supabase.co/functions/v1/paystack-webhook"
