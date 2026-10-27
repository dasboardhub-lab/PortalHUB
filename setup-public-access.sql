-- Baca publik melalui fungsi dengan daftar kolom terbatas, bukan akses tabel.
-- Jalankan setelah setup-supabase.sql dan setup-modules.sql.
begin;
grant usage on schema hub_portal_private to anon;
grant execute on function hub_portal_private.is_admin() to anon;
alter table public.hub_portal_handovers add column password_locked boolean not null default false, add column unlock_code_hash text;
alter table public.hub_portal_handovers add constraint hub_handover_code_required check(not password_locked or unlock_code_hash is not null);
create table hub_portal_private.handover_unlock_attempts(id uuid primary key references public.hub_portal_handovers(id) on delete cascade,attempts integer not null default 0,window_start timestamptz not null default clock_timestamp());
alter table hub_portal_private.handover_unlock_attempts enable row level security;
revoke all on hub_portal_private.handover_unlock_attempts from public,anon,authenticated;
-- Akses langsung ke tabel lengkap tetap hanya admin.
drop policy hub_handover_read on public.hub_portal_handovers;
create policy hub_handover_admin_read on public.hub_portal_handovers for select to authenticated using((select hub_portal_private.is_admin()));
create or replace function hub_portal_private.public_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'approved',true,
    'canManage',hub_portal_private.is_admin(),
    'links',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'title',l.title,'description',l.description,'category',l.category,
      'group',l.group_name,'hub',l.hub,'icon',l.icon,'color',l.color,'status',l.status,
      'actions',l.actions,'pinned',l.pinned,'sortOrder',l.sort_order,'updatedAt',l.updated_at
    ) order by l.sort_order,l.id) from public.hub_portal_links l),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'description',c.description,'icon',c.icon,'sortOrder',c.sort_order
    ) order by c.sort_order,c.id) from public.hub_portal_categories c),'[]'::jsonb),
    'settings',(select jsonb_build_object('title',s.title,'area',s.area,
      'announcementTitle',s.announcement_title,'announcement',s.announcement,'updatedAt',s.updated_at)
      from public.hub_portal_settings s where s.id='main'),
    'activity',case when hub_portal_private.is_admin() then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'createdAt',a.created_at) order by a.created_at desc,a.id)
      from (select id,description,created_at from public.hub_portal_activity order by created_at desc,id limit 5) a),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

revoke all on function hub_portal_private.public_snapshot() from public;
grant execute on function hub_portal_private.public_snapshot() to anon,authenticated;
create or replace function public.hub_portal_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.public_snapshot(); $$;
revoke all on function public.hub_portal_snapshot() from public;
grant execute on function public.hub_portal_snapshot() to anon,authenticated;

create function hub_portal_private.document_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category_id',d.category_id,'subcategory_id',d.subcategory_id,'hub',d.hub,'pic',d.pic,'document_date',d.document_date,'reference',d.reference,'version',d.version,'description',d.description,'file_path',d.file_path,'file_name',d.file_name,'file_size',d.file_size,'created_at',d.created_at,'updated_at',d.updated_at) order by d.updated_at desc,d.id) from (select * from public.hub_portal_documents order by updated_at desc,id offset p_offset limit p_limit) d),'[]'::jsonb);
end; $$;
revoke all on function hub_portal_private.document_list(integer,integer) from public;
grant execute on function hub_portal_private.document_list(integer,integer) to anon,authenticated;
create function public.hub_portal_document_list(p_offset integer default 0,p_limit integer default 500) returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.document_list(p_offset,p_limit); $$;
revoke all on function public.hub_portal_document_list(integer,integer) from public;
grant execute on function public.hub_portal_document_list(integer,integer) to anon,authenticated;

create function hub_portal_private.document_category_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'parent_id',c.parent_id,'updated_at',c.updated_at) order by c.updated_at desc,c.id) from (select * from public.hub_portal_document_categories order by updated_at desc,id offset p_offset limit p_limit) c),'[]'::jsonb);
end; $$;
revoke all on function hub_portal_private.document_category_list(integer,integer) from public;
grant execute on function hub_portal_private.document_category_list(integer,integer) to anon,authenticated;
create function public.hub_portal_document_category_list(p_offset integer default 0,p_limit integer default 500) returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.document_category_list(p_offset,p_limit); $$;
revoke all on function public.hub_portal_document_category_list(integer,integer) from public;
grant execute on function public.hub_portal_document_category_list(integer,integer) to anon,authenticated;

