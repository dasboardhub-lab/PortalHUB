import {supabase,explain,mutatePortal} from './data';
import {newId} from './id';
import {BACKUP_LIMIT,decodeFile,encodeFile,fileKey,parseBackup,referencedFiles,sha256,verifyFile,type BackupManifest,type BackupFile,type FullBackup,type ParsedBackup} from './backup-format';
export async function backupSnapshot():Promise<BackupManifest>{const {data,error}=await supabase().rpc('hub_portal_backup_snapshot');if(error)throw explain(error);return data as BackupManifest;}
export function saveBackupFile(blob:Blob,prefix='portal-hub-lengkap'){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${prefix}-${new Date(Date.now()+8*3600000).toISOString().replace('Z','-WITA').replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export async function createBackup(progress:(text:string)=>void,snapshot?:BackupManifest):Promise<Blob>{
 progress('Mengambil seluruh data portal…');const manifest=snapshot||await backupSnapshot();const refs=referencedFiles(manifest.data);
 const parts:BlobPart[]=[`{"format":"portal-hub-v2","manifest":${JSON.stringify({...manifest,files:refs})},"files":[`];let total=String(parts[0]).length;
 for(const [index,file] of refs.entries()){
  progress(`Mengunduh file ${index+1} dari ${refs.length}: ${file.name}`);
  const {data,error}=await supabase().storage.from(file.bucket).download(file.path);if(error||!data)throw new Error(`File ${file.name} belum dapat dibaca. Cadangan lengkap belum dibuat.`);
  const bytes=new Uint8Array(await data.arrayBuffer());if(bytes.length!==file.size)throw new Error(`Ukuran file ${file.name} tidak sesuai. Cadangan belum dibuat.`);
  const entry=JSON.stringify({...file,sha256:await sha256(bytes),data:encodeFile(bytes)});total+=entry.length+1;if(total>BACKUP_LIMIT)throw new Error('Cadangan melebihi batas 256 MB. Kurangi arsip file atau gunakan pencadangan proyek Supabase.');parts.push(index?',':'',entry);
 }
 parts.push(']}');progress('Menyiapkan file JSON lengkap…');const result=new Blob(parts,{type:'application/json'});if(result.size>BACKUP_LIMIT)throw new Error('Cadangan melebihi batas 256 MB.');return result;
}
export async function readBackupFile(file:File):Promise<ParsedBackup>{if(!file.size||file.size>BACKUP_LIMIT)throw new Error('File cadangan harus berukuran lebih dari 0 dan maksimal 256 MB.');let parsed:unknown;try{parsed=JSON.parse(await file.text());}catch{throw new Error('File JSON tidak dapat dibaca. Pilih file cadangan yang utuh.');}return parseBackup(parsed);}
async function removeFiles(files:Pick<BackupFile,'bucket'|'path'>[]){let warning=false;for(const bucket of [...new Set(files.map(f=>f.bucket))]){const paths=files.filter(f=>f.bucket===bucket).map(f=>f.path);for(let start=0;start<paths.length;start+=100){try{const {error}=await supabase().storage.from(bucket).remove(paths.slice(start,start+100));if(error)warning=true;}catch{warning=true;}}}return warning;}
export async function restoreBackup(backup:ParsedBackup,progress:(text:string)=>void,saveSnapshot:(blob:Blob,prefix:string)=>void=saveBackupFile){
 const checked=parseBackup(backup);
 if(checked.format==='portal-hub-v2'){progress('Memeriksa integritas seluruh file…');for(const file of checked.files)await verifyFile(file);}
 const current=await backupSnapshot();if(checked.format==='portal-hub-v2'&&checked.manifest.origin!==current.origin)throw new Error('Cadangan ini berasal dari proyek portal yang berbeda.');
 progress('Membuat cadangan kondisi saat ini…');saveSnapshot(await createBackup(progress,current),'portal-hub-sebelum-pemulihan');
 if(checked.format==='portal-hub-v1'){progress('Memulihkan tautan dan menu…');await mutatePortal({operation:'restore',backup:checked});return {message:'Tautan dan menu dari cadangan lama berhasil dipulihkan.',cleanupWarning:false};}
 const {data:{user},error:authError}=await supabase().auth.getUser();if(authError||!user)throw new Error('Sesi berakhir. Masuk kembali sebagai admin.');
 const uploaded:BackupFile[]=[];const mappings:{bucket:string;old_path:string;new_path:string}[]=[];let committed=false;
 try{
  for(const [index,file] of checked.files.entries()){
   progress(`Mengunggah file pemulihan ${index+1} dari ${checked.files.length}: ${file.name}`);
   const extension=file.path.split('.').at(-1)!;const owner=file.path.split('/')[0];const path=file.bucket==='hub-portal-task-files'?`${owner}/${user.id}/${newId()}.${extension}`:`${owner}/${newId()}.${extension}`;
   const bytes=decodeFile(file);const {error}=await supabase().storage.from(file.bucket).upload(path,bytes,{contentType:file.mime,upsert:false,cacheControl:'300'});if(error)throw new Error(`File ${file.name} belum dapat diunggah. Data portal belum diganti.`);
   uploaded.push({...file,path});mappings.push({bucket:file.bucket,old_path:file.path,new_path:path});
  }
  progress('Memulihkan data portal…');const {data,error}=await supabase().rpc('hub_portal_backup_restore',{p_backup:checked.manifest,p_files:mappings,p_expected:current.fingerprint});if(error){if(['55P03','40P01'].includes(error.code))throw new Error('Portal sedang diperbarui oleh pengguna lain. Tunggu sebentar lalu ulangi pemulihan.');throw explain(error);}if(!data?.ok)throw new Error('Pemulihan belum dapat dikonfirmasi. Muat ulang portal.');committed=true;
  progress('Menyelesaikan pemulihan…');const newPaths=new Set(uploaded.map(fileKey));const cleanupWarning=await removeFiles(current.files.filter(f=>!newPaths.has(fileKey(f))));return {message:'Seluruh data portal dan file berhasil dipulihkan.',cleanupWarning};
 }catch(error){if(!committed)await removeFiles(uploaded);throw error;}
}
