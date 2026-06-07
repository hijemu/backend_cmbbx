const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config.cjs');

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
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { publicUser, createToken, requireAuth };
