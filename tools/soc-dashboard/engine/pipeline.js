/**
 * Jalur analisis tunggal: teks log → parser → event → detector → alert + ringkasan.
 * Dipakai oleh mode simulasi dan mode unggah (lewat worker.js atau langsung).
 */

import { parseAuthLog, validateFormat } from './parser.js';
import { detect, severityRank, collapseInvalidUserNotices } from './detector.js';

/**
 * @param {string} text  isi auth.log
 * @param {{ year?: number, rules?: object[], mergeGapSec?: number }} [options]
 * @returns {{ ok: true, events, attempts, alerts, stats, summary } | { ok: false, code, message, stats? }}
 *   attempts = events tanpa notifikasi "Invalid user" yang sudah terwakili "Failed password"
 *   (hitungan yang sama dengan yang dipakai detector)
 */
export function analyzeLogText(text, options = {}) {
  if (typeof text !== 'string') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Input log tidak valid.' };
  }
  if (text.includes('\u0000')) {
    return {
      ok: false,
      code: 'BINARY',
      message: 'File ini berisi data biner, bukan teks. Jika file terkompresi (.gz), ekstrak dulu lalu unggah auth.log-nya.'
    };
  }

  const { events, stats } = parseAuthLog(text, options);
  const validation = validateFormat(stats);
  if (!validation.ok) return { ...validation, stats };

  const alerts = detect(events, options);
  const attempts = collapseInvalidUserNotices(events);
  return { ok: true, events, attempts, alerts, stats, summary: summarize(events, attempts, alerts) };
}

export function summarize(events, attempts, alerts) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  let topSeverity = null;
  for (const a of alerts) {
    bySeverity[a.severity]++;
    if (!topSeverity || severityRank(a.severity) > severityRank(topSeverity)) topSeverity = a.severity;
  }

  let failureCount = 0;
  let successCount = 0;
  const ips = new Set();
  for (const e of attempts) {
    if (e.result === 'failure') failureCount++;
    if (e.result === 'success') successCount++;
    ips.add(e.ip);
  }

  return {
    eventCount: events.length,
    attemptCount: attempts.length,
    failureCount,
    successCount,
    uniqueIps: ips.size,
    alertCount: alerts.length,
    bySeverity,
    topSeverity,
    firstTs: events.length ? events[0].ts : null,
    lastTs: events.length ? events[events.length - 1].ts : null
  };
}
