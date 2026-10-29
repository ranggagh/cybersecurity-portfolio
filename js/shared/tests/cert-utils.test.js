// Tes fungsi validasi sertifikat. Jalankan dari root proyek:  node --test js/shared/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const CertUtils = require('../cert-utils.js');

const MB = 1024 * 1024;
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF_HEAD = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const HTML_HEAD = new TextEncoder().encode('<html><script>');

const file = (name, type, size) => ({ name, type, size });

test('tipe file: PNG, JPEG, PDF diterima', () => {
  assert.deepEqual(CertUtils.validateCertificateFile(file('a.png', 'image/png', 1000)), { ok: true, mime: 'image/png', ext: 'png' });
  assert.equal(CertUtils.validateCertificateFile(file('a.jpg', 'image/jpeg', 1000)).ok, true);
  assert.equal(CertUtils.validateCertificateFile(file('a.JPEG', 'image/jpeg', 1000)).ok, true);
  assert.equal(CertUtils.validateCertificateFile(file('Sertifikat Final.pdf', 'application/pdf', 1000)).ok, true);
});

test('tipe file: tipe lain ditolak', () => {
  for (const [name, type] of [
    ['a.svg', 'image/svg+xml'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'image/webp'],
    ['a.html', 'text/html'],
    ['a.exe', 'application/octet-stream'],
    ['a.png', ''],
    ['a.pdf', undefined]
  ]) {
    const res = CertUtils.validateCertificateFile(file(name, type, 1000));
    assert.equal(res.ok, false, `${name} (${type}) harus ditolak`);
    assert.match(res.error, /Tipe file tidak didukung/);
  }
});

test('tipe file: ekstensi harus cocok dengan MIME', () => {
  for (const [name, type] of [
    ['a.html', 'image/png'],
    ['a.pdf', 'image/png'],
    ['a.png', 'application/pdf'],
    ['a.png.html', 'image/png'],
    ['png', 'image/png'],
    ['.png', 'image/png']
  ]) {
    assert.equal(CertUtils.validateCertificateFile(file(name, type, 1000)).ok, false, `${name} (${type}) harus ditolak`);
  }
});

test('ukuran file: batas 5 MB', () => {
  assert.equal(CertUtils.validateCertificateFile(file('a.pdf', 'application/pdf', 5 * MB)).ok, true);
  assert.equal(CertUtils.validateCertificateFile(file('a.pdf', 'application/pdf', 1)).ok, true);

  const tooBig = CertUtils.validateCertificateFile(file('a.pdf', 'application/pdf', 5 * MB + 1));
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /melebihi batas 5 MB/);

  for (const size of [0, -1, NaN, undefined, 'besar']) {
    assert.equal(CertUtils.validateCertificateFile(file('a.pdf', 'application/pdf', size)).ok, false, `size=${size}`);
  }
  assert.equal(CertUtils.validateCertificateFile(null).ok, false);
});

test('isi file: magic bytes harus sesuai tipe yang diklaim', () => {
  assert.equal(CertUtils.detectFileType(PNG_HEAD), 'image/png');
  assert.equal(CertUtils.detectFileType(JPEG_HEAD), 'image/jpeg');
  assert.equal(CertUtils.detectFileType(PDF_HEAD), 'application/pdf');
  assert.equal(CertUtils.detectFileType(HTML_HEAD), null);
  assert.equal(CertUtils.detectFileType(new Uint8Array(0)), null);
  assert.equal(CertUtils.detectFileType(null), null);

  assert.equal(CertUtils.validateCertificateFileContent(file('a.png', 'image/png', 100), PNG_HEAD).ok, true);
  assert.equal(CertUtils.validateCertificateFileContent(file('a.pdf', 'application/pdf', 100), PDF_HEAD).ok, true);

  // HTML yang diganti nama menjadi .png / .pdf
  const fakePng = CertUtils.validateCertificateFileContent(file('a.png', 'image/png', 100), HTML_HEAD);
  assert.equal(fakePng.ok, false);
  assert.match(fakePng.error, /Isi file tidak sesuai/);
  assert.equal(CertUtils.validateCertificateFileContent(file('a.pdf', 'application/pdf', 100), PNG_HEAD).ok, false);

  // Batas ukuran tetap diperiksa lebih dulu
  assert.equal(CertUtils.validateCertificateFileContent(file('a.png', 'image/png', 6 * MB), PNG_HEAD).ok, false);
});

