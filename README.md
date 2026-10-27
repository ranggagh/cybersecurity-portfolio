# Portofolio

Situs statis (HTML/CSS/JS, tanpa build). Jalankan lokal:

```
python serve.py
```

lalu buka http://localhost:5500/ (port 8000 dipakai Splunk di mesin ini).

`serve.py` dipakai sebagai pengganti `python -m http.server` karena di Windows server bawaan sering
mengirim file `.js` sebagai `text/plain`, sehingga browser menolak ES module tool. `serve.py` juga
mematikan cache agar perubahan langsung terlihat. Membuka file langsung (`file://`) tidak didukung
karena ES module dan Web Worker butuh server HTTP.

## Struktur

```
Portofolio/
├── index.html                 Halaman utama portfolio (publik) + modal login
├── serve.py                   Server pengembangan lokal (MIME benar, tanpa cache)
├── assets/                    Gambar, ikon, file statis
├── css/
│   └── base.css               Gaya bersama (warna, navbar, kartu, tombol, modal)
├── js/
│   ├── shared/                Dipakai semua halaman
│   │   ├── script.js          Canvas background, navbar, scroll spy
│   │   ├── supabase-config.js URL & anon key Supabase
│   │   ├── supabase-client.js Inisialisasi client Supabase
│   │   ├── auth.js            Modal login/register, sesi, alur Launch App, navbar tool
│   │   └── auth-guard.js      Proteksi halaman tool (wajib login)
│   ├── home/
│   │   └── three-scene.js     Animasi 3D hero (khusus index.html)
│   └── vendor/
│       └── three.min.js       Library pihak ketiga
├── tools/
│   ├── _template/             Salin folder ini untuk tool baru
│   ├── soc-dashboard/         Analisis log SSH (lihat di bawah)
│   │   ├── index.html, tool.js, tool.css
│   │   ├── engine/            Modul murni: parser, rules, detector, simulator, pipeline, worker
│   │   ├── tests/             Tes engine (node --test)
│   │   └── package.json       Hanya untuk menjalankan tes
│   ├── incident-management/
│   └── cyber-lab/
└── supabase/
    └── migrations/            SQL skema database
```

## Menambah tool baru

1. Salin `tools/_template/` menjadi `tools/<nama-tool>/` (huruf kecil, pakai tanda hubung).
2. Ganti `TOOL_NAME`, `TOOL::TAG`, dan `tool-slug` di `index.html`, `tool.js`, `tool.css`.
3. Tulis logika UI di `tool.js` (ES module) dan gaya khusus di `tool.css`. Gaya umum tetap di `css/base.css`.
4. Tambahkan kartu proyek di `index.html` (bagian `#projects`) dengan tombol Launch App yang menautkan
   ke `tools/<nama-tool>/index.html`. Tidak perlu atribut atau script tambahan.

Setiap tool berada dua level di bawah root, jadi file bersama dirujuk dengan `../../` (misalnya `../../css/base.css`).

### Konvensi kode tool

- **Logika murni di `engine/`**: parsing, deteksi, dan perhitungan tanpa akses DOM, supaya bisa diuji
  dengan Node dan dijalankan di Web Worker. `tool.js` hanya mengurus UI.
- **Tes di `tests/`** memakai test runner bawaan Node (tanpa dependency). Tambahkan `package.json`
  berisi `"type": "module"` dan script `"test": "node --test tests/"`, lalu jalankan `npm test` di folder tool.
- **Input pengguna tidak tepercaya**: isi file/log/form ditampilkan lewat `textContent` atau
  `append(string)`, jangan lewat `innerHTML`.
- **Atribut `hidden`**: komponen dengan `display: flex/grid` mengalahkan `hidden`; template sudah
  menyertakan aturan `[hidden] { display: none !important; }`.

## SOC Monitoring Dashboard (`tools/soc-dashboard/`)

Analisis log SSH (`auth.log`) yang berjalan penuh di browser, untuk belajar dan eksperimen
(bukan alat produksi). Dua mode memakai jalur yang sama:

```
simulator (teks log)  ┐
                      ├─→ parser → event → detector → alert → UI
unggahan file (teks)  ┘
```

- **Format**: hanya auth.log SSH (syslog sshd, termasuk timestamp ISO dan `sshd-session`). Format lain ditolak.
  Log syslog tidak menyimpan tahun, jadi diasumsikan tahun berjalan (dengan penanganan pergantian Des → Jan).
- **Aturan** (`engine/rules.js`, threshold/window bisa diubah):

  | Aturan | Kondisi default | Severity | MITRE |
  |---|---|---|---|
  | SSH Brute Force | ≥ 5 gagal dari 1 IP dalam 60 detik | Medium, High jika ≥ 50 | T1110.001 |
  | Login Berhasil Setelah Gagal | sukses dari IP dengan ≥ 5 gagal dalam 10 menit | Critical | T1078 |
  | Password Spraying | 1 IP gagal ke ≥ 5 username berbeda dalam 10 menit | High | T1110.003 |
  | Serangan ke Akun Privileged | ≥ 3 gagal ke root/admin dalam 5 menit | Medium | T1110 |

  Alert dengan aturan + IP sama digabung jika jedanya ≤ 5 menit, jadi satu serangan panjang tetap satu alert.
  Pasangan baris `Invalid user X` + `Failed password for invalid user X` dihitung satu percobaan.
- **Privasi**: file diproses di browser (Web Worker), tidak dikirim ke server. Batas 10 MB.
- **Tes**: `cd tools/soc-dashboard && npm test`

## Login (Supabase)

- **Launch App**: `auth.js` menangkap setiap klik link ke `tools/...` di halaman utama. Jika belum login,
  modal login/register dibuka dan tujuan disimpan; setelah login berhasil pengguna diteruskan ke tool itu.
  Jika sudah login, link dibuka langsung.
- **Proteksi tool**: `auth-guard.js` dipasang di `<head>` setiap tool (sudah ada di template). Halaman
  disembunyikan sampai sesi terkonfirmasi; tanpa sesi, pengunjung dialihkan ke `index.html?next=<path tool>`
  dan modal login terbuka otomatis. `?next=` hanya menerima path internal situs ini.
- **Di dalam tool**: navbar menampilkan email pengguna dan tombol Logout; setelah logout kembali ke halaman utama.
- Hanya anon/publishable key Supabase yang boleh ada di frontend (`supabase-config.js`).
