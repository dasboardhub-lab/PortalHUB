import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PortalData } from "./types";
import { initialCategories } from "./seed";

declare global { interface Window { PORTAL_CONFIG?:{supabaseUrl:string;publishableKey:string}; } }
let client:SupabaseClient|undefined;
function supabase():SupabaseClient{
  if(client)return client;
  const config=window.PORTAL_CONFIG;
  if(!config?.supabaseUrl||!config.publishableKey)throw new Error("Konfigurasi portal belum lengkap. Hubungi pengelola portal.");
  const url=new URL(config.supabaseUrl);
  if(url.protocol!=="https:"||!url.hostname.endsWith(".supabase.co"))throw new Error("Alamat layanan portal belum sesuai. Hubungi pengelola portal.");
  if(!config.publishableKey.startsWith("sb_publishable_"))throw new Error("Konfigurasi akses portal belum sesuai. Hubungi pengelola portal.");
  client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"hub-portal-session-v1"},global:{headers:{"X-Client-Info":"portal-hub-web/1.0"}}});
  return client;
}
function emptyData(signedIn=false,email="",accessPending=false):PortalData{
  return {links:[],categories:initialCategories,settings:{title:"Portal HUB",area:"KALSULAMP",announcementTitle:"Satu tim, satu pusat informasi.",announcement:"Masuk menggunakan akun tim untuk mengakses aplikasi, laporan, dan panduan kerja.",updatedAt:new Date().toISOString()},activity:[],canManage:false,signedIn,userEmail:email,accessPending,needsLogin:!signedIn};
}
function explain(error:{code?:string;message?:string}):Error{
  if(["PGRST202","PGRST205","42P01","42883"].includes(error.code||""))return new Error("Penyiapan portal belum selesai. Silakan hubungi pengelola portal.");
  if(error.code==="42501")return new Error("Akun Anda belum memiliki izin untuk tindakan ini.");
  if(error.code==="23503")return new Error("Kategori masih digunakan atau tidak tersedia. Muat ulang portal lalu coba lagi.");
  if(error.code==="23505")return new Error("Data dengan identitas yang sama sudah tersedia.");
  const msg=error.message||"";
  if(msg.includes("Failed to fetch")||msg.toLowerCase().includes("network"))return new Error("Koneksi terputus. Periksa jaringan lalu coba lagi.");
  if(error.code==="P0001")return new Error(msg);
  return new Error("Permintaan belum dapat diproses. Silakan muat ulang portal dan coba lagi.");
}
export async function getPortalData():Promise<PortalData>{
  const db=supabase();
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if(sessionError)throw explain(sessionError);
  if(!session)return emptyData();
  const {data,error}=await db.rpc("hub_portal_snapshot");
  if(error)throw explain(error);
  if(!data?.approved)return emptyData(true,session.user.email||"",true);
  return {...data,signedIn:true,needsLogin:false,accessPending:false,userEmail:session.user.email||""} as PortalData;
}
export async function mutatePortal(payload:unknown):Promise<{message:string}>{
  const {data,error}=await supabase().rpc("hub_portal_mutate",{payload});
  if(error)throw explain(error);
  if(!data?.ok)throw new Error("Perubahan belum dapat disimpan.");
  return data;
}
export async function signInPortal(email:string,password:string):Promise<void>{
  const {error}=await supabase().auth.signInWithPassword({email:email.trim(),password});
  if(error){
    if(error.code==="invalid_credentials")throw new Error("Email atau password belum sesuai.");
    if(error.code==="email_not_confirmed")throw new Error("Email akun belum dikonfirmasi. Hubungi pengelola portal.");
    if(error.status===429)throw new Error("Terlalu banyak percobaan masuk. Tunggu beberapa saat lalu coba lagi.");
    throw new Error("Belum dapat masuk. Periksa akun dan koneksi Anda.");
  }
}
export async function signOutPortal():Promise<void>{
  const {error}=await supabase().auth.signOut({scope:"local"});
  if(error)throw new Error("Belum dapat keluar. Periksa koneksi lalu coba lagi.");
}
export function onPortalAuthChange(callback:()=>void):()=>void{
  const {data:{subscription}}=supabase().auth.onAuthStateChange((event)=>{
    // SDK callbacks stay synchronous. Load data in a later task to avoid
    // waiting on a Supabase call while its authentication lock is held.
    if(event!=="INITIAL_SESSION"&&event!=="TOKEN_REFRESHED")callback();
  });
  return ()=>subscription.unsubscribe();
}
