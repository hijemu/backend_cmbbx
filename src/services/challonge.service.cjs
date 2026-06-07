const axios = require('axios');
const {
  CHALLONGE_API_BASE,
  CHALLONGE_OAUTH_TOKEN_URL,
  OAUTH_SCOPES,
} = require('../config.cjs');
const { readDb, writeDb } = require('../db/jsonDb.cjs');

function getConnection(userId) {
  const db = readDb();
  return db.challonge_connections.find((c) => Number(c.user_id) === Number(userId));
}

function saveConnection(userId, tokenData) {
  const db = readDb();
  const now = Date.now();
  const expiresInMs = Number(tokenData.expires_in || 604800) * 1000;
  const expiresAt = tokenData.token_type === 'ApiKeyV1' ? null : new Date(now + expiresInMs).toISOString();

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
  if (connection.token_type === 'ApiKeyV1') return connection;

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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
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

async function listAll(client, url, params = {}) {
  const response = await client.get(url, { params });
  return Array.isArray(response.data?.data) ? response.data.data : response.data;
}

module.exports = {
  getConnection,
  saveConnection,
  refreshConnectionIfNeeded,
  challongeForUser,
  legacyOrV2Client,
  listAll,
};
