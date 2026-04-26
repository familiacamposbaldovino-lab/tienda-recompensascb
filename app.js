// ================================================================
// MISIÓN MAKAMBÚ — SUPABASE FRONTEND
// Hábitos para familias modernas
// ================================================================

const SUPABASE_URL = 'https://nhqchhiwglulgraowvho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocWNoaGl3Z2x1bGdyYW93dmhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzYzMjAsImV4cCI6MjA5MjgxMjMyMH0.m1-knqCFAOutGlKP4oCVtGb_GVheJurf_rfvUYDppgo';
const FAMILY_ID = '11111111-1111-1111-1111-111111111111';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    const now = ctx.currentTime;
    if (type === 'error') {
      osc.type = 'square'; osc.frequency.setValueAtTime(220, now); osc.frequency.setValueAtTime(150, now + 0.15);
      gain.gain.setValueAtTime(0.18, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(); osc.stop(now + 0.3);
    } else if (type === 'buy') {
      osc.type = 'square'; osc.frequency.setValueAtTime(523, now); osc.frequency.setValueAtTime(659, now + 0.1); osc.frequency.setValueAtTime(784, now + 0.2);
      gain.gain.setValueAtTime(0.24, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(); osc.stop(now + 0.4);
    } else {
      osc.type = type === 'submit' ? 'triangle' : 'square'; osc.frequency.setValueAtTime(988, now); osc.frequency.setValueAtTime(1319, now + 0.1);
      gain.gain.setValueAtTime(0.24, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(); osc.stop(now + 0.3);
    }
  } catch(e) {}
}

// ================================================================
// STATE
// ================================================================
let session = null;
let currentUser = null;
let currentProfile = null;
let currentFamilyRole = null;
let familyMembers = [];
let tasks = [];
let rewards = [];
let taskSubmissions = [];
let rewardRequests = [];
let coinLedger = [];
let playerSettings = [];
let adjustmentCatalog = [];
let currentUserTab = 'inicio';
let currentAdminTab = 'inicio';
let autoRefreshInterval = null;

const $ = id => document.getElementById(id);

function todayBogotaISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
function dateBogotaISO(value) {
  const d = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
function fmtDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}
function currentBalance(playerId = currentUser?.id) {
  return coinLedger.filter(c => c.player_id === playerId).reduce((sum, c) => sum + Number(c.amount || 0), 0);
}
function myPlayerId() { return currentUser?.id; }
function isGuardianOrPlatform() { return currentProfile?.global_role === 'platform_admin' || currentFamilyRole === 'guardian'; }
function isPlayer() { return currentFamilyRole === 'player'; }
function getProfileName(id) {
  if (id === currentProfile?.id) return currentProfile.display_name;
  const fm = familyMembers.find(m => m.user_id === id);
  return fm?.profile?.display_name || (id ? `Usuario ${String(id).slice(0, 4)}` : 'Usuario');
}
function getPlayerIdsForAdmin() {
  const ids = familyMembers.filter(m => m.family_role === 'player').map(m => m.user_id);
  if (!ids.includes(currentUser?.id) && currentFamilyRole === 'player') ids.push(currentUser.id);
  return ids;
}

// ================================================================
// AUTH
// ================================================================
async function handleSupabaseLogin(event) {
  event.preventDefault();
  const email = $('emailInput')?.value.trim();
  const password = $('passwordInput')?.value;
  const btn = $('loginButton');
  const err = $('loginError');
  if (err) { err.classList.remove('visible'); err.textContent = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
  showLoading('Entrando a Makambú...');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  hideLoading();
  if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR ▶'; }
  if (error) {
    playSound('error');
    if (err) { err.textContent = 'No se pudo iniciar sesión. Revisa correo y contraseña.'; err.classList.add('visible'); }
    return;
  }
  session = data.session;
  await bootstrapApp();
}

async function doLogout() {
  stopAutoRefresh();
  await supabaseClient.auth.signOut();
  session = null; currentUser = null; currentProfile = null; currentFamilyRole = null;
  showScreen('loginScreen');
}

async function bootstrapApp() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  session = sessionData.session;
  if (!session?.user) { showScreen('loginScreen'); return; }
  currentUser = session.user;
  showLoading('Cargando perfil...');
  try {
    await loadBaseData();
    hideLoading();
    if (isGuardianOrPlatform()) {
      showScreen('adminScreen');
      renderAdminScreen();
      showAdminTab('inicio');
    } else {
      showScreen('mainScreen');
      renderMainScreen();
      showTab('inicio');
    }
    startAutoRefresh();
  } catch (e) {
    hideLoading();
    showToast('⚠️ Error cargando datos');
    console.error(e);
  }
}

// ================================================================
// SUPABASE LOADERS
// ================================================================
async function loadBaseData() {
  const { data: profile, error: profileErr } = await supabaseClient
    .from('profiles').select('*').eq('id', currentUser.id).single();
  if (profileErr) throw profileErr;
  currentProfile = profile;

  let { data: members, error: memErr } = await supabaseClient
    .from('family_members')
    .select('id,family_id,user_id,family_role,profiles:user_id(display_name,avatar,global_role,status)')
    .eq('family_id', FAMILY_ID);
  if (memErr) {
    const fallback = await supabaseClient.from('family_members').select('*').eq('family_id', FAMILY_ID);
    if (fallback.error) throw fallback.error;
    members = fallback.data || [];
  }
  familyMembers = (members || []).map(m => ({ ...m, profile: m.profiles || null }));
  currentFamilyRole = familyMembers.find(m => m.user_id === currentUser.id)?.family_role || (currentProfile.global_role === 'platform_admin' ? 'guardian' : 'player');

  await Promise.all([loadTasks(), loadRewards(), loadPlayerSettings(), loadTaskSubmissions(), loadRewardRequests(), loadCoinLedger(), loadAdjustmentCatalog()]);
}
async function loadTasks() {
  const { data, error } = await supabaseClient.from('tasks').select('*').eq('family_id', FAMILY_ID).eq('status', 'active').order('created_at');
  if (error) throw error; tasks = data || [];
}
async function loadRewards() {
  const { data, error } = await supabaseClient.from('rewards').select('*').eq('family_id', FAMILY_ID).eq('status', 'active').order('cost');
  if (error) throw error; rewards = data || [];
}
async function loadPlayerSettings() {
  const { data, error } = await supabaseClient.from('player_settings').select('*').eq('family_id', FAMILY_ID);
  if (error) throw error; playerSettings = data || [];
}
async function loadTaskSubmissions() {
  const { data, error } = await supabaseClient.from('task_submissions').select('*').eq('family_id', FAMILY_ID).order('submitted_at', { ascending: false });
  if (error) throw error; taskSubmissions = data || [];
}
async function loadRewardRequests() {
  const { data, error } = await supabaseClient.from('reward_requests').select('*').eq('family_id', FAMILY_ID).order('requested_at', { ascending: false });
  if (error) throw error; rewardRequests = data || [];
}
async function loadCoinLedger() {
  const { data, error } = await supabaseClient.from('coin_ledger').select('*').eq('family_id', FAMILY_ID).order('created_at', { ascending: false });
  if (error) throw error; coinLedger = data || [];
}
async function loadAdjustmentCatalog() {
  const { data, error } = await supabaseClient.from('adjustment_catalog').select('*').eq('status','active').order('coins', { ascending: false });
  if (error) throw error; adjustmentCatalog = data || [];
}
async function refreshAll() {
  await Promise.all([loadTasks(), loadRewards(), loadPlayerSettings(), loadTaskSubmissions(), loadRewardRequests(), loadCoinLedger(), loadAdjustmentCatalog()]);
  if (isGuardianOrPlatform()) renderAdminScreen(); else renderMainScreen();
  if (currentUserTab) showTab(currentUserTab);
  if (currentAdminTab) showAdminTab(currentAdminTab);
}
function startAutoRefresh() { stopAutoRefresh(); autoRefreshInterval = setInterval(refreshAll, 20000); }
function stopAutoRefresh() { if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; } }
async function manualUserRefresh() { showToast('🔄 Actualizando...'); await refreshAll(); showToast('✅ Actualizado'); }
async function syncRequestsNow() { await manualUserRefresh(); }

