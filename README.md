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

Pengunjung dapat melihat portal, membuka tautan, dan melihat atau mengunduh PDF tanpa login. Hanya admin aktif di tabel keanggotaan yang dapat menambah, mengedit, dan menghapus data setelah masuk sebagai admin. Pada setiap data serah terima, admin memilih apakah Pass bisa ditampilkan pengunjung atau harus dibuka dengan kode. Pass berkode tidak dikirim ke pengunjung sebelum kode diverifikasi oleh server.

`setup-supabase.sql` disertakan untuk pemasangan baru. Installer tidak menimpa perubahan portal atau memunculkan kembali contoh layanan yang sudah dihapus saat dijalankan ulang. Untuk admin pertama, gunakan `aktifkan-admin.sql` setelah membuat akun melalui Authentication → Users. Setelah modul Tugas terpasang, akun tim berikutnya dibuat melalui **Masuk tim → Pengguna → Tambah pengguna**. Akun viewer dari installer lama tetap dapat dipertahankan; akses tugas memerlukan peran Anggota atau Admin.

Tabel portal memakai RLS; hanya data baca yang ditentukan oleh kebijakan akses publik yang tersedia tanpa login. Perubahan data dilakukan melalui fungsi yang memeriksa admin, memvalidasi isian, serta mencatat aktivitas. Fungsi privileged berada dalam schema `hub_portal_private`; schema ini tidak perlu diekspos pada Data API.

## Modul serah terima dan PDF

Instalasi baru: jalankan `setup-supabase.sql`, lalu `setup-modules.sql`, lalu `setup-public-access.sql`, `setup-handover-type.sql`, lalu `setup-menu-submenus.sql`, `setup-submenu-order.sql`, `setup-updates.sql`, `setup-update-images.sql`, lalu `setup-team-tasks.sql` dan `setup-full-backup.sql` satu kali. Setelah itu, pasang Edge Function `hub-portal-team` dari folder `supabase/functions/`. Pada proyek Supabase yang terhubung, migrasi modul sudah diterapkan. Jangan menjalankan ulang installer awal untuk mengubah pengaturan akses proyek yang sudah dipakai.

Serah terima memiliki ID akun, Pass, Tipe yang diketik manual, HUB, rute, dan keterangan. Data disimpan di Supabase, bukan memori browser. ID internal memakai UUID sehingga ID akun yang sama tetap bisa digunakan pada rute lain. Pencarian tidak mencakup password. Pass disamarkan, dapat dibatasi dengan kode per data, dan kembali disembunyikan setelah 30 detik atau saat tab browser tidak aktif.

Dokumen memiliki nama, kategori/subkategori, HUB, PIC, tanggal dokumen, nomor dokumen, versi, keterangan, dan PDF maksimal 25 MB. Admin dapat mengubah metadata, mengganti PDF, menghapus dokumen, dan mengelola kategori. Kategori yang masih dipakai tidak dapat dihapus. File disimpan di bucket `hub-portal-documents` yang tetap privat; pengunjung memperoleh tautan sementara selama lima menit untuk PDF yang sudah diterbitkan dalam daftar. Unggahan yang belum tersimpan sebagai dokumen tidak bisa dibaca pengunjung.

Tersedia pencarian, filter HUB/PIC/bulan/kategori/subkategori, tampilan kartu/tabel, serta pagination. Tabel tetap dapat digeser secara horizontal pada HP, dengan kolom pertama tetap terlihat. Perubahan memakai versi `updated_at` untuk mencegah penimpaan perubahan admin lain. Kode akses di-hash menggunakan bcrypt, tidak disertakan pada daftar publik, dan dibatasi maksimal lima kegagalan per data dalam lima menit. Log aktivitas tidak menyimpan password atau kode. Cadangan JSON lengkap pada Pengaturan portal mencakup seluruh modul portal beserta file yang dirujuk, termasuk PDF dan serah terima.

## Subkategori menu dan pemilih PDF

Semua menu, termasuk Aplikasi & sistem, Tim & monitoring, Serah terima, Dokumen & SOP, serta menu baru, mendukung submenu opsional. Buka **Kelola portal → Pengaturan portal → Menu & submenu**, lalu tekan **Submenu** di menu induk untuk menambah, mengubah nama, atau menghapus submenu. Submenu dapat dibuat dan disimpan sebelum ada isinya. Menu tanpa submenu tetap dibuka langsung. Nama submenu yang sama dapat dipakai di menu induk berbeda.

