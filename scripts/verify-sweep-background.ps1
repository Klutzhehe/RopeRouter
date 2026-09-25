param([string]$OutputDirectory = 'artifacts/solver-audit/sweep-verification')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
$logRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
$started = (Get-Date).ToUniversalTime().ToString('o')
function Save-Status([string]$state, [string]$current) {
  [ordered]@{ state=$state; started=$started; updated=(Get-Date).ToUniversalTime().ToString('o'); current=$current; results=@($results.ToArray()) } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $logRoot 'status.json') -Encoding UTF8
}
function Run-Check([string]$name, [string[]]$arguments) {
  Save-Status 'running' $name
  $begin=Get-Date
  $log=Join-Path $logRoot ($name+'.log')
  $ErrorActionPreference='Continue'
  & npm.cmd @arguments *> $log
  $exitCode=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  $results.Add([ordered]@{name=$name;exitCode=$exitCode;seconds=[Math]::Round(((Get-Date)-$begin).TotalSeconds,2);log=$log})
  Save-Status 'running' $name
}
try {
  Run-Check 'unit-tests' @('test')
  Run-Check 'build' @('run','build')
  Run-Check 'browser-tests' @('run','test:ui')
  Run-Check 'scale' @('run','test:scale','--',(Join-Path $logRoot 'scale'))
  $failed=@($results | Where-Object {$_.exitCode -ne 0}).Count
  $state=if($failed){'completed-with-failures'}else{'passed'}
  Save-Status $state ''
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $logRoot 'runner-error.log')
  Save-Status 'runner-error' $_.Exception.Message
  exit 1
}
