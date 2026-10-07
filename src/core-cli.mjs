import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CodexAdapter } from './adapters/codex.mjs';
import { SqliteStore } from './persistence/sqlite.mjs';
import { ControlCenterCore } from './core/control-center.mjs';
import { acquireLock } from './store.mjs';
import { migrateLegacy } from './core/migration.mjs';

const args = process.argv.slice(2), command = args[0] ?? 'doctor';
const argument = key => { const i = args.indexOf(key); return i < 0 ? null : args[i+1]; };
const output = value => process.stdout.write(JSON.stringify(value)+'\n');
let store, adapter, core, release, ownerRelease, quotaTimer;
try {
  const configPath = argument('--config');
  if (!configPath) throw new Error('core-config-required');
  const config = JSON.parse(fs.readFileSync(configPath,'utf8'));
  if (![config.codexBin, config.codexHome, config.asarPath, config.stateDirectory].every(p => typeof p === 'string' && path.isAbsolute(p))) throw new Error('invalid-core-config');
  adapter = new CodexAdapter(config);
  if (command === 'doctor') output(await adapter.doctor({ threadId: argument('--thread') }));
  else if (['run','sidecar','status','history','migrate'].includes(command)) {
    if(['run','sidecar'].includes(command))ownerRelease=acquireLock(path.join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? config.stateDirectory,'CodexControlCenter','owner'));
    release = acquireLock(config.stateDirectory);
    store = new SqliteStore(path.join(config.stateDirectory,'control-center.sqlite'));
    if(command==='migrate')output(migrateLegacy(store,config.legacyStateDirectory,{dryRun:!args.includes('--apply')}));
    else {
    core = new ControlCenterCore({ adapter, store, settings: config.settings ?? {}, execute: args.includes('--execute') });
    if (command === 'status') output(core.snapshot());
    else if (command === 'history') output(store.queryQuotaHistory({ since: Number(argument('--since') ?? 0) }));
    else {
      let stop = false;
      const finish = () => { stop = true; core.stopped = true; };
      process.on('SIGINT',finish); process.on('SIGTERM',finish);
      // Quota checks continue independently while slow desktop thread reads are pending.
      quotaTimer=setInterval(()=>{ void core.pollQuota().catch(error=>output({method:'quota/error',params:{reason:error.message}})); },250);
      if (command === 'sidecar') {
        // Local stdio only: every command is correlated; no TCP server or credentials.
        const lines = readline.createInterface({ input: process.stdin });
        lines.on('close',finish);
        let requests = Promise.resolve();
        lines.on('line', line => {
          requests = requests.then(async () => {
            let request;
            try {
              if (line.length > 65536) throw new Error('sidecar-request-too-large');
              request = JSON.parse(line); let result;
              if (request.method === 'snapshot') result = core.snapshot();
              else if (request.method === 'settings/update') result = core.setSettings(request.params ?? {});
              else if (request.method === 'thread/policy') result = core.setThreadPolicy(request.params.threadId, request.params.update);
              else if (request.method === 'quota/history') result = store.queryQuotaHistory(request.params ?? {});
              else if (request.method === 'events/list') result = store.events();
              else if (request.method === 'doctor') result = await adapter.doctor(request.params ?? {});
              else if (request.method === 'refresh') { core.nextQuotaPollAt=0; core.nextScanAt=0; result=await core.tick(); }
              else if (request.method === 'shutdown') { result={ stopping:true }; finish(); }
              else throw new Error('unknown-sidecar-method');
              output({ id: request.id ?? null, result });
            } catch (error) { output({ id: request?.id ?? null, error: { message:error.message } }); }
          });
        });
      }
      while (!stop) { const snapshot=await core.tick(); if (command==='sidecar') output({ method:'snapshot/updated',params:snapshot }); await new Promise(resolve=>setTimeout(resolve,1000)); }
    }
    }
  } else throw new Error('usage: doctor | status | history | run | sidecar --config FILE [--execute]');
} catch (error) { output({ ok:false,error:error.message }); process.exitCode=1; }
finally { if(quotaTimer)clearInterval(quotaTimer); if (core) await core.close(); else if (adapter) await adapter.close(); store?.close(); release?.(); ownerRelease?.(); }