Untuk tautan, pilih atau ketik **Subkategori menu** pada formulir layanan. Untuk serah terima dan PDF, pilih **Submenu** pada formulir data. Pilihan **Tanpa submenu** menyimpan data langsung pada induknya. Kolom Tipe serah terima dan kategori/subkategori dokumen tetap terpisah dari submenu navigasi. Nama submenu yang diubah juga diperbarui pada data di induk yang sama; submenu yang masih digunakan tidak dapat dihapus. Pengaturan submenu tersimpan di Supabase dan disertakan dalam cadangan JSON kategori. Daily, Inbound, dan Outbound tetap tersedia pada menu laporan. Admin dapat mengatur urutannya dengan cara yang sama seperti submenu menu lain.

Form PDF mempertahankan metadata dan file saat pengguna kembali dari pemilih file atau memfokuskan ulang tab. Pengulangan event SIGNED_IN untuk akun yang sama hanya menyegarkan data. Pergantian akun atau keluar tetap menutup editor. PDF langsung diperiksa saat dipilih, dan setelah status siap pengguna menekan **Simpan dokumen**. Form tidak ditutup dengan menyentuh area di luar dialog.

## Antarmuka portal

Desain memakai navigasi navy, aksen oranye, teks dengan kontras lebih jelas, dan kartu layanan yang lebih mudah dipindai. Pencarian selalu tersedia di bagian atas. Filter HUB, submenu, dan status dapat dibersihkan melalui **Reset filter**. Pada HP, menu Beranda/Aplikasi/Laporan/Dokumen tersedia di navigasi bawah; tombol Menu membuka semua menu dan submenu. Kartu layanan memakai empat kolom mulai lebar 1.680 px, tiga kolom mulai 1.400 px, dua kolom pada layar menengah, dan satu kolom sampai 600 px. Setiap kartu menampilkan submenu, judul, deskripsi, status akses, HUB, dan tombol akses yang tersusun rata. Tampilan daftar tetap tersedia. Tabel dapat digeser dengan kolom ID yang tetap terlihat.

Pada desktop (lebar di atas 900 px), menu kiri, konten tengah, dan panel informasi kanan memiliki area scroll vertikal masing-masing. Header pencarian dan judul halaman tetap terlihat. Scroll berhenti pada area yang sedang digulir tanpa menggerakkan area lain. Pergantian menu mengembalikan konten tengah ke atas; panel kanan tetap pada posisinya. Panel kanan mengikuti aturan responsif yang sudah ada dan disembunyikan saat ruang layar terbatas. Pada HP, konten memakai scroll halaman biasa dan menu samping tetap dapat digulir saat dibuka.

Admin bisa membuka **Pengaturan** langsung dari header tanpa mengaktifkan mode edit. Tombol **Edit portal** menampilkan aksi edit/hapus pada kartu layanan. Pengaturan menu, form serah terima, serta unggah PDF memakai tampilan yang konsisten. Pengunjung tetap dapat membaca dan membuka layanan tanpa login; pengelolaan data memerlukan admin aktif.

## Update terbaru dan Informasi admin

Beranda memakai kartu informasi admin yang ringkas, tanpa tinggi minimum atau panel besar. Maksimal dua informasi tampil berdampingan di desktop dan satu informasi utama tampil di HP; semua pesan tetap tersedia melalui **Lihat semua**. Thumbnail gambar bersifat opsional. Pintasan menu berbentuk tile, disusul akses layanan dan riwayat **Update terbaru** di bawah. Ringkasan jumlah layanan, tautan terhubung, dan favorit tetap dapat dibuka. Papan informasi portal lama tersedia melalui bagian yang bisa dibuka/tutup. Pencarian langsung memprioritaskan hasil layanan.

**Update terbaru** mencatat perubahan berikutnya pada tautan, menu, dokumen, serah terima, dan papan informasi secara otomatis. Pemasangan tidak menyalin log privat atau menerbitkan ulang data lama. Catatan serah terima bersifat umum dan tidak memuat ID akun, password, rute, keterangan, atau kode akses. Perubahan banyak baris dalam satu transaksi diringkas menjadi satu catatan per menu.

