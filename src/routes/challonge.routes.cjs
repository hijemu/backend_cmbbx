const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth.cjs');
const { readDb, writeDb } = require('../db/jsonDb.cjs');
const {
  APP_URL,
  API_URL,
  CHALLONGE_OAUTH_AUTHORIZE_URL,
  CHALLONGE_OAUTH_TOKEN_URL,
  OAUTH_SCOPES,
} = require('../config.cjs');
const { getConnection, saveConnection } = require('../services/challonge.service.cjs');

const router = express.Router();

router.get('/status', requireAuth, (req, res) => {
  const connection = getConnection(req.user.id);
  res.json({
    connected: !!connection,
    expires_at: connection?.expires_at || null,
    scope: connection?.scope || null,
  });
});

router.get('/connect', requireAuth, (req, res) => {
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

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${APP_URL}/connect-challonge?connected=0&error=${encodeURIComponent(error)}`);
  }

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
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });

    saveConnection(stateRow.user_id, tokenResponse.data);
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:40px;">
          <h2>You succeeded dumb fuck.</h2>
          <p>You can now return to the app.</p>
        </body>
      </html>
    `);
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    return res.send(`
     <html>
       <body style="font-family:sans-serif;text-align:center;padding:40px;">
         <h2>Di ka makapasok kasi nigga ka.</h2>
         <p>${msg}</p>
       </body>
     </html>
`    );
  }
});

router.delete('/disconnect', requireAuth, (req, res) => {
  const db = readDb();
  db.challonge_connections = db.challonge_connections.filter(
    (c) => Number(c.user_id) !== Number(req.user.id)
  );
  writeDb(db);
  res.json({ success: true });
});

// Dev-only fallback. Stores the API key on the backend, never in the mobile app.
router.post('/connect-api-key', requireAuth, (req, res) => {
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

module.exports = router;
