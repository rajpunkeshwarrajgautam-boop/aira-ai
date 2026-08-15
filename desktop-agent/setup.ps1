$ErrorActionPreference = "Stop"

Write-Host "AIRA Desktop 1.0 setup" -ForegroundColor Green

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Ollama is not installed. Install Ollama, then rerun this script." -ForegroundColor Yellow
  exit 1
}

Write-Host "Installing JavaScript dependencies..."
npm install

$models = @("qwen3.5:9b", "qwen3-vl:8b", "embeddinggemma")
foreach ($model in $models) {
  Write-Host "Ensuring Ollama model: $model"
  ollama pull $model
}

$workspace = Join-Path $HOME "AIRA Workspace"
New-Item -ItemType Directory -Force -Path $workspace | Out-Null

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Run: npm run dev"
