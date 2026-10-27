/**
 * Aturan deteksi SSH sebagai objek konfigurasi.
 * Threshold, window, dan severity cukup diubah di sini; logikanya ada di detector.js.
 *
 * Tipe aturan yang dikenali detector.js:
 * - 'sliding-count'           >= threshold event cocok (where) dari satu IP dalam windowSec
 * - 'sliding-distinct'        >= threshold nilai `distinctField` berbeda dari satu IP dalam windowSec
 * - 'success-after-failures'  login sukses dari IP yang punya >= threshold kegagalan dalam windowSec terakhir
 */

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

// Alert dengan aturan + IP sama digabung jika jeda antar pemicunya <= mergeGapSec
export const DEFAULT_MERGE_GAP_SEC = 300;

export const DEFAULT_RULES = [
  {
    id: 'SSH-BRUTE-FORCE',
    name: 'SSH Brute Force',
    type: 'sliding-count',
    where: { result: 'failure' },
    threshold: 5,
    windowSec: 60,
    severity: 'medium',
    // Naik severity jika total percobaan dalam satu alert besar
    escalate: [{ minCount: 50, severity: 'high' }],
    mitre: { id: 'T1110.001', name: 'Brute Force: Password Guessing' },
    describe: (a, r) =>
      `${a.count} login gagal dari ${a.ip} (minimal ${r.threshold} dalam ${formatWindow(r.windowSec)}) terhadap ${formatUsers(a.users)}.`
  },
  {
    id: 'SSH-SUCCESS-AFTER-FAILURES',
    name: 'Login Berhasil Setelah Gagal',
    type: 'success-after-failures',
    threshold: 5,
    windowSec: 600,
    severity: 'critical',
    mitre: { id: 'T1078', name: 'Valid Accounts' },
    describe: (a, r) =>
      `Login BERHASIL sebagai ${formatUsers(a.successUsers)} dari ${a.ip} setelah ${a.failureCount} login gagal ` +
      `(minimal ${r.threshold} dalam ${formatWindow(r.windowSec)} sebelumnya). Kemungkinan akun berhasil dibobol.`
  },
  {
    id: 'SSH-PASSWORD-SPRAY',
    name: 'Password Spraying',
    type: 'sliding-distinct',
    where: { result: 'failure' },
    distinctField: 'user',
    threshold: 5,
    windowSec: 600,
    severity: 'high',
    mitre: { id: 'T1110.003', name: 'Brute Force: Password Spraying' },
    describe: (a, r) =>
      `${a.ip} gagal login ke ${a.users.length} username berbeda (minimal ${r.threshold} dalam ${formatWindow(r.windowSec)}): ${formatUsers(a.users)}.`
  },
  {
    id: 'SSH-PRIVILEGED-TARGET',
    name: 'Serangan ke Akun Privileged',
    type: 'sliding-count',
    where: { result: 'failure', userIn: ['root', 'admin'] },
    threshold: 3,
    windowSec: 300,
    severity: 'medium',
    mitre: { id: 'T1110', name: 'Brute Force' },
    describe: (a, r) =>
      `${a.count} login gagal ke akun privileged (${formatUsers(a.users)}) dari ${a.ip} ` +
      `(minimal ${r.threshold} dalam ${formatWindow(r.windowSec)}).`
  }
];

export function formatWindow(sec) {
  return sec % 60 === 0 ? `${sec / 60} menit` : `${sec} detik`;
}

export function formatUsers(users, max = 5) {
  if (!users || users.length === 0) return '(tidak diketahui)';
  const shown = users.slice(0, max).join(', ');
  return users.length > max ? `${shown}, +${users.length - max} lainnya` : shown;
}
