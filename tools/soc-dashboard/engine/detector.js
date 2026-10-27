/**
 * Detector: event → alert, berdasarkan aturan di rules.js.
 * Modul murni: tidak menyentuh DOM, bisa dipakai di browser, Web Worker, dan Node.
 *
 * Alert: { id, ruleId, ruleName, severity, ip, user, users, firstSeen, lastSeen, count, events,
 *          mitre, description }
 */

import { DEFAULT_RULES, DEFAULT_MERGE_GAP_SEC, SEVERITY_ORDER } from './rules.js';

// "Invalid user X from IP" diikuti "Failed password for invalid user X from IP" = satu percobaan
export const INVALID_USER_PAIR_SEC = 10;

/**
 * @param {object[]} events  event dari parser (urut waktu)
 * @param {{ rules?: object[], mergeGapSec?: number }} [options]
 * @returns {object[]} alert, urut dari yang paling awal
 */
export function detect(events, options = {}) {
  const rules = options.rules || DEFAULT_RULES;
  const mergeGapMs = (options.mergeGapSec ?? DEFAULT_MERGE_GAP_SEC) * 1000;

  const attempts = collapseInvalidUserNotices(events);
  const byIp = groupByIp(attempts);
  const alerts = [];

  for (const rule of rules) {
    const evaluate = EVALUATORS[rule.type];
    if (!evaluate) throw new Error(`Tipe aturan tidak dikenal: ${rule.type} (${rule.id})`);

    for (const [ip, ipEvents] of byIp) {
      const hits = evaluate(rule, ipEvents);
      alerts.push(...mergeHits(rule, ip, hits, mergeGapMs));
    }
  }

  alerts.sort((a, b) => a.firstSeen - b.firstSeen || severityRank(b.severity) - severityRank(a.severity));
  return alerts;
}

export function severityRank(severity) {
  return SEVERITY_ORDER.indexOf(severity);
}

/** Buang notifikasi "Invalid user" yang sudah terwakili oleh "Failed password for invalid user". */
export function collapseInvalidUserNotices(events) {
  const pairMs = INVALID_USER_PAIR_SEC * 1000;
  const failedTimes = new Map();
  for (const e of events) {
    if (e.action === 'login' && e.result === 'failure') {
      const key = `${e.ip}|${e.user}`;
      if (!failedTimes.has(key)) failedTimes.set(key, []);
      failedTimes.get(key).push(e.ts);
    }
  }

  return events.filter((e) => {
    if (e.action !== 'invalid_user') return true;
    const times = failedTimes.get(`${e.ip}|${e.user}`);
    return !(times && times.some((t) => Math.abs(t - e.ts) <= pairMs));
  });
}

function groupByIp(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.ip)) map.set(e.ip, []);
    map.get(e.ip).push(e);
  }
  return map;
}

function matchesWhere(where, e) {
  if (!where) return true;
  if (where.result && e.result !== where.result) return false;
  if (where.action && e.action !== where.action) return false;
  if (where.userIn && !where.userIn.includes(e.user)) return false;
  return true;
}

/* --------------------------------------------------------------------------
   Evaluators
   Setiap evaluator mengembalikan "hit" berurutan waktu:
   { windowStart, newEvents }  — newEvents hanya berisi event yang belum dilaporkan
   pada hit sebelumnya, sehingga serangan panjang tetap O(n).
   -------------------------------------------------------------------------- */
