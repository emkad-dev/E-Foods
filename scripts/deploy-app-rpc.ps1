[CmdletBinding()]
param(
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $repoRoot 'scripts\deploy-realtime-email-functions.ps1'

if (-not (Test-Path -LiteralPath $deployScript)) {
  throw 'The shared deploy helper was not found at scripts\deploy-realtime-email-functions.ps1.'
}

& $deployScript -ProjectRef $ProjectRef -Functions @('app-rpc')
