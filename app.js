// ================================================================
// SUPABASE CONFIG — MISIÓN MAKAMBÚ
// ================================================================
const SUPABASE_URL = 'https://nhqchhiwglulgraowvho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocWNoaGl3Z2x1bGdyYW93dmhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzYzMjAsImV4cCI6MjA5MjgxMjMyMH0.m1-knqCFAOutGlKP4oCVtGb_GVheJurf_rfvUYDppgo';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSupabaseConnection() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*');

  console.log('SUPABASE TEST:', { data, error });
}

testSupabaseConnection();
// ================================================================
// AUDIO ENGINE
// ================================================================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }

function playSound(type) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'coin') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, ctx.currentTime);
      osc.frequency.setValueAtTime(1319, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'buy') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'error') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(150, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'submit') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(550, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    }
  } catch(e) {}
}

// ================================================================
// DATA LAYER — Google Sheets + localStorage
// ================================================================
const GS_URL = 'https://script.google.com/macros/s/AKfycbw4c8-CS4wZIb5naVCwP_nvX5pZ6WS_MHvCiL4qpw5cuqdYFAPBLtCE2jPwhhChHFWe/exec';
const STORAGE_KEY   = 'familiacamposbaldovino_v2';
const REQUESTS_KEY  = 'requests';

let requests        = [];
let requestsUpdatedAt = null;
let autoSyncInterval     = null;
let adminStateSyncInterval = null;
let cloudOk = true;

// ── JSONP ────────────────────────────────────────────────────────
function jsonp(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cbName = 'cb_' + Math.random().toString(36).slice(2);
    const u = new URL(url);
    u.searchParams.set('callback', cbName);
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      done = true;
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('JSONP error')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);

    window[cbName] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
    script.src = u.toString();
    document.head.appendChild(script);
  });
}

async function loadKeyFromSheets(key) {
  try {
    const url = `${GS_URL}?action=get&key=${encodeURIComponent(key)}`;
    const res = await jsonp(url);
    if (!res) return null;
    // Respuesta puede ser { ok, data, updatedAt } o { data, updatedAt }
    let data = res.data ?? res;
    if (data && data.key !== undefined && data.data !== undefined) data = data.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) {} }
    return { data, updatedAt: res.updatedAt || null };
  } catch(e) {
    console.warn('[GS] loadKey error:', e.message);
    return null;
  }
}

async function saveKeyToSheets(key, data) {
  try {
    await fetch(GS_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data })
    });
  } catch(e) { console.warn('[GS] saveKey error:', e.message); }
}

function unwrapSheets(res) {
  if (!res) return null;
  let raw = res.data;
  if (!raw) return null;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
  if (raw && raw.key !== undefined && raw.data !== undefined) raw = raw.data;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
  return raw;
}

function setCloudStatus(ok) {
  cloudOk = ok;
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = ok ? '☁️ OK' : '⚠️ Sin sync';
  el.className = ok ? 'cloud-ok' : 'cloud-err';
}

// ── Requests ─────────────────────────────────────────────────────
async function loadRequests() {
  const result = await loadKeyFromSheets(REQUESTS_KEY);
  if (result) {
    const fresh = unwrapSheets(result);
    if (Array.isArray(fresh)) {
      requests = fresh;
      requestsUpdatedAt = result.updatedAt;
      localStorage.setItem('fcb_requests', JSON.stringify(requests));
      return;
    }
  }
  const raw = localStorage.getItem('fcb_requests');
  if (raw) { try { requests = JSON.parse(raw); } catch(e) { requests = []; } }
}

async function saveRequests() {
  localStorage.setItem('fcb_requests', JSON.stringify(requests));
  await saveKeyToSheets(REQUESTS_KEY, requests);
}

// ── Request workflow ──────────────────────────────────────────────
async function addRequest(reward, user) {
  const already = requests.some(r => r.userId === user.id && r.rewardId === reward.id && r.status === 'pending');
  if (already) { showToast('⏳ Ya tienes una solicitud pendiente de ese premio'); return false; }
  const req = {
    id: 'req_' + Date.now(),
    userId: user.id, userName: user.name, userAvatar: user.avatar,
    rewardId: reward.id, rewardName: reward.name, rewardIcon: reward.icon, cost: reward.cost, type: reward.type,
    status: 'pending', createdAt: new Date().toISOString(),
    approvedBy: null, approvedAt: null, deliveredAt: null, rejectedBy: null, rejectedAt: null
  };
  requests.push(req);
  await saveRequests();
  return true;
}

async function approveRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req) return;
  // Descontar coins
  const userIdx = state.users.findIndex(u => u.id === req.userId);
  if (userIdx >= 0) {
    if (state.users[userIdx].coins < req.cost) { showToast('⚠️ No tiene suficientes coins'); return; }
    state.users[userIdx].coins -= req.cost;
  }
  req.status = 'approved'; req.approvedBy = currentUser.name; req.approvedAt = new Date().toISOString();
  state.purchases = state.purchases || [];
  state.purchases.push({ userId: req.userId, userName: req.userName, rewardId: req.rewardId,
    rewardName: req.rewardName, rewardIcon: req.rewardIcon, cost: req.cost, type: req.type,
    status: 'approved', requestId: req.id, timestamp: req.approvedAt });
  await saveRequests(); saveData();
  renderAdminPanel();
  showToast(`✅ Aprobado: ${req.rewardName} → ${req.userName}`);
  playSound('coin'); spawnParticles('🪙', null, null);
}

async function deliverRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req) return;
  req.status = 'delivered'; req.deliveredAt = new Date().toISOString();
  await saveRequests();
  renderAdminPanel();
  showToast(`🎁 Entregado: ${req.rewardName}`);
}

