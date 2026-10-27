-- Jalankan setelah setup-public-access.sql. Data yang ada tetap dipertahankan.
begin;
alter table public.hub_portal_handovers add column type text not null default '' check(char_length(type)<=80);
create or replace function hub_portal_private.handover_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare permitted boolean:=hub_portal_private.is_admin();
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'account_id',r.account_id,'type',r.type,'password',case when permitted or not r.password_locked then r.password else '' end,'password_locked',r.password_locked,'has_password',r.password<>'','hub',r.hub,'route',r.route,'description',r.description,'created_at',r.created_at,'updated_at',r.updated_at) order by r.updated_at desc,r.id) from (select * from public.hub_portal_handovers order by updated_at desc,id offset p_offset limit p_limit) r),'[]'::jsonb);
end; $$;
create or replace function hub_portal_private.handover_save(payload jsonb,is_new boolean,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.hub_portal_handovers; locked boolean:=coalesce((payload->>'password_locked')::boolean,false);code text:=coalesce(payload->>'unlock_code','');code_hash text;handover_type text;row_id uuid:=(payload->>'id')::uuid;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengubah data.' using errcode='42501'; end if;
 if not is_new then
  select * into previous from public.hub_portal_handovers where id=row_id and updated_at=expected_updated_at for update;
  if not found then raise exception 'Data sudah berubah atau dihapus. Muat ulang lalu coba lagi.'; end if;
 end if;
 handover_type=btrim(coalesce(payload->>'type',previous.type,''));
 if locked then
  if code<>'' then
   if char_length(code)<8 or octet_length(code)>72 then raise exception 'Kode minimal 8 karakter dan maksimal 72 byte.'; end if;
   code_hash=extensions.crypt(code,extensions.gen_salt('bf',10));
  elsif not is_new and previous.password_locked then code_hash=previous.unlock_code_hash;
  else raise exception 'Isi kode untuk membatasi akses Pass.'; end if;
 end if;
 if is_new then
  insert into public.hub_portal_handovers(id,account_id,password,hub,route,description,password_locked,unlock_code_hash,type)
  values(row_id,payload->>'account_id',coalesce(payload->>'password',''),payload->>'hub',payload->>'route',coalesce(payload->>'description',''),locked,code_hash,handover_type);
 else
  update public.hub_portal_handovers set account_id=payload->>'account_id',password=coalesce(payload->>'password',''),hub=payload->>'hub',route=payload->>'route',description=coalesce(payload->>'description',''),password_locked=locked,unlock_code_hash=code_hash,type=handover_type where id=row_id;
  if code<>'' or locked is distinct from previous.password_locked then delete from hub_portal_private.handover_unlock_attempts where id=row_id; end if;
 end if;
 return jsonb_build_object('ok',true);
end; $$;
commit;
