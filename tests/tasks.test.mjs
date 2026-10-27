import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const admin='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',outsider='44444444-4444-4444-8444-444444444444';
const taskId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherTask='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',step1='cccccccc-cccc-4ccc-8ccc-cccccccccccc',step2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let db,task;
const steps=[{id:step1,label:'Periksa kesiapan armada',done:false},{id:step2,label:'Unggah bukti trial',done:false}];
before(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid stable language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(await readFile(new URL('../setup-supabase.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../setup-team-tasks.sql',import.meta.url),'utf8')).catch(e=>{delete e.query;throw e;});
 for(const id of [admin,member,other,outsider])await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test']);
 await db.query("insert into public.hub_portal_members(user_id,display_name,staff_id,hub,role) values($1,'Admin',null,'ALL','admin'),($2,'PIC MKS','mks01','MKS','member'),($3,'PIC BPP','bpp01','BPP','member')",[admin,member,other]);
});
after(async()=>await db?.close());
async function as(id,fn,role='authenticated'){await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
async function call(name,args){const keys=Object.keys(args);return (await db.query(`select public.${name}(${keys.map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].result;}
const payload=(id,assignee)=>({id,title:'Trial MND–BPP',description:'PRIVATE_TASK_INSTRUCTIONS',hub:'MKS',assignee_id:assignee,priority:'high',due_at:'2026-01-01T09:00:00+08:00',checklist:steps});
const progress=(row,status,items,pct,note='')=>call('hub_portal_task_progress',{p_id:row.id,p_expected:row.updated_at,p_status:status,p_checklist:items,p_progress:pct,p_note:note});
test('accounts and task data are private; authenticated members cannot provision or escalate roles',async()=>{
 await as(null,()=>assert.rejects(()=>call('hub_portal_task_list',{p_filters:{}}),/permission denied/),'anon');
 await as(outsider,()=>assert.rejects(()=>call('hub_portal_task_list',{p_filters:{}}),/akun tim aktif/));
 await as(member,async()=>{assert.equal((await call('hub_portal_team_context',{})).name,'PIC MKS');await assert.rejects(()=>call('hub_portal_team_users',{}),/Hanya admin/);await assert.rejects(()=>call('hub_portal_team_account_apply',{p_actor:admin,p_user:member,p_payload:{},p_new:false}),/permission denied/);});
 assert.equal((await as(admin,()=>call('hub_portal_team_users',{}))).length,3);
 await db.query("insert into public.hub_portal_activity(description) values('PRIVATE_ADMIN_AUDIT')");
 await as(member,async()=>assert.equal((await db.query('select * from public.hub_portal_activity')).rows.length,0));
 await as(admin,async()=>{await assert.rejects(()=>db.query("update public.hub_portal_members set role='admin' where user_id=$1",[member]),/permission denied/);});
 await as(null,()=>assert.rejects(()=>db.query('select * from public.hub_portal_tasks'),/permission denied/),'anon');
});
test('admin creates assigned tasks; member cannot create or access other assignments',async()=>{
 await as(member,()=>assert.rejects(()=>call('hub_portal_task_save',{p_payload:payload(taskId,member),p_new:true}),/Hanya admin/));
 task=await as(admin,()=>call('hub_portal_task_save',{p_payload:payload(taskId,member),p_new:true}));
 await as(admin,()=>call('hub_portal_task_save',{p_payload:payload(otherTask,other),p_new:true}));
 assert.equal(task.progress,0);assert.equal(task.status,'todo');
 const list=await as(member,()=>call('hub_portal_task_list',{p_filters:{}}));assert.equal(list.total,1);assert.equal(list.items[0].id,taskId);assert.equal(list.stats.overdue,1);
 assert.equal((await as(admin,()=>call('hub_portal_task_list',{p_filters:{}}))).total,2);
 await as(other,()=>assert.rejects(()=>call('hub_portal_task_detail',{p_id:taskId}),/tidak memiliki akses/));
 await as(other,async()=>assert.equal((await db.query('select * from public.hub_portal_tasks where id=$1',[taskId])).rows.length,0));
 await as(member,()=>assert.rejects(()=>db.query("update public.hub_portal_tasks set assignee_id=$1 where id=$2",[member,otherTask]),/permission denied/));
});
test('checklist-derived progress, optimistic edits, member restrictions and admin verification',async()=>{
 await as(member,async()=>{
  await assert.rejects(()=>progress(task,'done',steps,100),/diverifikasi admin/);
  await assert.rejects(()=>progress(task,'review',steps,100),/100%/);
  await assert.rejects(()=>progress(task,'in_progress',[{...steps[0],label:'changed'},steps[1]],0),/hanya dapat diubah admin/);
  await assert.rejects(()=>progress(task,'in_progress',[steps[0]],0),/menandai checklist/);
  await assert.rejects(()=>progress(task,'blocked',steps,0),/alasan/);
  const old=task;task=await progress(task,'in_progress',[{...steps[0],done:true},steps[1]],99,'Armada siap.');assert.equal(task.progress,50);
  await assert.rejects(()=>progress(old,'in_progress',steps,0),/sudah berubah/);
  task=await progress(task,'blocked',task.checklist,0,'Menunggu jadwal trial');assert.equal(task.progress,50);
  task=await progress(task,'review',steps.map(s=>({...s,done:true})),0,'Siap diperiksa.');assert.equal(task.progress,100);
 });
 task=await as(admin,()=>progress(task,'done',task.checklist,100,'Hasil sudah diperiksa.'));assert.equal(task.status,'done');
 await as(member,()=>assert.rejects(()=>progress(task,'in_progress',task.checklist,100,'reopen'),/diverifikasi admin/));
 const detail=await as(admin,()=>call('hub_portal_task_detail',{p_id:taskId}));assert.ok(detail.events.some(e=>e.kind==='verify'&&e.actor_name==='Admin'));
 await as(admin,()=>assert.rejects(()=>progress(task,'in_progress',task.checklist,100),/alasan/));
 task=await as(admin,()=>progress(task,'in_progress',task.checklist,100,'Perlu tambahan bukti.'));
});
test('private evidence validates storage references and follows reassignment; audit files cannot be removed',async()=>{
 const path=`${taskId}/${member}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
 await as(other,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-task-files',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[path]),/row-level security/));
 await as(member,async()=>{
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-task-files',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[path]);
  assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,1);
  await assert.rejects(()=>call('hub_portal_task_comment',{p_id:taskId,p_body:'bukti',p_attachments:[{path,name:'trial.pdf',size:101}]}),/belum terunggah/);
  await call('hub_portal_task_comment',{p_id:taskId,p_body:'Bukti trial',p_attachments:[{path,name:'trial.pdf',size:100}]});
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path])).rows.length,0);
  const large=`${taskId}/${member}/ffffffff-ffff-4fff-8fff-ffffffffffff.png`;await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-task-files',$1,'{\"mimetype\":\"image/png\",\"size\":6000000}')",[large]);await assert.rejects(()=>call('hub_portal_task_comment',{p_id:taskId,p_body:'oversized image',p_attachments:[{path:large,name:'large.png',size:6000000}]}),/File bukti tidak valid/);await db.query('delete from storage.objects where name=$1',[large]);
 });
 await as(other,async()=>assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,0));
 const snapshot=await as(admin,()=>call('hub_portal_task_detail',{p_id:taskId}));assert.ok(snapshot.events.some(e=>e.attachments[0]?.path===path));
 task=await as(admin,()=>call('hub_portal_task_save',{p_payload:{...task,assignee_id:other},p_new:false}));
 await as(member,async()=>{await assert.rejects(()=>call('hub_portal_task_detail',{p_id:taskId}),/tidak memiliki akses/);assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,0);});
 await as(other,async()=>assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,1));
 const orphan=`${taskId}/${other}/ffffffff-ffff-4fff-8fff-ffffffffffff.png`;
 await as(other,async()=>{await db.query("insert into storage.objects(bucket_id,name,metadata) values('hub-portal-task-files',$1,'{\"mimetype\":\"image/png\",\"size\":100}')",[orphan]);assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[orphan])).rows.length,1,'failed uploads can be cleaned up');});
});
test('archive is reversible and prevents all member writes; disabling accounts takes effect immediately',async()=>{
 await as(admin,()=>call('hub_portal_task_archive',{p_id:taskId,p_expected:task.updated_at,p_archived:true}));
 task=(await as(admin,()=>call('hub_portal_task_detail',{p_id:taskId}))).task;
 await as(other,async()=>{await assert.rejects(()=>progress(task,'review',task.checklist,100),/tidak memiliki akses/);await assert.rejects(()=>call('hub_portal_task_comment',{p_id:taskId,p_body:'hi',p_attachments:[]}),/tidak memiliki akses/);});
 assert.equal((await as(admin,()=>call('hub_portal_task_list',{p_filters:{archived:true}}))).total,1);
 await as(admin,()=>call('hub_portal_task_archive',{p_id:taskId,p_expected:task.updated_at,p_archived:false}));
 await db.query('update public.hub_portal_members set active=false where user_id=$1',[other]);
 await as(other,async()=>{assert.equal(await call('hub_portal_team_context',{}),null);await assert.rejects(()=>call('hub_portal_task_list',{p_filters:{}}),/akun tim aktif/);assert.equal((await db.query('select * from public.hub_portal_tasks')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);});
 await db.query('update public.hub_portal_members set active=true where user_id=$1',[other]);
});
test('account service API rechecks actor, preserves ID, prevents self-demotion and rejects stale edits',async()=>{
 const row=(await db.query('select * from public.hub_portal_members where user_id=$1',[member])).rows[0];
 const p={name:'New Name',role:'member',hub:'MND',active:true,staff_id:'attempt-to-change',updated_at:row.updated_at};
 await as(null,()=>assert.rejects(()=>call('hub_portal_team_account_apply',{p_actor:member,p_user:member,p_payload:p,p_new:false}),/Hanya admin/),'service_role');
 const result=await as(null,()=>call('hub_portal_team_account_apply',{p_actor:admin,p_user:member,p_payload:p,p_new:false}),'service_role');assert.equal(result.user_id,member);
 assert.equal((await db.query('select staff_id from public.hub_portal_members where user_id=$1',[member])).rows[0].staff_id,'mks01');
 await as(null,()=>assert.rejects(()=>call('hub_portal_team_account_apply',{p_actor:admin,p_user:member,p_payload:p,p_new:false}),/sudah berubah/),'service_role');
 const a=(await db.query('select * from public.hub_portal_members where user_id=$1',[admin])).rows[0];
 await as(null,()=>assert.rejects(()=>call('hub_portal_team_account_apply',{p_actor:admin,p_user:admin,p_payload:{...p,updated_at:a.updated_at,active:false},p_new:false}),/tidak dapat dinonaktifkan/),'service_role');
 for(const table of ['hub_portal_tasks','hub_portal_task_events','hub_portal_members'])assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true);
});
