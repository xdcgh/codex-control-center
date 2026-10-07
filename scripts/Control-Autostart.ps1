param([ValidateSet('Status','Disable')][string]$Mode='Status',[string]$BackupDirectory)
$ErrorActionPreference='Stop'
$taskEntry=Get-ScheduledTask -TaskName 'CodexControlCenter' -ErrorAction SilentlyContinue
if(-not $taskEntry){@{present=$false;owned=$false;enabled=$false}|ConvertTo-Json -Compress;exit 0}
$taskCurrentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskPrincipal=[string]$taskEntry.Principal.UserId
try {if($taskPrincipal -match '^S-1-'){ $taskPrincipalSid=$taskPrincipal }else{$taskPrincipalSid=(New-Object Security.Principal.NTAccount($taskPrincipal)).Translate([Security.Principal.SecurityIdentifier]).Value}}catch{$taskPrincipalSid='unknown'}
$taskOwned=$taskEntry.Description.StartsWith('Codex Control Center local execution core ') -and $taskPrincipalSid -eq $taskCurrentSid -and @($taskEntry.Actions | Where-Object {$_.Arguments -match 'codex-control-center|CodexControlCenter|core-cli[.]mjs'}).Count -gt 0
if(-not $taskOwned){throw 'same-name-autostart-task-is-not-owned'}
$taskEnabled=[bool]$taskEntry.Settings.Enabled
if($Mode -eq 'Disable' -and $taskEnabled){
 if(-not $BackupDirectory -or -not [IO.Path]::IsPathRooted($BackupDirectory)){throw 'absolute-owned-backup-directory-required'}
 [IO.Directory]::CreateDirectory($BackupDirectory)|Out-Null
 if([IO.File]::GetAttributes($BackupDirectory) -band [IO.FileAttributes]::ReparsePoint){throw 'backup-directory-reparse-rejected'}
 $taskBackup=Join-Path $BackupDirectory ('CodexControlCenter-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'.xml')
 [IO.File]::WriteAllText($taskBackup,(Export-ScheduledTask -TaskName 'CodexControlCenter'),[Text.UTF8Encoding]::new($false))
 Disable-ScheduledTask -TaskName 'CodexControlCenter'|Out-Null
 $taskEnabled=$false
}
@{present=$true;owned=$true;enabled=$taskEnabled}|ConvertTo-Json -Compress
