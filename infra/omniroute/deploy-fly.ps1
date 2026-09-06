[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9-]{2,29}$')]
    [string]$AppName,

    [ValidatePattern('^[a-z]{3}$')]
    [string]$Region = 'sin',

    [ValidateRange(1, 50)]
    [int]$VolumeSizeGb = 1,

    [string]$WorkDir = (Join-Path $env:TEMP 'aira-omniroute-fly')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not installed or not on PATH."
    }
}

function New-HexSecret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }

    return (([System.BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant())
}

function Invoke-Fly([string[]]$Arguments) {
    & flyctl @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "flyctl failed: flyctl $($Arguments -join ' ')"
    }
}

function Test-FlyCommand([string[]]$Arguments) {
    # Windows PowerShell 5.1 can promote redirected native stderr to a
    # NativeCommandError when the script-level ErrorActionPreference is Stop.
    # Probe commands intentionally use their exit code, so suppress that
    # conversion locally and restore the caller's preference afterwards.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & flyctl @Arguments *> $null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Invoke-FlyCapture([string[]]$Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & flyctl @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0) {
        throw "flyctl failed: flyctl $($Arguments -join ' ')"
    }

    return $output
}

Require-Command 'git'
Require-Command 'flyctl'

Write-Host 'Checking Fly.io authentication...'
if (-not (Test-FlyCommand -Arguments @('auth', 'whoami'))) {
    Write-Host 'Fly.io authentication is required before this deployment can continue.' -ForegroundColor Yellow
    Write-Host 'Run: flyctl auth login' -ForegroundColor Cyan
    Write-Host 'Then rerun this script with the same -AppName value.' -ForegroundColor Cyan
    exit 20
}

if (Test-Path $WorkDir) {
    Remove-Item -Recurse -Force $WorkDir
}
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

Write-Host 'Resolving the latest published OmniRoute release...'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/diegosouzapw/OmniRoute/releases/latest' -Headers @{ 'User-Agent' = 'AIRA-OmniRoute-Deploy' }
$tag = [string]$release.tag_name
if ([string]::IsNullOrWhiteSpace($tag) -or $tag -notmatch '^v?\d+\.\d+\.\d+$') {
    throw 'GitHub did not return a valid immutable OmniRoute release tag. Refusing to deploy a moving branch.'
}
Write-Host "Using OmniRoute release $tag"

$sourceDir = Join-Path $WorkDir 'OmniRoute'
& git clone --depth 1 --branch $tag --single-branch 'https://github.com/diegosouzapw/OmniRoute.git' $sourceDir
if ($LASTEXITCODE -ne 0) {
    throw "Could not clone OmniRoute release $tag."
}

$flyToml = Join-Path $sourceDir 'fly.toml'
if (-not (Test-Path $flyToml)) {
    throw 'The selected OmniRoute release does not contain fly.toml.'
}

$appPattern = '(?m)^app\s*=\s*[''\"][^''\"]+[''\"]'
$regionPattern = '(?m)^primary_region\s*=\s*[''\"][^''\"]+[''\"]'
$toml = Get-Content -Raw $flyToml
if ($toml -match $appPattern) {
    $toml = [regex]::Replace($toml, $appPattern, "app = '$AppName'")
} else {
    $toml = "app = '$AppName'`n" + $toml
}
if ($toml -match $regionPattern) {
    $toml = [regex]::Replace($toml, $regionPattern, "primary_region = '$Region'")
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($flyToml, $toml, $utf8NoBom)

Write-Host 'Ensuring Fly application exists...'
if (-not (Test-FlyCommand -Arguments @('status', '-a', $AppName))) {
    Invoke-Fly -Arguments @('apps', 'create', $AppName)
}

Write-Host "Ensuring persistent volume exists in $Region..."
$volumeJson = Invoke-FlyCapture -Arguments @('volumes', 'list', '-a', $AppName, '--json')
$volumes = @()
if ($volumeJson) {
    $parsedVolumes = $volumeJson | ConvertFrom-Json
    if ($null -ne $parsedVolumes) { $volumes = @($parsedVolumes) }
}
$hasDataVolume = $volumes | Where-Object { $_.name -eq 'data' -and $_.region -eq $Region } | Select-Object -First 1
if (-not $hasDataVolume) {
    Invoke-Fly -Arguments @('volumes', 'create', 'data', '--app', $AppName, '--region', $Region, '--size', [string]$VolumeSizeGb, '--yes')
}

$apiKeySecret = New-HexSecret 32
$jwtSecret = New-HexSecret 64
$machineIdSalt = New-HexSecret 32
$storageKey = New-HexSecret 32
$wsBridgeSecret = New-HexSecret 32
$initialPassword = 'Aira!' + (New-HexSecret 18)
$baseUrl = "https://$AppName.fly.dev"

Write-Host 'Setting production secrets without writing them to the repository...'
Push-Location $sourceDir
try {
    Invoke-Fly -Arguments @(
        'secrets', 'set',
        "API_KEY_SECRET=$apiKeySecret",
        "JWT_SECRET=$jwtSecret",
        "MACHINE_ID_SALT=$machineIdSalt",
        "STORAGE_ENCRYPTION_KEY=$storageKey",
        "OMNIROUTE_WS_BRIDGE_SECRET=$wsBridgeSecret",
        "INITIAL_PASSWORD=$initialPassword",
        'DATA_DIR=/data',
        "NEXT_PUBLIC_BASE_URL=$baseUrl",
        '--app', $AppName
    )

    Write-Host "Deploying OmniRoute $tag to $baseUrl ..."
    Invoke-Fly -Arguments @('deploy', '--app', $AppName)
}
finally {
    Pop-Location
}

Write-Host 'Verifying Fly machine status...'
Invoke-Fly -Arguments @('status', '--app', $AppName)

Write-Host 'Checking public HTTPS response...'
$healthy = $false
try {
    $response = Invoke-WebRequest -Uri $baseUrl -MaximumRedirection 5 -UseBasicParsing -TimeoutSec 30
    $healthy = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
}
catch {
    Write-Warning "Public HTTPS verification failed: $($_.Exception.Message)"
}
if (-not $healthy) {
    throw "Deployment completed but the public HTTPS health check did not succeed. Inspect: flyctl logs --no-tail -a $AppName"
}

Write-Host ''
Write-Host 'OmniRoute public deployment is reachable.' -ForegroundColor Green
Write-Host "Base URL: $baseUrl"
Write-Host "AIRA API root: $baseUrl/v1"
Write-Host "OmniRoute release: $tag"
Write-Host ''
Write-Host 'IMPORTANT: save this generated initial administrator password in a password manager now; it is shown only by this script:' -ForegroundColor Yellow
Write-Host $initialPassword -ForegroundColor Cyan
Write-Host ''
Write-Host 'Next: sign in to the OmniRoute dashboard, create a dedicated endpoint API key for AIRA, and store that key in Vercel encrypted environment variables. Do not commit or paste it into client code.'
