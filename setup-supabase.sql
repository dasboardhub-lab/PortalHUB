-- Portal HUB: jalankan seluruh file ini satu kali di Supabase SQL Editor.
-- Hanya objek berawalan hub_portal_ yang digunakan. Data aplikasi lain tidak disentuh.
-- Aman dijalankan ulang: data contoh hanya diisi saat inisialisasi pertama.
begin;

create schema if not exists hub_portal_private;
revoke all on schema hub_portal_private from public, anon;
grant usage on schema hub_portal_private to authenticated;

create table if not exists public.hub_portal_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.hub_portal_categories (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  description text not null default '' check (char_length(description)<=200),
  icon text not null default 'grid' check (icon in ('globe','chart','package','truck','scan','users','clipboard','shield','headset','book','file','clock','handover','grid','link')),
  sort_order integer not null default 0 check (sort_order between 0 and 10000)
);
create table if not exists public.hub_portal_links (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description)<=300),
  category text not null references public.hub_portal_categories(id) on delete restrict,
  group_name text not null default '' check (char_length(group_name)<=70),
  hub text not null default 'ALL' check (hub in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')),
  icon text not null default 'link' check (icon in ('globe','chart','package','truck','scan','users','clipboard','shield','headset','book','file','clock','handover','grid','link')),
  color text not null default 'orange' check (color in ('orange','blue','green','purple','red','teal')),
  status text not null default 'ready' check (status in ('ready','maintenance')),
  actions jsonb not null check (jsonb_typeof(actions)='array' and jsonb_array_length(actions) between 1 and 6),
  pinned boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  updated_at timestamptz not null default now()
);
create index if not exists hub_portal_links_category_idx on public.hub_portal_links(category);
create index if not exists hub_portal_links_sort_idx on public.hub_portal_links(sort_order,id);
create table if not exists public.hub_portal_settings (
  id text primary key default 'main' check(id='main'),
  title text not null check (char_length(btrim(title)) between 1 and 50),
  area text not null check (char_length(btrim(area)) between 1 and 50),
  announcement_title text not null default '' check(char_length(announcement_title)<=100),
  announcement text not null default '' check(char_length(announcement)<=1500),
  initialized boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.hub_portal_activity (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hub_portal_activity_created_idx on public.hub_portal_activity(created_at desc);

-- Role berasal dari tabel yang hanya dikelola melalui SQL Editor.
-- Tidak ada peran admin yang berasal dari user_metadata atau pendaftaran publik.
create or replace function hub_portal_private.is_member()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.hub_portal_members m
    where m.user_id=(select auth.uid()) and m.active
  );
$$;
create or replace function hub_portal_private.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.hub_portal_members m
    where m.user_id=(select auth.uid()) and m.active and m.role='admin'
  );
$$;
revoke all on function hub_portal_private.is_member() from public,anon,authenticated;
revoke all on function hub_portal_private.is_admin() from public,anon,authenticated;
grant execute on function hub_portal_private.is_member(),hub_portal_private.is_admin() to authenticated;

alter table public.hub_portal_members enable row level security;
alter table public.hub_portal_categories enable row level security;
alter table public.hub_portal_links enable row level security;
alter table public.hub_portal_settings enable row level security;
alter table public.hub_portal_activity enable row level security;

drop policy if exists hub_portal_own_membership on public.hub_portal_members;
create policy hub_portal_own_membership on public.hub_portal_members for select to authenticated
using (user_id=(select auth.uid()));
drop policy if exists hub_portal_member_read on public.hub_portal_categories;
create policy hub_portal_member_read on public.hub_portal_categories for select to authenticated
using ((select hub_portal_private.is_member()));
drop policy if exists hub_portal_member_read on public.hub_portal_links;
create policy hub_portal_member_read on public.hub_portal_links for select to authenticated
using ((select hub_portal_private.is_member()));
drop policy if exists hub_portal_member_read on public.hub_portal_settings;
create policy hub_portal_member_read on public.hub_portal_settings for select to authenticated
using ((select hub_portal_private.is_member()));
drop policy if exists hub_portal_member_read on public.hub_portal_activity;
create policy hub_portal_member_read on public.hub_portal_activity for select to authenticated
using ((select hub_portal_private.is_member()));

revoke all on public.hub_portal_members,public.hub_portal_categories,public.hub_portal_links,public.hub_portal_settings,public.hub_portal_activity from anon,authenticated;
grant select on public.hub_portal_members,public.hub_portal_categories,public.hub_portal_links,public.hub_portal_settings,public.hub_portal_activity to authenticated;

