#!/usr/bin/env node
/**
 * Uji RLS end-to-end: akun NON-ADMIN (dan pengunjung anon) mencoba menulis ke tabel
 * certifications dan bucket "certificates" lewat REST/Storage API Supabase yang asli.
 * Semua percobaan tulis HARUS ditolak. Tanpa dependency (Node 18+, fetch bawaan).
 *
 * Persiapan:
 *   1. Migrasi 03 sudah dijalankan.
 *   2. Buat akun non-admin biasa lewat modal register di halaman utama.
 *   3. (Disarankan) Sebagai admin, buat satu sertifikat DUMMY lewat /admin/certifications/,
 *      sebaiknya dengan file terlampir, lalu salin id-nya (Table Editor > certifications).
 *      Tes UPDATE/DELETE/timpa-file diarahkan ke baris ini. Tanpa TEST_CERT_ID, tes itu
 *      memakai id acak yang tidak ada, sehingga hasilnya hanya "SKIP" (tidak membuktikan apa pun).
 *
 * Jalankan (PowerShell):
 *   $env:SUPABASE_URL="https://<project>.supabase.co"
 *   $env:SUPABASE_ANON_KEY="<anon/publishable key>"
 *   $env:TEST_EMAIL="<email akun non-admin>"
 *   $env:TEST_PASSWORD="<password akun non-admin>"
 *   $env:TEST_CERT_ID="<id sertifikat dummy>"      # opsional
 *   $env:ADMIN_EMAIL="<email admin>"                # opsional, lihat di bawah
 *   $env:ADMIN_PASSWORD="<password admin>"          # opsional
 *   node supabase/tests/rls-certifications.mjs
 *
 * Yang diuji untuk file: anon & non-admin tidak bisa melihat daftar file, upload, menimpa,
 * atau menghapus; URL publik file tetap bisa dibuka tanpa login.
 * Dengan ADMIN_EMAIL/ADMIN_PASSWORD, skrip juga memastikan admin tetap bisa upload, melihat
 * daftar, mengganti, dan menghapus file. Bagian ini hanya memakai file uji baru
 * (rls-admin-test-*.png) yang dihapus lagi di akhir; data lain tidak disentuh.
 *
 * Kode keluar 0 jika semua PASS, 1 jika ada FAIL. Skrip menolak berjalan jika akun uji
 * (TEST_EMAIL) ternyata admin (agar tidak mengubah data sungguhan).
 */

import { randomUUID } from 'node:crypto';

const env = (name, required = true) => {
  const value = (process.env[name] || '').trim();
  if (!value && required) {
    console.error(`Variabel lingkungan ${name} belum diisi. Lihat komentar di atas file ini.`);
    process.exit(2);
  }
  return value;
};

const BASE = env('SUPABASE_URL').replace(/\/+$/, '');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const EMAIL = env('TEST_EMAIL');
const PASSWORD = env('TEST_PASSWORD');
const TEST_CERT_ID = env('TEST_CERT_ID', false);
const ADMIN_EMAIL = env('ADMIN_EMAIL', false);
const ADMIN_PASSWORD = env('ADMIN_PASSWORD', false);
const BUCKET = 'certificates';

// PNG 1x1 yang valid
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
const record = (actor, action, status, detail) => results.push({ actor, action, status, detail });

