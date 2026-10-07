import { Worker } from 'node:worker_threads';
export class ObservabilityClient {
 constructor(options){this.pending=new Map();this.sequence=0;this.worker=new Worker(new URL('./observability-worker.mjs',import.meta.url),{workerData:options});this.worker.on('message',message=>{const pending=this.pending.get(message.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);});this.worker.on('error',()=>this.rejectAll('observability-worker-unavailable'));this.worker.on('exit',()=>this.rejectAll('observability-worker-stopped'));}
 rejectAll(reason){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();}
 call(method,params={}){const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('observability-request-timeout'));},120000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,method,params});});}
 async close(){this.rejectAll('observability-client-closed');await this.worker.terminate();}
}
