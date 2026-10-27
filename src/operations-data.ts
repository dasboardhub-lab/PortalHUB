import {newId} from './id';
import {supabase, explain} from './data';
export type Handover={id:string;account_id:string;password:string;password_locked:boolean;has_password?:boolean;hub:string;route:string;description:string;created_at:string;updated_at:string};
export type DocCategory={id:string;name:string;parent_id:string|null;updated_at:string};
export type HubDocument={id:string;title:string;category_id:string;subcategory_id:string|null;hub:string;pic:string;document_date:string;reference:string;version:string;description:string;file_path:string;file_name:string;file_size:number;created_at:string;updated_at:string};
import {validatePdf} from './pdf-validation';
const bucket=()=>supabase().storage.from('hub-portal-documents');
export async function listRows<T>(table:string):Promise<T[]>{
 const rows:T[]=[];let start=0;
 for(;;){const rpc:Record<string,string>={hub_portal_handovers:'hub_portal_handover_list',hub_portal_documents:'hub_portal_document_list',hub_portal_document_categories:'hub_portal_document_category_list'};const {data,error}=await supabase().rpc(rpc[table],{p_offset:start,p_limit:500});if(error)throw explain(error);rows.push(...data as T[]);if(data.length<500)return rows;start+=500;}
}
export async function saveRow<T extends {id:string;updated_at?:string;created_at?:string}>(table:string,row:T,isNew:boolean){
 const {updated_at}=row;
 const values:Record<string,unknown>={...row};delete values.updated_at;delete values.created_at;
 const query=isNew?supabase().from(table).insert(values):supabase().from(table).update(values).eq('id',row.id).eq('updated_at',updated_at!);
 const {data,error}=await query.select('*').single();if(error){if(error.code==='PGRST116')throw new Error('Data sudah berubah atau dihapus oleh admin lain. Muat ulang lalu coba lagi.');throw explain(error);}return data as T;
}
export async function deleteRow(table:string,row:{id:string;updated_at:string}){
 const {data,error}=await supabase().from(table).delete().eq('id',row.id).eq('updated_at',row.updated_at).select('id');if(error)throw explain(error);if(!data.length)throw new Error('Data sudah berubah. Muat ulang sebelum menghapus.');
}
export async function saveCategory(row:DocCategory,isNew:boolean){return saveRow('hub_portal_document_categories',row,isNew);}
export async function saveDocument(row:HubDocument,isNew:boolean,file:File|null):Promise<string>{
 let path='';const oldPath=row.file_path;
 if(file){await validatePdf(file);path=`${row.id}/${newId()}.pdf`;const {error}=await bucket().upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'0'});if(error)throw new Error('PDF belum dapat diunggah. Periksa koneksi, ukuran file, dan ruang penyimpanan.');row={...row,file_path:path,file_name:file.name.slice(0,255),file_size:file.size};}
 if(!row.file_path)throw new Error('Unggah file PDF terlebih dahulu.');
 try{await saveRow('hub_portal_documents',row,isNew);}catch(error){if(path){const cleanup=await bucket().remove([path]);if(cleanup.error)console.warn('Pembersihan unggahan yang gagal belum selesai.');}throw error;}
 if(path&&oldPath&&oldPath!==path){const {error}=await bucket().remove([oldPath]);if(error)return 'Dokumen tersimpan. File versi lama belum dibersihkan dari penyimpanan.';}
 return isNew?'Dokumen PDF berhasil ditambahkan.':'Dokumen berhasil diperbarui.';
}
export async function deleteDocument(row:HubDocument):Promise<string>{
 await deleteRow('hub_portal_documents',row);
 const {error}=await bucket().remove([row.file_path]);
 return error?'Dokumen dihapus dari daftar. Pembersihan file di penyimpanan belum selesai.':'Dokumen dan file PDF berhasil dihapus.';
}
export async function documentUrl(row:HubDocument,download=false){
 const {data,error}=await bucket().createSignedUrl(row.file_path,300,download?{download:row.file_name}:undefined);
 if(error)throw new Error('File belum dapat dibuka. Muat ulang atau hubungi admin.');return data.signedUrl;
}

export async function saveHandover(row:Handover,isNew:boolean,code:string){
 const {data,error}=await supabase().rpc('hub_portal_handover_save',{payload:{id:row.id,account_id:row.account_id,password:row.password,password_locked:row.password_locked,hub:row.hub,route:row.route,description:row.description,unlock_code:code},is_new:isNew,expected_updated_at:row.updated_at||null});
 if(error)throw explain(error);if(!data?.ok)throw new Error('Data belum tersimpan.');
}
export async function unlockHandover(row:Handover,code:string):Promise<string>{
 const {data,error}=await supabase().rpc('hub_portal_handover_unlock',{row_id:row.id,code});if(error)throw explain(error);if(!data?.ok)throw new Error(data?.message||'Kode belum sesuai.');return data.password;
}

export async function documentUrls(rows:HubDocument[]):Promise<Record<string,string>>{
 if(!rows.length)return {};
 const {data,error}=await bucket().createSignedUrls(rows.map(r=>r.file_path),300);
 if(error)throw new Error('Tautan unduh belum tersedia. Muat ulang dokumen lalu coba lagi.');
 const urls:Record<string,string>={};for(const item of data)if(item.path&&item.signedUrl)urls[item.path]=item.signedUrl;
 return urls;
}
