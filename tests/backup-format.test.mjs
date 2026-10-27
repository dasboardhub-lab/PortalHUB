import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/backup-format.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const format=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const doc='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fileId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function fixture(){const bytes=new TextEncoder().encode('%PDF-1.7\nfixture');const file={bucket:'hub-portal-documents',path:`${doc}/${fileId}.pdf`,name:'dokumen.pdf',size:bytes.length,mime:'application/pdf'};const data=Object.fromEntries(format.BACKUP_TABLES.map(k=>[k,[]]));data.documents=[{id:doc,file_path:file.path,file_name:file.name,file_size:file.size}];return {format:'portal-hub-v2',manifest:{format:'portal-hub-v2',origin:doc,exportedAt:'2026-10-27T12:00:00Z',fingerprint:'a'.repeat(32),data,files:[file]},files:[{...file,data:format.encodeFile(bytes),sha256:await format.sha256(bytes)}]};}
test('full JSON round trip keeps actual PDF bytes and all declared modules',async()=>{const backup=await fixture(),parsed=format.parseBackup(JSON.parse(JSON.stringify(backup)));assert.equal(parsed.files.length,1);const bytes=await format.verifyFile(parsed.files[0]);assert.equal(new TextDecoder().decode(bytes),'%PDF-1.7\nfixture');assert.deepEqual(format.backupSummary(parsed).find(([name])=>name==='File terlampir'),['File terlampir',1]);});
test('missing files, unexpected files, repeated paths, malformed data and excessive sizes fail before restoration',async()=>{for(const mutate of [b=>b.files.pop(),b=>b.files.push({...b.files[0],path:doc+'/'+doc+'.pdf'}),b=>{b.files.push({...b.files[0]});b.manifest.files.push({...b.manifest.files[0]});},b=>b.manifest.data.updates=null,b=>b.files[0].data='!!!!',b=>b.manifest.files[0]=null,b=>b.manifest.data.documents[0].file_path='../../outside.pdf',b=>b.manifest.data.documents[0].file_size=26*1024*1024]){const backup=await fixture();mutate(backup);assert.throws(()=>format.parseBackup(backup));}});
test('file corruption is detected by SHA-256 even when the base64 and length are valid',async()=>{const backup=await fixture();const file=backup.files[0];file.data=format.encodeFile(new TextEncoder().encode('%PDF-1.7\nCHANGED'));assert.equal(atob(file.data).length,file.size);format.parseBackup(backup);await assert.rejects(()=>format.verifyFile(file),/rusak atau sudah berubah/);});
test('legacy JSON remains scoped to links and categories and is explicitly identified',()=>{const backup={format:'portal-hub-v1',links:[],categories:[{id:'apps'}]};assert.equal(format.parseBackup(backup).format,'portal-hub-v1');assert.deepEqual(format.backupSummary(backup),[['Tautan layanan',0],['Menu',1]]);assert.throws(()=>format.parseBackup({...backup,categories:[]}));});

const fakeDataSource=`let current;export const useClient=c=>current=c;export const supabase=()=>current;export const explain=e=>new Error(e.message||'Error');export const mutatePortal=async()=>({message:'legacy'});`;
const urlOf=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const fakeDataUrl=urlOf(fakeDataSource),fakeIdUrl=urlOf('export const newId=()=>crypto.randomUUID();');
const dataMock=await import(fakeDataUrl);
const dataSource=(await readFile(new URL('../src/backup-data.ts',import.meta.url),'utf8')).replace("'./data'",JSON.stringify(fakeDataUrl)).replace("'./id'",JSON.stringify(fakeIdUrl)).replace("'./backup-format'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(source).toString('base64')));
const dataModule=await import(urlOf(ts.transpileModule(dataSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText));
function storageClient(backup,{uploadError=false,restoreError=false}={}){
 const calls=[];return {calls,auth:{getUser:async()=>({data:{user:{id:doc}},error:null})},rpc:async(name,args)=>{calls.push([name,args]);return name==='hub_portal_backup_snapshot'?{data:backup.manifest,error:null}:restoreError?{data:null,error:{code:'P0001',message:'Data portal berubah'}}:{data:{ok:true},error:null};},storage:{from:bucket=>({download:async path=>{calls.push(['download',path]);return {data:new Blob([format.decodeFile(backup.files[0])]),error:null};},upload:async(path,bytes)=>{calls.push(['upload',path,bytes]);return {data:{path},error:uploadError?{message:'offline'}:null};},remove:async paths=>{calls.push(['remove',paths]);return {data:paths,error:null};}})}};
}
test('complete export includes real binary files; restore downloads the current backup before uploads and atomically submits metadata',async()=>{
 const backup=await fixture(),client=storageClient(backup);dataMock.useClient(client);
 const blob=await dataModule.createBackup(()=>{});const exported=format.parseBackup(JSON.parse(await blob.text()));assert.equal(exported.files[0].data,backup.files[0].data);
 let saved=0;const result=await dataModule.restoreBackup(exported,()=>{},(snapshot,prefix)=>{saved++;assert.equal(prefix,'portal-hub-sebelum-pemulihan');assert.ok(snapshot.size>0);assert.equal(client.calls.some(c=>c[0]==='upload'),false);});
 assert.equal(saved,1);assert.equal(result.cleanupWarning,false);const upload=client.calls.find(c=>c[0]==='upload');const commit=client.calls.find(c=>c[0]==='hub_portal_backup_restore');assert.equal(commit[1].p_files[0].new_path,upload[1]);assert.notEqual(upload[1],backup.files[0].path);assert.ok(client.calls.find(c=>c[0]==='remove')[1].includes(backup.files[0].path));
});
test('upload failure, stale metadata and corrupt embedded files never proceed with an incomplete restore',async()=>{
 for(const options of [{uploadError:true},{restoreError:true}]){
  const backup=await fixture(),client=storageClient(backup,options);dataMock.useClient(client);await assert.rejects(()=>dataModule.restoreBackup(backup,()=>{},()=>{}),/belum dapat diunggah|Data portal berubah/);
  if(options.uploadError)assert.equal(client.calls.some(c=>c[0]==='hub_portal_backup_restore'),false);
  if(options.restoreError){const uploaded=client.calls.find(c=>c[0]==='upload')[1];assert.deepEqual(client.calls.find(c=>c[0]==='remove')[1],[uploaded]);}
 }
 const backup=await fixture(),client=storageClient(backup);backup.files[0].sha256='0'.repeat(64);dataMock.useClient(client);await assert.rejects(()=>dataModule.restoreBackup(backup,()=>{},()=>{}),/rusak/);assert.equal(client.calls.length,0);
});
