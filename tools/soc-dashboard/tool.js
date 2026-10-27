/**
 * SOC Monitoring Dashboard — UI
 * Sumber log (simulasi atau unggahan) → engine/pipeline.js (di Web Worker) → dashboard.
 *
 * Keamanan: isi log adalah input tidak tepercaya. Semua teks dari log dimasukkan lewat
 * textContent / append(string); tidak ada innerHTML di file ini.
 */

import { SCENARIOS, DEFAULT_SEED, generateScenario } from './engine/simulator.js';
import { analyzeLogText } from './engine/pipeline.js';
import { SEVERITY_ORDER } from './engine/rules.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EVIDENCE_LINES = 300;
const TOP_IP_LIMIT = 8;
const ALLOWED_MIME = /^(text\/.*|application\/octet-stream|)$/;
const BLOCKED_EXTENSIONS = /\.(gz|tgz|zip|bz2|xz|7z|tar|rar|evtx|exe|dll|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp)$/i;
const SEVERITY_ICON = { critical: '◆', high: '▲', medium: '●', low: '○' };

const $ = (id) => document.getElementById(id);

const state = {
  result: null,
  sourceLabel: '',
  lastFocused: null
};

/* --------------------------------------------------------------------------
   DOM helpers (aman untuk input tidak tepercaya)
   -------------------------------------------------------------------------- */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...[].concat(children).filter((c) => c !== null && c !== undefined));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function severityBadge(severity) {
  return el('span', { class: `soc-sev soc-sev-${severity}` }, [
    el('span', { class: 'soc-sev-icon', 'aria-hidden': 'true', text: SEVERITY_ICON[severity] || '•' }),
    severity.toUpperCase()
  ]);
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Log syslog tidak menyimpan tahun, jadi tampilan waktu sengaja tanpa tahun
function formatTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())} ${MONTHS_ID[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatClock(ts, withSeconds = false) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.floor(s / 60)} menit ${s % 60} detik`;
  return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;
}

function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const numberFmt = new Intl.NumberFormat('id-ID');
const fmt = (n) => numberFmt.format(n);

/* --------------------------------------------------------------------------
   Analisis (Web Worker, dengan fallback ke thread utama)
   -------------------------------------------------------------------------- */
let worker = null;
let workerBroken = false;
let jobSeq = 0;
const jobs = new Map();

function analyze(text) {
  const options = {};
  if (workerBroken || typeof Worker === 'undefined') {
    return Promise.resolve(analyzeLogText(text, options));
  }

  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' });
        worker.addEventListener('message', (e) => {
          const job = jobs.get(e.data.id);
          if (!job) return;
          jobs.delete(e.data.id);
          if (e.data.error) job.reject(new Error(e.data.error));
          else job.resolve(e.data.result);
        });
        worker.addEventListener('error', (e) => {
          // Browser tanpa dukungan module worker: jalankan pipeline yang sama di thread utama
          console.warn('[SOC] Worker tidak tersedia, analisis dijalankan di thread utama.', e.message);
          e.preventDefault();
          workerBroken = true;
          worker = null;
          for (const [id, job] of jobs) {
            jobs.delete(id);
            try { job.resolve(analyzeLogText(job.text, options)); } catch (err) { job.reject(err); }
          }
        });
      }
      const id = ++jobSeq;
      jobs.set(id, { resolve, reject, text });
      worker.postMessage({ id, text, options });
    } catch (err) {
      workerBroken = true;
      resolve(analyzeLogText(text, options));
    }
  });
}

async function runAnalysis(text, sourceLabel) {
  setBusy(true);
  showMessage('Menganalisis log...', 'info');
  try {
    const result = await analyze(text);
    if (!result.ok) {
      showAnalysisError(result);
      return;
    }
    hideMessage();
    state.result = result;
    state.sourceLabel = sourceLabel;
    renderResults();
  } catch (err) {
    console.error('[SOC] Analysis failed:', err);
    showMessage(`Analisis gagal: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function showAnalysisError(result) {
  const sample = result.stats && result.stats.unrecognizedSamples && result.stats.unrecognizedSamples[0];
  const message = sample && result.code === 'UNSUPPORTED_FORMAT'
    ? `${result.message} Baris ${sample.lineNo} di file kamu: "${sample.text}"`
    : result.message;
  showMessage(message, 'error');
  setStatus('ERROR');
}

/* --------------------------------------------------------------------------
   Layar sumber data
   -------------------------------------------------------------------------- */
function initSourceScreen() {
  const list = $('scenario-list');
  SCENARIOS.forEach((s, i) => {
    list.append(
      el('label', { class: 'soc-scenario' }, [
        el('input', { type: 'radio', name: 'scenario', value: s.id, checked: i === 0 }),
        el('span', { class: 'soc-scenario-text' }, [
          el('span', { class: 'soc-scenario-name', text: s.name }),
          el('span', { class: 'soc-muted', text: s.description })
        ])
      ])
    );
  });

  $('btn-run-sim').addEventListener('click', () => {
    const selected = document.querySelector('input[name="scenario"]:checked');
    const scenario = SCENARIOS.find((s) => s.id === selected.value);
    const text = generateScenario(scenario.id, { seed: DEFAULT_SEED });
    runAnalysis(text, `Simulasi: ${scenario.name} (seed ${DEFAULT_SEED})`);
  });

  $('file-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  const dropzone = $('dropzone');
  ['dragenter', 'dragover'].forEach((type) =>
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    })
  );
  ['dragleave', 'drop'].forEach((type) =>
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover'))
  );
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFile(files[0]);
  });

  $('btn-download-sample').addEventListener('click', downloadSample);
  $('btn-new-analysis').addEventListener('click', showSourceScreen);
}

