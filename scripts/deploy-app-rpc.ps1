[CmdletBinding()]
param(
  [string]$ProjectRef,

  # Passed straight through to deploy-realtime-email-functions.ps1. Off by
  # default - see that script for why re-syncing secrets on every deploy is
  # opt-in now.
  [switch]$SyncSecrets
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $repoRoot 'scripts\deploy-realtime-email-functions.ps1'

if (-not (Test-Path -LiteralPath $deployScript)) {
  throw 'The shared deploy helper was not found at scripts\deploy-realtime-email-functions.ps1.'
}

& $deployScript -ProjectRef $ProjectRef -Functions @('app-rpc') -SyncSecrets:$SyncSecrets
