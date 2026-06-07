const express = require('express');
const bcrypt = require('bcryptjs');
const { readDb, writeDb } = require('../db/jsonDb.cjs');
const { publicUser, createToken, requireAuth } = require('../middleware/auth.cjs');

const router = express.Router();

router.post('/register', async (req, res) => {
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

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.email === String(email || '').trim().toLowerCase());

  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }

  res.json({ user: publicUser(user), token: createToken(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
