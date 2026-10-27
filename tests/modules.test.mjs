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

async function portalMutate(payload){return(await db.query('select public.hub_portal_mutate($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
async function portalSnapshot(){return(await db.query('select public.hub_portal_snapshot() result')).rows[0].result;}
test('submenus can be created before any content under all five menus and visitors cannot manage them',async()=>{
 const counts=(await db.query('select (select count(*) from public.hub_portal_documents)::int documents,(select count(*) from public.hub_portal_handovers)::int handovers')).rows[0];
 await db.exec(await readFile(new URL('../setup-menu-submenus.sql',import.meta.url),'utf8'));
 await as(admin,async()=>{for(const id of ['apps','reports','monitoring','handover','docs'])assert.equal((await portalMutate({operation:'save-submenu',category_id:id,name:'Umum'})).ok,true);});
 await as(null,async()=>{
  const data=await portalSnapshot();for(const id of ['apps','reports','monitoring','handover','docs'])assert.ok(data.categories.find(c=>c.id===id).submenus.includes('Umum'));
  await assert.rejects(()=>portalMutate({operation:'save-submenu',category_id:'apps',name:'Hacked'}),/permission denied/);
 },'anon');
 await as(viewer,()=>assert.rejects(()=>portalMutate({operation:'delete-submenu',category_id:'apps',name:'Umum'}),/Hanya admin/));
 assert.deepEqual((await db.query('select (select count(*) from public.hub_portal_documents)::int documents,(select count(*) from public.hub_portal_handovers)::int handovers')).rows[0],counts);
});
test('submenu rename updates only its parent links and deletion protects content',async()=>{
 await as(admin,async()=>{
  const link={...(await portalSnapshot()).links.find(l=>l.category==='apps'),id:'submenu-test',title:'Submenu test',group:'Umum'};
  await portalMutate({operation:'save-link',link});
  await portalMutate({operation:'save-submenu',category_id:'apps',old_name:'Umum',name:'Internal QA'});
  const data=await portalSnapshot();assert.equal(data.links.find(l=>l.id==='submenu-test').group,'Internal QA');assert.ok(data.categories.find(c=>c.id==='monitoring').submenus.includes('Umum'));assert.ok(!data.categories.find(c=>c.id==='apps').submenus.includes('Umum'));
  await assert.rejects(()=>portalMutate({operation:'delete-submenu',category_id:'apps',name:'Internal QA'}),/Pindahkan data/);
  await portalMutate({operation:'delete-link',id:'submenu-test'});
  await portalMutate({operation:'delete-submenu',category_id:'apps',name:'Internal QA'});
  assert.ok(!(await portalSnapshot()).categories.find(c=>c.id==='apps').submenus.includes('Internal QA'));
 });
});
test('module submenu assignment and rename preserve PDF data, handover type and protected Pass',async()=>{
 await as(admin,async()=>{
  let row=(await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];
  await db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify({...row,menu_group:'Umum',unlock_code:''}),row.updated_at]);
  row=(await db.query('select * from public.hub_portal_handovers where id=$1',[doc])).rows[0];const legacy={...row,unlock_code:''};delete legacy.menu_group;
  await db.query('select public.hub_portal_handover_save($1::jsonb,false,$2)',[JSON.stringify(legacy),row.updated_at]);
  await db.query("update public.hub_portal_documents set menu_group='Umum' where id=$1",[doc]);
  await portalMutate({operation:'save-submenu',category_id:'handover',old_name:'Umum',name:'Mitra'});
  await portalMutate({operation:'save-submenu',category_id:'docs',old_name:'Umum',name:'Panduan'});
  await assert.rejects(()=>portalMutate({operation:'delete-submenu',category_id:'handover',name:'Mitra'}),/Pindahkan data/);
  await assert.rejects(()=>portalMutate({operation:'delete-submenu',category_id:'docs',name:'Panduan'}),/Pindahkan data/);
 });
 await as(null,async()=>{
  const row=(await db.query('select public.hub_portal_handover_list() result')).rows[0].result.find(r=>r.id===doc);assert.equal(row.menu_group,'Mitra');assert.equal(row.type,'ELC Mitra');assert.equal(row.password,'');
  const file=(await db.query('select public.hub_portal_document_list() result')).rows[0].result.find(r=>r.id===doc);assert.equal(file.menu_group,'Panduan');assert.equal(file.file_path,path);
 },'anon');
});
test('submenu input validation rejects duplicates and reserved names, and backup retains empty submenus',async()=>{
 await as(admin,async()=>{
  for(const name of ['umum',' ALL ','','x'.repeat(71)])await assert.rejects(()=>portalMutate({operation:'save-submenu',category_id:'monitoring',name}),/Nama submenu/);
  await assert.rejects(()=>portalMutate({operation:'save-submenu',category_id:'missing',name:'Umum'}),/Menu induk/);
  await assert.rejects(()=>portalMutate({operation:'save-submenu',category_id:'apps',old_name:'missing',name:'New'}),/sudah berubah/);
  await portalMutate({operation:'save-submenu',category_id:'docs',name:'Menu kosong'});
  const data=await portalSnapshot();const backup={format:'portal-hub-v1',categories:data.categories,links:data.links};
  await portalMutate({operation:'delete-submenu',category_id:'docs',name:'Menu kosong'});
  await portalMutate({operation:'restore',backup});
  assert.ok((await portalSnapshot()).categories.find(c=>c.id==='docs').submenus.includes('Menu kosong'));
  const oldClient={...data.categories.find(c=>c.id==='docs'),name:'Dokumen & SOP'};delete oldClient.submenus;
  await portalMutate({operation:'save-category',category:oldClient});assert.ok((await portalSnapshot()).categories.find(c=>c.id==='docs').submenus.includes('Menu kosong'));
 });
});
test('renaming a parent keeps newer submenus and deleting the last link keeps its submenu',async()=>{
 await as(admin,async()=>{
  const stale=(await portalSnapshot()).categories.find(c=>c.id==='apps');
  await portalMutate({operation:'save-submenu',category_id:'apps',name:'Empty saved'});
  await portalMutate({operation:'save-category',category:{...stale,name:'Aplikasi & sistem'}});
  assert.ok((await portalSnapshot()).categories.find(c=>c.id==='apps').submenus.includes('Empty saved'));
  const link={...(await portalSnapshot()).links.find(l=>l.category==='apps'),id:'temporary-link',group:'Typed submenu'};
  await portalMutate({operation:'save-link',link});await portalMutate({operation:'delete-link',id:link.id});
  assert.ok((await portalSnapshot()).categories.find(c=>c.id==='apps').submenus.includes('Typed submenu'));
 });
});

test('manual submenu order persists publicly; rename retains position and stale reorders fail',async()=>{
 await db.exec(await readFile(new URL('../setup-submenu-order.sql',import.meta.url),'utf8'));
 await as(admin,async()=>{
  for(const name of ['First','Second','Third'])await portalMutate({operation:'save-submenu',category_id:'monitoring',name});
  const original=(await portalSnapshot()).categories.find(c=>c.id==='monitoring').submenus;
  const desired=['Third','First','Second',...original.filter(n=>!['First','Second','Third'].includes(n))];
  await portalMutate({operation:'reorder-submenus',category_id:'monitoring',names:desired,expected_names:original});
  await assert.rejects(()=>portalMutate({operation:'reorder-submenus',category_id:'monitoring',names:original,expected_names:original}),/sudah berubah/);
  await assert.rejects(()=>portalMutate({operation:'reorder-submenus',category_id:'monitoring',names:['First'],expected_names:desired}),/Daftar submenu/);
  await portalMutate({operation:'save-submenu',category_id:'monitoring',old_name:'Third',name:'Top'});
  assert.deepEqual((await portalSnapshot()).categories.find(c=>c.id==='monitoring').submenus,['Top','First','Second',...desired.slice(3)]);
 });
 await as(null,async()=>{const names=(await portalSnapshot()).categories.find(c=>c.id==='monitoring').submenus;assert.deepEqual(names.slice(0,3),['Top','First','Second']);await assert.rejects(()=>portalMutate({operation:'reorder-submenus',category_id:'monitoring',names,expected_names:names}),/permission denied/);},'anon');
 await as(viewer,()=>assert.rejects(()=>portalMutate({operation:'reorder-submenus',category_id:'monitoring',names:[],expected_names:[]}),/Hanya admin/));
});
async function feed(source='all',status='published',limit=20,offset=0,query=''){return(await db.query('select public.hub_portal_update_list($1,$2,$3,$4,$5) result',[limit,offset,status,source,query])).rows[0].result;}
async function saveInfo(row,isNew=true){return(await db.query('select public.hub_portal_update_save($1::jsonb,$2,$3) result',[JSON.stringify(row),isNew,row.updated_at||null])).rows[0].result.item;}
let draft;
test('updates installer preserves data without publishing old history, and denies non-admin writes',async()=>{
 const counts=(await db.query('select (select count(*) from public.hub_portal_links)::int links,(select count(*) from public.hub_portal_documents)::int docs,(select count(*) from public.hub_portal_handovers)::int handovers')).rows[0];
 await db.exec(await readFile(new URL('../setup-updates.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select (select count(*) from public.hub_portal_links)::int links,(select count(*) from public.hub_portal_documents)::int docs,(select count(*) from public.hub_portal_handovers)::int handovers')).rows[0],counts);
 assert.equal((await feed()).total,0);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.hub_portal_updates'::regclass")).rows[0].relrowsecurity,true);
 await as(admin,async()=>{draft=await saveInfo({title:'Briefing tim',body:'Arahan operasional',status:'draft',source:'system'});assert.equal(draft.source,'manual');assert.equal((await feed('manual','draft')).total,1);});
 await as(null,async()=>{
  assert.equal((await feed()).total,0);assert.equal((await db.query('select * from public.hub_portal_updates')).rows.length,0);
  await assert.rejects(()=>feed('all','draft'),/Hanya admin/);
  await assert.rejects(()=>saveInfo({title:'x',body:'x'}),/permission denied/);
  await assert.rejects(()=>db.query("insert into public.hub_portal_updates(title,body) values('x','x')"),/permission denied/);
 },'anon');
 for(const id of [viewer,outsider])await as(id,()=>assert.rejects(()=>saveInfo({title:'x',body:'x'}),/Hanya admin/));
});
test('admin information supports publish, search, idempotent edits, concurrency, archive and restore',async()=>{
 await as(admin,async()=>{
  draft=await saveInfo({...draft,status:'published',pinned:true,category_id:'reports'},false);
  assert.ok(draft.published_at);assert.equal((await feed('manual')).total,1);
  const identical=await saveInfo(draft,false);assert.equal(identical.updated_at,draft.updated_at);
  const edited=await saveInfo({...draft,body:'Arahan terbaru untuk seluruh tim'},false);
  await assert.rejects(()=>saveInfo({...draft,body:'Stale'},false),/sudah berubah/);
  draft=edited;assert.equal((await feed('manual','published',20,0,'terbaru')).total,1);
 });
 await as(null,async()=>{const rows=await feed('manual');assert.equal(rows.total,1);assert.equal(rows.items[0].body,'Arahan terbaru untuk seluruh tim');await assert.rejects(()=>db.query("update public.hub_portal_updates set title='hacked'"),/permission denied/);},'anon');
 await as(admin,async()=>{draft=await saveInfo({...draft,status:'archived'},false);assert.equal((await feed('manual','archived')).total,1);});
 await as(null,async()=>assert.equal((await feed('manual')).total,0),'anon');
 await as(admin,async()=>{draft=await saveInfo({...draft,status:'published'},false);assert.equal((await feed('manual')).total,1);});
});
test('update APIs bound pagination and validate links, input and privileged functions',async()=>{
 await as(null,async()=>{
  for(const [limit,offset] of [[null,0],[101,0],[0,0],[20,null],[20,-1],[20,100001]])await assert.rejects(()=>feed('all','published',limit,offset),/Filter/);
  await assert.rejects(()=>feed(null),/Filter/);await assert.rejects(()=>feed('all',null),/Filter/);await assert.rejects(()=>feed('all','published',20,0,'x'.repeat(151)),/Filter/);
  assert.equal((await feed('manual','published',1)).items.length,1);assert.equal((await feed('manual','published',1,1)).items.length,0);
 },'anon');
 await as(admin,async()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','https://admin:pass@example.com','https://example.com/a b'])await assert.rejects(()=>saveInfo({title:'Title',body:'Body',url}),/Tautan/);
  await assert.rejects(()=>saveInfo({title:' ',body:'Body'}),/Periksa/);
  await assert.rejects(()=>saveInfo({title:'Title',body:'x'.repeat(4001)}),/Periksa/);
  await assert.rejects(()=>saveInfo({title:'Title',body:'Body',url:'https://example.com',category_id:'apps'}),/salah satu/);
  await assert.rejects(()=>db.query("select public.hub_portal_update_save('{\"title\":\"x\",\"body\":\"x\"}',null)"),/Isian/);
 });
 const wrappers=(await db.query("select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('hub_portal_update_list','hub_portal_update_save')")).rows;
 assert.equal(wrappers.length,2);assert.ok(wrappers.every(r=>r.prosecdef===false));
});
test('automatic updates batch per menu, ignore unchanged data and never disclose handover secrets',async()=>{
 const start=(await feed('system')).total;
 await as(admin,async()=>{
  await db.exec('begin');
  const l={...(await portalSnapshot()).links.find(l=>l.category==='apps'),group:'Batch'};
  await portalMutate({operation:'save-link',link:{...l,id:'updates-batch-a'}});
  await portalMutate({operation:'save-link',link:{...l,id:'updates-batch-b'}});
  await db.exec('commit');
  const auto=(await feed('system')).items;assert.ok(auto.some(r=>r.category_id==='apps'));
  const before=(await feed('system')).total;
  await portalMutate({operation:'save-link',link:{...l,id:'updates-batch-a'}});
  assert.equal((await feed('system')).total,before);
  await db.query("insert into public.hub_portal_handovers(account_id,password,hub,route,description) values('SECRET-ACCOUNT','SECRET-PASSWORD','MKS','SECRET-ROUTE','SECRET-DESCRIPTION')");
  const handover=(await feed('system')).items.find(r=>r.category_id==='handover');assert.ok(handover);
  const json=JSON.stringify(handover);for(const secret of ['SECRET-ACCOUNT','SECRET-PASSWORD','SECRET-ROUTE','SECRET-DESCRIPTION','unlock_code_hash','file_path'])assert.ok(!json.includes(secret));
  await assert.rejects(()=>saveInfo({...handover,title:'Spoof'},false),/otomatis/);
 });
 // Link batch plus one newly registered submenu yields two topics, and handover adds one.
 assert.equal((await feed('system')).total,start+3);
 await as(null,async()=>{const publicRows=await feed('system');assert.ok(publicRows.items.every(r=>r.status==='published'&&r.source==='system'));},'anon');
});

