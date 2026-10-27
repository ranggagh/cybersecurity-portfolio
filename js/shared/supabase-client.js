/**
 * Supabase Client Initializer
 * Uses official @supabase/supabase-js v2 from CDN or global scope
 */

(function () {
  'use strict';

  let clientInstance = null;

  function initSupabase() {
    // Satu client per halaman: guard, auth, dan tool berbagi sesi yang sama
    if (clientInstance) return clientInstance;

    if (typeof window.supabase === 'undefined') {
      console.warn('[Supabase] Supabase JS library not loaded. Check CDN script tag.');
      return null;
    }

    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey || config.anonKey === 'YOUR_SUPABASE_ANON_KEY') {
      console.info(
        '[Supabase] Anon key belum diisi. Masukkan anon public key dari Supabase Dashboard di js/shared/supabase-config.js atau via setLocalAnonKey("...")'
      );
      return null;
    }

    try {
      clientInstance = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage
        }
      });
      console.log('[Supabase] Client initialized successfully for:', config.url);
      return clientInstance;
    } catch (err) {
      console.error('[Supabase] Failed to initialize client:', err);
      return null;
    }
  }

  window.getSupabaseClient = function () {
    if (!clientInstance) {
      clientInstance = initSupabase();
    }
    return clientInstance;
  };

  // Try immediate init if config and lib are ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
  } else {
    initSupabase();
  }
})();
