import fs from 'node:fs';import path from 'node:path';
import { acquireLock,readJson } from '../store.mjs';import { resolveOwnerAnchor,inspectOwnerLease } from './ownership.mjs';import { SqliteStore } from '../persistence/sqlite.mjs';
export function recoverOffline({config,backupFile,confirmed=false,ownerDirectory}){
 if(!confirmed)throw new Error('database-recovery-confirmation-required');
 ownerDirectory??=resolveOwnerAnchor({create:true});
 const file=path.resolve(config.stateDirectory,'control-center.sqlite'),release=acquireLock(ownerDirectory,{isOwnerAlive:owner=>inspectOwnerLease({directory:ownerDirectory,owner}).alive});
 try{
  const verifyOffline=target=>{
   if(path.resolve(target)!==file)throw new Error('database-recovery-target-mismatch');
   const lease=readJson(path.join(ownerDirectory,'daemon.lock'),null);if(lease?.pid!==process.pid)throw new Error('database-recovery-maintenance-lease-lost');
   for(const relative of ['daemon.lock','broker/owner.json']){const ownerFile=path.join(config.stateDirectory,relative);if(!fs.existsSync(ownerFile))continue;const owner=readJson(ownerFile);const alive=inspectOwnerLease({directory:config.stateDirectory,owner}).alive;if(alive)throw new Error('database-recovery-live-owner');if(relative==='daemon.lock'){const fresh=readJson(ownerFile);if(fresh.token!==owner.token||fresh.pid!==owner.pid)throw new Error('database-recovery-owner-changed');fs.unlinkSync(ownerFile);}else{
    // A stale descriptor is evidence, not a credential to reuse. Preserve it alongside the recovery inputs.
    fs.renameSync(ownerFile,ownerFile+`.stale-recovery-${Date.now()}`);
   }}
   return{database:file,verified:true,activeOwners:0};
  };
  verifyOffline(file);return SqliteStore.recoverDatabase({file,backupFile:path.resolve(backupFile),confirmed:true,quiescent:true,verifyOffline});
 }finally{release();}
}
