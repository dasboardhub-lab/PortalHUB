# Portal HUB Kalsulamp

Portal operasional untuk aplikasi, laporan Daily/Inbound/Outbound, monitoring, serah terima, dan dokumen tim. Mendukung pencarian, filter HUB, favorit, riwayat akses, pengumuman, beberapa tombol akses dalam satu layanan, serta ekspor/impor cadangan.

## Penerbitan melalui Vercel

Repository ini terhubung ke proyek Vercel **portal-hub**. Perubahan pada branch **main** diterbitkan melalui integrasi GitHub yang sudah ada.

Konfigurasi `vercel.json` menetapkan Vite, instalasi `npm ci`, build `npm run build`, dan output **docs**. Folder hasil build tidak perlu diunggah ke GitHub. Gunakan Node.js 22.x.

## Penerbitan melalui GitHub Pages

Buka **Settings → Pages → Build and deployment → Source → GitHub Actions** satu kali. Workflow `.github/workflows/pages.yml` menginstal dependensi, memeriksa TypeScript, membangun aplikasi, dan menerbitkan **isi folder docs** setiap perubahan pada branch main. Untuk menjalankan ulang secara manual, buka **Actions → Build and deploy Portal HUB to GitHub Pages → Run workflow**.

Jangan menerbitkan folder root melalui opsi Deploy from a branch: `index.html` pada source menggunakan React/TypeScript yang harus dikompilasi dahulu. Menayangkan source tersebut langsung akan menghasilkan layar kosong. Build menggunakan URL aset relatif sehingga mendukung alamat `/PortalHUB/` serta custom domain.

## Supabase

Project URL dan publishable key dikonfigurasi pada `public/config.js`. Build menyalin konfigurasi tersebut menjadi `docs/config.js`. Frontend tidak menggunakan secret key atau service_role key.

Tabel portal memakai awalan `hub_portal_`. Link, kategori, pengumuman, aktivitas, serah terima, dan metadata PDF disimpan di Supabase. Favorit dan riwayat akses disimpan pada browser masing-masing.

Pengunjung dapat melihat portal, membuka tautan, dan melihat atau mengunduh PDF tanpa login. Hanya admin aktif di tabel keanggotaan yang dapat menambah, mengedit, dan menghapus data setelah Login admin. Pada setiap data serah terima, admin memilih apakah Pass bisa ditampilkan pengunjung atau harus dibuka dengan kode. Pass berkode tidak dikirim ke pengunjung sebelum kode diverifikasi oleh server.

`setup-supabase.sql` disertakan untuk pemasangan baru. Installer tidak menimpa perubahan portal atau memunculkan kembali contoh layanan yang sudah dihapus saat dijalankan ulang. Untuk menambahkan admin atau anggota, gunakan `aktifkan-admin.sql` atau `tambahkan-anggota.sql` setelah membuat akun melalui Authentication → Users. Password dikelola melalui Supabase.

Tabel portal memakai RLS; hanya data baca yang ditentukan oleh kebijakan akses publik yang tersedia tanpa login. Perubahan data dilakukan melalui fungsi yang memeriksa admin, memvalidasi isian, serta mencatat aktivitas. Fungsi privileged berada dalam schema `hub_portal_private`; schema ini tidak perlu diekspos pada Data API.

## Modul serah terima dan PDF

Instalasi baru: jalankan `setup-supabase.sql`, lalu `setup-modules.sql`, lalu `setup-public-access.sql`, dan terakhir `setup-handover-type.sql` satu kali. Pada proyek Supabase yang terhubung, migrasi modul sudah diterapkan. Jangan menjalankan ulang installer awal untuk mengubah pengaturan akses proyek yang sudah dipakai.

Serah terima memiliki ID akun, Pass, Tipe yang diketik manual, HUB, rute, dan keterangan. Data disimpan di Supabase, bukan memori browser. ID internal memakai UUID sehingga ID akun yang sama tetap bisa digunakan pada rute lain. Pencarian tidak mencakup password. Pass disamarkan, dapat dibatasi dengan kode per data, dan kembali disembunyikan setelah 30 detik atau saat tab browser tidak aktif.

Dokumen memiliki nama, kategori/subkategori, HUB, PIC, tanggal dokumen, nomor dokumen, versi, keterangan, dan PDF maksimal 25 MB. Admin dapat mengubah metadata, mengganti PDF, menghapus dokumen, dan mengelola kategori. Kategori yang masih dipakai tidak dapat dihapus. File disimpan di bucket `hub-portal-documents` yang tetap privat; pengunjung memperoleh tautan sementara selama lima menit untuk PDF yang sudah diterbitkan dalam daftar. Unggahan yang belum tersimpan sebagai dokumen tidak bisa dibaca pengunjung.

Tersedia pencarian, filter HUB/PIC/bulan/kategori/subkategori, tampilan kartu/tabel, serta pagination. Tabel tetap dapat digeser secara horizontal pada HP, dengan kolom pertama tetap terlihat. Perubahan memakai versi `updated_at` untuk mencegah penimpaan perubahan admin lain. Kode akses di-hash menggunakan bcrypt, tidak disertakan pada daftar publik, dan dibatasi maksimal lima kegagalan per data dalam lima menit. Log aktivitas tidak menyimpan password atau kode. Cadangan JSON pada Pengaturan portal mencakup tautan/kategori layanan; PDF dan tabel serah terima dikelola terpisah di Supabase.

## Subkategori menu dan pemilih PDF

Kategori utama dapat ditambah melalui **Kelola portal → Pengaturan portal → Kategori**. Untuk submenu, isi **Subkategori menu** ketika menambah atau mengedit tautan. Nama baru muncul di bawah kategori induknya setelah tautan disimpan; submenu memfilter tautan berdasarkan kategori dan kelompoknya. Daily, Inbound, dan Outbound mengikuti kelompok laporan yang sudah ada.

Form PDF mempertahankan metadata dan file saat pengguna kembali dari pemilih file atau memfokuskan ulang tab. Pengulangan event SIGNED_IN untuk akun yang sama hanya menyegarkan data. Pergantian akun atau keluar tetap menutup editor. PDF langsung diperiksa saat dipilih, dan setelah status siap pengguna menekan **Simpan dokumen**. Form tidak ditutup dengan menyentuh area di luar dialog.

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

TypeScript, build produksi, dan pengujian integrasi PostgreSQL lokal mencakup RLS, keanggotaan, pencegahan eskalasi peran, validasi URL, perubahan kategori, pemulihan cadangan, perlindungan kategori terakhir, serta inisialisasi yang mempertahankan perubahan.
