-- Submenu opsional untuk semua menu. Jalankan setelah setup-handover-type.sql.
-- Menambah kolom dengan nilai awal kosong; semua data yang ada dipertahankan.
begin;
alter table public.hub_portal_categories add column submenus jsonb not null default '[]'::jsonb check(jsonb_typeof(submenus)='array' and jsonb_array_length(submenus)<=50);
alter table public.hub_portal_handovers add column menu_group text not null default '' check(char_length(menu_group)<=70 and lower(menu_group)<>'all');
alter table public.hub_portal_documents add column menu_group text not null default '' check(char_length(menu_group)<=70 and lower(menu_group)<>'all');

create function hub_portal_private.validate_submenus(names jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare entry jsonb; name text; result jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(names) is distinct from 'array' then raise exception 'Daftar submenu tidak valid.'; end if;
 if jsonb_array_length(names)>50 then raise exception 'Maksimal 50 submenu per menu.'; end if;
 for entry in select value from jsonb_array_elements(names) loop
  if jsonb_typeof(entry) is distinct from 'string' then raise exception 'Nama submenu harus berupa teks.'; end if;
  name:=btrim(entry#>>'{}');
  if char_length(name) not between 1 and 70 or lower(name)='all' then raise exception 'Nama submenu harus 1–70 karakter dan tidak boleh ALL.'; end if;
  if exists(select 1 from jsonb_array_elements_text(result) n where lower(n)=lower(name)) then raise exception 'Nama submenu sudah ada di menu ini.'; end if;
  result:=result||jsonb_build_array(name);
 end loop;
 return result;
end; $$;
revoke all on function hub_portal_private.validate_submenus(jsonb) from public,anon,authenticated;

-- Sertakan nama dari data lama dan klien lama agar data tidak menjadi tersembunyi.
create function hub_portal_private.menu_names(parent text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from (
  select jsonb_array_elements_text(c.submenus) as name from public.hub_portal_categories c where c.id=parent
  union select group_name from public.hub_portal_links where category=parent and parent not in ('docs','handover') and group_name<>''
  union select menu_group from public.hub_portal_handovers where parent='handover' and menu_group<>''
  union select menu_group from public.hub_portal_documents where parent='docs' and menu_group<>''
 ) names;
$$;
revoke all on function hub_portal_private.menu_names(text) from public,anon,authenticated;

create function hub_portal_private.mutate_menus(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op text; item_id text; names jsonb; submenu_name text; old_name text; message text; result jsonb; entry jsonb;
begin
 if auth.uid() is null or not hub_portal_private.is_admin() then raise exception 'Hanya admin portal yang dapat mengubah data.' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1000000 then raise exception 'Ukuran atau format data tidak valid.'; end if;
 perform 1 from public.hub_portal_settings where id='main' for update;
 op:=payload->>'operation';
 if op in ('save-submenu','delete-submenu') then
  item_id:=payload->>'category_id';submenu_name:=btrim(coalesce(payload->>'name',''));old_name:=payload->>'old_name';
  if not exists(select 1 from public.hub_portal_categories where id=item_id) then raise exception 'Menu induk sudah tidak tersedia.'; end if;
  names:=hub_portal_private.menu_names(item_id);
  if op='delete-submenu' then old_name:=submenu_name; end if;
  if old_name is not null and not names ? old_name then raise exception 'Submenu sudah berubah. Muat ulang portal.'; end if;
  if op='delete-submenu' and (
    exists(select 1 from public.hub_portal_links where category=item_id and group_name=old_name)
    or (item_id='handover' and exists(select 1 from public.hub_portal_handovers where menu_group=old_name))
    or (item_id='docs' and exists(select 1 from public.hub_portal_documents where menu_group=old_name))) then
   raise exception 'Pindahkan data dari submenu ini terlebih dahulu sebelum menghapusnya.';
  end if;
  select coalesce(jsonb_agg(n),'[]'::jsonb) into names from jsonb_array_elements_text(names) n where old_name is null or n<>old_name;
  if op='save-submenu' then names:=names||jsonb_build_array(submenu_name); end if;
  update public.hub_portal_categories set submenus=hub_portal_private.validate_submenus(names) where id=item_id;
  if op='save-submenu' and old_name is not null and old_name<>submenu_name then
   update public.hub_portal_links set group_name=submenu_name,updated_at=now() where category=item_id and group_name=old_name;
   if item_id='handover' then update public.hub_portal_handovers set menu_group=submenu_name where menu_group=old_name; end if;
   if item_id='docs' then update public.hub_portal_documents set menu_group=submenu_name where menu_group=old_name; end if;
  end if;
  message:='Submenu '||submenu_name||case when op='delete-submenu' then ' dihapus' else ' disimpan' end;
  insert into public.hub_portal_activity(description,actor) values(message,auth.uid());
  return jsonb_build_object('ok',true,'message',message);
 end if;
 if op='delete-category' and payload->>'id' in ('handover','docs') then raise exception 'Menu modul serah terima dan dokumen tetap diperlukan.'; end if;
 -- Pertahankan validasi dan perilaku operasi portal yang sudah ada.
 result:=hub_portal_private.mutate(payload);
 if op='save-link' then
  item_id:=payload->'link'->>'category';submenu_name:=btrim(coalesce(payload->'link'->>'group',''));
  if submenu_name<>'' and item_id not in ('handover','docs') then
   select submenus into names from public.hub_portal_categories where id=item_id;
   if not names ? submenu_name then update public.hub_portal_categories set submenus=hub_portal_private.validate_submenus(names||jsonb_build_array(submenu_name)) where id=item_id; end if;
  end if;
 elsif op='restore' then
  for entry in select value from jsonb_array_elements(payload->'backup'->'categories') loop
   update public.hub_portal_categories set submenus=hub_portal_private.validate_submenus(coalesce(entry->'submenus','[]'::jsonb)) where id=entry->>'id';
  end loop;
 end if;
 return result;
end; $$;
revoke all on function hub_portal_private.mutate_menus(jsonb) from public,anon,authenticated;
grant execute on function hub_portal_private.mutate_menus(jsonb) to authenticated;
create or replace function public.hub_portal_mutate(payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.mutate_menus(payload); $$;

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
      'id',c.id,'name',c.name,'description',c.description,'icon',c.icon,'sortOrder',c.sort_order,'submenus',hub_portal_private.menu_names(c.id)
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

create or replace function hub_portal_private.handover_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare permitted boolean:=hub_portal_private.is_admin();
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'account_id',r.account_id,'type',r.type,'menu_group',r.menu_group,'password',case when permitted or not r.password_locked then r.password else '' end,'password_locked',r.password_locked,'has_password',r.password<>'','hub',r.hub,'route',r.route,'description',r.description,'created_at',r.created_at,'updated_at',r.updated_at) order by r.updated_at desc,r.id) from (select * from public.hub_portal_handovers order by updated_at desc,id offset p_offset limit p_limit) r),'[]'::jsonb);
end; $$;

create or replace function hub_portal_private.handover_save(payload jsonb,is_new boolean,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.hub_portal_handovers; locked boolean:=coalesce((payload->>'password_locked')::boolean,false);code text:=coalesce(payload->>'unlock_code','');code_hash text;handover_type text;group_name text;row_id uuid:=(payload->>'id')::uuid;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengubah data.' using errcode='42501'; end if;
 if not is_new then
  select * into previous from public.hub_portal_handovers where id=row_id and updated_at=expected_updated_at for update;
  if not found then raise exception 'Data sudah berubah atau dihapus. Muat ulang lalu coba lagi.'; end if;
 end if;
 group_name:=btrim(coalesce(payload->>'menu_group',previous.menu_group,''));
 handover_type=btrim(coalesce(payload->>'type',previous.type,''));
 if locked then
  if code<>'' then
   if char_length(code)<8 or octet_length(code)>72 then raise exception 'Kode minimal 8 karakter dan maksimal 72 byte.'; end if;
   code_hash=extensions.crypt(code,extensions.gen_salt('bf',10));
  elsif not is_new and previous.password_locked then code_hash=previous.unlock_code_hash;
  else raise exception 'Isi kode untuk membatasi akses Pass.'; end if;
 end if;
 if is_new then
  insert into public.hub_portal_handovers(id,account_id,password,hub,route,description,password_locked,unlock_code_hash,type,menu_group)
  values(row_id,payload->>'account_id',coalesce(payload->>'password',''),payload->>'hub',payload->>'route',coalesce(payload->>'description',''),locked,code_hash,handover_type,group_name);
 else
  update public.hub_portal_handovers set account_id=payload->>'account_id',password=coalesce(payload->>'password',''),hub=payload->>'hub',route=payload->>'route',description=coalesce(payload->>'description',''),password_locked=locked,unlock_code_hash=code_hash,type=handover_type,menu_group=group_name where id=row_id;
  if code<>'' or locked is distinct from previous.password_locked then delete from hub_portal_private.handover_unlock_attempts where id=row_id; end if;
 end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function hub_portal_private.document_list(p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Rentang data tidak valid.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'menu_group',d.menu_group,'category_id',d.category_id,'subcategory_id',d.subcategory_id,'hub',d.hub,'pic',d.pic,'document_date',d.document_date,'reference',d.reference,'version',d.version,'description',d.description,'file_path',d.file_path,'file_name',d.file_name,'file_size',d.file_size,'created_at',d.created_at,'updated_at',d.updated_at) order by d.updated_at desc,d.id) from (select * from public.hub_portal_documents order by updated_at desc,id offset p_offset limit p_limit) d),'[]'::jsonb);
end; $$;

-- Izin fungsi yang diganti tetap mengikuti konfigurasi sebelumnya. Tidak ada tabel baru atau izin tulis publik.
notify pgrst, 'reload schema';
commit;