// ================================================================
// SCREENS & TABS
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(id); if (el) el.classList.add('active');
}
function showTab(tab) {
  ['inicio','misiones','tienda','historial'].forEach(t => { const el = $('tab-' + t); if (el) el.style.display = 'none'; });
  const target = $('tab-' + tab); if (target) target.style.display = 'block';
  document.querySelectorAll('#mainNav .nav-item').forEach((btn, i) => btn.classList.toggle('active', ['inicio','misiones','tienda','historial'][i] === tab));
  currentUserTab = tab;
  if (tab === 'inicio') { renderMissionsPreview(); updateWeeklyProgress(); }
  if (tab === 'misiones') renderMissions();
  if (tab === 'tienda') renderQuickHistory();
  if (tab === 'historial') renderHistorialTab();
}
function showAdminTab(tab) {
  ['inicio','misiones','tienda','historial','gestion'].forEach(t => { const el = $('admin-tab-' + t); if (el) el.style.display = 'none'; });
  const target = $('admin-tab-' + tab); if (target) target.style.display = 'block';
  document.querySelectorAll('#adminNav .nav-item').forEach((btn, i) => btn.classList.toggle('active', ['inicio','misiones','tienda','historial','gestion'][i] === tab));
  currentAdminTab = tab;
  if (tab === 'inicio') renderAdminPanel();
  if (tab === 'misiones') renderAdminMissions();
  if (tab === 'tienda') renderAdminQuickHistory();
  if (tab === 'historial') renderAdminHistorialTab();
  if (tab === 'gestion') { populateAdminSelects(); renderTaskListAdmin(); renderRewardListAdmin(); renderAdjustCatalogAdmin(); }
}

