// api.js – Shared API wrapper for Sports Day Management
// DEFAULT_GAS_URL is the hardcoded fallback.
// localStorage('GAS_URL') can still override it if needed.

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxJgm1RkjEYngdZvDeDuFZLJ-Jufdnkdrz04cjj7Lth91w5kUlJnLzYQ93gz-1GF0snHA/exec';

function getGasUrl() {
  return localStorage.getItem('GAS_URL') || DEFAULT_GAS_URL;
}

// ── QR Code generator ─────────────────────────────────────────────────────────
// Requires qrcodejs loaded via CDN (added to each HTML page that shows lists/reports).
// Returns a base64 PNG <img> string for embedding in table cells and print reports.
function makeQRDataUrl(text, size) {
  size = size || 72;
  if (!window.QRCode) return '';
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(div);
    new QRCode(div, {
      text: text || ' ',
      width: size,
      height: size,
      correctLevel: QRCode.CorrectLevel.M
    });
    const canvas = div.querySelector('canvas');
    const url = canvas ? canvas.toDataURL('image/png') : '';
    document.body.removeChild(div);
    return url;
  } catch(e) {
    return '';
  }
}

// Returns a ready-to-embed <img> HTML string of the QR code
function qrImg(text, size) {
  const url = makeQRDataUrl(text, size || 72);
  return url
    ? `<img src="${url}" alt="QR" style="width:${size||72}px;height:${size||72}px;display:block;image-rendering:pixelated" />`
    : '';
}


// ── Core fetch helpers ────────────────────────────────────────────────────────
// All requests use GET to avoid CORS preflight issues with GAS.
// Write operations encode their payload as ?data=<JSON> in the URL.
async function apiGet(action, params = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error('Server: ' + json.error);
  return json;
}

// apiPost sends as GET with payload encoded in ?data= — only for SMALL payloads.
// URL limit on GAS is ~2 KB. Use apiUpload for images / large data.
async function apiPost(action, payload = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  url.searchParams.set('data', JSON.stringify(payload));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error('Server: ' + json.error);
  return json;
}

// apiUpload sends the payload as a POST body — for large payloads (images, bulk data).
// text/plain Content-Type avoids CORS preflight so GAS responds without issues.
async function apiUpload(action, payload = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  const res = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error('Server: ' + json.error);
  return json;
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

  // role = 'committee' | 'house'
  // We check loginRole (the tab clicked at login), NOT u.role (the sheet value like 'admin').
  require(role) {
    const u = Session.get();
    if (!u) { location.href = 'index.html'; return null; }
    // Determine actual login role from session
    const storedRole = u.loginRole || (u.houseName ? 'house' : 'committee');
    if (role && storedRole !== role) {
      // Wrong role for this page — go back to login
      location.href = 'index.html';
      return null;
    }
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

// Fetches a URL and converts it to a base64 data URL so images print reliably.
// Falls back to the original URL on CORS/network error.
async function imgToDataUrl(url) {
  if (!url) return '';
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return url;
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return url; // fallback to original on CORS failure
  }
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
    // Convert images to base64 so they always show in print (external URLs can be blocked)
    const [logoSrc, founderSrc] = await Promise.all([
      imgToDataUrl(s.LogoUrl || ''),
      imgToDataUrl(s.FounderUrl || '')
    ]);
    header.innerHTML = `
      ${logoSrc ? `<img src="${logoSrc}" alt="Logo" style="height:60px" />` : ''}
      <div style="flex:1;text-align:center">
        <div style="font-size:1.2rem;font-weight:700;color:#000">${s.CollegeName || ''}</div>
        <div style="font-size:0.9rem;color:#555">${s.EventTitle || ''}</div>
        <div style="font-size:1rem;font-weight:600;margin-top:.3rem;color:#000">${title}</div>
      </div>
      ${founderSrc ? `<img src="${founderSrc}" alt="Founder" style="height:60px;border-radius:50%" />` : ''}
    `;
  }
  window.print();
}
