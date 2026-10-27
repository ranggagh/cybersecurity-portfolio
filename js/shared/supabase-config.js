/**
 * Supabase Client Configuration
 * Project: PortofolioRangga
 * IMPORTANT: Only use Publishable / Anon Key here. NEVER use service_role key or DB password!
 */

const SUPABASE_CONFIG = {
  // Supabase Project URL provided for PortofolioRangga
  url: 'https://zpbndnubqiypwtsauisr.supabase.co',

  // Publishable Anon Key (Safe for browser / client-side)
  // Can be set directly here, or stored in localStorage('supabase_anon_key')
  anonKey: window.__SUPABASE_ANON_KEY__ || 
           localStorage.getItem('supabase_anon_key') || 
           'sb_publishable_OvZE6j0c4G7piovIkkGqWw_k3fF5Jt1'
};

// Helper to update anonKey in local testing without editing files
function setLocalAnonKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('supabase_anon_key', key.trim());
    SUPABASE_CONFIG.anonKey = key.trim();
    console.log('[Supabase Config] Local anon key updated. Reload page to apply.');
  }
}

window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.setLocalAnonKey = setLocalAnonKey;
