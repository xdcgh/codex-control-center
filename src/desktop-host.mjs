import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isUuid } from './policy.mjs';

export function verifyCurrentDesktop(config) {
  const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = path.resolve(import.meta.dirname, '../scripts/Get-DesktopOwner.ps1');
  const reply = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
  if (reply.status !== 0) throw new Error('desktop-unavailable');
  let owner; try { owner = JSON.parse(reply.stdout.trim()); } catch { throw new Error('desktop-owner-unavailable'); }
  if (path.basename(owner.image ?? '').toLowerCase() !== 'chatgpt.exe') throw new Error('desktop-owner-not-supported');
  const runningAsar = path.join(path.dirname(owner.image), 'resources/app.asar');
  if (path.resolve(runningAsar).toLowerCase() !== path.resolve(config.asarPath).toLowerCase()) throw new Error('desktop-version-needs-adaptation');
  if (!owner.backends?.length) throw new Error('desktop-backend-not-ready');
  const cache = path.basename(path.dirname(config.codexBin)).toLowerCase();
  if (!owner.backends.some((file) => path.basename(path.dirname(file)).toLowerCase() === cache)) throw new Error('cli-version-needs-adaptation');
  return { peerPid: owner.pid };
}

export function openExistingThread(threadId) {
  if (!isUuid(threadId)) throw new Error('invalid-thread-link');
  const child = spawn(path.join(process.env.SystemRoot, 'explorer.exe'), [`codex://threads/${threadId}`], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}
