// ================================================================
// AUDIO ENGINE (Web Audio API - 8-bit sounds)
// ================================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playSound(type) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'coin') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, ctx.currentTime);
      osc.frequency.setValueAtTime(1319, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'buy') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'error') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(150, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'submit') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(550, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch(e) {}
}

// ================================================================
// DATA LAYER — LocalStorage + Google Sheets (Apps Script)
// ================================================================

// ── Google Sheets endpoint ──────────────────────────────────────
const GS_URL = 'https://script.google.com/macros/s/AKfycbw4c8-CS4wZIb5naVCwP_nvX5pZ6WS_MHvCiL4qpw5cuqdYFAPBLtCE2jPwhhChHFWe/exec';

// ── Estado global de requests (bandeja compartida) ───────────────
let requests = []; // Array de solicitudes de compra
let requestsUpdatedAt = null; // Para detectar cambios en autosync
let cloudOk = true; // indicador de conexión a Sheets
let autoSyncInterval = null;

// ── Key helpers ──────────────────────────────────────────────────
function getUserStateKey(userId) { return 'state_' + userId; }
const REQUESTS_KEY = 'requests';

// ── JSONP helper (evita CORS en el GET) ─────────────────────────
function jsonp(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cbName = 'cb_' + Math.random().toString(36).slice(2);
    const u = new URL(url);
    u.searchParams.set('callback', cbName);

    const script = document.createElement('script');
    let done = false;

    function cleanup() {
      try { delete window[cbName]; } catch(_) {}
      try { script.remove(); } catch(_) {}
    }

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // Ojo: NO borramos el callback inmediatamente para evitar:
      // "Uncaught ReferenceError: cb_xxx is not defined" si la respuesta llega tarde.
      reject(new Error('JSONP timeout'));
      setTimeout(cleanup, 15000);
    }, timeoutMs);

    window[cbName] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(data);
      // deja el callback vivo un momento (cache + ejecución tardía)
      setTimeout(cleanup, 1000);
    };

    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('JSONP script error'));
    };

    script.src = u.toString();
    document.body.appendChild(script);
  });
}


// ── Cargar una key arbitraria desde Sheets ───────────────────────
async function loadKeyFromSheets(key) {
  try {
    const url = `${GS_URL}?action=get&key=${encodeURIComponent(key)}`;
    console.log(`[GS] GET key="${key}"...`);
    const res = await jsonp(url);
    if (res && res.ok && res.data) {
      let data = (typeof res.data === 'string') ? JSON.parse(res.data) : res.data;
      // Desenvuelve doble envoltura { key, data } que Apps Script genera al guardar { key, data }
      if (data && data.key !== undefined && data.data !== undefined) data = data.data;
      if (typeof data === 'string') data = JSON.parse(data);
      console.log(`[GS] ✅ key="${key}" cargada. updatedAt:`, res.updatedAt);
      setCloudStatus(true);
      return { data, updatedAt: res.updatedAt };
    }
    console.warn(`[GS] key="${key}" sin data remota.`);
    return null;
  } catch (e) {
    console.warn(`[GS] ❌ Error cargando key="${key}":`, e.message);
    setCloudStatus(false);
    return null;
  }
}

// ── Guardar una key arbitraria en Sheets ─────────────────────────
async function saveKeyToSheets(key, data) {
  try {
    await fetch(GS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ key, data })
    });
    console.log(`[GS] ✅ POST key="${key}" enviado.`);
    setCloudStatus(true);
  } catch (e) {
    console.warn(`[GS] ❌ Error guardando key="${key}":`, e.message);
    setCloudStatus(false);
  }
}

// ── Indicador visual de conexión a nube ──────────────────────────
function setCloudStatus(ok) {
  cloudOk = ok;
  const el = document.getElementById('cloudStatus');
  if (el) {
    el.textContent = ok ? '☁️ Nube OK' : '⚠️ Sin nube';
    el.style.color = ok ? '#9fc' : '#f88';
  }
}

// ── Requests: cargar ─────────────────────────────────────────────
async function loadRequests() {
  const lsKey = 'fcb_requests';
  const result = await loadKeyFromSheets(REQUESTS_KEY);
  if (result) {
    let d = result.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch(_) {} }
    requests = Array.isArray(d) ? d : [];
    requestsUpdatedAt = result.updatedAt;
    localStorage.setItem(lsKey, JSON.stringify(requests));
    return;
  }
  // Fallback localStorage
  try {
    const raw = localStorage.getItem(lsKey);
    requests = raw ? JSON.parse(raw) : [];
  } catch(e) { requests = []; }

  // Si no hay requests en Sheets pero sí local, los subimos (1 vez)
  if (requests.length && !localStorage.getItem('fcb_seeded_requests')) {
    console.log('[DATA] Sembrando requests en Google Sheets…');
    await saveRequests();
    localStorage.setItem('fcb_seeded_requests', '1');
  }
}

// ── Requests: guardar ────────────────────────────────────────────
async function saveRequests() {
  localStorage.setItem('fcb_requests', JSON.stringify(requests));
  await saveKeyToSheets(REQUESTS_KEY, requests);
}

