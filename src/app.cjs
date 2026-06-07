const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes.cjs');
const challongeRoutes = require('./routes/challonge.routes.cjs');
const tournamentRoutes = require('./routes/tournament.routes.cjs');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    app: 'challonge-api',
    message: 'Server is running',
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/challonge', challongeRoutes);
app.use('/tournaments', tournamentRoutes);

module.exports = app;
