import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { atomicWrite } from '../src/store.mjs';

const output=process.argv[2];if(!output||!path.isAbsolute(output))throw new Error('absolute-config-output-required');
if(fs.existsSync(output)){console.log(JSON.stringify({found:true}));process.exit(0);}
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
let discovered;try{const peer=JSON.parse(execFileSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'Get-DesktopOwner.ps1')],{encoding:'utf8',windowsHide:true,timeout:10000}));if(!peer.image||!peer.backends?.length)throw new Error('desktop-backend-unavailable');discovered={asarPath:path.join(path.dirname(peer.image),'resources','app.asar'),codexBin:peer.backends[0]};}catch{throw new Error('open-codex-desktop-and-sign-in-before-starting');}
const directory=path.dirname(output);
const config={schemaVersion:2,installationMode:'fresh',codexBin:fs.realpathSync(discovered.codexBin),codexHome:fs.realpathSync(process.env.CODEX_HOME??path.join(os.homedir(),'.codex')),asarPath:discovered.asarPath,stateDirectory:path.join(directory,'state'),settings:{autoResume:false,recoveryPollSeconds:10,historySampleSeconds:60}};
atomicWrite(output,config);console.log(JSON.stringify({discovered:true,mode:'observe'}));
