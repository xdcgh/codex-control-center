import path from 'node:path';
import { readJson } from '../store.mjs';

export function inspectLegacyMigration(directory) {
  const control=readJson(path.join(directory,'control.json'),null);
  const state=readJson(path.join(directory,'state.json'),null);
  if(!state || state.schemaVersion!==1 || !state.records || !state.ledger) throw new Error('invalid-legacy-state');
  const lock=readJson(path.join(directory,'daemon.lock'),null);
  let legacyAlive=false;
  if(lock){ if(!Number.isSafeInteger(lock.pid)||lock.pid<=0)throw new Error('legacy-lock-invalid');try{process.kill(lock.pid,0);legacyAlive=true;}catch(error){if(error.code!=='ESRCH')legacyAlive=true;} }
  return{state,ready:control?.enabled===false&&control?.stop===true&&!legacyAlive,legacyAlive,waiting:Object.values(state.records).filter(r=>r.failureTurnId).length,intents:Object.keys(state.ledger).length};
}

export function migrateLegacy(store,directory,{dryRun=true}={}) {
  const report=inspectLegacyMigration(directory);
  if(dryRun)return{dryRun:true,ready:report.ready,legacyAlive:report.legacyAlive,waiting:report.waiting,intents:report.intents};
  if(!report.ready)throw new Error('legacy-watchdog-must-be-stopped-before-migration');
  if(store.getSetting('legacy-import') || Object.keys(store.load().records).length || Object.keys(store.load().ledger).length)throw new Error('migration-destination-must-be-empty');
  // The original files remain untouched. Never clear uncertain delivery intents.
  const state=structuredClone(report.state);
  for(const record of Object.values(state.records))if(record.failureTurnId)record.notBeforeMs=0;
  store.save(state);
  store.setSetting('enrollment-since',Date.parse(state.startedAt)||Date.now());
  store.setSetting('legacy-import',{importedAt:Date.now(),records:Object.keys(state.records).length,intents:report.intents});
  store.event('legacy-state-imported',{records:Object.keys(state.records).length,intents:report.intents});
  return{dryRun:false,imported:true,waiting:report.waiting,intents:report.intents};
}
