-- Gambar informasi admin. Jalankan setelah setup-updates.sql.
-- STAGE 1: image_schema
begin;
alter table public.hub_portal_updates add column images jsonb not null default '[]'::jsonb check(jsonb_typeof(images)='array' and jsonb_array_length(images)<=4);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hub-portal-images','hub-portal-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table hub_portal_private.update_image_refs(
 update_id uuid not null references public.hub_portal_updates(id) on delete cascade,
 path text not null,
 object_id uuid not null references storage.objects(id) on delete restrict,
 primary key(update_id,path)
);
create index update_image_refs_path_idx on hub_portal_private.update_image_refs(path);
create index update_image_refs_object_idx on hub_portal_private.update_image_refs(object_id);
alter table hub_portal_private.update_image_refs enable row level security;
revoke all on hub_portal_private.update_image_refs from public,anon,authenticated;
create policy update_image_refs_admin_read on hub_portal_private.update_image_refs for select to authenticated using((select hub_portal_private.is_admin()));
commit;

-- STAGE 2: image_validation
begin;
create function hub_portal_private.validate_update_images(row_id uuid,photos jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry jsonb;result jsonb:='[]'::jsonb;object_path text;file_name text;caption text;byte_size bigint;image_width integer;image_height integer;stored_metadata jsonb;
begin
 if photos is null or jsonb_typeof(photos) is distinct from 'array' or jsonb_array_length(photos)>4 or octet_length(photos::text)>12000 then raise exception 'Maksimal 4 gambar per informasi.'; end if;
 for entry in select value from jsonb_array_elements(photos) loop
  if jsonb_typeof(entry) is distinct from 'object' then raise exception 'Data gambar tidak valid.'; end if;
  object_path:=entry->>'path';file_name:=btrim(coalesce(entry->>'name',''));caption:=btrim(coalesce(entry->>'caption',''));
  if object_path is null or object_path !~ ('^'||row_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$') or char_length(file_name) not between 1 and 180 or char_length(caption)>200 then raise exception 'Nama atau keterangan gambar tidak valid.'; end if;
  if exists(select 1 from jsonb_array_elements(result) p where p->>'path'=object_path) then raise exception 'Gambar yang sama tidak boleh ditambahkan dua kali.'; end if;
  if coalesce(entry->>'size','') !~ '^[0-9]{1,8}$' or coalesce(entry->>'width','') !~ '^[0-9]{1,5}$' or coalesce(entry->>'height','') !~ '^[0-9]{1,5}$' then raise exception 'Ukuran gambar tidak valid.'; end if;
  byte_size:=(entry->>'size')::bigint;image_width:=(entry->>'width')::integer;image_height:=(entry->>'height')::integer;
  if byte_size not between 1 and 5242880 or image_width not between 1 and 12000 or image_height not between 1 and 12000 or image_width::bigint*image_height>24000000 then raise exception 'Gambar maksimal 5 MB dan 24 megapiksel.'; end if;
  select o.metadata into stored_metadata from storage.objects o where o.bucket_id='hub-portal-images' and o.name=object_path for share;
  if not found then raise exception 'Gambar belum selesai diunggah. Pilih ulang lalu coba lagi.'; end if;
  if coalesce(stored_metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp') or coalesce(stored_metadata->>'size','') !~ '^[0-9]{1,8}$' then raise exception 'Format gambar harus JPG, PNG, atau WebP.'; end if;
  if (stored_metadata->>'size')::bigint<>byte_size then raise exception 'Ukuran unggahan gambar tidak cocok.'; end if;
  if (stored_metadata->>'mimetype'='image/jpeg' and object_path !~ '[.]jpg$') or (stored_metadata->>'mimetype'='image/png' and object_path !~ '[.]png$') or (stored_metadata->>'mimetype'='image/webp' and object_path !~ '[.]webp$') then raise exception 'Format gambar tidak cocok dengan unggahan.'; end if;
  result:=result||jsonb_build_array(jsonb_build_object('path',object_path,'name',file_name,'size',byte_size,'width',image_width,'height',image_height,'caption',caption));
 end loop;
 return result;
end; $$;
revoke all on function hub_portal_private.validate_update_images(uuid,jsonb) from public,anon,authenticated;
commit;

-- STAGE 3: image_save_api
begin;
create function hub_portal_private.update_save_with_images(payload jsonb,is_new boolean,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row_id uuid;previous public.hub_portal_updates;saved public.hub_portal_updates;photos jsonb;response jsonb;
begin
 if auth.uid() is null or not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengelola informasi.' using errcode='42501'; end if;
 if is_new is null or payload is null or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>30000 then raise exception 'Isian informasi tidak valid.'; end if;
 row_id:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if not is_new then
  select * into previous from public.hub_portal_updates where id=row_id and updated_at=expected_updated_at for update;
  if not found then raise exception 'Informasi sudah berubah. Muat ulang lalu coba lagi.'; end if;
  if previous.source<>'manual' then raise exception 'Riwayat pembaruan otomatis tidak dapat diubah.' using errcode='42501'; end if;
 end if;
 photos:=case when payload ? 'images' then payload->'images' else coalesce(previous.images,'[]'::jsonb) end;
 photos:=hub_portal_private.validate_update_images(row_id,photos);
 response:=hub_portal_private.update_save(payload||jsonb_build_object('id',row_id),is_new,expected_updated_at);
 if photos is distinct from coalesce(previous.images,'[]'::jsonb) then
  update public.hub_portal_updates set images=photos,updated_at=clock_timestamp() where id=row_id;
  delete from hub_portal_private.update_image_refs where update_id=row_id;
  insert into hub_portal_private.update_image_refs(update_id,path,object_id)
   select row_id,p->>'path',o.id from jsonb_array_elements(photos) p join storage.objects o on o.bucket_id='hub-portal-images' and o.name=p->>'path';
  if not is_new and response->'item'->>'updated_at'=to_jsonb(previous)->>'updated_at' then
   insert into public.hub_portal_activity(description,actor) values('Gambar informasi tim diperbarui',auth.uid());
  end if;
 end if;
 select * into saved from public.hub_portal_updates where id=row_id;
 return jsonb_build_object('ok',true,'item',to_jsonb(saved));
end; $$;
revoke all on function hub_portal_private.update_save_with_images(jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function hub_portal_private.update_save_with_images(jsonb,boolean,timestamptz) to authenticated;
create or replace function public.hub_portal_update_save(payload jsonb,is_new boolean,expected_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.update_save_with_images(payload,is_new,expected_updated_at); $$;
commit;

-- STAGE 4: image_storage_policies
begin;
create function hub_portal_private.update_image_access(object_path text,deleting boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select case when deleting then hub_portal_private.is_admin() and not exists(select 1 from hub_portal_private.update_image_refs r where r.path=object_path)
 else hub_portal_private.is_admin() or exists(select 1 from hub_portal_private.update_image_refs r join public.hub_portal_updates u on u.id=r.update_id where r.path=object_path and u.status='published') end;
$$;
revoke all on function hub_portal_private.update_image_access(text,boolean) from public,anon,authenticated;
grant execute on function hub_portal_private.update_image_access(text,boolean) to anon,authenticated;
create policy hub_image_read on storage.objects for select to anon,authenticated using(bucket_id='hub-portal-images' and hub_portal_private.update_image_access(name,false));
create policy hub_image_insert on storage.objects for insert to authenticated with check(bucket_id='hub-portal-images' and (select hub_portal_private.is_admin()) and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$');
create policy hub_image_delete on storage.objects for delete to authenticated using(bucket_id='hub-portal-images' and hub_portal_private.update_image_access(name,true));
notify pgrst,'reload schema';
commit;
