# Portal HUB Kalsulamp

Portal operasional untuk aplikasi, laporan Daily/Inbound/Outbound, monitoring, serah terima, dan dokumen tim. Mendukung pencarian, filter HUB, favorit, riwayat akses, pengumuman, beberapa tombol akses dalam satu layanan, serta ekspor/impor cadangan.

## Penerbitan melalui Vercel

Repository ini terhubung ke proyek Vercel **portal-hub**. Perubahan pada branch **main** diterbitkan melalui integrasi GitHub yang sudah ada.

Konfigurasi `vercel.json` menetapkan Vite, instalasi `npm ci`, build `npm run build`, dan output **docs**. Folder hasil build tidak perlu diunggah ke GitHub. Gunakan Node.js 22.x.

## Supabase

Project URL dan publishable key dikonfigurasi pada `public/config.js`. Build menyalin konfigurasi tersebut menjadi `docs/config.js`. Frontend tidak menggunakan secret key atau service_role key.

Lima tabel portal memakai awalan `hub_portal_`. Link, kategori, pengumuman, dan aktivitas disimpan di Supabase. Favorit dan riwayat akses disimpan pada browser masing-masing.

Pengguna masuk melalui **Masuk portal** menggunakan akun Supabase yang telah diberi keanggotaan aktif. Akun dengan peran **admin** mendapat tombol **Kelola portal**. Anggota biasa hanya dapat membaca. Peran tidak ditentukan melalui metadata akun yang dapat diubah pengguna.

`setup-supabase.sql` disertakan untuk pemasangan baru. Installer tidak menimpa perubahan portal atau memunculkan kembali contoh layanan yang sudah dihapus saat dijalankan ulang. Untuk menambahkan admin atau anggota, gunakan `aktifkan-admin.sql` atau `tambahkan-anggota.sql` setelah membuat akun melalui Authentication → Users. Password dikelola melalui Supabase.

Tabel portal memakai RLS dan tidak memberikan akses baca kepada pengunjung anonim. Perubahan data dilakukan melalui fungsi yang memeriksa admin, memvalidasi isian, serta mencatat aktivitas. Fungsi privileged berada dalam schema `hub_portal_private`; schema ini tidak perlu diekspos pada Data API.

## Pengembangan

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

Versi dependensi dikunci dalam `package.json` dan `package-lock.json`. Hasil build dihasilkan pada `docs/`. Semua aset disertakan dalam bundle; tidak ada ketergantungan CDN untuk menjalankan tampilan portal.

## Cadangan

Admin dapat membuka **Kelola portal → Pengaturan portal → Cadangan**. Pemulihan mengganti layanan dan kategori secara atomik; akun serta informasi portal dipertahankan. Jangan menyimpan cadangan berisi informasi internal tim dalam repository publik.

## Validasi

TypeScript, build produksi, dan delapan pengujian integrasi PostgreSQL lokal mencakup RLS, keanggotaan, pencegahan eskalasi peran, validasi URL, perubahan kategori, pemulihan cadangan, perlindungan kategori terakhir, serta inisialisasi yang mempertahankan perubahan.
