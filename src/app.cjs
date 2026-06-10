const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes.cjs');
const challongeRoutes = require('./routes/challonge.routes.cjs');
const tournamentRoutes = require('./routes/tournament.routes.cjs');
const roomRoutes = require('./routes/room.routes.cjs');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    app: 'Joboy-CentralManila-API',
    message: 'API is running my nigga',
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/challonge', challongeRoutes);
app.use('/tournaments', tournamentRoutes);
app.use('/rooms', roomRoutes);

module.exports = app;
