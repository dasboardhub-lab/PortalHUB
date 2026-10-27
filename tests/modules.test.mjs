import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
let db;
const admin='11111111-1111-4111-8111-111111111111',viewer='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const category='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',doc='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const path=`${doc}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf`;
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create schema extensions;create extension pgcrypto with schema extensions;');
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid stable language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(await readFile(new URL('../setup-supabase.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../setup-modules.sql',import.meta.url),'utf8'));
 for(const id of [admin,viewer,outsider])await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query("insert into public.hub_portal_members(user_id,role) values($1,'admin'),($2,'viewer')",[admin,viewer]);
});
after(async()=>{await db?.close();});
async function as(id,task,role='authenticated'){await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await task();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
test('new tables and files deny anonymous, nonmember, and viewer writes',async()=>{
 for(const table of ['hub_portal_handovers','hub_portal_documents','hub_portal_document_categories']){
  assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${table}`])).rows[0].relrowsecurity,true);
  await as(null,()=>assert.rejects(()=>db.query(`select * from public.${table}`),/permission denied/),'anon');
  await as(outsider,async()=>assert.equal((await db.query(`select * from public.${table}`)).rows.length,0));
 }
 await as(viewer,()=>assert.rejects(()=>db.query("insert into public.hub_portal_handovers(account_id,hub,route) values('test','MKS','MKS-BPP')"),/row-level security/));
 await as(viewer,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-documents',$1,'{}')",[path]),/row-level security/));
});
test('handover CRUD hides secrets from activity and checks update concurrency',async()=>{
 const row=await as(admin,async()=>{
  const row=(await db.query("insert into public.hub_portal_handovers(account_id,password,hub,route,description) values('unit-test','SECRET_TEST_ONLY','MKS','MKS-DAYA0','tes') returning *")).rows[0];
  assert.equal((await db.query('update public.hub_portal_handovers set route=$1 where id=$2 and updated_at=$3 returning id',['MKS-PRPO0',row.id,row.updated_at])).rows.length,1);
  assert.equal((await db.query('update public.hub_portal_handovers set route=$1 where id=$2 and updated_at=$3 returning id',['stale',row.id,row.updated_at])).rows.length,0);
  assert.ok((await db.query('select description from public.hub_portal_activity')).rows.every(r=>!r.description.includes('SECRET_TEST_ONLY')&&!r.description.includes('unit-test')));return row;
 });
 await as(viewer,async()=>{assert.equal((await db.query('select password from public.hub_portal_handovers where id=$1',[row.id])).rows[0].password,'SECRET_TEST_ONLY');assert.equal((await db.query("update public.hub_portal_handovers set password='hacked' where id=$1 returning id",[row.id])).rows.length,0);assert.equal((await db.query('delete from public.hub_portal_handovers where id=$1 returning id',[row.id])).rows.length,0);});
 await as(admin,()=>db.query('delete from public.hub_portal_handovers where id=$1',[row.id]));
});
test('document category hierarchy, PDF reference validation, private file access, replace and delete',async()=>{
 await as(admin,async()=>{
  await db.query('insert into public.hub_portal_document_categories(id,name) values($1,$2)',[category,'SOP']);
  await db.query('insert into public.hub_portal_document_categories(id,name,parent_id) values($1,$2,$3)',[sub,'Outbound',category]);
  await assert.rejects(()=>db.query("insert into public.hub_portal_document_categories(name,parent_id) values('Too deep',$1)",[sub]),/kategori utama/);
  await assert.rejects(()=>db.query("insert into public.hub_portal_document_categories(name) values('sop')"),/unique/);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-documents',$1,$2)",[path,JSON.stringify({mimetype:'application/pdf',size:100})]);
  await assert.rejects(()=>db.query("insert into public.hub_portal_documents(id,title,category_id,pic,file_path,file_name,file_size) values($1,'SOP',$2,'PIC',$3,'sop.pdf',101)",[doc,category,path]),/ukuran/);
  await db.query("insert into public.hub_portal_documents(id,title,category_id,subcategory_id,pic,file_path,file_name,file_size) values($1,'SOP Outbound',$2,$3,'PIC',$4,'sop.pdf',100)",[doc,category,sub,path]);
  await assert.rejects(()=>db.query('delete from public.hub_portal_document_categories where id=$1',[category]),/foreign key/);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path])).rows.length,0,'referenced files cannot be deleted');
 });
 await as(viewer,async()=>{assert.equal((await db.query('select * from public.hub_portal_documents')).rows.length,1);assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,1);assert.equal((await db.query('delete from public.hub_portal_documents returning id')).rows.length,0);});
 await as(outsider,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
 await as(null,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0),'anon');
 const nextPath=`${doc}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
 await as(admin,async()=>{
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-documents',$1,$2)",[nextPath,JSON.stringify({mimetype:'application/pdf',size:200})]);
  await db.query('update public.hub_portal_documents set file_path=$1,file_size=200 where id=$2',[nextPath,doc]);
 });
 await as(viewer,async()=>assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,0,'orphan files not readable by viewers'));
 await as(admin,async()=>{await db.query('delete from storage.objects where name=$1',[path]);await db.query('delete from public.hub_portal_documents where id=$1',[doc]);await db.query('delete from storage.objects where name=$1',[nextPath]);await db.query('delete from public.hub_portal_document_categories where id=$1',[sub]);await db.query('delete from public.hub_portal_document_categories where id=$1',[category]);});
});
test('public access exposes links and PDFs without login but never exposes Pass or permits visitor CRUD',async()=>{
 await db.exec(await readFile(new URL('../setup-public-access.sql',import.meta.url),'utf8'));
 const row=await as(admin,async()=>{
  await db.query('insert into public.hub_portal_document_categories(id,name) values($1,$2)',[category,'Public SOP']);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-documents',$1,$2)",[path,JSON.stringify({mimetype:'application/pdf',size:100})]);
  await db.query("insert into public.hub_portal_documents(id,title,category_id,pic,file_path,file_name,file_size) values($1,'Public document',$2,'PIC',$3,'public.pdf',100)",[doc,category,path]);
  await db.query('select public.hub_portal_handover_save($1::jsonb,true)',[JSON.stringify({id:doc,account_id:'PUBLIC-ID',password:'NEVER_PUBLIC_PASS',password_locked:true,unlock_code:'TEST-CODE-ONLY',hub:'MKS',route:'MKS-BPP'})]);
  return (await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];
 });
 for(const [id,role] of [[null,'anon'],[viewer,'authenticated'],[outsider,'authenticated']])await as(id,async()=>{
  const snapshot=(await db.query('select public.hub_portal_snapshot() result')).rows[0].result;
  assert.equal(snapshot.approved,true);assert.equal(snapshot.canManage,false);assert.equal(snapshot.links.length,33);
  const list=(await db.query('select public.hub_portal_handover_list() result')).rows[0].result;
  assert.equal(list.find(r=>r.id===row.id).account_id,'PUBLIC-ID');assert.equal(list.find(r=>r.id===row.id).password,'');assert.ok(!JSON.stringify(list).includes('NEVER_PUBLIC_PASS'));assert.ok(!JSON.stringify(list).includes('unlock_code_hash'));
  assert.equal((await db.query('select public.hub_portal_document_list() result')).rows[0].result.length,1);assert.equal(snapshot.activity.length,0);
  assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,1);
  await assert.rejects(()=>db.query("insert into public.hub_portal_handovers(account_id,hub,route) values('hacked','MKS','fake')"),/permission denied|row-level security/);
 },role);
 for(const table of ['hub_portal_handovers','hub_portal_documents','hub_portal_document_categories','hub_portal_activity','hub_portal_members','hub_portal_links'])await as(null,()=>assert.rejects(()=>db.query('select * from public.'+table),/permission denied/),'anon');
 await as(outsider,async()=>assert.equal((await db.query('select password from public.hub_portal_handovers')).rows.length,0));
 await as(admin,async()=>{assert.equal((await db.query('select public.hub_portal_handover_list() result')).rows[0].result.find(r=>r.id===row.id).password,'NEVER_PUBLIC_PASS');});
 await db.query('update public.hub_portal_members set active=false where user_id=$1',[admin]);
 await as(admin,async()=>assert.ok(!JSON.stringify((await db.query('select public.hub_portal_handover_list() result')).rows[0].result).includes('NEVER_PUBLIC_PASS')));
 await db.query('update public.hub_portal_members set active=true where user_id=$1',[admin]);
});

