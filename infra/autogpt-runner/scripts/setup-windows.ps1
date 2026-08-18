param()

$ErrorActionPreference = "Stop"
$RunnerDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RunnerDir

$currentPrincipal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator, then run this script again."
}

$windowsFeatures = @(
    "Microsoft-Windows-Subsystem-Linux"
    "VirtualMachinePlatform"
)
$featuresChanged = $false
foreach ($featureName in $windowsFeatures) {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $featureName
    if ($feature.State -ne "Enabled") {
        Enable-WindowsOptionalFeature -Online -FeatureName $featureName -All -NoRestart *> $null
        $featuresChanged = $true
    }
}
if ($featuresChanged) {
    Write-Host "WSL 2 prerequisites are enabled. Restart Windows, then rerun this script."
    exit 11
}

function ConvertFrom-SecureValue {
    param([Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function New-HexSecret {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Install Docker Desktop, restart Windows, and run this script again."
    }
    winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    Write-Host "Docker Desktop is installed. Restart Windows, open Docker Desktop once, then rerun this script."
    exit 10
}

try {
    docker info *> $null
}
catch {
    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktop) {
        Start-Process $dockerDesktop
    }
    throw "Docker Desktop is not ready. Wait for it to show 'Engine running', then rerun this script."
}

Write-Host "Before continuing, confirm the tunnel's public hostname is configured with"
Write-Host "service URL http://adapter:8080 AND path external-api/*."
Write-Host "A rule without that path publishes the internal NVIDIA proxy to the internet."
Write-Host ""

$nvidiaSecure = Read-Host "NVIDIA API key" -AsSecureString
$cloudflareSecure = Read-Host "Cloudflare Tunnel token" -AsSecureString
$publicHostname = Read-Host "Tunnel hostname (for example autogpt-secondary.example.com)"
$nvidiaApiKey = ConvertFrom-SecureValue $nvidiaSecure
$cloudflareToken = ConvertFrom-SecureValue $cloudflareSecure

if ([string]::IsNullOrWhiteSpace($nvidiaApiKey) -or
    [string]::IsNullOrWhiteSpace($cloudflareToken) -or
    [string]::IsNullOrWhiteSpace($publicHostname)) {
    throw "The NVIDIA key, Cloudflare Tunnel token, and public hostname are required."
}

$runnerApiKey = New-HexSecret
$internalToken = "sk-$(New-HexSecret)"
$envFile = @(
    "RUNNER_API_KEY=$runnerApiKey"
    "AUTOGPT_INTERNAL_TOKEN=$internalToken"
    "NVIDIA_API_KEY=$nvidiaApiKey"
    "AIRA_GRAPH_ID=aira-objective-runner"
    "AIRA_GRAPH_VERSION=1"
    "AUTOGPT_MAX_STEPS=12"
    "AUTOGPT_MAX_CONCURRENT_RUNS=1"
    "AUTOGPT_UPSTREAM_TIMEOUT_SECONDS=180"
    "NVIDIA_API_URL=https://integrate.api.nvidia.com/v1"
    "NVIDIA_SMART_MODEL=nvidia/nemotron-3-nano-30b-a3b"
    "NVIDIA_FAST_MODEL=nvidia/nemotron-3-nano-30b-a3b"
    "NVIDIA_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5"
    "AUTOGPT_COMMIT=601093ddfe23a3d58a9c8f4a208bd49b203ee612"
    "RUNNER_DOMAIN="
    "CLOUDFLARE_TUNNEL_TOKEN=$cloudflareToken"
)
$envPath = Join-Path $RunnerDir ".env"
[IO.File]::WriteAllLines($envPath, $envFile)
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $envPath /inheritance:r /grant:r "${currentIdentity}:(F)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict access to the .env secrets file."
}

docker compose -f compose.yml -f compose.windows.yml up -d --build

Write-Host ""
Write-Host "Windows standby runner started. Configure these Vercel values:"
Write-Host "AUTOGPT_SECONDARY_API_BASE_URL=https://$publicHostname/external-api/v1"
Write-Host "AUTOGPT_SECONDARY_API_KEY=$runnerApiKey"
Write-Host ""
Write-Host "Health check:"
Write-Host "curl.exe -H `"X-API-Key: $runnerApiKey`" https://$publicHostname/external-api/v1/health"
Write-Host ""
Write-Host "Confirm the internal routes are NOT published. Both must return 404:"
Write-Host "curl.exe -o NUL -s -w `"%{http_code}``n`" https://$publicHostname/internal-ready"
Write-Host "curl.exe -o NUL -s -w `"%{http_code}``n`" https://$publicHostname/internal/v1/models"
