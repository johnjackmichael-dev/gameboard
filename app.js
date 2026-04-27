// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
// All data goes through /api/data — a Vercel serverless function
// that reads/writes to Upstash KV. No keys needed in the browser.
const API_URL = '/api/data';

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const state = {
  view: 'auth',        // 'auth' | 'app'
  authMode: 'signin',  // 'signin' | 'signup' | 'shortcut'
  user: null,          // { id, name, email, token, avatar }
  tab: 'dashboard',    // 'dashboard' | 'leaderboard' | 'records' | 'account'
  game: 'all',
  scores: [],
  players: [],
  modal: null,         // null | 'shortcut' | 'logScore' | 'editProfile'
};

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  // Restore session
  const saved = localStorage.getItem('gb_user');
  if (saved) {
    try {
      state.user = JSON.parse(saved);
      state.user.avatar = localStorage.getItem(`av_${state.user.id}`) || state.user.avatar || null;
      state.view = 'app';
    } catch {}
  }

  await loadData();
  render();

  setInterval(async () => {
    if (state.view === 'app') { await loadData(); render(); }
  }, 60000);
});

// ═══════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════
async function loadData() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('Load failed');
    const { players, scores } = await res.json();
    state.players = (players || []).map(p => ({
      ...p, avatar: localStorage.getItem(`av_${p.id}`) || p.avatar_url || null
    }));
    state.scores = scores || [];
    state.scores.sort((a, b) => b.played_on.localeCompare(a.played_on));
  } catch (e) {
    console.error('Load error:', e);
    // Fallback: keep whatever we had
  }
}

async function createPlayer({ name, email }) {
  // 15 second timeout so we don't spin forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createPlayer', name, email }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    let data;
    try { data = await res.json(); }
    catch { throw new Error(`Server returned non-JSON response (status ${res.status})`); }

    if (!res.ok) {
      throw new Error(data.error || `Server error (${res.status})`);
    }
    return data.player;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection and try again.');
    }
    throw err;
  }
}

async function postScore(playerId, game, score, date) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'postScore',
        playerId, game, score: parseInt(score), played_on: date
      })
    });
    if (!res.ok) return false;
    // Reload scores to reflect the new entry
    await loadData();
    return true;
  } catch (e) {
    console.error('postScore error:', e);
    return false;
  }
}

async function updatePlayer({ id, name, avatar_url }) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updatePlayer', id, name, avatar_url })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.player;
  } catch (e) {
    console.error('updatePlayer error:', e);
    return null;
  }
}

async function deletePlayer(id) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deletePlayer', id })
    });
    return res.ok;
  } catch (e) {
    console.error('deletePlayer error:', e);
    return false;
  }
}

async function deleteScoreEntry(scoreId) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteScore', id: scoreId })
    });
    return res.ok;
  } catch (e) {
    console.error('deleteScore error:', e);
    return false;
  }
}

// Compress image to a square ~256x256 JPEG so it's small enough to store in the DB
function compressImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Cover-crop the image into a square
    const ratio = Math.max(size / img.width, size / img.height);
    const newW = img.width * ratio;
    const newH = img.height * ratio;
    const offsetX = (size - newW) / 2;
    const offsetY = (size - newH) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, offsetX, offsetY, newW, newH);
    callback(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => callback(dataUrl); // Fall back to original
  img.src = dataUrl;
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
const todayStr = () => new Date().toISOString().split('T')[0];

function fmtScore(val, game) {
  if (val === null || val === undefined) return '—';
  if (game === 'maptap') return Math.round(val).toLocaleString();
  const m = Math.floor(val / 60), s = val % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function fmtDate(str) {
  if (!str) return '—';
  if (str === todayStr()) return 'Today';
  const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (str === yest) return 'Yesterday';
  const d = new Date(str + 'T12:00:00');
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month:'short', day:'numeric' } : { month:'short', day:'numeric', year:'numeric' });
}

function relDate(str) {
  if (!str) return '';
  if (str === todayStr()) return 'today';
  const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (str === yest) return 'yesterday';
  const d = new Date(str + 'T12:00:00');
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function getPlayer(id) { return state.players.find(p => p.id === id); }

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Copy text to clipboard with visual feedback on the button
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers / non-HTTPS
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
  if (btn) {
    const original = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  }
}

function avatarHTML(p, size = 36, cls = '') {
  if (!p) return `<div class="${cls||'rank-av'}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px">?</div>`;
  if (p.avatar) {
    return `<div class="${cls||'rank-av'}" style="width:${size}px;height:${size}px"><img src="${p.avatar}" alt=""/></div>`;
  }
  return `<div class="${cls||'rank-av'}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px">${escapeHtml(p.name[0]).toUpperCase()}</div>`;
}

// ═══════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════
function filteredScores() {
  return state.game === 'all' ? state.scores : state.scores.filter(s => s.game === state.game);
}

function playerStats(pid) {
  const ps = filteredScores().filter(s => s.player_id === pid);
  if (!ps.length) return null;
  const isMini = state.game !== 'maptap';
  const vals = ps.map(s => s.score);
  let wins = 0, losses = 0, ties = 0;
  const myDates = [...new Set(ps.map(s => s.played_on))];
  myDates.forEach(date => {
    const mine = ps.find(s => s.played_on === date);
    const others = filteredScores().filter(s => s.player_id !== pid && s.played_on === date);
    if (!mine || !others.length) return;
    others.forEach(o => {
      if (mine.score === o.score) ties++;
      else if (isMini ? mine.score < o.score : mine.score > o.score) wins++;
      else losses++;
    });
  });
  const total = wins + losses + ties;
  return {
    count: ps.length,
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    best: isMini ? Math.min(...vals) : Math.max(...vals),
    worst: isMini ? Math.max(...vals) : Math.min(...vals),
    wins, losses, ties,
    winPct: total ? Math.round(wins / total * 100) : 0
  };
}

function streak(pid) {
  const isMini = state.game !== 'maptap';
  const dates = [...new Set(filteredScores().map(s => s.played_on))].sort((a, b) => b.localeCompare(a));
  let n = 0;
  for (const date of dates) {
    const mine = filteredScores().find(s => s.player_id === pid && s.played_on === date);
    const others = filteredScores().filter(s => s.player_id !== pid && s.played_on === date);
    if (!mine || !others.length) { if (n > 0) break; continue; }
    const won = others.every(o => isMini ? mine.score < o.score : mine.score > o.score);
    if (won) n++; else if (n > 0) break;
  }
  return n;
}