async function rejectRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req) return;
  req.status = 'rejected'; req.rejectedBy = currentUser.name; req.rejectedAt = new Date().toISOString();
  await saveRequests();
  renderAdminPanel();
  showToast(`❌ Rechazada: ${req.rewardName}`);
}

// ── Sync admin (requests) ─────────────────────────────────────────
function startAdminAutoSync() {
  stopAdminAutoSync();
  autoSyncInterval = setInterval(async () => {
    try {
      const result = await loadKeyFromSheets(REQUESTS_KEY);
      if (!result) return;
      if (result.updatedAt && result.updatedAt === requestsUpdatedAt) return;
      const fresh = unwrapSheets(result);
      if (Array.isArray(fresh)) {
        requestsUpdatedAt = result.updatedAt;
        requests = fresh;
        localStorage.setItem('fcb_requests', JSON.stringify(requests));
        renderAdminRequestsPanel();
        updateAdminRequestsBadge();
        setCloudStatus(true);
      }
    } catch(e) { setCloudStatus(false); }
  }, 8000);
}
function stopAdminAutoSync() { if (autoSyncInterval) { clearInterval(autoSyncInterval); autoSyncInterval = null; } }

// ── Sync admin (state) ────────────────────────────────────────────
function startAdminStateAutoSync() {
  stopAdminStateAutoSync();
  adminStateSyncInterval = setInterval(async () => {
    if (!currentUser || currentUser.role !== 'admin') { stopAdminStateAutoSync(); return; }
    try {
      const result = await loadKeyFromSheets('state');
      if (!result) return;
      if (result.updatedAt && result.updatedAt === stateUpdatedAt) return;
      const fresh = unwrapSheets(result);
      if (fresh && fresh.users) {
        stateUpdatedAt = result.updatedAt;
        state = normalizeState(fresh);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAdminPanel();
        setCloudStatus(true);
      }
    } catch(e) { setCloudStatus(false); }
  }, 5000);
}
function stopAdminStateAutoSync() { if (adminStateSyncInterval) { clearInterval(adminStateSyncInterval); adminStateSyncInterval = null; } }

