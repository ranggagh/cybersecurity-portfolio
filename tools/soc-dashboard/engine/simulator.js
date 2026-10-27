/**
 * Simulator auth.log SSH dengan seed tetap (hasil selalu sama untuk seed yang sama).
 * Menghasilkan TEKS log biasa yang diproses persis seperti file unggahan.
 * Semua IP memakai rentang dokumentasi RFC 5737 (198.51.100.0/24, 203.0.113.0/24).
 */

export const DEFAULT_SEED = 1337;

export const SCENARIOS = [
  {
    id: 'brute-force',
    name: 'Brute force biasa',
    description: 'Satu IP menebak password root/admin ratusan kali dalam beberapa menit.'
  },
  {
    id: 'password-spray',
    name: 'Password spraying',
    description: 'Satu IP mencoba banyak username berbeda dengan pelan, di bawah ambang brute force.'
  },
  {
    id: 'compromised',
    name: 'Akun berhasil dibobol',
    description: 'Brute force ke akun "deploy" yang diakhiri login berhasil dari IP penyerang.'
  },
  {
    id: 'normal',
    name: 'Aktivitas normal saja',
    description: 'Hanya pengguna biasa, termasuk yang salah password 1-2 kali. Tidak boleh memicu alert.'
  }
];

const HOST = 'web-01';
// Tanggal teks log saja; syslog tidak menyimpan tahun, jadi parser memakai tahun berjalan
const BASE_TIME = Date.UTC(2000, 2, 14, 8, 0, 0);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NORMAL_USERS = [
  { user: 'alice', ip: '198.51.100.21', method: 'password' },
  { user: 'bob', ip: '198.51.100.34', method: 'password' },
  { user: 'carol', ip: '198.51.100.47', method: 'password' },
  { user: 'dave', ip: '198.51.100.58', method: 'password' },
  { user: 'admin', ip: '198.51.100.10', method: 'password' },
  { user: 'deploy', ip: '198.51.100.99', method: 'publickey' }
];

const SPRAY_USERNAMES = [
  'oracle', 'test', 'ubuntu', 'guest', 'postgres', 'git', 'ftpuser', 'pi',
  'support', 'backup', 'mysql', 'jenkins', 'demo', 'user1', 'hadoop'
];

/** PRNG mulberry32: kecil, cepat, deterministik. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)]
  };
}

/**
 * @param {string} scenarioId  salah satu SCENARIOS[].id
 * @param {{ seed?: number }} [options]
 * @returns {string} isi auth.log
 */
export function generateScenario(scenarioId, options = {}) {
  if (!SCENARIOS.some((s) => s.id === scenarioId)) {
    throw new Error(`Skenario tidak dikenal: ${scenarioId}`);
  }
  const rng = createRng(options.seed ?? DEFAULT_SEED);
  const log = createLogWriter(rng);

  addNormalActivity(log, rng);
  if (scenarioId === 'brute-force') addBruteForce(log, rng);
  if (scenarioId === 'password-spray') addPasswordSpray(log, rng);
  if (scenarioId === 'compromised') addCompromise(log, rng);

  return log.render();
}

function createLogWriter(rng) {
  const entries = [];
  return {
    // t = detik sejak BASE_TIME
    sshd(t, message) {
      entries.push({ t, program: `sshd[${rng.int(1000, 65000)}]`, message });
    },
    other(t, program, message) {
      entries.push({ t, program, message });
    },
    render() {
      return entries
        .map((e, i) => ({ ...e, i }))
        .sort((a, b) => a.t - b.t || a.i - b.i)
        .map((e) => `${syslogTime(e.t)} ${HOST} ${e.program}: ${e.message}`)
        .join('\n') + '\n';
    }
  };
}

function syslogTime(t) {
  const d = new Date(BASE_TIME + t * 1000);
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const time = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return `${MONTH_NAMES[d.getUTCMonth()]} ${day} ${time}`;
}

