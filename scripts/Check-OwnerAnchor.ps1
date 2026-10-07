param([Parameter(Mandatory=$true)][string]$Base,[Parameter(Mandatory=$true)][string]$Anchor,[switch]$NewBase,[switch]$NewAnchor)
$ErrorActionPreference='Stop'
$taskOwnerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($taskDirectory in @($Base,$Anchor)) {
  if([IO.Directory]::Exists($taskDirectory)) {
    $taskAttributes=[IO.File]::GetAttributes($taskDirectory)
    if($taskAttributes -band [IO.FileAttributes]::ReparsePoint){throw 'owner-anchor-reparse-rejected'}
    $taskAcl=[IO.Directory]::GetAccessControl($taskDirectory)
    if(($NewBase -and $taskDirectory -eq $Base) -or ($NewAnchor -and $taskDirectory -eq $Anchor)) {
      $taskAcl.SetOwner($taskOwnerSid)
      [IO.Directory]::SetAccessControl($taskDirectory,$taskAcl)
      $taskAcl=[IO.Directory]::GetAccessControl($taskDirectory)
    }
    $taskOwner=$taskAcl.GetOwner([Security.Principal.SecurityIdentifier])
    if($taskOwner.Value -ne $taskOwnerSid.Value){throw 'owner-anchor-foreign-owner-rejected'}
  }
}
Write-Output $taskOwnerSid.Value