// ── Requests: agregar solicitud de compra ────────────────────────
async function addRequest(reward, user) {
  // Evitar duplicado pendiente del mismo usuario+reward
  const dup = requests.find(r => r.userId === user.id && r.rewardId === reward.id && r.status === 'pending');
  if (dup) {
    showToast('⏳ Ya tienes una solicitud pendiente para esta recompensa');
    return false;
  }
  const req = {
    id: 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    userId: user.id,
    userName: user.name,
    userAvatar: user.avatar,
    rewardId: reward.id,
    rewardName: reward.name,
    rewardIcon: reward.icon || '🏆',
    cost: reward.cost,
    type: reward.type,
    status: 'pending',       // pending | approved | delivered | rejected
    createdAt: new Date().toISOString(),
    approvedBy: null, approvedAt: null,
    deliveredAt: null,
    rejectedBy: null, rejectedAt: null,
  };
  requests.unshift(req);
  await saveRequests();
  return true;
}

// ── Requests: aprobar ────────────────────────────────────────────
async function approveRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || req.status !== 'pending') return;
  const userIdx = state.users.findIndex(u => u.id === req.userId);
  if (userIdx < 0) return;
  if (state.users[userIdx].coins < req.cost) {
    showToast(`❌ ${req.userName} no tiene suficientes coins`);
    playSound('error');
    return;
  }
  req.status = 'approved';
  req.approvedBy = currentUser.name;
  req.approvedAt = new Date().toISOString();
  // Descontar coins
  state.users[userIdx].coins -= req.cost;
  // Registrar en historial de compras del state global
  state.purchases.unshift({
    userId: req.userId, userName: req.userName,
    rewardId: req.rewardId, rewardName: req.rewardName,
    rewardIcon: req.rewardIcon, cost: req.cost, type: req.type,
    status: 'approved', requestId: req.id,
    timestamp: req.approvedAt
  });
  playSound('coin');
  spawnParticles('🪙', null, null);
  await saveRequests();
  saveData();
  renderAdminPanel();
  showToast(`✅ Aprobado: ${req.rewardName} → -${req.cost}🪙 de ${req.userName}`);
}

// ── Requests: marcar entregado ───────────────────────────────────
async function deliverRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || req.status !== 'approved') return;
  req.status = 'delivered';
  req.deliveredAt = new Date().toISOString();
  playSound('buy');
  spawnConfetti();
  await saveRequests();
  renderAdminPanel();
  showToast(`🎁 Entregado: ${req.rewardName} a ${req.userName}`);
}

// ── Requests: rechazar ───────────────────────────────────────────
async function rejectRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || (req.status !== 'pending' && req.status !== 'approved')) return;
  req.status = 'rejected';
  req.rejectedBy = currentUser.name;
  req.rejectedAt = new Date().toISOString();
  playSound('error');
  await saveRequests();
  renderAdminPanel();
  showToast(`❌ Rechazado: ${req.rewardName}`);
}

// ── AutoSync admin (cada 8s revisa si requests cambió) ───────────
// ── Helper: desenvuelve doble envoltura y normaliza ─────────────
function unwrapSheets(res) {
  if (!res) return null;
  // loadKeyFromSheets devuelve { data, updatedAt } — no tiene .ok
  // jsonp directo devuelve { ok, data, updatedAt }
  let raw = (res.ok !== undefined) ? res.data : res.data; // ambos tienen .data
  if (!raw) return null;
  if (typeof raw === 'string') raw = JSON.parse(raw);
  // Desenvuelve { key, data } generado por Apps Script
  if (raw && raw.key !== undefined && raw.data !== undefined) raw = raw.data;
  if (typeof raw === 'string') raw = JSON.parse(raw);
  return raw;
}

function startAdminAutoSync() {
  stopAdminAutoSync();
  autoSyncInterval = setInterval(async () => {
    try {
      const result = await loadKeyFromSheets(REQUESTS_KEY);
      if (!result) return;
      if (result.updatedAt && result.updatedAt === requestsUpdatedAt) return; // sin cambios
      console.log('[AUTOSYNC-ADMIN] Requests cambiaron, recargando...');
      requestsUpdatedAt = result.updatedAt;
      const fresh = unwrapSheets(result);
      if (Array.isArray(fresh)) {
        requests = fresh;
        localStorage.setItem('fcb_requests', JSON.stringify(requests));
        renderAdminRequestsPanel();
        updateAdminRequestsBadge();
      }
      setCloudStatus(true);
    } catch(e) { setCloudStatus(false); }
  }, 8000);
}

function stopAdminAutoSync() {
  if (autoSyncInterval) { clearInterval(autoSyncInterval); autoSyncInterval = null; }
}

// ── AutoSync admin — estado global (pendingApprovals, coins) ─────
let adminStateSyncInterval = null;

function startAdminStateAutoSync() {
  stopAdminStateAutoSync();
  adminStateSyncInterval = setInterval(async () => {
    if (!currentUser || currentUser.role !== 'admin') { stopAdminStateAutoSync(); return; }
    try {
      const result = await loadKeyFromSheets('state');
      if (!result) return;
      if (result.updatedAt && result.updatedAt === stateUpdatedAt) return;
      const fresh = unwrapSheets(result);
      if (!fresh || !fresh.users) return;
      stateUpdatedAt = result.updatedAt;
      state = normalizeState(fresh);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderAdminPanel();
      setCloudStatus(true);
      console.log('[AUTOSYNC-ADMIN] Estado global actualizado');
    } catch(e) { setCloudStatus(false); }
  }, 5000);
}

function stopAdminStateAutoSync() {
  if (adminStateSyncInterval) { clearInterval(adminStateSyncInterval); adminStateSyncInterval = null; }
}

