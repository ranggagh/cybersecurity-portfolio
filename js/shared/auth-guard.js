/**
 * Auth Guard untuk halaman tool
 * Pasang di <head> setiap tool:  <script src="../../js/shared/auth-guard.js"></script>
 *
 * - Body disembunyikan sampai sesi Supabase terkonfirmasi (tidak ada dashboard yang berkedip).
 * - Tanpa sesi: dialihkan ke halaman utama dengan ?next=<path tool>, lalu modal login dibuka di sana.
 * - Setelah logout: kembali ke halaman utama.
 */

(function () {
  'use strict';

  // Root situs dihitung dari lokasi file ini (js/shared/auth-guard.js)
  const ROOT_URL = new URL('../../', document.currentScript.src);
  const HOME_URL = new URL('index.html', ROOT_URL).href;

  const html = document.documentElement;
  html.classList.add('auth-pending');
  const style = document.createElement('style');
  style.textContent = 'html.auth-pending body { visibility: hidden; }';
  document.head.appendChild(style);

  function redirectHome(withNext) {
    if (!withNext) {
      window.location.replace(HOME_URL);
      return;
    }
    const next = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(`${HOME_URL}?next=${encodeURIComponent(next)}`);
  }

  async function checkSession() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) {
      redirectHome(true);
      return;
    }

    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        redirectHome(true);
        return;
      }
    } catch (err) {
      console.error('[AuthGuard] Failed to verify session:', err);
      redirectHome(true);
      return;
    }

    html.classList.remove('auth-pending');

    // Logout (atau sesi berakhir) → kembali ke halaman utama
    client.auth.onAuthStateChange((event, session) => {
      if (!session) redirectHome(false);
    });
  }

  // Dijalankan setelah script Supabase di akhir <body> selesai dimuat
  document.addEventListener('DOMContentLoaded', checkSession);
})();
