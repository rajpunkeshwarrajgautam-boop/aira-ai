[CmdletBinding()]
param(
    [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'AIRA\OmniRoute'),
    [string]$ContainerName = 'aira-omniroute',
    [ValidateRange(1024, 16384)]
    [int]$MemoryMb = 1536
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "Required command '$Name' is not installed or not on PATH." -ForegroundColor Red
        if ($InstallHint) { Write-Host $InstallHint -ForegroundColor Yellow }
        exit 20
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

function Test-NativeCommand([string]$Command, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments *> $null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Native([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed: $Command $($Arguments -join ' ')"
    }
}

Require-Command 'docker' 'Install/start Docker Desktop, then rerun this script.'
Require-Command 'tailscale' 'Install Tailscale for Windows, sign in, then rerun this script.'

Write-Host 'Checking Docker Desktop...'
if (-not (Test-NativeCommand -Command 'docker' -Arguments @('info'))) {
    Write-Host 'Docker is installed but the Docker engine is not reachable.' -ForegroundColor Yellow
    Write-Host 'Start Docker Desktop and wait until it reports that the engine is running, then rerun this script.' -ForegroundColor Cyan
    exit 21
}

Write-Host 'Checking Tailscale...'
if (-not (Test-NativeCommand -Command 'tailscale' -Arguments @('status'))) {
    Write-Host 'Tailscale is installed but not connected.' -ForegroundColor Yellow
    Write-Host 'Run: tailscale up' -ForegroundColor Cyan
    exit 22
}

$tailscaleJson = & tailscale status --json 2>$null
if ($LASTEXITCODE -ne 0 -or -not $tailscaleJson) {
    throw 'Could not read Tailscale status JSON.'
}
$tailscaleState = $tailscaleJson | ConvertFrom-Json
$dnsName = [string]$tailscaleState.Self.DNSName
if ([string]::IsNullOrWhiteSpace($dnsName)) {
    throw 'Tailscale did not report a MagicDNS hostname. Funnel requires MagicDNS.'
}
$dnsName = $dnsName.TrimEnd('.')
$publicUrl = "https://$dnsName"

Write-Host 'Resolving latest published OmniRoute release...'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/diegosouzapw/OmniRoute/releases/latest' -Headers @{ 'User-Agent' = 'AIRA-OmniRoute-Local-Deploy' }
$tag = [string]$release.tag_name
if ([string]::IsNullOrWhiteSpace($tag) -or $tag -notmatch '^v?\d+\.\d+\.\d+$') {
    throw 'GitHub did not return a valid immutable OmniRoute release tag.'
}
$version = $tag.TrimStart('v')
# OmniRoute publishes the same immutable release manifest to Docker Hub and GHCR.
# Prefer GHCR on Windows because Docker Hub's auth endpoint is frequently affected
# by local/ISP proxy interception even when the Docker engine itself is healthy.
$image = "ghcr.io/diegosouzapw/omniroute:$version"
Write-Host "Using OmniRoute $tag ($image)"

$dataDir = Join-Path $StateDir 'data'
$envFile = Join-Path $StateDir 'omniroute.env'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$createdSecrets = $false
$initialPassword = $null
if (-not (Test-Path $envFile)) {
    $createdSecrets = $true
    $jwtSecret = New-HexSecret 64
    $apiKeySecret = New-HexSecret 32
    $storageKey = New-HexSecret 32
    $initialPassword = 'Aira!' + (New-HexSecret 18)

    $envLines = @(
        "JWT_SECRET=$jwtSecret",
        "API_KEY_SECRET=$apiKeySecret",
        "INITIAL_PASSWORD=$initialPassword",
        "STORAGE_ENCRYPTION_KEY=$storageKey",
        'STORAGE_ENCRYPTION_KEY_VERSION=v1',
        'DATA_DIR=/app/data',
        'NODE_ENV=production',
        'PORT=20128',
        "OMNIROUTE_MEMORY_MB=$MemoryMb",
        "NEXT_PUBLIC_BASE_URL=$publicUrl",
        'OMNIROUTE_ENABLE_LIVE_WS=0'
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($envFile, $envLines, $utf8NoBom)

    # Best-effort restriction to the current Windows user. Docker reads the env file
    # client-side, so inherited broad ACLs are unnecessary for this deployment.
    try {
        & icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(F)" *> $null
    }
    catch {
        Write-Warning 'Could not tighten the environment-file ACL automatically. Keep the state directory private.'
    }
}
else {
    # Keep the public-origin hint current if the Tailscale hostname changes.
    $envText = Get-Content -Raw $envFile
    if ($envText -match '(?m)^NEXT_PUBLIC_BASE_URL=.*$') {
        $envText = [regex]::Replace($envText, '(?m)^NEXT_PUBLIC_BASE_URL=.*$', "NEXT_PUBLIC_BASE_URL=$publicUrl")
    }
    else {
        $envText = $envText.TrimEnd() + "`r`nNEXT_PUBLIC_BASE_URL=$publicUrl`r`n"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envFile, $envText, $utf8NoBom)
}

Write-Host "Pulling $image ..."
Invoke-Native -Command 'docker' -Arguments @('pull', $image)

if (Test-NativeCommand -Command 'docker' -Arguments @('inspect', $ContainerName)) {
    Write-Host 'Replacing existing OmniRoute container while preserving data...'
    Invoke-Native -Command 'docker' -Arguments @('rm', '-f', $ContainerName)
}

Write-Host 'Starting OmniRoute on loopback only (127.0.0.1:20128)...'
Invoke-Native -Command 'docker' -Arguments @(
    'run', '-d',
    '--name', $ContainerName,
    '--restart', 'unless-stopped',
    '--env-file', $envFile,
    '--publish', '127.0.0.1:20128:20128',
    '--mount', "type=bind,source=$dataDir,target=/app/data",
    $image
)

Write-Host 'Waiting for OmniRoute to become reachable...'
$ready = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:20128' -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 3
    }
}

if (-not $ready) {
    Write-Host 'OmniRoute did not become reachable in time.' -ForegroundColor Red
    Write-Host "Inspect logs with: docker logs --tail 200 $ContainerName" -ForegroundColor Cyan
    exit 23
}

Write-Host 'OmniRoute is reachable locally.' -ForegroundColor Green
Write-Host 'Enabling persistent Tailscale Funnel HTTPS proxy...'
$previous = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & tailscale funnel --bg 20128
    $funnelExit = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previous
}

