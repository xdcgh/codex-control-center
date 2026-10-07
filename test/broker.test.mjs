import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startBroker,MAX_MESSAGE_BYTES } from '../src/core/broker.mjs';

async function fixture(action){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-broker-fixture-'));let calls=0;const broker=await startBroker({stateDirectory:directory,route:async()=>({calls:++calls})});const descriptor=JSON.parse(fs.readFileSync(broker.descriptorPath,'utf8'));try{await action({descriptor,broker,calls:()=>calls});}finally{await broker.close();fs.rmSync(directory,{recursive:true,force:true});}}
function client(pipe){const socket=net.createConnection(pipe);let buffer='',queue=[],waiters=[];socket.on('data',bytes=>{buffer+=bytes.toString('utf8');let index;while((index=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);if(waiters.length)waiters.shift()(value);else queue.push(value);}});socket.on('error',()=>{});return{socket,next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiters.push(resolve)),send:value=>socket.write(JSON.stringify(value)+'\n')};}
test('broker denies unauthenticated and incorrect-token requests without invoking any handler',async()=>fixture(async({descriptor,calls})=>{
 for(const request of [{id:1,method:'snapshot'},{id:2,method:'authenticate',params:{token:'0'.repeat(64)}}]){const c=client(descriptor.pipe);const closed=new Promise(resolve=>c.socket.once('close',resolve));c.send(request);await closed;assert.equal(calls(),0);}
}));
test('authenticated local JSON-lines clients are correlated and descriptor removed on close',async()=>fixture(async({descriptor,broker,calls})=>{
 assert.match(descriptor.token,/^[0-9a-f]{64}$/);const c=client(descriptor.pipe);c.send({id:7,method:'authenticate',params:{token:descriptor.token}});assert.equal((await c.next()).result.authenticated,true);c.send({id:8,method:'snapshot'});assert.deepEqual(await c.next(),{id:8,result:{calls:1}});assert.equal(calls(),1);c.socket.destroy();await broker.close();assert.equal(fs.existsSync(broker.descriptorPath),false);
}));
test('oversized pipe messages are disconnected before routing',async()=>fixture(async({descriptor,calls})=>{
 const c=client(descriptor.pipe);const closed=new Promise(resolve=>c.socket.once('close',resolve));c.socket.write('x'.repeat(MAX_MESSAGE_BYTES+1));await closed;assert.equal(calls(),0);
}));