const EVALUATORS = {
  'sliding-count'(rule, ipEvents) {
    const pool = ipEvents.filter((e) => matchesWhere(rule.where, e));
    const windowMs = rule.windowSec * 1000;
    const hits = [];
    let start = 0;
    let lastAdded = -1;

    for (let i = 0; i < pool.length; i++) {
      while (pool[i].ts - pool[start].ts > windowMs) start++;
      if (i - start + 1 >= rule.threshold) {
        const from = Math.max(start, lastAdded + 1);
        hits.push({ windowStart: pool[start].ts, newEvents: pool.slice(from, i + 1) });
        lastAdded = i;
      }
    }
    return hits;
  },

  'sliding-distinct'(rule, ipEvents) {
    const pool = ipEvents.filter((e) => matchesWhere(rule.where, e));
    const windowMs = rule.windowSec * 1000;
    const field = rule.distinctField;
    const counts = new Map();
    const hits = [];
    let start = 0;
    let lastAdded = -1;

    for (let i = 0; i < pool.length; i++) {
      const value = pool[i][field];
      counts.set(value, (counts.get(value) || 0) + 1);
      while (pool[i].ts - pool[start].ts > windowMs) {
        const old = pool[start][field];
        const n = counts.get(old) - 1;
        if (n === 0) counts.delete(old); else counts.set(old, n);
        start++;
      }
      if (counts.size >= rule.threshold) {
        const from = Math.max(start, lastAdded + 1);
        hits.push({ windowStart: pool[start].ts, newEvents: pool.slice(from, i + 1) });
        lastAdded = i;
      }
    }
    return hits;
  },

  'success-after-failures'(rule, ipEvents) {
    const windowMs = rule.windowSec * 1000;
    const failures = [];
    const hits = [];
    let start = 0;
    let lastAdded = -1;

    for (const e of ipEvents) {
      if (e.result === 'failure') {
        failures.push(e);
        continue;
      }
      if (e.result !== 'success') continue;

      while (start < failures.length && e.ts - failures[start].ts > windowMs) start++;
      const recentFailures = failures.length - start;
      if (recentFailures >= rule.threshold) {
        const from = Math.max(start, lastAdded + 1);
        hits.push({
          windowStart: failures[start].ts,
          newEvents: failures.slice(from).concat(e),
          failureCount: failures.length - from
        });
        lastAdded = failures.length - 1;
      }
    }
    return hits;
  }
};

/* --------------------------------------------------------------------------
   Penggabungan alert duplikat
   Hit untuk aturan + IP yang sama digabung selama window-nya dimulai tidak lebih
   dari mergeGapMs setelah event terakhir alert sebelumnya.
   -------------------------------------------------------------------------- */
function mergeHits(rule, ip, hits, mergeGapMs) {
  const alerts = [];
  let current = null;

  for (const hit of hits) {
    if (!current || hit.windowStart - current.lastSeen > mergeGapMs) {
      if (current) alerts.push(finalizeAlert(rule, ip, current));
      current = { events: [], lastSeen: -Infinity, failureCount: 0 };
    }
    for (const e of hit.newEvents) current.events.push(e);
    current.failureCount += hit.failureCount || 0;
    current.lastSeen = Math.max(current.lastSeen, hit.newEvents[hit.newEvents.length - 1].ts);
  }
  if (current) alerts.push(finalizeAlert(rule, ip, current));
  return alerts;
}

function finalizeAlert(rule, ip, draft) {
  const events = draft.events.slice().sort((a, b) => a.ts - b.ts || a.lineNo - b.lineNo);
  const users = usersByFrequency(events);
  const successUsers = usersByFrequency(events.filter((e) => e.result === 'success'));

  let severity = rule.severity;
  for (const step of rule.escalate || []) {
    if (events.length >= step.minCount && severityRank(step.severity) > severityRank(severity)) {
      severity = step.severity;
    }
  }

  const alert = {
    id: `${rule.id}:${ip}:${events[0].ts}`,
    ruleId: rule.id,
    ruleName: rule.name,
    severity,
    ip,
    user: successUsers[0] || users[0] || null,
    users,
    successUsers,
    failureCount: draft.failureCount || events.filter((e) => e.result === 'failure').length,
    firstSeen: events[0].ts,
    lastSeen: events[events.length - 1].ts,
    count: events.length,
    events,
    mitre: rule.mitre
  };
  alert.description = rule.describe ? rule.describe(alert, rule) : rule.name;
  return alert;
}

function usersByFrequency(events) {
  const counts = new Map();
  for (const e of events) counts.set(e.user, (counts.get(e.user) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([user]) => user);
}
