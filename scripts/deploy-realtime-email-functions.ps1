[CmdletBinding()]
param(
  [string]$ProjectRef,
  [string[]]$Functions = @('app-rpc', 'order-placement', 'payment-verification', 'paystack-webhook'),

  # Secrets sync is opt-in. It used to run unconditionally on every deploy,
  # re-writing every Supabase secret from functions/.env - which has
  # clobbered live Paystack keys with placeholder values when functions/.env
  # locally held sandbox values. Pass -SyncSecrets when you specifically mean
  # to push functions/.env's values to the live project.
  [switch]$SyncSecrets
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployFunctionScript = Join-Path $PSScriptRoot 'deploy-function.ps1'
$functionsEnv = Join-Path $repoRoot 'functions\.env'

if (-not (Test-Path -LiteralPath $deployFunctionScript)) {
  throw 'scripts\deploy-function.ps1 was not found.'
}

. (Join-Path $PSScriptRoot 'lib\DeploySecrets.ps1')

$resolvedProjectRef = Resolve-SupabaseProjectRef -ProjectRef $ProjectRef -EnvPath $functionsEnv

if ($SyncSecrets) {
  $supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'
  if (-not (Test-Path -LiteralPath $supabaseCli)) {
    throw 'Supabase CLI was not found at node_modules\.bin\supabase.cmd. Run npm install at the repo root first.'
  }
  Sync-SupabaseSecrets -SupabaseCli $supabaseCli -ProjectRef $resolvedProjectRef -EnvPath $functionsEnv
} else {
  Write-Host 'Skipping secret sync (pass -SyncSecrets to sync functions/.env to Supabase secrets). This is deliberate: syncing on every deploy has clobbered live keys before.' -ForegroundColor DarkYellow
}

foreach ($functionName in $Functions) {
  & $deployFunctionScript -Name $functionName -ProjectRef $resolvedProjectRef
}

Write-Host 'All functions deployed.' -ForegroundColor Green
if (-not $SyncSecrets) {
  Write-Host 'Reminder: secrets were NOT synced this run. Pass -SyncSecrets if functions/.env changed.' -ForegroundColor Yellow
}
