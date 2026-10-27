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

Instalasi baru: jalankan `setup-supabase.sql`, lalu `setup-modules.sql`, lalu `setup-public-access.sql`, `setup-handover-type.sql`, lalu `setup-menu-submenus.sql`, `setup-submenu-order.sql`, dan `setup-updates.sql` satu kali. Pada proyek Supabase yang terhubung, migrasi modul sudah diterapkan. Jangan menjalankan ulang installer awal untuk mengubah pengaturan akses proyek yang sudah dipakai.

Serah terima memiliki ID akun, Pass, Tipe yang diketik manual, HUB, rute, dan keterangan. Data disimpan di Supabase, bukan memori browser. ID internal memakai UUID sehingga ID akun yang sama tetap bisa digunakan pada rute lain. Pencarian tidak mencakup password. Pass disamarkan, dapat dibatasi dengan kode per data, dan kembali disembunyikan setelah 30 detik atau saat tab browser tidak aktif.

Dokumen memiliki nama, kategori/subkategori, HUB, PIC, tanggal dokumen, nomor dokumen, versi, keterangan, dan PDF maksimal 25 MB. Admin dapat mengubah metadata, mengganti PDF, menghapus dokumen, dan mengelola kategori. Kategori yang masih dipakai tidak dapat dihapus. File disimpan di bucket `hub-portal-documents` yang tetap privat; pengunjung memperoleh tautan sementara selama lima menit untuk PDF yang sudah diterbitkan dalam daftar. Unggahan yang belum tersimpan sebagai dokumen tidak bisa dibaca pengunjung.

Tersedia pencarian, filter HUB/PIC/bulan/kategori/subkategori, tampilan kartu/tabel, serta pagination. Tabel tetap dapat digeser secara horizontal pada HP, dengan kolom pertama tetap terlihat. Perubahan memakai versi `updated_at` untuk mencegah penimpaan perubahan admin lain. Kode akses di-hash menggunakan bcrypt, tidak disertakan pada daftar publik, dan dibatasi maksimal lima kegagalan per data dalam lima menit. Log aktivitas tidak menyimpan password atau kode. Cadangan JSON pada Pengaturan portal mencakup tautan/kategori layanan; PDF dan tabel serah terima dikelola terpisah di Supabase.

## Subkategori menu dan pemilih PDF

Semua menu, termasuk Aplikasi & sistem, Tim & monitoring, Serah terima, Dokumen & SOP, serta menu baru, mendukung submenu opsional. Buka **Kelola portal → Pengaturan portal → Menu & submenu**, lalu tekan **Submenu** di menu induk untuk menambah, mengubah nama, atau menghapus submenu. Submenu dapat dibuat dan disimpan sebelum ada isinya. Menu tanpa submenu tetap dibuka langsung. Nama submenu yang sama dapat dipakai di menu induk berbeda.

Untuk tautan, pilih atau ketik **Subkategori menu** pada formulir layanan. Untuk serah terima dan PDF, pilih **Submenu** pada formulir data. Pilihan **Tanpa submenu** menyimpan data langsung pada induknya. Kolom Tipe serah terima dan kategori/subkategori dokumen tetap terpisah dari submenu navigasi. Nama submenu yang diubah juga diperbarui pada data di induk yang sama; submenu yang masih digunakan tidak dapat dihapus. Pengaturan submenu tersimpan di Supabase dan disertakan dalam cadangan JSON kategori. Daily, Inbound, dan Outbound tetap tersedia pada menu laporan. Admin dapat mengatur urutannya dengan cara yang sama seperti submenu menu lain.

Form PDF mempertahankan metadata dan file saat pengguna kembali dari pemilih file atau memfokuskan ulang tab. Pengulangan event SIGNED_IN untuk akun yang sama hanya menyegarkan data. Pergantian akun atau keluar tetap menutup editor. PDF langsung diperiksa saat dipilih, dan setelah status siap pengguna menekan **Simpan dokumen**. Form tidak ditutup dengan menyentuh area di luar dialog.

## Antarmuka portal

