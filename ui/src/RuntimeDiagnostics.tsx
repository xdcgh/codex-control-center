import {t,display,dateText,numberText,errorText,useLocale} from './i18n';
import {useEffect,useState} from 'react';
type Overview={rows:{label:string;source:string;observedAt:number|null;ageMs:number|null;freshness:string;coverage:string;reason:string}[];coverage:{ledger:string;records:number|null;missingTotalTokens:number|null;missingModel:number|null}[]|null;limits:string[]};
export async function loadDiagnosticsInventory(request:(method:string)=>Promise<unknown>,commit:(update:{data?:Overview;error:string})=>void){
 try{const data=await request('diagnostics/overview') as Overview;if(!data||!Array.isArray(data.rows)||!Array.isArray(data.limits)||!(data.coverage===null||Array.isArray(data.coverage)))throw Error('Diagnostic inventory response is unavailable');commit({data,error:''});}catch(error){commit({error:String(error)});}
}
const ledgerNames:Record<string,string>={response:'Response ledger','cumulative-delta':'Cumulative delta ledger','latest-sample':'Latest sample ledger','baseline-counter-inventory':'Baseline counter inventory'};
export function DiagnosticsInventory({data}:{data:Overview}){
 useLocale();
 return <><div className="table-scroll"><table><thead><tr><th>{t('Diagnostic item')}</th><th>{t('Source')}</th><th>{t('Recorded time')}</th><th>{t('Freshness')}</th><th>{t('Observed coverage')}</th><th>{t('Evidence limits')}</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.label}><td>{display(row.label)}</td><td>{display(row.source)}</td><td>{dateText(row.observedAt)}</td><td>{display(row.freshness)}{row.ageMs!=null&&<small> · {t('{seconds} seconds old',{seconds:numberText(Math.floor(row.ageMs/1000))})}</small>}</td><td>{display(row.coverage)}</td><td>{row.observedAt==null&&<>{t('No recorded observation time')} · </>}{display(row.reason)}</td></tr>)}</tbody></table></div>
 <h3>{t('Separate observed ledgers')}</h3><p className="caption">{t('Record counts describe local coverage, not a reconciled token total. Baseline counters are excluded from additive consumption.')}</p>
 {data.coverage?<table><thead><tr><th>{t('Ledger')}</th><th>{t('Observed records')}</th><th>{t('Missing total tokens')}</th><th>{t('Missing model')}</th></tr></thead><tbody>{data.coverage.map(row=><tr key={row.ledger}><td>{display(ledgerNames[row.ledger]??'Unavailable')}</td><td>{numberText(row.records)}</td><td>{numberText(row.missingTotalTokens)}</td><td>{numberText(row.missingModel)}</td></tr>)}</tbody></table>:<p>{t('Telemetry inventory is unavailable')}</p>}
 <ul>{data.limits.map(limit=><li key={limit}>{display(limit)}</li>)}</ul></>;
}
export function RuntimeDiagnostics({request}:{request:(method:string)=>Promise<unknown>}){
 const [overview,setOverview]=useState<Overview|null>(null),[error,setError]=useState('');
 useLocale();
 const commit=(update:{data?:Overview;error:string})=>{if(update.data)setOverview(update.data);setError(update.error);};
 useEffect(()=>{let active=true;void loadDiagnosticsInventory(request,update=>{if(active)commit(update)});return()=>{active=false;};},[request]);
 const refresh=()=>loadDiagnosticsInventory(request,commit);
 return <section className="panel"><div className="panel-heading"><div><h2>{t('Diagnostic source inventory')}</h2><p className="caption">{t('Recorded timestamps and safe coverage only. Reading this inventory starts no model request or recovery.')}</p></div><button onClick={()=>void refresh()}>{t('Refresh inventory')}</button></div>{error&&<p className="error">{errorText(error)}</p>}{overview&&<DiagnosticsInventory data={overview}/>}</section>;
}
