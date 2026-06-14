// ============================================================
// api.js – Shared API & Utility Layer | Sports Day Management
// ============================================================

// 1. Service Worker & PWA Handling
if ('serviceWorker' in navigator) {
  // Purge any active service worker from other apps (e.g. Lab Management) hosted on the same domain scope,
  // but let our own sw.js PWA service worker run.
  navigator.serviceWorker.getRegistrations().then(async function(registrations) {
    if (registrations && registrations.length) {
      const alreadyCleaned = sessionStorage.getItem('sw_cleaned_loop_guard');
      if (!alreadyCleaned) {
        sessionStorage.setItem('sw_cleaned_loop_guard', 'true');
        let unregisteredAny = false;
        for (let i = 0; i < registrations.length; i++) {
          const scriptUrl = registrations[i].active ? registrations[i].active.scriptURL : '';
          if (scriptUrl && !scriptUrl.endsWith('/sw.js')) {
            await registrations[i].unregister();
            unregisteredAny = true;
            console.log('[SW] Unregistered foreign service worker:', scriptUrl);
          }
        }
        if (unregisteredAny) {
          if ('caches' in window) {
            try {
              const keys = await caches.keys();
              for (let key of keys) {
                await caches.delete(key);
              }
            } catch(e) {}
          }
          console.log('[SW] Reloading page to clear cache interceptors...');
          location.reload();
          return;
        }
      }
    }
    
    // Register our Sports Day PWA service worker
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] Registered successfully:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  }).catch(function(err) {
    console.warn('[SW] Failed to get registrations:', err);
  });
}

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycby8FwfW9fY-MTRRzWSBGulShWVdsK0FnyPKdJnYkaS1Nu_LbYdSJXFw-YgphDrum4fCdg/exec";

function getGasUrl() {
  let u = '';
  try {
    const urlParams = new URLSearchParams(window.location.search);
    u = urlParams.get('gasUrl') || urlParams.get('url');
  } catch(e) {}
  if (!u) {
    try {
      u = localStorage.getItem('GAS_URL');
    } catch(e) {}
  }
  if (!u) {
    try {
      const s = Session.get();
      if (s && s.gasUrl) {
        u = s.gasUrl;
      }
    } catch(e) {}
  }
  const url = u || DEFAULT_GAS_URL;
  if (!url || !url.startsWith('https://')) {
    throw new Error('Apps Script Web App URL is not set or invalid. Please save your correct Web App URL at the bottom of the login page.');
  }
  return url;
}

// ── Core Fetch Helpers ─────────────────────────────────────────────────────────
// All requests use GET with ?data=JSON for small payloads to bypass CORS preflights.
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
  const payloadStr = JSON.stringify(payload);
  
  if (payloadStr.length < 1500) {
    url.searchParams.set('data', payloadStr);
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  
  const res = await fetch(url.toString(), {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: payloadStr
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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

async function apiUpload(action, payload = {}) {
  return apiPost(action, payload);
}

// ── Google Drive Thumbnail Converter ───────────────────────────────────────────
function getGoogleDriveThumbUrl(url) {
  if (!url) return '';
  const dRegex = /\/d\/([a-zA-Z0-9_-]+)/;
  const dMatch = url.match(dRegex);
  if (dMatch && dMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${dMatch[1]}&sz=w600`;
  }
  const idRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
  const idMatch = url.match(idRegex);
  if (idMatch && idMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w600`;
  }
  return url;
}

// ── Toast Notifications ────────────────────────────────────────────────────────
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

// ── Session Manager ────────────────────────────────────────────────────────────
// Stores session in sessionStorage, localStorage, and window.name fallback for file:/// compatibility
const Session = {
  set(data) {
    console.log('[Session] Setting session data:', data);
    try {
      sessionStorage.setItem('sportsUser', JSON.stringify(data));
      localStorage.setItem('sportsUser', JSON.stringify(data));
    } catch(e) {
      console.warn('[Session] Storage set failed:', e);
    }
    try {
      window.name = JSON.stringify(data);
    } catch(e) {}
  },
  get() {
    let data = null;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const sessionParam = urlParams.get('session');
      if (sessionParam) {
        data = decodeURIComponent(sessionParam);
        console.log('[Session] Read from URL param:', data);
        // Cache it in storage if available
        try {
          sessionStorage.setItem('sportsUser', data);
          localStorage.setItem('sportsUser', data);
        } catch(e) {}
      }
    } catch(e) {}

    if (!data) {
      try {
        data = sessionStorage.getItem('sportsUser') || localStorage.getItem('sportsUser');
        if (data) console.log('[Session] Read from storage:', data);
      } catch(e) {}
    }
    if (!data) {
      try {
        if (window.name && window.name.startsWith('{')) {
          data = window.name;
          console.log('[Session] Read from window.name fallback:', data);
        }
      } catch(e) {}
    }
    try {
      return data ? JSON.parse(data) : null;
    } catch(e) {
      console.error('[Session] JSON parse failed:', data, e);
      return null;
    }
  },
  clear() {
    console.log('[Session] Clearing session');
    try {
      sessionStorage.removeItem('sportsUser');
      localStorage.removeItem('sportsUser');
    } catch(e) {}
    try {
      window.name = '';
    } catch(e) {}
  },
  require(role) {
    const u = Session.get();
    console.log('[Session] Require role:', role, 'Current session:', u);
    if (!u) {
      console.warn('[Session] Verification failed: No active session. Redirecting to login.');
      const gasUrl = getGasUrl();
      let redirectUrl = 'index.html?from=' + role;
      if (gasUrl) {
        redirectUrl += '&gasUrl=' + encodeURIComponent(gasUrl);
      }
      location.href = redirectUrl;
      return null;
    }
    const storedRole = u.loginRole || (u.houseName ? 'house' : 'committee');
    console.log('[Session] Stored role:', storedRole, 'Required role:', role);
    if (role && storedRole !== role) {
      console.warn('[Session] Verification failed: Role mismatch. Redirecting to login.');
      const gasUrl = getGasUrl();
      let redirectUrl = 'index.html?from=' + role;
      if (gasUrl) {
        redirectUrl += '&gasUrl=' + encodeURIComponent(gasUrl);
      }
      location.href = redirectUrl;
      return null;
    }
    console.log('[Session] Verification succeeded');
    return u;
  }
};

// ── QR Code generation (qrcode.js) ────────────────────────────────────────────
async function generateQRDataUrl(text, size = 80) {
  return new Promise((resolve) => {
    if (!window.QRCode) { resolve(''); return; }
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } }, (err, url) => {
      resolve(err ? '' : url);
    });
  });
}

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
      const parts = decoded.split('|');
      onDecode({ name: parts[0]||'', dept: parts[1]||'', house: parts[2]||'', raw: decoded });
    },
    err => {}
  ).catch(e => toast('Camera access denied: ' + e, 'error'));
}

