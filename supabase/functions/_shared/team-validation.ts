export const TEAM_HUBS=['MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway'];
export function staffEmail(identity:string){
 const id=identity.trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{1,49}$/.test(id))throw new Error('NIK/ID harus 2–50 karakter: huruf, angka, titik, garis bawah atau tanda minus.');
 return `staff-${id}@portalhub.invalid`;
}
export function validatePassword(value:unknown):string{
 if(typeof value!=='string'||value.length<10||value.length>128)throw new Error('Password harus 10–128 karakter.');
 return value;
}
export type AccountInput={user_id?:string;name:string;staff_id:string|null;hub:string;role:'admin'|'member'|'viewer';active:boolean;updated_at?:string;password?:string};
export function validateAccount(value:unknown,isNew:boolean):AccountInput{
 if(!value||typeof value!=='object')throw new Error('Data pengguna tidak valid.');
 const p=value as Record<string,unknown>;
 const name=typeof p.name==='string'?p.name.trim():'';
 if(name.length<2||name.length>100)throw new Error('Nama harus 2–100 karakter.');
 if(!['admin','member',...(isNew?[]:['viewer'])].includes(String(p.role)))throw new Error('Pilih pengguna: admin atau anggota.');
 if(!TEAM_HUBS.includes(String(p.hub))&&!(p.hub==='ALL'&&p.role!=='member'))throw new Error('Pilih HUB untuk pengguna.');
 if(typeof p.active!=='boolean')throw new Error('Status pengguna tidak valid.');
 const user_id=typeof p.user_id==='string'?p.user_id:undefined;
 if(!isNew&&!/^[a-f0-9-]{36}$/.test(user_id||''))throw new Error('Identitas pengguna tidak valid.');
 let staff_id: string|null=null;
 if(isNew){if(typeof p.staff_id!=='string')throw new Error('NIK/ID wajib diisi.');staffEmail(p.staff_id);staff_id=p.staff_id.trim().toLowerCase();validatePassword(p.password);}
 return {user_id,name,staff_id,hub:String(p.hub),role:p.role as AccountInput['role'],active:p.active,updated_at:typeof p.updated_at==='string'?p.updated_at:undefined,...(isNew?{password:p.password as string}:{})};
}