async function syncRequestsNow() {
  showToast('🔄 Sincronizando...');
  try {
    // 1. Recargar requests
    const rResult = await loadKeyFromSheets(REQUESTS_KEY);
    if (rResult) {
      requestsUpdatedAt = rResult.updatedAt;
      const fresh = unwrapSheets(rResult);
      if (Array.isArray(fresh)) {
        requests = fresh;
        localStorage.setItem('fcb_requests', JSON.stringify(requests));
      }
    }
    // 2. Recargar estado global (coins, pendingApprovals)
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
  } catch(e) {
    showToast('⚠️ Error al sincronizar');
    console.error('[SYNC]', e);
  }
}

// ── Sync manual para usuario ─────────────────────────────────────
async function manualUserRefresh() {
  showToast('🔄 Actualizando...');
  try {
    // 1. Requests (estado de compras)
    const rResult = await loadKeyFromSheets(REQUESTS_KEY);
    if (rResult) {
      const fresh = unwrapSheets(rResult);
      if (Array.isArray(fresh)) {
        // Notificar cambios de estado
        fresh.filter(r => r.userId === currentUser.id).forEach(r => {
          const prev = lastKnownRequestStates[r.id];
          if (prev && prev !== r.status) {
            if (r.status === 'approved') { playSound('coin'); showToast(`✅ Aprobado: ${r.rewardIcon} ${r.rewardName}`); spawnParticles('🪙', null, null); }
            else if (r.status === 'delivered') { playSound('buy'); showToast(`🎁 Entregado: ${r.rewardIcon} ${r.rewardName}`); spawnConfetti(); }
            else if (r.status === 'rejected') { playSound('error'); showToast(`❌ Rechazado: ${r.rewardName}`); }
          }
          lastKnownRequestStates[r.id] = r.status;
        });
        requests = fresh;
        localStorage.setItem('fcb_requests', JSON.stringify(requests));
      }
    }
    // 2. Estado global (coins, pendingApprovals aprobadas)
    const sResult = await loadKeyFromSheets('state');
    if (sResult) {
      const fresh = unwrapSheets(sResult);
      if (fresh && fresh.users) {
        const prevCoins = state.users.find(u => u.id === currentUser.id)?.coins || 0;
        state = normalizeState(fresh);
        currentUser = state.users.find(u => u.id === currentUser.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const newCoins = currentUser?.coins || 0;
        if (newCoins > prevCoins) {
          playSound('coin');
          showToast(`🪙 +${newCoins - prevCoins} coins! Misión aprobada 🎉`);
          spawnParticles('🪙', null, null);
        }
        document.getElementById('coinDisplay').textContent = newCoins;
        const mcd = document.getElementById('modalCoinDisplay');
        if (mcd) mcd.textContent = newCoins;
      }
    }
    renderMissions();
    renderStoreRewards();
    renderPurchaseHistory();
    updatePendingBadge();
    showToast('✅ Actualizado');
  } catch(e) {
    showToast('⚠️ No se pudo actualizar');
    console.error('[USER-SYNC]', e);
  }
}

// ================================================================

const STORAGE_KEY = 'familiacamposbaldovino_v2';

const DEFAULT_DATA = {
  users: [
    { id: 'cristian', name: 'Cristian', role: 'admin', pin: '1995', avatar: '👨', coins: 0 },
    { id: 'neyla',    name: 'Neyla',    role: 'admin', pin: '1989', avatar: '👩', coins: 0 },
    { id: 'abue',     name: 'Abue',     role: 'admin', pin: '1960', avatar: '👴', coins: 0 },
    { id: 'mateo',    name: 'Mateo',    role: 'user',  pin: '1234', avatar: '👦', coins: 0 },
  ],
  tasks: [
    { id: 't1',  userId: 'mateo', name: 'Tender la cama',   icon: '🛏️', coins: 1,  freq: 'Diaria'  },
    { id: 't2',  userId: 'mateo', name: 'Lavar los platos', icon: '🍽️', coins: 10, freq: 'Diaria'  },
    { id: 't3',  userId: 'mateo', name: 'Doblar ropa',      icon: '👕', coins: 10, freq: 'Semanal' },
    { id: 't4',  userId: 'mateo', name: 'Colgar ropa',      icon: '🪝', coins: 5,  freq: 'Semanal' },
    { id: 't5',  userId: 'mateo', name: 'Lavar ropa',       icon: '🫧', coins: 5,  freq: 'Semanal' },
    { id: 't6',  userId: 'mateo', name: 'Barrer',           icon: '🧹', coins: 10, freq: 'Diaria'  },
    { id: 't7',  userId: 'mateo', name: 'Trapear',          icon: '🪣', coins: 10, freq: 'Semanal' },
    { id: 't8',  userId: 'mateo', name: 'Organizar sala',   icon: '🛋️', coins: 5,  freq: 'Diaria'  },
    { id: 't9',  userId: 'mateo', name: 'Limpiar comedor',  icon: '🪑', coins: 5,  freq: 'Semanal' },
  ],
  rewards: [
    { id: 'r1', name: '30 min de TV',    icon: '📺', cost: 30,  type: 'Tiempo' },
    { id: 'r2', name: '30 min de Compu', icon: '💻', cost: 30,  type: 'Tiempo' },
    { id: 'r3', name: '300 Robux',       icon: '🎮', cost: 300, type: 'Premio' },
    { id: 'r4', name: 'Pizza',           icon: '🍕', cost: 500, type: 'Premio' },
  ],
  pendingApprovals: [], // {id, taskId, userId, taskName, coins, timestamp}
  completedToday: [],   // task IDs completed (reset daily)
  purchases: [],        // {userId, rewardId, rewardName, cost, timestamp}
  lastReset: null,
};

function normalizeState(s) {
  // Si viene vacío o no es objeto, usa default completo
  if (!s || typeof s !== 'object') return JSON.parse(JSON.stringify(DEFAULT_DATA));

  // Base completa
  const base = JSON.parse(JSON.stringify(DEFAULT_DATA));
  const out = { ...base, ...s };

  // Asegura arrays obligatorios
  out.users   = Array.isArray(out.users)   ? out.users   : base.users;
  out.tasks   = Array.isArray(out.tasks)   ? out.tasks   : base.tasks;
  out.rewards = Array.isArray(out.rewards) ? out.rewards : base.rewards;

  // Asegura estructuras opcionales
  out.purchases        = Array.isArray(out.purchases) ? out.purchases : [];
  out.pendingApprovals = Array.isArray(out.pendingApprovals) ? out.pendingApprovals : [];
  out.completedToday   = Array.isArray(out.completedToday) ? out.completedToday : [];
  out.lastReset        = out.lastReset ?? null;

  // compat legacy
  out.requests = Array.isArray(out.requests) ? out.requests : [];

  // Normaliza coins por usuario (evita undefined / strings)
  out.users = out.users.map(u => ({
    ...u,
    coins: Number.isFinite(Number(u.coins)) ? Number(u.coins) : 0
  }));

  return out;
}


let state = null;
let stateUpdatedAt = null;
let currentUser = null;
let selectedLoginUser = null;

async function loadData() {
  // Carga el estado global (users, tasks, rewards, purchases, pendingApprovals, completedToday)
  const key = 'state'; // clave global compartida
  const result = await loadKeyFromSheets(key);

  if (result) {
    state = normalizeState(result.data);
    stateUpdatedAt = result.updatedAt || stateUpdatedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log('[DATA] Estado cargado desde Google Sheets ✅');
    return;
  }

  // Fallback localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = normalizeState(JSON.parse(raw));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      console.log('[DATA] Estado cargado desde localStorage (fallback) ⚠️');
    } else {
      state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
      console.log('[DATA] Sin datos previos — usando DEFAULT_DATA 🆕');
    }
  } catch (e) {
    state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
    console.warn('[DATA] Error leyendo localStorage:', e);
  }
}
    // Si el estado remoto está vacío pero tenemos algo local,
    // lo "sembramos" en Sheets para que otros dispositivos lo vean.
    if (!localStorage.getItem('fcb_seeded_state')) {
      console.log('[DATA] Sembrando estado en Google Sheets…');
      saveKeyToSheets('state', state);
      localStorage.setItem('fcb_seeded_state', '1');
    }


