$ErrorActionPreference='Stop'
$value=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if($value.ProxyEnable -eq 1 -and $value.ProxyServer){[pscustomobject]@{server=[string]$value.ProxyServer;bypass=[string]$value.ProxyOverride}|ConvertTo-Json -Compress}else{'{}'}
