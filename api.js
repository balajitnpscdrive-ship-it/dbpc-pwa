// api.js – Shared API wrapper for Sports Day Management
// GAS_URL is read fresh from localStorage on every call
// so saving the URL on the login page takes effect immediately.

function getGasUrl() {
  const u = localStorage.getItem('GAS_URL') || '';
  if (!u) throw new Error('Apps Script URL not set. Please save it on the login page.');
  return u;
}

// ── Core fetch helpers ────────────────────────────────────────────────────────
async function apiGet(action, params = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(action, payload = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  // ⚠️  DO NOT set Content-Type: application/json — that triggers a CORS
  // preflight OPTIONS request which Google Apps Script cannot respond to.
  // Sending without Content-Type defaults to text/plain (a "simple" request)
  // which skips the preflight. GAS still receives and parses the JSON body.
  const res = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Toast notifications ───────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut .3s ease both';
    t.addEventListener('animationend', () => t.remove());
  }, 3500);
}

// ── Session helpers ───────────────────────────────────────────────────────────
const Session = {
  set(data) { sessionStorage.setItem('sportsUser', JSON.stringify(data)); },
  get()     { return JSON.parse(sessionStorage.getItem('sportsUser') || 'null'); },
  clear()   { sessionStorage.removeItem('sportsUser'); },
  require(role) {
    const u = Session.get();
    if (!u) { location.href = 'index.html'; return null; }
    if (role && u.role !== role && !(role === 'house' && u.houseName)) { location.href = 'index.html'; return null; }
    return u;
  }
};

// ── QR Scanner (html5-qrcode) ─────────────────────────────────────────────────
let qrScanner = null;
function startQRScanner(elementId, onDecode) {
  if (qrScanner) { qrScanner.stop().catch(() => {}); }
  qrScanner = new Html5Qrcode(elementId);
  qrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    decoded => {
      qrScanner.stop().catch(() => {});
      // Expected format: Name|Department|House
      const parts = decoded.split('|');
      onDecode({ name: parts[0]||'', dept: parts[1]||'', house: parts[2]||'', raw: decoded });
    },
    err => {}
  ).catch(e => toast('Camera access denied: ' + e, 'error'));
}

function stopQRScanner() {
  if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; }
}

// ── Image → base64 ────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(',')[1];
      res({ base64: b64, mimeType: file.type, fileName: file.name });
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function fireConfetti() {
  if (!window.confetti) return;
  const end = Date.now() + 3000;
  const colors = ['#f59e0b','#a78bfa','#34d399','#f87171','#60a5fa'];
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// ── Sidebar navigation helper ─────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.section-page').forEach(s => s.classList.add('hidden'));
      item.classList.add('active');
      const sec = document.getElementById('sec-' + item.dataset.section);
      if (sec) sec.classList.remove('hidden');
    });
  });
  // Activate first item
  const first = document.querySelector('.nav-item[data-section]');
  if (first) first.click();
}

// ── CSV parser (for bulk upload) ──────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

// ── Settings cache ────────────────────────────────────────────────────────────
let _settings = null;
async function getSettings() {
  if (_settings) return _settings;
  const rows = await apiGet('getSettings');
  _settings = {};
  rows.forEach(r => _settings[r.Key] = r.Value);
  return _settings;
}

// ── Print helper ──────────────────────────────────────────────────────────────
async function printWithHeader(title) {
  const s = await getSettings();
  const header = document.getElementById('print-header');
  if (header) {
    header.innerHTML = `
      <img src="${s.LogoUrl || ''}" onerror="this.style.display='none'" alt="Logo" />
      <div style="flex:1">
        <div style="font-size:1.2rem;font-weight:700">${s.CollegeName || ''}</div>
        <div style="font-size:0.9rem;color:#555">${s.EventTitle || ''}</div>
        <div style="font-size:1rem;font-weight:600;margin-top:.3rem">${title}</div>
      </div>
      <img src="${s.FounderUrl || ''}" onerror="this.style.display='none'" alt="Founder" style="height:60px;border-radius:50%;" />
    `;
  }
  window.print();
}
