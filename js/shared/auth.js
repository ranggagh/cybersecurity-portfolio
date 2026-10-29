/**
 * Centralized Authentication & Profile Synchronization
 * Project: PortofolioRangga Cybersecurity Platform
 * Powered by Supabase Auth & PostgreSQL Profiles
 *
 * - Halaman utama: klik link ke tools/... saat belum login membuka modal login,
 *   lalu setelah berhasil diteruskan ke tool tersebut. ?next=<path> dari auth-guard.js
 *   membuka modal yang sama secara otomatis.
 * - Halaman tool: navbar menampilkan email + tombol Logout (proteksi halaman ada di auth-guard.js).
 */

(function () {
  'use strict';

  // Root situs dihitung dari lokasi file ini (js/shared/auth.js), jadi berlaku di kedalaman folder mana pun
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || window.location.href;
  const ROOT_URL = new URL('../../', SCRIPT_SRC);
  const TOOLS_URL = new URL('tools/', ROOT_URL).href;
  const HOME_URL = new URL('index.html', ROOT_URL).href;

  let currentUser = null;
  let currentProfile = null;
  let pendingNextUrl = null;
  const authStateListeners = [];

  let resolveAuthReady;
  const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });

  // Register listener for auth changes
  function onAuthStateChanged(callback) {
    if (typeof callback === 'function') {
      authStateListeners.push(callback);
      if (currentUser) {
        callback({ user: currentUser, profile: currentProfile });
      }
    }
  }

  function notifyListeners() {
    authStateListeners.forEach((cb) => {
      try {
        cb({ user: currentUser, profile: currentProfile });
      } catch (e) {
        console.error('[Auth] Error in listener:', e);
      }
    });
  }

  // Fetch public.profiles row
  async function fetchProfile(userId) {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client || !userId) return null;

    try {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, username, role, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[Auth] Error fetching profile:', error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.error('[Auth] Profile query exception:', err);
      return null;
    }
  }

  // Set user aktif, perbarui UI, lalu lengkapi profil di belakang layar
  async function setSessionUser(user) {
    currentUser = user || null;
    currentProfile = null;
    updateAuthUI();
    notifyListeners();

    if (currentUser) {
      const userId = currentUser.id;
      const profile = await fetchProfile(userId);
      if (currentUser && currentUser.id === userId) {
        currentProfile = profile;
        updateAuthUI();
        notifyListeners();
      }
    }
  }

  // Terjemahkan error Supabase menjadi pesan yang jelas untuk pengguna
  function friendlyAuthError(error) {
    const code = (error && error.code) || '';
    const msg = ((error && error.message) || '').toLowerCase();

    if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
      return 'Email atau password salah.';
    }
    if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
      return 'Email belum dikonfirmasi. Buka tautan konfirmasi di inbox Anda, lalu login.';
    }
    if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) {
      return 'Email sudah terdaftar. Silakan Sign In.';
    }
    if (code === 'weak_password' || msg.includes('password should be')) {
      return 'Password terlalu lemah. Gunakan minimal 6 karakter.';
    }
    if (code === 'email_address_invalid' || msg.includes('invalid format') || msg.includes('unable to validate email')) {
      return 'Format email tidak valid.';
    }
    if (code.startsWith('over_') || msg.includes('rate limit') || msg.includes('for security purposes')) {
      return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
    }
    if (msg.includes('database error saving new user')) {
      return 'Akun gagal dibuat. Username mungkin sudah dipakai, coba username lain.';
    }
    if (msg.includes('failed to fetch') || msg.includes('network')) {
      return 'Tidak dapat terhubung ke server autentikasi. Periksa koneksi internet Anda.';
    }
    return (error && error.message) || 'Terjadi kesalahan. Silakan coba lagi.';
  }

  // Sign up new user
  async function signUp(email, password, fullName, username) {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) {
      return { success: false, error: 'Supabase client belum terinisialisasi. Periksa anon key.' };
    }

    // Link konfirmasi email kembali ke halaman utama dan meneruskan ke tool yang dituju
    const redirectUrl = new URL(HOME_URL);
    if (pendingNextUrl) {
      const next = new URL(pendingNextUrl);
      redirectUrl.searchParams.set('next', next.pathname + next.search + next.hash);
    }

    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          emailRedirectTo: redirectUrl.href,
          data: {
            full_name: fullName.trim(),
            username: username.trim().toLowerCase()
          }
        }
      });

      if (error) {
        return { success: false, error: friendlyAuthError(error) };
      }

      // Supabase mengembalikan user tanpa identities (tanpa error) jika email sudah terdaftar
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { success: false, error: 'Email sudah terdaftar. Silakan Sign In.' };
      }

      // Tanpa session berarti masih menunggu konfirmasi email: user belum dianggap login
      if (data.session && data.user) {
        await setSessionUser(data.user);
      }

      return {
        success: true,
        user: data.user,
        session: data.session,
        needsConfirmation: !data.session
      };
    } catch (err) {
      return { success: false, error: friendlyAuthError(err) };
    }
  }

  // Sign in existing user
  async function signIn(email, password) {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) {
      return { success: false, error: 'Supabase client belum terinisialisasi. Periksa anon key.' };
    }

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) {
        return { success: false, error: friendlyAuthError(error) };
      }

      await setSessionUser(data.user);
      return { success: true, user: data.user, profile: currentProfile };
    } catch (err) {
      return { success: false, error: friendlyAuthError(err) };
    }
  }

  // Sign out (di halaman tool, auth-guard.js mengalihkan ke halaman utama)
  async function signOut() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) return { success: false };

    try {
      await client.auth.signOut();
      await setSessionUser(null);
      return { success: true };
    } catch (err) {
      console.error('[Auth] Error signing out:', err);
      return { success: false, error: err.message };
    }
  }

  // Initialize Auth state from current session
  async function initAuth() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) {
      resolveAuthReady();
      updateAuthUI();
      return;
    }

    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) {
        console.warn('[Auth] Error getting session:', error.message);
      }

      currentUser = (session && session.user) || null;
      resolveAuthReady();
      const pendingProfile = setSessionUser(currentUser);

      // Listen to future changes. Callback dibuat sinkron dan query Supabase ditunda
      // (setTimeout) karena memanggil Supabase langsung di dalam callback ini bisa deadlock.
      client.auth.onAuthStateChange((event, session) => {
        console.log('[Auth] State changed:', event);
        const nextUser = (session && session.user) || null;
        const sameUser = nextUser && currentUser && nextUser.id === currentUser.id;
        if (sameUser || (!nextUser && !currentUser)) return;
        setTimeout(() => setSessionUser(nextUser), 0);
      });

      await pendingProfile;
    } catch (err) {
      console.error('[Auth] Failed to restore session:', err);
      resolveAuthReady();
      updateAuthUI();
    }
  }

  /* --------------------------------------------------------------------------
     Launch App Flow & ?next= Handling
     -------------------------------------------------------------------------- */

  // Hanya terima path internal situs ini (cegah open redirect)
  function resolveInternalUrl(raw) {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
      return null;
    }
    try {
      const target = new URL(raw, ROOT_URL);
      if (target.origin !== ROOT_URL.origin || !target.href.startsWith(ROOT_URL.href)) return null;
      return target.href;
    } catch (e) {
      return null;
    }
  }

  function isToolUrl(href) {
    return typeof href === 'string' && href.startsWith(TOOLS_URL);
  }

  function goToPendingNext() {
    const target = pendingNextUrl;
    pendingNextUrl = null;
    if (target) window.location.assign(target);
  }

  // Klik link ke tools/... saat belum login → buka modal, simpan tujuannya
  function handleToolLinkClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link || link.target === '_blank' || !isToolUrl(link.href)) return;
    if (currentUser) return;

    e.preventDefault();
    const target = link.href;

    // Sesi mungkin belum selesai dipulihkan; tunggu sebelum memutuskan
    authReady.then(() => {
      if (currentUser) {
        window.location.assign(target);
        return;
      }
      pendingNextUrl = target;
      if (isConfigMissing()) {
        openKeyModal();
      } else {
        openAuthModal('signin');
      }
    });
  }

  // Dialihkan dari auth-guard.js (?next=...) → buka modal otomatis
  async function handleNextParam() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('next')) return;

    const target = resolveInternalUrl(params.get('next'));

    // Bersihkan URL agar modal tidak muncul lagi saat reload setelah ditutup
    params.delete('next');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);

    if (!target) return;

    await authReady;
    if (currentUser) {
      window.location.replace(target);
      return;
    }

    pendingNextUrl = target;
    if (isConfigMissing()) {
      openKeyModal();
    } else {
      openAuthModal('signin');
      showAlert('Silakan login untuk membuka aplikasi ini.', 'info');
    }
  }

  // Buka modal login dengan tujuan setelah login (path divalidasi seperti ?next=)
  function openLoginFor(nextPath) {
    const target = resolveInternalUrl(nextPath);
    if (!target) return false;

    pendingNextUrl = target;
    if (isConfigMissing()) {
      openKeyModal();
    } else {
      openAuthModal('signin');
      showAlert('Silakan login untuk melanjutkan.', 'info');
    }
    return true;
  }

  /* --------------------------------------------------------------------------
     Navbar Session UI (halaman tool)
     -------------------------------------------------------------------------- */
  function updateAuthUI() {
    const authContainer = document.getElementById('nav-auth-container');
    if (!authContainer) return;

    if (!currentUser) {
      authContainer.innerHTML = '';
      return;
    }

    const role = (currentProfile && currentProfile.role) || 'analyst';

    authContainer.innerHTML = `
      <div class="user-session-pill">
        <span class="auth-dot auth-dot-online"></span>
        <span class="user-name" title="${escapeHtml(currentUser.email)}">${escapeHtml(currentUser.email)}</span>
        <span class="role-badge role-${escapeHtml(role)}">${escapeHtml(role.toUpperCase())}</span>
      </div>
      <button id="btn-logout" type="button" class="btn btn-outline btn-sm btn-logout">Logout</button>
    `;

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        if (confirm('Akhiri sesi login (logout)?')) {
          setButtonLoading(btnLogout, true, 'Logging out...');
          const res = await signOut();
          if (!res.success) setButtonLoading(btnLogout, false);
        }
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  function isConfigMissing() {
    const config = window.SUPABASE_CONFIG;
    return !config || !config.anonKey || config.anonKey === 'YOUR_SUPABASE_ANON_KEY';
  }

  function setButtonLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
      if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    }
  }

  // Create Modal in DOM if not exists
  function ensureAuthModals() {
    if (document.getElementById('auth-modal-overlay')) return;

    const modalHTML = `
      <div id="auth-modal-overlay" class="cyber-modal-overlay" aria-hidden="true">
        <div class="cyber-modal-card cyber-card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
          <div class="terminal-bar">
            <div class="terminal-buttons">
              <span class="term-btn term-close"></span>
              <span class="term-btn term-min"></span>
              <span class="term-btn term-max"></span>
            </div>
            <div class="terminal-title" id="auth-modal-title">AUTH_GATEWAY // SUPABASE</div>
            <button type="button" class="modal-close-btn" id="modal-close-btn" aria-label="Tutup">✕</button>
          </div>

          <div class="modal-body">
            <!-- Tabs -->
            <div class="auth-tabs">
              <button type="button" class="auth-tab active" id="tab-btn-signin">Sign In</button>
              <button type="button" class="auth-tab" id="tab-btn-signup">Create Account</button>
            </div>

            <div id="auth-alert" class="auth-alert" role="alert" style="display:none;"></div>

            <!-- Sign In Form -->
            <form id="form-signin" class="cyber-form auth-form-panel">
              <div class="form-group">
                <label for="signin-email" class="form-label">Email Address</label>
                <input type="email" id="signin-email" class="form-input" placeholder="analyst@domain.com" required autocomplete="email">
              </div>
              <div class="form-group">
                <label for="signin-password" class="form-label">Password</label>
                <input type="password" id="signin-password" class="form-input" placeholder="••••••••" required autocomplete="current-password">
              </div>
              <button type="submit" class="btn btn-primary btn-block" id="btn-submit-signin">
                <span>Authenticate Session</span>
                <span class="btn-icon">⚡</span>
              </button>
            </form>

            <!-- Sign Up Form -->
            <form id="form-signup" class="cyber-form auth-form-panel" style="display:none;">
              <div class="form-group">
                <label for="signup-name" class="form-label">Full Name</label>
                <input type="text" id="signup-name" class="form-input" placeholder="Rangga Hadad" required autocomplete="name">
              </div>
              <div class="form-group">
                <label for="signup-username" class="form-label">Username (Ops Handle)</label>
                <input type="text" id="signup-username" class="form-input" placeholder="rangga_sec" required autocomplete="username">
              </div>
              <div class="form-group">
                <label for="signup-email" class="form-label">Email Address</label>
                <input type="email" id="signup-email" class="form-input" placeholder="analyst@domain.com" required autocomplete="email">
              </div>
              <div class="form-group">
                <label for="signup-password" class="form-label">Password (min. 6 characters)</label>
                <input type="password" id="signup-password" class="form-input" placeholder="••••••••" required minlength="6" autocomplete="new-password">
              </div>
              <button type="submit" class="btn btn-primary btn-block" id="btn-submit-signup">
                <span>Create Analyst Account</span>
                <span class="btn-icon">→</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- Quick Anon Key Setup Modal -->
      <div id="key-modal-overlay" class="cyber-modal-overlay" aria-hidden="true">
        <div class="cyber-modal-card cyber-card" style="max-width: 500px;" role="dialog" aria-modal="true">
          <div class="terminal-bar">
            <div class="terminal-buttons">
              <span class="term-btn term-close"></span>
              <span class="term-btn term-min"></span>
              <span class="term-btn term-max"></span>
            </div>
            <div class="terminal-title">CONFIG // SUPABASE ANON KEY</div>
            <button type="button" class="modal-close-btn" id="key-modal-close" aria-label="Tutup">✕</button>
          </div>
          <div class="modal-body" style="padding: 1.5rem;">
            <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 1rem;">
              Masukkan <strong>Publishable / Anon Key</strong> dari Supabase Dashboard
              (<em>Project Settings &gt; API &gt; anon public</em>). Kunci ini aman untuk browser.
            </p>
            <form id="form-anon-key" class="cyber-form">
              <div class="form-group">
                <label for="input-anon-key" class="form-label">Supabase Anon Key</label>
                <textarea id="input-anon-key" class="form-textarea" rows="3" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." required></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-block">
                <span>Save Key &amp; Reload</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Wire events: tombol tutup, klik di luar modal, dan Esc
    const closeBtn = document.getElementById('modal-close-btn');
    const overlay = document.getElementById('auth-modal-overlay');
    if (closeBtn && overlay) {
      closeBtn.addEventListener('click', closeAuthModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAuthModal();
      });
    }

    const keyClose = document.getElementById('key-modal-close');
    const keyOverlay = document.getElementById('key-modal-overlay');
    if (keyClose && keyOverlay) {
      keyClose.addEventListener('click', closeKeyModal);
      keyOverlay.addEventListener('click', (e) => {
        if (e.target === keyOverlay) closeKeyModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay && overlay.classList.contains('open')) closeAuthModal();
      if (keyOverlay && keyOverlay.classList.contains('open')) closeKeyModal();
    });

    const formKey = document.getElementById('form-anon-key');
    if (formKey) {
      formKey.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = document.getElementById('input-anon-key').value;
        if (val) {
          window.setLocalAnonKey(val);
          window.location.reload();
        }
      });
    }

    // Tabs switch
    const tabSignIn = document.getElementById('tab-btn-signin');
    const tabSignUp = document.getElementById('tab-btn-signup');
    if (tabSignIn && tabSignUp) {
      tabSignIn.addEventListener('click', () => switchTab('signin'));
      tabSignUp.addEventListener('click', () => switchTab('signup'));
    }

    // Form Submissions
    const formSignIn = document.getElementById('form-signin');
    if (formSignIn) {
      formSignIn.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signin-email').value;
        const pass = document.getElementById('signin-password').value;
        const submitBtn = document.getElementById('btn-submit-signin');

        hideAlert();
        setButtonLoading(submitBtn, true, 'Authenticating...');
        const res = await signIn(email, pass);

        if (res.success) {
          showAlert(`[ACK] Authenticated successfully as ${res.user.email}`, 'success');
          if (pendingNextUrl) {
            setButtonLoading(submitBtn, true, 'Opening app...');
          } else {
            setButtonLoading(submitBtn, false);
          }
          setTimeout(() => {
            closeAuthModal({ keepNext: true });
            goToPendingNext();
          }, 700);
        } else {
          setButtonLoading(submitBtn, false);
          showAlert(`[ERR] ${res.error}`, 'error');
        }
      });
    }

    const formSignUp = document.getElementById('form-signup');
    if (formSignUp) {
      formSignUp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const username = document.getElementById('signup-username').value;
        const email = document.getElementById('signup-email').value;
        const pass = document.getElementById('signup-password').value;
        const submitBtn = document.getElementById('btn-submit-signup');

        hideAlert();
        setButtonLoading(submitBtn, true, 'Creating account...');
        const res = await signUp(email, pass, name, username);
        setButtonLoading(submitBtn, false);

        if (!res.success) {
          showAlert(`[ERR] ${res.error}`, 'error');
        } else if (res.needsConfirmation) {
          switchTab('signin');
          document.getElementById('signin-email').value = email.trim();
          showAlert('[SUCCESS] Registrasi berhasil! Tautan konfirmasi telah dikirim ke email Anda. Silakan verifikasi email lalu login.', 'success');
        } else {
          showAlert('[SUCCESS] Akun berhasil dibuat dan otomatis terhubung!', 'success');
          setTimeout(() => {
            closeAuthModal({ keepNext: true });
            goToPendingNext();
          }, 900);
        }
      });
    }
  }

  // Kosongkan display agar layout flex + gap dari .cyber-form tetap berlaku
  function switchTab(mode) {
    const isSignUp = mode === 'signup';
    document.getElementById('tab-btn-signin').classList.toggle('active', !isSignUp);
    document.getElementById('tab-btn-signup').classList.toggle('active', isSignUp);
    document.getElementById('form-signin').style.display = isSignUp ? 'none' : '';
    document.getElementById('form-signup').style.display = isSignUp ? '' : 'none';
    hideAlert();
  }

  function showAlert(msg, type) {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.style.display = 'block';
    alertEl.className = `auth-alert alert-${type}`;
    alertEl.textContent = msg;
  }

  function hideAlert() {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.style.display = 'none';
  }

  function openAuthModal(mode) {
    ensureAuthModals();
    const overlay = document.getElementById('auth-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    switchTab(mode === 'signup' ? 'signup' : 'signin');

    const firstInput = document.getElementById(mode === 'signup' ? 'signup-name' : 'signin-email');
    if (firstInput) firstInput.focus();
  }

  function closeAuthModal(options) {
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (!(options && options.keepNext)) pendingNextUrl = null;
  }

  function openKeyModal() {
    ensureAuthModals();
    const overlay = document.getElementById('key-modal-overlay');
    if (overlay) {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function closeKeyModal() {
    const overlay = document.getElementById('key-modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    pendingNextUrl = null;
  }

  // Export public API
  window.CyberAuth = {
    signUp,
    signIn,
    signOut,
    getUser: () => currentUser,
    getProfile: () => currentProfile,
    onAuthStateChanged,
    openAuthModal,
    openLoginFor,
    closeAuthModal,
    openKeyModal
  };

  function start() {
    ensureAuthModals();
    document.addEventListener('click', handleToolLinkClick);
    initAuth();
    handleNextParam();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
