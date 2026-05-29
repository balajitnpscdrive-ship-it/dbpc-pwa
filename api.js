// api.js – Shared API wrapper for Sports Day Management
// GAS_URL is read fresh from localStorage on every call

function getGasUrl() {
  const u = localStorage.getItem('GAS_URL') || '';
  if (!u) throw new Error('Apps Script URL not set. Please save it on the login page.');
  return u;
}

// ── Core fetch helpers ─────────────────────────────────────────────────────────
// All requests use GET with ?data=JSON to avoid CORS preflight issues.
async function apiGet(action, params = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// apiPost: sends POST request for large payloads to avoid URL length limits,
// and GET request for small payloads (<1500 chars) for maximum reliability and to prevent redirect method loss.
async function apiPost(action, payload = {}) {
  const url = new URL(getGasUrl());
  url.searchParams.set('action', action);
  
  const payloadStr = JSON.stringify(payload);
  
  // If payload is small, send as GET (which is 100% reliable for redirects)
  if (payloadStr.length < 1500) {
    url.searchParams.set('data', payloadStr);
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  
  // If payload is large, send as POST
  const res = await fetch(url.toString(), {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: payloadStr
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// apiBatch: sends rows in small chunks using apiPost
// Used for large CSV uploads
async function apiBatch(action, rows, chunkSize = 15, onProgress) {
  const results = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const r = await apiPost(action, { rows: chunk, startIndex: i });
    results.push(r);
    if (onProgress) onProgress(Math.min(i + chunkSize, rows.length), rows.length);
  }
  return results;
}

// apiUpload: used for large binary payloads (images, audio)
async function apiUpload(action, payload = {}) {
  return apiPost(action, payload);
}

// ── Toast notifications ────────────────────────────────────────────────────────
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

// ── Session helpers ────────────────────────────────────────────────────────────
const Session = {
  set(data) { sessionStorage.setItem('sportsUser', JSON.stringify(data)); },
  get()     { return JSON.parse(sessionStorage.getItem('sportsUser') || 'null'); },
  clear()   { sessionStorage.removeItem('sportsUser'); },

  // role = 'committee' | 'house'
  // Check loginRole (tab selected), NOT u.role (sheet value like 'admin')
  require(role) {
    const u = Session.get();
    if (!u) { location.href = 'index.html'; return null; }
    const storedRole = u.loginRole || (u.houseName ? 'house' : 'committee');
    if (role && storedRole !== role) {
      location.href = 'index.html';
      return null;
    }
    return u;
  }
};

// ── QR Code generation (qrcode.js) ────────────────────────────────────────────
// Generates QR code as data URL for a student
// Format encoded: Name|Department|House
async function generateQRDataUrl(text, size = 80) {
  return new Promise((resolve) => {
    if (!window.QRCode) { resolve(''); return; }
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } }, (err, url) => {
      resolve(err ? '' : url);
    });
  });
}

// Generates inline QR <img> tag for a student row
async function studentQRImg(name, dept, house, size = 70) {
  const text = `${name}|${dept}|${house}`;
  const url = await generateQRDataUrl(text, size);
  return url ? `<img src="${url}" alt="QR" style="width:${size}px;height:${size}px">` : '';
}

// ── QR Scanner (html5-qrcode) ─────────────────────────────────────────────────
let qrScanner = null;
function startQRScanner(elementId, onDecode) {
  if (!window.Html5Qrcode) {
    toast('QR scanner library not loaded. Check internet connection.', 'error');
    return;
  }
  if (qrScanner) { qrScanner.stop().catch(() => {}); }
  qrScanner = new Html5Qrcode(elementId);
  qrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    decoded => {
      qrScanner.stop().catch(() => {});
      qrScanner = null;
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

// ── Image URL → base64 dataURL (for printing) ─────────────────────────────────
async function imgToDataUrl(src) {
  if (!src) return '';
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  } catch(e) { return ''; }
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
  const first = document.querySelector('.nav-item[data-section]');
  if (first) first.click();
}

// ── CSV parser (for bulk upload) ──────────────────────────────────────────────
function parseCSV(text) {
  // Strip UTF-8 Byte Order Mark (BOM) if present (common when exporting from Excel)
  if (text.startsWith('\ufeff')) {
    text = text.substring(1);
  }
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    // Handle quoted CSV values
    const vals = [];
    let cur = '', inQ = false;
    for (let c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    vals.push(cur.trim());
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
  const [logoSrc, founderSrc] = await Promise.all([
    imgToDataUrl(s.LogoUrl || ''),
    imgToDataUrl(s.FounderUrl || '')
  ]);
  const header = document.getElementById('print-header');
  if (header) {
    header.innerHTML = `
      ${logoSrc ? `<img src="${logoSrc}" style="height:60px" alt="Logo">` : ''}
      <div style="flex:1;text-align:center">
        <div style="font-size:1.1rem;font-weight:700;color:#000">${s.CollegeName || ''}</div>
        <div style="font-size:.85rem;color:#555">${s.EventTitle || ''}</div>
        <div style="font-size:.95rem;font-weight:600;margin-top:.2rem">${title}</div>
      </div>
      ${founderSrc ? `<img src="${founderSrc}" style="height:60px;border-radius:50%" alt="Founder">` : ''}
    `;
  }
  window.print();
}
