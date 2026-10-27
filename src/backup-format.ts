import {documentFormat} from './document-files.ts';
export const BACKUP_LIMIT=256*1024*1024;
export const BACKUP_TABLES=['categories','links','settings','members','handovers','document_categories','documents','updates','tasks','task_events','activity'] as const;
export type BackupTable=typeof BACKUP_TABLES[number];
export type BackupRow=Record<string,unknown>;
export type BackupData=Record<BackupTable,BackupRow[]>;
export type BackupFile={bucket:'hub-portal-documents'|'hub-portal-images'|'hub-portal-task-files';path:string;name:string;size:number;mime:string};
export type BackupManifest={format:'portal-hub-v2';origin:string;exportedAt:string;fingerprint:string;data:BackupData;files:BackupFile[]};
export type EmbeddedFile=BackupFile&{sha256:string;data:string};
export type FullBackup={format:'portal-hub-v2';manifest:BackupManifest;files:EmbeddedFile[]};
export type LegacyBackup={format:'portal-hub-v1';exportedAt?:string;links:unknown[];categories:unknown[]};
export type ParsedBackup=FullBackup|LegacyBackup;
export const fileKey=(file:Pick<BackupFile,'bucket'|'path'>)=>`${file.bucket}|${file.path}`;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function referencedFiles(data:BackupData):BackupFile[]{
 const refs:BackupFile[]=[];
 for(const row of data.documents)refs.push({bucket:'hub-portal-documents',path:String(row.file_path||''),name:String(row.file_name||''),size:Number(row.file_size),mime:documentFormat(String(row.file_path||''))?.mime||''});
 for(const [table,key,bucket] of [['updates','images','hub-portal-images'],['task_events','attachments','hub-portal-task-files']] as const){
  for(const row of data[table]){if(!Array.isArray(row[key]))throw new Error('Daftar lampiran dalam cadangan tidak lengkap.');for(const file of row[key]){if(!object(file))throw new Error('Metadata lampiran tidak valid.');const path=String(file.path||'');refs.push({bucket,path,name:String(file.name||''),size:Number(file.size),mime:path.endsWith('.pdf')?'application/pdf':path.endsWith('.jpg')?'image/jpeg':path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':''});}}
 }
 const unique=new Map<string,BackupFile>();
 for(const file of refs){
  const task=file.bucket==='hub-portal-task-files',document=file.bucket==='hub-portal-documents';const pattern=document?/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|webp|gif)$/:task?/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/:/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/;
  const limit=file.bucket==='hub-portal-documents'?25*1024*1024:file.mime==='application/pdf'?10*1024*1024:5*1024*1024;
  if(!pattern.test(file.path)||!file.name||file.name.length>255||!file.mime||!Number.isSafeInteger(file.size)||file.size<1||file.size>limit||document&&documentFormat(file.name)?.mime!==file.mime||file.bucket==='hub-portal-images'&&file.mime==='application/pdf')throw new Error('Metadata file dalam cadangan tidak sesuai.');
  const previous=unique.get(fileKey(file));if(previous&&(previous.size!==file.size||previous.mime!==file.mime))throw new Error('Referensi file dalam cadangan bertentangan.');unique.set(fileKey(file),file);
 }
 return [...unique.values()].sort((a,b)=>fileKey(a).localeCompare(fileKey(b)));
}
export function parseBackup(value:unknown):ParsedBackup{
 if(!object(value))throw new Error('File cadangan tidak valid.');
 if(value.format==='portal-hub-v1'){
  if(!Array.isArray(value.links)||!Array.isArray(value.categories)||!value.categories.length||value.categories.length>40||value.links.length>500)throw new Error('Cadangan tautan lama tidak valid.');return value as LegacyBackup;
 }
 if(value.format!=='portal-hub-v2'||!object(value.manifest)||!Array.isArray(value.files))throw new Error('Gunakan file JSON cadangan yang diunduh dari portal.');
 const m=value.manifest;
 if(m.format!=='portal-hub-v2'||typeof m.origin!=='string'||!/^[a-f0-9-]{36}$/.test(m.origin)||typeof m.fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(m.fingerprint)||typeof m.exportedAt!=='string'||!Number.isFinite(Date.parse(m.exportedAt))||!object(m.data)||!Array.isArray(m.files))throw new Error('Identitas dan versi cadangan tidak lengkap.');
 for(const key of BACKUP_TABLES){const rows=m.data[key];if(!Array.isArray(rows)||rows.length>100000||rows.some(row=>!object(row)))throw new Error(`Bagian cadangan tidak lengkap: ${key}.`);}
 const refs=referencedFiles(m.data as BackupData);if(refs.length!==value.files.length||refs.length!==m.files.length||refs.length>10000)throw new Error('Cadangan belum menyertakan seluruh file.');
 const byKey=new Map<string,unknown>();for(const row of value.files){if(!object(row)||typeof row.bucket!=='string'||typeof row.path!=='string')throw new Error('File cadangan tidak sesuai.');const key=`${row.bucket}|${row.path}`;if(byKey.has(key))throw new Error('Ada file berulang dalam cadangan.');byKey.set(key,row);}
 if(m.files.some(f=>!object(f)||typeof f.bucket!=='string'||typeof f.path!=='string'))throw new Error('Daftar file cadangan tidak valid.');
 const manifestFiles=new Map((m.files as BackupFile[]).map(f=>[fileKey(f),f]));if(manifestFiles.size!==refs.length)throw new Error('Daftar file cadangan berulang.');
 for(const ref of refs){const file=byKey.get(fileKey(ref));const descriptor=manifestFiles.get(fileKey(ref));if(!object(file)||!descriptor||descriptor.size!==ref.size||descriptor.mime!==ref.mime||file.size!==ref.size||file.mime!==ref.mime||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||typeof file.data!=='string'||file.data.length!==4*Math.ceil(ref.size/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw new Error('Isi atau kelengkapan file cadangan tidak sesuai.');}
 return value as FullBackup;
}
export function encodeFile(bytes:Uint8Array){const chunks:string[]=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(chunks.join(''));}
export function decodeFile(file:EmbeddedFile){const raw=atob(file.data);if(raw.length!==file.size)throw new Error(`Ukuran file ${file.name} tidak sesuai.`);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export async function sha256(bytes:Uint8Array){if(!crypto.subtle)throw new Error('Gunakan portal melalui HTTPS untuk memproses cadangan.');const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyFile(file:EmbeddedFile){const bytes=decodeFile(file);if(await sha256(bytes)!==file.sha256)throw new Error(`File ${file.name} rusak atau sudah berubah. Pemulihan dibatalkan.`);return bytes;}
export function backupSummary(backup:ParsedBackup){if(backup.format==='portal-hub-v1')return [['Tautan layanan',backup.links.length],['Menu',backup.categories.length]] as [string,number][];const d=backup.manifest.data;return [['Tautan layanan',d.links.length],['Menu & submenu',d.categories.length],['Serah terima',d.handovers.length],['Dokumen & SOP',d.documents.length],['Informasi & update',d.updates.length],['Tugas',d.tasks.length],['Aktivitas tugas',d.task_events.length],['Profil pengguna',d.members.length],['File terlampir',backup.files.length]] as [string,number][];}
