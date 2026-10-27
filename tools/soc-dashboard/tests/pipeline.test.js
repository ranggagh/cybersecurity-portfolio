import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLogText } from '../engine/pipeline.js';

test('file biner ditolak', () => {
  const result = analyzeLogText('\u001f\u008b\u0008\u0000binary');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BINARY');
});

test('file kosong dan format lain ditolak dengan pesan jelas', () => {
  assert.equal(analyzeLogText('').code, 'EMPTY');
  const csv = analyzeLogText('time,user,ip\n2025-03-14,root,203.0.113.5');
  assert.equal(csv.ok, false);
  assert.equal(csv.code, 'UNSUPPORTED_FORMAT');
  assert.match(csv.message, /auth\.log SSH/);
});

test('log tanpa serangan: ok, 0 alert, ringkasan terisi', () => {
  const result = analyzeLogText([
    'Mar 14 08:00:05 web-01 sshd[1]: Failed password for alice from 198.51.100.21 port 1 ssh2',
    'Mar 14 08:00:12 web-01 sshd[2]: Accepted password for alice from 198.51.100.21 port 2 ssh2',
    'garbage line'
  ].join('\n'), { year: 2025 });
  assert.equal(result.ok, true);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.summary.eventCount, 2);
  assert.equal(result.summary.failureCount, 1);
  assert.equal(result.summary.successCount, 1);
  assert.equal(result.summary.topSeverity, null);
  assert.equal(result.stats.unrecognizedLines, 1);
});

test('ringkasan menghitung pasangan Invalid user + Failed password sebagai satu percobaan', () => {
  const result = analyzeLogText([
    'Mar 14 08:00:04 web-01 sshd[1]: Invalid user test from 203.0.113.9 port 4022',
    'Mar 14 08:00:05 web-01 sshd[1]: Failed password for invalid user test from 203.0.113.9 port 4022 ssh2'
  ].join('\n'), { year: 2025 });
  assert.equal(result.summary.eventCount, 2);
  assert.equal(result.summary.attemptCount, 1);
  assert.equal(result.summary.failureCount, 1);
});
