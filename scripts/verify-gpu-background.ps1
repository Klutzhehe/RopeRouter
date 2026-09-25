$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$destination = Join-Path (Get-Location) 'artifacts/solver-audit/gpu-verification'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$statusPath = Join-Path $destination 'status.json'
function Save-Status($state, $detail) {
    @{ state = $state; detail = $detail; updated = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statusPath
}
function Invoke-LoggedNative {
    param([string]$Executable, [string[]]$NativeArguments, [string]$LogPath)
    # Windows PowerShell 5 turns redirected native stderr into ErrorRecords.
    # Warnings must not abort pip/node; their process exit code is authoritative.
    $ErrorActionPreference = 'Continue'
    & $Executable @NativeArguments *> $LogPath
    $nativeExitCode = $LASTEXITCODE
    if ($nativeExitCode -ne 0) { throw "Native process exited ${nativeExitCode}; see $LogPath" }
}
try {
    Save-Status 'running' 'Installing CUDA dependencies, then comparing CPU and GPU routing.'
    $pythonPath = Join-Path (Get-Location) '.venv-gpu/Scripts/python.exe'
    if (!(Test-Path -LiteralPath $pythonPath)) {
        & python -m venv --system-site-packages .venv-gpu
        if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
    }
    Invoke-LoggedNative $pythonPath @('-m', 'pip', 'install', '--timeout', '120', '--retries', '3', 'cupy-cuda12x==13.6.0', 'nvidia-cuda-runtime-cu12==12.6.77', 'nvidia-cuda-nvrtc-cu12==12.6.85') (Join-Path $destination 'install.log')
    $env:ROUTER_PYTHON = $pythonPath
    Invoke-LoggedNative 'node' @('scripts/gpu-parity.mjs', "$destination/parity") (Join-Path $destination 'parity.log')
    foreach ($backend in @('cpu', 'cuda')) {
        Invoke-LoggedNative 'node' @('scripts/run-colab.mjs', "--backend=$backend", '--cases=[[42017,16,2]]', "--output=$destination/$backend") (Join-Path $destination "$backend.log")
    }
    $cpuResult = (Get-Content -LiteralPath "$destination/cpu/status.json" -Raw | ConvertFrom-Json).results[0]
    $gpuResult = (Get-Content -LiteralPath "$destination/cuda/status.json" -Raw | ConvertFrom-Json).results[0]
    $comparison = @{
        identicalState = $cpuResult.stateSha256 -eq $gpuResult.stateSha256
        bothSolved = $cpuResult.passed -and $gpuResult.passed
        cpuMs = $cpuResult.elapsedMs
        cudaMs = $gpuResult.elapsedMs
        speedup = $cpuResult.elapsedMs / [Math]::Max(1, $gpuResult.elapsedMs)
    }
    $comparison | ConvertTo-Json | Set-Content -LiteralPath "$destination/comparison.json"
    if (!$comparison.identicalState -or !$comparison.bothSolved) { throw 'CPU/GPU end-to-end equivalence failed' }
    Save-Status 'passed' 'Parity and the 16-net CPU/GPU comparison passed. See comparison.json for measured timing; this is not a large-board benchmark.'
} catch {
    Save-Status 'failed' ([string]$_)
    exit 1
}
