import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function resolveOwnerAnchor({profile=os.homedir(),create=false}={}) {
  const physicalProfile=fs.realpathSync(profile),base=path.join(physicalProfile,'.codex-control-center'),anchor=path.join(base,'owner');
  for(const directory of [base,anchor]) {
    if(fs.existsSync(directory)){
      const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('owner-anchor-reparse-rejected');
      const physical=fs.realpathSync(directory);
      if(path.resolve(physical).toLowerCase()!==path.resolve(directory).toLowerCase())throw new Error('owner-anchor-canonical-path-mismatch');
    }else if(create)fs.mkdirSync(directory,{mode:0o700});
  }
  if(process.platform==='win32'&&fs.existsSync(base)){
    const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const script=path.resolve(import.meta.dirname,'../../scripts/Check-OwnerAnchor.ps1');
    let sid;try{sid=execFileSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Base',base,'-Anchor',anchor],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:8000}).trim();}catch{throw new Error('owner-anchor-identity-check-failed');}
    if(!/^S-1-5-\d+(?:-\d+)+$/.test(sid))throw new Error('owner-anchor-identity-check-failed');
    if(create)for(const directory of [base,anchor]){try{execFileSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','/deny','*S-1-5-2:(OI)(CI)F'],{windowsHide:true,stdio:'ignore',timeout:8000});}catch{throw new Error('owner-anchor-acl-update-failed');}}
  }
  return anchor;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes('--print-anchor')){
  try{process.stdout.write(JSON.stringify({anchor:resolveOwnerAnchor({create:true})})+'\n');}catch(error){process.stdout.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;}
}
