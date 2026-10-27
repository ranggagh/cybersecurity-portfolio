import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../engine/detector.js';
import { DEFAULT_RULES } from '../engine/rules.js';

let lineNo = 0;
// Event sintetis; t dalam detik
function ev(t, { ip = '203.0.113.5', user = 'root', result = 'failure', action = 'login' } = {}) {
  lineNo++;
  return { ts: t * 1000, host: 'web-01', user, ip, action, result, raw: `line ${lineNo}`, lineNo };
}
const series = (n, step, opts, start = 0) => Array.from({ length: n }, (_, i) => ev(start + i * step, opts));
const byRule = (alerts, ruleId) => alerts.filter((a) => a.ruleId === ruleId);
const sorted = (events) => events.slice().sort((a, b) => a.ts - b.ts);

/* ---------------- Aturan 1: SSH Brute Force ---------------- */
test('brute force: 5 gagal dalam 60 detik memicu alert medium T1110.001', () => {
  const alerts = byRule(detect(series(5, 10, { user: 'bob' })), 'SSH-BRUTE-FORCE');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'medium');
  assert.equal(alerts[0].mitre.id, 'T1110.001');
  assert.equal(alerts[0].count, 5);
  assert.equal(alerts[0].ip, '203.0.113.5');
});

test('brute force: 4 gagal (di bawah threshold) tidak memicu', () => {
  assert.equal(byRule(detect(series(4, 5, { user: 'bob' })), 'SSH-BRUTE-FORCE').length, 0);
});

test('brute force: 5 gagal tersebar lebih dari 60 detik tidak memicu', () => {
  assert.equal(byRule(detect(series(5, 20, { user: 'bob' })), 'SSH-BRUTE-FORCE').length, 0);
});

test('brute force: dikelompokkan per IP, bukan gabungan semua IP', () => {
  const events = sorted([...series(3, 5, { ip: '203.0.113.1', user: 'bob' }), ...series(3, 5, { ip: '203.0.113.2', user: 'bob' })]);
  assert.equal(byRule(detect(events), 'SSH-BRUTE-FORCE').length, 0);
});

test('brute force: jumlah besar menaikkan severity ke high', () => {
  const [alert] = byRule(detect(series(60, 1, { user: 'bob' })), 'SSH-BRUTE-FORCE');
  assert.equal(alert.severity, 'high');
});

/* ---------------- Aturan 2: Login Berhasil Setelah Gagal ---------------- */
test('sukses setelah >= 5 gagal dari IP sama memicu alert critical T1078', () => {
  const events = [...series(5, 30, { user: 'deploy' }), ev(200, { user: 'deploy', result: 'success' })];
  const [alert] = byRule(detect(events), 'SSH-SUCCESS-AFTER-FAILURES');
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.mitre.id, 'T1078');
  assert.equal(alert.user, 'deploy');
  assert.equal(alert.count, 6);
  assert.equal(alert.events.at(-1).result, 'success');
});

test('sukses setelah 4 gagal tidak memicu', () => {
  const events = [...series(4, 30, { user: 'deploy' }), ev(200, { user: 'deploy', result: 'success' })];
  assert.equal(byRule(detect(events), 'SSH-SUCCESS-AFTER-FAILURES').length, 0);
});

test('sukses jauh setelah kegagalan (di luar window 10 menit) tidak memicu', () => {
  const events = [...series(5, 5, { user: 'deploy' }), ev(30 + 11 * 60, { user: 'deploy', result: 'success' })];
  assert.equal(byRule(detect(events), 'SSH-SUCCESS-AFTER-FAILURES').length, 0);
});

test('sukses dari IP lain tidak dikaitkan dengan kegagalan IP penyerang', () => {
  const events = [...series(6, 5, { user: 'deploy' }), ev(60, { user: 'deploy', ip: '198.51.100.99', result: 'success' })];
  assert.equal(byRule(detect(events), 'SSH-SUCCESS-AFTER-FAILURES').length, 0);
});

/* ---------------- Aturan 3: Password Spraying ---------------- */
test('spraying: 5 username berbeda dari satu IP memicu alert high T1110.003', () => {
  const users = ['oracle', 'test', 'ubuntu', 'guest', 'git'];
  const events = users.map((user, i) => ev(i * 40, { user }));
  const alerts = detect(events);
  const [alert] = byRule(alerts, 'SSH-PASSWORD-SPRAY');
  assert.equal(alert.severity, 'high');
  assert.equal(alert.mitre.id, 'T1110.003');
  assert.deepEqual(alert.users.slice().sort(), users.slice().sort());
  // Pelan (40 detik sekali): tidak boleh juga dianggap brute force
  assert.equal(byRule(alerts, 'SSH-BRUTE-FORCE').length, 0);
});

