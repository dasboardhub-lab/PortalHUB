-- Jalankan setelah setup-supabase.sql. Tidak mengubah data portal yang sudah ada.
begin;
create table public.hub_portal_handovers (
 id uuid primary key default gen_random_uuid(),
 account_id text not null check(char_length(btrim(account_id)) between 1 and 150),
 password text not null default '' check(char_length(password)<=500),
 hub text not null check(hub in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')),
 route text not null check(char_length(btrim(route)) between 1 and 300),
 description text not null default '' check(char_length(description)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp()
);
create index hub_portal_handovers_hub_idx on public.hub_portal_handovers(hub);
create table public.hub_portal_document_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 1 and 70),
 parent_id uuid references public.hub_portal_document_categories(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp(),
 check(parent_id is distinct from id)
);
create unique index hub_portal_document_category_name_idx on public.hub_portal_document_categories(coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(btrim(name)));
create index hub_portal_document_category_parent_idx on public.hub_portal_document_categories(parent_id);
create table public.hub_portal_documents (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 1 and 150),
 category_id uuid not null references public.hub_portal_document_categories(id) on delete restrict,
 subcategory_id uuid references public.hub_portal_document_categories(id) on delete restrict,
 hub text not null default 'ALL' check(hub in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')),
 pic text not null check(char_length(btrim(pic)) between 1 and 150),
 document_date date not null default current_date,
 reference text not null default '' check(char_length(reference)<=100),
 version text not null default '' check(char_length(version)<=50),
 description text not null default '' check(char_length(description)<=3000),
 file_path text not null unique check(file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
 file_name text not null check(char_length(file_name) between 1 and 255),
 file_size bigint not null check(file_size between 1 and 26214400),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp()
);
create index hub_portal_documents_category_idx on public.hub_portal_documents(category_id);
create index hub_portal_documents_subcategory_idx on public.hub_portal_documents(subcategory_id);
create index hub_portal_documents_hub_idx on public.hub_portal_documents(hub);
create index hub_portal_documents_date_idx on public.hub_portal_documents(document_date desc);

create function hub_portal_private.validate_module_row() returns trigger
language plpgsql security invoker set search_path='' as $$
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
  if split_part(new.file_path,'/',1)<>new.id::text then raise exception 'Lokasi file tidak sesuai dengan dokumen.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='hub-portal-documents' and name=new.file_path and metadata->>'mimetype'='application/pdf' and (metadata->>'size')::bigint=new.file_size) then raise exception 'File PDF belum terunggah atau ukuran tidak sesuai.'; end if;
 end if;
 return new;
end; $$;
revoke all on function hub_portal_private.validate_module_row() from public,anon;
create trigger hub_handovers_validate before insert or update on public.hub_portal_handovers for each row execute function hub_portal_private.validate_module_row();
create trigger hub_document_categories_validate before insert or update on public.hub_portal_document_categories for each row execute function hub_portal_private.validate_module_row();
create trigger hub_documents_validate before insert or update on public.hub_portal_documents for each row execute function hub_portal_private.validate_module_row();

-- Catatan aktivitas tidak memuat ID akun, password, atau isi dokumen.
create function hub_portal_private.audit_module_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengubah data.'; end if;
 insert into public.hub_portal_activity(description,actor) values(
  case TG_TABLE_NAME when 'hub_portal_handovers' then 'Data serah terima' when 'hub_portal_documents' then 'Dokumen PDF' else 'Kategori dokumen' end || case TG_OP when 'INSERT' then ' ditambahkan.' when 'UPDATE' then ' diperbarui.' else ' dihapus.' end,auth.uid());
 return null;
end; $$;
revoke all on function hub_portal_private.audit_module_change() from public,anon,authenticated;
create trigger hub_handovers_audit after insert or update or delete on public.hub_portal_handovers for each row execute function hub_portal_private.audit_module_change();
create trigger hub_document_categories_audit after insert or update or delete on public.hub_portal_document_categories for each row execute function hub_portal_private.audit_module_change();
create trigger hub_documents_audit after insert or update or delete on public.hub_portal_documents for each row execute function hub_portal_private.audit_module_change();

alter table public.hub_portal_handovers enable row level security;
alter table public.hub_portal_document_categories enable row level security;
alter table public.hub_portal_documents enable row level security;
revoke all on public.hub_portal_handovers,public.hub_portal_document_categories,public.hub_portal_documents from anon,authenticated;
grant select,insert,update,delete on public.hub_portal_handovers,public.hub_portal_document_categories,public.hub_portal_documents to authenticated;
create policy hub_handover_read on public.hub_portal_handovers for select to authenticated using ((select hub_portal_private.is_member()));
create policy hub_handover_insert on public.hub_portal_handovers for insert to authenticated with check ((select hub_portal_private.is_admin()));
create policy hub_handover_update on public.hub_portal_handovers for update to authenticated using ((select hub_portal_private.is_admin())) with check ((select hub_portal_private.is_admin()));
create policy hub_handover_delete on public.hub_portal_handovers for delete to authenticated using ((select hub_portal_private.is_admin()));
create policy hub_doc_category_read on public.hub_portal_document_categories for select to authenticated using ((select hub_portal_private.is_member()));
create policy hub_doc_category_insert on public.hub_portal_document_categories for insert to authenticated with check ((select hub_portal_private.is_admin()));
create policy hub_doc_category_update on public.hub_portal_document_categories for update to authenticated using ((select hub_portal_private.is_admin())) with check ((select hub_portal_private.is_admin()));
create policy hub_doc_category_delete on public.hub_portal_document_categories for delete to authenticated using ((select hub_portal_private.is_admin()));
create policy hub_docs_read on public.hub_portal_documents for select to authenticated using ((select hub_portal_private.is_member()));
create policy hub_docs_insert on public.hub_portal_documents for insert to authenticated with check ((select hub_portal_private.is_admin()));
create policy hub_docs_update on public.hub_portal_documents for update to authenticated using ((select hub_portal_private.is_admin())) with check ((select hub_portal_private.is_admin()));
create policy hub_docs_delete on public.hub_portal_documents for delete to authenticated using ((select hub_portal_private.is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hub-portal-documents','hub-portal-documents',false,26214400,array['application/pdf']);
create policy hub_document_file_read on storage.objects for select to authenticated
using(bucket_id='hub-portal-documents' and ((select hub_portal_private.is_admin()) or ((select hub_portal_private.is_member()) and exists(select 1 from public.hub_portal_documents d where d.file_path=name))));
create policy hub_document_file_insert on storage.objects for insert to authenticated
with check(bucket_id='hub-portal-documents' and (select hub_portal_private.is_admin()) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$');
create policy hub_document_file_delete on storage.objects for delete to authenticated
using(bucket_id='hub-portal-documents' and (select hub_portal_private.is_admin()) and not exists(select 1 from public.hub_portal_documents d where d.file_path=name));
commit;
