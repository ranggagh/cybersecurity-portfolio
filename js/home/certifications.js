/**
 * Certifications & Courses (halaman utama)
 * Data dibaca dari tabel Supabase "certifications" (lihat js/shared/certifications-store.js).
 * Isi database tidak tepercaya: semua teks lewat textContent, link hanya https.
 * Jika kosong / gagal dimuat, tampilkan pesan netral, bukan kartu rusak.
 */

(function () {
  'use strict';

  const EMPTY_MESSAGE = 'Sertifikat akan segera ditambahkan';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function externalLink(href, className, label) {
    const link = el('a', className, label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function renderMessage(list, message) {
    list.replaceChildren(el('p', 'cert-empty', message));
  }

  function renderCard(cert) {
    const item = el('div', 'cert-slot-item');
    item.append(el('div', 'slot-indicator', '✓'));

    const details = el('div', 'slot-details');
    details.append(el('span', 'slot-title', cert.title));
    details.append(el('span', 'slot-issuer', cert.issuer));

    const meta = [window.CertUtils.formatIssuedDate(cert.issued_date)];
    if (cert.credential_id) meta.push(`ID: ${cert.credential_id}`);
    const metaText = meta.filter(Boolean).join(' · ');
    if (metaText) details.append(el('span', 'slot-meta', metaText));

    const actions = el('div', 'slot-actions');
    const fileUrl = cert.file_path ? window.CertStore.getFileUrl(cert.file_path) : null;
    if (fileUrl) actions.append(externalLink(fileUrl, 'slot-action', 'Lihat sertifikat'));
    const verifyUrl = window.CertUtils.safeHttpsHref(cert.credential_url);
    if (verifyUrl) actions.append(externalLink(verifyUrl, 'slot-action slot-action-verify', 'Verifikasi kredensial'));
    if (actions.childElementCount > 0) details.append(actions);

    item.append(details);
    return item;
  }

  function isRenderable(cert) {
    return cert && typeof cert.title === 'string' && cert.title.trim() !== ''
      && typeof cert.issuer === 'string' && cert.issuer.trim() !== '';
  }

  async function loadCertifications() {
    const list = document.getElementById('cert-list');
    if (!list) return;

    try {
      if (!window.CertStore || !window.CertUtils) throw new Error('Modul sertifikat tidak termuat.');
      const certs = (await window.CertStore.listCertifications()).filter(isRenderable);

      if (certs.length === 0) {
        renderMessage(list, EMPTY_MESSAGE);
      } else {
        list.replaceChildren(...certs.map(renderCard));
      }
    } catch (err) {
      console.warn('[Certifications] Gagal memuat:', err.message);
      renderMessage(list, EMPTY_MESSAGE);
    } finally {
      list.removeAttribute('aria-busy');
      updateScrollBox();
    }
  }

  /* --------------------------------------------------------------------------
     Kotak gulir: tinggi maksimum = tiga kartu pertama (diukur, bukan angka tetap)
     -------------------------------------------------------------------------- */
  const VISIBLE_CARDS = 3;

  function scrollParts() {
    return {
      frame: document.getElementById('cert-scroll-frame'),
      box: document.getElementById('cert-scroll'),
      list: document.getElementById('cert-list'),
      hint: document.getElementById('cert-scroll-hint')
    };
  }

  function updateScrollBox() {
    const { box, list } = scrollParts();
    if (!box || !list) return;

    const cards = list.querySelectorAll('.cert-slot-item');
    const scrollable = cards.length > VISIBLE_CARDS;
    box.classList.toggle('is-scrollable', scrollable);

    if (scrollable) {
      // Diukur setelah class diterapkan (lebar berubah karena ruang scrollbar)
      const top = cards[0].getBoundingClientRect().top;
      const bottom = cards[VISIBLE_CARDS - 1].getBoundingClientRect().bottom;
      box.style.maxHeight = `${Math.ceil(bottom - top)}px`;
      box.tabIndex = 0;
    } else {
      box.style.maxHeight = '';
      box.scrollTop = 0;
      // Tanpa isi yang bisa digulir, kotak tidak perlu jadi tab stop
      box.removeAttribute('tabindex');
    }
    updateScrollHint();
  }

  // Fade + teks petunjuk hanya saat masih ada kartu di bawah
  function updateScrollHint() {
    const { frame, box, list, hint } = scrollParts();
    if (!frame || !box || !list || !hint) return;

    const count = list.querySelectorAll('.cert-slot-item').length;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    const hasMore = count > VISIBLE_CARDS && !atEnd;

    frame.classList.toggle('has-more', hasMore);
    hint.hidden = !hasMore;
    hint.textContent = hasMore ? `${VISIBLE_CARDS} dari ${count} sertifikat - gulir untuk melihat lainnya` : '';
  }

  function initScrollBox() {
    const { box, list } = scrollParts();
    if (!box || !list) return;

    box.addEventListener('scroll', updateScrollHint, { passive: true });
    window.addEventListener('resize', updateScrollBox);
    // Menangkap perubahan lebar kotak dan font yang selesai dimuat
    // (ditunda satu frame: updateScrollBox mengubah lebar list, cegah "ResizeObserver loop")
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => requestAnimationFrame(updateScrollBox)).observe(list);
    }
  }

  /* --------------------------------------------------------------------------
     Tombol "+ Tambah sertifikat": terlihat semua pengunjung, hanya admin yang diteruskan.
     Cek dilakukan saat klik dan hanya untuk kenyamanan; keamanan tetap di RLS.
     -------------------------------------------------------------------------- */
  const ADMIN_PATH = 'admin/certifications/';
  const NOT_ADMIN_MESSAGE = 'Anda bukan Rangga (admin). Fitur ini khusus pemilik portofolio.';
  const CHECK_FAILED_MESSAGE = 'Tidak dapat memeriksa akses. Coba lagi.';

  function toast(message, tone) {
    if (window.CyberToast) window.CyberToast.show(message, { tone });
  }

  async function getAccess() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client || !window.CertStore) throw new Error('Supabase tidak termuat.');

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data || !data.session) return 'guest';
    return (await window.CertStore.isAdmin()) ? 'admin' : 'member';
  }

  async function handleAddClick(button) {
    if (button.getAttribute('aria-disabled') === 'true') return;
    const label = button.textContent;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Memeriksa akses...';

    let access = null;
    try {
      access = await getAccess();
    } catch (err) {
      console.warn('[Certifications] Cek akses gagal:', err && err.message);
    }

    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-busy');
    button.textContent = label;

    const adminUrl = new URL(ADMIN_PATH, window.location.href);
    if (access === 'admin') {
      window.location.assign(adminUrl.href);
      return;
    }
    if (access === 'member') {
      toast(NOT_ADMIN_MESSAGE, 'accent');
      return;
    }
    // Belum login: modal login dengan ?next= ke halaman admin (divalidasi auth.js)
    const loginOpened = access === 'guest' && window.CyberAuth && window.CyberAuth.openLoginFor(adminUrl.pathname);
    if (!loginOpened) toast(CHECK_FAILED_MESSAGE, 'neutral');
  }

  function initAddButton() {
    const button = document.getElementById('cert-add-btn');
    if (!button) return;
    button.addEventListener('click', () => handleAddClick(button));
    button.hidden = false;
  }

  function start() {
    initScrollBox();
    loadCertifications();
    initAddButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