// ================================================================
// PLAYER MAIN
// ================================================================
function renderMainScreen() {
  const avatar = currentProfile.avatar || '🎮';
  if ($('mainAvatar')) $('mainAvatar').textContent = avatar;
  if ($('mainName')) $('mainName').textContent = currentProfile.display_name;
  if ($('mainRole')) $('mainRole').textContent = '🎮 Jugador';
  if ($('coinDisplay')) $('coinDisplay').textContent = currentBalance();
  if ($('heroGreeting')) $('heroGreeting').textContent = greetingNow();
  if ($('heroName')) $('heroName').textContent = `${currentProfile.display_name} ${avatar}`;
  if ($('heroCoins')) $('heroCoins').textContent = currentBalance();
  renderMissionsPreview(); updatePendingBadge(); updateWeeklyProgress(); renderStoreRewards(); renderQuickHistory(); renderHistorialTab();
}
function greetingNow() { const h = new Date().getHours(); return h < 12 ? '¡Buenos días!' : h < 18 ? '¡Buenas tardes!' : '¡Buenas noches!'; }
function myTasks() { return tasks.filter(t => t.assigned_to === currentUser.id); }
function approvedTodayCount(playerId = currentUser.id) {
  const today = todayBogotaISO();
  return taskSubmissions.filter(s => s.player_id === playerId && s.status === 'approved' && s.counts_for_daily_goal && dateBogotaISO(s.reviewed_at || s.submitted_at) === today).length;
}
function dailyGoal(playerId = currentUser.id) { return playerSettings.find(ps => ps.player_id === playerId)?.daily_goal || 5; }
function updateWeeklyProgress() {
  const done = approvedTodayCount();
  const goal = dailyGoal();
  const pct = Math.min(100, Math.round((done / Math.max(goal,1)) * 100));
  if ($('weeklyPct')) $('weeklyPct').textContent = `${done}/${goal}`;
  if ($('weeklyFill')) $('weeklyFill').style.width = pct + '%';
  const row = document.querySelector('.weekly-row span:first-child');
  if (row) row.textContent = 'Progreso diario';
}
function taskStatus(taskId, playerId = currentUser.id) {
  const today = todayBogotaISO();
  const todayApproved = taskSubmissions.find(s => s.task_id === taskId && s.player_id === playerId && s.status === 'approved' && dateBogotaISO(s.reviewed_at || s.submitted_at) === today);
  if (todayApproved) return { status: 'done' };
  const pending = taskSubmissions.find(s => s.task_id === taskId && s.player_id === playerId && s.status === 'pending');
  if (pending) return { status: 'pending', id: pending.id };
  return { status: 'open' };
}
function missionCardHtml(task, preview = false) {
  const st = taskStatus(task.id, task.assigned_to);
  const stateClass = st.status === 'done' ? 'completed' : st.status === 'pending' ? 'pending-review' : '';
  const tag = st.status === 'done' ? '<span class="mission-tag done">✅ Aprobada</span>' : st.status === 'pending' ? '<span class="mission-tag pending">⏳ Esperando aprobación</span>' : `<span class="mission-tag freq">${task.frequency === 'weekly' ? 'Semanal' : 'Diaria'}</span>`;
  const action = preview ? '' : st.status === 'done' ? '<button class="btn-mission-action done" disabled>✅</button>' : st.status === 'pending' ? `<button class="btn-mission-action undo" onclick="undoTask('${st.id}')">↩</button>` : `<button class="btn-mission-action" onclick="submitTask('${task.id}')">☐</button>`;
  return `<div class="mission-card ${stateClass}">
    <div class="mission-icon-box">${task.icon || '⭐'}</div>
    <div class="mission-info"><div class="mission-name">${escapeHtml(task.name)}</div><div>${tag}</div></div>
    <div class="mission-coins-pill">🪙${task.coins}</div>${action}
  </div>`;
}
function renderMissionsPreview() {
  const el = $('missionsPreview'); if (!el) return;
  const list = myTasks().slice(0, 3);
  el.innerHTML = list.length ? list.map(t => missionCardHtml(t, true)).join('') : empty('😴','Sin misiones asignadas');
}
function renderMissions() {
  const el = $('missionsList'); if (!el) return;
  const list = myTasks();
  el.innerHTML = list.length ? list.map(t => missionCardHtml(t)).join('') : empty('😴','Sin misiones asignadas');
}
async function submitTask(taskId) {
  const task = tasks.find(t => t.id === taskId); if (!task) return;
  const st = taskStatus(taskId, currentUser.id);
  if (st.status === 'pending') return showToast('⏳ Ya enviaste esta misión');
  if (st.status === 'done') return showToast('✅ Ya fue aprobada hoy');
  const { error } = await supabaseClient.from('task_submissions').insert({ family_id: FAMILY_ID, task_id: taskId, player_id: currentUser.id, status: 'pending' });
  if (error) return fail(error, 'No se pudo enviar la misión');
  playSound('submit'); showToast(`📨 ${task.name} enviada`); spawnParticles('⭐'); await refreshAll();
}
async function undoTask(submissionId) {
  if (!submissionId) return;

  const { error } = await supabaseClient
    .from('task_submissions')
    .delete()
    .eq('id', submissionId)
    .eq('player_id', currentUser.id)
    .eq('status', 'pending');

  if (error) return fail(error, 'No se pudo cancelar la misión');

  playSound('error');
  showToast('↩ Misión cancelada');
  await refreshAll();
}
function updatePendingBadge() {
  const count = taskSubmissions.filter(s => s.player_id === currentUser?.id && s.status === 'pending').length;
  const el = $('pendingBadgeMain'); if (el) el.innerHTML = count > 0 ? `<span class="badge">${count}</span>` : '';
}

