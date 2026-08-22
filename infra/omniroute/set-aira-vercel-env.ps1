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
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command '$Name' is not installed or not on PATH."
    }
    return $command
}

function Invoke-VercelQuiet([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 promotes stderr written by native commands and
        # npm-generated *.ps1 shims to NativeCommandError when the caller uses
        # ErrorActionPreference=Stop. Vercel writes its version banner to stderr
        # even on successful commands, so treat exit code as authoritative.
        $ErrorActionPreference = 'Continue'
        & $script:VercelCommand @Arguments *> $null
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Set-VercelValue(
    [string]$Name,
    [string]$Value,
    [string]$Environment,
    [switch]$Sensitive
) {
    [void](Invoke-VercelQuiet @('env', 'rm', $Name, $Environment, '--yes'))
    # A non-zero result here normally means the variable did not exist yet.
    # The add operation below remains authoritative.

    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ($Sensitive) {
            $Value | & $script:VercelCommand env add $Name $Environment --sensitive *> $null
        }
        else {
            $Value | & $script:VercelCommand env add $Name $Environment *> $null
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0) {
        throw "Could not set Vercel environment variable '$Name'."
    }
    $suffix = if ($Sensitive) { ' [sensitive]' } else { '' }
    Write-Host "  set  $Name$suffix"
}

# Prefer the Windows npm .cmd shim when available. It avoids an extra PowerShell
# wrapper layer and behaves consistently in Windows PowerShell 5.1 and pwsh.
$vercelCmd = Get-Command 'vercel.cmd' -ErrorAction SilentlyContinue
if ($vercelCmd) {
    $script:VercelCommand = $vercelCmd.Source
}
else {
    $vercel = Require-Command 'vercel'
    $script:VercelCommand = $vercel.Source
}

if ((Invoke-VercelQuiet @('whoami')) -ne 0) {
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
$credential = New-Object System.Management.Automation.PSCredential('omniroute', $secureApiKey)
$plainApiKey = $credential.GetNetworkCredential().Password
if ([string]::IsNullOrWhiteSpace($plainApiKey)) {
    throw 'An OmniRoute API key is required.'
}

try {
    Write-Host "Applying OmniRoute variables to Vercel $Target..."
    Set-VercelValue 'OMNIROUTE_ENABLED' 'true' $Target
    Set-VercelValue 'OMNIROUTE_BASE_URL' $apiRoot $Target
    Set-VercelValue 'OMNIROUTE_API_KEY' $plainApiKey $Target -Sensitive
    Set-VercelValue 'OMNIROUTE_MODEL' 'auto' $Target
    Set-VercelValue 'OMNIROUTE_TIMEOUT_MS' '45000' $Target
    Set-VercelValue 'DEFAULT_PRO_PROVIDER' 'omniroute' $Target
    Set-VercelValue 'DEFAULT_FREE_PROVIDER' 'nvidia' $Target
    if ($Target -eq 'preview') {
        Set-VercelValue 'OMNIROUTE_PREVIEW_TEST_BYPASS' 'true' $Target
    }
    else {
        Set-VercelValue 'OMNIROUTE_PREVIEW_TEST_BYPASS' 'false' $Target
    }
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
    Write-Host 'Preview-only OmniRoute control access is enabled behind Vercel Deployment Protection.' -ForegroundColor Yellow
    Write-Host 'Create or redeploy the PR preview to validate OmniRoute before production.' -ForegroundColor Cyan
}