function validateFile(file) {
  if (file.size === 0) return 'File kosong. Pilih file auth.log yang berisi log.';
  if (file.size > MAX_FILE_BYTES) {
    const mb = (Math.ceil((file.size / 1024 / 1024) * 10) / 10).toFixed(1);
    return `File terlalu besar (${mb} MB). Batas maksimal 10 MB. Ambil sebagian log saja, misalnya dengan ` +
      '"tail -n 50000 auth.log > auth-sebagian.log", lalu unggah lagi.';
  }
  if (BLOCKED_EXTENSIONS.test(file.name)) {
    return `"${file.name}" tampaknya file terkompresi atau bukan teks. Ekstrak dulu (misalnya "gunzip auth.log.2.gz") ` +
      'lalu unggah file auth.log-nya.';
  }
  if (!ALLOWED_MIME.test(file.type || '')) {
    return `Tipe file "${file.type}" tidak didukung. Unggah file teks auth.log (biasanya .log, .txt, atau tanpa ekstensi).`;
  }
  return null;
}

async function handleFile(file) {
  const error = validateFile(file);
  if (error) {
    showMessage(error, 'error');
    $('file-input').value = '';
    return;
  }

  setBusy(true);
  showMessage(`Membaca ${file.name}...`, 'info');
  let text;
  try {
    // File.text() membaca secara asinkron sehingga UI tidak membeku
    text = await file.text();
  } catch (err) {
    setBusy(false);
    showMessage(`File tidak bisa dibaca: ${err.message}`, 'error');
    return;
  }
  setBusy(false);
  await runAnalysis(text, `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  $('file-input').value = '';
}

function downloadSample() {
  const text = generateScenario('compromised', { seed: DEFAULT_SEED });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = el('a', { href: url, download: 'contoh-auth.log' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showSourceScreen() {
  closeDetail();
  state.result = null;
  $('results-screen').hidden = true;
  $('source-screen').hidden = false;
  hideMessage();
  setStatus('READY');
}

/* --------------------------------------------------------------------------
   Status & pesan
   -------------------------------------------------------------------------- */
function setBusy(busy) {
  ['btn-run-sim', 'btn-download-sample', 'file-input'].forEach((id) => { $(id).disabled = busy; });
  $('dropzone').classList.toggle('is-disabled', busy);
  if (busy) setStatus('ANALYZING');
}

function setStatus(text) {
  $('workspace-status').textContent = text;
}

function showMessage(text, type) {
  const box = $('soc-message');
  box.hidden = false;
  box.className = `auth-alert soc-message alert-${type}`;
  box.textContent = text;
}

function hideMessage() {
  $('soc-message').hidden = true;
}

/* --------------------------------------------------------------------------
   Hasil analisis
   -------------------------------------------------------------------------- */
function renderResults() {
  const { summary, stats, attempts } = state.result;

  $('source-screen').hidden = true;
  $('results-screen').hidden = false;
  setStatus(summary.alertCount ? `${summary.alertCount} ALERT` : 'CLEAN');

  $('result-source').textContent = state.sourceLabel;
  const statParts = [
    `${fmt(stats.totalLines)} baris dibaca`,
    `${fmt(summary.eventCount)} event login`,
    `${fmt(stats.ignoredLines)} baris auth.log lain diabaikan (CRON, sudo, sesi sshd)`
  ];
  if (stats.unrecognizedLines > 0) {
    const lines = stats.unrecognizedSamples.map((s) => s.lineNo).join(', ');
    statParts.push(`${fmt(stats.unrecognizedLines)} baris tidak dikenali dilewati (contoh: baris ${lines})`);
  }
  $('result-stats').textContent = statParts.join(' · ');

  $('sum-events').textContent = fmt(summary.eventCount);
  $('sum-events-desc').textContent =
    `${fmt(summary.failureCount)} gagal · ${fmt(summary.successCount)} berhasil · ${fmt(summary.uniqueIps)} IP`;
  $('sum-alerts').textContent = fmt(summary.alertCount);
  $('sum-alerts-desc').textContent = summary.alertCount
    ? SEVERITY_ORDER.slice().reverse().filter((s) => summary.bySeverity[s]).map((s) => `${summary.bySeverity[s]} ${s}`).join(' · ')
    : 'Tidak ada';

  const top = $('sum-top');
  top.replaceChildren(summary.topSeverity ? severityBadge(summary.topSeverity) : '—');
  $('sum-top-desc').textContent = summary.topSeverity
    ? topAlertName(state.result.alerts, summary.topSeverity)
    : 'Tidak ada pola mencurigakan';

  const banner = $('no-alert-banner');
  banner.hidden = summary.alertCount > 0;
  banner.replaceChildren(
    el('strong', { text: `${fmt(summary.eventCount)} event dianalisis, tidak ada pola mencurigakan.` }),
    ' Aturan yang diperiksa: brute force, login berhasil setelah gagal, password spraying, dan serangan ke akun privileged.'
  );

  initFilters(attempts);
  applyFilters();
  $('results-screen').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function topAlertName(alerts, severity) {
  const alert = alerts.find((a) => a.severity === severity);
  return alert ? `${alert.ruleName} · ${alert.ip}` : '';
}

/* --------------------------------------------------------------------------
   Filter
   -------------------------------------------------------------------------- */
function initFilters(attempts) {
  const failuresByIp = new Map();
  for (const e of attempts) {
    if (!failuresByIp.has(e.ip)) failuresByIp.set(e.ip, 0);
    if (e.result === 'failure') failuresByIp.set(e.ip, failuresByIp.get(e.ip) + 1);
  }
  const ips = [...failuresByIp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  $('filter-ip').replaceChildren(
    el('option', { value: '', text: `Semua IP (${ips.length})` }),
    ...ips.map(([ip, n]) => el('option', { value: ip, text: `${ip} (${fmt(n)} gagal)` }))
  );
  $('filter-severity').value = '';

  const { firstTs, lastTs } = state.result.summary;
  for (const id of ['filter-from', 'filter-to']) {
    const input = $(id);
    input.value = '';
    if (firstTs !== null) {
      input.min = toLocalInput(firstTs);
      input.max = toLocalInput(lastTs);
    }
  }
}

function currentFilters() {
  const from = $('filter-from').value ? new Date($('filter-from').value).getTime() : -Infinity;
  const to = $('filter-to').value ? new Date($('filter-to').value).getTime() + 999 : Infinity;
  return { ip: $('filter-ip').value, severity: $('filter-severity').value, from, to };
}

function applyFilters() {
  if (!state.result) return;
  const f = currentFilters();
  const attempts = state.result.attempts.filter((e) => (!f.ip || e.ip === f.ip) && e.ts >= f.from && e.ts <= f.to);
  const alerts = state.result.alerts.filter((a) =>
    (!f.ip || a.ip === f.ip) &&
    (!f.severity || a.severity === f.severity) &&
    a.lastSeen >= f.from && a.firstSeen <= f.to
  );

  renderChart(attempts, f);
  renderTopIps(attempts);
  renderAlertTable(alerts);
}

function initFilterEvents() {
  const form = $('filters');
  form.addEventListener('input', applyFilters);
  form.addEventListener('change', applyFilters);
  form.addEventListener('submit', (e) => e.preventDefault());
  // Nilai form baru kembali ke default setelah event reset selesai
  form.addEventListener('reset', () => setTimeout(applyFilters, 0));
}

/* --------------------------------------------------------------------------
   Grafik aktivitas (gagal vs berhasil per waktu)
   -------------------------------------------------------------------------- */
const BUCKET_STEPS = [60, 300, 600, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 7 * 86400].map((s) => s * 1000);
const MAX_BUCKETS = 48;

function bucketize(attempts) {
  const start = attempts[0].ts;
  const end = attempts[attempts.length - 1].ts;
  const step = BUCKET_STEPS.find((s) => (end - start) / s < MAX_BUCKETS) || BUCKET_STEPS[BUCKET_STEPS.length - 1];
  const first = Math.floor(start / step) * step;
  const count = Math.floor((end - first) / step) + 1;
  const buckets = Array.from({ length: count }, (_, i) => ({ start: first + i * step, failure: 0, success: 0 }));
  for (const e of attempts) {
    const b = buckets[Math.floor((e.ts - first) / step)];
    if (e.result === 'failure') b.failure++;
    else if (e.result === 'success') b.success++;
  }
  return { buckets, step };
}

function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const n = value / magnitude;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * magnitude;
}

function roundedTopBar(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function renderChart(attempts) {
  const container = $('activity-chart');
  container.replaceChildren();

  if (attempts.length === 0) {
    container.append(el('p', { class: 'soc-empty', text: 'Tidak ada event login pada filter ini.' }));
    return;
  }

  const { buckets, step } = bucketize(attempts);
  const width = Math.max(container.clientWidth, 280);
  const height = 220;
  const m = { top: 12, right: 8, bottom: 26, left: 40 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const maxY = niceMax(Math.max(...buckets.map((b) => b.failure + b.success)));
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = (v) => m.top + plotH - (v / maxY) * plotH;

  const totalFail = buckets.reduce((s, b) => s + b.failure, 0);
  const totalOk = buckets.reduce((s, b) => s + b.success, 0);
  const chart = svg('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Grafik aktivitas login: ${totalFail} gagal dan ${totalOk} berhasil, per ${formatDuration(step)}.`
  });

  // Grid & sumbu Y (recessive); jumlah tick dipilih agar labelnya bilangan bulat
  const ticks = maxY % 4 === 0 ? 4 : 5;
  for (let i = 0; i <= ticks; i++) {
    const value = (maxY / ticks) * i;
    const gy = y(value);
    chart.append(
      svg('line', { x1: m.left, x2: width - m.right, y1: gy, y2: gy, class: i === 0 ? 'soc-axis' : 'soc-grid' }),
      svg('text', { x: m.left - 6, y: gy + 4, 'text-anchor': 'end', class: 'soc-tick' }, [document.createTextNode(fmt(Math.round(value)))])
    );
  }

  // Label sumbu X: beberapa titik saja agar tidak bertabrakan
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.floor(plotW / 70)));
  const tooltip = el('div', { class: 'soc-tooltip', hidden: true });

  buckets.forEach((b, i) => {
    const x = m.left + i * slot + (slot - barW) / 2;
    const failH = (b.failure / maxY) * plotH;
    const okH = (b.success / maxY) * plotH;
    const base = m.top + plotH;
    const gap = b.failure && b.success ? 2 : 0;
    const group = svg('g');

    if (b.failure) {
      const top = !b.success;
      group.append(top
        ? svg('path', { d: roundedTopBar(x, base - failH, barW, failH, 4), class: 'soc-bar-failure' })
        : svg('rect', { x, y: base - failH, width: barW, height: failH, class: 'soc-bar-failure' }));
    }
    if (b.success) {
      const okY = base - failH - gap - okH;
      group.append(svg('path', { d: roundedTopBar(x, okY, barW, okH, 4), class: 'soc-bar-success' }));
    }

    // Area hover lebih lebar dari batang
    const hit = svg('rect', { x: m.left + i * slot, y: m.top, width: slot, height: plotH, class: 'soc-hit' });
    hit.addEventListener('mouseenter', () => {
      tooltip.hidden = false;
      tooltip.replaceChildren(
        el('strong', { text: `${formatTime(b.start)} – ${formatClock(b.start + step)}` }),
        el('span', { class: 'soc-tip-row' }, [el('span', { class: 'soc-swatch soc-swatch-failure' }), `Gagal: ${fmt(b.failure)}`]),
        el('span', { class: 'soc-tip-row' }, [el('span', { class: 'soc-swatch soc-swatch-success' }), `Berhasil: ${fmt(b.success)}`])
      );
      const left = Math.min(Math.max(m.left + i * slot + slot / 2, 80), width - 80);
      tooltip.style.left = `${left}px`;
      group.classList.add('is-hover');
    });
    hit.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
      group.classList.remove('is-hover');
    });
    group.append(hit);
    chart.append(group);

    if (i % labelEvery === 0) {
      chart.append(svg('text', {
        x: m.left + i * slot + slot / 2, y: height - 8, 'text-anchor': 'middle', class: 'soc-tick'
      }, [document.createTextNode(formatClock(b.start))]));
    }
  });

  container.append(chart, tooltip);
}

