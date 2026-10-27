/**
 * Parser auth.log SSH (sshd via syslog).
 * Modul murni: tidak menyentuh DOM, bisa dipakai di browser, Web Worker, dan Node.
 *
 * Format yang didukung (hanya auth.log SSH):
 *   Oct 27 16:38:52 web-01 sshd[1234]: Failed password for root from 203.0.113.5 port 22 ssh2
 *   2026-10-27T16:38:52.123456+07:00 web-01 sshd[1234]: ...   (timestamp ISO, rsyslog modern)
 *
 * Event: { ts, host, user, ip, action, result, raw, lineNo }
 *   action: 'login' (Failed/Accepted ...) | 'invalid_user' (Invalid user ...)
 *   result: 'failure' | 'success'
 */

export const SUPPORTED_FORMAT_LABEL = 'auth.log SSH (syslog sshd)';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const SYSLOG_LINE = /^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\S+) ([^\s[:]+)(?:\[\d+\])?: ?(.*)$/;
const ISO_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+(\S+) ([^\s[:]+)(?:\[\d+\])?: ?(.*)$/;
const SSHD_PROGRAM = /^sshd(?:-session)?$/;

const FAILED = /^Failed (?:password|keyboard-interactive\/pam) for (invalid user )?(.*?) from (\S+) port \d+/;
const ACCEPTED = /^Accepted (?:password|publickey|keyboard-interactive\/pam) for (\S+) from (\S+) port \d+/;
const INVALID_USER = /^Invalid user (.*?) from (\S+)(?: port \d+)?\s*$/;
const REPEATED = /^message repeated (\d+) times: \[\s*(.*?)\s*\]$/;
const IP_ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]*:[0-9a-fA-F:.]+)$/;

// Batas wajar untuk "message repeated N times" agar file rusak tidak meledakkan memori
const MAX_REPEAT = 10000;

/**
 * @param {string} text  isi file auth.log
 * @param {{ year?: number }} [options]  tahun untuk baris syslog tanpa tahun (default: tahun berjalan)
 * @returns {{ events: object[], stats: object }}
 */
export function parseAuthLog(text, options = {}) {
  const baseYear = options.year || new Date().getFullYear();
  const lines = String(text).split(/\r?\n/);

  const pending = [];
  const stats = {
    totalLines: 0,      // baris tidak kosong
    syslogLines: 0,     // baris berformat syslog (program apa pun)
    sshdLines: 0,       // baris dari sshd
    eventLines: 0,      // baris yang menghasilkan event login
    ignoredLines: 0,    // baris auth.log valid tapi bukan event login (CRON, sudo, sshd lain)
    unrecognizedLines: 0,
    unrecognizedSamples: []
  };

  // Log syslog tanpa tahun: hitung pergantian tahun (Des → Jan) agar urutan waktu tetap benar
  let prevMonth = null;
  let yearEpoch = 0;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim() === '') return;
    stats.totalLines++;

    const header = matchHeader(line);
    if (!header) {
      stats.unrecognizedLines++;
      if (stats.unrecognizedSamples.length < 3) stats.unrecognizedSamples.push({ lineNo, text: line.slice(0, 200) });
      return;
    }
    stats.syslogLines++;

    if (header.month !== undefined) {
      if (prevMonth !== null && header.month < prevMonth - 6) yearEpoch++;
      prevMonth = header.month;
    }

    if (!SSHD_PROGRAM.test(header.program)) {
      stats.ignoredLines++;
      return;
    }
    stats.sshdLines++;

    let message = header.message;
    let repeat = 1;
    const repeated = REPEATED.exec(message);
    if (repeated) {
      repeat = Math.min(parseInt(repeated[1], 10), MAX_REPEAT);
      message = repeated[2];
    }

    const parsed = parseSshdMessage(message);
    if (!parsed) {
      stats.ignoredLines++;
      return;
    }

    stats.eventLines++;
    for (let i = 0; i < repeat; i++) {
      pending.push({ header, parsed, raw: line, lineNo, yearEpoch });
    }
  });

  const events = pending.map(({ header, parsed, raw, lineNo, yearEpoch: epoch }) => ({
    ts: header.ts !== undefined ? header.ts : syslogTimestamp(header, baseYear - (yearEpoch - epoch)),
    host: header.host,
    user: parsed.user,
    ip: parsed.ip,
    action: parsed.action,
    result: parsed.result,
    raw,
    lineNo
  }));

  // Urutkan stabil berdasarkan waktu (baris dengan detik sama tetap berurutan sesuai file)
  events.sort((a, b) => a.ts - b.ts || a.lineNo - b.lineNo);
  return { events, stats };
}

function matchHeader(line) {
  let m = SYSLOG_LINE.exec(line);
  if (m && MONTHS[m[1]] !== undefined) {
    return {
      month: MONTHS[m[1]],
      day: parseInt(m[2], 10),
      hour: parseInt(m[3], 10),
      minute: parseInt(m[4], 10),
      second: parseInt(m[5], 10),
      host: m[6],
      program: m[7],
      message: m[8]
    };
  }
  m = ISO_LINE.exec(line);
  if (m) {
    const ts = Date.parse(m[1]);
    if (Number.isNaN(ts)) return null;
    return { ts, host: m[2], program: m[3], message: m[4] };
  }
  return null;
}

function syslogTimestamp(h, year) {
  // Waktu syslog adalah waktu lokal server tanpa zona; dibaca sebagai waktu lokal browser
  return new Date(year, h.month, h.day, h.hour, h.minute, h.second).getTime();
}

/** Mengurai pesan sshd menjadi { action, result, user, ip } atau null jika bukan event login. */
export function parseSshdMessage(message) {
  let m = FAILED.exec(message);
  if (m && IP_ADDRESS.test(m[3])) {
    return { action: 'login', result: 'failure', user: m[2], ip: m[3], invalidUser: Boolean(m[1]) };
  }
  m = ACCEPTED.exec(message);
  if (m && IP_ADDRESS.test(m[2])) {
    return { action: 'login', result: 'success', user: m[1], ip: m[2] };
  }
  m = INVALID_USER.exec(message);
  if (m && IP_ADDRESS.test(m[2])) {
    return { action: 'invalid_user', result: 'failure', user: m[1], ip: m[2] };
  }
  return null;
}

/**
 * Menolak file yang bukan auth.log SSH dengan pesan yang jelas.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function validateFormat(stats) {
  if (stats.totalLines === 0) {
    return { ok: false, code: 'EMPTY', message: 'File kosong. Tidak ada baris log untuk dianalisis.' };
  }
  if (stats.syslogLines / stats.totalLines < 0.5) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FORMAT',
      message:
        `Format file tidak didukung. Tool ini hanya mendukung ${SUPPORTED_FORMAT_LABEL}, ` +
        'contoh baris: "Oct 27 16:38:52 web-01 sshd[1234]: Failed password for root from 203.0.113.5 port 22 ssh2".'
    };
  }
  if (stats.sshdLines === 0) {
    return {
      ok: false,
      code: 'NO_SSHD',
      message: 'File berformat syslog, tetapi tidak berisi baris sshd. Pastikan yang diunggah adalah auth.log (atau secure) dari server SSH.'
    };
  }
  return { ok: true };
}
