-- 1. Buat akun di Supabase > Authentication > Users terlebih dahulu.
-- 2. Ganti GANTI_EMAIL_ADMIN dengan email akun tersebut.
-- 3. Jalankan seluruh perintah ini melalui SQL Editor.
-- Password diatur melalui Supabase; tidak ditulis dalam file ini.
do $portal_admin$
declare
  email_admin text := 'GANTI_EMAIL_ADMIN';
  target_user uuid;
begin
  select id into target_user from auth.users where lower(email)=lower(btrim(email_admin)) limit 1;
  if target_user is null then
    raise exception 'Akun belum ditemukan. Buat akun pada Authentication > Users, lalu isi email yang sama di file ini.';
  end if;
  insert into public.hub_portal_members(user_id,role,active)
  values(target_user,'admin',true)
  on conflict(user_id) do update set role='admin',active=true;
  raise notice 'Akun % sudah memiliki akses admin Portal HUB.',email_admin;
end;
$portal_admin$;
