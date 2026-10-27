-- Cadangan lengkap data Portal HUB dan referensi file; jalankan setelah setup-team-tasks.sql.
begin;
-- @stage schema
create table hub_portal_private.backup_origin(id boolean primary key default true check(id),origin uuid not null default gen_random_uuid());
insert into hub_portal_private.backup_origin(id) values(true);
alter table hub_portal_private.backup_origin enable row level security;
revoke all on hub_portal_private.backup_origin from public,anon,authenticated;
create policy hub_backup_origin_admin on hub_portal_private.backup_origin for select to authenticated using((select hub_portal_private.is_admin()));

create function hub_portal_private.backup_data() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb:='{}'; table_name text; rows_json jsonb;
begin
 foreach table_name in array array['categories','links','settings','members','handovers','document_categories','documents','updates','tasks','task_events','activity'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.%I),''[]''::jsonb) from public.%I t',case when table_name='members' then 'user_id' else 'id' end,'hub_portal_'||table_name) into rows_json;
  result:=result||jsonb_build_object(table_name,rows_json);
 end loop;
 return result;
end; $$;
create function hub_portal_private.backup_files(d jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 with refs as (
  select 'hub-portal-documents'::text bucket,x->>'file_path' path,x->>'file_name' name,(x->>'file_size')::bigint size from jsonb_array_elements(d->'documents')x
  union all select 'hub-portal-images',p->>'path',p->>'name',(p->>'size')::bigint from jsonb_array_elements(d->'updates')u cross join lateral jsonb_array_elements(u->'images')p
  union all select 'hub-portal-task-files',p->>'path',p->>'name',(p->>'size')::bigint from jsonb_array_elements(d->'task_events')e cross join lateral jsonb_array_elements(e->'attachments')p
 ), unique_refs as(select distinct on(bucket,path) * from refs order by bucket,path)
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path,'name',name,'size',size,'mime',case when path like '%.pdf' then 'application/pdf' when path like '%.jpg' then 'image/jpeg' when path like '%.png' then 'image/png' when path like '%.webp' then 'image/webp' else '' end) order by bucket,path),'[]') from unique_refs;
$$;
revoke all on function hub_portal_private.backup_data(),hub_portal_private.backup_files(jsonb) from public,anon,authenticated;
create function hub_portal_private.backup_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;
begin
 if auth.uid() is null or not hub_portal_private.is_admin() then raise exception 'Hanya admin aktif yang dapat mengunduh cadangan.' using errcode='42501'; end if;
 d:=hub_portal_private.backup_data();
 return jsonb_build_object('format','portal-hub-v2','origin',(select origin from hub_portal_private.backup_origin),'exportedAt',clock_timestamp(),'fingerprint',md5(d::text),'data',d,'files',hub_portal_private.backup_files(d));
end; $$;
create function public.hub_portal_backup_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.backup_snapshot(); $$;
revoke all on function hub_portal_private.backup_snapshot(),public.hub_portal_backup_snapshot() from public,anon;
grant execute on function hub_portal_private.backup_snapshot(),public.hub_portal_backup_snapshot() to authenticated;

