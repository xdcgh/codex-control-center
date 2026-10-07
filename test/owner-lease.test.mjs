import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { inspectOwnerLease } from '../src/core/ownership.mjs';import { acquireLock } from '../src/store.mjs';
test('Windows lease proof distinguishes the current process from an old-boot claim with a reused PID',{skip:process.platform!=='win32'},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ccc-lease-fixture-'));
 try{const file=path.join(directory,'daemon.lock');fs.writeFileSync(file,JSON.stringify({pid:process.pid,token:'old-fixture',startedAt:'1970-01-01T00:00:00Z'}));assert.equal(inspectOwnerLease({directory}).alive,false);const release=acquireLock(directory,{isOwnerAlive:owner=>inspectOwnerLease({directory,owner}).alive});assert.equal(inspectOwnerLease({directory}).alive,true);assert.throws(()=>acquireLock(directory,{isOwnerAlive:owner=>inspectOwnerLease({directory,owner}).alive}),/already-running/);release();}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
