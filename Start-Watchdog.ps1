[CmdletBinding()]
param([string]$ConfigPath = (Join-Path $PSScriptRoot 'runtime\config.json'))
$ErrorActionPreference = 'Stop'
$taskRuntime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskLauncherLog = Join-Path $taskRuntime 'launcher.log'
try {
  $taskLaunchInfo = @{time=[DateTimeOffset]::Now.ToString('o');user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;localAppData=$env:LOCALAPPDATA;userProfile=$env:USERPROFILE}
  Add-Content -LiteralPath $taskLauncherLog -Value ($taskLaunchInfo | ConvertTo-Json -Compress)
  $taskConfig = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
  $taskNode = $taskConfig.nodeBin
  if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Configured Node executable is missing.' }
  & $taskNode --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'src\cli.mjs') run --execute --config $ConfigPath *>> $taskLauncherLog
  exit $LASTEXITCODE
} catch {
  Add-Content -LiteralPath $taskLauncherLog -Value ($_ | Out-String)
  exit 1
}
