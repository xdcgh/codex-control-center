import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
export async function brokerRequest(stateDirectory,method,params={},{timeoutMs=45000}={}) {
 const descriptor=JSON.parse(fs.readFileSync(path.join(stateDirectory,'broker','owner.json'),'utf8'));
 if(process.platform==='win32'&&!descriptor.pipe?.startsWith('\\\\.\\pipe\\codex-control-center-'))throw new Error('non-local-broker-rejected');
 const socket=net.createConnection(descriptor.pipe);let buffer='',sequence=0;const pending=new Map();
 const rejectAll=reason=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(new Error(reason));}pending.clear();};
 socket.on('error',()=>rejectAll('broker-unavailable'));socket.on('close',()=>rejectAll('broker-disconnected'));
 socket.on('data',bytes=>{buffer+=bytes.toString('utf8');if(buffer.length>16*1024*1024){socket.destroy();return;}let index;while((index=buffer.indexOf('\n'))>=0){let response;try{response=JSON.parse(buffer.slice(0,index));}catch{socket.destroy();return;}buffer=buffer.slice(index+1);const waiter=pending.get(response.id);if(!waiter)continue;pending.delete(response.id);clearTimeout(waiter.timer);response.error?waiter.reject(new Error(response.error.message??'broker-request-failed')):waiter.resolve(response.result);}});
 const send=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,line=JSON.stringify({id,method,params})+'\n';if(Buffer.byteLength(line)>65536){reject(new Error('broker-message-too-large'));return;}const timer=setTimeout(()=>{pending.delete(id);reject(new Error('broker-request-timeout'));},timeoutMs);pending.set(id,{resolve,reject,timer});socket.write(line);});
 try{const authenticated=await send('authenticate',{token:descriptor.token});if(authenticated?.authenticated!==true)throw new Error('broker-authentication-rejected');return await send(method,params);}finally{socket.destroy();}
}
