[CmdletBinding()]
param(
    [switch]$ProbeOnly,
    [switch]$SkipDependencyInstall,
    [string]$PythonLauncher = "py",
    [string]$VenvPath = ".venv-model-lab"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([Parameter(Mandatory=$true)][scriptblock]$Command, [Parameter(Mandatory=$true)][string]$Label)
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $repoRoot

if (-not (Test-Path "model-lab\soup\core\sft-smoke.yaml")) {
    throw "Run this script from the AIRA repository checkout; model-lab smoke config is missing."
}

New-Item -ItemType Directory -Force -Path "model-lab\runs" | Out-Null

$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "AMD|Radeon" } | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$hostRecord = [ordered]@{
    captured_at_utc = [DateTime]::UtcNow.ToString("o")
    computer = $env:COMPUTERNAME
    os_caption = $os.Caption
    os_version = $os.Version
    gpu_name = if ($gpu) { $gpu.Name } else { $null }
    gpu_driver = if ($gpu) { $gpu.DriverVersion } else { $null }
    adapter_ram_bytes = if ($gpu) { [int64]$gpu.AdapterRAM } else { $null }
    expected_gpu = "AMD Radeon RX 9070 XT"
    expected_arch = "gfx1201"
}
$hostRecord | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 "model-lab\runs\windows-host.json"

if (-not $SkipDependencyInstall) {
    Write-Host "Creating isolated Python 3.12 environment at $VenvPath" -ForegroundColor Cyan
    & $PythonLauncher -3.12 -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 is required by the pinned Soup release. Install Python 3.12 and rerun."
    }

    $python = Join-Path $repoRoot "$VenvPath\Scripts\python.exe"

    Invoke-Checked -Label "Upgrade pip tooling" -Command {
        & $python -m pip install --upgrade pip setuptools wheel
    }

    # Official AMD ROCm multi-arch wheels. The device-specific extra avoids silently
    # installing a CUDA build. RX 9070 XT is gfx1201 in AMD's support matrix.
    Invoke-Checked -Label "Install ROCm 7.14 PyTorch for gfx1201" -Command {
        & $python -m pip install --index-url https://repo.amd.com/rocm/whl-multi-arch/ `
            "torch[device-gfx1201]==2.12.0+rocm7.14.0" `
            "torchvision[device-gfx1201]==0.27.0+rocm7.14.0" `
            "torchaudio==2.11.0+rocm7.14.0"
    }

    Invoke-Checked -Label "Install pinned Soup training/eval/data/serve stack" -Command {
        & $python -m pip install -r "model-lab\requirements\soup-pin.txt"
    }
} else {
    $python = Join-Path $repoRoot "$VenvPath\Scripts\python.exe"
    if (-not (Test-Path $python)) {
        throw "Existing isolated environment not found at $python"
    }
}

$env:PYTHONUTF8 = "1"
$venvScripts = Join-Path $repoRoot "$VenvPath\Scripts"
$env:PATH = "$venvScripts;$env:PATH"

Invoke-Checked -Label "Verify AMD ROCm + Soup backend" -Command {
    & $python "model-lab\scripts\verify_amd_backend.py"
}

if ($ProbeOnly) {
    Write-Host "Probe-only mode complete. Backend reached PARTIALLY_VERIFIED; training was not run." -ForegroundColor Yellow
    exit 0
}

Invoke-Checked -Label "Materialize exact Qwen3.5-0.8B revision" -Command {
    & $python "model-lab\scripts\materialize_hf_model.py" core-smoke
}
$materialized = Get-Content "model-lab\runs\materialized-core-smoke.json" -Raw | ConvertFrom-Json
$materializedBase = [string]$materialized.local_dir
$resolvedRevision = [string]$materialized.resolved_revision
if (-not (Test-Path $materializedBase)) {
    throw "Materialized smoke model path does not exist: $materializedBase"
}

$runtimeConfig = "model-lab\runs\sft-smoke.runtime.yaml"
Invoke-Checked -Label "Generate runtime Soup config pinned to local model snapshot" -Command {
    & $python "model-lab\scripts\make_runtime_soup_config.py" `
        --template "model-lab\soup\core\sft-smoke.yaml" `
        --base $materializedBase `
        --output $runtimeConfig
}

Invoke-Checked -Label "Validate smoke dataset through Soup" -Command {
    & (Join-Path $venvScripts "soup.exe") data inspect "model-lab\data\smoke\core-smoke.jsonl"
}

$datasetHash = (Get-FileHash "model-lab\data\smoke\core-smoke.jsonl" -Algorithm SHA256).Hash.ToLowerInvariant()
$configHash = (Get-FileHash "model-lab\soup\core\sft-smoke.yaml" -Algorithm SHA256).Hash.ToLowerInvariant()
$runtimeConfigHash = (Get-FileHash $runtimeConfig -Algorithm SHA256).Hash.ToLowerInvariant()
$runId = "core-smoke-" + [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$started = [DateTime]::UtcNow

if (Test-Path "model-lab\artifacts\aira-core-smoke") {
    Remove-Item -Recurse -Force "model-lab\artifacts\aira-core-smoke"
}

Invoke-Checked -Label "Run exact-revision Qwen3.5-0.8B Soup smoke training" -Command {
    & (Join-Path $venvScripts "soup.exe") train --config $runtimeConfig
}

Invoke-Checked -Label "Verify adapter tensors, loading and deterministic activation" -Command {
    & $python "model-lab\scripts\verify_smoke_adapter.py" `
        --adapter "model-lab\artifacts\aira-core-smoke" `
        --base $materializedBase
}

$ended = [DateTime]::UtcNow
$probe = Get-Content "model-lab\runs\amd-backend-probe.json" -Raw | ConvertFrom-Json
$adapterVerification = Get-Content "model-lab\runs\smoke-adapter-verification.json" -Raw | ConvertFrom-Json

$summary = [ordered]@{
    schema_version = 1
    run_id = $runId
    status = "VERIFIED"
    base = "Qwen/Qwen3.5-0.8B"
    base_revision = $resolvedRevision
    materialized_base = $materializedBase
    soup_commit = "6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf"
    seed = 3407
    dataset_sha256 = $datasetHash
    config_sha256 = $configHash
    runtime_config_sha256 = $runtimeConfigHash
    started_at_utc = $started.ToString("o")
    ended_at_utc = $ended.ToString("o")
    duration_seconds = [Math]::Round(($ended - $started).TotalSeconds, 3)
    backend_status_before_training = $probe.status
    device_name = $probe.accelerator.device_name
    hip = $probe.accelerator.torch_version_hip
    torch = $probe.packages.torch
    bitsandbytes = $probe.packages.bitsandbytes
    soup_cli = $probe.packages.'soup-cli'
    adapter_active = $adapterVerification.adapter_active
    deterministic_generation_changed = $adapterVerification.deterministic_generation_changed
    output = "model-lab/artifacts/aira-core-smoke"
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 "model-lab\runs\$runId.json"

Write-Host "`nAIRA RX 9070 XT SOUP SMOKE = VERIFIED" -ForegroundColor Green
Write-Host "Run record: model-lab/runs/$runId.json"
Write-Host "Base revision: $resolvedRevision"
Write-Host "Next gate: real AIRA Core dataset provenance + frozen 9B baseline."