async function syncRequestsNow() {
  showToast('🔄 Sincronizando...');
  try {
    const rResult = await loadKeyFromSheets(REQUESTS_KEY);
    if (rResult) {
      requestsUpdatedAt = rResult.updatedAt;
      const fresh = unwrapSheets(rResult);
      if (Array.isArray(fresh)) { requests = fresh; localStorage.setItem('fcb_requests', JSON.stringify(requests)); }
    }
    const sResult = await loadKeyFromSheets('state');
    if (sResult) {
      const fresh = unwrapSheets(sResult);
      if (fresh && fresh.users) {
        stateUpdatedAt = sResult.updatedAt;
        state = normalizeState(fresh);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    }
    renderAdminPanel();
    renderAdminRequestsPanel();
    updateAdminRequestsBadge();
    showToast('✅ Sincronizado');
  } catch(e) { showToast('⚠️ Error al sincronizar'); }
}

// ── Sync usuario ─────────────────────────────────────────────────
let userSyncInterval = null;
let lastKnownRequestStates = {};

function startUserSync() {
  stopUserSync();
  requests.filter(r => r.userId === currentUser?.id).forEach(r => { lastKnownRequestStates[r.id] = r.status; });
  userSyncInterval = setInterval(async () => {
    if (!currentUser || currentUser.role !== 'user') { stopUserSync(); return; }
    try {
      const rResult = await loadKeyFromSheets(REQUESTS_KEY);
      if (rResult) {
        const fresh = unwrapSheets(rResult);
        if (Array.isArray(fresh)) {
          fresh.filter(r => r.userId === currentUser.id).forEach(r => {
            const prev = lastKnownRequestStates[r.id];
            if (prev && prev !== r.status) {
              if (r.status === 'approved')  { playSound('coin'); showToast(`✅ ¡Aprobado! ${r.rewardIcon} ${r.rewardName}`); spawnParticles('🪙', null, null); }
              if (r.status === 'delivered') { playSound('buy');  showToast(`🎁 ¡Entregado! ${r.rewardIcon} ${r.rewardName}`); spawnConfetti(); }
              if (r.status === 'rejected')  { playSound('error'); showToast(`❌ Rechazado: ${r.rewardName}`); }
            }
            lastKnownRequestStates[r.id] = r.status;
          });
          requests = fresh;
          localStorage.setItem('fcb_requests', JSON.stringify(requests));
        }
      }
      const sResult = await loadKeyFromSheets('state');
      if (sResult) {
        const fresh = unwrapSheets(sResult);
        if (fresh && fresh.users) {
          const prevCoins = state.users.find(u => u.id === currentUser.id)?.coins || 0;
          state = normalizeState(fresh);
          currentUser = state.users.find(u => u.id === currentUser.id);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          const newCoins = currentUser?.coins || 0;
          if (newCoins > prevCoins) { playSound('coin'); showToast(`🪙 +${newCoins - prevCoins} coins! 🎉`); spawnParticles('🪙', null, null); }
          // Actualizar displays de coins
          document.getElementById('coinDisplay').textContent = newCoins;
          document.getElementById('heroCoins').textContent   = newCoins;
          const mcd = document.getElementById('modalCoinDisplay'); if (mcd) mcd.textContent = newCoins;
        }
      }
      renderMissions();
      renderMissionsPreview();
      renderStoreRewards();
      renderQuickHistory();
      renderHistorialTab();
      updatePendingBadge();
      updateWeeklyProgress();
      setCloudStatus(true);
    } catch(e) { setCloudStatus(false); }
  }, 10000);
}
function stopUserSync() { if (userSyncInterval) { clearInterval(userSyncInterval); userSyncInterval = null; } }

async function manualUserRefresh() {
  showToast('🔄 Actualizando...');
  try {
    const rResult = await loadKeyFromSheets(REQUESTS_KEY);
    if (rResult) {
      const fresh = unwrapSheets(rResult);
      if (Array.isArray(fresh)) {
        fresh.filter(r => r.userId === currentUser.id).forEach(r => {
          const prev = lastKnownRequestStates[r.id];
          if (prev && prev !== r.status) {
            if (r.status === 'approved')  { playSound('coin'); showToast(`✅ Aprobado: ${r.rewardIcon} ${r.rewardName}`); spawnParticles('🪙', null, null); }
            if (r.status === 'delivered') { playSound('buy');  showToast(`🎁 Entregado: ${r.rewardIcon} ${r.rewardName}`); spawnConfetti(); }
            if (r.status === 'rejected')  { playSound('error'); showToast(`❌ Rechazado: ${r.rewardName}`); }
          }
          lastKnownRequestStates[r.id] = r.status;
        });
        requests = fresh;
        localStorage.setItem('fcb_requests', JSON.stringify(requests));
      }
    }
    const sResult = await loadKeyFromSheets('state');
    if (sResult) {
      const fresh = unwrapSheets(sResult);
      if (fresh && fresh.users) {
        const prevCoins = state.users.find(u => u.id === currentUser.id)?.coins || 0;
        state = normalizeState(fresh);
        currentUser = state.users.find(u => u.id === currentUser.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const newCoins = currentUser?.coins || 0;
        if (newCoins > prevCoins) { playSound('coin'); showToast(`🪙 +${newCoins - prevCoins} coins!`); }
        document.getElementById('coinDisplay').textContent = newCoins;
        document.getElementById('heroCoins').textContent   = newCoins;
        const mcd = document.getElementById('modalCoinDisplay'); if (mcd) mcd.textContent = newCoins;
      }
    }
    renderMissions(); renderMissionsPreview(); renderStoreRewards();
    renderQuickHistory(); renderHistorialTab(); updatePendingBadge(); updateWeeklyProgress();
    showToast('✅ Actualizado');
  } catch(e) { showToast('⚠️ No se pudo actualizar'); }
}

// ================================================================
// STATE / DATA
// ================================================================
const DEFAULT_DATA = {
  users: [
    { id: 'cristian', name: 'Cristian', role: 'admin', pin: '1995', avatar: '👨', coins: 0 },
    { id: 'neyla',    name: 'Neyla',    role: 'admin', pin: '1989', avatar: '👩', coins: 0 },
    { id: 'abue',     name: 'Abue',     role: 'admin', pin: '1960', avatar: '👴', coins: 0 },
    { id: 'mateo',    name: 'Mateo',    role: 'user',  pin: '1234', avatar: '👦', coins: 0 },
  ],
  tasks: [
    { id: 't1', userId: 'mateo', name: 'Tender la cama',   icon: '🛏️', coins: 1,  freq: 'Diaria'  },
    { id: 't2', userId: 'mateo', name: 'Lavar los platos', icon: '🍽️', coins: 10, freq: 'Diaria'  },
    { id: 't3', userId: 'mateo', name: 'Doblar ropa',      icon: '👕', coins: 10, freq: 'Semanal' },
    { id: 't4', userId: 'mateo', name: 'Colgar ropa',      icon: '🪝', coins: 5,  freq: 'Semanal' },
    { id: 't5', userId: 'mateo', name: 'Lavar ropa',       icon: '🫧', coins: 5,  freq: 'Semanal' },
    { id: 't6', userId: 'mateo', name: 'Barrer',           icon: '🧹', coins: 10, freq: 'Diaria'  },
    { id: 't7', userId: 'mateo', name: 'Trapear',          icon: '🪣', coins: 10, freq: 'Semanal' },
    { id: 't8', userId: 'mateo', name: 'Organizar sala',   icon: '🛋️', coins: 5,  freq: 'Diaria'  },
    { id: 't9', userId: 'mateo', name: 'Limpiar comedor',  icon: '🪑', coins: 5,  freq: 'Semanal' },
  ],
  rewards: [
    { id: 'r1', name: '30 min de TV',    icon: '📺', cost: 30,  type: 'Tiempo' },
    { id: 'r2', name: '30 min de Compu', icon: '💻', cost: 30,  type: 'Tiempo' },
    { id: 'r3', name: '300 Robux',       icon: '🎮', cost: 300, type: 'Premio' },
    { id: 'r4', name: 'Pizza',           icon: '🍕', cost: 500, type: 'Premio' },
  ],
  pendingApprovals: [],
  completedToday:   [],
  purchases:        [],
  lastReset:        null,
};

function normalizeState(s) {
  if (!s || typeof s !== 'object') return JSON.parse(JSON.stringify(DEFAULT_DATA));
  const base = JSON.parse(JSON.stringify(DEFAULT_DATA));
  const out = { ...base, ...s };
  // Proteger coins: estado remoto siempre gana
  if (Array.isArray(s.users) && s.users.length) {
    out.users = s.users.map(ru => ({ ...(base.users.find(u => u.id === ru.id) || {}), ...ru }));
  } else { out.users = base.users; }
  out.tasks   = Array.isArray(s.tasks)   && s.tasks.length   ? s.tasks   : base.tasks;
  out.rewards = Array.isArray(s.rewards) && s.rewards.length ? s.rewards : base.rewards;
  out.purchases        = Array.isArray(out.purchases)        ? out.purchases        : [];
  out.pendingApprovals = Array.isArray(out.pendingApprovals) ? out.pendingApprovals : [];
  out.completedToday   = Array.isArray(out.completedToday)   ? out.completedToday   : [];
  out.lastReset        = out.lastReset ?? null;
  out.requests         = Array.isArray(out.requests)         ? out.requests         : [];
  return out;
}

let state = null;
let stateUpdatedAt = null;
let currentUser = null;
let selectedLoginUser = null;

async function loadData() {
  const result = await loadKeyFromSheets('state');
  if (result) {
    const fresh = unwrapSheets(result);
    if (fresh && fresh.users) {
      state = normalizeState(fresh);
      stateUpdatedAt = result.updatedAt;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      console.log('[DATA] ✅ Sheets — coins:', fresh.users.map(u=>`${u.name}:${u.coins}`).join(','));
      return;
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state = normalizeState(JSON.parse(raw)); }
    else { state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA))); }
  } catch(e) { state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA))); }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveKeyToSheets('state', state);
}

