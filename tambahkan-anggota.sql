-- Buat akun tim pada Authentication > Users, lalu ganti GANTI_EMAIL_ANGGOTA.
-- Anggota dapat membaca layanan; hanya admin yang dapat mengubah portal.
do $portal_member$
declare
  email_anggota text := 'GANTI_EMAIL_ANGGOTA';
  target_user uuid;
begin
  select id into target_user from auth.users where lower(email)=lower(btrim(email_anggota)) limit 1;
  if target_user is null then raise exception 'Akun anggota belum ditemukan di Authentication > Users.'; end if;
  insert into public.hub_portal_members(user_id,role,active)
  values(target_user,'viewer',true)
  on conflict(user_id) do update set role='viewer',active=true;
  raise notice 'Akses anggota Portal HUB sudah aktif untuk %.',email_anggota;
end;
$portal_member$;