/* --------------------------------------------------------------------------
   Top IP
   -------------------------------------------------------------------------- */
function renderTopIps(attempts) {
  const list = $('top-ips');
  const counts = new Map();
  for (const e of attempts) {
    if (e.result === 'failure') counts.set(e.ip, (counts.get(e.ip) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_IP_LIMIT);

  if (top.length === 0) {
    list.replaceChildren(el('li', { class: 'soc-empty', text: 'Tidak ada login gagal pada filter ini.' }));
    return;
  }

  const alertSeverityByIp = new Map();
  for (const a of state.result.alerts) {
    const prev = alertSeverityByIp.get(a.ip);
    if (!prev || SEVERITY_ORDER.indexOf(a.severity) > SEVERITY_ORDER.indexOf(prev)) alertSeverityByIp.set(a.ip, a.severity);
  }

  const max = top[0][1];
  list.replaceChildren(...top.map(([ip, n]) => {
    const severity = alertSeverityByIp.get(ip);
    return el('li', {}, [
      el('button', {
        type: 'button', class: 'soc-ip-row', title: `Filter ke ${ip}`,
        onclick: () => { $('filter-ip').value = ip; applyFilters(); }
      }, [
        el('span', { class: 'soc-ip-line' }, [
          el('span', { class: 'soc-ip', text: ip }),
          severity ? severityBadge(severity) : null,
          el('span', { class: 'soc-ip-count', text: fmt(n) })
        ]),
        el('span', { class: 'soc-ip-track' }, [
          el('span', { class: 'soc-ip-bar', style: `width:${Math.max(2, (n / max) * 100)}%` })
        ])
      ])
    ]);
  }));
}

/* --------------------------------------------------------------------------
   Tabel alert & panel detail
   -------------------------------------------------------------------------- */
function renderAlertTable(alerts) {
  const body = $('alert-rows');
  const sorted = alerts.slice().sort((a, b) =>
    SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || b.lastSeen - a.lastSeen
  );
  $('alert-count-label').textContent = `${sorted.length} dari ${state.result.alerts.length}`;

  if (sorted.length === 0) {
    const text = state.result.alerts.length ? 'Tidak ada alert yang cocok dengan filter.' : 'Tidak ada alert.';
    body.replaceChildren(el('tr', {}, [el('td', { colspan: '6', class: 'soc-empty', text })]));
    return;
  }

  body.replaceChildren(...sorted.map((alert) => {
    const row = el('tr', { class: 'soc-alert-row', tabindex: '0', 'aria-label': `Buka detail: ${alert.ruleName} dari ${alert.ip}` }, [
      el('td', { 'data-label': 'Severity' }, [severityBadge(alert.severity)]),
      el('td', { 'data-label': 'Aturan', class: 'soc-rule', text: alert.ruleName }),
      el('td', { 'data-label': 'IP', class: 'soc-mono', text: alert.ip }),
      el('td', { 'data-label': 'Jumlah', class: 'soc-mono', text: fmt(alert.count) }),
      el('td', { 'data-label': 'Terakhir', class: 'soc-mono', text: formatTime(alert.lastSeen) }),
      el('td', { 'data-label': 'MITRE', class: 'soc-mono', text: alert.mitre.id })
    ]);
    row.addEventListener('click', () => openDetail(alert, row));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(alert, row);
      }
    });
    return row;
  }));
}

