/**
 * Admin: Kelola Sertifikat
 * Halaman ini tidak ditautkan dari navbar. auth-guard.js memastikan ada sesi login;
 * di sini dicek apakah akun itu admin (RPC is_certifications_admin). Jika bukan, form
 * tidak dipasang. Pengecekan ini hanya kenyamanan: penolakan sebenarnya dilakukan RLS.
 *
 * Isi database dan input pengguna ditampilkan lewat textContent, bukan innerHTML.
 */

const store = window.CertStore;
const utils = window.CertUtils;

const FIELD_INPUTS = {
  title: 'cert-title',
  issuer: 'cert-issuer',
  issuedDate: 'cert-issued-date',
  credentialId: 'cert-credential-id',
  credentialUrl: 'cert-credential-url',
  sortOrder: 'cert-sort-order',
  file: 'cert-file'
};

let certs = [];
let editing = null; // sertifikat yang sedang diubah, atau null saat menambah
let busy = false;

const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $('admin-status-text').textContent = `STATUS // ${text}`;
  $('admin-terminal-status').textContent = text;
}

/* --------------------------------------------------------------------------
   Akses
   -------------------------------------------------------------------------- */
async function init() {
  const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
  if (!client || !store || !utils) {
    showDenied('Supabase atau modul sertifikat tidak termuat.');
    return;
  }

  // Tanpa sesi, auth-guard.js sudah mengalihkan ke halaman utama
  const { data: { session } } = await client.auth.getSession();
  if (!session) return;

  let admin = false;
  let detail = '';
  try {
    admin = await store.isAdmin();
  } catch (err) {
    detail = err.message;
  }

  if (!admin) {
    showDenied(detail);
    return;
  }

  mountPanel();
  setStatus('ADMIN');
  await refreshList();
}

function showDenied(detail) {
  $('admin-loading').hidden = true;
  $('admin-denied').hidden = false;
  if (detail) {
    $('admin-denied-detail').textContent = detail;
    $('admin-denied-detail').hidden = false;
  }
  setStatus('DENIED');
}

function mountPanel() {
  const panel = $('admin-panel-template').content.cloneNode(true);
  $('admin-loading').remove();
  $('admin-root').append(panel);

  $('cert-form').addEventListener('submit', handleSubmit);
  $('btn-cancel-edit').addEventListener('click', () => {
    resetForm();
    hideAlert();
  });
  $('cert-file').addEventListener('change', handleFileChange);
  $('admin-cert-list').addEventListener('click', handleListClick);
}

/* --------------------------------------------------------------------------
   Pesan
   -------------------------------------------------------------------------- */
