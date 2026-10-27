import {staffEmail,validateAccount,validatePassword,deriveAuthPassword} from '../_shared/team-validation.ts';
// Narrow interface keeps the handler independently testable without a live Auth service.
type Result={data:any;error:any};
type Service={auth:{getUser:(token:string)=>Promise<Result>;admin:{getUserById:(id:string)=>Promise<Result>;createUser:(data:any)=>Promise<Result>;deleteUser:(id:string)=>Promise<Result>;updateUserById:(id:string,data:any)=>Promise<Result>}};from:(table:string)=>any;rpc:(name:string,data:any)=>PromiseLike<Result>};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function teamHandler(service:Service){return async(req:Request):Promise<Response>=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return response(405,{error:'Metode tidak diizinkan.'});
 const token=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return response(401,{error:'Masuk sebagai admin untuk mengelola pengguna.'});
 const {data:auth,error:authError}=await service.auth.getUser(token);
 if(authError||!auth.user)return response(401,{error:'Sesi sudah berakhir. Silakan masuk kembali.'});
 const actor=auth.user.id;
 const {data:membership,error:membershipError}=await service.from('hub_portal_members').select('role,active').eq('user_id',actor).maybeSingle();
 if(membershipError||!membership?.active||membership.role!=='admin')return response(403,{error:'Hanya admin aktif yang dapat mengelola pengguna.'});
 if(Number(req.headers.get('content-length')||0)>12000)return response(413,{error:'Data pengguna terlalu besar.'});
 let input:any;
 try{const raw=await req.text();if(raw.length>12000)return response(413,{error:'Data pengguna terlalu besar.'});input=JSON.parse(raw);}catch{return response(400,{error:'Data permintaan tidak valid.'});}
 try{
  if(input.action==='create'){
   const p=validateAccount(input.account,true);
   const email=staffEmail(p.staff_id!);
   const {data,error}=await service.auth.admin.createUser({email,password:await deriveAuthPassword(email,p.password!),email_confirm:true});
   if(error||!data.user)return response(400,{error:error?.code==='email_exists'||error?.code==='user_already_exists'?'NIK/ID ini sudah digunakan. Pilih ID lain.':'Akun belum dapat dibuat. Periksa NIK/ID dan kekuatan password.'});
   const {password:_,...profile}=p;
   const {error:saveError}=await service.rpc('hub_portal_team_account_apply',{p_actor:actor,p_user:data.user.id,p_payload:profile,p_new:true});
   if(saveError){await service.auth.admin.deleteUser(data.user.id);return response(400,{error:saveError.code==='23505'?'NIK/ID ini sudah digunakan.':saveError.code==='P0001'?saveError.message:'Profil belum dapat disimpan. Coba lagi.'});}
   return response(200,{ok:true,message:'Akun tim berhasil dibuat.'});
  }
  if(input.action==='update'){
   const p=validateAccount(input.account,false);
   const {error}=await service.rpc('hub_portal_team_account_apply',{p_actor:actor,p_user:p.user_id,p_payload:p,p_new:false});
   if(error)return response(400,{error:error.code==='P0001'?error.message:'Perubahan pengguna belum dapat disimpan.'});
   return response(200,{ok:true,message:'Pengguna berhasil diperbarui.'});
  }
  if(input.action==='password'){
   const id=input.user_id;
   if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Identitas pengguna tidak valid.');
   const password=validatePassword(input.password);
   const {data:target,error}=await service.from('hub_portal_members').select('staff_id').eq('user_id',id).maybeSingle();
   if(error||!target)return response(400,{error:'Pengguna portal tidak ditemukan.'});
   let email=target.staff_id?staffEmail(target.staff_id):'';
   if(!email){const {data:legacy,error:legacyError}=await service.auth.admin.getUserById(id);if(legacyError||!legacy.user?.email)return response(400,{error:'Identitas login pengguna tidak tersedia.'});email=legacy.user.email;}
   const {error:resetError}=await service.auth.admin.updateUserById(id,{password:await deriveAuthPassword(email,password)});
   if(resetError)return response(400,{error:'Password belum dapat diganti. Gunakan password yang lebih kuat dan coba lagi.'});
   return response(200,{ok:true,message:'Password tim berhasil diganti.'});
  }
  return response(400,{error:'Tindakan tidak tersedia.'});
 }catch(error){return response(400,{error:error instanceof Error?error.message:'Permintaan belum dapat diproses.'});}
};}