create or replace function public.hub_portal_snapshot()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not hub_portal_private.is_member() then
    return jsonb_build_object('approved',false,'canManage',false);
  end if;
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
    'activity',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'createdAt',a.created_at) order by a.created_at desc,a.id)
      from (select id,description,created_at from public.hub_portal_activity order by created_at desc,id limit 5) a),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.hub_portal_snapshot() from public,anon,authenticated;
grant execute on function public.hub_portal_snapshot() to authenticated;

-- Validasi juga berjalan di database; memodifikasi JavaScript tidak membuka izin.
create or replace function hub_portal_private.validate_link(v jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb; normalized_actions jsonb:='[]'::jsonb; label_text text; url_text text;
begin
  if jsonb_typeof(v) is distinct from 'object' then raise exception 'Data layanan tidak valid.'; end if;
  if coalesce(v->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$'
    or char_length(btrim(coalesce(v->>'title',''))) not between 1 and 100
    or char_length(coalesce(v->>'description',''))>300
    or coalesce(v->>'category','') !~ '^[A-Za-z0-9_-]{1,100}$'
    or char_length(coalesce(v->>'group',''))>70
    or coalesce(v->>'hub','ALL') not in ('ALL','MKS','BPP','BJM','PLK','MND','PAL','KDI','TAR','Gateway')
    or coalesce(v->>'icon','link') not in ('globe','chart','package','truck','scan','users','clipboard','shield','headset','book','file','clock','handover','grid','link')
    or coalesce(v->>'color','orange') not in ('orange','blue','green','purple','red','teal')
    or coalesce(v->>'status','ready') not in ('ready','maintenance')
    or coalesce(v->>'sortOrder','999') !~ '^[0-9]{1,5}$'
    or coalesce((v->>'sortOrder')::integer,999)>10000 then
    raise exception 'Periksa kembali isian layanan.';
  end if;
  if v ? 'pinned' and jsonb_typeof(v->'pinned') is distinct from 'boolean' then raise exception 'Pilihan sematan tidak valid.'; end if;
  if jsonb_typeof(v->'actions') is distinct from 'array' then raise exception 'Tautan akses harus berupa daftar.'; end if;
  if jsonb_array_length(v->'actions') not between 1 and 6 then raise exception 'Gunakan 1 sampai 6 tombol akses.'; end if;
  for a in select value from jsonb_array_elements(v->'actions') loop
    if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'label') is distinct from 'string' or jsonb_typeof(a->'url') is distinct from 'string' then raise exception 'Tombol akses tidak valid.'; end if;
    label_text:=btrim(a->>'label');url_text:=btrim(a->>'url');
    if char_length(label_text) not between 1 and 50 or char_length(url_text)>2000 then raise exception 'Periksa label dan panjang alamat tautan.'; end if;
    if url_text<>'' and url_text !~ '^https?://[^[:space:]/?#@:]+(:[0-9]+)?([/?#][^[:space:]]*)?$' then
      raise exception 'Tautan harus memakai alamat http:// atau https:// yang valid.';
    end if;
    normalized_actions:=normalized_actions||jsonb_build_array(jsonb_build_object('label',label_text,'url',url_text));
  end loop;
  return v||jsonb_build_object('title',btrim(v->>'title'),'description',btrim(coalesce(v->>'description','')),
    'group',btrim(coalesce(v->>'group','')),'hub',coalesce(v->>'hub','ALL'),'icon',coalesce(v->>'icon','link'),
    'color',coalesce(v->>'color','orange'),'status',coalesce(v->>'status','ready'),'actions',normalized_actions,
    'pinned',coalesce((v->>'pinned')::boolean,false),'sortOrder',coalesce((v->>'sortOrder')::integer,999));
end;
$$;
revoke all on function hub_portal_private.validate_link(jsonb) from public,anon,authenticated;

-- Privileged code lives outside the exposed API schema and checks auth.uid()
-- plus explicit admin membership before accessing or modifying any record.
create or replace function hub_portal_private.mutate(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op text; v jsonb; c jsonb; item jsonb; entry jsonb; old_title text;
  message text; link_rows jsonb:='[]'::jsonb; backup jsonb; item_id text;
begin
  if auth.uid() is null or not hub_portal_private.is_admin() then
    raise exception using errcode='42501',message='Hanya admin portal yang dapat mengubah data.';
  end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1000000 then raise exception 'Ukuran atau format data tidak valid.'; end if;
  -- Serialize admin changes so category checks and full backup restores stay consistent.
  perform 1 from public.hub_portal_settings where id='main' for update;
  op:=payload->>'operation';
  case op
    when 'save-link' then
      v:=hub_portal_private.validate_link(payload->'link');
      insert into public.hub_portal_links(id,title,description,category,group_name,hub,icon,color,status,actions,pinned,sort_order)
      values(v->>'id',v->>'title',v->>'description',v->>'category',v->>'group',v->>'hub',v->>'icon',v->>'color',v->>'status',v->'actions',(v->>'pinned')::boolean,(v->>'sortOrder')::integer)
      on conflict(id) do update set title=excluded.title,description=excluded.description,category=excluded.category,
        group_name=excluded.group_name,hub=excluded.hub,icon=excluded.icon,color=excluded.color,status=excluded.status,
        actions=excluded.actions,pinned=excluded.pinned,sort_order=excluded.sort_order,updated_at=now();
      message:='Tautan '||(v->>'title')||' disimpan';
    when 'delete-link' then
      delete from public.hub_portal_links where id=payload->>'id' returning title into old_title;
      if not found then raise exception 'Layanan sudah tidak tersedia.'; end if;
      message:='Tautan '||old_title||' dihapus';
    when 'save-category' then
      c:=payload->'category';item_id:=coalesce(nullif(c->>'id',''),gen_random_uuid()::text);
      if char_length(btrim(coalesce(c->>'name',''))) not between 1 and 50 or char_length(coalesce(c->>'description',''))>200 then raise exception 'Periksa kembali nama dan deskripsi kategori.'; end if;
      insert into public.hub_portal_categories(id,name,description,icon,sort_order)
      values(item_id,btrim(c->>'name'),btrim(coalesce(c->>'description','')),coalesce(c->>'icon','grid'),coalesce((c->>'sortOrder')::integer,99))
      on conflict(id) do update set name=excluded.name,description=excluded.description,icon=excluded.icon,sort_order=excluded.sort_order;
      message:='Kategori '||btrim(c->>'name')||' disimpan';
    when 'delete-category' then
      if (select count(*) from public.hub_portal_categories)<=1 then raise exception 'Portal harus memiliki setidaknya satu kategori.'; end if;
      if exists(select 1 from public.hub_portal_links where category=payload->>'id') then raise exception 'Pindahkan atau hapus semua layanan di kategori ini terlebih dahulu.'; end if;
      delete from public.hub_portal_categories where id=payload->>'id';
      if not found then raise exception 'Kategori sudah tidak tersedia.'; end if;
      message:='Kategori dihapus';
    when 'save-settings' then
      v:=payload->'settings';
      if char_length(btrim(coalesce(v->>'title',''))) not between 1 and 50 or char_length(btrim(coalesce(v->>'area',''))) not between 1 and 50 or char_length(coalesce(v->>'announcementTitle',''))>100 or char_length(coalesce(v->>'announcement',''))>1500 then raise exception 'Periksa kembali informasi portal.'; end if;
      update public.hub_portal_settings set title=btrim(v->>'title'),area=btrim(v->>'area'),announcement_title=btrim(coalesce(v->>'announcementTitle','')),announcement=btrim(coalesce(v->>'announcement','')),updated_at=now() where id='main';
      message:='Informasi portal diperbarui';
    when 'restore' then
      backup:=payload->'backup';
      if backup->>'format' is distinct from 'portal-hub-v1' or jsonb_typeof(backup->'links') is distinct from 'array' or jsonb_typeof(backup->'categories') is distinct from 'array' then raise exception 'File cadangan tidak valid.'; end if;
      if jsonb_array_length(backup->'links')>500 or jsonb_array_length(backup->'categories') not between 1 and 40 then raise exception 'Cadangan maksimal berisi 500 layanan dan 40 kategori.'; end if;
      if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(backup->'links')) or
         (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(backup->'categories')) then raise exception 'Identitas dalam cadangan tidak boleh kosong atau berulang.'; end if;
      for entry in select value from jsonb_array_elements(backup->'links') loop
        item:=hub_portal_private.validate_link(entry);
        if not exists(select 1 from jsonb_array_elements(backup->'categories') as cat(value) where cat.value->>'id'=item->>'category') then raise exception 'Kategori layanan dalam cadangan tidak ditemukan.'; end if;
        link_rows:=link_rows||jsonb_build_array(item);
      end loop;
      delete from public.hub_portal_links;
      delete from public.hub_portal_categories;
      for c in select value from jsonb_array_elements(backup->'categories') loop
        insert into public.hub_portal_categories(id,name,description,icon,sort_order)
          values(c->>'id',btrim(c->>'name'),coalesce(c->>'description',''),coalesce(c->>'icon','grid'),coalesce((c->>'sortOrder')::integer,0));
      end loop;
      for v in select value from jsonb_array_elements(link_rows) loop
        insert into public.hub_portal_links(id,title,description,category,group_name,hub,icon,color,status,actions,pinned,sort_order)
          values(v->>'id',v->>'title',v->>'description',v->>'category',v->>'group',v->>'hub',v->>'icon',v->>'color',v->>'status',v->'actions',(v->>'pinned')::boolean,(v->>'sortOrder')::integer);
      end loop;
      message:='Cadangan tautan dan kategori dipulihkan';
    else raise exception 'Operasi tidak dikenal.';
  end case;
  insert into public.hub_portal_activity(description,actor) values(message,auth.uid());
  return jsonb_build_object('ok',true,'message',message);
end;
$$;
revoke all on function hub_portal_private.mutate(jsonb) from public,anon,authenticated;
grant execute on function hub_portal_private.mutate(jsonb) to authenticated;

create or replace function public.hub_portal_mutate(payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select hub_portal_private.mutate(payload);
$$;
revoke all on function public.hub_portal_mutate(jsonb) from public,anon,authenticated;
grant execute on function public.hub_portal_mutate(jsonb) to authenticated;

do $hub_seed$
begin
  insert into public.hub_portal_settings(id,title,area,announcement_title,announcement) values('main','Portal HUB','KALSULAMP','Satu tim, satu pusat informasi.','Akses aplikasi, laporan, dan panduan kerja dari portal ini. Tandai layanan favorit agar lebih cepat ditemukan.') on conflict(id) do nothing;
  if not (select initialized from public.hub_portal_settings where id='main') then
    insert into public.hub_portal_categories(id,name,description,icon,sort_order) values
('apps','Aplikasi & sistem','Semua sistem yang mendukung pekerjaan tim.','grid',0),
('reports','Laporan operasional','Laporan harian, inbound, dan outbound dalam satu tempat.','chart',1),
('monitoring','Tim & monitoring','Pantau progres paket dan tindak lanjuti kendala operasional.','scan',2),
('handover','Serah terima','Akses formulir dan pencatatan serah terima tim.','handover',3),
('docs','Dokumen & SOP','Panduan dan dokumen kerja yang dibutuhkan tim.','book',4)
on conflict(id) do nothing;
    insert into public.hub_portal_links(id,title,description,category,group_name,hub,icon,color,status,actions,pinned,sort_order) values
('aware','Aware Web','Sistem utama proses dan pelacakan operasional.','apps','','ALL','globe','red','ready','[{"label":"Buka akses","url":""}]'::jsonb,true,0),
('hcaja','HCAja','Layanan Human Capital dan administrasi karyawan.','apps','','ALL','users','blue','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,1),
('service-desk','Service Desk','Tiket bantuan IT dan kendala sistem.','apps','','ALL','headset','purple','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,2),
('guardian','Guardian','Akses proses pickup dan delivery.','apps','','ALL','shield','teal','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,3),
('pendopo','Pendopo','Portal informasi dan kebutuhan internal.','apps','','ALL','grid','orange','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,4),
('lifemobile','LifeMobile','Dashboard dan layanan mobile tim.','apps','','ALL','chart','purple','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,5),
('symphonia','Symphonia','Sistem manajemen dan informasi terpadu.','apps','','ALL','globe','blue','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,6),
('belajar-aja','Belajar Aja','Materi pembelajaran dan pengembangan tim.','apps','','ALL','book','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,7),
('daily','Report Daily','Input dan rekap laporan operasional harian.','reports','Daily','ALL','clipboard','blue','ready','[{"label":"Buka akses","url":""}]'::jsonb,true,8),
('5r','5R HUB','Checklist kebersihan, kerapian, dan kondisi HUB.','reports','Daily','ALL','clipboard','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,9),
('productivity','Produktivitas','Monitoring beban kerja dan produktivitas tim.','reports','Daily','ALL','chart','purple','ready','[{"label":"Master data","url":""},{"label":"Dashboard","url":""}]'::jsonb,true,10),
('3pl','Laporan 3PL','Pencatatan dan monitoring pengiriman pihak ketiga.','reports','Daily','ALL','truck','orange','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,11),
('inbound-recap','Rekap Data Inbound','Rekap paket inbound yang diterima di destinasi.','reports','Inbound','ALL','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,12),
('inbound-MKS','Inbound HUB MKS','Input dan monitoring penerimaan paket HUB MKS.','reports','Inbound','MKS','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,13),
('inbound-BPP','Inbound HUB BPP','Input dan monitoring penerimaan paket HUB BPP.','reports','Inbound','BPP','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,14),
('inbound-BJM','Inbound HUB BJM','Input dan monitoring penerimaan paket HUB BJM.','reports','Inbound','BJM','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,15),
('inbound-PLK','Inbound HUB PLK','Input dan monitoring penerimaan paket HUB PLK.','reports','Inbound','PLK','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,16),
('inbound-MND','Inbound HUB MND','Input dan monitoring penerimaan paket HUB MND.','reports','Inbound','MND','package','green','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,17),
('outbound-MKS','Pre-Alert HUB MKS','Data keberangkatan dan pre-alert pengiriman HUB MKS.','reports','Outbound','MKS','truck','orange','ready','[{"label":"Data pre-alert","url":""},{"label":"Report pre-alert","url":""}]'::jsonb,true,18),
('outbound-BPP','Pre-Alert HUB BPP','Data keberangkatan dan pre-alert pengiriman HUB BPP.','reports','Outbound','BPP','truck','orange','ready','[{"label":"Data pre-alert","url":""},{"label":"Report pre-alert","url":""}]'::jsonb,false,19),
('outbound-BJM','Pre-Alert HUB BJM','Data keberangkatan dan pre-alert pengiriman HUB BJM.','reports','Outbound','BJM','truck','orange','ready','[{"label":"Data pre-alert","url":""},{"label":"Report pre-alert","url":""}]'::jsonb,false,20),
('outbound-PLK','Pre-Alert HUB PLK','Data keberangkatan dan pre-alert pengiriman HUB PLK.','reports','Outbound','PLK','truck','orange','ready','[{"label":"Data pre-alert","url":""},{"label":"Report pre-alert","url":""}]'::jsonb,false,21),
('outbound-MND','Pre-Alert HUB MND','Data keberangkatan dan pre-alert pengiriman HUB MND.','reports','Outbound','MND','truck','orange','ready','[{"label":"Data pre-alert","url":""},{"label":"Report pre-alert","url":""}]'::jsonb,false,22),
('stuck','Parcel Stuck HUB','Pantau paket tertahan tanpa perpindahan opcode.','monitoring','','ALL','package','red','ready','[{"label":"Buka monitoring","url":"https://parcelstuck.vercel.app"}]'::jsonb,true,23),
('opcode','Kelengkapan Opcode','Validasi kelengkapan scan pada alur paket.','monitoring','','ALL','scan','blue','ready','[{"label":"Resource","url":""},{"label":"Rekapan","url":""}]'::jsonb,false,24),
('inprogress','Parcel Inprogress','Monitoring progres paket dan rekap bulanan.','monitoring','','ALL','clock','teal','ready','[{"label":"Master data","url":""},{"label":"Dashboard","url":""}]'::jsonb,false,25),
('picapa','PICAPA','Pencatatan kasus dan tindak lanjut operasional.','monitoring','','ALL','clipboard','purple','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,26),
('return','Retur Mitra Pengusaha','Monitoring paket retur dari mitra pengusaha.','monitoring','','ALL','handover','red','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,27),
('xrt','Monitoring XRT','Pemantauan paket XRT di staging under HUB.','monitoring','','ALL','scan','orange','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,28),
('handover-shift','Serah Terima Shift','Catatan pergantian shift dan pekerjaan lanjutan.','handover','','ALL','handover','teal','ready','[{"label":"Buka akses","url":""}]'::jsonb,true,29),
('handover-mks','Handover HUB MKS','Formulir serah terima operasional HUB MKS.','handover','','MKS','clipboard','blue','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,30),
('sop','SOP Operasional','Panduan proses dan standar kerja tim HUB.','docs','','ALL','book','orange','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,31),
('documents','Document Center','Arsip dokumen dan formulir kebutuhan operasional.','docs','','ALL','file','blue','ready','[{"label":"Buka akses","url":""}]'::jsonb,false,32)
on conflict(id) do nothing;
    update public.hub_portal_settings set initialized=true where id='main';
  end if;
end;
$hub_seed$;

notify pgrst,'reload schema';
commit;