function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  console.log('[DATA] Guardado en localStorage ✅');
  saveKeyToSheets('state', state);
}




// ================================================================
// LOGIN
// ================================================================
function renderLoginUsers() {
  const container = document.getElementById('userSelect');
  container.innerHTML = '';
  const users = state?.users;
  if (!Array.isArray(users)) {
    console.warn('[LOGIN] state.users no disponible, usando DEFAULT_DATA.users');
    state = normalizeState(state);
  }
  (state.users || []).forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'user-btn';
    btn.innerHTML = `
      <span class="avatar">${u.avatar}</span>
      <div class="info">
        <div>${u.name}</div>
        <div class="role">${u.role === 'admin' ? '⚙️ Administrador' : '🎮 Jugador'}</div>
      </div>
      <span>▶</span>
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
  document.getElementById('userSelect').style.display = 'flex';
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
    if (currentUser.role === 'admin') {
      // Cargar requests antes de mostrar panel
      await loadRequests();
      showScreen('adminScreen');
      renderAdminPanel();
      startAdminAutoSync();
      startAdminStateAutoSync();
    } else {
      // Cargar requests del usuario para mostrar estado en tienda
      await loadRequests();
      showScreen('mainScreen');
      renderMainScreen();
      startUserSync();
    }
  } else {
    playSound('error');
    document.getElementById('pinError').style.display = 'block';
    document.getElementById('pinInput').value = '';
  }
}

function doLogout() {
  stopAdminAutoSync();
  stopUserSync();
  currentUser = null;
  selectedLoginUser = null;
  showScreen('loginScreen');
  document.getElementById('userSelect').style.display = 'flex';
  document.getElementById('pinBox').classList.remove('visible');
  renderLoginUsers();
}

// ================================================================
// SCREENS
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ================================================================
// MAIN USER SCREEN
// ================================================================
function renderMainScreen() {
  const user = state.users.find(u => u.id === currentUser.id);
  currentUser = user;

  // Coin display
  document.getElementById('coinDisplay').textContent = user.coins;
  document.getElementById('topbarCenter').innerHTML =
    `${user.avatar} ${user.name}<br><span style="font-size:9px;color:#cdf;">⭐ MISIONES</span>`;

  // Day label
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const now = new Date();
  document.getElementById('dayLabel').textContent =
    `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  renderMissions();
  updatePendingBadge();
}

function getMyTasks() {
  return state.tasks.filter(t => t.userId === currentUser.id);
}

