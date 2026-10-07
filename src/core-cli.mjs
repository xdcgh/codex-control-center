import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CodexAdapter } from './adapters/codex.mjs';
import { SqliteStore } from './persistence/sqlite.mjs';
import { ControlCenterCore } from './core/control-center.mjs';
import { acquireLock } from './store.mjs';
import { migrateLegacy } from './core/migration.mjs';
import { startBroker } from './core/broker.mjs';
import { createRouter } from './core/router.mjs';
import { ObservabilityClient } from './core/observability-client.mjs';
import { resolveOwnerAnchor,inspectOwnerLease } from './core/ownership.mjs';
import { brokerRequest } from './core/broker-client.mjs';
import { NaturalCycleRecorder } from './observability/natural-cycle.mjs';
import { backfillAutomaticRecoveryEvents } from './core/natural-backfill.mjs';
import { recoverOffline } from './core/offline-recovery.mjs';

const args = process.argv.slice(2), command = args[0] ?? 'doctor';
const argument = key => { const i = args.indexOf(key); return i < 0 ? null : args[i+1]; };
const output = value => process.stdout.write(JSON.stringify(value)+'\n');
let store, adapter, core, release, ownerRelease, quotaTimer, broker,observability;
try {
  const profileRoot=path.dirname(resolveOwnerAnchor());
  const bindingFile=path.join(profileRoot,'config-binding.json');
  const binding=fs.existsSync(bindingFile)?JSON.parse(fs.readFileSync(bindingFile,'utf8')).config:null;
  const defaultConfig=[binding,path.join(profileRoot,'config.json'),path.resolve(import.meta.dirname,'../runtime/config.json')].find(file=>typeof file==='string'&&fs.existsSync(file));
  const configPath = argument('--config')??process.env.CODEX_CONTROL_CENTER_CONFIG??defaultConfig;
  if (!configPath) throw new Error('core-config-required');
  const config = JSON.parse(fs.readFileSync(configPath,'utf8'));
  if (![config.codexBin, config.codexHome, config.asarPath, config.stateDirectory].every(p => typeof p === 'string' && path.isAbsolute(p))) throw new Error('invalid-core-config');
  const ownerDescriptor=path.join(config.stateDirectory,'broker','owner.json');
  if(command==='database-recover'){if(!argument('--backup'))throw new Error('database-recovery-backup-required');output(recoverOffline({config,backupFile:argument('--backup'),confirmed:args.includes('--confirm')}));}
  else if(['status','history','doctor','shutdown','natural-report','pricing-snapshots','pricing-check','pricing-override','database-backup','database-acknowledge'].includes(command)&&fs.existsSync(ownerDescriptor)){
    const method={status:'snapshot',history:'quota/history',doctor:'doctor',shutdown:'shutdown','natural-report':'natural/report','pricing-snapshots':'pricing/snapshots','pricing-check':'pricing/check','pricing-override':'pricing/override','database-backup':'database/backup','database-acknowledge':'database/acknowledge'}[command];
    const params={...(['doctor','natural-report','database-acknowledge'].includes(command)&&argument('--thread')?{threadId:argument('--thread')}:{ }),...(command==='history'?{since:Number(argument('--since')??0)}:{})};
    if(command==='database-backup')params.destination=argument('--destination');if(command==='database-acknowledge')params.confirmed=args.includes('--confirm');
    if(command==='pricing-override'){if(!argument('--policy'))throw new Error('pricing-policy-file-required');params.policy=JSON.parse(fs.readFileSync(argument('--policy'),'utf8'));params.confirmed=args.includes('--confirm');}
    output(await brokerRequest(config.stateDirectory,method,params));
  } else {
  adapter = new CodexAdapter(config);
  if (command === 'doctor') output(await adapter.doctor({ threadId: argument('--thread') }));
  else if (['run','sidecar','status','history','migrate'].includes(command)) {
    if(['run','sidecar'].includes(command)){const anchor=resolveOwnerAnchor({create:true});ownerRelease=acquireLock(anchor,{isOwnerAlive:owner=>inspectOwnerLease({directory:anchor,owner}).alive});}
    release = acquireLock(config.stateDirectory,{isOwnerAlive:owner=>inspectOwnerLease({directory:config.stateDirectory,owner}).alive});
    store = new SqliteStore(path.join(config.stateDirectory,'control-center.sqlite'));
    if(command==='migrate')output(migrateLegacy(store,config.legacyStateDirectory,{dryRun:!args.includes('--apply')}));
    else {
    const recorder=new NaturalCycleRecorder({store});
    if(['run','sidecar'].includes(command))backfillAutomaticRecoveryEvents(recorder,store);
    core = new ControlCenterCore({ adapter, store, recorder, settings: config.settings ?? {}, execute: args.includes('--execute') });
    if (command === 'status') output(core.snapshot());
    else if (command === 'history') output(store.queryQuotaHistory({ since: Number(argument('--since') ?? 0) }));
    else {
      let stop = false;
      const finish = () => { stop = true; core.stopped = true; };
      process.on('SIGINT',finish); process.on('SIGTERM',finish);
      observability=new ObservabilityClient({database:path.join(config.stateDirectory,'control-center.sqlite'),codexHome:config.codexHome});
      core.observability=observability;
      const route=createRouter({core,store,adapter,observability,recorder,shutdown:finish});
      const nativeBin=process.env.CODEX_CONTROL_CENTER_BROKER_HELPER??config.nativeBrokerBin;
      if(args.includes('--execute')&&!nativeBin)throw new Error('native-broker-helper-required-for-execution');
      broker=await startBroker({stateDirectory:config.stateDirectory,route,nativeBin,onFatal:finish,production:true});
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
              request = JSON.parse(line);const result=await route(request);
              output({ id: request.id ?? null, result });
            } catch (error) { output({ id: request?.id ?? null, error: { message:error.message } }); }
          });
        });
      }
      while (!stop) { const snapshot=await core.tick(); if (command==='sidecar') output({ method:'snapshot/updated',params:snapshot }); await new Promise(resolve=>setTimeout(resolve,1000)); }
    }
    }
  } else throw new Error('usage: doctor | status | history | run | sidecar --config FILE [--execute]');
  }
} catch (error) { output({ ok:false,error:error.message }); process.exitCode=1; }
finally { if(quotaTimer)clearInterval(quotaTimer);if(broker)await broker.close();if(observability)await observability.close(); if (core) await core.close(); else if (adapter) await adapter.close(); store?.close(); release?.(); ownerRelease?.(); }
