/**
 * Notifikasi singkat (toast) di pojok layar
 * Pakai: window.CyberToast.show('Pesan', { tone: 'accent' | 'neutral' })
 *
 * - Satu wadah live region (role="status", aria-live="polite") dibuat sejak awal agar
 *   pembaca layar mengumumkan pesan yang ditambahkan belakangan.
 * - Pesan diisi lewat textContent. Jangan kirim data akun (email, UID) ke sini.
 * - Hilang otomatis setelah ~4 detik (dijeda saat disorot/difokus), bisa ditutup, tidak memblokir halaman.
 */

(function () {
  'use strict';

  const DURATION_MS = 4000;
  let region = null;

  function ensureRegion() {
    if (region && document.body.contains(region)) return region;
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
    return region;
  }

  function dismiss(toast) {
    if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
    clearTimeout(toast._timer);
    toast.classList.add('is-leaving');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Cadangan jika transisi tidak berjalan (reduced motion, tab tidak aktif)
    setTimeout(() => toast.remove(), 400);
  }

  function startTimer(toast) {
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => dismiss(toast), DURATION_MS);
  }

  function show(message, options) {
    const tone = options && options.tone === 'accent' ? 'accent' : 'neutral';
    const container = ensureRegion();

    // Satu toast pada satu waktu: klik berulang tidak menumpuk pesan
    container.querySelectorAll('.toast').forEach((old) => {
      clearTimeout(old._timer);
      old.remove();
    });

    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;

    const text = document.createElement('p');
    text.className = 'toast-message';
    text.textContent = String(message);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Tutup notifikasi');
    close.textContent = '✕';
    close.addEventListener('click', () => dismiss(toast));

    toast.append(text, close);
    toast.addEventListener('mouseenter', () => clearTimeout(toast._timer));
    toast.addEventListener('mouseleave', () => startTimer(toast));
    toast.addEventListener('focusin', () => clearTimeout(toast._timer));
    toast.addEventListener('focusout', () => startTimer(toast));

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    startTimer(toast);
    return toast;
  }

  window.CyberToast = { show };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureRegion);
  } else {
    ensureRegion();
  }
})();
