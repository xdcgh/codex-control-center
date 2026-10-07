param([Parameter(Mandatory=$true)][int]$PidValue,[Parameter(Mandatory=$true)][string]$ClaimedStartedAt)
$ErrorActionPreference='Stop'
$taskClaim=[DateTimeOffset]::Parse($ClaimedStartedAt).UtcDateTime
$taskBoot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
$taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PidValue)
$taskAlive=$null -ne $taskProcess -and $taskClaim -ge $taskBoot
if($taskAlive -and $taskProcess.CreationDate.ToUniversalTime() -gt $taskClaim.AddSeconds(2)){$taskAlive=$false}
@{alive=$taskAlive;stale=(-not $taskAlive)}|ConvertTo-Json -Compress
