[CmdletBinding()]
param(
    [ValidateSet("Verify", "Canary", "Full")]
    [string]$Mode = "Verify",
    [string]$VenvPath = ".venv-model-lab",
    [string]$HipVisibleDevices = "0",
    [ValidateRange(2, 64)]
    [int]$CanaryRows = 8,
    [switch]$OverwriteOutput
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedTrainSha = "89890cc7c5b017bd88c91d427921b7cc31dd9e2b211c4ff72ef20331c78654d2"
$ExpectedValidationSha = "426667615d75673108d776b7d269a2b67ce8290bd4526e295829d8e6186031cc"
$ExpectedHoldoutSha = "8b580a22fde7adb68f861810a21c45f85d1fd1b03822482a95bb07e8dde21025"
$ExpectedTrainRows = 10311
$ExpectedTotalExamples = 10509
$ExpectedManifestTokens = 6138380
$ExpectedBaseRepo = "Qwen/Qwen3.5-9B-Base"
$ExpectedBaseRevision = "68c46c4b3498877f3ef123c856ecfde50c39f404"
$ExpectedSoupVersion = "0.73.3"
$ExpectedSoupCommit = "6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf"
$ExpectedConfigNormalizedSha = "2130c2ba6f2d752885f9f860a8272f4237dc06245900b67cc7f51810ebbfee87"

function Invoke-Checked {
    param(
        [Parameter(Mandatory=$true)][scriptblock]$Command,
        [Parameter(Mandatory=$true)][string]$Label
    )
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Assert-FileHash {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Expected
    )
    if (-not (Test-Path $Path -PathType Leaf)) {
        throw "Required file is missing: $Path"
    }
    $actual = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) {
        throw "SHA256 mismatch for $Path`nexpected: $Expected`nactual:   $actual"
    }
    return $actual
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $targetPath = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    } else {
        Join-Path (Get-Location).Path $Path
    }
    $parent = Split-Path -Parent $targetPath
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetPath, $Text, $encoding)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $repoRoot

$python = Join-Path $repoRoot "$VenvPath\Scripts\python.exe"
$soup = Join-Path $repoRoot "$VenvPath\Scripts\soup.exe"
if (-not (Test-Path $python -PathType Leaf)) {
    throw "Model-lab Python environment is missing: $python"
}
if (-not (Test-Path $soup -PathType Leaf)) {
    throw "Soup CLI is missing from the model-lab environment: $soup"
}

$trainPath = "model-lab\data\core-v0\train.jsonl"
$validationPath = "model-lab\data\core-v0\validation.jsonl"
$holdoutPath = "model-lab\data\core-v0\holdout.jsonl"
$freezePath = "model-lab\data\core-v0\frozen-build-evidence.json"
$manifestPath = "model-lab\data\core-v0\core-v0.promoted-manifest.json"
$configPath = "model-lab\soup\core\sft.yaml"
$materializedPath = "model-lab\runs\materialized-core-base.json"

Write-Host "AIRA Core physical-run gate: $Mode" -ForegroundColor Green

$trainSha = Assert-FileHash $trainPath $ExpectedTrainSha
$null = Assert-FileHash $validationPath $ExpectedValidationSha
$null = Assert-FileHash $holdoutPath $ExpectedHoldoutSha

if (-not (Test-Path $freezePath -PathType Leaf)) {
    throw "Frozen build evidence is missing. Run freeze_core_build.py first."
}
$freeze = Get-Content $freezePath -Raw | ConvertFrom-Json
if ([string]$freeze.status -ne "FROZEN_READY_FOR_MANIFEST_PROPOSAL") {
    throw "Frozen build status is not FROZEN_READY_FOR_MANIFEST_PROPOSAL: $($freeze.status)"
}
if ([int64]$freeze.total_examples -ne $ExpectedTotalExamples) {
    throw "Frozen total example count drifted: $($freeze.total_examples)"
}
if ([int64]$freeze.manifest_token_count -ne $ExpectedManifestTokens) {
    throw "Frozen manifest token count drifted: $($freeze.manifest_token_count)"
}
if ([string]$freeze.splits.train.sha256 -ne $ExpectedTrainSha -or [int]$freeze.splits.train.examples -ne $ExpectedTrainRows) {
    throw "Frozen train split evidence does not match the reviewed train artifact."
}
if ([string]$freeze.splits.validation.sha256 -ne $ExpectedValidationSha -or [string]$freeze.splits.holdout.sha256 -ne $ExpectedHoldoutSha) {
    throw "Frozen validation/holdout evidence does not match the reviewed split hashes."
}

