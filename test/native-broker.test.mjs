import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startBroker } from '../src/core/broker.mjs';
const nativeBin=process.env.CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER;
test('production native helper authenticates and correlates mock-owner requests without starting a WebView or Codex',{skip:process.platform!=='win32'||!nativeBin},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-native-fixture-'));let calls=0;let broker;
 try{
  broker=await startBroker({stateDirectory:directory,nativeBin,route:async()=>({calls:++calls})});
  const descriptor=JSON.parse(fs.readFileSync(broker.descriptorPath,'utf8'));assert.equal(descriptor.rejectRemoteClients,true);
  const socket=net.createConnection(descriptor.pipe);let buffer='',responses=[],waiters=[];
  socket.on('data',bytes=>{buffer+=bytes.toString('utf8');let i;while((i=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);waiters.length?waiters.shift()(value):responses.push(value);}});
  const next=()=>responses.length?Promise.resolve(responses.shift()):new Promise(resolve=>waiters.push(resolve));
  socket.write(JSON.stringify({id:1,method:'authenticate',params:{token:descriptor.token}})+'\n');assert.equal((await next()).result.authenticated,true);
  socket.write(JSON.stringify({id:2,method:'snapshot'})+'\n');assert.deepEqual(await next(),{id:2,result:{calls:1}});socket.destroy();
  const invalid=net.createConnection(descriptor.pipe);const closed=new Promise(resolve=>invalid.once('close',resolve));invalid.on('error',()=>{});invalid.write(JSON.stringify({id:3,method:'snapshot'})+'\n');await closed;assert.equal(calls,1);
 }finally{await broker?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('production native singleton rejects a second owner even when state directories differ',{skip:process.platform!=='win32'||!nativeBin},async()=>{
 const firstDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-singleton-first-')),secondDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-singleton-second-'));let broker;
 try{const singletonScope=`isolated-test:${firstDirectory}`;broker=await startBroker({stateDirectory:firstDirectory,nativeBin,production:true,singletonScope,route:async()=>({})});await assert.rejects(startBroker({stateDirectory:secondDirectory,nativeBin,production:true,singletonScope,route:async()=>({})}),/native-broker-helper-failed/);}finally{await broker?.close();fs.rmSync(firstDirectory,{recursive:true,force:true});fs.rmSync(secondDirectory,{recursive:true,force:true});}
});
