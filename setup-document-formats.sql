-- Tambahkan format dokumen tanpa mengubah file dan data yang sudah tersimpan.
-- Jalankan setelah setup-full-backup.sql pada pemasangan baru.
begin;
create or replace function hub_portal_private.document_mime(path text) returns text language sql immutable security invoker set search_path='' as $$
 select case lower(regexp_replace(path,'^.*\.',''))
 when 'pdf' then 'application/pdf'
 when 'doc' then 'application/msword'
 when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 when 'xls' then 'application/vnd.ms-excel'
 when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 when 'jpg' then 'image/jpeg'
 when 'jpeg' then 'image/jpeg'
 when 'png' then 'image/png'
 when 'webp' then 'image/webp'
 when 'gif' then 'image/gif'
 else '' end;
$$;
revoke all on function hub_portal_private.document_mime(text) from public,anon;
grant execute on function hub_portal_private.document_mime(text) to authenticated;

alter table public.hub_portal_documents drop constraint hub_portal_documents_file_path_check;
alter table public.hub_portal_documents add constraint hub_portal_documents_file_path_check check(file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|webp|gif)$');
update storage.buckets set allowed_mime_types=array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','image/gif'],file_size_limit=26214400 where id='hub-portal-documents';
alter policy hub_document_file_insert on storage.objects with check(bucket_id='hub-portal-documents' and (select hub_portal_private.is_admin()) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|webp|gif)$');
CREATE OR REPLACE FUNCTION hub_portal_private.validate_module_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 new.updated_at=clock_timestamp();
 if TG_OP='UPDATE' then new.created_at=old.created_at; new.id=old.id; end if;
 if TG_TABLE_NAME='hub_portal_document_categories' then
  if new.parent_id is not null and not exists(select 1 from public.hub_portal_document_categories where id=new.parent_id and parent_id is null) then
   raise exception 'Subkategori harus berada di dalam kategori utama.';
  end if;
  if TG_OP='UPDATE' and new.parent_id is distinct from old.parent_id then raise exception 'Induk kategori tidak dapat dipindahkan.'; end if;
 elsif TG_TABLE_NAME='hub_portal_documents' then
  if not exists(select 1 from public.hub_portal_document_categories where id=new.category_id and parent_id is null) then raise exception 'Pilih kategori utama yang valid.'; end if;
  if new.subcategory_id is not null and not exists(select 1 from public.hub_portal_document_categories where id=new.subcategory_id and parent_id=new.category_id) then raise exception 'Subkategori tidak sesuai dengan kategori.'; end if;
  if hub_portal_private.document_mime(new.file_name) is distinct from hub_portal_private.document_mime(new.file_path) then raise exception 'Nama dan jenis file dokumen tidak sesuai.'; end if;
  if split_part(new.file_path,'/',1)<>new.id::text then raise exception 'Lokasi file tidak sesuai dengan dokumen.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='hub-portal-documents' and name=new.file_path and metadata->>'mimetype'=hub_portal_private.document_mime(new.file_path) and (metadata->>'size')::bigint=new.file_size) then raise exception 'File dokumen belum terunggah atau ukuran tidak sesuai.'; end if;
 end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION hub_portal_private.audit_module_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengubah data.'; end if;
 insert into public.hub_portal_activity(description,actor) values(
  case TG_TABLE_NAME when 'hub_portal_handovers' then 'Data serah terima' when 'hub_portal_documents' then 'Dokumen' else 'Kategori dokumen' end || case TG_OP when 'INSERT' then ' ditambahkan.' when 'UPDATE' then ' diperbarui.' else ' dihapus.' end,auth.uid());
 return null;
end; $function$
;
CREATE OR REPLACE FUNCTION hub_portal_private.backup_files(d jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 with refs as (
  select 'hub-portal-documents'::text bucket,x->>'file_path' path,x->>'file_name' name,(x->>'file_size')::bigint size from jsonb_array_elements(d->'documents')x
  union all select 'hub-portal-images',p->>'path',p->>'name',(p->>'size')::bigint from jsonb_array_elements(d->'updates')u cross join lateral jsonb_array_elements(u->'images')p
  union all select 'hub-portal-task-files',p->>'path',p->>'name',(p->>'size')::bigint from jsonb_array_elements(d->'task_events')e cross join lateral jsonb_array_elements(e->'attachments')p
 ), unique_refs as(select distinct on(bucket,path) * from refs order by bucket,path)
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path,'name',name,'size',size,'mime',hub_portal_private.document_mime(path)) order by bucket,path),'[]') from unique_refs;
$function$
;
-- Pertahankan seluruh pemeriksaan pemulihan; ubah hanya format lokasi dokumen.
do $patch_restore$
declare definition text; old_fragment text:=$old$new_path !~ '^[a-f0-9-]{36}/([a-f0-9-]{36}/)?[a-f0-9-]{36}\.(pdf|jpg|png|webp)$'$old$; new_fragment text:=$new$new_path !~ (case when f->>'bucket'='hub-portal-documents' then '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|webp|gif)$' else '^[a-f0-9-]{36}/([a-f0-9-]{36}/)?[a-f0-9-]{36}\.(pdf|jpg|png|webp)$' end) or substring(new_path from '\.([a-z0-9]+)$') is distinct from substring(f->>'path' from '\.([a-z0-9]+)$')$new$;
begin
 definition:=pg_get_functiondef('hub_portal_private.backup_restore(jsonb,jsonb,text)'::regprocedure);
 if position(new_fragment in definition)>0 then return; end if;
 if position(old_fragment in definition)=0 then raise exception 'Versi pemulihan berbeda. Periksa sebelum memperbarui format dokumen.'; end if;
 execute replace(definition,old_fragment,new_fragment);
end;
$patch_restore$;
commit;
