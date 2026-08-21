[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ModelPath,

    [string]$LlamaServerPath = "llama-server.exe",

    [ValidateRange(1, 65535)]
    [int]$Port = 8080,

    [ValidateRange(512, 131072)]
    [int]$Context = 8192,

    [ValidateRange(0, 999)]
    [int]$GpuLayers = 99,

    [ValidateRange(0, 256)]
    [int]$Threads = 0,

    [string]$ApiKey = "",

    [string]$ModelAlias = "minicpm5-fable-v2",

    [switch]$KeepWebUi
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-Executable([string]$Value) {
    if (Test-Path -LiteralPath $Value -PathType Leaf) {
        return (Resolve-Path -LiteralPath $Value).Path
    }

    $command = Get-Command $Value -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    throw "Could not find llama-server. Pass -LlamaServerPath with the full path to llama-server.exe."
}

if (-not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) {
    throw "GGUF model not found: $ModelPath"
}

$resolvedModel = (Resolve-Path -LiteralPath $ModelPath).Path
$resolvedServer = Resolve-Executable $LlamaServerPath

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    throw "Port $Port is already in use. Stop the existing listener or choose another -Port."
}

$arguments = @(
    "-m", $resolvedModel,
    "-c", "$Context",
    "-ngl", "$GpuLayers",
    "--host", "127.0.0.1",
    "--port", "$Port",
    "--alias", $ModelAlias,
    "--jinja",
    "--reasoning", "auto"
)

if (-not $KeepWebUi) {
    $arguments += "--no-webui"
}

if ($Threads -gt 0) {
    $arguments += @("-t", "$Threads")
}

if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $arguments += @("--api-key", $ApiKey)
}

$baseUrl = "http://127.0.0.1:$Port/v1"

Write-Host ""
Write-Host "Virexa Local AI Engine" -ForegroundColor Cyan
Write-Host "----------------------"
Write-Host "llama-server : $resolvedServer"
Write-Host "model        : $resolvedModel"
Write-Host "alias        : $ModelAlias"
Write-Host "context      : $Context"
Write-Host "GPU layers   : $GpuLayers"
Write-Host "endpoint     : $baseUrl"
Write-Host ""
Write-Host "AIRA environment values:" -ForegroundColor Yellow
Write-Host "VIREXA_LOCAL_AI_ENABLED=true"
Write-Host "SELF_HOSTED_LLM_BASE_URL=$baseUrl"
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Host "SELF_HOSTED_LLM_API_KEY="
} else {
    Write-Host "SELF_HOSTED_LLM_API_KEY=<same key passed to this script>"
}
Write-Host "SELF_HOSTED_LLM_MODEL=$ModelAlias"
Write-Host "AIRA_LOCAL_FIRST_ENABLED=false"
Write-Host "AIRA_LOCAL_AI_REQUIRED=false"
Write-Host ""
Write-Host "The server is bound to loopback only. A remote Vercel deployment cannot reach this endpoint directly." -ForegroundColor DarkYellow
Write-Host "Press Ctrl+C in this window to stop the local model server." -ForegroundColor DarkGray
Write-Host ""

& $resolvedServer @arguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    throw "llama-server exited with code $exitCode."
}