// ================================================================
// STORE
// ================================================================
function openWarpZone() { playSound('coin'); if ($('modalCoinDisplay')) $('modalCoinDisplay').textContent = currentBalance(); renderStoreRewards(); renderStorePurchaseHistory(); $('warpZoneModal')?.classList.add('open'); }
function closeWarpZone() { $('warpZoneModal')?.classList.remove('open'); }
function switchTab(tab) {
  const tabs = ['tiempo','premios','store-hist'];
  document.querySelectorAll('#warpZoneModal .tab-pill').forEach((b, i) => b.classList.toggle('active', tabs[i] === tab));
  document.querySelectorAll('#warpZoneModal .tab-pane').forEach(p => p.classList.remove('active'));
  $('tab-' + tab)?.classList.add('active');
}
function rewardsUnlocked(playerId = currentUser.id) { return approvedTodayCount(playerId) >= dailyGoal(playerId); }
function renderStoreRewards() {
  const balance = currentBalance();
  if ($('modalCoinDisplay')) $('modalCoinDisplay').textContent = balance;
  const byType = { 'Tiempo': $('tab-tiempo'), 'Premio': $('tab-premios') };
  Object.entries(byType).forEach(([type, el]) => {
    if (!el) return;
    const list = rewards.filter(r => r.type === type);
    if (!list.length) { el.innerHTML = empty('🏪','No hay recompensas aquí'); return; }
    el.innerHTML = list.map(r => {
      const hasPending = rewardRequests.some(req => req.player_id === currentUser.id && req.reward_id === r.id && req.status === 'pending');
      const canAfford = balance >= r.cost;
      const unlocked = !r.requires_daily_goal || rewardsUnlocked();
      const disabled = hasPending || !canAfford || !unlocked;
      const label = hasPending ? '⏳ Pendiente' : !unlocked ? `🔒 ${approvedTodayCount()}/${dailyGoal()} misiones` : !canAfford ? `🔒 Faltan ${r.cost - balance}` : '📨 Solicitar';
      return `<div class="reward-row">
        <div class="reward-icon-box">${r.icon || '🏆'}</div>
        <div class="reward-details"><div class="reward-row-name">${escapeHtml(r.name)}</div><div class="reward-row-cost ${canAfford ? '' : 'cant'}">🪙 ${r.cost} monedas</div>${!unlocked ? '<div class="lock-note">Completa tu meta diaria para desbloquear.</div>' : ''}</div>
        <button class="btn-buy" ${disabled ? 'disabled' : ''} onclick="buyReward('${r.id}')">${label}</button>
      </div>`;
    }).join('');
  });
}
async function buyReward(rewardId) {
  const reward = rewards.find(r => r.id === rewardId); if (!reward) return;
  if (currentBalance() < reward.cost) return showToast(`🔒 Te faltan ${reward.cost - currentBalance()} coins`);
  if (reward.requires_daily_goal && !rewardsUnlocked()) return showToast(`🔒 Completa ${dailyGoal() - approvedTodayCount()} misiones más`);
  const { error } = await supabaseClient.from('reward_requests').insert({ family_id: FAMILY_ID, reward_id: rewardId, player_id: currentUser.id, status: 'pending' });
  if (error) return fail(error, 'No se pudo solicitar recompensa');
  playSound('submit'); showToast(`📨 Solicitud enviada: ${reward.name}`); await refreshAll();
}
function renderStorePurchaseHistory() {
  const el = $('tab-store-hist'); if (!el) return;
  const mine = rewardRequests.filter(r => r.player_id === currentUser.id);
  el.innerHTML = mine.length ? mine.map(rewardRequestHtml).join('') : empty('🛒','Aún no has solicitado nada');
}
function renderQuickHistory() {
  const el = $('quickHistory'); if (!el) return;
  const mine = rewardRequests.filter(r => r.player_id === currentUser.id).slice(0, 5);
  el.innerHTML = mine.length ? mine.map(rewardRequestHtml).join('') : empty('🛒','Aún no has solicitado nada');
}
function renderHistorialTab() {
  const el = $('historialList'); if (!el) return;
  const ledger = coinLedger.filter(c => c.player_id === currentUser.id).slice(0, 30);
  const reqs = rewardRequests.filter(r => r.player_id === currentUser.id).slice(0, 10);
  el.innerHTML = (ledger.length || reqs.length) ? ledger.map(ledgerHtml).join('') + reqs.map(rewardRequestHtml).join('') : empty('📜','No hay actividad todavía');
}

