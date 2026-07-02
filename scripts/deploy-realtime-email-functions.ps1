[CmdletBinding()]
param(
  [string]$ProjectRef,
  [string[]]$Functions = @('app-rpc', 'order-placement', 'payment-verification', 'paystack-webhook')
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'
$functionsEnv = Join-Path $repoRoot 'functions\.env'

if (-not (Test-Path -LiteralPath $supabaseCli)) {
  throw 'Supabase CLI was not found at node_modules\.bin\supabase.cmd. Run npm install at the repo root first.'
}

function Read-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    if ($trimmed -notmatch '^\s*([^=]+)=(.*)\s*$') {
      continue
    }

    $candidateKey = $matches[1].Trim()
    if ($candidateKey -ne $Key) {
      continue
    }

    $rawValue = $matches[2].Trim()
    if (
      ($rawValue.StartsWith('"') -and $rawValue.EndsWith('"')) -or
      ($rawValue.StartsWith("'") -and $rawValue.EndsWith("'"))
    ) {
      return $rawValue.Substring(1, $rawValue.Length - 2)
    }

    return $rawValue
  }

  return $null
}

function Sync-SupabaseSecrets {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,
    [Parameter(Mandatory = $true)]
    [string]$EnvPath,
    [Parameter(Mandatory = $true)]
    [hashtable[]]$Mappings
  )

  $secretPairs = New-Object System.Collections.Generic.List[string]

  foreach ($mapping in $Mappings) {
    $key = $mapping.Key
    $aliases = @($mapping.Aliases)
    $value = Read-DotEnvValue -Path $EnvPath -Key $key

    if ([string]::IsNullOrWhiteSpace($value)) {
      foreach ($alias in $aliases) {
        $value = Read-DotEnvValue -Path $EnvPath -Key $alias
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          break
        }
      }
    }

    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $secretPairs.Add("$key=$value")
    }
  }

  if ($secretPairs.Count -eq 0) {
    Write-Host "No deploy secrets were found in $EnvPath. Skipping secret sync." -ForegroundColor DarkYellow
    return
  }

  Write-Host "Syncing $($secretPairs.Count) Supabase secrets from functions/.env ..." -ForegroundColor Cyan
  & $supabaseCli secrets set @secretPairs --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to sync Supabase secrets.'
  }
}

$resolvedProjectRef = $ProjectRef
if ([string]::IsNullOrWhiteSpace($resolvedProjectRef)) {
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

Sync-SupabaseSecrets -ProjectRef $resolvedProjectRef -EnvPath $functionsEnv -Mappings @(
  @{ Key = 'SUPABASE_URL'; Aliases = @('SUPABASE_URL') },
  @{ Key = 'SUPABASE_ANON_KEY'; Aliases = @('SUPABASE_ANON_KEY') },
  @{ Key = 'SUPABASE_SERVICE_ROLE_KEY'; Aliases = @('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY') },
  @{ Key = 'SUPABASE_JWT_SECRET'; Aliases = @('SUPABASE_JWT_SECRET', 'JWT_SECRET') },
  @{ Key = 'SUPABASE_PROJECT_REF'; Aliases = @('SUPABASE_PROJECT_REF') },
  @{ Key = 'PAYSTACK_SECRET_KEY'; Aliases = @('PAYSTACK_SECRET_KEY') },
  @{ Key = 'PAYSTACK_PUBLIC_KEY'; Aliases = @('PAYSTACK_PUBLIC_KEY') },
  @{ Key = 'PAYSTACK_CALLBACK_URL'; Aliases = @('PAYSTACK_CALLBACK_URL') },
  @{ Key = 'RESEND_API_KEY'; Aliases = @('RESEND_API_KEY') },
  @{ Key = 'TRANSACTIONAL_EMAIL_FROM'; Aliases = @('TRANSACTIONAL_EMAIL_FROM') }
)

foreach ($functionName in $Functions) {
  Write-Host "Deploying $functionName to $resolvedProjectRef ..." -ForegroundColor Cyan
  & $supabaseCli functions deploy $functionName --project-ref $resolvedProjectRef
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to deploy $functionName."
  }
}

Write-Host 'All functions deployed.' -ForegroundColor Green
Write-Host 'Reminder: keep functions/.env current before deploying so secrets stay in sync.' -ForegroundColor Yellow