test('skema URL: hanya https yang diterima', () => {
  for (const url of [
    'https://www.credly.com/badges/abc-123',
    'https://example.com',
    'HTTPS://Example.com/path?x=1#y',
    '  https://example.com/a  '
  ]) {
    assert.equal(CertUtils.isHttpsUrl(url), true, url);
  }

  for (const url of [
    'http://example.com',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    '//example.com',
    '/relative/path',
    'example.com',
    'https:example.com',
    'https:/example.com',
    'https:///example.com',
    'https://',
    'https://user:pass@example.com',
    'https://exa mple.com',
    'https://example.com/a\tb',
    '',
    null,
    undefined,
    42,
    'https://example.com/' + 'a'.repeat(2048)
  ]) {
    assert.equal(CertUtils.isHttpsUrl(url), false, String(url));
    assert.equal(CertUtils.safeHttpsHref(url), null, String(url));
  }
});

test('safeHttpsHref menormalkan URL https', () => {
  assert.equal(CertUtils.safeHttpsHref('HTTPS://Example.com'), 'https://example.com/');
  assert.equal(CertUtils.safeHttpsHref(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
});

test('file_path: hanya nama file aman di bucket', () => {
  assert.equal(CertUtils.isSafeFilePath('3f2a9c1e-1b2c-4d5e-8f90-123456789abc.pdf'), true);
  assert.equal(CertUtils.isSafeFilePath('cert_01.png'), true);
  for (const path of ['../secret.pdf', 'folder/a.pdf', 'a.html', 'a.pdf.html', 'a b.pdf', '.pdf', '', null, 'a.PDF']) {
    assert.equal(CertUtils.isSafeFilePath(path), false, String(path));
  }
});

test('validasi form: data valid dinormalkan ke kolom tabel', () => {
  const res = CertUtils.validateCertificateInput({
    title: '  CompTIA Security+  ',
    issuer: 'CompTIA',
    issuedDate: '2025-03-14',
    credentialId: '  ',
    credentialUrl: 'https://www.credly.com/badges/x',
    sortOrder: '2'
  });
  assert.deepEqual(res, {
    ok: true,
    value: {
      title: 'CompTIA Security+',
      issuer: 'CompTIA',
      issued_date: '2025-03-14',
      credential_id: null,
      credential_url: 'https://www.credly.com/badges/x',
      sort_order: 2
    }
  });

  const minimal = CertUtils.validateCertificateInput({ title: 'A', issuer: 'B', issuedDate: '2024-02-29' });
  assert.equal(minimal.ok, true);
  assert.equal(minimal.value.sort_order, 0);
  assert.equal(minimal.value.credential_url, null);
});

test('validasi form: field wajib, tanggal, URL, dan urutan', () => {
  const res = CertUtils.validateCertificateInput({
    title: '',
    issuer: ' ',
    issuedDate: '2025-02-30',
    credentialUrl: 'http://insecure.example.com',
    sortOrder: '1.5'
  });
  assert.equal(res.ok, false);
  assert.deepEqual(Object.keys(res.errors).sort(), ['credentialUrl', 'issuedDate', 'issuer', 'sortOrder', 'title']);

  assert.equal(CertUtils.validateCertificateInput({ title: 'x'.repeat(201), issuer: 'B', issuedDate: '2025-01-01' }).ok, false);
  assert.equal(CertUtils.validateCertificateInput({ title: 'A', issuer: 'B', issuedDate: '14/03/2025' }).ok, false);
  assert.equal(CertUtils.validateCertificateInput({ title: 'A', issuer: 'B', issuedDate: '2025-01-01', sortOrder: '999999' }).ok, false);
  assert.equal(CertUtils.validateCertificateInput({ title: 'A', issuer: 'B', issuedDate: '2025-01-01', credentialUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(CertUtils.validateCertificateInput(null).ok, false);
});

test('format tanggal tidak bergeser zona waktu', () => {
  assert.equal(CertUtils.formatIssuedDate('2025-01-01', 'en-US'), 'January 2025');
  assert.equal(CertUtils.formatIssuedDate('2024-12-31', 'en-US'), 'December 2024');
  assert.equal(CertUtils.formatIssuedDate('bukan-tanggal'), '');
  assert.equal(CertUtils.formatIssuedDate(null), '');
});