const port = (rng) => rng.int(32768, 60999);

/**
 * Pengguna normal selama ~3 jam. Sesi tiap pengguna berjarak >= 20 menit dan paling banyak
 * 2 salah password per sesi, sehingga tidak boleh memicu aturan mana pun.
 */
function addNormalActivity(log, rng) {
  const DURATION = 3 * 3600;

  NORMAL_USERS.forEach((u, idx) => {
    let t = rng.int(60, 900) + idx * 30;
    let session = 0;
    while (t < DURATION) {
      // Pastikan selalu ada contoh salah ketik: sesi pertama alice & admin gagal 2 kali, bob 1 kali
      let typos = 0;
      if (session === 0 && (u.user === 'alice' || u.user === 'admin')) typos = 2;
      else if (session === 0 && u.user === 'bob') typos = 1;
      else if (u.method === 'password') {
        const r = rng.next();
        typos = r < 0.1 ? 2 : r < 0.3 ? 1 : 0;
      }

      for (let k = 0; k < typos; k++) {
        log.sshd(t, `Failed password for ${u.user} from ${u.ip} port ${port(rng)} ssh2`);
        t += rng.int(4, 12);
      }
      const p = port(rng);
      log.sshd(t, `Accepted ${u.method} for ${u.user} from ${u.ip} port ${p} ssh2`);
      log.sshd(t, `pam_unix(sshd:session): session opened for user ${u.user}(uid=${1000 + idx}) by (uid=0)`);
      if (u.user === 'admin' || u.user === 'alice') {
        log.other(t + rng.int(20, 90), 'sudo', `${u.user} : TTY=pts/0 ; PWD=/home/${u.user} ; USER=root ; COMMAND=/usr/bin/systemctl status nginx`);
      }
      const end = t + rng.int(120, 1500);
      log.sshd(end, `Received disconnect from ${u.ip} port ${p}:11: disconnected by user`);
      log.sshd(end, `pam_unix(sshd:session): session closed for user ${u.user}`);

      t = end + rng.int(1200, 3600);
      session++;
    }
  });

  for (let t = 0; t < DURATION; t += 900) {
    log.other(t + 1, `CRON[${rng.int(1000, 65000)}]`, 'pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)');
  }
}

function addBruteForce(log, rng) {
  const ip = '203.0.113.45';
  let t = 40 * 60;
  for (let i = 0; i < 180; i++) {
    const user = rng.next() < 0.8 ? 'root' : 'admin';
    log.sshd(t, `Failed password for ${user} from ${ip} port ${port(rng)} ssh2`);
    if (i % 6 === 5) {
      log.sshd(t + 1, `Connection closed by authenticating user ${user} ${ip} port ${port(rng)} [preauth]`);
    }
    t += rng.int(1, 3);
  }
}

function addPasswordSpray(log, rng) {
  const ip = '203.0.113.77';
  let t = 50 * 60;
  for (const user of SPRAY_USERNAMES) {
    const p = port(rng);
    log.sshd(t, `Invalid user ${user} from ${ip} port ${p}`);
    log.sshd(t + 1, `Failed password for invalid user ${user} from ${ip} port ${p} ssh2`);
    // Jarak 25-45 detik: paling banyak 3 percobaan per menit, di bawah ambang brute force
    t += rng.int(25, 45);
  }
}

function addCompromise(log, rng) {
  const ip = '203.0.113.99';
  let t = 70 * 60;
  for (let i = 0; i < 40; i++) {
    log.sshd(t, `Failed password for deploy from ${ip} port ${port(rng)} ssh2`);
    t += rng.int(2, 4);
  }
  const p = port(rng);
  log.sshd(t, `Accepted password for deploy from ${ip} port ${p} ssh2`);
  log.sshd(t, `pam_unix(sshd:session): session opened for user deploy(uid=1005) by (uid=0)`);
}