function ranked() {
  return state.players
    .map(p => ({ player: p, stats: playerStats(p.id), streak: streak(p.id) }))
    .filter(r => r.stats)
    .sort((a, b) => b.stats.winPct - a.stats.winPct || b.stats.wins - a.stats.wins);
}

// Find best/worst across all scores in a game
function findExtreme(game, type) {
  const fs = state.scores.filter(s => s.game === game);
  if (!fs.length) return null;
  const isMini = game !== 'maptap';
  const compare = type === 'best'
    ? (isMini ? (a, b) => a.score < b.score : (a, b) => a.score > b.score)
    : (isMini ? (a, b) => a.score > b.score : (a, b) => a.score < b.score);
  let extreme = fs[0];
  fs.forEach(s => { if (compare(s, extreme)) extreme = s; });
  return { ...extreme, player: getPlayer(extreme.player_id) };
}

function activeStreakLeader() {
  let best = { streak: 0, player: null };
  state.players.forEach(p => {
    const s = streak(p.id);
    if (s > best.streak) best = { streak: s, player: p };
  });
  return best;
}

function streakStartDate(pid) {
  const isMini = state.game !== 'maptap';
  const dates = [...new Set(filteredScores().map(s => s.played_on))].sort((a, b) => b.localeCompare(a));
  let lastWinDate = null;
  for (const date of dates) {
    const mine = filteredScores().find(s => s.player_id === pid && s.played_on === date);
    const others = filteredScores().filter(s => s.player_id !== pid && s.played_on === date);
    if (!mine || !others.length) continue;
    const won = others.every(o => isMini ? mine.score < o.score : mine.score > o.score);
    if (won) lastWinDate = date;
    else break;
  }
  return lastWinDate;
}

// ═══════════════════════════════════════════════
// RENDER ROUTER
// ═══════════════════════════════════════════════
function render() {
  const root = document.getElementById('app');
  if (state.view === 'auth') {
    root.innerHTML = renderAuth();
    bindAuth();
  } else {
    root.innerHTML = renderApp();
    bindApp();
  }
}

// ═══════════════════════════════════════════════
// AUTH SCREENS
// ═══════════════════════════════════════════════
function renderAuth() {
  if (state.authMode === 'shortcut') return renderShortcutScreen();
  if (state.authMode === 'signup') return renderSignUp();
  return renderSignIn();
}

function renderSignIn() {
  return `<div class="auth-shell"><div class="auth-card">
    <div class="auth-mark">
      <div class="auth-mark-dot">B</div>
      <div class="auth-mark-text">The Daily Board</div>
    </div>
    <div class="auth-title">Welcome <em>back</em>.</div>
    <div class="auth-sub">Sign in with your email to see today's scores.</div>
    <div class="field"><label>Email</label><input id="signin-email" class="inp" type="email" placeholder="you@example.com"/></div>
    <button class="btn-primary" id="signin-btn">Sign in</button>
    <div class="auth-msg" id="auth-msg"></div>
    <div class="auth-foot">New here? <button id="show-signup">Create an account</button></div>
  </div></div>`;
}

function renderSignUp() {
  return `<div class="auth-shell"><div class="auth-card">
    <div class="auth-mark">
      <div class="auth-mark-dot">B</div>
      <div class="auth-mark-text">The Daily Board</div>
    </div>
    <div class="auth-title">Join the <em>board</em>.</div>
    <div class="auth-sub">Create an account to start tracking your scores. Takes 30 seconds.</div>

    <div class="photo-upload">
      <div class="photo-preview" id="photo-preview"><span id="photo-initial">?</span></div>
      <div class="photo-info">
        <div class="photo-label-line">Profile photo</div>
        <div class="photo-sub">Optional — initials work too</div>
      </div>
      <label class="photo-btn">
        Upload
        <input type="file" accept="image/*" id="signup-photo" style="display:none"/>
      </label>
    </div>

    <div class="field"><label>Name</label><input id="signup-name" class="inp" placeholder="Your name"/></div>
    <div class="field"><label>Email</label><input id="signup-email" class="inp" type="email" placeholder="you@example.com"/></div>
    <button class="btn-primary" id="signup-btn">Create account</button>
    <div class="auth-msg" id="auth-msg"></div>
    <div class="auth-foot">Already have an account? <button id="show-signin">Sign in</button></div>
  </div></div>`;
}

function renderShortcutScreen() {
  const u = state.user;
  return `<div class="auth-shell" style="align-items:flex-start;padding-top:60px">
    <div class="auth-card" style="max-width:520px">
      <div class="auth-mark">
        <div class="auth-mark-dot">B</div>
        <div class="auth-mark-text">The Daily Board</div>
      </div>
      <div class="auth-title">You're <em>in</em>, ${escapeHtml(u.name)}.</div>
      <div class="auth-sub">One quick setup step: save this email as a contact called <strong>Daily Board</strong>. From any game, share to that contact and your score logs automatically — no typing.</div>

      <div class="shortcut-step">
        <div class="shortcut-eyebrow">Save this contact</div>
        <div style="font-family:var(--mono);font-size:18px;color:#fff;font-weight:600;margin:8px 0 14px;word-break:break-all">scores@commonphoebedub.com</div>
        <a class="shortcut-button" href="#" onclick="copyText('scores@commonphoebedub.com', this);return false;">Copy address</a>
        <div class="shortcut-meta">
          <span class="shortcut-meta-item">📇 Save once</span>
          <span class="shortcut-meta-item">📤 Share any game</span>
          <span class="shortcut-meta-item">⚡ Score logs in seconds</span>
        </div>
      </div>

      <div class="step-list">
        <div class="step-list-title">How it works</div>
        <div class="step"><div class="step-num">1</div><div class="step-text">Save <strong>scores@commonphoebedub.com</strong> as a contact called "Daily Board"</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Finish the <strong>NYT Mini</strong> (or Maptap) as usual</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Tap <strong>Share → Mail → Daily Board → Send</strong></div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text">Score appears on your dashboard within a minute</div></div>
      </div>

      <div style="font-size:12.5px;color:var(--ink-3);line-height:1.55;margin-bottom:18px;padding:10px 14px;background:var(--bg);border-radius:8px">
        💡 Make sure to send from <strong style="color:var(--ink)">${escapeHtml(u.email)}</strong> — that's the email we use to identify you.
      </div>

      <button class="btn-primary" id="goto-app">Continue to the board →</button>
    </div>
  </div>`;
}

