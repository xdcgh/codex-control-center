import {t, errorText} from "./i18n";
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
type Request=(method:string,params?:unknown)=>Promise<unknown>;
export function DatabaseRecovery({request}:{request:Request}){
 const [health,setHealth]=useState<unknown>(null);useEffect(()=>{request('snapshot').then(v=>setHealth((v as {database?:unknown}).database??null)).catch(e=>setHealth({error:String(e)}));},[request]);
 const [backup,setBackup]=useState(''),[destination,setDestination]=useState(''),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState<unknown>(null),[busy,setBusy]=useState(false);
 const resultError=result&&typeof result==='object'&&'error' in result?String(result.error):null;
 const healthError=health&&typeof health==='object'&&'error' in health?String(health.error):null;
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{setResult(await fn());}catch(e){setResult({error:String(e)});}finally{setBusy(false);}};
 return <section className="panel"><h2>{t("Database safety and recovery")}</h2><p className="caption">{t("Backup is WAL-consistent. Recovery requires the background owner to be stopped and preserves the replaced database, WAL and SHM. Codex Desktop stays open. Restored state blocks every resume until a fresh Doctor passes and you explicitly acknowledge review; automatic recovery remains off.")}</p>
 {healthError&&<p className="error">{errorText(healthError)}</p>}{health!=null&&<pre>{JSON.stringify(health,null,2)}</pre>}<label>{t("New backup destination")} <input value={destination} onChange={e=>setDestination(e.target.value)}/></label><button disabled={busy||!destination} onClick={()=>void run(()=>request('database/backup',{destination}))}>{t("Create verified backup")}</button>
 <label>{t("Verified backup to restore")} <input value={backup} onChange={e=>setBackup(e.target.value)}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {t("I confirm preserving recovery and will review restored thread policies and ledger before enabling automatic recovery.")}</label>
 <div className="tabs"><button disabled={busy||!confirmed} onClick={()=>void run(()=>request('shutdown'))}>{t("Stop background owner for recovery")}</button><button disabled={busy||!confirmed||!backup} onClick={()=>void run(()=>invoke('recover_database',{backupFile:backup,confirmed}))}>{t("Restore while owner is stopped")}</button><button disabled={busy} onClick={()=>void run(()=>invoke('restart_background'))}>{t("Restart background owner")}</button><button disabled={busy||!confirmed} onClick={()=>void run(()=>request('database/acknowledge',{confirmed}))}>{t("Run fresh Doctor and acknowledge review")}</button></div>{resultError&&<p className="error">{errorText(resultError)}</p>}{result!=null&&<pre>{JSON.stringify(result,null,2)}</pre>}</section>;
}