**Informasi admin** dapat ditulis melalui **Masuk tim (akun admin) → Informasi admin → Tambah informasi**. Admin mengisi judul, isi, jenis informasi, tujuan menu atau tautan opsional, dan pilihan sematkan di atas. **Simpan draf** hanya dapat dibaca admin; **Terbitkan untuk tim** menampilkan informasi kepada seluruh pengunjung. Admin dapat mengedit dan mengarsipkan informasi, lalu menerbitkannya kembali dari tab Arsip. Versi data mencegah penimpaan edit admin lain. Riwayat otomatis tidak dapat diedit melalui formulir informasi.

Daftar disegarkan melalui Supabase Realtime, pemeriksaan setiap 30 detik selama tab terlihat, serta saat kembali ke tab. Tidak ada push di luar browser atau pengiriman WhatsApp/email otomatis. Tombol **Salin untuk WhatsApp** menyiapkan teks agar admin dapat menempelkannya sendiri ke grup tim; bila clipboard tidak tersedia, teks dapat disalin manual.

Tabel `hub_portal_updates` memakai RLS. Pengunjung hanya dapat membaca informasi berstatus published; draf dan arsip dibatasi untuk admin aktif. Semua perubahan informasi melalui RPC yang memeriksa keanggotaan admin. API membaca maksimal 100 catatan per permintaan dan UI menampilkan 20 per halaman. Publication Realtime hanya ditambah tabel pembaruan publik ini.

## Gambar pendukung informasi admin

Pada **Tambah/Edit informasi → Gambar pendukung → Pilih gambar**, admin dapat memilih maksimal 4 gambar JPG, PNG, atau WebP (5 MB per gambar, maksimal 24 megapiksel dan sisi terpanjang 12.000 piksel). File diperiksa berdasarkan isi file dan kemampuan browser membacanya, lalu tampil sebagai pratinjau. Keterangan gambar bersifat opsional; gunakan panah untuk mengatur urutan. Gambar pertama menjadi thumbnail kecil pada daftar. Gambar lengkap beserta keterangannya tampil di isi informasi saat dibuka, dan dapat dibuka dalam ukuran penuh.

Gambar baru diunggah ketika **Simpan draf**, **Terbitkan**, atau **Simpan perubahan** ditekan. Pemilihan file dan metadata tetap berada di formulir bila validasi/unggahan gagal. Tombol simpan menampilkan progres unggahan. Menghapus gambar pada formulir baru diterapkan ketika informasi disimpan; membatalkan formulir mempertahankan versi tersimpan.

File berada di bucket privat `hub-portal-images`, tanpa secret key pada frontend. RLS hanya mengizinkan admin aktif mengunggah; pengunjung dapat membaca file yang dirujuk informasi berstatus published. Draf dan arsip tidak dapat dibaca pengunjung. Tautan gambar berlaku lima menit dan disegarkan saat portal tetap terbuka. Metadata disimpan pada `hub_portal_updates.images`; referensi privat memakai foreign key agar file yang masih dipakai tidak terhapus. API mempertahankan gambar ketika klien lama tidak menyertakan kolom gambar. Penggantian gambar membersihkan file lama setelah data baru berhasil disimpan.

## Urutan dan pengelompokan submenu

Buka **Pengaturan → Menu & submenu → Submenu** pada menu induk. Gunakan panah **naik/turun** untuk memilih posisi; angka 1 adalah posisi paling atas. Perubahan langsung disimpan ke Supabase dan berlaku untuk seluruh pengunjung, termasuk setelah halaman dimuat ulang. Pengubahan nama mempertahankan posisinya, submenu baru ditambahkan di akhir, dan pengurutan yang bertabrakan dengan perubahan admin lain ditolak dengan pesan muat ulang.

Navigasi, pilihan submenu, dan pengelompokan isi mengikuti urutan yang sama. Semua menu layanan dikelompokkan seperti Laporan operasional, termasuk tab kategori pada beranda. Serah terima dan dokumen juga dikelompokkan saat filter **Semua submenu** dipilih. Data tanpa submenu tetap tersedia di kelompok **Tanpa submenu**.

## Tugas operasional dan akun tim

Pengunjung tetap dapat membaca informasi umum, tautan, dan PDF tanpa login. **Masuk tim** memakai satu formulir untuk anggota dan admin. Anggota masuk dengan **NIK/ID + password**; admin lama tetap memakai email dan password yang sudah ada. Tidak ada pendaftaran mandiri atau password bawaan baru.

