-- Tugas privat dan akun tim. Jalankan setelah seluruh installer portal sebelumnya.
begin;
-- @stage accounts
alter table public.hub_portal_members drop constraint hub_portal_members_role_check;
alter table public.hub_portal_members add constraint hub_portal_members_role_check check(role in ('admin','member','viewer'));
alter table public.hub_portal_members add column display_name text not null default '' check(char_length(display_name)<=100),add column staff_id text,add column hub text not null default 'ALL' check(hub in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')),add column updated_at timestamptz not null default clock_timestamp();
alter table public.hub_portal_members add constraint hub_team_staff_id_format check(staff_id is null or staff_id ~ '^[a-z0-9][a-z0-9._-]{1,49}$');
create unique index hub_team_staff_id_unique on public.hub_portal_members(lower(staff_id)) where staff_id is not null;

create function hub_portal_private.is_team_member() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.hub_portal_members where user_id=(select auth.uid()) and active and role in ('admin','member'));
$$;
create function hub_portal_private.team_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(m.display_name,''),'Admin portal'),'staff_id',m.staff_id,'hub',m.hub,'role',m.role) from public.hub_portal_members m where m.user_id=(select auth.uid()) and m.active and m.role in ('admin','member');
$$;
create function public.hub_portal_team_context() returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.team_context(); $$;
create function hub_portal_private.team_users() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin aktif yang dapat mengelola pengguna.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(m.display_name,''),'Admin portal'),'staff_id',m.staff_id,'hub',m.hub,'role',m.role,'active',m.active,'created_at',m.created_at,'updated_at',m.updated_at,'login_label',case when m.staff_id is null then u.email else m.staff_id end) order by m.active desc,m.display_name,m.user_id) from public.hub_portal_members m join auth.users u on u.id=m.user_id),'[]'::jsonb);
end; $$;
create function public.hub_portal_team_users() returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.team_users(); $$;
-- Hanya Edge Function dengan service_role yang memanggil API akun ini.
create function hub_portal_private.team_account_apply(p_actor uuid,p_user uuid,p_payload jsonb,p_new boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.hub_portal_members; n text:=btrim(p_payload->>'name'); r text:=p_payload->>'role'; h text:=p_payload->>'hub'; sid text:=lower(btrim(p_payload->>'staff_id')); a boolean:=(p_payload->>'active')::boolean; result public.hub_portal_members;
begin
 perform pg_advisory_xact_lock(hashtext('hub_portal_team_accounts'));
 if not exists(select 1 from public.hub_portal_members where user_id=p_actor and active and role='admin') then raise exception 'Hanya admin aktif yang dapat mengelola pengguna.'; end if;
 if n is null or char_length(n) not between 2 and 100 or r is null or r not in ('admin','member','viewer') or h is null or h not in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway') or a is null then raise exception 'Lengkapi nama, HUB, dan pengguna dengan benar.'; end if;
 if r='member' and h='ALL' then raise exception 'Pilih satu HUB untuk anggota tim.'; end if;
 if p_new then
  if r='viewer' or sid is null or sid !~ '^[a-z0-9][a-z0-9._-]{1,49}$' then raise exception 'NIK/ID harus 2–50 karakter: huruf, angka, titik, garis bawah atau tanda minus.'; end if;
  insert into public.hub_portal_members(user_id,display_name,staff_id,hub,role,active) values(p_user,n,sid,h,r,a) returning * into result;
 else
  select * into old from public.hub_portal_members where user_id=p_user for update;
  if not found then raise exception 'Pengguna tidak ditemukan.'; end if;
  if p_payload->>'updated_at' is null or old.updated_at<>(p_payload->>'updated_at')::timestamptz then raise exception 'Data pengguna sudah berubah. Muat ulang daftar pengguna.'; end if;
  if p_actor=p_user and (not a or r<>'admin') then raise exception 'Akun admin yang sedang digunakan tidak dapat dinonaktifkan atau diturunkan perannya.'; end if;
  update public.hub_portal_members set display_name=n,hub=h,role=r,active=a,updated_at=clock_timestamp() where user_id=p_user returning * into result;
 end if;
 return jsonb_build_object('user_id',result.user_id,'updated_at',result.updated_at);
end; $$;
create function public.hub_portal_team_account_apply(p_actor uuid,p_user uuid,p_payload jsonb,p_new boolean) returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.team_account_apply(p_actor,p_user,p_payload,p_new); $$;
revoke all on function hub_portal_private.is_team_member(),hub_portal_private.team_context(),hub_portal_private.team_users(),public.hub_portal_team_context(),public.hub_portal_team_users() from public,anon;
grant execute on function hub_portal_private.is_team_member(),hub_portal_private.team_context(),hub_portal_private.team_users(),public.hub_portal_team_context(),public.hub_portal_team_users() to authenticated;
revoke all on function hub_portal_private.team_account_apply(uuid,uuid,jsonb,boolean),public.hub_portal_team_account_apply(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant usage on schema hub_portal_private to service_role;
grant execute on function hub_portal_private.team_account_apply(uuid,uuid,jsonb,boolean),public.hub_portal_team_account_apply(uuid,uuid,jsonb,boolean) to service_role;

-- Riwayat pengelolaan lama tetap hanya untuk admin, termasuk bagi anggota baru.
drop policy hub_portal_member_read on public.hub_portal_activity;
create policy hub_portal_activity_admin_read on public.hub_portal_activity for select to authenticated using((select hub_portal_private.is_admin()));

-- @stage task_schema
create table public.hub_portal_tasks(
 id uuid primary key default gen_random_uuid(),title text not null check(char_length(btrim(title)) between 1 and 160),description text not null default '' check(char_length(description)<=6000),
 hub text not null check(hub in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')),
 assignee_id uuid not null references public.hub_portal_members(user_id),priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 due_at timestamptz not null,status text not null default 'todo' check(status in ('todo','in_progress','blocked','review','done')),
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=30),progress integer not null default 0 check(progress between 0 and 100),archived boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index hub_task_assignee_due_idx on public.hub_portal_tasks(assignee_id,archived,due_at,id);
create index hub_task_due_idx on public.hub_portal_tasks(archived,due_at,id);
create index hub_task_creator_idx on public.hub_portal_tasks(created_by);
create table public.hub_portal_task_events(
 id uuid primary key default gen_random_uuid(),task_id uuid not null references public.hub_portal_tasks(id),actor_id uuid not null references auth.users(id),actor_name text not null,
 kind text not null check(kind in ('create','edit','progress','comment','verify','archive','restore')),body text not null default '' check(char_length(body)<=3000),details jsonb not null default '{}',attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=4),created_at timestamptz not null default clock_timestamp()
);
create index hub_task_event_task_idx on public.hub_portal_task_events(task_id,created_at desc,id);
create index hub_task_event_actor_idx on public.hub_portal_task_events(actor_id);
create function hub_portal_private.can_read_task(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select hub_portal_private.is_team_member() and exists(select 1 from public.hub_portal_tasks t where t.id=p_id and (hub_portal_private.is_admin() or t.assignee_id=(select auth.uid())));
$$;
create function hub_portal_private.can_work_task(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select hub_portal_private.can_read_task(p_id) and exists(select 1 from public.hub_portal_tasks where id=p_id and not archived);
$$;
alter table public.hub_portal_tasks enable row level security;
alter table public.hub_portal_task_events enable row level security;
revoke all on public.hub_portal_tasks,public.hub_portal_task_events from public,anon,authenticated;
grant select on public.hub_portal_tasks,public.hub_portal_task_events to authenticated;
create policy hub_tasks_read on public.hub_portal_tasks for select to authenticated using((select hub_portal_private.is_team_member()) and ((select hub_portal_private.is_admin()) or assignee_id=(select auth.uid())));
create policy hub_task_events_read on public.hub_portal_task_events for select to authenticated using(hub_portal_private.can_read_task(task_id));
revoke all on function hub_portal_private.can_read_task(uuid),hub_portal_private.can_work_task(uuid) from public,anon;
grant execute on function hub_portal_private.can_read_task(uuid),hub_portal_private.can_work_task(uuid) to authenticated;

create function hub_portal_private.task_json(t public.hub_portal_tasks) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('assignee_name',coalesce(nullif(m.display_name,''),'Admin portal')) from public.hub_portal_members m where m.user_id=t.assignee_id;
$$;
create function hub_portal_private.task_event(p_id uuid,p_kind text,p_body text,p_details jsonb default '{}',p_attachments jsonb default '[]') returns uuid language plpgsql set search_path='' as $$
declare result uuid;
begin
 insert into public.hub_portal_task_events(task_id,actor_id,actor_name,kind,body,details,attachments) select p_id,auth.uid(),coalesce(nullif(m.display_name,''),'Admin portal'),p_kind,coalesce(p_body,''),p_details,p_attachments from public.hub_portal_members m where m.user_id=auth.uid() and m.active and m.role in ('admin','member') returning id into result;
 if result is null then raise exception 'Akun tim tidak aktif.'; end if;
 return result;
end; $$;
revoke all on function hub_portal_private.task_json(public.hub_portal_tasks),hub_portal_private.task_event(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;

-- @stage task_read
create function hub_portal_private.task_list(p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare offst integer:=coalesce((p_filters->>'offset')::integer,0); lim integer:=coalesce((p_filters->>'limit')::integer,20); q text:=left(btrim(coalesce(p_filters->>'query','')),160); h text:=coalesce(p_filters->>'hub','ALL'); s text:=coalesce(p_filters->>'status','ALL'); arc boolean:=coalesce((p_filters->>'archived')::boolean,false); mine boolean:=coalesce((p_filters->>'mine')::boolean,false); adm boolean:=hub_portal_private.is_admin(); result jsonb;
begin
 if not hub_portal_private.is_team_member() then raise exception 'Masuk dengan akun tim aktif untuk mengakses tugas.'; end if;
 if offst<0 or lim not between 1 and 50 then raise exception 'Rentang tugas tidak valid.'; end if;
 with accessible as (select t.* from public.hub_portal_tasks t where t.archived=arc and ((adm and not mine) or t.assignee_id=auth.uid())),
 filtered as (select t.* from accessible t join public.hub_portal_members m on m.user_id=t.assignee_id where (h='ALL' or t.hub=h) and (s='ALL' or t.status=s or (s='overdue' and t.due_at<now() and t.status<>'done')) and (q='' or concat_ws(' ',t.title,t.description,m.display_name,t.hub) ilike '%'||q||'%')),
 page as(select * from filtered order by (status='done'),due_at,id offset offst limit lim)
 select jsonb_build_object('items',coalesce((select jsonb_agg(hub_portal_private.task_json(t) order by (t.status='done'),t.due_at,t.id) from (select (r).* from page r) t),'[]'::jsonb),'total',(select count(*) from filtered),'stats',(select jsonb_build_object('total',count(*),'in_progress',count(*) filter(where status='in_progress'),'review',count(*) filter(where status='review'),'done',count(*) filter(where status='done'),'overdue',count(*) filter(where due_at<now() and status<>'done')) from accessible)) into result;
 return result;
end; $$;
create function public.hub_portal_task_list(p_filters jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.task_list(p_filters); $$;
create function hub_portal_private.task_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not hub_portal_private.can_read_task(p_id) then raise exception 'Tugas tidak tersedia atau Anda tidak memiliki akses.'; end if;
 return jsonb_build_object('task',(select hub_portal_private.task_json(t) from public.hub_portal_tasks t where id=p_id),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id) from (select * from public.hub_portal_task_events where task_id=p_id order by created_at desc,id limit 100)e),'[]'::jsonb));
end; $$;
create function public.hub_portal_task_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.task_detail(p_id); $$;
revoke all on function hub_portal_private.task_list(jsonb),public.hub_portal_task_list(jsonb),hub_portal_private.task_detail(uuid),public.hub_portal_task_detail(uuid) from public,anon;
grant execute on function hub_portal_private.task_list(jsonb),public.hub_portal_task_list(jsonb),hub_portal_private.task_detail(uuid),public.hub_portal_task_detail(uuid) to authenticated;

-- @stage task_write
create function hub_portal_private.valid_checklist(p_items jsonb,p_old jsonb,p_admin boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]'; item jsonb; seen text[]:='{}'; ident text; label_text text;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>30 then raise exception 'Checklist maksimal 30 langkah.'; end if;
 if not p_admin and (jsonb_array_length(p_items)<>jsonb_array_length(p_old)) then raise exception 'Anggota hanya dapat menandai checklist yang sudah dibuat admin.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  ident:=item->>'id'; label_text:=btrim(item->>'label');
  if ident is null or ident !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or ident=any(seen) or label_text is null or char_length(label_text) not between 1 and 200 or jsonb_typeof(item->'done') is distinct from 'boolean' then raise exception 'Isi checklist belum sesuai.'; end if;
  if not p_admin and not exists(select 1 from jsonb_array_elements(p_old) x where x->>'id'=ident and x->>'label'=label_text) then raise exception 'Langkah checklist hanya dapat diubah admin.'; end if;
  seen:=array_append(seen,ident);result:=result||jsonb_build_array(jsonb_build_object('id',ident,'label',label_text,'done',(item->>'done')::boolean));
 end loop;
 return result;
end; $$;
create function hub_portal_private.task_save(p_payload jsonb,p_new boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid:=(p_payload->>'id')::uuid; old public.hub_portal_tasks; result public.hub_portal_tasks; items jsonb; pct integer; next_status text;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat membuat atau mengedit tugas.'; end if;
 if ident is null or p_new is null then raise exception 'Identitas tugas tidak valid.'; end if;
 if not p_new then
  select * into old from public.hub_portal_tasks where id=ident for update;
  if not found or old.archived then raise exception 'Tugas tidak tersedia atau sudah diarsipkan.'; end if;
  if p_payload->>'updated_at' is null or old.updated_at<>(p_payload->>'updated_at')::timestamptz then raise exception 'Tugas sudah diperbarui pengguna lain. Muat ulang detail tugas.'; end if;
 end if;
 if not exists(select 1 from public.hub_portal_members where user_id=(p_payload->>'assignee_id')::uuid and active and role in ('admin','member')) then raise exception 'Pilih PIC dengan akun tim aktif.'; end if;
 items:=hub_portal_private.valid_checklist(p_payload->'checklist','[]',true);
 if p_new then items:=(select coalesce(jsonb_agg(x||'{"done":false}'::jsonb),'[]') from jsonb_array_elements(items)x); end if;
 pct:=case when jsonb_array_length(items)>0 then (select count(*) filter(where (x->>'done')::boolean)*100/count(*) from jsonb_array_elements(items)x) else coalesce(old.progress,0) end;
 next_status:=coalesce(old.status,'todo');
 if (next_status in ('review','done') and pct<100) or (next_status='todo' and pct>0) then next_status:='in_progress'; end if;
 if p_new then
  insert into public.hub_portal_tasks(id,title,description,hub,assignee_id,priority,due_at,checklist,created_by) values(ident,btrim(p_payload->>'title'),btrim(coalesce(p_payload->>'description','')),p_payload->>'hub',(p_payload->>'assignee_id')::uuid,p_payload->>'priority',(p_payload->>'due_at')::timestamptz,items,auth.uid()) returning * into result;
 else
  update public.hub_portal_tasks set title=btrim(p_payload->>'title'),description=btrim(coalesce(p_payload->>'description','')),hub=p_payload->>'hub',assignee_id=(p_payload->>'assignee_id')::uuid,priority=p_payload->>'priority',due_at=(p_payload->>'due_at')::timestamptz,checklist=items,progress=pct,status=next_status,updated_at=clock_timestamp() where id=ident returning * into result;
 end if;
 perform hub_portal_private.task_event(ident,case when p_new then 'create' else 'edit' end,case when p_new then 'Tugas dibuat dan ditugaskan kepada PIC.' else 'Detail tugas diperbarui admin.' end,jsonb_build_object('assignee_id',result.assignee_id,'hub',result.hub,'due_at',result.due_at,'priority',result.priority,'status',result.status));
 return hub_portal_private.task_json(result);
end; $$;
create function public.hub_portal_task_save(p_payload jsonb,p_new boolean) returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.task_save(p_payload,p_new); $$;
create function hub_portal_private.task_progress(p_id uuid,p_expected timestamptz,p_status text,p_checklist jsonb,p_progress integer,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.hub_portal_tasks; result public.hub_portal_tasks; adm boolean:=hub_portal_private.is_admin(); items jsonb; pct integer; note_text text:=btrim(coalesce(p_note,''));
begin
 if not hub_portal_private.can_work_task(p_id) then raise exception 'Anda tidak memiliki akses untuk memperbarui tugas ini.'; end if;
 select * into old from public.hub_portal_tasks where id=p_id for update;
 if old.archived or (not adm and old.assignee_id<>auth.uid()) then raise exception 'Tugas tidak dapat diperbarui.'; end if;
 if p_expected is null or old.updated_at<>p_expected then raise exception 'Progres sudah berubah. Muat ulang detail tugas.'; end if;
 if p_status is null or p_status not in ('todo','in_progress','blocked','review','done') or char_length(note_text)>3000 then raise exception 'Status atau catatan belum sesuai.'; end if;
 if not adm and (p_status='done' or old.status='done') then raise exception 'Penyelesaian tugas harus diverifikasi admin.'; end if;
 if p_status='done' and old.status<>'review' then raise exception 'Tugas harus diajukan untuk verifikasi sebelum diselesaikan.'; end if;
 if (p_status='blocked' or (adm and old.status in ('done','review') and p_status in ('todo','in_progress'))) and note_text='' then raise exception 'Tuliskan alasan penundaan atau perbaikan pada catatan.'; end if;
 items:=hub_portal_private.valid_checklist(p_checklist,old.checklist,false);
 pct:=case when jsonb_array_length(items)>0 then (select count(*) filter(where (x->>'done')::boolean)*100/count(*) from jsonb_array_elements(items)x) else p_progress end;
 if pct is null or pct not between 0 and 100 or (p_status in ('review','done') and pct<>100) or (p_status='todo' and pct<>0) then raise exception 'Progres harus 100%% untuk diajukan/verifikasi, atau 0%% untuk belum dikerjakan.'; end if;
 update public.hub_portal_tasks set status=p_status,checklist=items,progress=pct,updated_at=clock_timestamp() where id=p_id returning * into result;
 perform hub_portal_private.task_event(p_id,case when p_status='done' then 'verify' else 'progress' end,note_text,jsonb_build_object('from_status',old.status,'status',p_status,'from_progress',old.progress,'progress',pct));
 return hub_portal_private.task_json(result);
end; $$;
create function public.hub_portal_task_progress(p_id uuid,p_expected timestamptz,p_status text,p_checklist jsonb,p_progress integer,p_note text default '') returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.task_progress(p_id,p_expected,p_status,p_checklist,p_progress,p_note); $$;
create function hub_portal_private.task_archive(p_id uuid,p_expected timestamptz,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare old public.hub_portal_tasks;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengarsipkan tugas.'; end if;
 select * into old from public.hub_portal_tasks where id=p_id for update;
 if not found or p_expected is null or old.updated_at<>p_expected or p_archived is null then raise exception 'Tugas sudah berubah. Muat ulang daftar tugas.'; end if;
 update public.hub_portal_tasks set archived=p_archived,updated_at=clock_timestamp() where id=p_id;
 perform hub_portal_private.task_event(p_id,case when p_archived then 'archive' else 'restore' end,case when p_archived then 'Tugas diarsipkan.' else 'Tugas dipulihkan dari arsip.' end);
end; $$;
create function public.hub_portal_task_archive(p_id uuid,p_expected timestamptz,p_archived boolean) returns void language sql security invoker set search_path='' as $$ select hub_portal_private.task_archive(p_id,p_expected,p_archived); $$;
revoke all on function hub_portal_private.valid_checklist(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function hub_portal_private.task_save(jsonb,boolean),public.hub_portal_task_save(jsonb,boolean),hub_portal_private.task_progress(uuid,timestamptz,text,jsonb,integer,text),public.hub_portal_task_progress(uuid,timestamptz,text,jsonb,integer,text),hub_portal_private.task_archive(uuid,timestamptz,boolean),public.hub_portal_task_archive(uuid,timestamptz,boolean) from public,anon;
grant execute on function hub_portal_private.task_save(jsonb,boolean),public.hub_portal_task_save(jsonb,boolean),hub_portal_private.task_progress(uuid,timestamptz,text,jsonb,integer,text),public.hub_portal_task_progress(uuid,timestamptz,text,jsonb,integer,text),hub_portal_private.task_archive(uuid,timestamptz,boolean),public.hub_portal_task_archive(uuid,timestamptz,boolean) to authenticated;

-- @stage task_evidence
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hub-portal-task-files','hub-portal-task-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create table hub_portal_private.task_file_refs(path text primary key,event_id uuid not null references public.hub_portal_task_events(id),object_id uuid not null references storage.objects(id) on delete restrict);
create index hub_task_file_event_idx on hub_portal_private.task_file_refs(event_id);
create index hub_task_file_object_idx on hub_portal_private.task_file_refs(object_id);
alter table hub_portal_private.task_file_refs enable row level security;
revoke all on hub_portal_private.task_file_refs from public,anon,authenticated;
create policy hub_task_file_refs_admin on hub_portal_private.task_file_refs for select to authenticated using((select hub_portal_private.is_admin()));
create function hub_portal_private.task_file_access(p_name text,p_write boolean,p_delete boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare task_ident uuid; uploader uuid;
begin
 if not hub_portal_private.is_team_member() or p_name !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$' then return false; end if;
 begin task_ident:=split_part(p_name,'/',1)::uuid;uploader:=split_part(p_name,'/',2)::uuid;exception when invalid_text_representation then return false;end;
 if p_write then
  return uploader=auth.uid() and hub_portal_private.can_work_task(task_ident) and (not p_delete or not exists(select 1 from hub_portal_private.task_file_refs where path=p_name));
 end if;
 return hub_portal_private.can_read_task(task_ident) and (exists(select 1 from hub_portal_private.task_file_refs r join public.hub_portal_task_events e on e.id=r.event_id where r.path=p_name and e.task_id=task_ident) or (uploader=auth.uid() and hub_portal_private.can_work_task(task_ident) and not exists(select 1 from hub_portal_private.task_file_refs where path=p_name)));
end; $$;
create function hub_portal_private.task_comment(p_id uuid,p_body text,p_attachments jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare f jsonb; path_text text; object_ident uuid; actual jsonb; ident uuid; clean jsonb:='[]'; seen text[]:='{}'; task_row public.hub_portal_tasks;
begin
 if not hub_portal_private.can_work_task(p_id) then raise exception 'Anda tidak memiliki akses untuk menambahkan catatan.'; end if;
 select * into task_row from public.hub_portal_tasks where id=p_id for update;
 if task_row.archived or not hub_portal_private.can_work_task(p_id) then raise exception 'Tugas sudah diarsipkan atau akses berubah.'; end if;
 if p_attachments is null or jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>4 or char_length(btrim(coalesce(p_body,'')))>3000 or (btrim(coalesce(p_body,''))='' and jsonb_array_length(p_attachments)=0) then raise exception 'Isi catatan atau unggah maksimal 4 bukti.'; end if;
 for f in select value from jsonb_array_elements(p_attachments) loop
  path_text:=f->>'path';
  if path_text is null or split_part(path_text,'/',1)<>p_id::text or not hub_portal_private.task_file_access(path_text,true,false) or path_text=any(seen) or char_length(coalesce(f->>'name','')) not between 1 and 180 or (f->>'size')::bigint not between 1 and 10485760 or (path_text not like '%.pdf' and (f->>'size')::bigint>5242880) then raise exception 'File bukti tidak valid.'; end if;
  select id,metadata into object_ident,actual from storage.objects where bucket_id='hub-portal-task-files' and name=path_text for share;
  if object_ident is null or (actual->>'size')::bigint is distinct from (f->>'size')::bigint or coalesce(actual->>'mimetype','')<>(case when path_text like '%.pdf' then 'application/pdf' when path_text like '%.jpg' then 'image/jpeg' when path_text like '%.png' then 'image/png' else 'image/webp' end) then raise exception 'File belum terunggah atau format tidak sesuai.'; end if;
  clean:=clean||jsonb_build_array(jsonb_build_object('path',path_text,'name',f->>'name','size',(f->>'size')::bigint));seen:=array_append(seen,path_text);
 end loop;
 ident:=hub_portal_private.task_event(p_id,'comment',btrim(coalesce(p_body,'')),'{}',clean);
 for f in select value from jsonb_array_elements(clean) loop
  insert into hub_portal_private.task_file_refs(path,event_id,object_id) select f->>'path',ident,o.id from storage.objects o where o.bucket_id='hub-portal-task-files' and o.name=f->>'path';
 end loop;
 return ident;
end; $$;
create function public.hub_portal_task_comment(p_id uuid,p_body text,p_attachments jsonb default '[]') returns uuid language sql security invoker set search_path='' as $$ select hub_portal_private.task_comment(p_id,p_body,p_attachments); $$;
revoke all on function hub_portal_private.task_file_access(text,boolean,boolean),hub_portal_private.task_comment(uuid,text,jsonb),public.hub_portal_task_comment(uuid,text,jsonb) from public,anon;
grant execute on function hub_portal_private.task_file_access(text,boolean,boolean),hub_portal_private.task_comment(uuid,text,jsonb),public.hub_portal_task_comment(uuid,text,jsonb) to authenticated;
create policy hub_task_file_read on storage.objects for select to authenticated using(bucket_id='hub-portal-task-files' and hub_portal_private.task_file_access(name,false,false));
create policy hub_task_file_insert on storage.objects for insert to authenticated with check(bucket_id='hub-portal-task-files' and hub_portal_private.task_file_access(name,true,false));
create policy hub_task_file_delete on storage.objects for delete to authenticated using(bucket_id='hub-portal-task-files' and hub_portal_private.task_file_access(name,true,true));
notify pgrst,'reload schema';
commit;
