param([string]$OutputDirectory = 'artifacts/solver-audit/verification')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
$logRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$summaryFile = Join-Path $logRoot 'status.json'
$runLog = Join-Path $logRoot 'run.log'
$results = [System.Collections.Generic.List[object]]::new()
$started = (Get-Date).ToUniversalTime().ToString('o')

function Save-Status([string]$state, [string]$current) {
  [ordered]@{ state = $state; started = $started; updated = (Get-Date).ToUniversalTime().ToString('o'); current = $current; results = @($results.ToArray()) } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryFile -Encoding UTF8
}
function Run-Check([string]$name, [string[]]$arguments) {
  Save-Status 'running' $name
  $logFile = Join-Path $logRoot ($name + '.log')
  $begin = Get-Date
  "[$($begin.ToUniversalTime().ToString('o'))] Starting $name" | Add-Content -LiteralPath $runLog
  # Each command writes to its own file. No UI interaction or agent polling is needed.
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue' # Native stderr (for example browser warnings) is log output.
  & npm.cmd @arguments *> $logFile
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  $results.Add([ordered]@{ name = $name; exitCode = $exitCode; seconds = [Math]::Round(((Get-Date) - $begin).TotalSeconds, 2); log = $logFile })
  "[$((Get-Date).ToUniversalTime().ToString('o'))] Finished $name (exit $exitCode)" | Add-Content -LiteralPath $runLog
  Save-Status 'running' $name
}

try {
  "Verification started $started" | Set-Content -LiteralPath $runLog -Encoding UTF8
  Save-Status 'running' 'unit-tests'
  Run-Check 'unit-tests' @('test')
  Run-Check 'build' @('run', 'build')
  Run-Check 'browser-tests' @('run', 'test:ui')
  Run-Check 'lifecycle' @('run', 'test:lifecycle', '--', (Join-Path $logRoot 'lifecycle'))
  Run-Check 'diagnostics' @('run', 'diagnose', '--', '100', (Join-Path $logRoot 'diagnostics'))
  Run-Check 'full-trace' @('run', 'diagnose', '--', '5', (Join-Path $logRoot 'trace'), '--case=crossing-1-layer', '--full')
  Run-Check 'replay' @('run', 'diagnose', '--', '10', (Join-Path $logRoot 'replay'), ('--input=' + (Join-Path $logRoot 'trace/crossing-1-layer.snapshot.json')))
  $failed = @($results | Where-Object { $_.exitCode -ne 0 }).Count
  $state = if ($failed) { 'completed-with-failures' } else { 'passed' }
  Save-Status $state ''
  "COMPLETE: $state; $failed failed checks. See status.json and individual logs." | Add-Content -LiteralPath $runLog
} catch {
  $_ | Out-String | Add-Content -LiteralPath $runLog
  Save-Status 'runner-error' $_.Exception.Message
  exit 1
}
