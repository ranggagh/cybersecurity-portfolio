import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthLog, validateFormat } from '../engine/parser.js';

const parse = (text, year = 2025) => parseAuthLog(text, { year });

test('Failed password → event gagal dengan field lengkap', () => {
  const raw = 'Mar 14 08:00:05 web-01 sshd[2211]: Failed password for root from 203.0.113.5 port 52144 ssh2';
  const { events } = parse(raw);
  assert.equal(events.length, 1);
  assert.deepEqual(
    { ...events[0] },
    {
      ts: new Date(2025, 2, 14, 8, 0, 5).getTime(),
      host: 'web-01',
      user: 'root',
      ip: '203.0.113.5',
      action: 'login',
      result: 'failure',
      raw,
      lineNo: 1
    }
  );
});

test('Failed password for invalid user → user diambil, tetap login gagal', () => {
  const { events } = parse('Mar 14 08:00:05 web-01 sshd[2211]: Failed password for invalid user oracle from 203.0.113.9 port 4022 ssh2');
  assert.equal(events[0].user, 'oracle');
  assert.equal(events[0].action, 'login');
  assert.equal(events[0].result, 'failure');
});

test('Accepted password dan publickey → event berhasil', () => {
  const { events } = parse([
    'Mar 14 08:01:00 web-01 sshd[1]: Accepted password for alice from 198.51.100.21 port 50000 ssh2',
    'Mar 14 08:02:00 web-01 sshd[2]: Accepted publickey for deploy from 198.51.100.99 port 50001 ssh2: ED25519 SHA256:abc'
  ].join('\n'));
  assert.deepEqual(events.map((e) => [e.user, e.result]), [['alice', 'success'], ['deploy', 'success']]);
});

test('Invalid user → action invalid_user', () => {
  const { events } = parse('Mar 14 08:00:04 web-01 sshd[2210]: Invalid user test from 203.0.113.9 port 4022');
  assert.equal(events[0].action, 'invalid_user');
  assert.equal(events[0].user, 'test');
  assert.equal(events[0].ip, '203.0.113.9');
});

test('sshd-session (OpenSSH 9.8+) dan timestamp ISO dikenali', () => {
  const { events } = parse([
    'Mar 14 08:00:05 web-01 sshd-session[9]: Failed password for root from 203.0.113.5 port 1 ssh2',
    '2025-03-14T08:00:06.123456+07:00 web-01 sshd[10]: Failed password for root from 203.0.113.5 port 2 ssh2'
  ].join('\n'));
  assert.equal(events.length, 2);
  assert.equal(events.find((e) => e.lineNo === 2).ts, Date.parse('2025-03-14T08:00:06.123+07:00'));
});

test('"message repeated N times" menghasilkan N event', () => {
  const { events, stats } = parse(
    'Mar 14 08:00:05 web-01 sshd[1]: message repeated 3 times: [ Failed password for root from 203.0.113.5 port 22 ssh2]'
  );
  assert.equal(events.length, 3);
  assert.equal(stats.eventLines, 1);
});

test('baris rusak dilewati dan dihitung; baris auth.log lain diabaikan', () => {
  const { events, stats } = parse([
    'Mar 14 08:00:05 web-01 sshd[1]: Failed password for root from 203.0.113.5 port 22 ssh2',
    'ini bukan baris log',
    'Mar 14 08:00',                                                     // terpotong
    'Mar 14 08:00:06 web-01 CRON[5]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)',
    'Mar 14 08:00:07 web-01 sshd[1]: Connection closed by 203.0.113.5 port 22 [preauth]',
    'Mar 14 08:00:08 web-01 sshd[1]: Failed password for root from not-an-ip port 22 ssh2',
    ''
  ].join('\n'));
  assert.equal(events.length, 1);
  assert.equal(stats.totalLines, 6);
  assert.equal(stats.unrecognizedLines, 2);
  assert.equal(stats.ignoredLines, 3);
  assert.deepEqual(stats.unrecognizedSamples.map((s) => s.lineNo), [2, 3]);
});

test('log tanpa tahun memakai tahun yang diberikan, default tahun berjalan', () => {
  const line = 'Mar 14 08:00:05 web-01 sshd[1]: Failed password for root from 203.0.113.5 port 22 ssh2';
  assert.equal(new Date(parseAuthLog(line, { year: 2023 }).events[0].ts).getFullYear(), 2023);
  assert.equal(new Date(parseAuthLog(line).events[0].ts).getFullYear(), new Date().getFullYear());
});

test('pergantian tahun Des → Jan: bagian akhir log memakai tahun berjalan', () => {
  const { events } = parse([
    'Dec 31 23:59:58 web-01 sshd[1]: Failed password for root from 203.0.113.5 port 22 ssh2',
    'Jan  1 00:00:03 web-01 sshd[1]: Failed password for root from 203.0.113.5 port 22 ssh2'
  ].join('\n'));
  assert.equal(new Date(events[0].ts).getFullYear(), 2024);
  assert.equal(new Date(events[1].ts).getFullYear(), 2025);
  assert.equal(events[1].ts - events[0].ts, 5000);
});

test('validateFormat menolak file kosong, format lain, dan syslog tanpa sshd', () => {
  assert.equal(validateFormat(parse('').stats).code, 'EMPTY');
  assert.equal(validateFormat(parse('\n  \n').stats).code, 'EMPTY');
  assert.equal(validateFormat(parse('{"event":"login"}\n{"event":"logout"}').stats).code, 'UNSUPPORTED_FORMAT');
  assert.equal(
    validateFormat(parse('127.0.0.1 - - [10/Oct/2025:13:55:36 +0700] "GET / HTTP/1.1" 200 2326').stats).code,
    'UNSUPPORTED_FORMAT'
  );
  assert.equal(
    validateFormat(parse('Mar 14 08:00:06 web-01 CRON[5]: pam_unix(cron:session): session opened').stats).code,
    'NO_SSHD'
  );
  assert.equal(
    validateFormat(parse('Mar 14 08:00:05 web-01 sshd[1]: Accepted password for a from 198.51.100.1 port 1 ssh2').stats).ok,
    true
  );
});