function bindAuth() {
  const $ = id => document.getElementById(id);

  if (state.authMode === 'signin') {
    $('signin-btn').onclick = handleSignIn;
    $('signin-email').onkeydown = e => e.key === 'Enter' && handleSignIn();
    $('show-signup').onclick = () => {
      window._pendingPhoto = null;
      state.authMode = 'signup';
      render();
    };
  }
  if (state.authMode === 'signup') {
    $('signup-btn').onclick = handleSignUp;
    $('signup-email').onkeydown = e => e.key === 'Enter' && handleSignUp();
    $('show-signin').onclick = () => { state.authMode = 'signin'; render(); };
    const nameInp = $('signup-name');
    nameInp.oninput = () => {
      const initial = nameInp.value.trim()[0];
      $('photo-initial').textContent = initial ? initial.toUpperCase() : '?';
    };
    $('signup-photo').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Validate file is an image
      if (!file.type.startsWith('image/')) {
        alert('Please choose an image file.');
        return;
      }
      // Limit file size (rough check, will compress below)
      if (file.size > 8 * 1024 * 1024) {
        alert('Photo too large — please pick something under 8MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        // Compress the image so it's not huge in the database
        compressImage(ev.target.result, (compressed) => {
          const preview = document.getElementById('photo-preview');
          preview.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
          window._pendingPhoto = compressed;
        });
      };
      reader.readAsDataURL(file);
    };
  }
  if (state.authMode === 'shortcut') {
    $('goto-app').onclick = () => { state.view = 'app'; render(); };
  }
}

async function handleSignIn() {
  const email = document.getElementById('signin-email').value.trim().toLowerCase();
  const msg = document.getElementById('auth-msg');
  if (!email) { msg.className = 'auth-msg error'; msg.textContent = 'Please enter your email.'; return; }
  await loadData();
  const found = state.players.find(p => (p.email || '').toLowerCase() === email);
  if (!found) {
    msg.className = 'auth-msg error';
    msg.textContent = "We couldn't find that email. Try creating an account.";
    return;
  }
  state.user = { ...found, avatar: localStorage.getItem(`av_${found.id}`) || found.avatar || null };
  localStorage.setItem('gb_user', JSON.stringify(state.user));
  state.view = 'app';
  render();
}

async function handleSignUp() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const msg = document.getElementById('auth-msg');
  if (!name || !email) { msg.className = 'auth-msg error'; msg.textContent = 'Name and email are required.'; return; }
  if (!email.includes('@')) { msg.className = 'auth-msg error'; msg.textContent = 'Please enter a valid email.'; return; }
  await loadData();
  if (state.players.find(p => (p.email || '').toLowerCase() === email)) {
    msg.className = 'auth-msg error'; msg.textContent = 'That email is already registered.'; return;
  }
  msg.className = 'auth-msg'; msg.textContent = 'Creating your account...'; msg.style.color = 'var(--ink-3)';
  let player;
  try {
    player = await createPlayer({ name, email });
  } catch (err) {
    msg.className = 'auth-msg error';
    msg.textContent = err.message || 'Something went wrong. Try again.';
    return;
  }
  if (!player) { msg.className = 'auth-msg error'; msg.textContent = 'Something went wrong. Try again.'; return; }
  if (window._pendingPhoto) {
    localStorage.setItem(`av_${player.id}`, window._pendingPhoto);
    player.avatar = window._pendingPhoto;
    // Also save to the database so it shows up on other devices
    try {
      await updatePlayer({ id: player.id, avatar_url: window._pendingPhoto });
    } catch (e) { console.error('Failed to save avatar to DB:', e); }
    window._pendingPhoto = null;
  }
  state.user = player;
  localStorage.setItem('gb_user', JSON.stringify(state.user));
  state.authMode = 'shortcut';
  render();
}

function installShortcut(e) {
  e.preventDefault();
  state.modal = 'shortcutGuide';
  render();
}

// ═══════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════
function renderApp() {
  const tabs = [
    ['dashboard', 'Dashboard'],
    ['leaderboard', 'Leaderboard'],
    ['records', 'Records'],
    ['account', 'Account']
  ];
  const games = [
    ['all', 'All Games'],
    ['mini', 'NYT Mini'],
    ['maptap', 'Maptap']
  ];

  const showGamePills = state.tab === 'dashboard' || state.tab === 'leaderboard' || state.tab === 'records';

  return `<div class="app-shell">
    <header class="hdr">
      <div class="hdr-inner">
        <div class="hdr-brand">
          <div class="hdr-mark">B</div>
          <div class="hdr-title">The <em>Daily</em> Board</div>
        </div>
        <div class="hdr-acct" id="hdr-acct">
          ${avatarHTML(state.user, 28, 'hdr-avatar')}
          <span class="hdr-name">${escapeHtml(state.user.name)}</span>
        </div>
      </div>
    </header>

    <div class="tabs"><div class="tabs-inner">
      ${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}
    </div></div>

    ${showGamePills ? `<div class="game-pills"><div class="game-pills-inner">
      ${games.map(([id, label]) => `<button class="pill ${state.game === id ? 'on' : ''}" data-game="${id}">${label}</button>`).join('')}
    </div></div>` : ''}

    <main>
      ${renderTabContent()}
    </main>

    <footer><div class="foot-inner">
      <span>The Daily Board</span>
      <span>${state.scores.length} scores logged</span>
    </div></footer>

    ${state.modal ? renderModal() : ''}
  </div>`;
}