test('unlock code is verified server side, throttled and preserved on metadata edits; unrestricted Pass is public',async()=>{
 const lockedId=doc;
 await as(viewer,()=>assert.rejects(()=>db.query('select public.hub_portal_handover_save($1::jsonb,true)',[JSON.stringify({id:lockedId})]),/Hanya admin/));
 await as(null,async()=>{
  for(let i=0;i<5;i++)assert.equal((await db.query('select public.hub_portal_handover_unlock($1,$2) result',[lockedId,'WRONG-CODE'])).rows[0].result.ok,false);
  const blocked=(await db.query('select public.hub_portal_handover_unlock($1,$2) result',[lockedId,'TEST-CODE-ONLY'])).rows[0].result;
  assert.equal(blocked.ok,false);assert.match(blocked.message,/5 menit/);
 },'anon');
 await db.query("update hub_portal_private.handover_unlock_attempts set window_start=clock_timestamp()-interval '6 minutes' where id=$1",[lockedId]);
 await as(null,async()=>assert.equal((await db.query('select public.hub_portal_handover_unlock($1,$2) result',[lockedId,'TEST-CODE-ONLY'])).rows[0].result.password,'NEVER_PUBLIC_PASS'),'anon');
 await as(admin,async()=>{
  const row=(await db.query('select * from public.hub_portal_handovers where id=$1',[lockedId])).rows[0];
  await db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify({...row,description:'Updated description',unlock_code:''}),row.updated_at]);
  const after=(await db.query('select * from public.hub_portal_handovers where id=$1',[lockedId])).rows[0];assert.equal(after.unlock_code_hash,row.unlock_code_hash);assert.notEqual(after.unlock_code_hash,'TEST-CODE-ONLY');
  await assert.rejects(()=>db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify({...row,unlock_code:'bad'}),row.updated_at]),/berubah/);
  await db.query('select public.hub_portal_handover_save($1::jsonb,true)',[JSON.stringify({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',account_id:'OPEN-ID',password:'PUBLIC-PASS',password_locked:false,hub:'MKS',route:'MKS-DAYA0'})]);
 });
 await as(null,async()=>{
  const list=(await db.query('select public.hub_portal_handover_list() result')).rows[0].result;
  assert.equal(list.find(r=>r.account_id==='OPEN-ID').password,'PUBLIC-PASS');assert.equal(list.find(r=>r.id===lockedId).password,'');
  assert.equal((await db.query('select public.hub_portal_handover_unlock($1,$2) result',[lockedId,'TEST-CODE-ONLY'])).rows[0].result.password,'NEVER_PUBLIC_PASS');
 },'anon');
});

test('handover type is saved, returned publicly and preserved by older clients',async()=>{
 await db.exec(await readFile(new URL('../setup-handover-type.sql',import.meta.url),'utf8'));
 const row=(await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];
 await as(admin,async()=>{
  await db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify({...row,type:'  ELC Mitra  ',unlock_code:''}),row.updated_at]);
  const updated=(await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];assert.equal(updated.type,'ELC Mitra');
  const legacy={...updated,unlock_code:''};delete legacy.type;
  await db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify(legacy),updated.updated_at]);
  const current=(await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];assert.equal(current.type,'ELC Mitra');
  await assert.rejects(()=>db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify({...current,type:'x'.repeat(81),unlock_code:''}),current.updated_at]),/constraint/);
 });
 await as(null,async()=>{const r=(await db.query('select public.hub_portal_handover_list() result')).rows[0].result.find(r=>r.id===doc);assert.equal(r.type,'ELC Mitra');assert.equal(r.password,'');},'anon');
});
