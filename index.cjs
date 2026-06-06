require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-now';
const APP_URL = process.env.APP_URL || 'http://localhost:8100';
const API_URL = process.env.API_URL || `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

const CHALLONGE_API_BASE = 'https://api.challonge.com/v2.1';
const CHALLONGE_OAUTH_AUTHORIZE_URL = 'https://api.challonge.com/oauth/authorize';
const CHALLONGE_OAUTH_TOKEN_URL = 'https://api.challonge.com/oauth/token';

const OAUTH_SCOPES = [
  'me',
  'tournaments:read',
  'tournaments:write',
  'matches:read',
  'matches:write',
  'participants:read',
  'participants:write',
].join(' ');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], challonge_connections: [], oauth_states: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

function createToken(user) {
  return jwt.sign(publicUser(user), JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function getConnection(userId) {
  const db = readDb();
  return db.challonge_connections.find((c) => Number(c.user_id) === Number(userId));
}

function saveConnection(userId, tokenData) {
  const db = readDb();
  const now = Date.now();
  const expiresInMs = Number(tokenData.expires_in || 604800) * 1000;
  const expiresAt = new Date(now + expiresInMs).toISOString();

  const existing = db.challonge_connections.find((c) => Number(c.user_id) === Number(userId));
  const payload = {
    user_id: Number(userId),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || existing?.refresh_token || null,
    token_type: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || OAUTH_SCOPES,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    Object.assign(existing, payload);
  } else {
    db.challonge_connections.push({
      id: Date.now(),
      created_at: new Date().toISOString(),
      ...payload,
    });
  }

  writeDb(db);
  return payload;
}

async function refreshConnectionIfNeeded(connection) {
  if (!connection) throw new Error('No Challonge connection');

  const expiresAt = new Date(connection.expires_at || 0).getTime();
  const shouldRefresh = expiresAt && Date.now() > expiresAt - 5 * 60 * 1000;

  if (!shouldRefresh) return connection;

  if (!connection.refresh_token) {
    throw new Error('Challonge token expired. Please reconnect Challonge.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
    client_id: process.env.CHALLONGE_CLIENT_ID || '',
    client_secret: process.env.CHALLONGE_CLIENT_SECRET || '',
  });

  const response = await axios.post(CHALLONGE_OAUTH_TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  });

  return saveConnection(connection.user_id, response.data);
}

async function challongeForUser(userId) {
  const connection = await refreshConnectionIfNeeded(getConnection(userId));

  return axios.create({
    baseURL: CHALLONGE_API_BASE,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization-Type': 'v2',
      Authorization: `Bearer ${connection.access_token}`,
    },
  });
}

function normalizeTournament(row) {
  if (row.tournament) return row;
  const attrs = row.attributes || {};
  return {
    tournament: {
      id: Number(row.id),
      name: attrs.name,
      url: attrs.url,
      game_name: attrs.game_name,
      tournament_type: attrs.tournament_type,
      state: attrs.state,
      description: attrs.description,
      created_at: attrs.timestamps?.created_at || attrs.created_at,
      updated_at: attrs.timestamps?.updated_at || attrs.updated_at,
      participants_count: attrs.participants_count || attrs.participant_count || 0,
    },
  };
}

function relationId(row, key) {
  const attrs = row.attributes || row;
  return Number(
    row.relationships?.[key]?.data?.id ||
    attrs.relationships?.[key]?.data?.id ||
    attrs[key + '_id'] ||
    attrs[key]?.id ||
    0
  ) || null;
}

function normalizeMatch(row, tournamentId) {
  if (row.match) return row;

  const attrs = row.attributes || {};
  const points = Array.isArray(attrs.points_by_participant)
    ? attrs.points_by_participant
    : [];

  const p1 = points[0]?.participant_id || null;
  const p2 = points[1]?.participant_id || null;

  return {
    match: {
      id: Number(row.id),
      tournament_id: Number(tournamentId),
      state: attrs.state,
      round: attrs.round,
      identifier: attrs.identifier,
      scores_csv: attrs.scores || attrs.scores_csv || '',
      winner_id: Number(attrs.winner_id || 0) || null,
      player1_id: Number(p1) || relationId(row, 'player1'),
      player2_id: Number(p2) || relationId(row, 'player2'),
      suggested_play_order: attrs.suggested_play_order,
    },
  };
}

function normalizeParticipant(row) {
  if (row.participant) return row;
  const attrs = row.attributes || {};
  return {
    participant: {
      id: Number(row.id),
      name: attrs.name || attrs.display_name || attrs.username || `Participant ${row.id}`,
      seed: attrs.seed,
      final_rank: attrs.final_rank,
      misc: attrs.misc,
    },
  };
}

async function listAll(client, url, params = {}) {
  const response = await client.get(url, { params });
  return Array.isArray(response.data?.data) ? response.data.data : response.data;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const db = readDb();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (db.users.some((u) => u.email === normalizedEmail)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const user = {
    id: Date.now(),
    name: String(name).trim(),
    email: normalizedEmail,
    password_hash: await bcrypt.hash(password, 10),
    role: 'organizer',
    created_at: new Date().toISOString(),
  };

  db.users.push(user);
  writeDb(db);

  res.json({ user: publicUser(user), token: createToken(user) });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.email === String(email || '').trim().toLowerCase());

  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }

  res.json({ user: publicUser(user), token: createToken(user) });
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/challonge/status', requireAuth, (req, res) => {
  const connection = getConnection(req.user.id);
  res.json({
    connected: !!connection,
    expires_at: connection?.expires_at || null,
    scope: connection?.scope || null,
  });
});

app.get('/challonge/connect', requireAuth, (req, res) => {
  if (!process.env.CHALLONGE_CLIENT_ID) {
    return res.status(500).json({ error: 'Missing CHALLONGE_CLIENT_ID in server .env' });
  }

  const db = readDb();
  const state = crypto.randomBytes(24).toString('hex');
  db.oauth_states.push({
    state,
    user_id: req.user.id,
    created_at: new Date().toISOString(),
  });
  writeDb(db);

  const redirectUri = process.env.CHALLONGE_REDIRECT_URI || `${API_URL}/challonge/callback`;
  const url = new URL(CHALLONGE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.CHALLONGE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('state', state);

  res.json({ url: url.toString() });
});

app.get('/challonge/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/connect-challonge?connected=0&error=${encodeURIComponent(error)}`);
  if (!code || !state) return res.status(400).send('Missing code/state');

  const db = readDb();
  const stateRow = db.oauth_states.find((s) => s.state === state);
  if (!stateRow) return res.status(400).send('Invalid state');

  db.oauth_states = db.oauth_states.filter((s) => s.state !== state);
  writeDb(db);

  try {
    const redirectUri = process.env.CHALLONGE_REDIRECT_URI || `${API_URL}/challonge/callback`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      client_id: process.env.CHALLONGE_CLIENT_ID || '',
      client_secret: process.env.CHALLONGE_CLIENT_SECRET || '',
    });

    const tokenResponse = await axios.post(CHALLONGE_OAUTH_TOKEN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });

    saveConnection(stateRow.user_id, tokenResponse.data);
    return res.redirect(`${APP_URL}/connect-challonge?connected=1`);
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    return res.redirect(`${APP_URL}/connect-challonge?connected=0&error=${encodeURIComponent(msg)}`);
  }
});