function renderMissions() {
  const list = document.getElementById('missionsList');
  list.innerHTML = '';
  const myTasks = getMyTasks();

  if (myTasks.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:#cdf;text-align:center;padding:20px;">¡No tienes misiones asignadas! 😴</div>';
    return;
  }

  myTasks.forEach(task => {
    const isCompleted = state.completedToday.includes(task.id);
    const pendingEntry = state.pendingApprovals.find(p => p.taskId === task.id && p.userId === currentUser.id);
    const isPending = !!pendingEntry;

    const card = document.createElement('div');
    card.className = `mission-card${isCompleted ? ' completed' : ''}${isPending ? ' pending-approval' : ''}`;

    let actionBtn = '';
    if (isCompleted) {
      actionBtn = `<button class="btn-check done" disabled>✅</button>`;
    } else if (isPending) {
      // Botón para anular el envío por error
      actionBtn = `<button class="btn-check" style="background:#800;border-color:#500;font-size:10px;" onclick="undoTask('${pendingEntry.id}')" title="Anular envío">↩</button>`;
    } else {
      actionBtn = `<button class="btn-check" onclick="submitTask('${task.id}')">☐</button>`;
    }

    card.innerHTML = `
      <div class="mission-icon">${task.icon || '⭐'}</div>
      <div class="mission-info">
        <div class="mission-name">${task.name}</div>
        <div class="mission-meta">
          <span>${isCompleted ? '✅ Aprobada' : isPending ? '⏳ Esperando · toca ↩ para anular' : ''}</span>
        </div>
      </div>
      <div class="mission-coins">🪙${task.coins}</div>
      ${actionBtn}
    `;
    list.appendChild(card);
  });
}

function undoTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('error');
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);
  saveData();
  renderMissions();
  updatePendingBadge();
  showToast(`↩ "${pa.taskName}" anulada`);
}

function submitTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  playSound('submit');

  // Add to pending approvals
  state.pendingApprovals.push({
    id: 'pa_' + Date.now(),
    taskId: task.id,
    userId: currentUser.id,
    userName: currentUser.name,
    taskName: task.name,
    coins: task.coins,
    timestamp: new Date().toISOString()
  });

  saveData();
  renderMissions();
  updatePendingBadge();
  showToast(`📨 "${task.name}" enviada para aprobación!`);
  spawnParticles('⭐', null, null);
}

function updatePendingBadge() {
  const count = state.pendingApprovals.filter(p => p.userId === currentUser?.id).length;
  const el = document.getElementById('pendingBadgeMain');
  if (el) el.innerHTML = count > 0 ? `<span class="badge">${count}</span>` : '';
}

// ── Polling de novedades para usuario (Mateo) ────────────────────
let userSyncInterval = null;
let lastKnownRequestStates = {}; // reqId -> status

function startUserSync() {
  stopUserSync();
  // Captura estados actuales como línea base
  requests.filter(r => r.userId === currentUser?.id).forEach(r => {
    lastKnownRequestStates[r.id] = r.status;
  });

  userSyncInterval = setInterval(async () => {
    if (!currentUser || currentUser.role !== 'user') { stopUserSync(); return; }
    try {
      // 1. Verificar requests (compras)
      const rResult = await loadKeyFromSheets(REQUESTS_KEY);
      if (rResult) {
        const fresh = unwrapSheets(rResult);
        if (Array.isArray(fresh)) {
          const myFresh = fresh.filter(r => r.userId === currentUser.id);
          myFresh.forEach(r => {
            const prev = lastKnownRequestStates[r.id];
            if (prev && prev !== r.status) {
              if (r.status === 'approved') { playSound('coin'); showToast(`✅ ¡Aprobado! ${r.rewardIcon} ${r.rewardName}`); spawnParticles('🪙', null, null); }
              else if (r.status === 'delivered') { playSound('buy'); showToast(`🎁 ¡Entregado! ${r.rewardIcon} ${r.rewardName}`); spawnConfetti(); }
              else if (r.status === 'rejected') { playSound('error'); showToast(`❌ Rechazado: ${r.rewardName}`); }
            }
            lastKnownRequestStates[r.id] = r.status;
          });
          requests = fresh;
          localStorage.setItem('fcb_requests', JSON.stringify(requests));
        }
      }

      // 2. Verificar estado global (coins, pendingApprovals)
      const sResult = await loadKeyFromSheets('state');
      if (sResult) {
        const fresh = unwrapSheets(sResult);
        if (fresh && fresh.users) {
          const prevCoins = state.users.find(u => u.id === currentUser.id)?.coins || 0;
          state = normalizeState(fresh);
          currentUser = state.users.find(u => u.id === currentUser.id);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          const newCoins = currentUser?.coins || 0;
          if (newCoins > prevCoins) {
            playSound('coin');
            showToast(`🪙 +${newCoins - prevCoins} coins! Misión aprobada 🎉`);
            spawnParticles('🪙', null, null);
          }
          document.getElementById('coinDisplay').textContent = newCoins;
          const mcd = document.getElementById('modalCoinDisplay');
          if (mcd) mcd.textContent = newCoins;
        }
      }

      // 3. Refrescar UI siempre
      renderMissions();
      renderStoreRewards();
      renderPurchaseHistory();
      updatePendingBadge();
      setCloudStatus(true);
    } catch(e) {
      setCloudStatus(false);
      console.warn('[USER-SYNC]', e.message);
    }
  }, 10000);
}

function stopUserSync() {
  if (userSyncInterval) { clearInterval(userSyncInterval); userSyncInterval = null; }
}

// ================================================================
// WARP ZONE (Store)
// ================================================================
function openWarpZone() {
  playSound('coin');
  const user = state.users.find(u => u.id === currentUser.id);
  document.getElementById('modalCoinDisplay').textContent = user.coins;
  renderStoreRewards();
  renderPurchaseHistory();
  document.getElementById('warpZoneModal').classList.add('open');
}

