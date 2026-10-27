import {before,after,test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const admin='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const doc='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cat='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',notice='cccccccc-cccc-4ccc-8ccc-cccccccccccc',taskId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',handover='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let db,original;
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,encrypted_password text);create function auth.uid() returns uuid stable language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 for(const name of ['setup-supabase','setup-modules','setup-public-access','setup-handover-type','setup-menu-submenus','setup-submenu-order','setup-updates','setup-update-images','setup-team-tasks','setup-full-backup','setup-document-formats'])await db.exec(await readFile(new URL('../'+name+'.sql',import.meta.url),'utf8')).catch(e=>{delete e.query;throw e;});
 for(const [id,email] of [[admin,'admin@example.test'],[member,'staff-mks01@portalhub.invalid'],[outsider,'outsider@example.test']])await db.query("insert into auth.users values($1,$2,'AUTH_CREDENTIAL_NEVER_EXPORT')",[id,email]);
 await db.query("insert into public.hub_portal_members(user_id,role,display_name,staff_id,hub) values($1,'admin','Admin',null,'ALL'),($2,'member','PIC MKS','mks01','MKS')",[admin,member]);
 await as(admin,async()=>{
  await db.query("insert into public.hub_portal_document_categories(id,name) values($1,'SOP')",[cat]);
  const pdfPath=doc+'/'+randomUUID()+'.pdf';await object('hub-portal-documents',pdfPath,'application/pdf',100);
  await db.query("insert into public.hub_portal_documents(id,title,category_id,pic,file_path,file_name,file_size,menu_group) values($1,'Panduan asli',$2,'PIC MKS',$3,'sop.pdf',100,'Outbound')",[doc,cat,pdfPath]);
  await call('hub_portal_handover_save',{payload:{id:handover,account_id:'HANDOVER_ACCOUNT',password:'HANDOVER_PASS_BACKUP',password_locked:true,unlock_code:'BACKUP-CODE',hub:'MKS',route:'MKS-BPP',type:'trial'},is_new:true});
  const imagePath=notice+'/'+randomUUID()+'.png';await object('hub-portal-images',imagePath,'image/png',100);
  await call('hub_portal_update_save',{payload:{id:notice,title:'Draf privat',body:'Instruksi privat',kind:'info',status:'draft',images:[{path:imagePath,name:'plan.png',size:100,width:10,height:10,caption:'Diagram'}]},is_new:true});
  await call('hub_portal_task_save',{p_payload:{id:taskId,title:'Tugas asli',description:'PRIVATE_TASK',hub:'MKS',assignee_id:member,priority:'normal',due_at:'2027-01-01T09:00:00+08:00',checklist:[]},p_new:true});
 });
 await as(member,async()=>{const filePath=taskId+'/'+member+'/'+randomUUID()+'.pdf';await object('hub-portal-task-files',filePath,'application/pdf',90);await call('hub_portal_task_comment',{p_id:taskId,p_body:'Bukti asli',p_attachments:[{path:filePath,name:'bukti.pdf',size:90}]});});
 original=await as(admin,()=>snapshot());
});
after(async()=>await db?.close());
async function as(id,fn,role='authenticated'){await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
async function call(name,args={}){const keys=Object.keys(args);try{return (await db.query(`select public.${name}(${keys.map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]))).rows[0].result;}catch(e){delete e.query;throw e;}}
const snapshot=()=>call('hub_portal_backup_snapshot');
async function settingsChange(title){const s=(await snapshot()).data.settings[0];await call('hub_portal_mutate',{payload:{operation:'save-settings',settings:{title,area:s.area,announcementTitle:s.announcement_title,announcement:s.announcement}}});}
async function object(bucket,path,mime,size){await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,path,JSON.stringify({mimetype:mime,size})]);}
async function upload(manifest){const maps=[];for(const file of manifest.files){const ext=file.path.split('.').at(-1),id=file.path.split('/')[0];const path=file.bucket==='hub-portal-task-files'?`${id}/${admin}/${randomUUID()}.${ext}`:`${id}/${randomUUID()}.${ext}`;await object(file.bucket,path,file.mime,file.size);maps.push({bucket:file.bucket,old_path:file.path,new_path:path});}return maps;}
const restore=(manifest,maps,expected)=>call('hub_portal_backup_restore',{p_backup:manifest,p_files:maps,p_expected:expected});
test('full backup exports all portal modules and referenced files only to active admins, without Auth credentials',async()=>{
 assert.equal(original.format,'portal-hub-v2');assert.equal(original.files.length,3);assert.equal(original.data.documents.length,1);assert.equal(original.data.tasks.length,1);assert.equal(original.data.members.length,2);assert.equal(original.data.handovers[0].password,'HANDOVER_PASS_BACKUP');assert.ok(original.data.handovers[0].unlock_code_hash);assert.ok(!JSON.stringify(original).includes('AUTH_CREDENTIAL_NEVER_EXPORT'));
 for(const [id,role] of [[null,'anon'],[member,'authenticated'],[outsider,'authenticated']])await as(id,()=>assert.rejects(()=>snapshot(),/Hanya admin|permission denied/),role);
 for(const signature of ['public.hub_portal_backup_snapshot()','public.hub_portal_backup_restore(jsonb,jsonb,text)'])assert.equal((await db.query('select prosecdef from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosecdef,false);
 await as(member,()=>assert.rejects(()=>db.query('select * from hub_portal_private.backup_origin'),/permission denied/));
});
test('restore atomically recovers settings, accounts, protected handovers, PDFs, draft images and private task evidence',async()=>{
 await db.query("update public.hub_portal_members set display_name='Changed',active=false where user_id=$1",[member]);
 await as(admin,async()=>{
  await db.query('delete from public.hub_portal_documents where id=$1',[doc]);await settingsChange('Changed portal');
  const live=await snapshot(),maps=await upload(original);const result=await restore(original,maps,live.fingerprint);assert.equal(result.ok,true);
  const recovered=await snapshot();assert.equal(recovered.data.documents[0].title,'Panduan asli');assert.equal(recovered.data.settings[0].title,original.data.settings[0].title);assert.equal(recovered.data.members.find(m=>m.user_id===member).active,true);assert.equal(recovered.data.members.find(m=>m.user_id===member).display_name,'PIC MKS');assert.equal(recovered.data.handovers[0].password,'HANDOVER_PASS_BACKUP');assert.equal(recovered.data.handovers[0].unlock_code_hash,original.data.handovers[0].unlock_code_hash);assert.equal(recovered.data.updates.find(u=>u.id===notice).status,'draft');assert.equal(recovered.files.length,3);assert.ok(recovered.data.activity.some(a=>a.description==='Cadangan lengkap portal dipulihkan.'));
  const currentPaths=new Set(recovered.files.map(f=>f.path));for(const map of maps)assert.ok(currentPaths.has(map.new_path));
 });
 await as(member,async()=>{const detail=await call('hub_portal_task_detail',{p_id:taskId});assert.equal(detail.task.title,'Tugas asli');assert.equal(detail.events.find(e=>e.kind==='comment').body,'Bukti asli');assert.ok(detail.events.find(e=>e.kind==='comment').attachments[0].path.includes('/'+admin+'/'));});
 await as(null,async()=>{const docs=await call('hub_portal_document_list');assert.equal(docs.length,1);assert.equal((await call('hub_portal_update_list',{p_source:'manual'})).items.length,0);},'anon');
});
test('wrong project, malicious URLs, missing files and late validation failures leave live data unchanged',async()=>{
 await as(admin,async()=>{
  const before=await snapshot();const maps=await upload(original);
  await assert.rejects(()=>restore({...original,origin:randomUUID()},maps,before.fingerprint),/proyek portal yang sama/);
  const unsafe=structuredClone(original);unsafe.data.links[0].actions[0].url='javascript:alert(1)';await assert.rejects(()=>restore(unsafe,maps,before.fingerprint),/http/);
  await assert.rejects(()=>restore(original,maps.slice(1),before.fingerprint),/tidak lengkap/);
  const missing=maps.map((m,i)=>i===0?{...m,new_path:doc+'/'+randomUUID()+'.pdf'}:m);await assert.rejects(()=>restore(original,missing,before.fingerprint),/belum terunggah|Lokasi file/);
  const late=structuredClone(original);late.data.documents[0].pic='';await assert.rejects(()=>restore(late,maps,before.fingerprint),/constraint/);
  assert.equal((await snapshot()).fingerprint,before.fingerprint,'all metadata mutations roll back together');
 });
});
test('stale restore attempts cannot overwrite concurrent edits, and the current admin cannot be locked out',async()=>{
 await as(admin,async()=>{
  const old=await snapshot(),maps=await upload(original);await settingsChange('Concurrent edit');await assert.rejects(()=>restore(original,maps,old.fingerprint),/Data portal berubah/);assert.equal((await snapshot()).data.settings[0].title,'Concurrent edit');
  const safe=structuredClone(original);const caller=safe.data.members.find(m=>m.user_id===admin);caller.role='member';caller.active=false;
  const live=await snapshot();await restore(safe,maps,live.fingerprint);const callerAfter=(await snapshot()).data.members.find(m=>m.user_id===admin);assert.equal(callerAfter.role,'admin');assert.equal(callerAfter.active,true);
 });
});
test('only admins can stage archived or absent task files; referenced evidence remains protected',async()=>{
 const path=`${randomUUID()}/${admin}/${randomUUID()}.pdf`;
 await as(member,()=>assert.rejects(()=>object('hub-portal-task-files',path,'application/pdf',100),/row-level security/));
 await as(admin,async()=>{await object('hub-portal-task-files',path,'application/pdf',100);assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path])).rows.length,1);const evidence=(await snapshot()).files.find(f=>f.bucket==='hub-portal-task-files');assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[evidence.path])).rows.length,0);});
});

test('Word, Excel and image documents retain admin-only writes, visitor access and complete backup recovery',async()=>{
 const formats={doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
 const created=[];
 await as(admin,async()=>{
  for(const [ext,mime] of Object.entries(formats)){
   const id=randomUUID(),path=id+'/'+randomUUID()+'.'+ext;
   await object('hub-portal-documents',path,mime,100);
   await db.query("insert into public.hub_portal_documents(id,title,category_id,pic,file_path,file_name,file_size) values($1,$2,$3,'PIC MKS',$4,$5,100)",[id,'Panduan '+ext,cat,path,'panduan.'+ext]);created.push(id);
  }
  const current=await snapshot();
  for(const [ext,mime] of Object.entries(formats))assert.ok(current.files.some(f=>f.path.endsWith('.'+ext)&&f.mime===mime));
  const maps=await upload(current);await restore(current,maps,current.fingerprint);
  const recovered=await snapshot();assert.equal(recovered.files.length,current.files.length);
  for(const id of created){const row=recovered.data.documents.find(r=>r.id===id);assert.ok(row);assert.ok(recovered.files.some(f=>f.path===row.file_path&&f.mime===formats[row.file_name.split('.').at(-1)]));}
  const row=recovered.data.documents.find(r=>r.id===created[0]);
  await assert.rejects(()=>db.query("update public.hub_portal_documents set file_name='renamed.xlsx' where id=$1",[row.id]),/jenis file/);
  const bad=randomUUID(),badPath=bad+'/'+randomUUID()+'.docx';await object('hub-portal-documents',badPath,'application/pdf',100);
  await assert.rejects(()=>db.query("insert into public.hub_portal_documents(id,title,category_id,pic,file_path,file_name,file_size) values($1,'Wrong MIME',$2,'PIC',$3,'bad.docx',100)",[bad,cat,badPath]),/belum terunggah/);
  await assert.rejects(()=>object('hub-portal-documents',bad+'/'+randomUUID()+'.html','text/html',100),/row-level security/);
 });
 await as(null,async()=>{const rows=await call('hub_portal_document_list');for(const id of created)assert.ok(rows.some(r=>r.id===id));},'anon');
 await as(member,()=>assert.rejects(()=>object('hub-portal-documents',randomUUID()+'/'+randomUUID()+'.xlsx',formats.xlsx,100),/row-level security/));
 const bucket=(await db.query("select * from storage.buckets where id='hub-portal-documents'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),26214400);assert.ok(bucket.allowed_mime_types.includes(formats.docx));assert.ok(bucket.allowed_mime_types.includes(formats.xlsx));
});
