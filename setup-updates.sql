-- Pusat pembaruan Portal HUB. Jalankan setelah setup-submenu-order.sql.
-- Tidak mempublikasikan data lama atau menyalin log privat.
-- STAGE 1: schema
begin;
create table if not exists public.hub_portal_updates (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 1 and 120),
 body text not null check(char_length(btrim(body)) between 1 and 4000),
 kind text not null default 'info' check(kind in ('info','important','maintenance','update')),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 source text not null default 'manual' check(source in ('manual','system')),
 category_id text references public.hub_portal_categories(id) on delete set null,
 url text not null default '' check(char_length(url)<=2000),
 pinned boolean not null default false,
 published_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hub_portal_updates_feed_idx on public.hub_portal_updates(status,pinned desc,updated_at desc,id);
alter table public.hub_portal_updates enable row level security;
revoke all on public.hub_portal_updates from public,anon,authenticated;
grant select on public.hub_portal_updates to anon,authenticated;
drop policy if exists hub_updates_public_read on public.hub_portal_updates;
create policy hub_updates_public_read on public.hub_portal_updates for select to anon,authenticated using(status='published');
drop policy if exists hub_updates_admin_read on public.hub_portal_updates;
create policy hub_updates_admin_read on public.hub_portal_updates for select to authenticated using((select hub_portal_private.is_admin()));
commit;

-- STAGE 2: read_api
begin;
create or replace function hub_portal_private.update_list(p_limit integer,p_offset integer,p_status text,p_source text,p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 or p_status is null or p_status not in ('published','draft','archived') or p_source is null or p_source not in ('all','manual','system') or p_query is null or char_length(p_query)>150 then raise exception 'Filter pembaruan tidak valid.'; end if;
 if p_status<>'published' and not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat membuka draf dan arsip.' using errcode='42501'; end if;
 return (with matches as materialized (
  select * from public.hub_portal_updates where status=p_status and (p_source='all' or source=p_source) and (p_query='' or title ilike '%'||p_query||'%' or body ilike '%'||p_query||'%')
 ), page as (select * from matches order by pinned desc,updated_at desc,id offset p_offset limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by pinned desc,updated_at desc,id) from page p),'[]'::jsonb),'total',(select count(*) from matches)));
