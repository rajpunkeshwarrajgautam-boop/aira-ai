[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8080/v1",
    [string]$Model = "minicpm5-fable-v2",
    [string]$ApiKey = "",
    [switch]$RequireToolCalling
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$BaseUrl = $BaseUrl.TrimEnd("/")
$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $headers.Authorization = "Bearer $ApiKey"
}

function Invoke-JsonPost([string]$Url, [object]$Body) {
    $json = $Body | ConvertTo-Json -Depth 30 -Compress
    return Invoke-RestMethod -Method Post -Uri $Url -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 120
}

function Pass([string]$Message) {
    Write-Host "PASS  $Message" -ForegroundColor Green
}

function Warn([string]$Message) {
    Write-Host "WARN  $Message" -ForegroundColor Yellow
}

Write-Host "Virexa Local AI smoke test" -ForegroundColor Cyan
Write-Host "Endpoint: $BaseUrl"
Write-Host "Model:    $Model"
Write-Host ""

try {
    $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -Headers $headers -TimeoutSec 10
    if ($health.status -ne "ok") {
        throw "Unexpected health response: $($health | ConvertTo-Json -Compress)"
    }
    Pass "llama.cpp health endpoint is ready"

    $models = Invoke-RestMethod -Method Get -Uri "$BaseUrl/models" -Headers $headers -TimeoutSec 10
    $modelIds = @($models.data | ForEach-Object { $_.id })
    if ($modelIds.Count -eq 0) {
        throw "No model IDs were returned by /models."
    }
    Pass "model discovery returned: $($modelIds -join ', ')"

    $chat = Invoke-JsonPost "$BaseUrl/chat/completions" @{
        model = $Model
        messages = @(
            @{ role = "system"; content = "You are a concise Virexa local worker. Return only the requested value." },
            @{ role = "user"; content = "Return exactly: VIREXA_LOCAL_OK" }
        )
        temperature = 0.1
        max_tokens = 96
        stream = $false
    }
    $chatText = [string]$chat.choices[0].message.content
    if ([string]::IsNullOrWhiteSpace($chatText)) {
        throw "Chat completion returned no content."
    }
    Pass "OpenAI-compatible chat completion works"
    Write-Host "      Response: $($chatText.Trim())" -ForegroundColor DarkGray

    $toolResponse = Invoke-JsonPost "$BaseUrl/chat/completions" @{
        model = $Model
        messages = @(
            @{ role = "system"; content = "You are a tool-using assistant. When a tool can satisfy the request, call it instead of inventing a result." },
            @{ role = "user"; content = "Look up Virexa customer VXR-42. You must use the lookup_virexa_customer function." }
        )
        tools = @(
            @{
                type = "function"
                function = @{
                    name = "lookup_virexa_customer"
                    description = "Look up a Virexa customer by customer ID."
                    parameters = @{
                        type = "object"
                        properties = @{
                            customer_id = @{ type = "string"; description = "Customer ID" }
                        }
                        required = @("customer_id")
                        additionalProperties = $false
                    }
                }
            }
        )
        tool_choice = "auto"
        parallel_tool_calls = $false
        temperature = 0.1
        max_tokens = 256
        stream = $false
    }

    $toolCalls = @($toolResponse.choices[0].message.tool_calls)
    $validCall = $toolCalls.Count -gt 0 -and $toolCalls[0].function.name -eq "lookup_virexa_customer"
    if ($validCall) {
        Pass "function/tool calling is parsed by llama.cpp"
        Write-Host "      Arguments: $($toolCalls[0].function.arguments)" -ForegroundColor DarkGray
    } elseif ($RequireToolCalling) {
        throw "Chat works, but llama.cpp did not return a parsed tool_call for this model/template."
    } else {
        Warn "chat works, but no parsed tool_call was returned. AIRA chat still works; update llama.cpp or verify the embedded MiniCPM5 tool template before relying on agent tools."
    }

    Write-Host ""
    Write-Host "Virexa Local AI runtime passed the mandatory smoke tests." -ForegroundColor Green
    exit 0
} catch {
    Write-Host ""
    Write-Host "FAIL  $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
