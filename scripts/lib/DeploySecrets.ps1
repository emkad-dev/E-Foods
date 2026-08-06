# Shared helpers for the Supabase Edge Function deploy scripts
# (deploy-function.ps1, deploy-realtime-email-functions.ps1,
# deploy-app-rpc.ps1). Dot-source this file rather than duplicating the
# logic - it used to be copy-pasted, which is how the secrets-sync footgun
# (see Sync-SupabaseSecrets below) stayed inconsistent between scripts long
# enough to clobber live Paystack keys with placeholders.

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

function Resolve-SupabaseProjectRef {
  param(
    [string]$ProjectRef,
    [Parameter(Mandatory = $true)]
    [string]$EnvPath,
    [switch]$AllowUnresolved
  )

  $resolved = $ProjectRef
  if ([string]::IsNullOrWhiteSpace($resolved) -and (Test-Path -LiteralPath $EnvPath)) {
    $match = Select-String -LiteralPath $EnvPath -Pattern '^SUPABASE_PROJECT_REF="?([^"\r\n]+)"?$' | Select-Object -First 1
    if ($match) {
      $resolved = $match.Matches[0].Groups[1].Value.Trim()
    }
  }

  if ([string]::IsNullOrWhiteSpace($resolved)) {
    if ($AllowUnresolved) {
      return '<unresolved-project-ref>'
    }
    throw "Missing Supabase project ref. Pass -ProjectRef or set SUPABASE_PROJECT_REF in $EnvPath."
  }

  return $resolved
}

# Re-syncs functions/.env into Supabase secrets. This is deliberately NOT
# called automatically by any script anymore - it is opt-in via -SyncSecrets
# on the caller, because re-syncing on every deploy has clobbered live
# Paystack keys with placeholder values before (functions/.env locally can
# lag behind, or hold sandbox/placeholder values, while the live project has
# the real ones). Callers must pass -SyncSecrets explicitly to reach this.
function Sync-SupabaseSecrets {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseCli,
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,
    [Parameter(Mandatory = $true)]
    [string]$EnvPath,
    [hashtable[]]$Mappings
  )

  if (-not $Mappings) {
    $Mappings = @(
      @{ Key = 'SUPABASE_URL'; Aliases = @('SUPABASE_URL') },
      @{ Key = 'SUPABASE_ANON_KEY'; Aliases = @('SUPABASE_ANON_KEY') },
      @{ Key = 'SUPABASE_SERVICE_ROLE_KEY'; Aliases = @('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY') },
      @{ Key = 'SUPABASE_JWT_SECRET'; Aliases = @('SUPABASE_JWT_SECRET', 'JWT_SECRET') },
      @{ Key = 'SUPABASE_PROJECT_REF'; Aliases = @('SUPABASE_PROJECT_REF') },
      @{ Key = 'PAYSTACK_SECRET_KEY'; Aliases = @('PAYSTACK_SECRET_KEY') },
      @{ Key = 'PAYSTACK_PUBLIC_KEY'; Aliases = @('PAYSTACK_PUBLIC_KEY') },
      @{ Key = 'PAYSTACK_CALLBACK_URL'; Aliases = @('PAYSTACK_CALLBACK_URL') },
      @{ Key = 'RESEND_API_KEY'; Aliases = @('RESEND_API_KEY') },
      @{ Key = 'TRANSACTIONAL_EMAIL_FROM'; Aliases = @('TRANSACTIONAL_EMAIL_FROM') },
      @{ Key = 'CDN_BASE_URL'; Aliases = @('CDN_BASE_URL') }
    )
  }

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

  Write-Host "Syncing $($secretPairs.Count) Supabase secrets from $EnvPath ..." -ForegroundColor Cyan
  & $SupabaseCli secrets set @secretPairs --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to sync Supabase secrets.'
  }
}

# Single source of truth for every deployable Supabase Edge Function slug in
# this repo. deploy-function.ps1 refuses anything not on this list so a typo
# in a function name can never silently create a new function slug or
# deploy to the wrong target.
function Get-KnownFunctionNames {
  return @(
    'app-rpc',
    'auth-gateway',
    'broadcast-runner',
    'feasty-account',
    'feasty-admin',
    'feasty-dispatch',
    'feasty-orders',
    'feasty-partner',
    'notifications',
    'order-placement',
    'payment-verification',
    'paystack-webhook',
    'public-catalog',
    'queue-drainer',
    'unsubscribe'
  )
}