Desain memakai navigasi navy, aksen oranye, teks dengan kontras lebih jelas, dan kartu layanan yang lebih mudah dipindai. Pencarian selalu tersedia di bagian atas. Filter HUB, submenu, dan status dapat dibersihkan melalui **Reset filter**. Pada HP, menu Beranda/Aplikasi/Laporan/Dokumen tersedia di navigasi bawah; tombol Menu membuka semua menu dan submenu. Kartu memakai satu kolom pada layar kecil, sementara tabel tetap dapat digeser dengan kolom ID yang tetap terlihat.

Admin bisa membuka **Pengaturan** langsung dari header tanpa mengaktifkan mode edit. Tombol **Edit portal** menampilkan aksi edit/hapus pada kartu layanan. Pengaturan menu, form serah terima, serta unggah PDF memakai tampilan yang konsisten. Pengunjung tetap dapat membaca dan membuka layanan tanpa login; pengelolaan data memerlukan admin aktif.

## Update terbaru dan Informasi admin

Dua bagian ini menggantikan **Jelajahi menu** dan **Terakhir dibuka** pada beranda. Pada HP, keduanya tampil setelah ringkasan portal sebelum kartu layanan. Riwayat lengkap dapat dibuka melalui **Lihat semua** atau menu **Informasi tim**. Fitur ini tampil langsung sebagai konten portal.

**Update terbaru** mencatat perubahan berikutnya pada tautan, menu, dokumen, serah terima, dan papan informasi secara otomatis. Pemasangan tidak menyalin log privat atau menerbitkan ulang data lama. Catatan serah terima bersifat umum dan tidak memuat ID akun, password, rute, keterangan, atau kode akses. Perubahan banyak baris dalam satu transaksi diringkas menjadi satu catatan per menu.

**Informasi admin** dapat ditulis melalui **Login admin → Informasi admin → Tambah informasi**. Admin mengisi judul, isi, jenis informasi, tujuan menu atau tautan opsional, dan pilihan sematkan di atas. **Simpan draf** hanya dapat dibaca admin; **Terbitkan untuk tim** menampilkan informasi kepada seluruh pengunjung. Admin dapat mengedit dan mengarsipkan informasi, lalu menerbitkannya kembali dari tab Arsip. Versi data mencegah penimpaan edit admin lain. Riwayat otomatis tidak dapat diedit melalui formulir informasi.

Daftar disegarkan melalui Supabase Realtime, pemeriksaan setiap 30 detik selama tab terlihat, serta saat kembali ke tab. Tidak ada push di luar browser atau pengiriman WhatsApp/email otomatis. Tombol **Salin untuk WhatsApp** menyiapkan teks agar admin dapat menempelkannya sendiri ke grup tim; bila clipboard tidak tersedia, teks dapat disalin manual.

Tabel `hub_portal_updates` memakai RLS. Pengunjung hanya dapat membaca informasi berstatus published; draf dan arsip dibatasi untuk admin aktif. Semua perubahan informasi melalui RPC yang memeriksa keanggotaan admin. API membaca maksimal 100 catatan per permintaan dan UI menampilkan 20 per halaman. Publication Realtime hanya ditambah tabel pembaruan publik ini.

## Urutan dan pengelompokan submenu

Buka **Pengaturan → Menu & submenu → Submenu** pada menu induk. Gunakan panah **naik/turun** untuk memilih posisi; angka 1 adalah posisi paling atas. Perubahan langsung disimpan ke Supabase dan berlaku untuk seluruh pengunjung, termasuk setelah halaman dimuat ulang. Pengubahan nama mempertahankan posisinya, submenu baru ditambahkan di akhir, dan pengurutan yang bertabrakan dengan perubahan admin lain ditolak dengan pesan muat ulang.

Navigasi, pilihan submenu, dan pengelompokan isi mengikuti urutan yang sama. Semua menu layanan dikelompokkan seperti Laporan operasional, termasuk tab kategori pada beranda. Serah terima dan dokumen juga dikelompokkan saat filter **Semua submenu** dipilih. Data tanpa submenu tetap tersedia di kelompok **Tanpa submenu**.

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