function stopQRScanner() {
  if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; }
}

// ── Image Helpers ─────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res({ base64: reader.result.split(',')[1], mimeType: file.type, fileName: file.name });
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

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

// ── Navigation ────────────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.section-page').forEach(s => s.classList.add('hidden'));
      item.classList.add('active');
      const sec = document.getElementById('sec-' + item.dataset.section);
      if (sec) sec.classList.remove('hidden');
      
      const sb = document.querySelector('.sidebar');
      if (sb) sb.classList.remove('open');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (backdrop) backdrop.classList.add('hidden');
    });
  });
  const first = document.querySelector('.nav-item[data-section]');
  if (first) first.click();
}

function toggleMobileSidebar() {
  const sb = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sb) {
    sb.classList.toggle('open');
    if (backdrop) {
      if (sb.classList.contains('open')) {
        backdrop.classList.remove('hidden');
      } else {
        backdrop.classList.add('hidden');
      }
    }
  }
}

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  if (text.startsWith('\ufeff')) {
    text = text.substring(1);
  }
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
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

// ── Settings Cache ────────────────────────────────────────────────────────────
let _settings = null;
async function getSettings() {
  if (_settings) return _settings;
  const rows = await apiGet('getSettings');
  _settings = {};
  rows.forEach(r => _settings[r.Key] = r.Value);
  return _settings;
}

// ── Image Preloading & Print Helpers ──────────────────────────────────────────
function preloadImages(urls) {
  return Promise.all(urls.map(url => {
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(null);
      img.src = url;
      setTimeout(() => resolve(null), 5000); // 5 seconds max timeout
    });
  }));
}

async function printWithHeader(title) {
  const s = await getSettings();
  
  const logoUrl = getGoogleDriveThumbUrl(s.LogoUrl || '');
  const founderUrl = getGoogleDriveThumbUrl(s.FounderUrl || '');
  
  // Preload logo and founder images to ensure they show up in print
  await preloadImages([logoUrl, founderUrl]);
  
  const header = document.getElementById('print-header');
  if (header) {
    header.innerHTML = `
      ${logoUrl ? `<div class="print-hdr-thumb"><img src="${logoUrl}" alt="Logo"></div>` : ''}
      <div style="flex:1;text-align:center">
        <div style="font-size:1.3rem;font-weight:800;color:#000;text-transform:uppercase;letter-spacing:1px;font-family:'Outfit',sans-serif">${s.CollegeName || ''}</div>
        <div style="font-size:0.95rem;font-weight:600;color:#333;margin-top:0.25rem">${s.EventTitle || ''}</div>
        <div style="font-size:1.05rem;font-weight:700;color:#000;margin-top:0.3rem;text-transform:uppercase">${title}</div>
      </div>
      ${founderUrl ? `<div class="print-hdr-thumb circular"><img src="${founderUrl}" alt="Founder"><small style="display:block;font-size:8px;font-weight:bold;margin-top:2px;color:#333">FOUNDER</small></div>` : ''}
    `;
  }
  
  setTimeout(() => {
    window.print();
  }, 150);
}
