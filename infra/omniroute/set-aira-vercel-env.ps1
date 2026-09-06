[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[^\s]+$')]
    [string]$BaseUrl,

    [ValidateSet('production', 'preview')]
    [string]$Target = 'production',

    [ValidateNotNullOrEmpty()]
    [string]$Model = 'auto',

    [string]$GitBranch = ''
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
    [string]$Branch,
    [switch]$Sensitive
) {
    $scope = @($Environment)
    if (-not [string]::IsNullOrWhiteSpace($Branch)) {
        $scope += $Branch
    }

    # Prefer update so rerunning this script is idempotent. If the variable does
    # not exist at the requested environment/branch scope, fall back to add.
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $Value | & $script:VercelCommand env update $Name @scope *> $null
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            if ($Sensitive) {
                $Value | & $script:VercelCommand env add $Name @scope --sensitive *> $null
            }
            else {
                $Value | & $script:VercelCommand env add $Name @scope *> $null
            }
            $exitCode = $LASTEXITCODE
        }
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0) {
        $scopeLabel = if ($Branch) { "$Environment ($Branch)" } else { $Environment }
        throw "Could not set Vercel environment variable '$Name' for $scopeLabel."
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

if ($Target -eq 'production' -and -not [string]::IsNullOrWhiteSpace($GitBranch)) {
    throw 'GitBranch can only be used with the preview target.'
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
    $scopeLabel = if ($GitBranch) { "$Target ($GitBranch)" } else { $Target }
    Write-Host "Applying OmniRoute variables to Vercel $scopeLabel..."
    Set-VercelValue 'OMNIROUTE_ENABLED' 'true' $Target $GitBranch
    Set-VercelValue 'OMNIROUTE_BASE_URL' $apiRoot $Target $GitBranch
    Set-VercelValue 'OMNIROUTE_API_KEY' $plainApiKey $Target $GitBranch -Sensitive
    Set-VercelValue 'OMNIROUTE_MODEL' $Model $Target $GitBranch
    Set-VercelValue 'OMNIROUTE_TIMEOUT_MS' '45000' $Target $GitBranch
    Set-VercelValue 'DEFAULT_PRO_PROVIDER' 'omniroute' $Target $GitBranch
    Set-VercelValue 'DEFAULT_FREE_PROVIDER' 'nvidia' $Target $GitBranch
}
finally {
    $plainApiKey = $null
    $credential = $null
    $secureApiKey = $null
}

Write-Host ''
Write-Host "OmniRoute variables are configured for Vercel $scopeLabel." -ForegroundColor Green
Write-Host "Default model: $Model" -ForegroundColor Green
Write-Host 'They take effect only on a new deployment.'
if ($Target -eq 'production') {
    Write-Host 'Redeploy after PR #92 is approved/merged: vercel --prod' -ForegroundColor Cyan
}
else {
    Write-Host 'Preview OmniRoute configuration is set; normal AIRA authentication remains required.' -ForegroundColor Yellow
    Write-Host 'Create or redeploy the PR preview to validate OmniRoute before production.' -ForegroundColor Cyan
}
