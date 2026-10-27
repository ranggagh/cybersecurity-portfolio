/**
 * Web Worker: menjalankan analisis di luar thread UI agar file besar tidak membekukan halaman.
 * Pesan masuk: { id, text, options }  →  pesan keluar: { id, result } | { id, error }
 */

import { analyzeLogText } from './pipeline.js';

self.addEventListener('message', (e) => {
  const { id, text, options } = e.data;
  try {
    self.postMessage({ id, result: analyzeLogText(text, options) });
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
});