// ================================================================
// LOGIN
// ================================================================
function renderLoginUsers() {
  const container = document.getElementById('userSelect');
  if (!container) return;
  container.innerHTML = '';
  const users = state?.users || DEFAULT_DATA.users;
  users.forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'user-tile';
    btn.innerHTML = `
      <span class="t-avatar">${u.avatar}</span>
      <span class="t-name">${u.name}</span>
      <span class="t-role ${u.role === 'admin' ? 'admin' : 'jugador'}">${u.role === 'admin' ? '⚙️ Admin' : '🎮 Jugador'}</span>
    `;
    btn.onclick = () => selectUser(u);
    container.appendChild(btn);
  });
}

function selectUser(user) {
  selectedLoginUser = user;
  document.getElementById('userSelect').style.display = 'none';
  const pinBox = document.getElementById('pinBox');
  pinBox.classList.add('visible');
  document.getElementById('pinUserLabel').textContent = user.name;
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').style.display = 'none';
  document.getElementById('pinInput').focus();
  playSound('submit');
}

function backToUserSelect() {
  selectedLoginUser = null;
  document.getElementById('userSelect').style.display = 'grid';
  document.getElementById('pinBox').classList.remove('visible');
}

function handlePinInput() {
  document.getElementById('pinError').style.display = 'none';
  if (document.getElementById('pinInput').value.length === 4) attemptLogin();
}

async function attemptLogin() {
  const pin = document.getElementById('pinInput').value;
  if (!selectedLoginUser) return;
  if (String(selectedLoginUser.pin) === String(pin)) {
    currentUser = selectedLoginUser;
    playSound('coin');
    const btn = document.querySelector('.btn-enter');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
    showLoading('Cargando perfil...');
    try {
      await loadRequests();
      if (currentUser.role === 'admin') {
        hideLoading();
        showScreen('adminScreen');
        renderAdminPanel();
        startAdminAutoSync();
        startAdminStateAutoSync();
      } else {
        hideLoading();
        showScreen('mainScreen');
        renderMainScreen();
        startUserSync();
      }
    } catch(e) { hideLoading(); }
    if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR ▶'; }
  } else {
    playSound('error');
    document.getElementById('pinError').style.display = 'block';
    document.getElementById('pinInput').value = '';
  }
}

function doLogout() {
  stopAdminAutoSync();
  stopAdminStateAutoSync();
  stopUserSync();
  currentUser = null; selectedLoginUser = null;
  showScreen('loginScreen');
  document.getElementById('userSelect').style.display = 'grid';
  document.getElementById('pinBox').classList.remove('visible');
  renderLoginUsers();
}

// ================================================================
// SCREENS & TABS
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let currentUserTab  = 'inicio';
let currentAdminTab = 'inicio';

