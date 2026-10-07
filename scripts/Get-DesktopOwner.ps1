$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WatchdogPeerNative {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint id);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
  $taskPipe = New-Object IO.Pipes.NamedPipeClientStream('.', 'codex-ipc', [IO.Pipes.PipeDirection]::InOut)
  try {
    $taskPipe.Connect(1200)
    [uint32]$taskPeerPid=0
    if (-not [WatchdogPeerNative]::GetNamedPipeServerProcessId($taskPipe.SafePipeHandle.DangerousGetHandle(),[ref]$taskPeerPid)) { throw 'Cannot identify desktop pipe owner.' }
    $taskProcessHandle=[WatchdogPeerNative]::OpenProcess(0x1000,$false,$taskPeerPid)
    if ($taskProcessHandle -eq [IntPtr]::Zero) { throw 'Cannot inspect desktop pipe owner.' }
    try {
      $taskNameBuffer=New-Object Text.StringBuilder 4096
      [uint32]$taskNameSize=4096
      if (-not [WatchdogPeerNative]::QueryFullProcessImageName($taskProcessHandle,0,$taskNameBuffer,[ref]$taskNameSize)) { throw 'Cannot read desktop image path.' }
      $taskImage=$taskNameBuffer.ToString()
    } finally { [WatchdogPeerNative]::CloseHandle($taskProcessHandle) | Out-Null }
  } finally { $taskPipe.Dispose() }
  $taskProcesses=Get-CimInstance Win32_Process
  $taskAppIds=@($taskProcesses | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -eq $taskImage} | ForEach-Object {$_.ProcessId})
  $taskBackends=@($taskProcesses | Where-Object {$_.Name -eq 'codex.exe' -and $_.ParentProcessId -in $taskAppIds} | ForEach-Object {$_.ExecutablePath})
  @{pid=$taskPeerPid;image=$taskImage;backends=$taskBackends} | ConvertTo-Json -Compress
} catch { Write-Output '{"unavailable":true}'; exit 2 }
