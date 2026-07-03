[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$Email,

  [string]$DisplayName,

  [string]$ProjectRef,

  [string]$SupabaseUrl,

  [string]$ServiceRoleKey,

  [switch]$ForcePromote
)

$ErrorActionPreference = 'Stop'

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

function Resolve-ConfigValue {
  param(
    [string[]]$Values
  )

  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }

  return $null
}

function Invoke-SupabaseJsonRequest {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('GET', 'POST', 'PATCH', 'PUT')]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [Parameter(Mandatory = $true)]
    [hashtable]$Headers,
    [object]$Body,
    [switch]$AllowNotFound
  )

  $requestParams = @{
    Method      = $Method
    Uri         = $Uri
    Headers     = $Headers
    ContentType = 'application/json'
  }

  if ($PSBoundParameters.ContainsKey('Body')) {
    $requestParams.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
  }

  try {
    return Invoke-RestMethod @requestParams
  } catch {
    $response = $_.Exception.Response
    if ($AllowNotFound -and $response -and [int]$response.StatusCode -eq 404) {
      return $null
    }

    if ($response) {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $payload = $reader.ReadToEnd()
      throw "Supabase request failed ($Method $Uri): HTTP $([int]$response.StatusCode) $payload"
    }

    throw
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$appsEnvPath = Join-Path $repoRoot '.env.apps'
$functionsEnvPath = Join-Path $repoRoot 'functions\.env'

$resolvedProjectRef = Resolve-ConfigValue @(
  $ProjectRef,
  $env:EXPO_PUBLIC_SUPABASE_PROJECT_REF,
  (Read-DotEnvValue -Path $appsEnvPath -Key 'EXPO_PUBLIC_SUPABASE_PROJECT_REF'),
  $env:SUPABASE_PROJECT_REF,
  (Read-DotEnvValue -Path $functionsEnvPath -Key 'SUPABASE_PROJECT_REF')
)

$resolvedSupabaseUrl = Resolve-ConfigValue @(
  $SupabaseUrl,
  $env:EXPO_PUBLIC_SUPABASE_URL,
  (Read-DotEnvValue -Path $appsEnvPath -Key 'EXPO_PUBLIC_SUPABASE_URL'),
  $env:SUPABASE_URL,
  (Read-DotEnvValue -Path $functionsEnvPath -Key 'SUPABASE_URL')
)

$resolvedServiceRoleKey = Resolve-ConfigValue @(
  $ServiceRoleKey,
  $env:SERVICE_ROLE_KEY,
  (Read-DotEnvValue -Path $functionsEnvPath -Key 'SERVICE_ROLE_KEY')
)

if (-not $resolvedProjectRef) {
  throw 'Missing Supabase project ref. Pass -ProjectRef or set EXPO_PUBLIC_SUPABASE_PROJECT_REF / SUPABASE_PROJECT_REF.'
}

if (-not $resolvedSupabaseUrl) {
  $resolvedSupabaseUrl = "https://$resolvedProjectRef.supabase.co"
}

if (-not $resolvedServiceRoleKey) {
  throw 'Missing SERVICE_ROLE_KEY. Pass -ServiceRoleKey or set it in functions/.env.'
}

$normalizedEmail = $Email.Trim().ToLowerInvariant()
$baseHeaders = @{
  apikey        = $resolvedServiceRoleKey
  Authorization = "Bearer $resolvedServiceRoleKey"
}

Write-Host "Looking up Supabase auth user for $normalizedEmail ..."

$authUsers = @()
$page = 1
do {
  $payload = Invoke-SupabaseJsonRequest `
    -Method GET `
    -Uri "$($resolvedSupabaseUrl.TrimEnd('/'))/auth/v1/admin/users?page=$page&per_page=200" `
    -Headers $baseHeaders

  $batch = @($payload.users)
  $authUsers += $batch
  $page += 1
} while ($batch.Count -ge 200)

$targetUser = $authUsers | Where-Object { $_.email -and $_.email.ToString().Trim().ToLowerInvariant() -eq $normalizedEmail } | Select-Object -First 1

if (-not $targetUser) {
  throw "No Supabase auth user exists for $normalizedEmail. Create the account first, then rerun this script."
}

$uid = $targetUser.id.ToString()
$resolvedDisplayName = Resolve-ConfigValue @(
  $DisplayName,
  $targetUser.user_metadata.full_name,
  $targetUser.user_metadata.display_name,
  $targetUser.email.ToString().Split('@')[0]
)

if (-not $ForcePromote) {
  Write-Host 'Checking whether an admin already exists ...'
  $existingAdmins = Invoke-SupabaseJsonRequest `
    -Method GET `
    -Uri "$($resolvedSupabaseUrl.TrimEnd('/'))/rest/v1/UserRole?select=userId,role&role=eq.admin&limit=1" `
    -Headers ($baseHeaders + @{ Accept = 'application/json' })

  if (@($existingAdmins).Count -gt 0) {
    throw 'An admin role already exists. Use -ForcePromote only if you intentionally want to promote another account from the IDE.'
  }
}

$userAccountBody = @{
  uid                  = $uid
  email                = $normalizedEmail
  displayName          = $resolvedDisplayName
  emailVerified        = [bool]$targetUser.email_confirmed_at
  roleDisplay          = 'admin'
  accountDisabled      = $false
  disabledAt           = $null
  disabledByUid        = $null
  lastPrivilegedRole   = 'admin'
}

$userRoleBody = @{
  id           = ([guid]::NewGuid().ToString())
  userId       = $uid
  role         = 'admin'
  assignedByUid = $uid
}

$mergedMetadata = @{}
if ($targetUser.app_metadata) {
  foreach ($property in $targetUser.app_metadata.PSObject.Properties) {
    $mergedMetadata[$property.Name] = $property.Value
  }
}
$mergedMetadata.app_role = 'admin'
$mergedMetadata.role = 'admin'
$mergedMetadata.user_role = 'admin'

if ($PSCmdlet.ShouldProcess($normalizedEmail, 'Promote user to admin in Supabase auth and SQL tables')) {
  Write-Host 'Upserting UserAccount ...'
  Invoke-SupabaseJsonRequest `
    -Method POST `
    -Uri "$($resolvedSupabaseUrl.TrimEnd('/'))/rest/v1/UserAccount?on_conflict=uid" `
    -Headers ($baseHeaders + @{
      Accept = 'application/json'
      Prefer = 'resolution=merge-duplicates,return=representation'
    }) `
    -Body @($userAccountBody) | Out-Null

  Write-Host 'Upserting UserRole ...'
  Invoke-SupabaseJsonRequest `
    -Method POST `
    -Uri "$($resolvedSupabaseUrl.TrimEnd('/'))/rest/v1/UserRole?on_conflict=userId,role" `
    -Headers ($baseHeaders + @{
      Accept = 'application/json'
      Prefer = 'resolution=merge-duplicates,return=representation'
    }) `
    -Body @($userRoleBody) | Out-Null

  Write-Host 'Updating Supabase auth app_metadata ...'
  Invoke-SupabaseJsonRequest `
    -Method PUT `
    -Uri "$($resolvedSupabaseUrl.TrimEnd('/'))/auth/v1/admin/users/$uid" `
    -Headers $baseHeaders `
    -Body @{
      app_metadata = $mergedMetadata
    } | Out-Null

  Write-Host ''
  Write-Host "Admin promotion complete for $normalizedEmail" -ForegroundColor Green
  Write-Host "UID: $uid"
  Write-Host 'Next: sign out of the admin app, restart it, and sign in again so the refreshed admin claim is loaded.'
}
