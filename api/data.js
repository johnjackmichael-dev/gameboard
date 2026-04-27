// Vercel serverless function — reads/writes from Upstash KV
// Path: /api/data
//
// Routes:
//   GET  /api/data?type=players      → list all players
//   GET  /api/data?type=scores       → list all scores
//   POST /api/data  body { action: 'createPlayer', name, email }
//   POST /api/data  body { action: 'postScore', playerId, game, score, played_on }
//   POST /api/data  body { action: 'updatePlayer', id, name, avatar_url }

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Simple Upstash REST helpers
async function kv(command, ...args) {
  const res = await fetch(`${KV_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) throw new Error(`KV ${command} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function kvSet(key, value) {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`);
  return res.json();
}

// Simple ID generator
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// All gameboard data lives under the gb: prefix to avoid collisions with other apps
const KEYS = {
  players: 'gb:players',  // array of player objects
  scores:  'gb:scores'    // array of score objects
};

async function getPlayers() {
  const raw = await kv('get', KEYS.players);
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
}

async function getScores() {
  const raw = await kv('get', KEYS.scores);
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
}

async function savePlayers(players) {
  return kvSet(KEYS.players, players);
}

async function saveScores(scores) {
  return kvSet(KEYS.scores, scores);
}

export default async function handler(req, res) {
  // CORS for safety
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ error: 'Database not configured. KV_REST_API_URL and KV_REST_API_TOKEN must be set.' });
    }

    if (req.method === 'GET') {
      const { type } = req.query;
      if (type === 'players') {
        const players = await getPlayers();
        return res.status(200).json({ players });
      }
      if (type === 'scores') {
        const scores = await getScores();
        return res.status(200).json({ scores });
      }
      // Default: return both
      const [players, scores] = await Promise.all([getPlayers(), getScores()]);
      return res.status(200).json({ players, scores });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action } = body;

      if (action === 'createPlayer') {
        const { name, email, avatar_url } = body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

        const players = await getPlayers();
        const emailLower = email.toLowerCase().trim();
        if (players.find(p => (p.email || '').toLowerCase() === emailLower)) {
          return res.status(409).json({ error: 'Email already registered' });
        }

        const newPlayer = {
          id: uid(),
          name: name.trim(),
          email: emailLower,
          token: uid() + uid(),
          avatar_url: avatar_url || null,
          created_at: new Date().toISOString()
        };
        players.push(newPlayer);
        await savePlayers(players);
        return res.status(200).json({ player: newPlayer });
      }

      if (action === 'updatePlayer') {
        const { id, name, avatar_url } = body;
        if (!id) return res.status(400).json({ error: 'Player id required' });
        const players = await getPlayers();
        const idx = players.findIndex(p => p.id === id);
        if (idx < 0) return res.status(404).json({ error: 'Player not found' });
        if (name !== undefined) players[idx].name = name.trim();
        if (avatar_url !== undefined) players[idx].avatar_url = avatar_url;
        await savePlayers(players);
        return res.status(200).json({ player: players[idx] });
      }

      if (action === 'postScore') {
        const { playerId, game, score, played_on } = body;
        if (!playerId || !game || score === undefined || !played_on) {
          return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!['mini', 'maptap'].includes(game)) {
          return res.status(400).json({ error: 'Invalid game type' });
        }

        const scores = await getScores();
        // Upsert: replace existing score for same player+game+date
        const idx = scores.findIndex(s =>
          s.player_id === playerId && s.game === game && s.played_on === played_on
        );
        const entry = {
          id: idx >= 0 ? scores[idx].id : uid(),
          player_id: playerId,
          game,
          score: parseInt(score),
          played_on,
          submitted_at: new Date().toISOString()
        };
        if (idx >= 0) scores[idx] = entry; else scores.push(entry);
        await saveScores(scores);
        return res.status(200).json({ score: entry });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
