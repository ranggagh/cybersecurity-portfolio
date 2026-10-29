/**
 * Certifications Data Access (Supabase)
 * Dipakai halaman utama (baca) dan admin/certifications/ (baca + tulis).
 * Butuh: supabase-client.js (window.getSupabaseClient) dan cert-utils.js (window.CertUtils).
 *
 * Semua penulisan hanya berhasil untuk akun admin karena RLS (lihat supabase/migrations/03_...).
 * UPDATE/DELETE yang ditolak RLS tidak menghasilkan error dari Supabase, hanya 0 baris,
 * jadi fungsi tulis di sini meminta baris hasil (.select()) dan menganggap 0 baris sebagai ditolak.
 */

(function () {
  'use strict';

  const TABLE = 'certifications';
  const BUCKET = 'certificates';
  const COLUMNS = 'id, title, issuer, issued_date, credential_id, credential_url, file_path, sort_order, created_at';

  function getClient() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) throw storeError('Supabase belum terhubung. Periksa konfigurasi anon key.');
    return client;
  }

  function storeError(message, cause) {
    const err = new Error(message);
    if (cause) err.cause = cause;
    return err;
  }

  // Terjemahkan error PostgREST / Storage menjadi pesan yang jelas
  function friendlyError(error, fallback) {
    const code = String((error && (error.code || error.statusCode)) || '');
    const msg = ((error && error.message) || '').toLowerCase();

    if (code === '42501' || code === '403' || msg.includes('row-level security') || msg.includes('permission denied')) {
      return 'Ditolak oleh kebijakan keamanan (RLS). Hanya akun admin yang boleh mengubah sertifikat.';
    }
    if (code === '23514' || msg.includes('check constraint')) {
      return 'Data ditolak database karena tidak memenuhi aturan (cek panjang teks, tanggal, dan URL https).';
    }
    if (code === '413' || msg.includes('exceeded the maximum allowed size') || msg.includes('payload too large')) {
      return 'File melebihi batas 5 MB.';
    }
    if (msg.includes('mime type') || code === '415') {
      return 'Tipe file ditolak server. Gunakan PNG, JPEG, atau PDF.';
    }
    if (code === '42P01' || code === 'PGRST205' || msg.includes('does not exist') || msg.includes('could not find the table')) {
      return 'Tabel certifications belum ada. Jalankan migrasi 03 terlebih dahulu.';
    }
    if (msg.includes('failed to fetch') || msg.includes('network')) {
      return 'Tidak dapat terhubung ke Supabase. Periksa koneksi internet.';
    }
    return fallback || (error && error.message) || 'Terjadi kesalahan. Silakan coba lagi.';
  }

  async function listCertifications() {
    const { data, error } = await getClient()
      .from(TABLE)
      .select(COLUMNS)
      .order('sort_order', { ascending: true })
      .order('issued_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw storeError(friendlyError(error, 'Gagal memuat sertifikat.'), error);
    return Array.isArray(data) ? data : [];
  }

  // URL publik file di bucket; null jika path tidak sesuai format yang diizinkan
  function getFileUrl(filePath) {
    if (!window.CertUtils.isSafeFilePath(filePath)) return null;
    const { data } = getClient().storage.from(BUCKET).getPublicUrl(filePath);
    return window.CertUtils.safeHttpsHref(data && data.publicUrl);
  }

  // Pengecekan kenyamanan untuk UI admin. Keamanan sebenarnya ada di RLS.
  async function isAdmin() {
    const { data, error } = await getClient().rpc('is_certifications_admin');
    if (error) throw storeError(friendlyError(error, 'Gagal memverifikasi hak admin.'), error);
    return data === true;
  }

  async function createCertification(values) {
    const { data, error } = await getClient().from(TABLE).insert(values).select(COLUMNS);
    if (error) throw storeError(friendlyError(error, 'Gagal menyimpan sertifikat.'), error);
    if (!data || data.length === 0) throw storeError(friendlyError({ code: '42501' }));
    return data[0];
  }

  async function updateCertification(id, values) {
    const { data, error } = await getClient().from(TABLE).update(values).eq('id', id).select(COLUMNS);
    if (error) throw storeError(friendlyError(error, 'Gagal memperbarui sertifikat.'), error);
    if (!data || data.length === 0) {
      throw storeError('Tidak ada data yang diperbarui. Sertifikat mungkin sudah dihapus, atau perubahan ditolak RLS.');
    }
    return data[0];
  }

  async function deleteCertification(id) {
    const { data, error } = await getClient().from(TABLE).delete().eq('id', id).select('id, file_path');
    if (error) throw storeError(friendlyError(error, 'Gagal menghapus sertifikat.'), error);
    if (!data || data.length === 0) {
      throw storeError('Tidak ada data yang dihapus. Sertifikat mungkin sudah dihapus, atau penghapusan ditolak RLS.');
    }
    return data[0];
  }

  /**
   * Unggah file ke bucket dengan nama acak. Tidak menimpa file lain (upsert: false).
   * @param {File} file  sudah divalidasi CertUtils.validateCertificateFileContent
   * @param {{mime: string, ext: string}} checked  hasil validasi
   * @returns {Promise<string>} file_path
   */
  async function uploadFile(file, checked) {
    const path = `${crypto.randomUUID()}.${checked.ext === 'jpeg' ? 'jpg' : checked.ext}`;
    const { error } = await getClient().storage.from(BUCKET).upload(path, file, {
      contentType: checked.mime,
      cacheControl: '3600',
      upsert: false
    });
    if (error) throw storeError(friendlyError(error, 'Gagal mengunggah file.'), error);
    return path;
  }

  // Best effort: dipakai untuk membersihkan file lama/yatim; kegagalan hanya dilaporkan
  async function removeFile(filePath) {
    if (!window.CertUtils.isSafeFilePath(filePath)) return false;
    const { data, error } = await getClient().storage.from(BUCKET).remove([filePath]);
    if (error) {
      console.warn('[CertStore] Gagal menghapus file:', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  }

  window.CertStore = {
    BUCKET,
    listCertifications,
    getFileUrl,
    isAdmin,
    createCertification,
    updateCertification,
    deleteCertification,
    uploadFile,
    removeFile
  };
})();