function showAlert(message, type) {
  const alert = $('admin-alert');
  alert.className = `auth-alert alert-${type}`;
  alert.textContent = message;
  alert.hidden = false;
  if (type === 'error') alert.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideAlert() {
  $('admin-alert').hidden = true;
}

function setFieldError(field, message) {
  const input = $(FIELD_INPUTS[field]);
  const error = $(`err-${field}`);
  if (!input || !error) return;
  error.textContent = message || '';
  error.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function clearFieldErrors() {
  Object.keys(FIELD_INPUTS).forEach((field) => setFieldError(field, ''));
}

/* --------------------------------------------------------------------------
   Daftar
   -------------------------------------------------------------------------- */
async function refreshList() {
  const list = $('admin-cert-list');
  try {
    certs = await store.listCertifications();
  } catch (err) {
    certs = [];
    showAlert(err.message, 'error');
  }

  $('cert-count').textContent = `${certs.length} item`;

  if (certs.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'admin-cert-empty';
    empty.textContent = 'Belum ada sertifikat. Tambahkan lewat form di atas.';
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...certs.map(renderRow));
}

function renderRow(cert) {
  const item = document.createElement('li');
  item.className = 'admin-cert-item';
  if (editing && editing.id === cert.id) item.classList.add('is-editing');

  const info = document.createElement('div');
  info.className = 'admin-cert-info';

  const title = document.createElement('span');
  title.className = 'admin-cert-title';
  title.textContent = cert.title;

  const meta = document.createElement('span');
  meta.className = 'admin-cert-meta';
  meta.textContent = [
    cert.issuer,
    utils.formatIssuedDate(cert.issued_date),
    `urutan ${cert.sort_order}`
  ].filter(Boolean).join(' · ');

  const tags = document.createElement('span');
  tags.className = 'admin-cert-tags';
  if (cert.credential_id) tags.append(tag(`ID: ${cert.credential_id}`));
  if (cert.file_path) tags.append(tag('File'));
  if (cert.credential_url) tags.append(tag('Link verifikasi'));

  info.append(title, meta);
  if (tags.childElementCount > 0) info.append(tags);

  const actions = document.createElement('div');
  actions.className = 'admin-cert-actions';
  actions.append(
    actionButton('Ubah', 'edit', cert.id, 'btn btn-outline btn-sm'),
    actionButton('Hapus', 'delete', cert.id, 'btn btn-outline btn-sm btn-danger')
  );

  item.append(info, actions);
  return item;
}

function tag(text) {
  const span = document.createElement('span');
  span.className = 'admin-tag';
  span.textContent = text;
  return span;
}

function actionButton(label, action, id, className) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.dataset.action = action;
  btn.dataset.id = id;
  return btn;
}

function handleListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn || busy) return;
  const cert = certs.find((c) => c.id === btn.dataset.id);
  if (!cert) return;

  if (btn.dataset.action === 'edit') startEdit(cert);
  if (btn.dataset.action === 'delete') handleDelete(cert);
}

/* --------------------------------------------------------------------------
   Form
   -------------------------------------------------------------------------- */
function startEdit(cert) {
  editing = cert;
  clearFieldErrors();
  hideAlert();

  $('cert-form-title').textContent = 'Ubah Sertifikat';
  $('cert-title').value = cert.title;
  $('cert-issuer').value = cert.issuer;
  $('cert-issued-date').value = cert.issued_date;
  $('cert-credential-id').value = cert.credential_id || '';
  $('cert-credential-url').value = cert.credential_url || '';
  $('cert-sort-order').value = String(cert.sort_order);
  $('cert-file').value = '';
  $('cert-remove-file').checked = false;

  const fileUrl = cert.file_path ? store.getFileUrl(cert.file_path) : null;
  $('current-file').hidden = !fileUrl;
  if (fileUrl) $('current-file-link').href = fileUrl;
  else $('current-file-link').removeAttribute('href');

  $('btn-save').firstElementChild.textContent = 'Simpan Perubahan';
  $('btn-cancel-edit').hidden = false;

  document.querySelectorAll('.admin-cert-item').forEach((row) => row.classList.remove('is-editing'));
  const row = $('admin-cert-list').querySelector(`button[data-id="${CSS.escape(cert.id)}"]`);
  if (row) row.closest('.admin-cert-item').classList.add('is-editing');

  $('cert-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('cert-title').focus({ preventScroll: true });
}

function resetForm() {
  editing = null;
  $('cert-form').reset();
  $('cert-sort-order').value = '0';
  clearFieldErrors();
  $('cert-form-title').textContent = 'Tambah Sertifikat';
  $('btn-save').firstElementChild.textContent = 'Simpan Sertifikat';
  $('btn-cancel-edit').hidden = true;
  $('current-file').hidden = true;
  document.querySelectorAll('.admin-cert-item.is-editing').forEach((row) => row.classList.remove('is-editing'));
}

// Cek tipe (MIME + ekstensi + isi) dan ukuran sebelum diunggah
async function checkFile(file) {
  const meta = utils.validateCertificateFile(file);
  if (!meta.ok) return meta;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return utils.validateCertificateFileContent(file, head);
  } catch (err) {
    return { ok: false, error: 'File tidak dapat dibaca.' };
  }
}

