import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PortalData } from "./types";
import {staffEmail} from "../supabase/functions/_shared/team-validation";
import {createAuthChangeHandler} from "./auth-events";

declare global { interface Window { PORTAL_CONFIG?:{supabaseUrl:string;publishableKey:string}; } }
let client:SupabaseClient|undefined;
export function supabase():SupabaseClient{
  if(client)return client;
  const config=window.PORTAL_CONFIG;
  if(!config?.supabaseUrl||!config.publishableKey)throw new Error("Konfigurasi portal belum lengkap. Hubungi pengelola portal.");
  const url=new URL(config.supabaseUrl);
  if(url.protocol!=="https:"||!url.hostname.endsWith(".supabase.co"))throw new Error("Alamat layanan portal belum sesuai. Hubungi pengelola portal.");
  if(!config.publishableKey.startsWith("sb_publishable_"))throw new Error("Konfigurasi akses portal belum sesuai. Hubungi pengelola portal.");
  client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"hub-portal-session-v1"},global:{headers:{"X-Client-Info":"portal-hub-web/1.0"}}});
  return client;
}
export function explain(error:{code?:string;message?:string}):Error{
  if(["PGRST202","PGRST205","42P01","42883"].includes(error.code||""))return new Error("Penyiapan portal belum selesai. Silakan hubungi pengelola portal.");
  if(error.code==="42501")return new Error("Akun Anda belum memiliki izin untuk tindakan ini.");
  if(error.code==="23503")return new Error("Kategori masih digunakan atau tidak tersedia. Muat ulang portal lalu coba lagi.");
  if(error.code==="23505")return new Error("Data dengan identitas yang sama sudah tersedia.");
  if(["23514","23502","22P02"].includes(error.code||""))return new Error("Isian belum sesuai. Periksa kolom wajib dan format data.");
  const msg=error.message||"";
  if(msg.includes("Failed to fetch")||msg.toLowerCase().includes("network"))return new Error("Koneksi terputus. Periksa jaringan lalu coba lagi.");
  if(error.code==="P0001")return new Error(msg);
  return new Error("Permintaan belum dapat diproses. Silakan muat ulang portal dan coba lagi.");
}
export async function getPortalData():Promise<PortalData>{
  const db=supabase();
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if(sessionError)throw explain(sessionError);
  const [snapshot,team]=await Promise.all([db.rpc("hub_portal_snapshot"),session?db.rpc("hub_portal_team_context"):Promise.resolve({data:null,error:null})]);
  const {data,error}=snapshot;
  if(error)throw explain(error);
  if(!data?.approved)throw new Error("Portal belum dapat dimuat. Coba lagi.");
  if(team.error)throw explain(team.error);
  return {...data,teamProfile:team.data,signedIn:!!session,needsLogin:false,accessPending:false,userEmail:session?.user.email||""} as PortalData;
}
export async function mutatePortal(payload:unknown):Promise<{message:string}>{
  const {data,error}=await supabase().rpc("hub_portal_mutate",{payload});
  if(error)throw explain(error);
  if(!data?.ok)throw new Error("Perubahan belum dapat disimpan.");
  return data;
}
export async function signInPortal(email:string,password:string):Promise<void>{
  const {error}=await supabase().auth.signInWithPassword({email:email.includes("@")?email.trim():staffEmail(email),password});
  if(error){
    if(error.code==="invalid_credentials")throw new Error("NIK/ID atau password belum sesuai.");
    if(error.code==="email_not_confirmed")throw new Error("Email akun belum dikonfirmasi. Hubungi pengelola portal.");
    if(error.status===429)throw new Error("Terlalu banyak percobaan masuk. Tunggu beberapa saat lalu coba lagi.");
    throw new Error("Belum dapat masuk. Periksa akun dan koneksi Anda.");
  }
}
export async function signOutPortal():Promise<void>{
  const {error}=await supabase().auth.signOut({scope:"local"});
  if(error)throw new Error("Belum dapat keluar. Periksa koneksi lalu coba lagi.");
}
export function onPortalAuthChange(callback:(identityChanged:boolean)=>void):()=>void{
  // Keep the callback synchronous; portal loads run outside the SDK auth lock.
  const {data:{subscription}}=supabase().auth.onAuthStateChange(createAuthChangeHandler(callback));
  return ()=>subscription.unsubscribe();
}
