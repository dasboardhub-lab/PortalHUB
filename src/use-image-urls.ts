import {useEffect,useState} from 'react';
import {updateImageUrls} from './update-images';
export function useImageUrls(paths:string[]){
 const signature=JSON.stringify([...new Set(paths)].sort());
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const files=JSON.parse(signature) as string[];if(!files.length){setUrls({});setError('');return;}
  let active=true,inFlight=false;
  const refresh=async()=>{if(inFlight)return;inFlight=true;try{const next=await updateImageUrls(files);if(active){setUrls(next);setError(Object.keys(next).length<files.length?'Sebagian gambar belum tersedia. Coba muat ulang.':'');}}catch(e){if(active)setError(e instanceof Error?e.message:'Gambar belum dapat dimuat.');}finally{inFlight=false;}};
  void refresh();const visible=()=>{if(document.visibilityState==='visible')void refresh();};const timer=setInterval(visible,240000);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[signature,attempt]);
 return {urls,error,retry:()=>setAttempt(n=>n+1)};
}
