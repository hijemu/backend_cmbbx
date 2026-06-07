const path = require('path');

const PORT = process.env.PORT || 6666;
const JWT_SECRET = process.env.JWT_SECRET || 'umvwemvweewnvadsjkaosas';
const APP_URL = process.env.APP_URL || 'https://api-test-cmxie.duckdns.org';
const API_URL = process.env.API_URL || 'https://api-test-cmxie.duckdns.org';
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