function showTab(tab) {
  // Oculta todos los paneles del usuario
  ['inicio','misiones','tienda','historial'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('tab-' + tab);
  if (target) target.style.display = 'block';

  // Actualiza nav
  document.querySelectorAll('#mainNav .nav-item').forEach((btn, i) => {
    const tabs = ['inicio','misiones','tienda','historial'];
    btn.classList.toggle('active', tabs[i] === tab);
  });
  currentUserTab = tab;

  // Render según tab
  if (tab === 'inicio')    { renderMissionsPreview(); updateWeeklyProgress(); }
  if (tab === 'misiones')  { renderMissions(); }
  if (tab === 'tienda')    { renderQuickHistory(); }
  if (tab === 'historial') { renderHistorialTab(); }
}

function showAdminTab(tab) {
  ['inicio','gestion'].forEach(t => {
    const el = document.getElementById('admin-tab-' + t);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('admin-tab-' + tab);
  if (target) target.style.display = 'block';

  document.querySelectorAll('#adminNav .nav-item').forEach((btn, i) => {
    const tabs = ['inicio','gestion'];
    btn.classList.toggle('active', tabs[i] === tab);
  });
  currentAdminTab = tab;
  if (tab === 'gestion') { renderTaskListAdmin(); renderRewardListAdmin(); populateAdminSelects(); }
}

// ================================================================
// USER MAIN SCREEN
// ================================================================
function renderMainScreen() {
  const user = state.users.find(u => u.id === currentUser.id) || currentUser;
  currentUser = user;

  // Avatar & name
  const el = id => document.getElementById(id);
  el('mainAvatar').textContent = user.avatar;
  el('mainName').textContent   = user.name;
  el('mainRole').textContent   = user.role === 'admin' ? '⚙️ Admin' : '🎮 Jugador';
  el('coinDisplay').textContent = user.coins;

  // Hero
  const hr = new Date().getHours();
  const greeting = hr < 12 ? '¡Buenos días!' : hr < 18 ? '¡Buenas tardes!' : '¡Buenas noches!';
  el('heroGreeting').textContent = greeting;
  el('heroName').textContent     = user.name + ' ' + user.avatar;
  el('heroCoins').textContent    = user.coins;

  updateWeeklyProgress();
  renderMissionsPreview();
  updatePendingBadge();
  showTab('inicio');
}

function updateWeeklyProgress() {
  const myTasks = state.tasks.filter(t => t.userId === currentUser.id);
  const done    = myTasks.filter(t => state.completedToday.includes(t.id)).length;
  const total   = myTasks.length;
  const pct     = total === 0 ? 0 : Math.round((done / total) * 100);

  const pctEl  = document.getElementById('weeklyPct');
  const fillEl = document.getElementById('weeklyFill');
  if (pctEl)  pctEl.textContent    = pct + '%';
  if (fillEl) fillEl.style.width   = pct + '%';
}

// Preview de misiones en home (max 3)
function renderMissionsPreview() {
  const el = document.getElementById('missionsPreview');
  if (!el) return;
  const myTasks = state.tasks.filter(t => t.userId === currentUser.id).slice(0, 3);
  if (myTasks.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">😴</span><p>Sin misiones asignadas</p></div>`;
    return;
  }
  el.innerHTML = myTasks.map(task => {
    const done    = state.completedToday.includes(task.id);
    const pending = !!state.pendingApprovals.find(p => p.taskId === task.id && p.userId === currentUser.id);
    const stateClass = done ? 'completed' : pending ? 'pending-review' : '';
    const tag = done ? '<span class="mission-tag done">✅ Lista</span>'
               : pending ? '<span class="mission-tag pending">⏳ Enviada</span>'
               : `<span class="mission-tag freq">${task.freq}</span>`;
    return `<div class="mission-card ${stateClass}">
      <div class="mission-icon-box">${task.icon || '⭐'}</div>
      <div class="mission-info">
        <div class="mission-name">${task.name}</div>
        <div>${tag}</div>
      </div>
      <div class="mission-coins-pill">🪙${task.coins}</div>
    </div>`;
  }).join('');
}

// Lista completa de misiones
function renderMissions() {
  const el = document.getElementById('missionsList');
  if (!el) return;
  const myTasks = state.tasks.filter(t => t.userId === currentUser.id);
  if (myTasks.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">😴</span><p>Sin misiones asignadas</p></div>`;
    return;
  }
  el.innerHTML = '';
  myTasks.forEach(task => {
    const done    = state.completedToday.includes(task.id);
    const paEntry = state.pendingApprovals.find(p => p.taskId === task.id && p.userId === currentUser.id);
    const pending = !!paEntry;
    const stateClass = done ? 'completed' : pending ? 'pending-review' : '';

    let actionBtn;
    if (done) {
      actionBtn = `<button class="btn-mission-action done" disabled>✅</button>`;
    } else if (pending) {
      actionBtn = `<button class="btn-mission-action undo" onclick="undoTask('${paEntry.id}')" title="Anular envío">↩</button>`;
    } else {
      actionBtn = `<button class="btn-mission-action" onclick="submitTask('${task.id}')">☐</button>`;
    }

    const tag = done ? '<span class="mission-tag done">✅ Aprobada</span>'
               : pending ? '<span class="mission-tag pending">⏳ Esperando aprobación</span>'
               : `<span class="mission-tag freq">${task.freq}</span>`;

    const div = document.createElement('div');
    div.className = `mission-card ${stateClass}`;
    div.innerHTML = `
      <div class="mission-icon-box">${task.icon || '⭐'}</div>
      <div class="mission-info">
        <div class="mission-name">${task.name}</div>
        <div>${tag}</div>
      </div>
      <div class="mission-coins-pill">🪙${task.coins}</div>
      ${actionBtn}
    `;
    el.appendChild(div);
  });
}

function submitTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  playSound('submit');
  state.pendingApprovals.push({
    id: 'pa_' + Date.now(),
    taskId: task.id, userId: currentUser.id,
    userName: currentUser.name, taskName: task.name,
    coins: task.coins, timestamp: new Date().toISOString()
  });
  saveData();
  renderMissions(); renderMissionsPreview(); updatePendingBadge();
  showToast(`📨 "${task.name}" enviada para aprobación`);
  spawnParticles('⭐', null, null);
}

function undoTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('error');
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);
  saveData();
  renderMissions(); renderMissionsPreview(); updatePendingBadge();
  showToast(`↩ "${pa.taskName}" anulada`);
}

function updatePendingBadge() {
  const count = state.pendingApprovals.filter(p => p.userId === currentUser?.id).length;
  const el = document.getElementById('pendingBadgeMain');
  if (el) el.innerHTML = count > 0 ? `<span class="badge">${count}</span>` : '';
}

// ================================================================
// STORE (Warp Zone)
// ================================================================
function openWarpZone() {
  playSound('coin');
  const user = state.users.find(u => u.id === currentUser.id);
  document.getElementById('modalCoinDisplay').textContent = user.coins;
  renderStoreRewards();
  renderStorePurchaseHistory();
  document.getElementById('warpZoneModal').classList.add('open');
}
function closeWarpZone() { document.getElementById('warpZoneModal').classList.remove('open'); }