async function handleFileChange() {
  const file = $('cert-file').files[0];
  if (!file) {
    setFieldError('file', '');
    return;
  }
  const checked = await checkFile(file);
  setFieldError('file', checked.ok ? '' : checked.error);
}

function readForm() {
  return {
    title: $('cert-title').value,
    issuer: $('cert-issuer').value,
    issuedDate: $('cert-issued-date').value,
    credentialId: $('cert-credential-id').value,
    credentialUrl: $('cert-credential-url').value,
    sortOrder: $('cert-sort-order').value
  };
}

function setBusy(value, label) {
  busy = value;
  const btn = $('btn-save');
  btn.disabled = value;
  btn.classList.toggle('is-loading', value);
  $('btn-cancel-edit').disabled = value;
  btn.firstElementChild.textContent = value ? label : (editing ? 'Simpan Perubahan' : 'Simpan Sertifikat');
  document.querySelectorAll('#admin-cert-list button').forEach((b) => { b.disabled = value; });
}

async function handleSubmit(e) {
  e.preventDefault();
  if (busy) return;

  clearFieldErrors();
  hideAlert();

  const result = utils.validateCertificateInput(readForm());
  const file = $('cert-file').files[0] || null;
  const checked = file ? await checkFile(file) : null;

  const errors = result.ok ? {} : { ...result.errors };
  if (checked && !checked.ok) errors.file = checked.error;
  if (Object.keys(errors).length > 0) {
    Object.entries(errors).forEach(([field, msg]) => setFieldError(field, msg));
    showAlert('Periksa kembali isian yang ditandai.', 'error');
    const firstInvalid = $(FIELD_INPUTS[Object.keys(errors)[0]]);
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const target = editing;
  const values = result.value;
  const oldPath = target ? target.file_path : null;
  let uploadedPath = null;

  setBusy(true, file ? 'Mengunggah...' : 'Menyimpan...');
  try {
    if (file) {
      uploadedPath = await store.uploadFile(file, checked);
      values.file_path = uploadedPath;
      setBusy(true, 'Menyimpan...');
    } else if (target && $('cert-remove-file').checked) {
      values.file_path = null;
    }

    if (target) {
      await store.updateCertification(target.id, values);
    } else {
      await store.createCertification(values);
    }
    uploadedPath = null; // sudah tercatat di tabel

    // File lama tidak dipakai lagi setelah diganti / dihapus
    let fileNote = '';
    if (target && oldPath && 'file_path' in values && values.file_path !== oldPath) {
      const removed = await store.removeFile(oldPath);
      if (!removed) fileNote = ' File lama tidak terhapus dari Storage; hapus manual jika perlu.';
    }

    resetForm();
    showAlert(`${target ? 'Perubahan disimpan' : 'Sertifikat ditambahkan'}: "${values.title}".${fileNote}`, 'success');
  } catch (err) {
    // Jangan tinggalkan file yatim jika penyimpanan baris gagal
    if (uploadedPath) await store.removeFile(uploadedPath);
    showAlert(err.message, 'error');
  } finally {
    setBusy(false);
  }

  await refreshList();
}

async function handleDelete(cert) {
  const question = `Hapus sertifikat "${cert.title}"?\n\nTindakan ini tidak bisa dibatalkan${cert.file_path ? ' dan file sertifikat ikut dihapus' : ''}.`;
  if (!confirm(question)) return;

  hideAlert();
  setBusy(true, 'Menghapus...');
  try {
    const deleted = await store.deleteCertification(cert.id);
    let fileNote = '';
    if (deleted.file_path) {
      const removed = await store.removeFile(deleted.file_path);
      if (!removed) fileNote = ' File di Storage tidak terhapus; hapus manual jika perlu.';
    }
    if (editing && editing.id === cert.id) resetForm();
    showAlert(`Sertifikat "${cert.title}" dihapus.${fileNote}`, 'success');
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    setBusy(false);
  }

  await refreshList();
}

init().catch((err) => {
  console.error('[AdminCerts] Init gagal:', err);
  showDenied('Terjadi kesalahan saat memuat halaman.');
});