function closeWarpZone() {
  document.getElementById('warpZoneModal').classList.remove('open');
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['tiempo','premios','historial'][i] === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

function renderStoreRewards() {
  const user = state.users.find(u => u.id === currentUser.id);
  const tiempo = state.rewards.filter(r => r.type === 'Tiempo');
  const premios = state.rewards.filter(r => r.type === 'Premio');

  ['tiempo', 'premios'].forEach(tab => {
    const list = tab === 'tiempo' ? tiempo : premios;
    const el = document.getElementById('tab-' + tab);
    if (list.length === 0) {
      el.innerHTML = '<div style="font-size:10px;color:#aaa;padding:10px;">No hay recompensas en esta categoría</div>';
      return;
    }
    el.innerHTML = list.map(r => {
      const hasPending  = requests.some(req => req.userId === user.id && req.rewardId === r.id && req.status === 'pending');
      const canAfford   = user.coins >= r.cost;
      const btnDisabled = (hasPending || !canAfford) ? 'disabled' : '';
      const btnLabel    = hasPending  ? '⏳ PENDIENTE'
                        : !canAfford  ? '🔒 SIN COINS'
                        :               '📨 SOLICITAR';
      return `<div class="reward-card">
        <div class="reward-icon">${r.icon || '🏆'}</div>
        <div class="reward-info">
          <div class="reward-name">${r.name}</div>
          <div class="reward-cost" style="color:${canAfford ? 'var(--coin)' : '#f88'}">🪙 ${r.cost} coins${!canAfford ? ` (te faltan ${r.cost - user.coins})` : ''}</div>
          <div class="reward-type">${r.type === 'Tiempo' ? '⏱️ Tiempo de pantalla' : '🎁 Premio'}</div>
        </div>
        <button class="btn-buy" ${btnDisabled} data-reward-id="${r.id}" onclick="buyReward('${r.id}')">
          ${btnLabel}
        </button>
      </div>`;
    }).join('');
  });
}

async function buyReward(rewardId) {
  const reward = state.rewards.find(r => r.id === rewardId);
  const user = state.users.find(u => u.id === currentUser.id);
  if (!reward || !user) return;

  // Bloquear botón temporalmente para evitar doble envío
  const btn = document.querySelector(`[data-reward-id="${rewardId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  playSound('submit');
  const ok = await addRequest(reward, user);

  if (ok) {
    spawnParticles('⭐', null, null);
    showToast(`📨 Solicitud enviada: ${reward.name}\n¡Espera aprobación del Admin!`);
    renderStoreRewards();
    renderPurchaseHistory();
  }

  // Re-habilitar tras 2s
  setTimeout(() => { if (btn) { btn.disabled = false; renderStoreRewards(); } }, 2000);
}

function renderPurchaseHistory() {
  const myRequests = requests.filter(r => r.userId === currentUser.id);
  const el = document.getElementById('tab-historial');
  if (myRequests.length === 0) {
    el.innerHTML = '<div style="font-size:10px;color:#aaa;padding:10px;">Aún no has solicitado nada 🛒</div>';
    return;
  }
  const statusLabel = { pending:'⏳ Pendiente', approved:'✅ Aprobado', delivered:'🎁 Entregado', rejected:'❌ Rechazado' };
  const statusColor = { pending:'#ffd700', approved:'#9fc', delivered:'#4af', rejected:'#f88' };
  el.innerHTML = myRequests.slice(0, 20).map(r => {
    const d = new Date(r.createdAt);
    const fmt = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
    return `<div class="purchase-item">
      <span>${r.rewardIcon} ${r.rewardName}</span>
      <span style="color:${statusColor[r.status]||'#fff'}">${statusLabel[r.status]||r.status} · 🪙${r.cost} · ${fmt}</span>
    </div>`;
  }).join('');
}

// ================================================================
// ADMIN PANEL
// ================================================================
function renderAdminPanel() {
  renderPendingApprovals();   // tareas (existente)
  renderAdminRequestsPanel(); // solicitudes de compra (nuevo)
  renderUserStats();
  renderTaskListAdmin();
  renderRewardListAdmin();
  populateAdminSelects();
  updateAdminBadge();
  updateAdminRequestsBadge();
  makeAdminCollapsible();
}

function makeAdminCollapsible() {
  const sections = document.querySelectorAll('#adminScreen .admin-section');
  sections.forEach(sec => {
    // Evita duplicar wrappers
    if (sec.querySelector(':scope > .admin-body')) return;

    const title = sec.querySelector(':scope > .admin-section-title');
    if (!title) return;

    // Crea wrapper para el contenido
    const body = document.createElement('div');
    body.className = 'admin-body';

    // Mueve todos los nodos después del título
    const nodes = [];
    let n = title.nextSibling;
    while (n) { nodes.push(n); n = n.nextSibling; }
    nodes.forEach(node => body.appendChild(node));
    sec.appendChild(body);

    // Click para colapsar
    title.addEventListener('click', (e) => {
      // Si el click fue en un botón dentro del título (ej: SYNC), no colapses
      const isButton = e.target.closest('button');
      if (isButton) return;
      sec.classList.toggle('collapsed');
    });
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

// ── Panel de solicitudes de compra ───────────────────────────────
function renderAdminRequestsPanel() {
  const el = document.getElementById('adminRequestsList');
  if (!el) return;
  const active = requests.filter(r => r.status !== 'delivered' && r.status !== 'rejected');
  const done   = requests.filter(r => r.status === 'delivered' || r.status === 'rejected').slice(0, 10);

  if (active.length === 0 && done.length === 0) {
    el.innerHTML = '<div style="font-size:10px;color:#aaa;">No hay solicitudes aún 🎉</div>';
    return;
  }

  const statusColor = { pending:'#ffd700', approved:'#9fc', delivered:'#4af', rejected:'#f88' };
  const statusLabel = { pending:'⏳ Pendiente', approved:'✅ Aprobado', delivered:'🎁 Entregado', rejected:'❌ Rechazado' };

  const renderReq = (r) => {
    const d = new Date(r.createdAt);
    const fmt = `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    const userCoins = (state.users.find(u => u.id === r.userId) || {}).coins || 0;
    const canAfford = userCoins >= r.cost;
    let actions = '';
    if (r.status === 'pending') {
      actions = `
        <button class="btn-reject" onclick="rejectRequest('${r.id}')">✕</button>
        <button class="btn-approve" ${canAfford ? '' : 'disabled title="Sin coins"'} onclick="approveRequest('${r.id}')">✓</button>`;
    } else if (r.status === 'approved') {
      actions = `<button class="btn-approve" style="font-size:11px;padding:6px;" onclick="deliverRequest('${r.id}')">🎁 DAR</button>`;
    }
    return `<div class="approval-item">
      <div class="approval-info">
        <div class="approval-user">${r.userAvatar || ''} ${r.userName}</div>
        <div>${r.rewardIcon} ${r.rewardName} · 🪙${r.cost}</div>
        <div style="color:${statusColor[r.status]}">${statusLabel[r.status]} · ${fmt}</div>
        ${r.status === 'pending' && !canAfford ? '<div style="color:#f88;font-size:9px;">⚠️ Sin coins suficientes</div>' : ''}
      </div>
      <div style="display:flex;gap:4px;">${actions}</div>
    </div>`;
  };

  el.innerHTML =
    (active.length ? active.map(renderReq).join('') : '') +
    (done.length ? `<div style="font-size:9px;color:#888;margin:8px 0 4px;">— Historial reciente —</div>` + done.map(renderReq).join('') : '');
}

function renderPendingApprovals() {
  const el = document.getElementById('pendingApprovals');
  if (state.pendingApprovals.length === 0) {
    el.innerHTML = '<div style="font-size:10px;color:#aaa;">No hay tareas pendientes 🎉</div>';
    return;
  }
  el.innerHTML = state.pendingApprovals.map(p => {
    const d = new Date(p.timestamp);
    const fmt = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `<div class="approval-item">
      <div class="approval-info">
        <div class="approval-user">${p.userName}</div>
        <div>${p.taskName}</div>
        <div>🪙 ${p.coins} coins · ${fmt}</div>
      </div>
      <button class="btn-reject" onclick="rejectTask('${p.id}')">✕</button>
      <button class="btn-approve" onclick="approveTask('${p.id}')">✓</button>
    </div>`;
  }).join('');
}

function approveTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('coin');

  const userIdx = state.users.findIndex(u => u.id === pa.userId);
  if (userIdx >= 0) state.users[userIdx].coins += pa.coins;

  state.completedToday.push(pa.taskId);
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);

  saveData();
  renderPendingApprovals();
  renderUserStats();
  updateAdminBadge();
  showToast(`✅ Aprobada: "${pa.taskName}" → +${pa.coins}🪙 a ${pa.userName}`);
  spawnParticles('🪙', null, null);
}