app.delete('/challonge/disconnect', requireAuth, (req, res) => {
  const db = readDb();
  db.challonge_connections = db.challonge_connections.filter((c) => Number(c.user_id) !== Number(req.user.id));
  writeDb(db);
  res.json({ success: true });
});

// This dev-only fallback lets you test before Challonge approves/configures your OAuth app.
// It still stores the key on the backend only, not in the mobile app.
app.post('/challonge/connect-api-key', requireAuth, (req, res) => {
  const { api_key } = req.body;
  if (!api_key) return res.status(400).json({ error: 'api_key is required' });

  const db = readDb();
  const existing = db.challonge_connections.find((c) => Number(c.user_id) === Number(req.user.id));
  const fakeToken = {
    user_id: Number(req.user.id),
    access_token: String(api_key),
    refresh_token: null,
    token_type: 'ApiKeyV1',
    scope: 'api_v1_key',
    expires_at: null,
    updated_at: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, fakeToken);
  else db.challonge_connections.push({ id: Date.now(), created_at: new Date().toISOString(), ...fakeToken });
  writeDb(db);
  res.json({ success: true });
});

async function legacyOrV2Client(userId) {
  const connection = getConnection(userId);
  if (!connection) throw new Error('Connect your Challonge account first');

  if (connection.token_type === 'ApiKeyV1') {
    return {
      mode: 'v1',
      client: axios.create({
        baseURL: 'https://api.challonge.com/v1',
        params: { api_key: connection.access_token },
      }),
    };
  }

  return { mode: 'v2', client: await challongeForUser(userId) };
}

