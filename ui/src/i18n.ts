import {useSyncExternalStore} from 'react';
import {catalog,translate,resolveLocale,localizeValue,formatNumber,formatDate,type Language,type Locale,type MessageKey,type Params} from './i18n-core';
let resolved:Locale=resolveLocale('auto',null,typeof navigator==='undefined'?[]:navigator.languages);
const listeners=new Set<()=>void>();
export const locale=()=>resolved;
export const t=(key:MessageKey,params?:Params)=>translate(key,resolved,params);
export const display=(value:string)=>localizeValue(value,resolved);
export const numberText=(value:unknown,digits=0)=>formatNumber(value,resolved,digits);
export const dateText=(value:number|string|Date|null|undefined,options?:Intl.DateTimeFormatOptions)=>formatDate(value,resolved,options);
export function setLocalePreferences(prefs:{language?:Language;systemLocale?:string|null;resolvedLocale?:Locale}){
 const next=prefs.resolvedLocale??resolveLocale(prefs.language??'auto',prefs.systemLocale,typeof navigator==='undefined'?[]:navigator.languages);
 if(typeof document!=='undefined'){document.documentElement.lang=next;document.title=next==='zh-CN'?'Codex 控制中心':'Codex Control Center';}
 if(next!==resolved){resolved=next;listeners.forEach(listener=>listener());}
}
export function useLocale(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},locale,locale);}
/** Unknown diagnostic codes and raw errors remain intact beside a localized explanation. */
export function errorText(error:unknown){const raw=String(error);return Object.hasOwn(catalog,raw)?display(raw):`${t('Operation failed. Review Diagnostics for the original error.')} (${raw})`;}