function rejectTask(paId) {
  const pa = state.pendingApprovals.find(p => p.id === paId);
  if (!pa) return;
  playSound('error');
  state.pendingApprovals = state.pendingApprovals.filter(p => p.id !== paId);
  saveData();
  renderPendingApprovals();
  updateAdminBadge();
  showToast(`❌ Rechazada: "${pa.taskName}"`);
}

function renderUserStats() {
  const el = document.getElementById('userStats');
  el.innerHTML = state.users.map(u => `
    <div class="user-stat-card">
      <span class="uavatar">${u.avatar}</span>
      <div class="user-stat-info">
        <div style="color:var(--coin);font-size:11px;">${u.name}</div>
        <div>${u.role === 'admin' ? '⚙️ Admin' : '🎮 Jugador'}</div>
      </div>
      <span class="user-stat-coins">🪙${u.coins}</span>
    </div>
  `).join('');
}

function populateAdminSelects() {
  const userSel = document.getElementById('adjUserSel');
  const taskUserSel = document.getElementById('newTaskUser');
  const players = state.users.filter(u => u.role === 'user');

  userSel.innerHTML = state.users.map(u =>
    `<option value="${u.id}">${u.avatar} ${u.name}</option>`).join('');
  taskUserSel.innerHTML = players.map(u =>
    `<option value="${u.id}">${u.avatar} ${u.name}</option>`).join('');
}

function adjustCoins(dir) {
  const userId = document.getElementById('adjUserSel').value;
  const amount = parseInt(document.getElementById('adjAmount').value) || 0;
  if (amount <= 0) { showToast('⚠️ Ingresa una cantidad válida'); return; }

  const userIdx = state.users.findIndex(u => u.id === userId);
  if (userIdx < 0) return;
  state.users[userIdx].coins = Math.max(0, state.users[userIdx].coins + (dir * amount));
  saveData();
  renderUserStats();
  playSound('coin');
  showToast(`💰 ${dir > 0 ? '+' : '-'}${amount} coins a ${state.users[userIdx].name}`);
}

function renderTaskListAdmin() {
  const el = document.getElementById('taskListAdmin');
  el.innerHTML = state.tasks.map(t => {
    const assignedUser = state.users.find(u => u.id === t.userId);
    return `<div class="task-admin-item">
      <span class="task-ico">${t.icon || '⭐'}</span>
      <div class="task-admin-info">
        <div style="color:var(--coin)">${t.name}</div>
        <div>${assignedUser?.avatar || ''} ${assignedUser?.name || t.userId} · ${t.freq} · 🪙${t.coins}</div>
      </div>
      <button class="btn-del" onclick="deleteTask('${t.id}')">🗑</button>
    </div>`;
  }).join('');
}

