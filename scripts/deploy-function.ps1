# Deploys exactly one Supabase Edge Function by name.
#
# This is the canonical single-function deploy tool: it refuses any name not
# on the known list (Get-KnownFunctionNames in scripts\lib\DeploySecrets.ps1)
# so a typo can never create a new function slug or deploy to the wrong
# target, and it never touches Supabase secrets unless you explicitly pass
# -SyncSecrets (see scripts\lib\DeploySecrets.ps1 for why that default
# matters - the old blanket-sync behaviour has clobbered live Paystack keys
# with placeholders before).
#
# Usage:
#   .\scripts\deploy-function.ps1 feasty-orders
#   .\scripts\deploy-function.ps1 -Name feasty-orders -ProjectRef abcdEFGH -SyncSecrets
#   .\scripts\deploy-function.ps1 feasty-orders -DryRun   # validates only, deploys nothing

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Name,

  [string]$ProjectRef,

  [switch]$SyncSecrets,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\DeploySecrets.ps1')

$knownFunctions = Get-KnownFunctionNames
# -cnotcontains, not -notcontains: PowerShell's default comparison operators
# are case-INsensitive, so 'App-RPC' or 'FEASTY-Orders' would otherwise pass
# this guard, resolve against Windows' case-insensitive filesystem, and get
# deployed under a slug nothing in the app actually routes to - while the
# real function silently stays on its old version. The comment two lines
# down promised that can't happen; -notcontains is exactly how it could.
if ($knownFunctions -cnotcontains $Name) {
  throw "Unknown function '$Name'. Known functions: $($knownFunctions -join ', '). Refusing to deploy - check for a typo (including case - function names are matched case-sensitively), or add it to Get-KnownFunctionNames in scripts\lib\DeploySecrets.ps1 if it is genuinely new."
}

$supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'
if (-not (Test-Path -LiteralPath $supabaseCli)) {
  throw 'Supabase CLI was not found at node_modules\.bin\supabase.cmd. Run npm install at the repo root first.'
}

$functionsEnv = Join-Path $repoRoot 'functions\.env'
$resolvedProjectRef = Resolve-SupabaseProjectRef -ProjectRef $ProjectRef -EnvPath $functionsEnv -AllowUnresolved:$DryRun

if ($SyncSecrets) {
  if ($DryRun) {
    Write-Host "[DryRun] Would sync Supabase secrets from $functionsEnv to project '$resolvedProjectRef'." -ForegroundColor Cyan
  } else {
    Sync-SupabaseSecrets -SupabaseCli $supabaseCli -ProjectRef $resolvedProjectRef -EnvPath $functionsEnv
  }
} else {
  Write-Host 'Skipping secret sync (pass -SyncSecrets to sync functions/.env to Supabase secrets). This is deliberate: syncing on every deploy has clobbered live keys before.' -ForegroundColor DarkYellow
}

# --use-api matches every CI deploy path (deploy.yml, deploy-feasty-*.yml).
# Without it, a local deploy can take a different upload path that does not
# apply supabase/config.toml's per-function verify_jwt settings - which
# would be silent and dangerous for a function like unsubscribe (must stay
# verify_jwt = false; see config.toml) if someone ran this script locally.
# --yes skips the interactive confirmation prompt, matching CI's non-interactive use.
if ($DryRun) {
  Write-Host "[DryRun] Would run: $supabaseCli functions deploy $Name --project-ref $resolvedProjectRef --use-api --yes" -ForegroundColor Cyan
  Write-Host "[DryRun] '$Name' is a known function. Validation passed; nothing was deployed." -ForegroundColor Green
  exit 0
}

Write-Host "Deploying $Name to $resolvedProjectRef ..." -ForegroundColor Cyan
& $supabaseCli functions deploy $Name --project-ref $resolvedProjectRef --use-api --yes
if ($LASTEXITCODE -ne 0) {
  throw "Failed to deploy $Name."
}

Write-Host "$Name deployed." -ForegroundColor Green