Admin membuka **Pengguna → Tambah pengguna** dan mengisi nama, NIK/ID, password awal, HUB, serta **Pengguna/peran: Anggota tim atau Admin**. NIK/ID sepanjang 2–50 karakter mendukung huruf, angka, titik, garis bawah, dan minus; tidak peka huruf besar/kecil dan mempertahankan angka nol di depan. Password yang diketik minimal 3 karakter. Password tidak ditampilkan pada daftar, tidak disimpan dalam tabel profil, dan tidak dikirim kembali dari API. Akun baru tidak memerlukan email pribadi. Supabase Auth memakai identitas email internal yang dipetakan dari NIK/ID, tanpa pengiriman email. Admin dapat mengubah nama/HUB/peran, menonaktifkan/mengaktifkan akun, dan mengatur password baru untuk akun NIK/ID maupun admin email lama. ID login dipertahankan setelah akun dibuat. Admin tidak dapat menonaktifkan atau menurunkan peran akunnya sendiri.

Pada **Tugas operasional → Buat tugas**, admin mengisi judul, instruksi, HUB, satu PIC, tenggat dalam WITA, prioritas, dan checklist opsional (maksimal 30 langkah). Anggota hanya melihat tugas yang ditugaskan kepadanya. Admin dapat melihat semua tugas atau tugas miliknya sendiri. Ringkasan menampilkan total, diproses, perlu verifikasi, dan lewat tenggat; pencarian, filter HUB/status, dan halaman daftar tetap tersedia. Daftar disegarkan setiap 30 detik saat tab terlihat dan ketika kembali ke tab.

Anggota menandai checklist untuk menghitung progres. Tanpa checklist, anggota mengisi persentase sendiri. Status: **Belum dikerjakan → Diproses → Menunggu verifikasi → Selesai**; **Tertunda** memerlukan alasan. Progres harus 100% sebelum diajukan; hanya admin yang dapat memverifikasi **Selesai**. Admin dapat membuka kembali tugas dengan catatan perbaikan. Tugas dapat diarsipkan dan dipulihkan; arsip mempertahankan riwayat dan bukti serta menolak perubahan progres/catatan. Perubahan bersamaan diperiksa menggunakan `updated_at` agar pembaruan PIC/admin lain tidak tertimpa.

Catatan mendukung maksimal empat bukti per kiriman: PDF 10 MB; JPG/PNG/WebP 5 MB. File diperiksa berdasarkan isi, diunggah ketika **Kirim catatan**, kemudian direferensikan pada aktivitas yang tersimpan. Jika unggahan gagal, catatan dan pilihan file tetap di formulir untuk dicoba lagi. Bukti disimpan pada bucket privat `hub-portal-task-files`, dibatasi untuk admin aktif dan PIC yang masih ditugaskan, dan dibuka dengan tautan sementara satu menit. File yang sudah menjadi bukti tidak dihapus melalui formulir. Detail menampilkan 100 aktivitas terbaru, termasuk pelaku, waktu, progres, verifikasi, dan lampiran. Tugas tidak diterbitkan ke feed pembaruan publik.

Installer `setup-team-tasks.sql` menambahkan profil pada `hub_portal_members`, tabel `hub_portal_tasks` dan `hub_portal_task_events`, RPC, RLS, serta bucket bukti. Riwayat pengelolaan portal lama dibatasi untuk admin. API publik tugas/account memakai security invoker; fungsi dengan hak istimewa berada di schema privat dan memeriksa keanggotaan dari database, bukan user metadata. Pembaruan akun melalui RPC service-only yang kembali memeriksa admin dan konflik versi.

Edge Function `hub-portal-team` harus dipasang sebelum frontend baru diterbitkan. Function menggunakan `SUPABASE_SECRET_KEYS.default` (fallback `SUPABASE_SERVICE_ROLE_KEY`) yang tersedia di lingkungan server. Kunci ini tidak masuk frontend/repository. `verify_jwt=false` pada konfigurasi gateway disengaja: handler sendiri memvalidasi bearer token melalui `Auth.getUser` dan memeriksa keanggotaan admin aktif pada setiap permintaan. Function membuat akun melalui Auth Admin, menghapus akun baru jika penyimpanan profil gagal, dan memisahkan perubahan profil dari penggantian password. Installer database dan function dipasang lebih dahulu, baru publish frontend melalui GitHub/Vercel.

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