if (-not (Test-Path $manifestPath -PathType Leaf)) {
    throw "Promoted manifest proposal is missing. Run promote_core_manifest.py first."
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ([string]$manifest.id -ne "aira-core-v0" -or [string]$manifest.status -ne "candidate" -or $manifest.training_allowed -ne $true) {
    throw "Core manifest proposal is not an approved candidate."
}
if ([int64]$manifest.example_count -ne $ExpectedTotalExamples -or [int64]$manifest.token_count -ne $ExpectedManifestTokens) {
    throw "Core manifest proposal does not match the frozen example/token counts."
}
if (($manifest.languages -join ",") -ne "en,zh") {
    throw "Core manifest language claims drifted: $($manifest.languages -join ',')"
}
if (($manifest.domains -join ",") -ne "agentic_execution,function_calling,tool_use") {
    throw "Core manifest domain claims drifted: $($manifest.domains -join ',')"
}

if (-not (Test-Path $configPath -PathType Leaf)) {
    throw "Core Soup config is missing: $configPath"
}
$configNormalizedSha = (& $python -c "import hashlib, pathlib, sys; p=pathlib.Path(sys.argv[1]); t=p.read_text(encoding='utf-8').replace(chr(13)+chr(10), chr(10)).replace(chr(13), chr(10)); print(hashlib.sha256(t.encode('utf-8')).hexdigest())" $configPath | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or $configNormalizedSha -ne $ExpectedConfigNormalizedSha) {
    throw "Core Soup config drifted from the reviewed recipe. expected normalized SHA $ExpectedConfigNormalizedSha, got $configNormalizedSha"
}

if (-not (Test-Path $materializedPath -PathType Leaf)) {
    throw "Exact 9B materialization evidence is missing: $materializedPath`nRun: .\.venv-model-lab\Scripts\python.exe .\model-lab\scripts\materialize_hf_model.py core-base"
}
$materialized = Get-Content $materializedPath -Raw | ConvertFrom-Json
if ([string]$materialized.repo_id -ne $ExpectedBaseRepo) {
    throw "Materialized base repo mismatch: $($materialized.repo_id)"
}
if ([string]$materialized.requested_revision -ne $ExpectedBaseRevision -or [string]$materialized.resolved_revision -ne $ExpectedBaseRevision) {
    throw "Materialized base revision is not the reviewed Qwen3.5-9B-Base SHA."
}
$materializedBase = [string]$materialized.local_dir
if (-not (Test-Path $materializedBase -PathType Container)) {
    throw "Materialized 9B base directory is missing: $materializedBase"
}

$pythonVersion = (& $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" | Select-Object -Last 1).Trim()
if ($pythonVersion -ne "3.12") {
    throw "Physical Core run requires Python 3.12; got $pythonVersion"
}
$soupVersion = (& $python -c "import importlib.metadata as m; print(m.version('soup-cli'))" | Select-Object -Last 1).Trim()
if ($soupVersion -ne $ExpectedSoupVersion) {
    throw "Soup version drifted: expected $ExpectedSoupVersion, got $soupVersion"
}

$env:PYTHONUTF8 = "1"
$env:HIP_VISIBLE_DEVICES = $HipVisibleDevices
$venvScripts = Join-Path $repoRoot "$VenvPath\Scripts"
$env:PATH = "$venvScripts;$env:PATH"

Invoke-Checked -Label "Verify isolated RX 9070 XT ROCm device" -Command {
    & $python -c "import torch; assert torch.cuda.is_available(); assert torch.cuda.device_count()==1, torch.cuda.device_count(); n=torch.cuda.get_device_name(0); print('device=',n); print('torch=',torch.__version__); print('hip=',torch.version.hip); assert '9070 XT' in n, n"
}

Invoke-Checked -Label "Verify NF4 backend contract" -Command {
    & $python "model-lab\scripts\verify_bnb_4bit_backend.py"
}

Invoke-Checked -Label "Validate final training data through Soup" -Command {
    & $soup data inspect $trainPath
}

$manifestSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$freezeSha = (Get-FileHash $freezePath -Algorithm SHA256).Hash.ToLowerInvariant()
$gitHead = (& git rev-parse HEAD | Select-Object -Last 1).Trim()

$preflight = [ordered]@{
    schema_version = 1
    status = "PASS"
    mode = $Mode
    git_head = $gitHead
    train_sha256 = $trainSha
    train_examples = $ExpectedTrainRows
    total_examples = $ExpectedTotalExamples
    manifest_token_count = $ExpectedManifestTokens
    manifest_sha256 = $manifestSha
    frozen_build_sha256 = $freezeSha
    config_normalized_sha256 = $configNormalizedSha
    base_repo = $ExpectedBaseRepo
    base_revision = $ExpectedBaseRevision
    materialized_base = $materializedBase
    soup_version = $soupVersion
    soup_commit = $ExpectedSoupCommit
    seed = 3407
    max_length = 2048
    batch_size = 1
    val_split = 0.0
    hip_visible_devices = $HipVisibleDevices
}
New-Item -ItemType Directory -Force -Path "model-lab\runs" | Out-Null
$preflight | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 "model-lab\runs\core-v0-physical-preflight.json"

if ($Mode -eq "Verify") {
    Write-Host "`nAIRA CORE 9B PHYSICAL PREFLIGHT = PASS" -ForegroundColor Green
    Write-Host "Training was not started. Next gate: -Mode Canary"
    exit 0
}

$verifiedCanaryPath = $null
if ($Mode -eq "Full") {
    $canaryFiles = Get-ChildItem "model-lab\runs\core-v0-canary-*.json" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '\.adapter-verification\.json$' } |
        Sort-Object LastWriteTimeUtc -Descending
    $verifiedCanary = $null
    foreach ($file in $canaryFiles) {
        try {
            $candidate = Get-Content $file.FullName -Raw | ConvertFrom-Json
            if (
                [string]$candidate.status -eq "VERIFIED" -and
                [string]$candidate.mode -eq "Canary" -and
                [int]$candidate.canary_rows -eq 8 -and
                [string]$candidate.train_sha256 -eq $ExpectedTrainSha -and
                [string]$candidate.base_revision -eq $ExpectedBaseRevision -and
                [string]$candidate.config_normalized_sha256 -eq $ExpectedConfigNormalizedSha -and
                [string]$candidate.soup_version -eq $ExpectedSoupVersion -and
                $candidate.adapter_active -eq $true
            ) {
                $verifiedCanary = $candidate
                $verifiedCanaryPath = $file.FullName
                break
            }
        } catch {
            continue
        }
    }
    if ($null -eq $verifiedCanary) {
        throw "Full Core training requires a VERIFIED 8-row canary bound to the reviewed train/config/base/Soup contract. Run -Mode Canary first."
    }
    $verifiedCanaryAdapter = [string]$verifiedCanary.adapter
    if (-not (Test-Path $verifiedCanaryAdapter -PathType Container)) {
        throw "Verified canary record points to a missing adapter: $verifiedCanaryAdapter"
    }
    $canaryRecheckOutput = "model-lab\runs\core-v0-full-canary-recheck.json"
    Invoke-Checked -Label "Re-verify required 8-row canary adapter through NF4" -Command {
        & $python "model-lab\scripts\verify_core_9b_adapter.py" `
            --adapter $verifiedCanaryAdapter `
            --base $materializedBase `
            --output $canaryRecheckOutput
    }
    $canaryRecheck = Get-Content $canaryRecheckOutput -Raw | ConvertFrom-Json
    if ([string]$canaryRecheck.status -ne "VERIFIED" -or $canaryRecheck.adapter_active -ne $true) {
        throw "The required 8-row canary failed NF4 adapter re-verification. Full training remains blocked."
    }
    Write-Host "Verified canary gate: $verifiedCanaryPath" -ForegroundColor Green
}

$runId = "core-v0-$($Mode.ToLowerInvariant())-" + [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$runtimeConfig = "model-lab\runs\$runId.runtime.yaml"
$adapterOutput = if ($Mode -eq "Canary") { "model-lab\artifacts\aira-core-v0-canary" } else { "model-lab\artifacts\aira-core-v0" }
$templateForRun = $configPath
$canaryPath = "model-lab\runs\core-v0-canary.jsonl"

if ($Mode -eq "Canary") {
    Invoke-Checked -Label "Materialize deterministic Core canary subset" -Command {
        & $python -c "import pathlib,sys; src=pathlib.Path(sys.argv[1]); dst=pathlib.Path(sys.argv[2]); n=int(sys.argv[3]); lines=src.read_text(encoding='utf-8').splitlines(True); assert len(lines)>=n; dst.parent.mkdir(parents=True,exist_ok=True); dst.write_text(''.join(lines[:n]),encoding='utf-8',newline='\n'); print('rows=',n)" $trainPath $canaryPath $CanaryRows
    }
    $canaryTemplate = "model-lab\runs\$runId.template.yaml"
    $text = Get-Content $configPath -Raw
    $text = $text.Replace("train: ./model-lab/data/core-v0/train.jsonl", "train: ./model-lab/runs/core-v0-canary.jsonl")
    $text = $text.Replace("output: ./model-lab/artifacts/aira-core-v0", "output: ./model-lab/artifacts/aira-core-v0-canary")
    Write-Utf8NoBom $canaryTemplate $text
    $templateForRun = $canaryTemplate
}

Invoke-Checked -Label "Generate exact local-base Soup runtime config" -Command {
    & $python "model-lab\scripts\make_runtime_soup_config.py" `
        --template $templateForRun `
        --base $materializedBase `
        --output $runtimeConfig
}

if (Test-Path $adapterOutput) {
    if ($Mode -eq "Full" -and -not $OverwriteOutput) {
        throw "Full Core output already exists at $adapterOutput. Refusing to overwrite. Re-run with -OverwriteOutput only after reviewing the existing artifact."
    }
    Remove-Item -Recurse -Force $adapterOutput
}

$started = [DateTime]::UtcNow
Invoke-Checked -Label "Run AIRA Core 9B $Mode QLoRA" -Command {
    & $soup train --config $runtimeConfig
}
$ended = [DateTime]::UtcNow

$verificationOutput = "model-lab\runs\$runId.adapter-verification.json"
Invoke-Checked -Label "Verify trained 9B adapter activation through NF4" -Command {
    & $python "model-lab\scripts\verify_core_9b_adapter.py" `
        --adapter $adapterOutput `
        --base $materializedBase `
        --output $verificationOutput
}

$adapterVerification = Get-Content $verificationOutput -Raw | ConvertFrom-Json
$runtimeConfigSha = (Get-FileHash $runtimeConfig -Algorithm SHA256).Hash.ToLowerInvariant()
$summary = [ordered]@{
    schema_version = 1
    run_id = $runId
    status = if ($adapterVerification.status -eq "VERIFIED") { "VERIFIED" } else { "FAILED" }
    mode = $Mode
    started_at_utc = $started.ToString("o")
    ended_at_utc = $ended.ToString("o")
    duration_seconds = [Math]::Round(($ended - $started).TotalSeconds, 3)
    git_head = $gitHead
    train_sha256 = $ExpectedTrainSha
    train_examples = $ExpectedTrainRows
    canary_rows = if ($Mode -eq "Canary") { $CanaryRows } else { $null }
    canary_sha256 = if ($Mode -eq "Canary") { (Get-FileHash $canaryPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    required_canary_record = if ($Mode -eq "Full") { $verifiedCanaryPath } else { $null }
    manifest_token_count = $ExpectedManifestTokens
    manifest_sha256 = $manifestSha
    frozen_build_sha256 = $freezeSha
    config_normalized_sha256 = $ExpectedConfigNormalizedSha
    runtime_config_sha256 = $runtimeConfigSha
    base_repo = $ExpectedBaseRepo
    base_revision = $ExpectedBaseRevision
    soup_version = $ExpectedSoupVersion
    soup_commit = $ExpectedSoupCommit
    seed = 3407
    max_length = 2048
    batch_size = 1
    val_split = 0.0
    hip_visible_devices = $HipVisibleDevices
    adapter = $adapterOutput
    adapter_active = [bool]$adapterVerification.adapter_active
    max_abs_logit_deltas = $adapterVerification.max_abs_logit_deltas
    peak_allocated_gib_during_verification = $adapterVerification.peak_allocated_gib
    peak_reserved_gib_during_verification = $adapterVerification.peak_reserved_gib
}
$summaryPath = "model-lab\runs\$runId.json"
$summary | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $summaryPath

Write-Host "`nAIRA CORE 9B $($Mode.ToUpperInvariant()) = VERIFIED" -ForegroundColor Green
Write-Host "Run record: $summaryPath"
if ($Mode -eq "Canary") {
    Write-Host "Next gate: review canary evidence, then run -Mode Full."
} else {
    Write-Host "Next gate: post-SFT frozen evaluation against the untouched 2/6 baseline."
}
