import {useEffect,useState} from 'react';
export function RuntimeDiagnostics({request}:{request:(method:string)=>Promise<unknown>}){
 const [telemetry,setTelemetry]=useState<unknown>(null),[events,setEvents]=useState<{id:number;timestamp:number;event:string}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([request('analytics/diagnostics'),request('events/list')]).then(([t,e])=>{if(active){setTelemetry(t);setEvents((e as {id:number;timestamp:number;event:string}[]).slice(0,15));}}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[request]);
 return <section className="panel"><h2>Telemetry source and recent recovery events</h2><p className="caption">Actual indexing status, source adapter, pricing snapshot IDs and database schema. Event details and private thread identifiers are omitted here.</p>{error&&<p className="error">{error}</p>}{telemetry!=null&&<pre>{JSON.stringify(telemetry,null,2)}</pre>}<table><thead><tr><th>Recorded time</th><th>Event</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Date(e.timestamp).toLocaleString()}</td><td>{e.event}</td></tr>)}</tbody></table></section>;
}