function headers(token, extra = {}) {
  const h = { apikey: ANON_KEY, ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function call(method, path, { token, body, json = true, extraHeaders = {} } = {}) {
  const init = { method, headers: headers(token, extraHeaders) };
  if (body !== undefined) {
    init.body = json ? JSON.stringify(body) : body;
    if (json) init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* bukan JSON */ }
  return { status: res.status, ok: res.ok, data };
}

const short = (data) => {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return s && s.length > 140 ? `${s.slice(0, 140)}...` : s;
};

// Penulisan ditolak = status error, atau 2xx tanpa baris yang terkena (filter RLS)
function judgeWrite(actor, action, res, { inconclusiveIfEmpty = false } = {}) {
  const rows = Array.isArray(res.data) ? res.data.length : null;
  if (!res.ok) {
    record(actor, action, 'PASS', `ditolak (HTTP ${res.status}) ${short(res.data)}`);
  } else if (rows === 0) {
    record(actor, action, inconclusiveIfEmpty ? 'SKIP' : 'PASS',
      inconclusiveIfEmpty ? '0 baris (target tidak ada; isi TEST_CERT_ID agar bermakna)' : '0 baris terkena (disaring RLS)');
  } else {
    record(actor, action, 'FAIL', `BERHASIL (HTTP ${res.status}) ${short(res.data)}`);
  }
  return res.ok && rows !== 0;
}

async function signIn(email, password, label) {
  const res = await call('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  if (!res.ok || !res.data || !res.data.access_token) {
    console.error(`Login ${label} gagal (HTTP ${res.status}): ${short(res.data)}`);
    process.exit(2);
  }
  return res.data.access_token;
}

async function isAdmin(token) {
  const rpc = await call('POST', '/rest/v1/rpc/is_certifications_admin', { token, body: {} });
  return { rpc, admin: rpc.ok && rpc.data === true };
}

// Daftar objek di root bucket (search: saring nama)
async function listFiles(token, search = '') {
  const res = await call('POST', `/storage/v1/object/list/${BUCKET}`, {
    token,
    body: { prefix: '', search, limit: 1000, offset: 0 }
  });
  return { res, names: res.ok && Array.isArray(res.data) ? res.data.map((o) => o.name) : [] };
}

async function attackTable(actor, token, target) {
  const insert = await call('POST', '/rest/v1/certifications', {
    token,
    body: { title: 'RLS_TEST_SHOULD_NOT_EXIST', issuer: 'RLS Test', issued_date: '2020-01-01' },
    extraHeaders: { Prefer: 'return=representation' }
  });
  if (judgeWrite(actor, 'INSERT certifications', insert) && Array.isArray(insert.data)) {
    // Kebijakan bocor: coba bersihkan baris yang terlanjur dibuat
    for (const row of insert.data) {
      await call('DELETE', `/rest/v1/certifications?id=eq.${row.id}`, { token });
    }
  }

  const filter = `/rest/v1/certifications?id=eq.${encodeURIComponent(target.id)}`;
  const update = await call('PATCH', filter, {
    token,
    body: { title: 'RLS_TEST_HACKED' },
    extraHeaders: { Prefer: 'return=representation' }
  });
  judgeWrite(actor, 'UPDATE certifications', update, { inconclusiveIfEmpty: !target.exists });

  const del = await call('DELETE', filter, { token, extraHeaders: { Prefer: 'return=representation' } });
  judgeWrite(actor, 'DELETE certifications', del, { inconclusiveIfEmpty: !target.exists });
}

async function attackStorage(actor, token, target) {
  // Daftar file harus tersembunyi; dengan file dummy yang pasti ada, daftar kosong = disaring RLS
  const listing = await listFiles(token);
  if (listing.names.length > 0) {
    record(actor, 'LIHAT daftar file', 'FAIL', `${listing.names.length} file terlihat, mis. ${listing.names[0]}`);
  } else if (!target.filePath) {
    record(actor, 'LIHAT daftar file', 'SKIP', 'daftar kosong, tapi bucket mungkin memang kosong; lampirkan file ke sertifikat dummy');
  } else {
    record(actor, 'LIHAT daftar file', 'PASS',
      listing.res.ok ? 'daftar kosong padahal file dummy ada (disaring RLS)' : `ditolak (HTTP ${listing.res.status})`);
  }

  const name = `rls-test-${randomUUID()}.png`;
  const upload = await call('POST', `/storage/v1/object/${BUCKET}/${name}`, {
    token,
    body: PNG_BYTES,
    json: false,
    extraHeaders: { 'Content-Type': 'image/png', 'x-upsert': 'false' }
  });
  if (upload.ok) {
    record(actor, 'UPLOAD file baru', 'FAIL', `BERHASIL (HTTP ${upload.status}) ${short(upload.data)}`);
    await call('DELETE', `/storage/v1/object/${BUCKET}`, { token, body: { prefixes: [name] } });
  } else {
    record(actor, 'UPLOAD file baru', 'PASS', `ditolak (HTTP ${upload.status}) ${short(upload.data)}`);
  }

  if (!target.filePath) {
    record(actor, 'UPDATE/DELETE file yang ada', 'SKIP', 'TEST_CERT_ID tidak punya file; lampirkan file ke sertifikat dummy');
    return;
  }

  const overwrite = await call('PUT', `/storage/v1/object/${BUCKET}/${target.filePath}`, {
    token,
    body: PNG_BYTES,
    json: false,
    extraHeaders: { 'Content-Type': 'image/png', 'x-upsert': 'true' }
  });
  record(actor, 'UPDATE (timpa) file yang ada', overwrite.ok ? 'FAIL' : 'PASS',
    `${overwrite.ok ? 'BERHASIL' : 'ditolak'} (HTTP ${overwrite.status}) ${short(overwrite.data)}`);

  const remove = await call('DELETE', `/storage/v1/object/${BUCKET}`, { token, body: { prefixes: [target.filePath] } });
  const removedCount = Array.isArray(remove.data) ? remove.data.length : 0;
  record(actor, 'DELETE file yang ada', remove.ok && removedCount > 0 ? 'FAIL' : 'PASS',
    remove.ok ? `${removedCount} objek terhapus` : `ditolak (HTTP ${remove.status}) ${short(remove.data)}`);
}

async function loadTarget() {
  if (!TEST_CERT_ID) return { id: randomUUID(), exists: false, filePath: null };
  const res = await call('GET', `/rest/v1/certifications?select=id,title,file_path&id=eq.${encodeURIComponent(TEST_CERT_ID)}`);
  const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    console.error(`TEST_CERT_ID ${TEST_CERT_ID} tidak ditemukan (HTTP ${res.status}): ${short(res.data)}`);
    process.exit(2);
  }
  return { id: row.id, exists: true, title: row.title, filePath: row.file_path };
}

async function verifyTargetIntact(target) {
  if (!target.exists) return;
  const res = await call('GET', `/rest/v1/certifications?select=id,title,file_path&id=eq.${encodeURIComponent(target.id)}`);
  const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
  const intact = row && row.title === target.title && row.file_path === target.filePath;
  record('check', 'baris dummy utuh setelah serangan', intact ? 'PASS' : 'FAIL', row ? `title="${row.title}"` : 'baris hilang');

  if (target.filePath) {
    // Tanpa apikey/Authorization: persis seperti pengunjung yang membuka link "Lihat sertifikat"
    const file = await fetch(`${BASE}/storage/v1/object/public/${BUCKET}/${target.filePath}`, { method: 'HEAD' });
    record('anon', 'BUKA URL publik file dummy (masih ada)', file.ok ? 'PASS' : 'FAIL', `HTTP ${file.status}`);
  }
}

// Admin tetap bisa upload, melihat daftar, mengganti, dan menghapus file (hanya file uji sendiri)
async function checkAdminStorage(token) {
  const name = `rls-admin-test-${randomUUID()}.png`;
  const objectPath = `/storage/v1/object/${BUCKET}/${name}`;
  const pngHeaders = (upsert) => ({ 'Content-Type': 'image/png', 'x-upsert': String(upsert) });
  let uploaded = false;

  try {
    const upload = await call('POST', objectPath, { token, body: PNG_BYTES, json: false, extraHeaders: pngHeaders(false) });
    uploaded = upload.ok;
    record('admin', 'UPLOAD file baru', upload.ok ? 'PASS' : 'FAIL', `HTTP ${upload.status} ${upload.ok ? '' : short(upload.data)}`);
    if (!upload.ok) return;

    const listed = (await listFiles(token, name)).names.includes(name);
    record('admin', 'LIHAT daftar file', listed ? 'PASS' : 'FAIL', listed ? 'file uji terlihat' : 'file uji tidak ada di daftar');

    const pub = await fetch(`${BASE}/storage/v1/object/public/${BUCKET}/${name}`);
    record('anon', 'BUKA URL publik file (tanpa login)', pub.ok ? 'PASS' : 'FAIL', `HTTP ${pub.status}`);

    const replace = await call('PUT', objectPath, { token, body: PNG_BYTES, json: false, extraHeaders: pngHeaders(true) });
    record('admin', 'GANTI (timpa) file', replace.ok ? 'PASS' : 'FAIL', `HTTP ${replace.status} ${replace.ok ? '' : short(replace.data)}`);

    const remove = await call('DELETE', `/storage/v1/object/${BUCKET}`, { token, body: { prefixes: [name] } });
    const removedCount = Array.isArray(remove.data) ? remove.data.length : 0;
    record('admin', 'HAPUS file', remove.ok && removedCount === 1 ? 'PASS' : 'FAIL',
      remove.ok ? `${removedCount} objek terhapus` : `HTTP ${remove.status} ${short(remove.data)}`);

    const stillListed = (await listFiles(token, name)).names.includes(name);
    if (!stillListed) uploaded = false;
    record('admin', 'file benar-benar hilang dari bucket', stillListed ? 'FAIL' : 'PASS',
      stillListed ? 'masih ada di daftar' : 'tidak ada di daftar');
  } finally {
    // Bersihkan file uji jika langkah hapus di atas gagal
    if (uploaded) await call('DELETE', `/storage/v1/object/${BUCKET}`, { token, body: { prefixes: [name] } });
  }
}

async function main() {
  console.log(`Target: ${BASE}`);
  const target = await loadTarget();

  // Baca publik harus tetap berjalan
  const anonRead = await call('GET', '/rest/v1/certifications?select=id&limit=1');
  record('anon', 'SELECT certifications (baca publik)', anonRead.ok ? 'PASS' : 'FAIL', `HTTP ${anonRead.status}`);

  await attackTable('anon', null, target);
  await attackStorage('anon', null, target);

  const token = await signIn(EMAIL, PASSWORD, 'akun uji non-admin');
  const { rpc, admin } = await isAdmin(token);
  if (admin) {
    console.error('Akun uji adalah ADMIN. Gunakan akun non-admin; tes dihentikan tanpa mengubah apa pun.');
    process.exit(2);
  }
  record('non-admin', 'RPC is_certifications_admin()', rpc.ok && rpc.data === false ? 'PASS' : 'FAIL',
    `HTTP ${rpc.status} → ${short(rpc.data)}`);

  const userRead = await call('GET', '/rest/v1/certifications?select=id&limit=1', { token });
  record('non-admin', 'SELECT certifications (baca publik)', userRead.ok ? 'PASS' : 'FAIL', `HTTP ${userRead.status}`);

  await attackTable('non-admin', token, target);
  await attackStorage('non-admin', token, target);
  await verifyTargetIntact(target);

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD, 'akun admin');
    if ((await isAdmin(adminToken)).admin) {
      await checkAdminStorage(adminToken);
    } else {
      record('admin', 'RPC is_certifications_admin()', 'FAIL', 'ADMIN_EMAIL tidak dikenali sebagai admin; cek UID di migrasi');
    }
  } else {
    record('admin', 'upload/daftar/ganti/hapus file', 'SKIP', 'isi ADMIN_EMAIL & ADMIN_PASSWORD untuk menguji');
  }

  console.table(results);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n${results.length - failed - skipped} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Tes gagal dijalankan:', err);
  process.exit(2);
});
