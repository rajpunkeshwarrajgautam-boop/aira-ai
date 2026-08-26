[CmdletBinding()]
param(
    [switch]$ProbeOnly,
    [switch]$SkipDependencyInstall,
    [string]$PythonLauncher = "",
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

function Test-DirectPython312 {
    param([Parameter(Mandatory=$true)][string]$Executable)
    try {
        if (-not (Test-Path $Executable -PathType Leaf) -and -not (Get-Command $Executable -ErrorAction SilentlyContinue)) {
            return $null
        }
        $version = & $Executable -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and (($version | Select-Object -Last 1).Trim() -eq "3.12")) {
            $resolved = & $Executable -c "import sys; print(sys.executable)" 2>$null
            return [pscustomobject]@{
                Executable = (($resolved | Select-Object -Last 1).Trim())
                UsePyLauncher = $false
            }
        }
    } catch {
        return $null
    }
    return $null
}

function Test-PyLauncher312 {
    param([Parameter(Mandatory=$true)][string]$Executable)
    try {
        if (-not (Get-Command $Executable -ErrorAction SilentlyContinue)) {
            return $null
        }
        $version = & $Executable -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and (($version | Select-Object -Last 1).Trim() -eq "3.12")) {
            return [pscustomobject]@{
                Executable = $Executable
                UsePyLauncher = $true
            }
        }
    } catch {
        return $null
    }
    return $null
}

function Resolve-Python312 {
    param([string]$Requested = "")

    if ($Requested) {
        if ($Requested -eq "py" -or $Requested.EndsWith("py.exe", [System.StringComparison]::OrdinalIgnoreCase)) {
            $candidate = Test-PyLauncher312 -Executable $Requested
        } else {
            $candidate = Test-DirectPython312 -Executable $Requested
        }
        if ($candidate) {
            return $candidate
        }
        throw "The requested Python launcher '$Requested' does not resolve to Python 3.12."
    }

    $candidate = Test-PyLauncher312 -Executable "py"
    if ($candidate) {
        return $candidate
    }

    $directCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        "python",
        "python3"
    ) | Select-Object -Unique

    foreach ($entry in $directCandidates) {
        $candidate = Test-DirectPython312 -Executable $entry
        if ($candidate) {
            return $candidate
        }
    }

    throw @"
Python 3.12 was not found. Soup 0.73.3 requires Python 3.10-3.12 and this operator intentionally requires 3.12.
Install the official Python 3.12 package, then rerun:
  winget install --exact --id Python.Python.3.12
After installation, close/reopen PowerShell and rerun this script.
"@
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
    $python312 = Resolve-Python312 -Requested $PythonLauncher
    Write-Host "Creating isolated Python 3.12 environment at $VenvPath" -ForegroundColor Cyan
    if ($python312.UsePyLauncher) {
        & $python312.Executable -3.12 -m venv $VenvPath
    } else {
        & $python312.Executable -m venv $VenvPath
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 was detected but failed to create the isolated venv at $VenvPath."
    }

    $python = Join-Path $repoRoot "$VenvPath\Scripts\python.exe"

    Invoke-Checked -Label "Verify isolated Python 3.12" -Command {
        & $python -c "import sys; assert sys.version_info[:2] == (3, 12), sys.version; print(sys.version)"
    }

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
