$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
& $taskNode --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'src\cli.mjs') stop
if ($LASTEXITCODE -ne 0) { throw 'Could not persist the watchdog stop request.' }
$taskExisting = Get-ScheduledTask -TaskName 'CodexQuotaWatchdog' -ErrorAction SilentlyContinue
if ($taskExisting -and $taskExisting.Description -like 'Codex Quota Watchdog 0.1.0*') { Disable-ScheduledTask -TaskName 'CodexQuotaWatchdog' | Out-Null }
Write-Output 'Watchdog stop requested and its login task disabled. Existing Codex work continues.'