// ================================================================
// ADMIN
// ================================================================
function renderAdminScreen() {
  if ($('adminName')) $('adminName').textContent = currentProfile.display_name || 'Admin';
  if ($('adminCoinDisplay')) $('adminCoinDisplay').textContent = currentBalance(currentUser.id);
  renderAdminPanel();
}
function renderAdminPanel() {
  renderPendingApprovals(); renderAdminRequestsPanel(); renderUserStats(); updateAdminBadge(); updateAdminRequestsBadge(); initAdminCollapsible();
}
function renderPendingApprovals() {
  const el = $('pendingApprovals'); if (!el) return;
  const pending = taskSubmissions.filter(s => s.status === 'pending');
  el.innerHTML = pending.length ? pending.map(s => {
    const task = tasks.find(t => t.id === s.task_id) || {};
    return `<div class="appr-item"><div class="appr-avatar">${task.icon || '⭐'}</div><div class="appr-info"><div class="appr-user">${getProfileName(s.player_id)}</div><div class="appr-detail">${escapeHtml(task.name || 'Misión')}</div><div class="appr-meta">🪙${task.coins || 0} · ${fmtDateTime(s.submitted_at)}</div></div><div class="appr-actions"><button class="btn-no" onclick="rejectTask('${s.id}')">✕</button><button class="btn-ok" onclick="approveTask('${s.id}')">✓</button></div></div>`;
  }).join('') : empty('🎉','No hay tareas pendientes');
}
async function approveTask(submissionId) {
  const s = taskSubmissions.find(x => x.id === submissionId); if (!s) return;
  const task = tasks.find(t => t.id === s.task_id); if (!task) return;
  const sameDay = dateBogotaISO(s.submitted_at) === todayBogotaISO();
  const status = sameDay ? 'approved' : 'late_approved';
  const coins = sameDay ? task.coins : 0;
  const { error: updErr } = await supabaseClient.from('task_submissions').update({ status, reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id, coins_awarded: coins, counts_for_daily_goal: sameDay }).eq('id', submissionId);
  if (updErr) return fail(updErr, 'No se pudo aprobar');
  if (coins > 0) {
    const { error: ledErr } = await supabaseClient.from('coin_ledger').insert({ family_id: FAMILY_ID, player_id: s.player_id, amount: coins, movement_type: 'task_reward', reason: `🌱 Creciste como el bambú +${coins}`, source_id: submissionId, created_by: currentUser.id });
    if (ledErr) return fail(ledErr, 'Aprobó, pero no registró coins');
    showToast(`✅ ${task.name} → +${coins} coins`); spawnParticles('🪙');
  } else showToast('✅ Aprobación tardía registrada sin coins');
  playSound('coin'); await refreshAll();
}
async function rejectTask(submissionId) {
  const { error } = await supabaseClient.from('task_submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', submissionId);
  if (error) return fail(error, 'No se pudo rechazar');
  playSound('error'); showToast('❌ Misión rechazada'); await refreshAll();
}
function renderAdminRequestsPanel() {
  const el = $('adminRequestsList'); if (!el) return;
  const active = rewardRequests.filter(r => r.status === 'pending' || r.status === 'approved');
  const done = rewardRequests.filter(r => r.status === 'delivered' || r.status === 'rejected').slice(0, 8);
  el.innerHTML = active.length || done.length ? active.map(adminRewardRequestHtml).join('') + (done.length ? `<div style="font-size:10px;color:var(--text-3);margin:10px 0 6px;font-weight:700;">— Historial reciente —</div>${done.map(adminRewardRequestHtml).join('')}` : '') : empty('🎉','No hay solicitudes');
}
function adminRewardRequestHtml(r) {
  const reward = rewards.find(x => x.id === r.reward_id) || {};
  const balance = currentBalance(r.player_id);
  let actions = '';
  if (r.status === 'pending') actions = `<button class="btn-no" onclick="rejectRequest('${r.id}')">✕</button><button class="btn-ok" ${balance >= (reward.cost || 0) ? '' : 'disabled'} onclick="approveRequest('${r.id}')">✓</button>`;
  if (r.status === 'approved') actions = `<button class="btn-give" onclick="deliverRequest('${r.id}')">🎁 Dar</button>`;
  return `<div class="appr-item"><div class="appr-avatar">${reward.icon || '🎁'}</div><div class="appr-info"><div class="appr-user">${getProfileName(r.player_id)}</div><div class="appr-detail">${escapeHtml(reward.name || 'Recompensa')} · 🪙${reward.cost || r.cost_charged || 0}</div><div class="appr-meta">${statusLabel(r.status)} · ${fmtDateTime(r.requested_at)}</div>${r.status === 'pending' && balance < (reward.cost || 0) ? '<div class="appr-meta" style="color:var(--red)">⚠️ Sin coins suficientes</div>' : ''}</div><div class="appr-actions">${actions}</div></div>`;
}
async function approveRequest(requestId) {
  const req = rewardRequests.find(r => r.id === requestId); if (!req) return;
  const reward = rewards.find(r => r.id === req.reward_id); if (!reward) return;
  if (currentBalance(req.player_id) < reward.cost) return showToast('⚠️ No tiene suficientes coins');
  const { error: updErr } = await supabaseClient.from('reward_requests').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id, cost_charged: reward.cost }).eq('id', requestId);
  if (updErr) return fail(updErr, 'No se pudo aprobar recompensa');
  const { error: ledErr } = await supabaseClient.from('coin_ledger').insert({ family_id: FAMILY_ID, player_id: req.player_id, amount: -reward.cost, movement_type: 'reward_purchase', reason: `Compra de recompensa: ${reward.name}`, source_id: requestId, created_by: currentUser.id });
  if (ledErr) return fail(ledErr, 'Aprobó, pero no descontó coins');
  playSound('buy'); showToast(`✅ Recompensa aprobada: -${reward.cost} coins`); await refreshAll();
}
async function deliverRequest(requestId) {
  const { error } = await supabaseClient.from('reward_requests').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', requestId);
  if (error) return fail(error, 'No se pudo entregar');
  playSound('buy'); showToast('🎁 Recompensa entregada'); await refreshAll();
}
async function rejectRequest(requestId) {
  const { error } = await supabaseClient.from('reward_requests').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', requestId);
  if (error) return fail(error, 'No se pudo rechazar');
  playSound('error'); showToast('❌ Solicitud rechazada'); await refreshAll();
}
function renderUserStats() {
  const el = $('userStats'); if (!el) return;
  const ids = getPlayerIdsForAdmin();
  const cards = ids.map(id => `<div class="ustat-card"><div class="ustat-avatar">${familyMembers.find(m => m.user_id === id)?.profile?.avatar || '🎮'}</div><div class="ustat-info"><div class="ustat-name">${getProfileName(id)}</div><div class="ustat-role">🎮 Jugador · ${approvedTodayCount(id)}/${dailyGoal(id)} hoy</div></div><div class="ustat-coins">🪙 ${currentBalance(id)}</div></div>`).join('');
  el.innerHTML = cards || empty('👥','No hay jugadores registrados');
}
function updateAdminBadge() { const el = $('pendingBadgeAdmin'); if (el) el.innerHTML = taskSubmissions.some(s => s.status === 'pending') ? `<span class="badge">${taskSubmissions.filter(s => s.status === 'pending').length}</span>` : ''; }
function updateAdminRequestsBadge() { const el = $('requestsBadgeAdmin'); if (el) el.innerHTML = rewardRequests.some(r => r.status === 'pending' || r.status === 'approved') ? `<span class="badge">${rewardRequests.filter(r => r.status === 'pending' || r.status === 'approved').length}</span>` : ''; }
function renderAdminMissions() {
  const el = $('adminMissionsList'); if (!el) return;
  el.innerHTML = tasks.map(t => missionAdminHtml(t)).join('') || empty('⭐','Sin misiones');
}
function missionAdminHtml(t) { return `<div class="mission-card"><div class="mission-icon-box">${t.icon || '⭐'}</div><div class="mission-info"><div class="mission-name">${escapeHtml(t.name)}</div><span class="mission-tag freq">${getProfileName(t.assigned_to)} · ${t.frequency}</span></div><div class="mission-coins-pill">🪙${t.coins}</div></div>`; }
function renderAdminQuickHistory() { const el = $('adminQuickHistory'); if (el) el.innerHTML = rewardRequests.filter(r => r.player_id === currentUser.id).map(rewardRequestHtml).join('') || empty('🛒','Aún no has solicitado nada'); }
function renderAdminHistorialTab() { const el = $('adminHistorialList'); if (el) el.innerHTML = coinLedger.slice(0, 40).map(ledgerHtml).join('') || empty('📜','No hay actividad todavía'); }
function populateAdminSelects() {
  const playerIds = getPlayerIdsForAdmin();
  const opts = playerIds.map(id => `<option value="${id}">${getProfileName(id)}</option>`).join('');
  if ($('adjUserSel')) $('adjUserSel').innerHTML = opts;
  if ($('newTaskUser')) $('newTaskUser').innerHTML = opts;
}
function renderTaskListAdmin() { const el = $('taskListAdmin'); if (el) el.innerHTML = tasks.map(t => `<div class="list-item"><span class="list-item-icon">${t.icon}</span><div class="list-item-info"><div class="list-item-name">${escapeHtml(t.name)}</div><div class="list-item-meta">${getProfileName(t.assigned_to)} · ${t.frequency} · 🪙${t.coins}</div></div></div>`).join(''); }
function renderRewardListAdmin() { const el = $('rewardListAdmin'); if (el) el.innerHTML = rewards.map(r => `<div class="list-item"><span class="list-item-icon">${r.icon}</span><div class="list-item-info"><div class="list-item-name">${escapeHtml(r.name)}</div><div class="list-item-meta">${r.type} · 🪙${r.cost} · ${r.requires_daily_goal ? 'meta diaria' : 'sin meta'}</div></div></div>`).join(''); }
function renderAdjustCatalogAdmin() {
  let holder = $('adjustCatalogList');
  const body = $('admin-tab-gestion .admin-body');
  if (!holder && $('admin-tab-gestion')) {
    const sec = document.createElement('div'); sec.className = 'admin-section'; sec.innerHTML = `<div class="admin-sec-title"><span>⚠️</span> Ajuste Makambú<span class="sec-caret">▼</span></div><div class="admin-body"><div id="adjustCatalogList" class="adjust-grid"></div></div>`; $('admin-tab-gestion').prepend(sec); holder = $('adjustCatalogList');
  }
  if (!holder) return;
  holder.innerHTML = adjustmentCatalog.map(a => `<button class="adjust-btn" onclick="applyCatalogAdjustment('${a.id}')">⚠️ ${capitalize(a.level)} · ${escapeHtml(a.label)} · ${a.coins} coins</button>`).join('');
}
async function applyCatalogAdjustment(adjustmentId) {
  const adj = adjustmentCatalog.find(a => a.id === adjustmentId); if (!adj) return;
  const playerId = $('adjUserSel')?.value || getPlayerIdsForAdmin()[0];
  if (!playerId) return showToast('⚠️ No hay jugador seleccionado');
  if (!confirm(`Aplicar ${adj.coins} coins a ${getProfileName(playerId)} por: ${adj.label}?`)) return;
  const { error } = await supabaseClient.from('coin_ledger').insert({ family_id: FAMILY_ID, player_id: playerId, amount: adj.coins, movement_type: 'makambu_adjustment', reason: `⚠️ Ajuste Makambú: ${adj.label}`, created_by: currentUser.id });
  if (error) return fail(error, 'No se pudo aplicar ajuste');
  playSound('error'); showToast(`⚠️ Ajuste Makambú ${adj.coins} coins`); await refreshAll();
}
async function adjustCoins(dir) {
  const playerId = $('adjUserSel')?.value; const amount = parseInt($('adjAmount')?.value || '0', 10);
  if (!playerId || amount <= 0) return showToast('⚠️ Selecciona jugador y cantidad');
  const signed = dir * amount;
  const reason = signed > 0 ? `🌱 Creciste como el bambú +${amount}` : `⚠️ Penalización por misión fallida -${amount}`;
  const type = signed > 0 ? 'manual_bonus' : 'mission_failed_penalty';
  const { error } = await supabaseClient.from('coin_ledger').insert({ family_id: FAMILY_ID, player_id: playerId, amount: signed, movement_type: type, reason, created_by: currentUser.id });
  if (error) return fail(error, 'No se pudo ajustar saldo');
  playSound(signed > 0 ? 'coin' : 'error'); showToast(`${signed > 0 ? '➕' : '➖'} ${amount} coins`); if ($('adjAmount')) $('adjAmount').value = ''; await refreshAll();
}
async function addTask() {
  const name = $('newTaskName')?.value.trim(); const icon = $('newTaskIcon')?.value.trim() || '⭐'; const coins = parseInt($('newTaskCoins')?.value || '5', 10); const freqRaw = $('newTaskFreq')?.value || 'Diaria'; const assigned = $('newTaskUser')?.value;
  if (!name || !assigned) return showToast('⚠️ Completa la misión');
  const { error } = await supabaseClient.from('tasks').insert({ family_id: FAMILY_ID, assigned_to: assigned, created_by: currentUser.id, name, icon, coins, frequency: freqRaw === 'Semanal' ? 'weekly' : 'daily', is_default: false, status: 'active' });
  if (error) return fail(error, 'No se pudo crear misión');
  showToast('✅ Misión agregada'); await refreshAll();
}
async function addReward() {
  const name = $('newRewardName')?.value.trim(); const icon = $('newRewardIcon')?.value.trim() || '🎁'; const cost = parseInt($('newRewardCost')?.value || '10', 10); const type = $('newRewardType')?.value || 'Premio';
  if (!name) return showToast('⚠️ Escribe recompensa');
  const { error } = await supabaseClient.from('rewards').insert({ family_id: FAMILY_ID, created_by: currentUser.id, name, icon, cost, type, requires_daily_goal: true, is_default: false, status: 'active' });
  if (error) return fail(error, 'No se pudo crear recompensa');
  showToast('🏆 Recompensa agregada'); await refreshAll();
}
function resetDailyTasks() { showToast('ℹ️ El reset diario ahora se calcula por fecha Bogotá. No borra historial.'); }
function exportData() { const blob = new Blob([JSON.stringify({ profiles: currentProfile, familyMembers, tasks, rewards, taskSubmissions, rewardRequests, coinLedger, playerSettings, adjustmentCatalog }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `makambu_export_${todayBogotaISO()}.json`; a.click(); }
function openAdminWarpZone() { openWarpZone(); }
function closeAdminWarpZone() { $('adminWarpZoneModal')?.classList.remove('open'); }
function switchAdminTab(tab) { /* compatibilidad con HTML actual */ }
function deleteTask() { showToast('Desactivar misiones se agregará en la siguiente fase'); }
function deleteReward() { showToast('Desactivar recompensas se agregará en la siguiente fase'); }
function renderAdminMissionsPreview() {}
function submitAdultTask() {}
function undoAdultTask() {}

// ================================================================
// RENDER HELPERS
// ================================================================
function rewardRequestHtml(r) { const reward = rewards.find(x => x.id === r.reward_id) || {}; return `<div class="hist-item"><div class="hist-dot ${r.status}">${reward.icon || '🎁'}</div><div class="hist-info"><div class="hist-name">${escapeHtml(reward.name || 'Recompensa')}</div><div class="hist-sub">🪙${reward.cost || r.cost_charged || 0} · ${fmtDateTime(r.requested_at)}</div></div><span class="hist-badge ${r.status}">${statusLabel(r.status)}</span></div>`; }
function ledgerHtml(c) { const cls = c.amount >= 0 ? 'approved' : 'rejected'; return `<div class="hist-item"><div class="hist-dot ${cls}">${c.amount >= 0 ? '🪙' : '⚠️'}</div><div class="hist-info"><div class="hist-name">${escapeHtml(c.reason || c.movement_type)}</div><div class="hist-sub">${fmtDateTime(c.created_at)}</div></div><span class="hist-badge ${cls}">${c.amount > 0 ? '+' : ''}${c.amount}</span></div>`; }
function statusLabel(status) { return ({ pending:'⏳ Pendiente', approved:'✅ Aprobado', delivered:'🎁 Entregado', rejected:'❌ Rechazado', late_approved:'🕒 Aprobado tarde' })[status] || status; }
function empty(icon, msg) { return `<div class="empty-box"><span class="e-icon">${icon}</span><p>${msg}</p></div>`; }
function escapeHtml(str = '') { return String(str).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function capitalize(s='') { return s.charAt(0).toUpperCase() + s.slice(1); }
function fail(error, msg) { console.error(error); playSound('error'); showToast(`⚠️ ${msg}`); }
function initAdminCollapsible() {
  document.querySelectorAll('#adminScreen .admin-section').forEach(sec => {
    if (sec.dataset.collapsible) return;
    sec.dataset.collapsible = '1';
    const title = sec.querySelector('.admin-sec-title');
    if (!title) return;
    title.addEventListener('click', e => { if (!e.target.closest('button')) sec.classList.toggle('collapsed'); });
  });
}
function showLoading(msg) { const el = $('loadingOverlay'); if (!el) return; if ($('loadingMsg')) $('loadingMsg').textContent = msg || 'Cargando...'; el.classList.add('visible'); }
function hideLoading() { $('loadingOverlay')?.classList.remove('visible'); }
function showToast(msg) { const el = $('toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); }
function spawnParticles(emoji = '🪙', x, y) { const cx = x || window.innerWidth / 2; const cy = y || window.innerHeight / 3; for (let i=0;i<8;i++){ const p=document.createElement('div'); p.className='particle'; p.textContent=emoji; const a=(i/8)*Math.PI*2; const d=60+Math.random()*60; p.style.cssText=`left:${cx}px;top:${cy}px;--tx:${Math.cos(a)*d}px;--ty:${Math.sin(a)*d}px;animation-duration:${0.6+Math.random()*0.4}s;`; document.body.appendChild(p); setTimeout(()=>p.remove(),1200);} }
function spawnConfetti() { spawnParticles('🎉'); }

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data } = await supabaseClient.auth.getSession();
  session = data.session;
  if (session?.user) await bootstrapApp();
  else showScreen('loginScreen');
});