function switchTab(tab) {
  const tabs = ['tiempo','premios','store-hist'];
  document.querySelectorAll('.tab-pill').forEach((b, i) => b.classList.toggle('active', tabs[i] === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('tab-' + tab);
  if (target) target.classList.add('active');
}

function renderStoreRewards() {
  const user = state.users.find(u => u.id === currentUser.id);
  const byType = { 'Tiempo': document.getElementById('tab-tiempo'), 'Premio': document.getElementById('tab-premios') };

  Object.entries(byType).forEach(([type, el]) => {
    if (!el) return;
    const list = state.rewards.filter(r => r.type === type);
    if (list.length === 0) {
      el.innerHTML = `<div class="empty-box"><span class="e-icon">🏪</span><p>No hay recompensas aquí</p></div>`;
      return;
    }
    el.innerHTML = list.map(r => {
      const hasPending = requests.some(req => req.userId === user.id && req.rewardId === r.id && req.status === 'pending');
      const canAfford  = user.coins >= r.cost;
      const disabled   = (hasPending || !canAfford) ? 'disabled' : '';
      const label      = hasPending ? '⏳ Pendiente' : !canAfford ? `🔒 Faltan ${r.cost - user.coins}` : '📨 Solicitar';
      return `<div class="reward-row">
        <div class="reward-icon-box">${r.icon || '🏆'}</div>
        <div class="reward-details">
          <div class="reward-row-name">${r.name}</div>
          <div class="reward-row-cost ${canAfford ? '' : 'cant'}">🪙 ${r.cost} monedas</div>
        </div>
        <button class="btn-buy" ${disabled} data-reward-id="${r.id}" onclick="buyReward('${r.id}')">
          ${label}
        </button>
      </div>`;
    }).join('');
  });
}

async function buyReward(rewardId) {
  const reward = state.rewards.find(r => r.id === rewardId);
  const user   = state.users.find(u => u.id === currentUser.id);
  if (!reward || !user) return;
  const btn = document.querySelector(`[data-reward-id="${rewardId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  playSound('submit');
  const ok = await addRequest(reward, user);
  if (ok) {
    spawnParticles('⭐', null, null);
    showToast(`📨 Solicitud enviada: ${reward.name}`);
    renderStoreRewards(); renderStorePurchaseHistory();
  }
  setTimeout(() => { if (btn) { btn.disabled = false; renderStoreRewards(); } }, 2000);
}

function renderStorePurchaseHistory() {
  const el = document.getElementById('tab-store-hist');
  if (!el) return;
  const mine = requests.filter(r => r.userId === currentUser.id);
  if (mine.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">🛒</span><p>Aún no has solicitado nada</p></div>`;
    return;
  }
  const icons = { pending:'⏳', approved:'✅', delivered:'🎁', rejected:'❌' };
  const labels = { pending:'Pendiente', approved:'Aprobado', delivered:'Entregado', rejected:'Rechazado' };
  el.innerHTML = mine.slice(0, 20).map(r => {
    const d = new Date(r.createdAt);
    return `<div class="hist-item">
      <div class="hist-dot ${r.status}">${r.rewardIcon}</div>
      <div class="hist-info">
        <div class="hist-name">${r.rewardName}</div>
        <div class="hist-sub">🪙${r.cost} · ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}</div>
      </div>
      <span class="hist-badge ${r.status}">${icons[r.status]} ${labels[r.status]||r.status}</span>
    </div>`;
  }).join('');
}

function renderQuickHistory() {
  const el = document.getElementById('quickHistory');
  if (!el) return;
  renderStorePurchaseHistory();
  // Muestra los últimos 5 en el tab-tienda también
  const mine = requests.filter(r => r.userId === currentUser.id).slice(0, 5);
  if (mine.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">🛒</span><p>Aún no has solicitado nada</p></div>`;
    return;
  }
  const icons  = { pending:'⏳', approved:'✅', delivered:'🎁', rejected:'❌' };
  const labels = { pending:'Pendiente', approved:'Aprobado', delivered:'Entregado', rejected:'Rechazado' };
  el.innerHTML = mine.map(r => {
    const d = new Date(r.createdAt);
    return `<div class="hist-item">
      <div class="hist-dot ${r.status}">${r.rewardIcon}</div>
      <div class="hist-info">
        <div class="hist-name">${r.rewardName}</div>
        <div class="hist-sub">🪙${r.cost} · ${d.getDate()}/${d.getMonth()+1}</div>
      </div>
      <span class="hist-badge ${r.status}">${icons[r.status]} ${labels[r.status]||r.status}</span>
    </div>`;
  }).join('');
}

function renderHistorialTab() {
  const el = document.getElementById('historialList');
  if (!el) return;
  // Combina misiones completadas + requests
  const mine = requests.filter(r => r.userId === currentUser.id);
  if (mine.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">📜</span><p>No hay actividad todavía</p></div>`;
    return;
  }
  const icons  = { pending:'⏳', approved:'✅', delivered:'🎁', rejected:'❌' };
  const labels = { pending:'Pendiente', approved:'Aprobado', delivered:'Entregado', rejected:'Rechazado' };
  el.innerHTML = mine.map(r => {
    const d = new Date(r.createdAt);
    return `<div class="hist-item">
      <div class="hist-dot ${r.status}">${r.rewardIcon}</div>
      <div class="hist-info">
        <div class="hist-name">${r.rewardName}</div>
        <div class="hist-sub">🪙${r.cost} · ${d.toLocaleDateString('es-CO')}</div>
      </div>
      <span class="hist-badge ${r.status}">${icons[r.status]} ${labels[r.status]||r.status}</span>
    </div>`;
  }).join('');
}

// ================================================================
// ADMIN PANEL
// ================================================================
function renderAdminPanel() {
  // Actualiza nombre en topbar
  const nameEl = document.getElementById('adminName');
  if (nameEl) nameEl.textContent = currentUser?.name || 'Admin';

  renderPendingApprovals();
  renderAdminRequestsPanel();
  renderUserStats();
  updateAdminBadge();
  updateAdminRequestsBadge();
  initAdminCollapsible();
}

function initAdminCollapsible() {
  document.querySelectorAll('#adminScreen .admin-section').forEach(sec => {
    if (sec.dataset.collapsible) return;
    sec.dataset.collapsible = '1';
    const title = sec.querySelector('.admin-sec-title');
    if (!title) return;
    title.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      sec.classList.toggle('collapsed');
    });
    // Colapsar por defecto (excepto tareas y solicitudes)
    const text = title.textContent || '';
    const keepOpen = text.includes('Tareas pendientes') || text.includes('Solicitudes de tienda') || text.includes('Monedas');
    if (!keepOpen) sec.classList.add('collapsed');
  });
}