function renderTabContent() {
  switch (state.tab) {
    case 'dashboard': return renderDashboard();
    case 'leaderboard': return renderLeaderboard();
    case 'records': return renderRecords();
    case 'account': return renderAccount();
    default: return '';
  }
}

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════
function renderDashboard() {
  const r = ranked();
  if (!r.length) return renderEmptyDashboard();

  const leader = r[0];
  const sLead = activeStreakLeader();
  const fs = filteredScores();

  // Stats
  const isMini = state.game !== 'maptap';
  const overallBest = state.game === 'all'
    ? findExtreme('mini', 'best')
    : findExtreme(state.game, 'best');
  const overallWorst = state.game === 'all'
    ? findExtreme('mini', 'worst')
    : findExtreme(state.game, 'worst');
  const altBest = state.game === 'all' ? findExtreme('maptap', 'best') : null;
  const totalDays = [...new Set(fs.map(s => s.played_on))].length;
  const activePlayers = state.players.filter(p => fs.some(s => s.player_id === p.id)).length;

  // Last 7 day wins
  const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const recentWins = state.players.map(p => {
    let wins = 0;
    const recent = fs.filter(s => s.played_on >= sevenAgo);
    const dates = [...new Set(recent.map(s => s.played_on))];
    dates.forEach(d => {
      const mine = recent.find(s => s.player_id === p.id && s.played_on === d);
      const others = recent.filter(s => s.player_id !== p.id && s.played_on === d);
      if (!mine || !others.length) return;
      const won = others.every(o => isMini ? mine.score < o.score : mine.score > o.score);
      if (won) wins++;
    });
    return { player: p, wins };
  }).sort((a, b) => b.wins - a.wins);
  const maxWins = Math.max(...recentWins.map(r => r.wins), 1);

  // Stat cards depending on game
  let statCards = '';
  if (state.game === 'mini') {
    statCards = `
      ${statCard('Best Mini Time', overallBest ? fmtScore(overallBest.score, 'mini') : '—', overallBest?.player?.name, overallBest ? fmtDate(overallBest.played_on) : '', 'blue')}
      ${statCard('Worst Mini Time', overallWorst ? fmtScore(overallWorst.score, 'mini') : '—', overallWorst?.player?.name, overallWorst ? fmtDate(overallWorst.played_on) : '', 'red')}
      ${statCard('Days Played', totalDays, `${activePlayers} active`, 'all-time', '')}
      ${statCard('Total Scores', fs.length, 'across players', '', '')}
    `;
  } else if (state.game === 'maptap') {
    statCards = `
      ${statCard('Best Maptap', overallBest ? fmtScore(overallBest.score, 'maptap') : '—', overallBest?.player?.name, overallBest ? fmtDate(overallBest.played_on) : '', 'gold')}
      ${statCard('Worst Maptap', overallWorst ? fmtScore(overallWorst.score, 'maptap') : '—', overallWorst?.player?.name, overallWorst ? fmtDate(overallWorst.played_on) : '', 'red')}
      ${statCard('Days Played', totalDays, `${activePlayers} active`, 'all-time', '')}
      ${statCard('Total Scores', fs.length, 'across players', '', '')}
    `;
  } else {
    const bestMini = findExtreme('mini', 'best');
    const bestMap = findExtreme('maptap', 'best');
    statCards = `
      ${statCard('Best Mini Time', bestMini ? fmtScore(bestMini.score, 'mini') : '—', bestMini?.player?.name, bestMini ? fmtDate(bestMini.played_on) : '', 'blue')}
      ${statCard('Best Maptap', bestMap ? fmtScore(bestMap.score, 'maptap') : '—', bestMap?.player?.name, bestMap ? fmtDate(bestMap.played_on) : '', 'gold')}
      ${statCard('Days Played', totalDays, `${activePlayers} active`, 'all-time', '')}
      ${statCard('Total Scores', fs.length, 'across players', '', '')}
    `;
  }

  return `
    <div class="hero-row">
      <div class="leader-card">
        <div class="leader-eyebrow">Currently leading</div>
        <div class="leader-row">
          ${avatarHTML(leader.player, 62, 'leader-av')}
          <div>
            <div class="leader-name">${escapeHtml(leader.player.name)}</div>
            <div class="leader-stat">${leader.stats.winPct}% win rate · ${leader.stats.wins}W–${leader.stats.losses}L</div>
          </div>
        </div>
      </div>
      ${sLead.streak >= 2 ? `
        <div class="streak-card">
          <div class="streak-circle"><span class="streak-num">${sLead.streak}</span></div>
          <div class="streak-info">
            <div class="streak-eyebrow">Hot streak</div>
            <div class="streak-detail">${escapeHtml(sLead.player.name)} — ${sLead.streak} in a row</div>
            <div class="streak-since">since ${fmtDate(streakStartDate(sLead.player.id))}</div>
          </div>
        </div>
      ` : `
        <div class="streak-card">
          <div class="streak-circle" style="background:var(--bg)"><span class="streak-num" style="color:var(--ink-4)">—</span></div>
          <div class="streak-info">
            <div class="streak-eyebrow">No active streak</div>
            <div class="streak-detail">Anyone's game</div>
            <div class="streak-since">2+ wins in a row to start one</div>
          </div>
        </div>
      `}
    </div>

    <div class="stats-grid">${statCards}</div>

    <div class="section-head">
      <div class="section-title">Top of the table</div>
      <button class="section-link" data-tab-link="leaderboard">View full leaderboard →</button>
    </div>

    <div class="ranks">
      ${r.slice(0, 3).map((row, i) => renderRankRow(row, i, true)).join('')}
    </div>

    <div class="trend">
      <div class="trend-head">
        <div class="trend-title">Last 7 days</div>
        <div class="trend-sub">wins per player</div>
      </div>
      ${recentWins.map((rw, i) => `
        <div class="bar-row">
          <div class="bar-name">${escapeHtml(rw.player.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${rw.wins / maxWins * 100}%;background:${i === 0 ? 'var(--royal)' : i === 1 ? 'var(--ink-2)' : 'var(--ink-4)'}"></div></div>
          <div class="bar-val">${rw.wins} ${rw.wins === 1 ? 'win' : 'wins'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function statCard(label, num, who, when, colorCls) {
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-num ${colorCls}">${num}</div>
    <div class="stat-meta">
      <span class="stat-who">${who || ''}</span>
      <span class="stat-when">${when || ''}</span>
    </div>
  </div>`;
}

function renderRankRow(row, i, preview = false) {
  const { player: p, stats: s, streak: str } = row;
  const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
  const rowCls = i === 0 ? 'rank-row first' : 'rank-row';
  return `<div class="${rowCls}">
    <div class="rank-num ${rankCls}">${i + 1}</div>
    <div class="rank-player">
      ${avatarHTML(p, 36, 'rank-av')}
      <div class="rank-info">
        <div class="rank-name">${escapeHtml(p.name)}${str >= 2 ? `<span class="streak-tag">${str} streak</span>` : ''}</div>
        <div class="rank-meta">avg ${fmtScore(s.avg, state.game === 'all' ? 'mini' : state.game)} · best ${fmtScore(s.best, state.game === 'all' ? 'mini' : state.game)}</div>
      </div>
    </div>
    <div class="rank-pct">${s.winPct}<span class="pct-sym">%</span></div>
    <div class="rank-record">${s.wins}–${s.losses}</div>
  </div>`;
}

function renderEmptyDashboard() {
  return `<div class="empty">
    <div class="empty-text">No scores logged yet.</div>
    <div class="empty-sub">Play a round of NYT Mini or Maptap and log your first score to see the dashboard come to life.</div>
  </div>`;
}

// ═══════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════
function renderLeaderboard() {
  const r = ranked();
  if (!r.length) return renderEmptyDashboard();

  const isMini = state.game !== 'maptap';
  const fmtFor = (v) => fmtScore(v, state.game === 'all' ? 'mini' : state.game);

  return `
    <div class="section-head" style="margin-top:0">
      <div class="section-title">Full standings — ${state.game === 'all' ? 'all games' : state.game === 'mini' ? 'NYT Mini' : 'Maptap'}</div>
      <span class="section-title" style="color:var(--ink-4)">Sorted by win rate</span>
    </div>

    <div class="lb-table-wrap">
      <div class="lb-head-row">
        <span style="text-align:center">#</span>
        <span>Player</span>
        <span class="right">Win %</span>
        <span class="right">W–L–T</span>
        <span class="right">Avg</span>
        <span class="right">Best</span>
      </div>
      ${r.map((row, i) => {
        const { player: p, stats: s, streak: str } = row;
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const rowCls = i === 0 ? 'lb-row-full first' : 'lb-row-full';
        return `<div class="${rowCls}">
          <div class="rank-num ${rankCls}">${i + 1}</div>
          <div class="rank-player">
            ${avatarHTML(p, 36, 'rank-av')}
            <div class="rank-info">
              <div class="rank-name">${escapeHtml(p.name)}${str >= 2 ? `<span class="streak-tag">${str} streak</span>` : ''}</div>
              <div class="rank-meta">${s.count} scores</div>
            </div>
          </div>
          <div class="rank-stat primary">${s.winPct}%</div>
          <div class="rank-stat">${s.wins}–${s.losses}–${s.ties}</div>
          <div class="rank-stat muted">${fmtFor(s.avg)}</div>
          <div class="rank-stat" style="color:var(--gold-deep);font-weight:600">${fmtFor(s.best)}</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════════════
// RECORDS
// ═══════════════════════════════════════════════
function renderRecords() {
  const fs = filteredScores();
  if (!fs.length) return renderEmptyDashboard();
  const isMini = state.game !== 'maptap';

  const records = [];

  if (state.game === 'all') {
    const bestMini = findExtreme('mini', 'best');
    const worstMini = findExtreme('mini', 'worst');
    const bestMap = findExtreme('maptap', 'best');
    const worstMap = findExtreme('maptap', 'worst');
    if (bestMini) records.push({ label: 'Fastest Mini Solve', value: fmtScore(bestMini.score, 'mini'), who: bestMini.player?.name, when: fmtDate(bestMini.played_on), color: 'blue' });
    if (worstMini) records.push({ label: 'Slowest Mini Solve', value: fmtScore(worstMini.score, 'mini'), who: worstMini.player?.name, when: fmtDate(worstMini.played_on), color: 'red' });
    if (bestMap) records.push({ label: 'Highest Maptap', value: fmtScore(bestMap.score, 'maptap'), who: bestMap.player?.name, when: fmtDate(bestMap.played_on), color: 'gold' });
    if (worstMap) records.push({ label: 'Lowest Maptap', value: fmtScore(worstMap.score, 'maptap'), who: worstMap.player?.name, when: fmtDate(worstMap.played_on), color: '' });
  } else {
    const game = state.game;
    const best = findExtreme(game, 'best');
    const worst = findExtreme(game, 'worst');
    if (best) records.push({ label: isMini ? 'Fastest Solve' : 'Highest Score', value: fmtScore(best.score, game), who: best.player?.name, when: fmtDate(best.played_on), color: 'blue' });
    if (worst) records.push({ label: isMini ? 'Slowest Solve' : 'Lowest Score', value: fmtScore(worst.score, game), who: worst.player?.name, when: fmtDate(worst.played_on), color: 'red' });
  }

  // Per-player bests
  state.players.forEach(p => {
    const ps = fs.filter(s => s.player_id === p.id);
    if (!ps.length) return;
    const bestS = ps.reduce((a, b) => (isMini ? a.score < b.score : a.score > b.score) ? a : b);
    records.push({
      label: `${p.name}'s personal best`,
      value: fmtScore(bestS.score, state.game === 'all' ? 'mini' : state.game),
      who: 'set',
      when: fmtDate(bestS.played_on),
      color: ''
    });
  });

  // Streaks
  state.players.forEach(p => {
    const str = streak(p.id);
    if (str >= 2) records.push({
      label: `${p.name}'s active streak`,
      value: `${str}`,
      who: 'wins in a row',
      when: `since ${fmtDate(streakStartDate(p.id))}`,
      color: 'gold'
    });
  });

  return `
    <div class="section-head" style="margin-top:0">
      <div class="section-title">Hall of records</div>
      <span class="section-title" style="color:var(--ink-4)">${state.game === 'all' ? 'All games' : state.game === 'mini' ? 'NYT Mini' : 'Maptap'}</span>
    </div>
    <div class="records-grid">
      ${records.map(r => `
        <div class="record-card">
          <div class="record-eyebrow">${r.label}</div>
          <div class="record-big ${r.color}">${r.value}</div>
          <div class="record-meta">
            <span class="record-who">${r.who || ''}</span>
            <span class="record-when">${r.when || ''}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════════════
// ACCOUNT
// ═══════════════════════════════════════════════
function renderAccount() {
  const u = state.user;
  return `
    <div class="settings-card">
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:20px">
        ${avatarHTML(u, 64, 'rank-av')}
        <div>
          <div style="font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:-0.02em">${escapeHtml(u.name)}</div>
          <div style="font-size:13px;color:var(--ink-3);margin-top:2px">${escapeHtml(u.email)}</div>
        </div>
        <button class="btn-secondary" id="edit-profile" style="margin-left:auto">Edit profile</button>
      </div>

      <div class="settings-row">
        <span class="settings-label">Player token</span>
        <span class="settings-value">${u.token.slice(0, 12)}…</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Member since</span>
        <span class="settings-value" style="font-family:var(--sans)">today</span>
      </div>
    </div>

    <div class="settings-card">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">Share scores by email</div>
      <div style="font-size:13px;color:var(--ink-3);line-height:1.55;margin-bottom:14px">
        Save the address below as a contact called <strong>"Daily Board"</strong> on your phone.
        Then from any game (NYT Mini, Maptap), tap <strong>Share → Mail → Daily Board → Send</strong>.
        Your score lands here in seconds. <strong>Make sure to send from <span style="color:var(--royal)">${escapeHtml(state.user.email)}</span></strong> — that's the email tied to your account.
      </div>

      <div style="background:var(--gold-bg);border:1px solid rgba(212,169,69,0.3);border-radius:10px;padding:14px 16px;margin-bottom:14px">
        <div style="font-family:var(--mono);font-size:11px;color:var(--gold-deep);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px">Send scores to</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-family:var(--mono);font-size:14px;color:var(--ink);font-weight:600">scores@commonphoebedub.com</span>
          <button class="copy-btn-sm" onclick="copyText('scores@commonphoebedub.com', this)">copy</button>
        </div>
      </div>

      <details style="font-size:12.5px;color:var(--ink-3);line-height:1.55">
        <summary style="cursor:pointer;font-weight:500;color:var(--ink-2);padding:4px 0">How to save it as a contact (1 minute, one time)</summary>
        <div style="padding:8px 0 0 4px">
          1. Open the <strong>Contacts</strong> app on your phone<br/>
          2. Tap <strong>+</strong> to add a new contact<br/>
          3. Name: <strong>Daily Board</strong><br/>
          4. Email: <strong>scores@commonphoebedub.com</strong><br/>
          5. Save<br/><br/>
          From now on, any game's share button → <strong>Mail</strong> → start typing "Daily" → tap the contact → tap Send. Done.
        </div>
      </details>
    </div>

    <div class="settings-card">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">Log manually</div>
      <div style="font-size:13px;color:var(--ink-3);line-height:1.5;margin-bottom:14px">For backfilling old scores or if the email path isn't working.</div>
      <button class="btn-secondary" id="log-score">Log a score</button>
    </div>

    <div class="settings-card">
      <button class="btn-ghost" id="logout" style="color:var(--ink-3)">Sign out</button>
      <button class="btn-ghost" id="delete-account" style="color:var(--loss);margin-left:8px">Delete account</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════
function renderModal() {
  if (state.modal === 'logScore') return renderLogScoreModal();
  if (state.modal === 'shortcut') return renderShortcutModal();
  if (state.modal === 'shortcutGuide') return renderShortcutGuideModal();
  if (state.modal === 'editProfile') return renderEditProfileModal();
  if (state.modal === 'deleteAccount') return renderDeleteAccountModal();
  return '';
}

function renderLogScoreModal() {
  return `<div class="modal-back" id="modal-back">
    <div class="modal">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title">Log a <em style="font-style:italic;color:var(--royal)">score</em>.</div>
      <div class="modal-sub">Pick a game and enter your score for ${fmtDate(todayStr())}.</div>

      <div class="field"><label>Game</label>
        <select id="ls-game" class="inp">
          <option value="mini">NYT Mini</option>
          <option value="maptap">Maptap</option>
        </select>
      </div>

      <div class="field" id="ls-time-group"><label>Time (m:ss)</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input id="ls-min" class="inp" maxlength="2" placeholder="0" style="width:60px;text-align:center;font-family:var(--mono)"/>
          <span style="font-size:18px;color:var(--ink-3);font-weight:600">:</span>
          <input id="ls-sec" class="inp" maxlength="2" placeholder="00" style="width:60px;text-align:center;font-family:var(--mono)"/>
        </div>
      </div>

      <div class="field" id="ls-score-group" style="display:none"><label>Score</label>
        <input id="ls-score" type="number" class="inp" placeholder="847"/>
      </div>

      <div class="field"><label>Date</label>
        <input id="ls-date" type="date" class="inp" value="${todayStr()}" max="${todayStr()}"/>
      </div>

      <button class="btn-primary" id="ls-submit" style="margin-top:8px">Log score</button>
      <div class="auth-msg" id="ls-msg"></div>
    </div>
  </div>`;
}

function renderShortcutModal() {
  const u = state.user;
  const apiUrl = window.location.origin + '/api/data';
  return `<div class="modal-back" id="modal-back">
    <div class="modal" style="max-width:560px">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title">Your <em style="font-style:italic;color:var(--royal)">shortcut</em>.</div>
      <div class="modal-sub">Submit scores from your iPhone share sheet. Setup takes about 5 minutes — you only do it once.</div>

      <div class="shortcut-step" style="margin-bottom:14px">
        <div class="shortcut-eyebrow">Your details</div>
        <div style="font-family:var(--mono);font-size:12px;color:rgba(255,255,255,0.85);line-height:1.7;margin-top:8px">
          <div><span style="color:var(--gold)">Name:</span> ${escapeHtml(u.name)}</div>
          <div><span style="color:var(--gold)">Token:</span> ${u.token}</div>
          <div><span style="color:var(--gold)">API:</span> ${apiUrl}</div>
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:10px;line-height:1.5">Copy these — you'll paste them into the shortcut. Or tap the buttons below to copy them individually.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          <button class="copy-btn" onclick="copyText('${u.token}', this)">Copy token</button>
          <button class="copy-btn" onclick="copyText('${apiUrl}', this)">Copy API URL</button>
        </div>
      </div>

      <a class="btn-primary" href="#" onclick="installShortcut(event)" style="display:block;text-align:center;margin-bottom:10px">Show me how to set it up →</a>

      <div style="font-size:12px;color:var(--ink-3);text-align:center;line-height:1.5">After setup, scores submit in one tap from the iOS share sheet — no need to come back to this site.</div>
    </div>
  </div>`;
}

function renderShortcutGuideModal() {
  const u = state.user;
  const apiUrl = window.location.origin + '/api/data';

  return `<div class="modal-back" id="modal-back">
    <div class="modal" style="max-width:600px;max-height:90vh;overflow-y:auto">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title">Set up your <em style="font-style:italic;color:var(--royal)">shortcut</em>.</div>
      <div class="modal-sub">Follow these steps once on your iPhone. Then submitting scores is one tap from the share sheet.</div>

      <div style="background:var(--gold-bg);border:1px solid rgba(212,169,69,0.3);border-radius:10px;padding:14px 16px;margin-bottom:18px">
        <div style="font-family:var(--mono);font-size:11px;color:var(--gold-deep);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px">Have these ready</div>
        <div style="font-family:var(--mono);font-size:12px;color:var(--ink);line-height:1.7;word-break:break-all">
          <div style="margin-bottom:6px"><strong style="color:var(--royal)">Your token:</strong><br/><span id="tok-text">${u.token}</span> <button class="copy-btn-sm" onclick="copyText('${u.token}', this)">copy</button></div>
          <div><strong style="color:var(--royal)">API URL:</strong><br/><span id="api-text">${apiUrl}</span> <button class="copy-btn-sm" onclick="copyText('${apiUrl}', this)">copy</button></div>
        </div>
      </div>

      <div class="step-list-title" style="margin-bottom:10px">Steps (on your iPhone)</div>

      <div class="guide-step">
        <div class="guide-num">1</div>
        <div class="guide-text">
          <strong>Open the Shortcuts app</strong> (it's pre-installed on iPhone). If you don't have it, download free from the App Store.
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">2</div>
        <div class="guide-text">
          Tap the <strong>+</strong> in the top-right to create a new shortcut. Name it <strong>"Log to Board"</strong>.
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">3</div>
        <div class="guide-text">
          Tap <strong>Add Action</strong> → search for <strong>"Get Contents of URL"</strong> and add it.
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">4</div>
        <div class="guide-text">
          For the URL, paste:<br/>
          <code style="display:inline-block;background:var(--bg);padding:4px 8px;border-radius:4px;font-size:11.5px;margin-top:4px;word-break:break-all">${apiUrl}</code>
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">5</div>
        <div class="guide-text">
          Expand the action's options. Set <strong>Method</strong> to <strong>POST</strong>. Under <strong>Headers</strong>, add:<br/>
          <span style="font-family:var(--mono);font-size:11.5px;background:var(--bg);padding:2px 6px;border-radius:3px">Content-Type: application/json</span>
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">6</div>
        <div class="guide-text">
          Set <strong>Request Body</strong> to <strong>JSON</strong>. Add these fields:
          <div style="background:var(--bg);padding:10px 12px;border-radius:6px;font-family:var(--mono);font-size:11.5px;margin-top:6px;line-height:1.7">
            <div><strong>action</strong> = postScore</div>
            <div><strong>playerId</strong> = ${u.id}</div>
            <div><strong>game</strong> = mini <em style="color:var(--ink-4)">(or "maptap")</em></div>
            <div><strong>score</strong> = <em style="color:var(--ink-4)">(your time in seconds, e.g. 47)</em></div>
            <div><strong>played_on</strong> = <em style="color:var(--ink-4)">(today's date, YYYY-MM-DD)</em></div>
          </div>
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">7</div>
        <div class="guide-text">
          Tap the shortcut's <strong>settings (i icon)</strong> at the bottom. Toggle on <strong>"Show in Share Sheet"</strong>.
        </div>
      </div>

      <div class="guide-step">
        <div class="guide-num">8</div>
        <div class="guide-text">
          Done! Now from the NYT Mini app, tap <strong>Share → Log to Board</strong> after solving.
        </div>
      </div>

      <div style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:18px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Easier alternative</div>
        <div style="font-size:12.5px;color:var(--ink-3);line-height:1.5">If the shortcut feels like too much hassle, you can always log scores manually from the <strong>Account</strong> tab. The shortcut is optional — it just makes daily logging faster.</div>
      </div>
    </div>
  </div>`;
}

function renderDeleteAccountModal() {
  return `<div class="modal-back" id="modal-back">
    <div class="modal" style="max-width:440px">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title" style="color:var(--loss)">Delete account?</div>
      <div class="modal-sub">This will permanently remove <strong>${escapeHtml(state.user.name)}</strong> and all of your scores. Other players' scores stay. This can't be undone.</div>
      <div style="display:flex;gap:8px;margin-top:18px">
        <button class="btn-secondary" id="del-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary" id="del-confirm" style="flex:1;background:var(--loss)">Delete forever</button>
      </div>
      <div class="auth-msg" id="del-msg"></div>
    </div>
  </div>`;
}

function renderEditProfileModal() {
  const u = state.user;
  return `<div class="modal-back" id="modal-back">
    <div class="modal">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title">Edit profile</div>
      <div class="modal-sub">Update your name and photo.</div>

      <div class="photo-upload">
        ${avatarHTML(u, 54, 'photo-preview')}
        <div class="photo-info">
          <div class="photo-label-line">Profile photo</div>
          <div class="photo-sub">Tap upload to change</div>
        </div>
        <label class="photo-btn">
          Upload
          <input type="file" accept="image/*" id="ep-photo" style="display:none"/>
        </label>
      </div>

      <div class="field"><label>Name</label><input id="ep-name" class="inp" value="${escapeHtml(u.name)}"/></div>
      <button class="btn-primary" id="ep-save" style="margin-top:8px">Save changes</button>
      <div class="auth-msg" id="ep-msg"></div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════
// APP BINDINGS
// ═══════════════════════════════════════════════
function bindApp() {
  // Tabs
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); });
  document.querySelectorAll('[data-tab-link]').forEach(b => b.onclick = () => { state.tab = b.dataset.tabLink; render(); });

  // Game pills
  document.querySelectorAll('.pill').forEach(b => b.onclick = () => { state.game = b.dataset.game; render(); });

  // Header account
  const acct = document.getElementById('hdr-acct');
  if (acct) acct.onclick = () => { state.tab = 'account'; render(); };

  // Account actions
  const editBtn = document.getElementById('edit-profile');
  if (editBtn) editBtn.onclick = () => {
    window._pendingPhoto = null;
    state.modal = 'editProfile';
    render();
  };
  const logBtn = document.getElementById('log-score');
  if (logBtn) logBtn.onclick = () => { state.modal = 'logScore'; render(); };
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) logoutBtn.onclick = () => {
    localStorage.removeItem('gb_user');
    state.user = null;
    state.view = 'auth';
    state.authMode = 'signin';
    render();
  };
  const delBtn = document.getElementById('delete-account');
  if (delBtn) delBtn.onclick = () => { state.modal = 'deleteAccount'; render(); };

  // Modal bindings
  if (state.modal) {
    const closeBtn = document.getElementById('modal-close');
    const back = document.getElementById('modal-back');
    if (closeBtn) closeBtn.onclick = () => { state.modal = null; render(); };
    if (back) back.onclick = (e) => { if (e.target === back) { state.modal = null; render(); } };

    if (state.modal === 'logScore') {
      const gameSel = document.getElementById('ls-game');
      gameSel.onchange = () => {
        document.getElementById('ls-time-group').style.display = gameSel.value === 'mini' ? 'flex' : 'none';
        document.getElementById('ls-score-group').style.display = gameSel.value === 'maptap' ? 'flex' : 'none';
      };
      document.getElementById('ls-submit').onclick = handleLogScore;
    }

    if (state.modal === 'editProfile') {
      const photoIn = document.getElementById('ep-photo');
      photoIn.onchange = (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
        if (file.size > 8 * 1024 * 1024) { alert('Photo too large — pick under 8MB.'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          compressImage(ev.target.result, (compressed) => {
            const preview = document.querySelector('#modal-back .photo-preview');
            if (preview) preview.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
            window._pendingPhoto = compressed;
          });
        };
        reader.readAsDataURL(file);
      };
      document.getElementById('ep-save').onclick = handleSaveProfile;
    }

    if (state.modal === 'deleteAccount') {
      const cancel = document.getElementById('del-cancel');
      const confirm = document.getElementById('del-confirm');
      if (cancel) cancel.onclick = () => { state.modal = null; render(); };
      if (confirm) confirm.onclick = handleDeleteAccount;
    }
  }
}

async function handleDeleteAccount() {
  const msg = document.getElementById('del-msg');
  msg.className = 'auth-msg'; msg.textContent = 'Deleting...'; msg.style.color = 'var(--ink-3)';
  const ok = await deletePlayer(state.user.id);
  if (!ok) {
    msg.className = 'auth-msg error'; msg.textContent = 'Failed to delete. Try again.';
    return;
  }
  // Clean up local data
  localStorage.removeItem(`av_${state.user.id}`);
  localStorage.removeItem('gb_user');
  state.user = null;
  state.view = 'auth';
  state.authMode = 'signin';
  state.modal = null;
  await loadData();
  render();
}

async function handleLogScore() {
  const game = document.getElementById('ls-game').value;
  const date = document.getElementById('ls-date').value;
  const msg = document.getElementById('ls-msg');

  if (!date) { msg.className = 'auth-msg error'; msg.textContent = 'Pick a date.'; return; }
  // Don't allow future dates
  if (date > todayStr()) {
    msg.className = 'auth-msg error'; msg.textContent = "You can't log a future date.";
    return;
  }

  let score;
  if (game === 'mini') {
    const m = document.getElementById('ls-min').value;
    const s = document.getElementById('ls-sec').value;
    if (!m && !s) { msg.className = 'auth-msg error'; msg.textContent = 'Enter a time.'; return; }
    const mins = parseInt(m) || 0;
    const secs = parseInt(s) || 0;
    if (secs >= 60) { msg.className = 'auth-msg error'; msg.textContent = 'Seconds must be 0–59.'; return; }
    score = mins * 60 + secs;
    if (score === 0) { msg.className = 'auth-msg error'; msg.textContent = 'Time must be greater than 0.'; return; }
    if (score > 3600) { msg.className = 'auth-msg error'; msg.textContent = 'That seems too long — under an hour, please.'; return; }
  } else {
    score = document.getElementById('ls-score').value;
    if (!score) { msg.className = 'auth-msg error'; msg.textContent = 'Enter a score.'; return; }
    score = parseInt(score);
    if (isNaN(score) || score < 0) { msg.className = 'auth-msg error'; msg.textContent = 'Enter a valid score.'; return; }
  }

  msg.className = 'auth-msg'; msg.textContent = 'Saving...'; msg.style.color = 'var(--ink-3)';
  const ok = await postScore(state.user.id, game, score, date);
  if (ok) {
    msg.className = 'auth-msg success'; msg.textContent = '✓ Score logged.';
    setTimeout(() => { state.modal = null; render(); }, 900);
  } else {
    msg.className = 'auth-msg error'; msg.textContent = 'Error saving. Try again.';
  }
}

async function handleSaveProfile() {
  const name = document.getElementById('ep-name').value.trim();
  const msg = document.getElementById('ep-msg');
  if (!name) { msg.className = 'auth-msg error'; msg.textContent = 'Name is required.'; return; }

  msg.className = 'auth-msg'; msg.textContent = 'Saving...'; msg.style.color = 'var(--ink-3)';

  // Save to database — only send avatar if a new photo was selected
  const payload = { id: state.user.id, name };
  if (window._pendingPhoto) payload.avatar_url = window._pendingPhoto;
  const updated = await updatePlayer(payload);
  if (!updated) {
    msg.className = 'auth-msg error'; msg.textContent = 'Failed to save. Try again.';
    return;
  }

  state.user.name = name;
  if (window._pendingPhoto) {
    localStorage.setItem(`av_${state.user.id}`, window._pendingPhoto);
    state.user.avatar = window._pendingPhoto;
    window._pendingPhoto = null;
  }
  // Update player record locally
  const idx = state.players.findIndex(p => p.id === state.user.id);
  if (idx >= 0) state.players[idx] = { ...state.players[idx], ...state.user };
  localStorage.setItem('gb_user', JSON.stringify(state.user));
  msg.className = 'auth-msg success'; msg.textContent = '✓ Saved.';
  setTimeout(() => { state.modal = null; render(); }, 600);
}
