[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[^\s]+$')]
    [string]$BaseUrl,

    [ValidateSet('production', 'preview')]
    [string]$Target = 'production'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not installed or not on PATH."
    }
}

function Invoke-Vercel([string[]]$Arguments) {
    & vercel @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Vercel CLI command failed: vercel $($Arguments -join ' ')"
    }
}

function Set-VercelValue([string]$Name, [string]$Value, [string]$Environment) {
    & vercel env rm $Name $Environment --yes *> $null
    $previousExit = $LASTEXITCODE
    if ($previousExit -ne 0) {
        # The value may not exist yet; env add below is authoritative.
        $global:LASTEXITCODE = 0
    }

    $Value | & vercel env add $Name $Environment *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not set Vercel environment variable '$Name'."
    }
    Write-Host "  set  $Name"
}

Require-Command 'vercel'

& vercel whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Vercel CLI authentication is required.' -ForegroundColor Yellow
    Write-Host 'Run: vercel login' -ForegroundColor Cyan
    exit 20
}

if (-not (Test-Path '.vercel/project.json')) {
    Write-Host 'This checkout is not linked to a Vercel project.' -ForegroundColor Yellow
    Write-Host 'Run: vercel link' -ForegroundColor Cyan
    Write-Host 'Choose the existing project: aira-ai-live' -ForegroundColor Cyan
    exit 21
}

$uri = [Uri]$BaseUrl
if ($uri.Scheme -ne 'https') {
    throw 'BaseUrl must use HTTPS.'
}
if (-not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw 'BaseUrl must not contain credentials, a query string, or a fragment.'
}
$path = $uri.AbsolutePath.TrimEnd('/')
if ($path -and $path -ne '/v1') {
    throw 'BaseUrl must be the OmniRoute origin or its /v1 endpoint.'
}
$apiRoot = "$($uri.Scheme)://$($uri.Authority)/v1"

Write-Host 'Enter the dedicated OmniRoute endpoint API key for AIRA.'
$secureApiKey = Read-Host -AsSecureString 'OMNIROUTE_API_KEY'
$credential = [pscredential]::new('omniroute', $secureApiKey)
$plainApiKey = $credential.GetNetworkCredential().Password
if ([string]::IsNullOrWhiteSpace($plainApiKey)) {
    throw 'An OmniRoute API key is required.'
}

try {
    Write-Host "Applying OmniRoute variables to Vercel $Target..."
    Set-VercelValue 'OMNIROUTE_ENABLED' 'true' $Target
    Set-VercelValue 'OMNIROUTE_BASE_URL' $apiRoot $Target
    Set-VercelValue 'OMNIROUTE_API_KEY' $plainApiKey $Target
    Set-VercelValue 'OMNIROUTE_MODEL' 'auto' $Target
    Set-VercelValue 'OMNIROUTE_TIMEOUT_MS' '45000' $Target
    Set-VercelValue 'DEFAULT_PRO_PROVIDER' 'omniroute' $Target
    Set-VercelValue 'DEFAULT_FREE_PROVIDER' 'nvidia' $Target
}
finally {
    $plainApiKey = $null
    $credential = $null
    $secureApiKey = $null
}

Write-Host ''
Write-Host "OmniRoute variables are configured for Vercel $Target." -ForegroundColor Green
Write-Host 'They take effect only on a new deployment.'
if ($Target -eq 'production') {
    Write-Host 'Redeploy after PR #92 is approved/merged: vercel --prod' -ForegroundColor Cyan
}
else {
    Write-Host 'Create or redeploy the PR preview to validate OmniRoute before production.' -ForegroundColor Cyan
}
