[CmdletBinding()]
param(
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'

if (-not (Test-Path -LiteralPath $supabaseCli)) {
  throw 'Supabase CLI was not found at node_modules\.bin\supabase.cmd. Run npm install at the repo root first.'
}

$resolvedProjectRef = $ProjectRef
if ([string]::IsNullOrWhiteSpace($resolvedProjectRef)) {
  $functionsEnv = Join-Path $repoRoot 'functions\.env'
  if (Test-Path -LiteralPath $functionsEnv) {
    $match = Select-String -Path $functionsEnv -Pattern '^SUPABASE_PROJECT_REF="?([^"\r\n]+)"?$' | Select-Object -First 1
    if ($match) {
      $resolvedProjectRef = $match.Matches[0].Groups[1].Value.Trim()
    }
  }
}

if ([string]::IsNullOrWhiteSpace($resolvedProjectRef)) {
  throw 'Missing Supabase project ref. Pass -ProjectRef or set SUPABASE_PROJECT_REF in functions/.env.'
}

Write-Host "Deploying payment-verification to $resolvedProjectRef ..." -ForegroundColor Cyan
& $supabaseCli functions deploy payment-verification --project-ref $resolvedProjectRef
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to deploy payment-verification.'
}

Write-Host "Deploying paystack-webhook to $resolvedProjectRef ..." -ForegroundColor Cyan
& $supabaseCli functions deploy paystack-webhook --project-ref $resolvedProjectRef
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to deploy paystack-webhook.'
}

Write-Host ''
Write-Host 'Paystack function deploy complete.' -ForegroundColor Green
Write-Host "Webhook URL: https://$resolvedProjectRef.supabase.co/functions/v1/paystack-webhook"
