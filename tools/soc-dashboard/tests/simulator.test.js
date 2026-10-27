import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario, SCENARIOS, DEFAULT_SEED } from '../engine/simulator.js';
import { analyzeLogText } from '../engine/pipeline.js';

const ruleIds = (result) => [...new Set(result.alerts.map((a) => a.ruleId))].sort();

test('seed tetap → output identik; seed lain → output berbeda', () => {
  for (const { id } of SCENARIOS) {
    assert.equal(generateScenario(id), generateScenario(id, { seed: DEFAULT_SEED }));
  }
  assert.notEqual(generateScenario('brute-force', { seed: 1 }), generateScenario('brute-force', { seed: 2 }));
});

test('hanya memakai IP rentang dokumentasi (RFC 5737)', () => {
  for (const { id } of SCENARIOS) {
    const ips = generateScenario(id).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
    assert.ok(ips.length > 0);
    for (const ip of ips) assert.match(ip, /^(198\.51\.100|203\.0\.113)\.\d{1,3}$/, `${id}: ${ip}`);
  }
});

test('skenario normal: ada salah password 1-2 kali, tetapi 0 alert', () => {
  const text = generateScenario('normal');
  const result = analyzeLogText(text);
  assert.equal(result.ok, true);
  assert.ok(result.summary.failureCount >= 3, 'harus ada login gagal pengguna normal');
  assert.match(text, /Failed password for alice[\s\S]*Accepted password for alice/);
  assert.deepEqual(result.alerts, []);
});

test('skenario brute force memicu brute force + privileged, digabung per aturan', () => {
  const result = analyzeLogText(generateScenario('brute-force'));
  assert.deepEqual(ruleIds(result), ['SSH-BRUTE-FORCE', 'SSH-PRIVILEGED-TARGET']);
  assert.equal(result.alerts.length, 2);
  assert.ok(result.alerts.every((a) => a.ip === '203.0.113.45'));
});

test('skenario password spraying hanya memicu aturan spraying', () => {
  const result = analyzeLogText(generateScenario('password-spray'));
  assert.deepEqual(ruleIds(result), ['SSH-PASSWORD-SPRAY']);
});

test('skenario akun dibobol memicu alert critical', () => {
  const result = analyzeLogText(generateScenario('compromised'));
  const critical = result.alerts.find((a) => a.ruleId === 'SSH-SUCCESS-AFTER-FAILURES');
  assert.ok(critical);
  assert.equal(critical.severity, 'critical');
  assert.equal(critical.user, 'deploy');
  assert.equal(result.summary.topSeverity, 'critical');
});

test('skenario tidak dikenal ditolak', () => {
  assert.throws(() => generateScenario('ddos'), /Skenario tidak dikenal/);
});
