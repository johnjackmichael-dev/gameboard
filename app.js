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

function loadDemo() {
  // No-op in production. Data comes from the database.
  // If the DB is empty, the dashboard shows the empty state.
}

async function createPlayer({ name, email }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createPlayer', name, email })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create account');
  }
  return data.player;
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
      <div class="auth-sub">One last thing — install the iOS shortcut so you can submit scores from the share sheet. Takes one tap.</div>

      <div class="shortcut-step">
        <div class="shortcut-eyebrow">Step 1 — install</div>
        <div class="shortcut-title">Tap to install your shortcut</div>
        <div class="shortcut-desc">Open this page on your iPhone and tap below. Your personal token is already baked in — no copy/paste needed.</div>
        <a class="shortcut-button" href="#" onclick="installShortcut(event)">
          Install on iPhone
          <span style="font-size:16px">→</span>
        </a>
        <div class="shortcut-meta">
          <span class="shortcut-meta-item">⏱ 1 tap</span>
          <span class="shortcut-meta-item">📱 iPhone only</span>
          <span class="shortcut-meta-item">🔒 Your token: ${u.token.slice(0, 8)}…</span>
        </div>
      </div>

      <div class="step-list">
        <div class="step-list-title">After installing</div>
        <div class="step"><div class="step-num">1</div><div class="step-text">Finish the <strong>NYT Mini</strong> or <strong>Maptap</strong> as usual</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Tap the <strong>share button</strong> in the app</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Tap <strong>"Log to Board"</strong> in the share sheet</div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text">Done. Score appears on the leaderboard within a minute.</div></div>
      </div>

      <button class="btn-primary" id="goto-app">Continue to the board →</button>
      <div class="auth-foot"><button id="skip-shortcut">I'll set up the shortcut later</button></div>
    </div>
  </div>`;
}

function bindAuth() {
  const $ = id => document.getElementById(id);

  if (state.authMode === 'signin') {
    $('signin-btn').onclick = handleSignIn;
    $('signin-email').onkeydown = e => e.key === 'Enter' && handleSignIn();
    $('show-signup').onclick = () => { state.authMode = 'signup'; render(); };
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
      const reader = new FileReader();
      reader.onload = ev => {
        $('photo-preview').innerHTML = `<img src="${ev.target.result}"/>`;
        window._pendingPhoto = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
  }
  if (state.authMode === 'shortcut') {
    $('goto-app').onclick = () => { state.view = 'app'; render(); };
    $('skip-shortcut').onclick = () => { state.view = 'app'; render(); };
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
    window._pendingPhoto = null;
  }
  state.user = player;
  localStorage.setItem('gb_user', JSON.stringify(state.user));
  state.authMode = 'shortcut';
  render();
}

function installShortcut(e) {
  e.preventDefault();
  alert(`In production this would open:\nshortcuts://import-shortcut?url=https://yourapp.com/shortcut/${state.user.token}.shortcut\n\nThis serves a pre-built iOS shortcut with your token baked in.`);
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
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">iOS Shortcut</div>
      <div style="font-size:13px;color:var(--ink-3);line-height:1.5;margin-bottom:14px">Submit scores from your iPhone share sheet without opening this site.</div>
      <button class="btn-primary" id="get-shortcut" style="width:auto">Get my shortcut →</button>
    </div>

    <div class="settings-card">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">Manually log a score</div>
      <div style="font-size:13px;color:var(--ink-3);line-height:1.5;margin-bottom:14px">For when the shortcut isn't available or you want to backfill.</div>
      <button class="btn-secondary" id="log-score">Log a score</button>
    </div>

    <div class="settings-card">
      <button class="btn-ghost" id="logout" style="color:var(--loss)">Sign out</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════
function renderModal() {
  if (state.modal === 'logScore') return renderLogScoreModal();
  if (state.modal === 'shortcut') return renderShortcutModal();
  if (state.modal === 'editProfile') return renderEditProfileModal();
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
        <input id="ls-date" type="date" class="inp" value="${todayStr()}"/>
      </div>

      <button class="btn-primary" id="ls-submit" style="margin-top:8px">Log score</button>
      <div class="auth-msg" id="ls-msg"></div>
    </div>
  </div>`;
}

function renderShortcutModal() {
  const u = state.user;
  return `<div class="modal-back" id="modal-back">
    <div class="modal">
      <button class="modal-x" id="modal-close">×</button>
      <div class="modal-title">Your <em style="font-style:italic;color:var(--royal)">shortcut</em>.</div>
      <div class="modal-sub">Open this page on your iPhone to install the shortcut. Your token is baked in — submitting scores will be one tap from the share sheet.</div>
      <div class="shortcut-step">
        <div class="shortcut-eyebrow">Token: ${u.token.slice(0, 12)}…</div>
        <div class="shortcut-title">Install on iPhone</div>
        <div class="shortcut-desc">Tap the button below from your iPhone to add it to Shortcuts.</div>
        <a class="shortcut-button" href="#" onclick="installShortcut(event)">Install →</a>
      </div>
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
  if (editBtn) editBtn.onclick = () => { state.modal = 'editProfile'; render(); };
  const shortcutBtn = document.getElementById('get-shortcut');
  if (shortcutBtn) shortcutBtn.onclick = () => { state.modal = 'shortcut'; render(); };
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
        const reader = new FileReader();
        reader.onload = ev => {
          const preview = document.querySelector('.photo-preview');
          preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover"/>`;
          window._pendingPhoto = ev.target.result;
        };
        reader.readAsDataURL(file);
      };
      document.getElementById('ep-save').onclick = handleSaveProfile;
    }
  }
}

async function handleLogScore() {
  const game = document.getElementById('ls-game').value;
  const date = document.getElementById('ls-date').value;
  const msg = document.getElementById('ls-msg');
  let score;
  if (game === 'mini') {
    const m = document.getElementById('ls-min').value, s = document.getElementById('ls-sec').value;
    if (!m && !s) { msg.className = 'auth-msg error'; msg.textContent = 'Enter a time.'; return; }
    score = (parseInt(m) || 0) * 60 + (parseInt(s) || 0);
  } else {
    score = document.getElementById('ls-score').value;
    if (!score) { msg.className = 'auth-msg error'; msg.textContent = 'Enter a score.'; return; }
  }
  msg.className = 'auth-msg'; msg.textContent = 'Saving...'; msg.style.color = 'var(--ink-3)';
  const ok = await postScore(state.user.id, game, score, date);
  if (ok) {
    msg.className = 'auth-msg success'; msg.textContent = '✓ Score logged.';
    setTimeout(() => { state.modal = null; render(); }, 900);
  } else {
    msg.className = 'auth-msg error'; msg.textContent = 'Error saving.';
  }
}

async function handleSaveProfile() {
  const name = document.getElementById('ep-name').value.trim();
  const msg = document.getElementById('ep-msg');
  if (!name) { msg.className = 'auth-msg error'; msg.textContent = 'Name is required.'; return; }
  state.user.name = name;
  if (window._pendingPhoto) {
    localStorage.setItem(`av_${state.user.id}`, window._pendingPhoto);
    state.user.avatar = window._pendingPhoto;
    window._pendingPhoto = null;
  }
  // Update player record
  const idx = state.players.findIndex(p => p.id === state.user.id);
  if (idx >= 0) state.players[idx] = { ...state.players[idx], ...state.user };
  localStorage.setItem('gb_user', JSON.stringify(state.user));
  msg.className = 'auth-msg success'; msg.textContent = '✓ Saved.';
  setTimeout(() => { state.modal = null; render(); }, 600);
}