const imagePost='99999999-9999-4999-8999-999999999999',imagePath=`${imagePost}/88888888-8888-4888-8888-888888888888.png`;
const imageInfo={path:imagePath,name:'agenda.png',size:128,width:800,height:450,caption:'Agenda tim'};
let imageRow;
test('image installer preserves announcements and creates a private bucket with admin uploads only',async()=>{
 const before=(await db.query('select count(*)::int n from public.hub_portal_updates')).rows[0].n;
 await db.exec(await readFile(new URL('../setup-update-images.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*)::int n from public.hub_portal_updates')).rows[0].n,before);
 assert.ok((await db.query('select images from public.hub_portal_updates')).rows.every(r=>r.images.length===0));
 const bucket=(await db.query("select * from storage.buckets where id='hub-portal-images'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp']);
 for(const id of [viewer,outsider])await as(id,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-images',$1,$2)",[imagePath,JSON.stringify({mimetype:'image/png',size:128})]),/row-level security/));
 await as(null,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('hub-portal-images',$1)",[imagePath]),/row-level security/),'anon');
 await as(admin,async()=>{
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-images',$1,$2)",[imagePath,JSON.stringify({mimetype:'image/png',size:128})]);
  imageRow=await saveInfo({id:imagePost,title:'Agenda bergambar',body:'Informasi dengan gambar',status:'draft',images:[imageInfo]});assert.deepEqual(imageRow.images,[imageInfo]);
 });
 await as(null,async()=>{assert.equal((await db.query("select name from storage.objects where bucket_id='hub-portal-images'")).rows.length,0);assert.equal((await db.query('select hub_portal_private.update_image_access($1,false) allowed',[imagePath])).rows[0].allowed,false);await assert.rejects(()=>db.query('select * from hub_portal_private.update_image_refs'),/permission denied/);},'anon');
});
test('published image access follows announcement status and referenced images cannot be removed',async()=>{
 await as(admin,async()=>{imageRow=await saveInfo({...imageRow,status:'published'},false);assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[imagePath])).rows.length,0);});
 await as(null,async()=>{assert.equal((await db.query('select name from storage.objects where name=$1',[imagePath])).rows.length,1);assert.deepEqual((await feed('manual')).items.find(r=>r.id===imagePost).images,[imageInfo]);},'anon');
 await assert.rejects(()=>db.query('delete from storage.objects where name=$1',[imagePath]),/foreign key/);
 await as(admin,async()=>{imageRow=await saveInfo({...imageRow,status:'archived'},false);});
 await as(null,async()=>assert.equal((await db.query('select name from storage.objects where name=$1',[imagePath])).rows.length,0),'anon');
 await as(viewer,()=>assert.rejects(()=>saveInfo({...imageRow,status:'published'},false),/Hanya admin/));
});
test('legacy edits retain images, image-only changes use optimistic concurrency, and removing an image permits cleanup',async()=>{
 await as(admin,async()=>{
  const legacy={...imageRow,title:'Nama diperbarui'};delete legacy.images;
  imageRow=await saveInfo(legacy,false);assert.deepEqual(imageRow.images,[imageInfo]);
  const unchanged=await saveInfo(imageRow,false);assert.equal(unchanged.updated_at,imageRow.updated_at);
  const previous=imageRow;imageRow=await saveInfo({...imageRow,images:[{...imageInfo,caption:'Keterangan diperbarui'}]},false);assert.notEqual(imageRow.updated_at,previous.updated_at);
  await assert.rejects(()=>saveInfo({...previous,images:[]},false),/sudah berubah/);
  imageRow=await saveInfo({...imageRow,images:[]},false);assert.deepEqual(imageRow.images,[]);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[imagePath])).rows.length,1);
 });
});
test('image saves reject missing uploads, invalid formats, sizes, dimensions and paths from another announcement',async()=>{
 await as(admin,async()=>{
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-images',$1,$2)",[imagePath,JSON.stringify({mimetype:'image/png',size:128})]);
  const invalid=[null,[imageInfo,imageInfo],[{...imageInfo,size:129}],[{...imageInfo,width:12001}],[{...imageInfo,width:6000,height:6000}],[{...imageInfo,path:imagePath.replace('88888888','77777777')}],[{...imageInfo,path:imagePath.replace(imagePost,doc)}],[{...imageInfo,caption:'x'.repeat(201)}],Array.from({length:5},()=>imageInfo)];
  for(const images of invalid)await assert.rejects(()=>saveInfo({...imageRow,images},false),/gambar|Gambar|Format|unggahan/);
 });
 // A forged content type cannot be attached even by an administrator.
 await db.query("update storage.objects set metadata=$1 where name=$2",[JSON.stringify({mimetype:'image/svg+xml',size:128}),imagePath]);
 await as(admin,()=>assert.rejects(()=>saveInfo({...imageRow,images:[imageInfo]},false),/Format gambar/));
});
