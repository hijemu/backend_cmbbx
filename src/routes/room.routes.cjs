const express = require('express');
const { requireAuth } = require('../middleware/auth.cjs');
const { legacyOrV2Client, listAll } = require('../services/challonge.service.cjs');
const { normalizeMatch } = require('../utils/normalizers.cjs');

const router = express.Router();

const rooms = new Map();

const makeCode = () =>
  `BBX${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const parseTournamentId = (input) => {
  const value = String(input || '').trim();

  const idMatch = value.match(/\/tournaments\/(\d+)/);
  if (idMatch) return idMatch[1];

  const numMatch = value.match(/^\d+$/);
  if (numMatch) return value;

  return value.split('/').filter(Boolean).pop();
};

router.post('/create', requireAuth, async (req, res) => {
  try {
    const { tournament } = req.body || {};
    const tournamentId = parseTournamentId(tournament);

    if (!tournamentId) {
      return res.status(400).json({ error: 'Tournament link or ID is required.' });
    }

    const code = makeCode();

    rooms.set(code, {
      code,
      tournamentId,
      ownerUserId: req.user.id,
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      code,
      tournamentId,
      room: rooms.get(code),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  res.json(room);
});

router.get('/:code/matches', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    const { mode, client } = await legacyOrV2Client(room.ownerUserId);

    if (mode === 'v1') {
      const response = await client.get(
        `/tournaments/${room.tournamentId}/matches.json`
      );
      return res.json(response.data);
    }

    const rows = await listAll(
      client,
      `/tournaments/${room.tournamentId}/matches.json`
    );

    res.json(rows.map((row) => normalizeMatch(row, room.tournamentId)));
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.put('/:code/matches/:matchId', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    const {
      scores_csv,
      winner_id,
      player1_id,
      player2_id,
      p1_score,
      p2_score,
    } = req.body || {};

    if (!winner_id || !player1_id || !player2_id) {
      return res.status(400).json({
        error: 'winner_id, player1_id, and player2_id are required.',
      });
    }

    const { mode, client } = await legacyOrV2Client(room.ownerUserId);

    if (mode === 'v1') {
      const response = await client.put(
        `/tournaments/${room.tournamentId}/matches/${req.params.matchId}.json`,
        {
          match: {
            scores_csv,
            winner_id,
          },
        }
      );

      return res.json(response.data);
    }

    const scoreParts = String(scores_csv || '0-0').split('-');

    const body = {
      data: {
        type: 'match',
        attributes: {
          match: [
            {
              participant_id: String(player1_id),
              score_set: String(p1_score ?? scoreParts[0] ?? 0),
              rank: Number(winner_id) === Number(player1_id) ? 1 : 2,
              advancing: Number(winner_id) === Number(player1_id),
            },
            {
              participant_id: String(player2_id),
              score_set: String(p2_score ?? scoreParts[1] ?? 0),
              rank: Number(winner_id) === Number(player2_id) ? 1 : 2,
              advancing: Number(winner_id) === Number(player2_id),
            },
          ],
          tie: false,
        },
      },
    };

    const response = await client.put(
      `/tournaments/${room.tournamentId}/matches/${req.params.matchId}.json`,
      body
    );

    res.json({
      success: true,
      match: normalizeMatch(response.data.data, room.tournamentId),
    });
  } catch (err) {
    console.log(
      'ROOM SCORE ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

module.exports = router;