function updateAdminBadge() {
  const count = state.pendingApprovals.length;
  const el = document.getElementById('pendingBadgeAdmin');
  if (el) el.innerHTML = count > 0 ? `<span class="badge">${count}</span>` : '';
}
function updateAdminRequestsBadge() {
  const count = requests.filter(r => r.status === 'pending' || r.status === 'approved').length;
  const el = document.getElementById('requestsBadgeAdmin');
  if (el) el.innerHTML = count > 0 ? `<span class="badge">${count}</span>` : '';
}

function renderAdminRequestsPanel() {
  const el = document.getElementById('adminRequestsList');
  if (!el) return;
  const active = requests.filter(r => r.status !== 'delivered' && r.status !== 'rejected');
  const done   = requests.filter(r => r.status === 'delivered' || r.status === 'rejected').slice(0, 8);
  if (active.length === 0 && done.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">🎉</span><p>No hay solicitudes</p></div>`;
    return;
  }
  const labels = { pending:'⏳ Pendiente', approved:'✅ Aprobado', delivered:'🎁 Entregado', rejected:'❌ Rechazado' };
  const colors = { pending:'var(--gold-dark)', approved:'var(--green-dark)', delivered:'var(--accent)', rejected:'var(--red)' };
  const renderReq = (r) => {
    const d = new Date(r.createdAt);
    const fmt = `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    const userCoins = (state.users.find(u => u.id === r.userId) || {}).coins || 0;
    const canAfford = userCoins >= r.cost;
    let actions = '';
    if (r.status === 'pending') {
      actions = `
        <button class="btn-no"  onclick="rejectRequest('${r.id}')">✕</button>
        <button class="btn-ok"  ${canAfford ? '' : 'disabled title="Sin coins"'} onclick="approveRequest('${r.id}')">✓</button>`;
    } else if (r.status === 'approved') {
      actions = `<button class="btn-give" onclick="deliverRequest('${r.id}')">🎁 Dar</button>`;
    }
    return `<div class="appr-item">
      <div class="appr-avatar">${r.userAvatar || '👤'}</div>
      <div class="appr-info">
        <div class="appr-user">${r.userName}</div>
        <div class="appr-detail">${r.rewardIcon} ${r.rewardName} · 🪙${r.cost}</div>
        <div class="appr-meta" style="color:${colors[r.status]}">${labels[r.status]||r.status} · ${fmt}</div>
        ${r.status === 'pending' && !canAfford ? '<div class="appr-meta" style="color:var(--red)">⚠️ Sin coins suficientes</div>' : ''}
      </div>
      <div class="appr-actions">${actions}</div>
    </div>`;
  };
  el.innerHTML =
    (active.length ? active.map(renderReq).join('') : '') +
    (done.length ? `<div style="font-size:10px;color:var(--text-3);margin:10px 0 6px;font-weight:700;">— Historial reciente —</div>` + done.map(renderReq).join('') : '');
}

function renderPendingApprovals() {
  const el = document.getElementById('pendingApprovals');
  if (!el) return;
  if (state.pendingApprovals.length === 0) {
    el.innerHTML = `<div class="empty-box"><span class="e-icon">🎉</span><p>No hay tareas pendientes</p></div>`;
    return;
  }
  el.innerHTML = state.pendingApprovals.map(p => {
    const d = new Date(p.timestamp);
    const fmt = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    const u = state.users.find(u => u.id === p.userId);
    return `<div class="appr-item">
      <div class="appr-avatar">${u?.avatar || '👤'}</div>
      <div class="appr-info">
        <div class="appr-user">${p.userName}</div>
        <div class="appr-detail">${p.taskName}</div>
        <div class="appr-meta">🪙${p.coins} · ${fmt}</div>
      </div>
      <div class="appr-actions">
        <button class="btn-no"  onclick="rejectTask('${p.id}')">✕</button>
        <button class="btn-ok"  onclick="approveTask('${p.id}')">✓</button>
      </div>
    </div>`;
  }).join('');
}

function approveTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('coin');
  const idx = state.users.findIndex(u => u.id === pa.userId);
  if (idx >= 0) state.users[idx].coins += pa.coins;
  state.completedToday.push(pa.taskId);
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);
  saveData(); renderPendingApprovals(); renderUserStats(); updateAdminBadge();
  showToast(`✅ "${pa.taskName}" → +${pa.coins}🪙 a ${pa.userName}`);
  spawnParticles('🪙', null, null);
}
function rejectTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('error');
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);
  saveData(); renderPendingApprovals(); updateAdminBadge();
  showToast(`❌ Rechazada: "${pa.taskName}"`);
}

function renderUserStats() {
  const el = document.getElementById('userStats');
  if (!el) return;
  el.innerHTML = state.users.map(u => `
    <div class="ustat-card">
      <div class="ustat-avatar">${u.avatar}</div>
      <div class="ustat-info">
        <div class="ustat-name">${u.name}</div>
        <div class="ustat-role">${u.role === 'admin' ? '⚙️ Admin' : '🎮 Jugador'}</div>
      </div>
      <div class="ustat-coins">🪙 ${u.coins}</div>
    </div>
  `).join('');
}

function populateAdminSelects() {
  const adjSel     = document.getElementById('adjUserSel');
  const taskUsrSel = document.getElementById('newTaskUser');
  if (adjSel)     adjSel.innerHTML     = state.users.map(u => `<option value="${u.id}">${u.avatar} ${u.name}</option>`).join('');
  if (taskUsrSel) taskUsrSel.innerHTML = state.users.map(u => `<option value="${u.id}">${u.avatar} ${u.name}</option>`).join('');
}

function adjustCoins(dir) {
  const userId = document.getElementById('adjUserSel').value;
  const amount = parseInt(document.getElementById('adjAmount').value) || 0;
  if (amount <= 0) { showToast('⚠️ Ingresa una cantidad válida'); return; }
  const idx = state.users.findIndex(u => u.id === userId);
  if (idx < 0) return;
  state.users[idx].coins = Math.max(0, state.users[idx].coins + (dir * amount));
  saveData(); renderUserStats(); playSound('coin');
  showToast(`${dir > 0 ? '➕' : '➖'} ${amount} coins a ${state.users[idx].name}`);
}

function renderTaskListAdmin() {
  const el = document.getElementById('taskListAdmin');
  if (!el) return;
  el.innerHTML = state.tasks.map(t => {
    const u = state.users.find(u => u.id === t.userId);
    return `<div class="list-item">
      <span class="list-item-icon">${t.icon || '⭐'}</span>
      <div class="list-item-info">
        <div class="list-item-name">${t.name}</div>
        <div class="list-item-meta">${u?.avatar || ''} ${u?.name || t.userId} · ${t.freq} · 🪙${t.coins}</div>
      </div>
      <button class="btn-del" onclick="deleteTask('${t.id}')">🗑</button>
    </div>`;
  }).join('');
}

function addTask() {
  const name   = document.getElementById('newTaskName').value.trim();
  const icon   = document.getElementById('newTaskIcon').value.trim()  || '⭐';
  const coins  = parseInt(document.getElementById('newTaskCoins').value) || 1;
  const freq   = document.getElementById('newTaskFreq').value;
  const userId = document.getElementById('newTaskUser').value;
  if (!name) { showToast('⚠️ Escribe el nombre de la misión'); return; }
  state.tasks.push({ id: 't_' + Date.now(), userId, name, icon, coins, freq });
  saveData(); renderTaskListAdmin();
  document.getElementById('newTaskName').value = '';
  document.getElementById('newTaskIcon').value = '';
  document.getElementById('newTaskCoins').value = '';
  playSound('buy'); showToast(`✅ Misión agregada: ${name}`);
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  state.pendingApprovals = state.pendingApprovals.filter(p => p.taskId !== taskId);
  state.completedToday   = state.completedToday.filter(id => id !== taskId);
  saveData(); renderTaskListAdmin(); renderPendingApprovals(); updateAdminBadge();
  showToast('🗑 Misión eliminada');
}

function renderRewardListAdmin() {
  const el = document.getElementById('rewardListAdmin');
  if (!el) return;
  el.innerHTML = state.rewards.map(r => `
    <div class="list-item">
      <span class="list-item-icon">${r.icon || '🏆'}</span>
      <div class="list-item-info">
        <div class="list-item-name">${r.name}</div>
        <div class="list-item-meta">${r.type} · 🪙${r.cost}</div>
      </div>
      <button class="btn-del" onclick="deleteReward('${r.id}')">🗑</button>
    </div>
  `).join('');
}

function addReward() {
  const name = document.getElementById('newRewardName').value.trim();
  const icon = document.getElementById('newRewardIcon').value.trim() || '🏆';
  const cost = parseInt(document.getElementById('newRewardCost').value) || 10;
  const type = document.getElementById('newRewardType').value;
  if (!name) { showToast('⚠️ Escribe el nombre de la recompensa'); return; }
  state.rewards.push({ id: 'r_' + Date.now(), name, icon, cost, type });
  saveData(); renderRewardListAdmin();
  document.getElementById('newRewardName').value = '';
  document.getElementById('newRewardIcon').value = '';
  document.getElementById('newRewardCost').value = '';
  playSound('buy'); showToast(`🏆 Recompensa: ${name}`);
}

function deleteReward(rewardId) {
  state.rewards = state.rewards.filter(r => r.id !== rewardId);
  saveData(); renderRewardListAdmin();
  showToast('🗑 Recompensa eliminada');
}

function resetDailyTasks() {
  if (!confirm('¿Reiniciar misiones del día?')) return;
  state.completedToday = []; state.pendingApprovals = [];
  state.lastReset = new Date().toISOString();
  saveData(); renderAdminPanel();
  showToast('🔄 Misiones reiniciadas');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `familia_campos_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

// ================================================================
// LOADING / UI HELPERS
// ================================================================
function showLoading(msg) {
  const el = document.getElementById('loadingOverlay');
  if (!el) return;
  const m = document.getElementById('loadingMsg');
  if (m) m.textContent = msg || 'Cargando...';
  el.classList.add('visible');
}
function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.classList.remove('visible');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function spawnParticles(emoji, x, y) {
  const cx = x || window.innerWidth / 2;
  const cy = y || window.innerHeight / 3;
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emoji;
    const angle = (i / 8) * Math.PI * 2;
    const dist  = 60 + Math.random() * 60;
    p.style.cssText = `left:${cx}px;top:${cy}px;--tx:${Math.cos(angle)*dist}px;--ty:${Math.sin(angle)*dist}px;animation-duration:${0.6+Math.random()*0.4}s;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

function spawnConfetti() {
  const colors = ['#FFD700','#FF6B6B','#5C6EF8','#22C97A','#FF69B4','#FB923C'];
  for (let i = 0; i < 30; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-bit';
    c.style.cssText = `
      left:${Math.random()*100}vw; top:-20px;
      background:${colors[i % colors.length]};
      width:${6+Math.random()*8}px; height:${6+Math.random()*8}px;
      animation-duration:${1+Math.random()*2}s;
      animation-delay:${Math.random()*0.5}s;
    `;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Carga rápida desde localStorage para mostrar login de inmediato
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? normalizeState(JSON.parse(raw)) : normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
  } catch(e) {
    state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
  }
  renderLoginUsers();

  // 2. Sincroniza con Sheets en background
  loadData().then(() => renderLoginUsers());
});