-- Admin dapat menyiapkan file tugas sebelum data tugas dipulihkan.
-- Anggota tetap dibatasi ke tugasnya; file yang sedang dirujuk tidak dapat dihapus.
create function hub_portal_private.unused_task_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select hub_portal_private.is_admin() and not exists(select 1 from hub_portal_private.task_file_refs where path=p_path); $$;
revoke all on function hub_portal_private.unused_task_file(text) from public,anon;
grant execute on function hub_portal_private.unused_task_file(text) to authenticated;
create policy hub_task_backup_admin_read on storage.objects for select to authenticated using(bucket_id='hub-portal-task-files' and (select hub_portal_private.is_admin()));
create policy hub_task_backup_admin_insert on storage.objects for insert to authenticated with check(bucket_id='hub-portal-task-files' and (select hub_portal_private.is_admin()) and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$' and split_part(name,'/',2)=(select auth.uid())::text);
create policy hub_task_backup_admin_delete on storage.objects for delete to authenticated using(bucket_id='hub-portal-task-files' and hub_portal_private.unused_task_file(name));

-- @stage restore
create function hub_portal_private.backup_restore(p_backup jsonb,p_files jsonb,p_expected text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_backup->'data'; f jsonb; x jsonb; v jsonb; photos jsonb; raw_files jsonb; mappings jsonb; table_name text; new_path text; stored jsonb; stored_id uuid; owner_id uuid:=(select auth.uid()); settings_row public.hub_portal_settings;
begin
 if owner_id is null or not hub_portal_private.is_admin() then raise exception 'Hanya admin aktif yang dapat memulihkan cadangan.' using errcode='42501'; end if;
 if p_backup->>'format' is distinct from 'portal-hub-v2' or p_backup->>'origin' is distinct from (select origin::text from hub_portal_private.backup_origin) then raise exception 'Cadangan ini tidak berasal dari proyek portal yang sama.'; end if;
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>20971520 or jsonb_typeof(p_files) is distinct from 'array' then raise exception 'Format atau ukuran data cadangan tidak sesuai.'; end if;
 foreach table_name in array array['categories','links','settings','members','handovers','document_categories','documents','updates','tasks','task_events','activity'] loop
  if jsonb_typeof(d->table_name) is distinct from 'array' or jsonb_array_length(d->table_name)>100000 then raise exception 'Bagian data cadangan tidak lengkap: %.',table_name; end if;
 end loop;
 if jsonb_array_length(d->'categories')<1 or jsonb_array_length(d->'settings')<>1 or d->'settings'->0->>'id'<>'main' or jsonb_array_length(d->'members')<1 then raise exception 'Pengaturan atau akun dalam cadangan tidak lengkap.'; end if;
 -- Jangan mengubah kredensial Auth atau identitas login. Profil hanya untuk akun yang masih ada.
 for x in select value from jsonb_array_elements(d->'members') loop
  if not exists(select 1 from auth.users where id=(x->>'user_id')::uuid) then raise exception 'Ada akun login dalam cadangan yang sudah tidak tersedia di Supabase.'; end if;
  if x->>'staff_id' is not null and not exists(select 1 from auth.users where id=(x->>'user_id')::uuid and lower(email)='staff-'||(x->>'staff_id')||'@portalhub.invalid') then raise exception 'NIK/ID cadangan tidak sesuai dengan akun login.'; end if;
 end loop;
 for x in select value from jsonb_array_elements(d->'categories') loop
  perform hub_portal_private.validate_submenus(x->'submenus');
 end loop;
 for x in select value from jsonb_array_elements(d->'handovers') loop
  if (x->>'password_locked')::boolean and coalesce(x->>'unlock_code_hash','') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then raise exception 'Kode pembatas Pass dalam cadangan tidak valid.'; end if;
 end loop;
 -- Semua alamat tetap melalui validasi layanan, termasuk pada berkas yang diedit manual.
 for x in select value from jsonb_array_elements(d->'links') loop
  perform hub_portal_private.validate_link(x||jsonb_build_object('group',x->>'group_name','sortOrder',x->'sort_order'));
 end loop;
 for x in select value from jsonb_array_elements(d->'updates') loop
  if coalesce(x->>'url','')<>'' and x->>'url' !~ '^https?://[^[:space:]/?#@:]+(:[0-9]+)?([/?#][^[:space:]]*)?$' then raise exception 'Alamat tautan informasi dalam cadangan tidak valid.'; end if;
  if jsonb_typeof(x->'images') is distinct from 'array' or jsonb_array_length(x->'images')>4 then raise exception 'Daftar gambar informasi tidak valid.'; end if;
 end loop;
 for x in select value from jsonb_array_elements(d->'tasks') loop
  perform hub_portal_private.valid_checklist(x->'checklist','[]',true);
  if (x->>'status' in ('review','done') and (x->>'progress')::integer<>100) or (x->>'status'='todo' and (x->>'progress')::integer<>0) or not exists(select 1 from jsonb_array_elements(d->'members')u where u->>'user_id'=x->>'assignee_id') then raise exception 'Progres atau PIC tugas dalam cadangan tidak sesuai.'; end if;
  if jsonb_array_length(x->'checklist')>0 and (x->>'progress')::integer<>(select count(*) filter(where (i->>'done')::boolean)*100/count(*) from jsonb_array_elements(x->'checklist')i) then raise exception 'Persentase checklist tidak sesuai.'; end if;
 end loop;
 for x in select value from jsonb_array_elements(d->'task_events') loop
  if jsonb_typeof(x->'attachments') is distinct from 'array' or jsonb_array_length(x->'attachments')>4 then raise exception 'Daftar bukti tugas tidak valid.'; end if;
  for f in select value from jsonb_array_elements(x->'attachments') loop
   if split_part(f->>'path','/',1) is distinct from x->>'task_id' or char_length(coalesce(f->>'name','')) not between 1 and 180 or (f->>'size')::bigint not between 1 and 10485760 or (f->>'path' not like '%.pdf' and (f->>'size')::bigint>5242880) then raise exception 'Bukti tugas tidak sesuai dengan cadangan.'; end if;
  end loop;
 end loop;
 raw_files:=hub_portal_private.backup_files(d);
 if jsonb_array_length(p_files)<>jsonb_array_length(raw_files) or jsonb_array_length(p_files)>10000 or (select count(*)<>count(distinct concat(value->>'bucket','|',value->>'old_path')) from jsonb_array_elements(p_files)) or (select count(*)<>count(distinct concat(value->>'bucket','|',value->>'new_path')) from jsonb_array_elements(p_files)) then raise exception 'Daftar file pemulihan tidak lengkap atau berulang.'; end if;
 select coalesce(jsonb_object_agg((value->>'bucket')||'|'||(value->>'old_path'),value->>'new_path'),'{}') into mappings from jsonb_array_elements(p_files);
 -- Cegah tim menimpa perubahan yang dibuat setelah pemulihan dimulai.
 lock table public.hub_portal_members,public.hub_portal_settings,public.hub_portal_categories,public.hub_portal_links,public.hub_portal_handovers,public.hub_portal_document_categories,public.hub_portal_documents,public.hub_portal_updates,public.hub_portal_tasks,public.hub_portal_task_events,public.hub_portal_activity,hub_portal_private.update_image_refs,hub_portal_private.task_file_refs in exclusive mode nowait;
 if not hub_portal_private.is_admin() then raise exception 'Akses admin sudah berubah.' using errcode='42501'; end if;
 if p_expected is null or md5(hub_portal_private.backup_data()::text)<>p_expected then raise exception 'Data portal berubah saat file disiapkan. Muat ulang lalu ulangi pemulihan.'; end if;
 for f in select value from jsonb_array_elements(raw_files) loop
  new_path:=mappings->>((f->>'bucket')||'|'||(f->>'path'));
  if new_path is null or new_path !~ '^[a-f0-9-]{36}/([a-f0-9-]{36}/)?[a-f0-9-]{36}\.(pdf|jpg|png|webp)$' or split_part(new_path,'/',1)<>split_part(f->>'path','/',1) then raise exception 'Lokasi file pemulihan tidak sesuai.'; end if;
  if f->>'bucket'='hub-portal-task-files' and split_part(new_path,'/',2)<>owner_id::text then raise exception 'Pengunggah bukti pemulihan tidak sesuai.'; end if;
  select id,metadata into stored_id,stored from storage.objects where bucket_id=f->>'bucket' and name=new_path for share nowait;
  if stored_id is null or stored->>'mimetype' is distinct from f->>'mime' or (stored->>'size')::bigint is distinct from (f->>'size')::bigint then raise exception 'Ada file yang belum terunggah lengkap. Data portal belum diubah.'; end if;
 end loop;
 -- Remap ke file baru; file lama tidak ditimpa selama persiapan.
 select coalesce(jsonb_agg(j.value||jsonb_build_object('file_path',mappings->>('hub-portal-documents|'||(j.value->>'file_path')))),'[]') into v from jsonb_array_elements(d->'documents')j;d:=jsonb_set(d,'{documents}',v);
 select coalesce(jsonb_agg(j.value||jsonb_build_object('images',(select coalesce(jsonb_agg(p||jsonb_build_object('path',mappings->>('hub-portal-images|'||(p->>'path')))),'[]') from jsonb_array_elements(j.value->'images')p))),'[]') into v from jsonb_array_elements(d->'updates')j;d:=jsonb_set(d,'{updates}',v);
 select coalesce(jsonb_agg(j.value||jsonb_build_object('attachments',(select coalesce(jsonb_agg(p||jsonb_build_object('path',mappings->>('hub-portal-task-files|'||(p->>'path')))),'[]') from jsonb_array_elements(j.value->'attachments')p))),'[]') into v from jsonb_array_elements(d->'task_events')j;d:=jsonb_set(d,'{task_events}',v);
 delete from hub_portal_private.task_file_refs;delete from hub_portal_private.update_image_refs;
 delete from public.hub_portal_task_events;delete from public.hub_portal_tasks;
 delete from public.hub_portal_updates;
 delete from public.hub_portal_documents;delete from public.hub_portal_document_categories where parent_id is not null;delete from public.hub_portal_document_categories;
 delete from public.hub_portal_handovers;delete from public.hub_portal_links;delete from public.hub_portal_categories;
 update public.hub_portal_members set active=false,updated_at=clock_timestamp() where user_id<>owner_id and not exists(select 1 from jsonb_array_elements(d->'members')m where m->>'user_id'=user_id::text);
 for x in select value from jsonb_array_elements(d->'members') loop
  insert into public.hub_portal_members(user_id,role,active,created_at,display_name,staff_id,hub,updated_at) values((x->>'user_id')::uuid,case when (x->>'user_id')::uuid=owner_id then 'admin' else x->>'role' end,case when (x->>'user_id')::uuid=owner_id then true else (x->>'active')::boolean end,(x->>'created_at')::timestamptz,x->>'display_name',x->>'staff_id',x->>'hub',clock_timestamp()) on conflict(user_id) do update set role=excluded.role,active=excluded.active,display_name=excluded.display_name,staff_id=excluded.staff_id,hub=excluded.hub,updated_at=excluded.updated_at;
 end loop;
 insert into public.hub_portal_categories select * from jsonb_populate_recordset(null::public.hub_portal_categories,d->'categories');
 insert into public.hub_portal_links select * from jsonb_populate_recordset(null::public.hub_portal_links,d->'links');
 select * into settings_row from jsonb_populate_recordset(null::public.hub_portal_settings,d->'settings');
 update public.hub_portal_settings set title=settings_row.title,area=settings_row.area,announcement_title=settings_row.announcement_title,announcement=settings_row.announcement,initialized=true,updated_at=clock_timestamp() where id='main';
 insert into public.hub_portal_handovers select * from jsonb_populate_recordset(null::public.hub_portal_handovers,d->'handovers');
 insert into public.hub_portal_document_categories select * from jsonb_populate_recordset(null::public.hub_portal_document_categories,d->'document_categories')r where parent_id is null;
 insert into public.hub_portal_document_categories select * from jsonb_populate_recordset(null::public.hub_portal_document_categories,d->'document_categories')r where parent_id is not null;
 insert into public.hub_portal_documents select * from jsonb_populate_recordset(null::public.hub_portal_documents,d->'documents');
 insert into public.hub_portal_tasks select * from jsonb_populate_recordset(null::public.hub_portal_tasks,d->'tasks');
 insert into public.hub_portal_task_events select * from jsonb_populate_recordset(null::public.hub_portal_task_events,d->'task_events');
 -- Ganti catatan otomatis yang timbul selama pemulihan dengan riwayat asli dan satu catatan pemulihan.
 delete from public.hub_portal_updates;
 insert into public.hub_portal_updates select * from jsonb_populate_recordset(null::public.hub_portal_updates,d->'updates');
 for x in select value from jsonb_array_elements(d->'updates') loop
  photos:=hub_portal_private.validate_update_images((x->>'id')::uuid,x->'images');
  insert into hub_portal_private.update_image_refs(update_id,path,object_id) select (x->>'id')::uuid,p->>'path',o.id from jsonb_array_elements(photos)p join storage.objects o on o.bucket_id='hub-portal-images' and o.name=p->>'path';
 end loop;
 insert into hub_portal_private.task_file_refs(path,event_id,object_id) select p->>'path',(e->>'id')::uuid,o.id from jsonb_array_elements(d->'task_events')e cross join lateral jsonb_array_elements(e->'attachments')p join storage.objects o on o.bucket_id='hub-portal-task-files' and o.name=p->>'path';
 delete from public.hub_portal_activity;
 insert into public.hub_portal_activity select * from jsonb_populate_recordset(null::public.hub_portal_activity,d->'activity');
 insert into public.hub_portal_activity(description,actor) values('Cadangan lengkap portal dipulihkan.',owner_id);
 insert into public.hub_portal_updates(title,body,kind,status,source,published_at) values('Pemulihan data portal','Admin memulihkan data portal dari cadangan. Muat ulang untuk melihat data yang tersedia.','update','published','system',clock_timestamp());
 return jsonb_build_object('ok',true,'message','Cadangan lengkap berhasil dipulihkan.','files',jsonb_array_length(raw_files));
end; $$;
create function public.hub_portal_backup_restore(p_backup jsonb,p_files jsonb,p_expected text) returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.backup_restore(p_backup,p_files,p_expected); $$;
revoke all on function hub_portal_private.backup_restore(jsonb,jsonb,text),public.hub_portal_backup_restore(jsonb,jsonb,text) from public,anon;
grant execute on function hub_portal_private.backup_restore(jsonb,jsonb,text),public.hub_portal_backup_restore(jsonb,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
