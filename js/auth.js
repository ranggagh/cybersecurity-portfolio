/**
 * Centralized Authentication & Profile Synchronization
 * Project: PortofolioRangga Cybersecurity Platform
 * Powered by Supabase Auth & PostgreSQL Profiles
 */

(function () {
  'use strict';

  let currentUser = null;
  let currentProfile = null;
  const authStateListeners = [];

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

  // Sign up new user
  async function signUp(email, password, fullName, username) {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) {
      return { success: false, error: 'Supabase client belum terinisialisasi. Periksa anon key.' };
    }

    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: username.trim().toLowerCase()
          }
        }
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Check if session was created directly or waiting for confirmation
      if (data.user) {
        currentUser = data.user;
        currentProfile = await fetchProfile(data.user.id);
        updateAuthUI();
        notifyListeners();
      }

      return {
        success: true,
        user: data.user,
        session: data.session,
        needsConfirmation: !data.session
      };
    } catch (err) {
      return { success: false, error: err.message || 'Terjadi kesalahan saat pendaftaran.' };
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
        return { success: false, error: error.message };
      }

      currentUser = data.user;
      currentProfile = await fetchProfile(data.user.id);
      updateAuthUI();
      notifyListeners();

      return { success: true, user: data.user, profile: currentProfile };
    } catch (err) {
      return { success: false, error: err.message || 'Gagal login.' };
    }
  }

  // Sign out
  async function signOut() {
    const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if (!client) return { success: false };

    try {
      await client.auth.signOut();
      currentUser = null;
      currentProfile = null;
      updateAuthUI();
      notifyListeners();
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
      renderAnonKeyPromptIfNeeded();
      updateAuthUI();
      return;
    }

    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) {
        console.warn('[Auth] Error getting session:', error.message);
      }

      if (session && session.user) {
        currentUser = session.user;
        currentProfile = await fetchProfile(session.user.id);
      } else {
        currentUser = null;
        currentProfile = null;
      }

      // Listen to future changes
      client.auth.onAuthStateChange(async (event, session) => {
        console.log('[Auth] State changed:', event);
        if (session && session.user) {
          currentUser = session.user;
          currentProfile = await fetchProfile(session.user.id);
        } else {
          currentUser = null;
          currentProfile = null;
        }
        updateAuthUI();
        notifyListeners();
      });

      updateAuthUI();
      notifyListeners();
    } catch (err) {
      console.error('[Auth] Failed to restore session:', err);
      updateAuthUI();
    }
  }

  // UI Injection & Update
  function updateAuthUI() {
    const authContainer = document.getElementById('nav-auth-container');
    if (!authContainer) return;

    const config = window.SUPABASE_CONFIG;
    const isConfigMissing = !config || !config.anonKey || config.anonKey === 'YOUR_SUPABASE_ANON_KEY';

    if (isConfigMissing) {
      authContainer.innerHTML = `
        <button id="btn-config-key" class="btn btn-outline btn-sm auth-status-btn" title="Setup Supabase Anon Key">
          <span class="auth-dot auth-dot-warn"></span>
          <span class="auth-btn-label">Setup Supabase Key</span>
        </button>
      `;
      const btnConfig = document.getElementById('btn-config-key');
      if (btnConfig) {
        btnConfig.addEventListener('click', openKeyModal);
      }
      return;
    }

    if (currentUser) {
      const displayName = (currentProfile && currentProfile.full_name) || 
                          (currentProfile && currentProfile.username) || 
                          currentUser.email.split('@')[0];
      const role = (currentProfile && currentProfile.role) || 'analyst';

      authContainer.innerHTML = `
        <div class="user-session-pill">
          <span class="auth-dot auth-dot-online"></span>
          <span class="user-name" title="${currentUser.email}">${escapeHtml(displayName)}</span>
          <span class="role-badge role-${escapeHtml(role)}">${escapeHtml(role.toUpperCase())}</span>
          <button id="btn-logout" class="btn-logout-icon" title="Logout session">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      `;

      const btnLogout = document.getElementById('btn-logout');
      if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
          if (confirm('Akhiri sesi login (logout)?')) {
            await signOut();
          }
        });
      }
    } else {
      authContainer.innerHTML = `
        <button id="btn-open-auth" class="btn btn-primary btn-sm auth-status-btn">
          <span class="auth-dot"></span>
          <span class="auth-btn-label">Sign In / Register</span>
        </button>
      `;

      const btnOpen = document.getElementById('btn-open-auth');
      if (btnOpen) {
        btnOpen.addEventListener('click', () => openAuthModal('signin'));
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  // Create Modal in DOM if not exists
  function ensureAuthModals() {
    if (document.getElementById('auth-modal-overlay')) return;

    const modalHTML = `
      <div id="auth-modal-overlay" class="cyber-modal-overlay" aria-hidden="true">
        <div class="cyber-modal-card cyber-card" role="dialog" aria-modal="true">
          <div class="terminal-bar">
            <div class="terminal-buttons">
              <span class="term-btn term-close" id="modal-close-btn" style="cursor:pointer;"></span>
              <span class="term-btn term-min"></span>
              <span class="term-btn term-max"></span>
            </div>
            <div class="terminal-title">AUTH_GATEWAY // SUPABASE</div>
            <div class="terminal-status" id="modal-status-badge">SECURE</div>
          </div>

          <div class="modal-body">
            <!-- Tabs -->
            <div class="auth-tabs">
              <button type="button" class="auth-tab active" id="tab-btn-signin">Sign In</button>
              <button type="button" class="auth-tab" id="tab-btn-signup">Create Account</button>
            </div>

            <div id="auth-alert" class="auth-alert" style="display:none;"></div>

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
              <span class="term-btn term-close" id="key-modal-close" style="cursor:pointer;"></span>
              <span class="term-btn term-min"></span>
              <span class="term-btn term-max"></span>
            </div>
            <div class="terminal-title">CONFIG // SUPABASE ANON KEY</div>
            <div class="terminal-status">SETUP</div>
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

    // Wire events
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
    const formSignIn = document.getElementById('form-signin');
    const formSignUp = document.getElementById('form-signup');

    if (tabSignIn && tabSignUp) {
      tabSignIn.addEventListener('click', () => {
        tabSignIn.classList.add('active');
        tabSignUp.classList.remove('active');
        formSignIn.style.display = 'block';
        formSignUp.style.display = 'none';
        hideAlert();
      });

      tabSignUp.addEventListener('click', () => {
        tabSignUp.classList.add('active');
        tabSignIn.classList.remove('active');
        formSignUp.style.display = 'block';
        formSignIn.style.display = 'none';
        hideAlert();
      });
    }

    // Form Submissions
    if (formSignIn) {
      formSignIn.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signin-email').value;
        const pass = document.getElementById('signin-password').value;
        const submitBtn = document.getElementById('btn-submit-signin');

        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        showAlert('Authenticating with security gateway...', 'info');

        const res = await signIn(email, pass);
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';

        if (res.success) {
          showAlert(`[ACK] Authenticated successfully as ${res.user.email}`, 'success');
          setTimeout(() => {
            closeAuthModal();
            hideAlert();
          }, 900);
        } else {
          showAlert(`[ERR] ${res.error}`, 'error');
        }
      });
    }

    if (formSignUp) {
      formSignUp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const username = document.getElementById('signup-username').value;
        const email = document.getElementById('signup-email').value;
        const pass = document.getElementById('signup-password').value;
        const submitBtn = document.getElementById('btn-submit-signup');

        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        showAlert('Registering analyst identity...', 'info');

        const res = await signUp(email, pass, name, username);
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';

        if (res.success) {
          if (res.needsConfirmation) {
            showAlert('[SUCCESS] Registrasi berhasil! Tautan konfirmasi telah dikirim ke email Anda. Silakan verifikasi email lalu login.', 'success');
          } else {
            showAlert('[SUCCESS] Akun berhasil dibuat dan otomatis terhubung!', 'success');
            setTimeout(() => {
              closeAuthModal();
              hideAlert();
            }, 1200);
          }
        } else {
          showAlert(`[ERR] ${res.error}`, 'error');
        }
      });
    }
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

    if (mode === 'signup') {
      const tabSignUp = document.getElementById('tab-btn-signup');
      if (tabSignUp) tabSignUp.click();
    } else {
      const tabSignIn = document.getElementById('tab-btn-signin');
      if (tabSignIn) tabSignIn.click();
    }
  }

  function closeAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
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
  }

  function renderAnonKeyPromptIfNeeded() {
    updateAuthUI();
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
    closeAuthModal,
    openKeyModal
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureAuthModals();
      initAuth();
    });
  } else {
    ensureAuthModals();
    initAuth();
  }
})();
