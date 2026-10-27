-- Urutan submenu manual untuk seluruh menu. Jalankan setelah setup-menu-submenus.sql.
-- STAGE 1: ordered_names
begin;
create or replace function hub_portal_private.menu_names(parent text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with stored as (
  select value as name,ordinality as position from public.hub_portal_categories c cross join lateral jsonb_array_elements_text(c.submenus) with ordinality where c.id=parent
 ), legacy as (
  select group_name as name from public.hub_portal_links where category=parent and parent not in ('docs','handover') and group_name<>''
  union select menu_group from public.hub_portal_handovers where parent='handover' and menu_group<>''
  union select menu_group from public.hub_portal_documents where parent='docs' and menu_group<>''
 ), ordered as (
  select name,position from stored
  union all select name,1000+row_number() over(order by case when parent='reports' then case name when 'Daily' then 1 when 'Inbound' then 2 when 'Outbound' then 3 else 4 end else 4 end,name) from legacy where not exists(select 1 from stored s where s.name=legacy.name)
 ) select coalesce(jsonb_agg(name order by position),'[]'::jsonb) from ordered;
$$;
revoke all on function hub_portal_private.menu_names(text) from public,anon,authenticated;
commit;

-- STAGE 2: ordered_mutations
begin;
create or replace function hub_portal_private.mutate_menus(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op text; item_id text; names jsonb; submenu_name text; old_name text; message text; result jsonb; entry jsonb;
begin
 if auth.uid() is null or not hub_portal_private.is_admin() then raise exception 'Hanya admin portal yang dapat mengubah data.' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1000000 then raise exception 'Ukuran atau format data tidak valid.'; end if;
 perform 1 from public.hub_portal_settings where id='main' for update;
 op:=payload->>'operation';
 if op='reorder-submenus' then
  item_id:=payload->>'category_id';
  if not exists(select 1 from public.hub_portal_categories where id=item_id) then raise exception 'Menu induk sudah tidak tersedia.'; end if;
  names:=hub_portal_private.menu_names(item_id);
  if payload->'expected_names' is distinct from names then raise exception 'Urutan submenu sudah berubah. Muat ulang lalu coba lagi.'; end if;
  entry:=hub_portal_private.validate_submenus(payload->'names');
  if jsonb_array_length(entry)<>jsonb_array_length(names) or not (entry @> names and names @> entry) then raise exception 'Daftar submenu berubah. Muat ulang lalu coba lagi.'; end if;
  if entry is not distinct from names then return jsonb_build_object('ok',true,'message','Urutan submenu sudah tersimpan.'); end if;
  update public.hub_portal_categories set submenus=entry where id=item_id;
  insert into public.hub_portal_activity(description,actor) values('Urutan submenu diperbarui',auth.uid());
  return jsonb_build_object('ok',true,'message','Urutan submenu disimpan untuk semua pengunjung.');
 end if;
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
  if op='save-submenu' and old_name is not null then
   select coalesce(jsonb_agg(case when n=old_name then submenu_name else n end order by ord),'[]'::jsonb) into names from jsonb_array_elements_text(names) with ordinality a(n,ord);
  else
   select coalesce(jsonb_agg(n order by ord),'[]'::jsonb) into names from jsonb_array_elements_text(names) with ordinality a(n,ord) where old_name is null or n<>old_name;
   if op='save-submenu' then names:=names||jsonb_build_array(submenu_name); end if;
  end if;
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

notify pgrst,'reload schema';
commit;