create function hub_portal_private.is_published_pdf(object_name text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.hub_portal_documents where file_path=object_name); $$;
revoke all on function hub_portal_private.is_published_pdf(text) from public;
grant execute on function hub_portal_private.is_published_pdf(text) to anon,authenticated;
drop policy hub_document_file_read on storage.objects;
create policy hub_document_file_read on storage.objects for select to anon,authenticated using(bucket_id='hub-portal-documents' and ((select hub_portal_private.is_admin()) or hub_portal_private.is_published_pdf(name)));
-- Pass tanpa pembatasan bersifat publik; Pass berkode tidak dikirim sebelum verifikasi.
create function hub_portal_private.handover_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare permitted boolean:=hub_portal_private.is_admin();
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'account_id',r.account_id,'password',case when permitted or not r.password_locked then r.password else '' end,'password_locked',r.password_locked,'has_password',r.password<>'','hub',r.hub,'route',r.route,'description',r.description,'created_at',r.created_at,'updated_at',r.updated_at) order by r.updated_at desc,r.id) from (select * from public.hub_portal_handovers order by updated_at desc,id offset p_offset limit p_limit) r),'[]'::jsonb);
end; $$;
revoke all on function hub_portal_private.handover_list(integer,integer) from public;
grant execute on function hub_portal_private.handover_list(integer,integer) to anon,authenticated;
create function public.hub_portal_handover_list(p_offset integer default 0,p_limit integer default 500)
returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.handover_list(p_offset,p_limit); $$;
revoke all on function public.hub_portal_handover_list(integer,integer) from public;
grant execute on function public.hub_portal_handover_list(integer,integer) to anon,authenticated;
create function hub_portal_private.handover_save(payload jsonb,is_new boolean,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.hub_portal_handovers; locked boolean:=coalesce((payload->>'password_locked')::boolean,false);code text:=coalesce(payload->>'unlock_code','');code_hash text;row_id uuid:=(payload->>'id')::uuid;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengubah data.' using errcode='42501'; end if;
 if not is_new then
  select * into previous from public.hub_portal_handovers where id=row_id and updated_at=expected_updated_at for update;
  if not found then raise exception 'Data sudah berubah atau dihapus. Muat ulang lalu coba lagi.'; end if;
 end if;
 if locked then
  if code<>'' then
   if char_length(code)<8 or octet_length(code)>72 then raise exception 'Kode minimal 8 karakter dan maksimal 72 byte.'; end if;
   code_hash=extensions.crypt(code,extensions.gen_salt('bf',10));
  elsif not is_new and previous.password_locked then code_hash=previous.unlock_code_hash;
  else raise exception 'Isi kode untuk membatasi akses Pass.'; end if;
 end if;
 if is_new then
  insert into public.hub_portal_handovers(id,account_id,password,hub,route,description,password_locked,unlock_code_hash)
  values(row_id,payload->>'account_id',coalesce(payload->>'password',''),payload->>'hub',payload->>'route',coalesce(payload->>'description',''),locked,code_hash);
 else
  update public.hub_portal_handovers set account_id=payload->>'account_id',password=coalesce(payload->>'password',''),hub=payload->>'hub',route=payload->>'route',description=coalesce(payload->>'description',''),password_locked=locked,unlock_code_hash=code_hash where id=row_id;
  if code<>'' or locked is distinct from previous.password_locked then delete from hub_portal_private.handover_unlock_attempts where id=row_id; end if;
 end if;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function hub_portal_private.handover_save(jsonb,boolean,timestamptz) from public,anon;
grant execute on function hub_portal_private.handover_save(jsonb,boolean,timestamptz) to authenticated;
create function public.hub_portal_handover_save(payload jsonb,is_new boolean,expected_updated_at timestamptz default null) returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.handover_save(payload,is_new,expected_updated_at); $$;
revoke all on function public.hub_portal_handover_save(jsonb,boolean,timestamptz) from public,anon;
grant execute on function public.hub_portal_handover_save(jsonb,boolean,timestamptz) to authenticated;

create function hub_portal_private.handover_unlock(row_id uuid,code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.hub_portal_handovers;attempt hub_portal_private.handover_unlock_attempts;
begin
 select * into target from public.hub_portal_handovers where id=row_id;
 if not found then return jsonb_build_object('ok',false,'message','Data tidak tersedia.'); end if;
 if not target.password_locked or hub_portal_private.is_admin() then return jsonb_build_object('ok',true,'password',target.password); end if;
 insert into hub_portal_private.handover_unlock_attempts(id) values(row_id) on conflict(id) do nothing;
 select * into attempt from hub_portal_private.handover_unlock_attempts where id=row_id for update;
 if attempt.window_start<clock_timestamp()-interval '5 minutes' then
  update hub_portal_private.handover_unlock_attempts set attempts=0,window_start=clock_timestamp() where id=row_id;attempt.attempts=0;
 end if;
 if attempt.attempts>=5 then return jsonb_build_object('ok',false,'message','Terlalu banyak kode salah untuk data ini. Coba lagi setelah 5 menit.'); end if;
 if code is not null and char_length(code) between 8 and 72 and octet_length(code)<=72 and extensions.crypt(code,target.unlock_code_hash)=target.unlock_code_hash then
  update hub_portal_private.handover_unlock_attempts set attempts=0 where id=row_id;
  return jsonb_build_object('ok',true,'password',target.password);
 end if;
 update hub_portal_private.handover_unlock_attempts set attempts=attempts+1 where id=row_id;
 return jsonb_build_object('ok',false,'message','Kode tidak sesuai. Minta kode akses dari admin.');
end; $$;
revoke all on function hub_portal_private.handover_unlock(uuid,text) from public;
grant execute on function hub_portal_private.handover_unlock(uuid,text) to anon,authenticated;
create function public.hub_portal_handover_unlock(row_id uuid,code text) returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.handover_unlock(row_id,code); $$;
revoke all on function public.hub_portal_handover_unlock(uuid,text) from public;
grant execute on function public.hub_portal_handover_unlock(uuid,text) to anon,authenticated;
commit;
