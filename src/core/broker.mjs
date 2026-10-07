import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync,spawn } from 'node:child_process';
import { atomicWrite } from '../store.mjs';

export const MAX_MESSAGE_BYTES=65536, MAX_CLIENTS=8;
let cachedUserSid;
function protectDirectory(directory) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(process.platform==='win32') {
    try {
      const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
      const sid=cachedUserSid??execFileSync(powershell,['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true,encoding:'utf8',timeout:20000}).trim();
      if(!/^S-1-5-\d+(?:-\d+)+$/.test(sid))throw new Error('invalid-user-sid');
      cachedUserSid=sid;
      execFileSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','/deny','*S-1-5-2:(OI)(CI)F'],{windowsHide:true,stdio:'ignore',timeout:20000});
      return sid;
    } catch { throw new Error('broker-user-acl-unavailable'); }
  } else fs.chmodSync(directory,0o700);
}

export async function startBroker({stateDirectory,route,timeoutMs=10000,nativeBin,onFatal=()=>{},production=false,singletonScope='global-owner-v1'}) {
  const directory=path.join(stateDirectory,'broker'),identity=protectDirectory(directory);
  const descriptorPath=path.join(directory,'owner.json');
  const token=randomBytes(32).toString('hex');
  const hash=createHash('sha256').update(production&&identity?`production-owner:${identity}:${singletonScope}`:path.resolve(stateDirectory).toLowerCase()).digest('hex').slice(0,24);
  const pipe=process.platform==='win32'?`\\\\.\\pipe\\codex-control-center-${hash}`:path.join(directory,'owner.sock');
  if(nativeBin)return startNativeBroker({nativeBin,pipe,token,descriptorPath,route,onFatal});
  const expected=Buffer.from(token,'hex');const clients=new Set();let closed=false;
  if(process.platform!=='win32'&&fs.existsSync(pipe))fs.unlinkSync(pipe);
  const server=net.createServer(socket=>{
    if(clients.size>=MAX_CLIENTS){socket.destroy();return;}
    clients.add(socket);let authenticated=false,buffer=Buffer.alloc(0),requests=Promise.resolve(),queued=0;
    socket.setTimeout(timeoutMs,()=>socket.destroy());
    socket.on('error',()=>{});socket.on('close',()=>clients.delete(socket));
    const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
    socket.on('data',bytes=>{
      buffer=Buffer.concat([buffer,bytes]);
      if(buffer.length>MAX_MESSAGE_BYTES*16){socket.destroy();return;}
      let index;
      while((index=buffer.indexOf(10))>=0){
        if(index+1>MAX_MESSAGE_BYTES){socket.destroy();return;}
        const line=buffer.subarray(0,index).toString('utf8');buffer=buffer.subarray(index+1);
        if(++queued>16){socket.destroy();return;}
        requests=requests.then(async()=>{
          let request;
          try {
            request=JSON.parse(line);
            if(!authenticated){
              const supplied=typeof request.params?.token==='string'&&/^[0-9a-f]{64}$/.test(request.params.token)?Buffer.from(request.params.token,'hex'):Buffer.alloc(32);
              if(request.method!=='authenticate'||!timingSafeEqual(expected,supplied)){send({id:request.id??null,error:{message:'broker-authentication-required'}});socket.destroy();return;}
              authenticated=true;send({id:request.id??null,result:{authenticated:true}});return;
            }
            if(request.method==='authenticate')throw new Error('already-authenticated');
            send({id:request.id??null,result:await route(request)});
          } catch(error){send({id:request?.id??null,error:{message:error.message}});if(!authenticated)socket.destroy();}
        }).catch(()=>socket.destroy()).finally(()=>{queued--;});
      }
      if(buffer.length>=MAX_MESSAGE_BYTES){socket.destroy();return;}
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',()=>reject(new Error('broker-listen-failed')));server.listen({path:pipe,readableAll:false,writableAll:false},resolve);});
  atomicWrite(descriptorPath,{schemaVersion:1,transport:'local-named-pipe',pipe,token,pid:process.pid});
  return{descriptorPath,async close(){if(closed)return;closed=true;for(const socket of clients)socket.destroy();await new Promise(resolve=>server.close(resolve));try{const current=JSON.parse(fs.readFileSync(descriptorPath,'utf8'));if(current.pid===process.pid&&current.token===token)fs.unlinkSync(descriptorPath);}catch{}if(process.platform!=='win32'){try{fs.unlinkSync(pipe);}catch{}}}};
}

async function startNativeBroker({nativeBin,pipe,token,descriptorPath,route,onFatal}) {
 if(process.platform!=='win32'||!path.isAbsolute(nativeBin)||!fs.existsSync(nativeBin))throw new Error('native-broker-helper-unavailable');
 const child=spawn(nativeBin,['--pipe-broker-helper'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 let buffer='',closed=false,ready=false;
 await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(new Error('native-broker-helper-timeout'));},10000);
   child.on('error',()=>{clearTimeout(timer);reject(new Error('native-broker-helper-failed'));});
   child.on('exit',()=>{clearTimeout(timer);if(!ready)reject(new Error('native-broker-helper-failed'));else if(!closed)onFatal();});
   child.stdout.on('data',bytes=>{
     buffer+=bytes.toString('utf8');if(buffer.length>1024*1024){child.kill();return;}let index;
     while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line);}catch{child.kill();return;}
       if(message.event==='ready'&&message.rejectRemoteClients===true){ready=true;clearTimeout(timer);resolve();continue;}
       if(message.brokerId&&message.request){void(async()=>{let response;try{response={id:message.request.id??null,result:await route(message.request)};}catch(error){response={id:message.request.id??null,error:{message:error.message}};}if(!closed&&child.stdin.writable)child.stdin.write(JSON.stringify({brokerId:message.brokerId,response})+'\n');})();}
     }
   });
   child.stdin.on('error',()=>{});
   child.stdin.write(JSON.stringify({pipe,token})+'\n');
 });
 atomicWrite(descriptorPath,{schemaVersion:1,transport:'local-named-pipe',rejectRemoteClients:true,pipe,token,pid:process.pid});
 return{descriptorPath,async close(){if(closed)return;closed=true;child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},1500);child.once('exit',()=>{clearTimeout(timer);resolve();});});try{const descriptor=JSON.parse(fs.readFileSync(descriptorPath,'utf8'));if(descriptor.token===token)fs.unlinkSync(descriptorPath);}catch{}}};
}
