/**
 * Certification Utilities (fungsi murni, tanpa DOM/Supabase)
 * Dipakai halaman utama (render kartu) dan halaman admin (validasi form & file).
 *
 * Browser: <script src="js/shared/cert-utils.js"></script>  → window.CertUtils
 * Node:    const CertUtils = require('./cert-utils.js');    → tes di js/shared/tests/
 *
 * Validasi di sini hanya untuk kenyamanan pengguna; batas sebenarnya ditegakkan oleh
 * CHECK constraint tabel, pengaturan bucket, dan RLS (supabase/migrations/03_...).
 */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CertUtils = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  // Tipe yang diizinkan bucket "certificates" beserta ekstensi yang cocok
  const ALLOWED_FILE_TYPES = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'application/pdf': ['pdf']
  };

  const TEXT_LIMITS = { title: 200, issuer: 200, credentialId: 200, credentialUrl: 2048 };
  const SORT_ORDER_LIMIT = 100000;

  // Sama dengan CHECK constraint file_path di migrasi
  const SAFE_FILE_PATH = /^[A-Za-z0-9_-]{1,100}\.(png|jpg|jpeg|pdf)$/;

  function getExtension(name) {
    if (typeof name !== 'string') return '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  /**
   * Validasi metadata file (dari <input type="file">) sebelum dibaca/diunggah.
   * @param {{name: string, type: string, size: number}} file
   * @returns {{ok: true, mime: string, ext: string} | {ok: false, error: string}}
   */
  function validateCertificateFile(file) {
    if (!file || typeof file !== 'object') {
      return { ok: false, error: 'File tidak ditemukan.' };
    }

    const size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, error: 'File kosong.' };
    }
    if (size > MAX_FILE_BYTES) {
      return { ok: false, error: `Ukuran file ${formatBytes(size)} melebihi batas 5 MB.` };
    }

    const mime = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    const allowedExts = ALLOWED_FILE_TYPES[mime];
    if (!allowedExts) {
      return { ok: false, error: 'Tipe file tidak didukung. Gunakan PNG, JPEG, atau PDF.' };
    }

    const ext = getExtension(file.name);
    if (!allowedExts.includes(ext)) {
      return { ok: false, error: 'Ekstensi file tidak cocok dengan tipenya. Gunakan .png, .jpg/.jpeg, atau .pdf.' };
    }

    return { ok: true, mime, ext };
  }

  /**
   * Kenali tipe file dari byte awalnya (MIME dari browser hanya ditebak dari ekstensi).
   * @param {Uint8Array} bytes  minimal 8 byte pertama file
   * @returns {string|null} MIME yang dikenali, atau null
   */
  function detectFileType(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return null;
    const startsWith = (sig) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // "%PDF-"
    return null;
  }

  /**
   * Validasi lengkap: metadata + isi file harus sesuai tipe yang diklaim.
   * @returns {{ok: true, mime: string, ext: string} | {ok: false, error: string}}
   */
  function validateCertificateFileContent(file, headBytes) {
    const meta = validateCertificateFile(file);
    if (!meta.ok) return meta;

    const detected = detectFileType(headBytes);
    if (detected !== meta.mime) {
      return { ok: false, error: 'Isi file tidak sesuai dengan tipenya (bukan PNG/JPEG/PDF asli).' };
    }
    return meta;
  }

  /**
   * True hanya untuk URL absolut berskema https dengan host.
   * Tolak javascript:, data:, http:, URL relatif, dan kredensial di URL.
   */
  function isHttpsUrl(value) {
    if (typeof value !== 'string') return false;
    const raw = value.trim();
    if (!raw || raw.length > TEXT_LIMITS.credentialUrl || /\s/.test(raw)) return false;
    // Skema harus tertulis eksplisit (parser URL menormalkan "HTTPS:", "https:/host", dst.)
    if (!/^https:\/\/[^/?#]/i.test(raw)) return false;

    let url;
    try {
      url = new URL(raw);
    } catch (e) {
      return false;
    }
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  }

  /**
   * URL aman untuk dipakai sebagai href, atau null.
   * Hasilnya bentuk yang dinormalkan parser URL (cocok dengan CHECK constraint migrasi).
   */
  function safeHttpsHref(value) {
    if (!isHttpsUrl(value)) return null;
    return new URL(value.trim()).href;
  }

  function isSafeFilePath(path) {
    return typeof path === 'string' && SAFE_FILE_PATH.test(path);
  }

  function isValidIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  /**
   * Validasi & normalisasi isi form sertifikat.
   * @param {{title, issuer, issuedDate, credentialId, credentialUrl, sortOrder}} input
   * @returns {{ok: true, value: object} | {ok: false, errors: Object<string, string>}}
   *          value memakai nama kolom tabel (title, issuer, issued_date, ...).
   */
  function validateCertificateInput(input) {
    const src = input || {};
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const errors = {};

    const title = text(src.title);
    if (!title) errors.title = 'Judul wajib diisi.';
    else if (title.length > TEXT_LIMITS.title) errors.title = `Judul maksimal ${TEXT_LIMITS.title} karakter.`;

    const issuer = text(src.issuer);
    if (!issuer) errors.issuer = 'Penerbit wajib diisi.';
    else if (issuer.length > TEXT_LIMITS.issuer) errors.issuer = `Penerbit maksimal ${TEXT_LIMITS.issuer} karakter.`;

    const issuedDate = text(src.issuedDate);
    if (!isValidIsoDate(issuedDate)) errors.issuedDate = 'Tanggal terbit wajib diisi dengan tanggal yang valid.';

    const credentialId = text(src.credentialId);
    if (credentialId.length > TEXT_LIMITS.credentialId) {
      errors.credentialId = `ID kredensial maksimal ${TEXT_LIMITS.credentialId} karakter.`;
    }

    const credentialUrl = text(src.credentialUrl);
    if (credentialUrl && !isHttpsUrl(credentialUrl)) {
      errors.credentialUrl = 'URL verifikasi harus diawali https:// dan berupa alamat yang valid.';
    }

    const sortRaw = text(String(src.sortOrder == null ? '' : src.sortOrder));
    const sortOrder = sortRaw === '' ? 0 : Number(sortRaw);
    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > SORT_ORDER_LIMIT) {
      errors.sortOrder = `Urutan harus bilangan bulat antara -${SORT_ORDER_LIMIT} dan ${SORT_ORDER_LIMIT}.`;
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors };

    return {
      ok: true,
      value: {
        title,
        issuer,
        issued_date: issuedDate,
        credential_id: credentialId || null,
        credential_url: credentialUrl ? safeHttpsHref(credentialUrl) : null,
        sort_order: sortOrder
      }
    };
  }

  // "2025-03-14" → "Maret 2025" (tanpa geser zona waktu)
  function formatIssuedDate(value, locale) {
    if (!isValidIsoDate(value)) return '';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale || 'id-ID', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return {
    MAX_FILE_BYTES,
    ALLOWED_FILE_TYPES,
    validateCertificateFile,
    validateCertificateFileContent,
    detectFileType,
    isHttpsUrl,
    safeHttpsHref,
    isSafeFilePath,
    isValidIsoDate,
    validateCertificateInput,
    formatIssuedDate,
    formatBytes
  };
});
