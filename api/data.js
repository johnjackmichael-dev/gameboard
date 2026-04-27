// Vercel serverless function — reads/writes from Upstash KV
// Path: /api/data

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// GET a value from Upstash KV
async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV GET failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.result; // null if key doesn't exist
}

// SET a value in Upstash KV — pass the value as the request body
async function kvSet(key, value) {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'text/plain'
    },
    body: stringValue
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV SET failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Simple ID generator
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Normalize email for matching. Apple's @icloud.com, @me.com, and @mac.com
// addresses are aliases for the same account, so we treat them as equivalent.
function normalizeEmail(email) {
  if (!email) return '';
  const e = String(email).toLowerCase().trim();
  // Map all three Apple domains to a single canonical form
  return e
    .replace(/@me\.com$/, '@icloud.com')
    .replace(/@mac\.com$/, '@icloud.com');
}

// All gameboard data lives under the gb: prefix
const KEYS = {
  players: 'gb:players',
  scores:  'gb:scores'
};

async function getPlayers() {
  const raw = await kvGet(KEYS.players);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

async function getScores() {
  const raw = await kvGet(KEYS.scores);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
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

      if (action === 'deletePlayer') {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'Player id required' });
        const [players, scores] = await Promise.all([getPlayers(), getScores()]);
        const filteredPlayers = players.filter(p => p.id !== id);
        const filteredScores = scores.filter(s => s.player_id !== id);
        await Promise.all([savePlayers(filteredPlayers), saveScores(filteredScores)]);
        return res.status(200).json({ ok: true });
      }

      if (action === 'deleteScore') {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'Score id required' });
        const scores = await getScores();
        const filtered = scores.filter(s => s.id !== id);
        await saveScores(filtered);
        return res.status(200).json({ ok: true });
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

      if (action === 'postScoreByEmail') {
        // Used by the Cloudflare Worker that processes inbound emails.
        // Looks up the player by their account email instead of token.
        // Handles Apple email aliases (icloud/me/mac map to same account).
        const { email, game, score, played_on } = body;
        if (!email || !game || score === undefined || !played_on) {
          return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!['mini', 'maptap'].includes(game)) {
          return res.status(400).json({ error: 'Invalid game type' });
        }

        const players = await getPlayers();
        const senderNormalized = normalizeEmail(email);
        const player = players.find(p => normalizeEmail(p.email) === senderNormalized);
        if (!player) {
          // Don't error loudly — this could be spam or a non-user.
          // Return 200 so the Worker doesn't retry.
          return res.status(200).json({ ok: false, reason: 'unknown_sender', sender: email });
        }

        const scores = await getScores();
        const idx = scores.findIndex(s =>
          s.player_id === player.id && s.game === game && s.played_on === played_on
        );
        const entry = {
          id: idx >= 0 ? scores[idx].id : uid(),
          player_id: player.id,
          game,
          score: parseInt(score),
          played_on,
          submitted_at: new Date().toISOString(),
          source: 'email'
        };
        if (idx >= 0) scores[idx] = entry; else scores.push(entry);
        await saveScores(scores);
        return res.status(200).json({ ok: true, score: entry, player_name: player.name });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
