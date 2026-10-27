import {useCallback,useEffect,useRef,useState} from 'react';
import {listUpdates,onUpdateChange,type UpdateResult} from './updates-data';
export function useUpdates(enabled:boolean,identity:string){
 const [latest,setLatest]=useState<UpdateResult|null>(null),[information,setInformation]=useState<UpdateResult|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const serial=useRef(0);
 const refresh=useCallback(async()=>{
  if(!enabled)return;const request=++serial.current;
  try{const [changes,admin]=await Promise.all([listUpdates({limit:3,source:'system'}),listUpdates({limit:3,source:'manual'})]);if(serial.current===request){setLatest(changes);setInformation(admin);setError('');setRevision(n=>n+1);}}
  catch(e){if(serial.current===request)setError(e instanceof Error?e.message:'Pembaruan belum dapat dimuat.');}
 },[enabled,identity]);
 useEffect(()=>{
  if(!enabled){setLatest(null);setInformation(null);return;}
  void refresh();let scheduled:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{clearTimeout(scheduled);scheduled=setTimeout(()=>void refresh(),300);};
  let unsubscribe=()=>{};try{unsubscribe=onUpdateChange(schedule);}catch{}
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
  const timer=setInterval(visible,30000);
  return()=>{serial.current++;clearInterval(timer);clearTimeout(scheduled);unsubscribe();document.removeEventListener('visibilitychange',visible);};
 },[enabled,refresh]);
 return {latest,information,error,revision,refresh};
}
export type UpdatesController=ReturnType<typeof useUpdates>;