function addTask() {
  const name = document.getElementById('newTaskName').value.trim();
  const icon = document.getElementById('newTaskIcon').value.trim() || '⭐';
  const coins = parseInt(document.getElementById('newTaskCoins').value) || 1;
  const freq = document.getElementById('newTaskFreq').value;
  const userId = document.getElementById('newTaskUser').value;

  if (!name) { showToast('⚠️ Escribe el nombre de la tarea'); return; }

  state.tasks.push({
    id: 't_' + Date.now(),
    userId, name, icon, coins, freq
  });
  saveData();
  renderTaskListAdmin();
  document.getElementById('newTaskName').value = '';
  document.getElementById('newTaskIcon').value = '';
  document.getElementById('newTaskCoins').value = '';
  playSound('buy');
  showToast(`✅ Misión agregada: ${name}`);
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  state.pendingApprovals = state.pendingApprovals.filter(p => p.taskId !== taskId);
  state.completedToday = state.completedToday.filter(id => id !== taskId);
  saveData();
  renderTaskListAdmin();
  renderPendingApprovals();
  updateAdminBadge();
  showToast('🗑 Misión eliminada');
}

function renderRewardListAdmin() {
  const el = document.getElementById('rewardListAdmin');
  el.innerHTML = state.rewards.map(r => `
    <div class="task-admin-item">
      <span class="task-ico">${r.icon || '🏆'}</span>
      <div class="task-admin-info">
        <div style="color:var(--coin)">${r.name}</div>
        <div>${r.type} · 🪙${r.cost}</div>
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
  saveData();
  renderRewardListAdmin();
  document.getElementById('newRewardName').value = '';
  document.getElementById('newRewardIcon').value = '';
  document.getElementById('newRewardCost').value = '';
  playSound('buy');
  showToast(`🏆 Recompensa agregada: ${name}`);
}

function deleteReward(rewardId) {
  state.rewards = state.rewards.filter(r => r.id !== rewardId);
  saveData();
  renderRewardListAdmin();
  showToast('🗑 Recompensa eliminada');
}

// Reset diario SIN borrar coins: primero trae el estado más reciente de la nube
// para no pisar monedas acumuladas por otros dispositivos.
async function resetDailyTasks() {
  if (!confirm('¿Reiniciar misiones del día? Esto limpiará las tareas completadas.')) return;

  // 1) Intenta refrescar desde nube (si hay algo más nuevo, úsalo)
  try {
    const remote = await loadKeyFromSheets('state');
    if (remote && remote.data) {
      const remoteUpdatedAt = remote.updatedAt;
      // Si no tenemos updatedAt local o el remoto es más reciente, adopta el remoto
      if (!stateUpdatedAt || (remoteUpdatedAt && remoteUpdatedAt !== stateUpdatedAt)) {
        state = normalizeState(remote.data);
        stateUpdatedAt = remoteUpdatedAt || stateUpdatedAt;
      }
    }
  } catch (_) {
    // Si falla, seguimos con estado local (no queremos bloquear el reset)
  }

  // 2) Aplica el reset SOLO a lo diario
  state.completedToday = [];
  state.pendingApprovals = [];
  state.lastReset = new Date().toISOString();

  // 3) Guarda (esto ahora ya incluye los coins correctos)
  saveData();
  renderAdminPanel();
  showToast('🔄 ¡Misiones del día reiniciadas!');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `familia_campos_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

// ================================================================
// EFFECTS
// ================================================================
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function spawnParticles(emoji, x, y) {
  const cx = x || window.innerWidth / 2;
  const cy = y || window.innerHeight / 2;
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emoji;
    const angle = (i / 8) * Math.PI * 2;
    const dist = 60 + Math.random() * 60;
    p.style.cssText = `left:${cx}px;top:${cy}px;--tx:${Math.cos(angle)*dist}px;--ty:${Math.sin(angle)*dist}px;animation-duration:${0.6 + Math.random()*0.4}s;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

function spawnConfetti() {
  const colors = ['#FFD700','#FF6B6B','#5C94FC','#4CAF50','#FF69B4','#FFA500'];
  for (let i = 0; i < 30; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.style.cssText = `
      left: ${Math.random() * 100}vw;
      top: -20px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${6 + Math.random() * 8}px;
      height: ${6 + Math.random() * 8}px;
      animation-duration: ${1 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.5}s;
    `;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}

function showTab(tab) { /* placeholder for bottom nav */ }

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1) Carga rápida desde localStorage (no bloquea el login)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalizeState(JSON.parse(raw));
    else state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
  } catch (e) {
    console.warn('[INIT] Fallback a DEFAULT_DATA por error leyendo localStorage', e);
    state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_DATA)));
  }

  renderLoginUsers(); // login inmediato

  // Close modal on outside click
  document.getElementById('warpZoneModal').addEventListener('click', function(e) {
    if (e.target === this) closeWarpZone();
  });

  // 2) Sincroniza con Sheets en segundo plano (sin bloquear clicks)
  loadData().then(() => {
    renderLoginUsers(); // refresca lista/estado si cambió
  });

  // Register Service Worker for PWA (opcional)
  if ('serviceWorker' in navigator) {
    // navigator.serviceWorker.register('/sw.js');
  }
});