function mitreUrl(id) {
  return `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;
}

function openDetail(alert, trigger) {
  state.lastFocused = trigger || document.activeElement;

  $('detail-severity').replaceChildren(severityBadge(alert.severity));
  $('detail-title').textContent = alert.ruleName;
  $('detail-description').textContent = alert.description;

  const fields = [
    ['Aturan', `${alert.ruleName} (${alert.ruleId})`],
    ['IP', alert.ip],
    ['Username', alert.users.join(', ')],
    ['First seen', formatTime(alert.firstSeen)],
    ['Last seen', formatTime(alert.lastSeen)],
    ['Durasi', formatDuration(alert.lastSeen - alert.firstSeen)],
    ['Jumlah event', fmt(alert.count)],
    ['MITRE ATT&CK', el('a', {
      href: mitreUrl(alert.mitre.id), target: '_blank', rel: 'noopener noreferrer',
      text: `${alert.mitre.id} · ${alert.mitre.name}`
    })]
  ];
  $('detail-fields').replaceChildren(...fields.flatMap(([label, value]) => [
    el('dt', { text: label }),
    el('dd', {}, [value])
  ]));

  const shown = alert.events.slice(0, MAX_EVIDENCE_LINES);
  $('detail-evidence-note').textContent = alert.events.length > shown.length
    ? `Menampilkan ${shown.length} dari ${fmt(alert.events.length)} baris (nomor baris sesuai file).`
    : `${fmt(alert.events.length)} baris (nomor baris sesuai file).`;
  $('detail-evidence').textContent = shown.map((e) => `${String(e.lineNo).padStart(6, ' ')}  ${e.raw}`).join('\n');

  $('detail-overlay').hidden = false;
  document.body.classList.add('soc-detail-open');
  $('detail-close').focus();
}

function closeDetail() {
  const overlay = $('detail-overlay');
  if (overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove('soc-detail-open');
  if (state.lastFocused && document.contains(state.lastFocused)) state.lastFocused.focus();
}

function initDetailPanel() {
  $('detail-close').addEventListener('click', closeDetail);
  $('detail-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
initSourceScreen();
initFilterEvents();
initDetailPanel();

let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.result && !$('results-screen').hidden) applyFilters(); }, 150);
}).observe($('activity-chart'));