end; $$;
revoke all on function hub_portal_private.update_list(integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function hub_portal_private.update_list(integer,integer,text,text,text) to anon,authenticated;
create or replace function public.hub_portal_update_list(p_limit integer default 20,p_offset integer default 0,p_status text default 'published',p_source text default 'all',p_query text default '')
returns jsonb language sql stable security invoker set search_path='' as $$ select hub_portal_private.update_list(p_limit,p_offset,p_status,p_source,p_query); $$;
revoke all on function public.hub_portal_update_list(integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.hub_portal_update_list(integer,integer,text,text,text) to anon,authenticated;
commit;

-- STAGE 3: admin_api
begin;
create or replace function hub_portal_private.update_save(payload jsonb,is_new boolean,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.hub_portal_updates; saved public.hub_portal_updates;row_id uuid;title_text text;body_text text;kind_text text;status_text text;category_text text;url_text text;pin boolean; published timestamptz;
begin
 if not hub_portal_private.is_admin() then raise exception 'Hanya admin yang dapat mengelola informasi.' using errcode='42501'; end if;
 if is_new is null or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>30000 then raise exception 'Isian informasi tidak valid.'; end if;
 row_id:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if not is_new then
  select * into previous from public.hub_portal_updates where id=row_id and updated_at=expected_updated_at for update;
  if not found then raise exception 'Informasi sudah berubah. Muat ulang lalu coba lagi.'; end if;
  if previous.source<>'manual' then raise exception 'Riwayat pembaruan otomatis tidak dapat diubah.' using errcode='42501'; end if;
 end if;
 title_text:=btrim(coalesce(payload->>'title',''));body_text:=btrim(coalesce(payload->>'body',''));kind_text:=coalesce(payload->>'kind','info');status_text:=coalesce(payload->>'status','draft');category_text:=nullif(payload->>'category_id','');url_text:=btrim(coalesce(payload->>'url',''));pin:=coalesce((payload->>'pinned')::boolean,false);
 if char_length(title_text) not between 1 and 120 or char_length(body_text) not between 1 and 4000 or kind_text not in ('info','important','maintenance','update') or status_text not in ('draft','published','archived') or char_length(url_text)>2000 then raise exception 'Periksa judul, isi, dan jenis informasi.'; end if;
 if url_text<>'' and url_text !~ '^https?://[^[:space:]/?#@:]+(:[0-9]+)?([/?#][^[:space:]]*)?$' then raise exception 'Tautan harus memakai http:// atau https:// yang valid.'; end if;
 if url_text<>'' and category_text is not null then raise exception 'Pilih salah satu tujuan: menu portal atau tautan.'; end if;
 if not is_new and row(title_text,body_text,kind_text,status_text,category_text,url_text,pin) is not distinct from row(previous.title,previous.body,previous.kind,previous.status,previous.category_id,previous.url,previous.pinned) then return jsonb_build_object('ok',true,'item',to_jsonb(previous)); end if;
 published:=case when status_text='published' and (is_new or previous.status<>'published') then clock_timestamp() else previous.published_at end;
 if is_new then
  insert into public.hub_portal_updates(id,title,body,kind,status,source,category_id,url,pinned,published_at)
  values(row_id,title_text,body_text,kind_text,status_text,'manual',category_text,url_text,pin,published) returning * into saved;
 else
  update public.hub_portal_updates set title=title_text,body=body_text,kind=kind_text,status=status_text,category_id=category_text,url=url_text,pinned=pin,published_at=published,updated_at=clock_timestamp() where id=row_id returning * into saved;
 end if;
 insert into public.hub_portal_activity(description,actor) values(case status_text when 'published' then 'Informasi tim diterbitkan' when 'archived' then 'Informasi tim diarsipkan' else 'Draf informasi tim disimpan' end,auth.uid());
 return jsonb_build_object('ok',true,'item',to_jsonb(saved));
end; $$;
revoke all on function hub_portal_private.update_save(jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function hub_portal_private.update_save(jsonb,boolean,timestamptz) to authenticated;
create or replace function public.hub_portal_update_save(payload jsonb,is_new boolean,expected_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$ select hub_portal_private.update_save(payload,is_new,expected_updated_at); $$;
revoke all on function public.hub_portal_update_save(jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.hub_portal_update_save(jsonb,boolean,timestamptz) to authenticated;
commit;

-- STAGE 4: automatic_updates
begin;
create or replace function hub_portal_private.publish_data_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare current_row jsonb;previous_row jsonb;target text;scope text;label text;headline text;detail text;event_id uuid;
begin
 if tg_op='DELETE' then current_row:=to_jsonb(old);else current_row:=to_jsonb(new); end if;
 if tg_op='UPDATE' then
  previous_row:=to_jsonb(old);
  if (current_row-'updated_at'-'created_at') is not distinct from (previous_row-'updated_at'-'created_at') then return new; end if;
 end if;
 case tg_table_name
 when 'hub_portal_links' then target:=current_row->>'category';scope:=target;select name into label from public.hub_portal_categories where id=target;if not found then target:=null; end if;
 when 'hub_portal_handovers' then target:='handover';scope:=target;label:='Serah terima';
 when 'hub_portal_documents','hub_portal_document_categories' then target:='docs';scope:=target;label:='Dokumen & SOP';
 when 'hub_portal_categories' then scope:='menus';label:='menu portal';
 when 'hub_portal_settings' then
  if tg_op<>'UPDATE' or row(current_row->>'announcement_title',current_row->>'announcement') is not distinct from row(previous_row->>'announcement_title',previous_row->>'announcement') then return new; end if;
  scope:='information';label:='informasi tim';
 else return null;
 end case;
 headline:='Pembaruan '||coalesce(label,'layanan');
 detail:='Admin '||case tg_op when 'INSERT' then 'menambahkan' when 'DELETE' then 'menghapus' else 'memperbarui' end||' data pada '||coalesce(label,'menu layanan')||'. Buka menu terkait untuk melihat informasi terbaru.';
 if scope='information' then headline:=coalesce(nullif(current_row->>'announcement_title',''),'Informasi tim diperbarui');detail:=coalesce(nullif(current_row->>'announcement',''),'Admin memperbarui papan informasi tim.'); end if;
 -- Satu informasi per menu dan transaksi, termasuk saat mengubah banyak baris.
 event_id:=md5('hub-portal-update:'||txid_current()::text||':'||scope)::uuid;
 insert into public.hub_portal_updates(id,title,body,kind,status,source,category_id,published_at)
 values(event_id,left(headline,120),left(detail,4000),'update','published','system',target,clock_timestamp())
 on conflict(id) do update set title=excluded.title,body=excluded.body,updated_at=clock_timestamp();
 if tg_op='DELETE' then return old;else return new; end if;
end; $$;
revoke all on function hub_portal_private.publish_data_update() from public,anon,authenticated;
drop trigger if exists hub_portal_feed_changes on public.hub_portal_links;
create trigger hub_portal_feed_changes after insert or update or delete on public.hub_portal_links for each row execute function hub_portal_private.publish_data_update();
drop trigger if exists hub_portal_feed_changes on public.hub_portal_handovers;
create trigger hub_portal_feed_changes after insert or update or delete on public.hub_portal_handovers for each row execute function hub_portal_private.publish_data_update();
drop trigger if exists hub_portal_feed_changes on public.hub_portal_documents;
create trigger hub_portal_feed_changes after insert or update or delete on public.hub_portal_documents for each row execute function hub_portal_private.publish_data_update();
drop trigger if exists hub_portal_feed_changes on public.hub_portal_document_categories;
create trigger hub_portal_feed_changes after insert or update or delete on public.hub_portal_document_categories for each row execute function hub_portal_private.publish_data_update();
drop trigger if exists hub_portal_feed_changes on public.hub_portal_categories;
create trigger hub_portal_feed_changes after insert or update or delete on public.hub_portal_categories for each row execute function hub_portal_private.publish_data_update();
drop trigger if exists hub_portal_feed_changes on public.hub_portal_settings;
create trigger hub_portal_feed_changes after update on public.hub_portal_settings for each row execute function hub_portal_private.publish_data_update();
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hub_portal_updates') then
  alter publication supabase_realtime add table public.hub_portal_updates;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
