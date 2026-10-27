/**
 * TOOL_NAME
 * Logika UI tool ini (ES module). Helper bersama (Supabase, auth, canvas) ada di js/shared/.
 * Halaman ini hanya tampil untuk user yang login (lihat auth-guard.js di <head> index.html).
 * User aktif: window.CyberAuth.getUser(), profil: window.CyberAuth.getProfile().
 *
 * Logika murni (parsing, deteksi, perhitungan) taruh di ./engine/ tanpa akses DOM,
 * lalu import di sini, misalnya:  import { analyze } from './engine/analyze.js';
 * Data dari pengguna (file, log, input) tidak tepercaya: tampilkan lewat textContent, bukan innerHTML.
 */

const root = document.getElementById('tool-root');

if (root) {
  const placeholder = document.createElement('p');
  placeholder.className = 'tool-placeholder';
  placeholder.textContent = '[ TOOL_NAME READY ]';
  root.replaceChildren(placeholder);
}