app.get('/tournaments', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    if (mode === 'v1') {
      const response = await client.get('/tournaments.json');
      return res.json(response.data);
    }
    const rows = await listAll(client, '/tournaments.json');
    res.json(rows.map(normalizeTournament));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.get('/tournaments/:id', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}.json`);
      return res.json(response.data);
    }
    const response = await client.get(`/tournaments/${req.params.id}.json`);
    res.json(normalizeTournament(response.data.data));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.get('/tournaments/:id/matches', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}/matches.json`);
      return res.json(response.data);
    }
    const rows = await listAll(client, `/tournaments/${req.params.id}/matches.json`);
    console.log(
      "RAW MATCH FROM CHALLONGE:",
      JSON.stringify(rows[0], null, 2)
    );
    res.json(rows.map((row) => normalizeMatch(row, req.params.id)));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.get('/tournaments/:id/participants', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}/participants.json`);
      return res.json(response.data);
    }
    const rows = await listAll(client, `/tournaments/${req.params.id}/participants.json`);
    res.json(rows.map(normalizeParticipant));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.put('/tournaments/:tournamentId/matches/:matchId', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    const { scores_csv, winner_id, player1_id, player2_id, p1_score, p2_score } = req.body;

    if (mode === 'v1') {
      const response = await client.put(`/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`, {
        match: { scores_csv, winner_id },
      });
      return res.json(response.data);
    }

    const p1 = player1_id;
    const p2 = player2_id;
    const body = {
      data: {
        type: 'match',
        attributes: {
          match: [
            { participant_id: String(p1), score_set: String(p1_score ?? String(scores_csv).split('-')[0] ?? 0), rank: Number(winner_id) === Number(p1) ? 1 : 2, advancing: Number(winner_id) === Number(p1) },
            { participant_id: String(p2), score_set: String(p2_score ?? String(scores_csv).split('-')[1] ?? 0), rank: Number(winner_id) === Number(p2) ? 1 : 2, advancing: Number(winner_id) === Number(p2) },
          ],
          tie: false,
        },
      },
    };

    const response = await client.put(`/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`, body);
    res.json(normalizeMatch(response.data.data, req.params.tournamentId));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.get('/tournaments/:id/standings', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    let participants;
    let matches;

    if (mode === 'v1') {
      participants = (await client.get(`/tournaments/${req.params.id}/participants.json`)).data;
      matches = (await client.get(`/tournaments/${req.params.id}/matches.json`)).data;
    } else {
      participants = (await listAll(client, `/tournaments/${req.params.id}/participants.json`)).map(normalizeParticipant);
      matches = (await listAll(client, `/tournaments/${req.params.id}/matches.json`)).map((row) => normalizeMatch(row, req.params.id));
    }

    const standings = {};
    participants.forEach((p) => {
      const participant = p.participant;
      standings[participant.id] = { id: participant.id, name: participant.name, wins: 0, losses: 0, pointsScored: 0, pointsAgainst: 0 };
    });

    matches.forEach((m) => {
      const match = m.match;
      if (match.state !== 'complete' || !match.player1_id || !match.player2_id) return;
      const parts = String(match.scores_csv || '').split('-').map((n) => Number(String(n).trim()) || 0);
      const p1Score = parts[0] || 0;
      const p2Score = parts[1] || 0;
      if (standings[match.player1_id]) {
        standings[match.player1_id].pointsScored += p1Score;
        standings[match.player1_id].pointsAgainst += p2Score;
      }
      if (standings[match.player2_id]) {
        standings[match.player2_id].pointsScored += p2Score;
        standings[match.player2_id].pointsAgainst += p1Score;
      }
      if (match.winner_id && standings[match.winner_id]) standings[match.winner_id].wins += 1;
      const loserId = Number(match.winner_id) === Number(match.player1_id) ? match.player2_id : match.player1_id;
      if (loserId && standings[loserId]) standings[loserId].losses += 1;
    });

    res.json(Object.values(standings).sort((a, b) => b.wins - a.wins || (b.pointsScored - b.pointsAgainst) - (a.pointsScored - a.pointsAgainst)));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

app.listen(PORT, () => {
  console.log(`Challonge Connect backend running on http://localhost:${PORT}`);
});