test('spraying: 4 username berbeda (berulang) tidak memicu', () => {
  const users = ['oracle', 'test', 'ubuntu', 'guest'];
  const events = [...users, ...users].map((user, i) => ev(i * 30, { user }));
  assert.equal(byRule(detect(events), 'SSH-PASSWORD-SPRAY').length, 0);
});

/* ---------------- Aturan 4: Akun Privileged ---------------- */
test('privileged: 3 gagal ke root dalam 5 menit memicu alert medium T1110', () => {
  const [alert] = byRule(detect(series(3, 60, { user: 'root' })), 'SSH-PRIVILEGED-TARGET');
  assert.equal(alert.severity, 'medium');
  assert.equal(alert.mitre.id, 'T1110');
});

test('privileged: 2 gagal ke admin tidak memicu', () => {
  assert.equal(byRule(detect(series(2, 30, { user: 'admin' })), 'SSH-PRIVILEGED-TARGET').length, 0);
});

test('privileged: gagal ke akun biasa tidak memicu aturan privileged', () => {
  assert.equal(byRule(detect(series(4, 60, { user: 'bob' })), 'SSH-PRIVILEGED-TARGET').length, 0);
});

/* ---------------- False positive pengguna normal ---------------- */
test('pengguna normal yang salah password 1-2 kali tidak memicu alert apa pun', () => {
  const normal = [
    ['alice', '198.51.100.21', 0, 2],
    ['bob', '198.51.100.34', 100, 1],
    ['admin', '198.51.100.10', 200, 2],
    ['root', '198.51.100.11', 300, 2],
    ['alice', '198.51.100.21', 1500, 1]
  ];
  const events = sorted(
    normal.flatMap(([user, ip, t, typos]) => [
      ...series(typos, 8, { user, ip }, t),
      ev(t + typos * 8 + 3, { user, ip, result: 'success' })
    ])
  );
  assert.deepEqual(detect(events), []);
});

/* ---------------- Penggabungan alert duplikat ---------------- */
test('500 percobaan beruntun menghasilkan SATU alert brute force dengan count 500', () => {
  const alerts = byRule(detect(series(500, 1, { user: 'bob' })), 'SSH-BRUTE-FORCE');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].count, 500);
  assert.equal(alerts[0].events.length, 500);
  assert.equal(alerts[0].firstSeen, 0);
  assert.equal(alerts[0].lastSeen, 499 * 1000);
});

test('dua serangan dengan jeda pendek digabung, jeda panjang dipisah', () => {
  const close = [...series(10, 2, { user: 'bob' }), ...series(10, 2, { user: 'bob' }, 20 + 120)];
  assert.equal(byRule(detect(close), 'SSH-BRUTE-FORCE').length, 1);

  const far = [...series(10, 2, { user: 'bob' }), ...series(10, 2, { user: 'bob' }, 20 + 30 * 60)];
  const alerts = byRule(detect(far), 'SSH-BRUTE-FORCE');
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((a) => a.count), [10, 10]);
  assert.notEqual(alerts[0].id, alerts[1].id);
});

test('aturan + IP berbeda tidak digabung', () => {
  const events = sorted([...series(6, 1, { ip: '203.0.113.1', user: 'bob' }), ...series(6, 1, { ip: '203.0.113.2', user: 'bob' })]);
  assert.equal(byRule(detect(events), 'SSH-BRUTE-FORCE').length, 2);
});

/* ---------------- Konfigurasi & normalisasi ---------------- */
test('threshold dan window bisa diubah lewat konfigurasi', () => {
  const rules = DEFAULT_RULES.map((r) => (r.id === 'SSH-BRUTE-FORCE' ? { ...r, threshold: 3, windowSec: 10 } : r));
  const events = series(3, 4, { user: 'bob' });
  assert.equal(byRule(detect(events), 'SSH-BRUTE-FORCE').length, 0);
  assert.equal(byRule(detect(events, { rules }), 'SSH-BRUTE-FORCE').length, 1);
});

test('"Invalid user" + "Failed password for invalid user" dihitung satu percobaan', () => {
  const paired = [];
  for (let i = 0; i < 4; i++) {
    paired.push(ev(i * 5, { user: 'oracle', action: 'invalid_user' }), ev(i * 5 + 1, { user: 'oracle' }));
  }
  // 8 baris, tetapi hanya 4 percobaan → di bawah threshold brute force
  assert.equal(byRule(detect(paired), 'SSH-BRUTE-FORCE').length, 0);

  // "Invalid user" tanpa pasangan (server key-only) tetap dihitung
  const standalone = series(5, 5, { user: 'oracle', action: 'invalid_user' });
  assert.equal(byRule(detect(standalone), 'SSH-BRUTE-FORCE').length, 1);
});
