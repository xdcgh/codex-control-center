[CmdletBinding()]
param([switch]$ObserveOnly)
$ErrorActionPreference = 'Stop'
$taskName = 'CodexQuotaWatchdog'
$taskDescription = 'Codex Quota Watchdog 0.1.0 - resume quota-limited local desktop chats after natural reset + 120 seconds'
$taskRuntime = Join-Path $PSScriptRoot 'runtime'
$taskDirectory = Join-Path $taskRuntime 'state'
$taskConfigFile = Join-Path $taskRuntime 'config.json'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskCodex = (Get-Command codex.exe -ErrorAction Stop).Source
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CodexWatchdogFinalPath {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder result, uint length, uint flags);
}
'@
$taskStream=[IO.File]::Open($taskCodex,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try {
  $taskResolvedPath=New-Object Text.StringBuilder 4096
  if ([CodexWatchdogFinalPath]::GetFinalPathNameByHandle($taskStream.SafeFileHandle.DangerousGetHandle(),$taskResolvedPath,4096,0) -eq 0) { throw 'Cannot resolve the physical Codex executable path.' }
  $taskCodex=$taskResolvedPath.ToString()
  if ($taskCodex.StartsWith('\\?\') -and $taskCodex.Substring(4) -match '^[A-Za-z]:\\') { $taskCodex=$taskCodex.Substring(4) }
} finally { $taskStream.Dispose() }
$taskApp = Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object { $_.ExecutablePath -match 'WindowsApps\\OpenAI.Codex_' } | Select-Object -First 1
if (-not $taskApp) { throw 'Open the installed Codex desktop app before installation.' }
$taskAsar = Join-Path (Split-Path -Parent $taskApp.ExecutablePath) 'resources\app.asar'
$taskCodexHome = Join-Path $env:USERPROFILE '.codex'
$taskHomeItem = Get-Item -LiteralPath $taskCodexHome
if ($taskHomeItem.LinkType -and $taskHomeItem.Target) { $taskCodexHome = [string]@($taskHomeItem.Target)[0] }
$taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($taskExisting -and $taskExisting.Description -notlike 'Codex Quota Watchdog 0.1.0*') { throw 'A scheduled task with this name already exists and is not owned by this project.' }
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskLegacyDirectory = Join-Path $env:LOCALAPPDATA 'CodexQuotaWatchdog'
foreach ($taskStateName in @('state.json','status.json','events.jsonl')) {
  $taskLegacyFile = Join-Path $taskLegacyDirectory $taskStateName
  $taskNewFile = Join-Path $taskDirectory $taskStateName
  if ((Test-Path -LiteralPath $taskLegacyFile) -and -not (Test-Path -LiteralPath $taskNewFile)) { Copy-Item -LiteralPath $taskLegacyFile -Destination $taskNewFile }
}
$taskConfig = [ordered]@{schemaVersion=1;nodeBin=$taskNode;codexBin=$taskCodex;codexHome=$taskCodexHome;asarPath=$taskAsar;stateDirectory=$taskDirectory;resetBufferSeconds=120;pollSeconds=30;scope='observed-running-local-root-chats';timezone='Asia/Shanghai'}
if (Test-Path -LiteralPath $taskConfigFile) { Copy-Item -LiteralPath $taskConfigFile -Destination (Join-Path $taskDirectory ('config-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) }
[IO.File]::WriteAllText($taskConfigFile, ($taskConfig | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
& $taskNode --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'src\cli.mjs') doctor --config $taskConfigFile
if ($LASTEXITCODE -ne 0) { throw 'Read-only compatibility check failed; background execution was not enabled.' }
$taskControl = @{enabled=$true;stop=$false;updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
[IO.File]::WriteAllText((Join-Path $taskDirectory 'control.json'), ($taskControl | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
if ($ObserveOnly) {
  & $taskNode --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'src\cli.mjs') run --config $taskConfigFile
  exit $LASTEXITCODE
}
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskActionArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start-Watchdog.ps1') + '" -ConfigPath "' + $taskConfigFile + '"'
$taskAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $taskActionArgs -WorkingDirectory $PSScriptRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskIdentity
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskIdentity -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description $taskDescription -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output ('Installed and started ' + $taskName)