if ($funnelExit -ne 0) {
    Write-Host ''
    Write-Host 'OmniRoute is running, but Tailscale Funnel still needs approval or configuration.' -ForegroundColor Yellow
    Write-Host 'Run this from an Administrator PowerShell window:' -ForegroundColor Cyan
    Write-Host '  tailscale funnel --bg 20128' -ForegroundColor Cyan
    Write-Host 'If Tailscale opens an approval page, approve Funnel for this device, then run the command again.' -ForegroundColor Cyan
    exit 24
}

Write-Host ''
Invoke-Native -Command 'tailscale' -Arguments @('funnel', 'status')
Write-Host ''
Write-Host 'AIRA local OmniRoute gateway is online.' -ForegroundColor Green
Write-Host "Dashboard: $publicUrl"
Write-Host "AIRA API root: $publicUrl/v1"
Write-Host "OmniRoute release: $tag"
Write-Host "Persistent data: $dataDir"
Write-Host ''
if ($createdSecrets) {
    Write-Host 'INITIAL ADMIN PASSWORD (save it now; do not paste it into chat):' -ForegroundColor Yellow
    Write-Host $initialPassword -ForegroundColor Cyan
    Write-Host 'Change this password after your first dashboard login.' -ForegroundColor Yellow
    Write-Host ''
}
Write-Host 'Next: sign in to the OmniRoute dashboard, configure the upstream providers you want, and create a dedicated endpoint API key for AIRA.'
Write-Host 'Do not use API_KEY_SECRET as the AIRA endpoint key and do not paste any endpoint key into chat.'