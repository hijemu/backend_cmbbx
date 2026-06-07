const path = require('path');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-now';
const APP_URL = process.env.APP_URL || 'http://localhost:8100';
const API_URL = process.env.API_URL || `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

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

module.exports = {
  PORT,
  JWT_SECRET,
  APP_URL,
  API_URL,
  DB_PATH,
  CHALLONGE_API_BASE,
  CHALLONGE_OAUTH_AUTHORIZE_URL,
  CHALLONGE_OAUTH_TOKEN_URL,
  OAUTH_SCOPES,
};