Admin membuka **Pengaturan portal → Cadangan → Unduh cadangan lengkap**. Format `portal-hub-v2` menyimpan satu JSON yang berisi:

- Menu, urutan submenu, layanan/tautan, serta pengaturan dan papan informasi.
- Serah terima, Pass, dan hash kode pembatas akses.
- Kategori dokumen, metadata, dan isi file PDF.
- Informasi admin, draf, arsip, update otomatis, dan isi gambar.
- Tugas, checklist, progres, riwayat, komentar, dan file bukti.
- Profil pengguna, NIK/ID, HUB, peran, status aktif, dan log aktivitas admin.

File yang dirujuk data disertakan sebagai base64 beserta SHA-256. File Storage yang tidak dirujuk, favorit/riwayat browser, tabel Supabase di luar portal, password login, dan sesi Auth tidak disertakan. JSON memuat data internal termasuk Pass serah terima; simpan secara privat dan jangan unggah ke repository publik. Batas satu JSON 256 MB, metadata 20 MB, maksimal 100.000 baris per tabel dan 10.000 file.

Untuk memulihkan, pilih JSON, periksa ringkasan jumlah data, lalu tekan **Pulihkan seluruh data**. Portal memeriksa versi, asal proyek, metadata, kelengkapan file, dan SHA-256, lalu mengunduh cadangan kondisi saat ini terlebih dahulu. File dipersiapkan pada lokasi baru tanpa menimpa file aktif; penggantian data dilakukan secara atomik. Bila unggahan gagal atau data berubah saat file disiapkan, penggantian ditolak dan file persiapan dibersihkan. File lama dibersihkan setelah data baru berhasil disimpan. Dialog pemulihan tetap terbuka saat terjadi kesalahan.

Pemulihan penuh ditujukan ke proyek portal yang sama. Akun login harus masih ada di Supabase Auth; kredensial tidak dibuat, diganti, atau dipulihkan dari JSON. Admin yang menjalankan pemulihan tetap aktif. Profil yang tidak ada dalam cadangan dinonaktifkan, kecuali admin tersebut. Cadangan lama `portal-hub-v1` tetap diterima dan hanya mengganti layanan serta kategori; modul lain tetap tersimpan.

`setup-full-backup.sql` dijalankan satu kali setelah seluruh installer modul. Snapshot dan pemulihan hanya dapat dipakai admin aktif; API publik menggunakan security invoker dan pemeriksaan admin berada di schema privat. Pengujian pemulihan menggunakan database lokal dengan data contoh; pemasangan di proyek aktif tidak mengganti isi data portal.

## Validasi

TypeScript, build produksi, dan pengujian integrasi PostgreSQL lokal mencakup RLS, keanggotaan, pencegahan eskalasi peran, validasi URL, perubahan kategori, pemulihan cadangan lengkap beserta file dan penolakan konflik, integritas SHA-256, perlindungan kategori terakhir, serta inisialisasi yang mempertahankan perubahan.


## Password portal minimal 3 karakter

Form pembuatan akun dan penggantian password memakai batas 3–128 karakter. Sebelum dikirim ke Supabase Auth, password diolah melalui PBKDF2 SHA-256 (100.000 iterasi) dengan salt versi dan email akun, menjadi kredensial internal 68 karakter. Derivasi dijalankan di server saat membuat/mengganti password dan di browser HTTPS saat masuk. Nilai ini tetap diverifikasi serta di-hash oleh Supabase Auth; aturan peran, sesi, dan RLS tetap berasal dari Supabase.

Akun NIK/ID mencoba format baru dahulu, lalu password asli untuk akun lama hanya saat Auth mengembalikan `invalid_credentials`. Akun email lama mencoba password asli dahulu, lalu format baru. Batas percobaan/kesalahan jaringan tidak diulang dengan format alternatif. Password akun yang sudah ada tidak diubah otomatis. Perubahan identitas email akun yang memakai format ini harus disertai pengaturan password ulang; NIK/ID di portal tetap tidak dapat diubah. Pengolahan ini tidak menambah kekuatan tebak password 3 karakter.

Pada halaman layanan selain Beranda, panel kanan berurutan **Papan informasi → Informasi admin → Update terbaru**.
