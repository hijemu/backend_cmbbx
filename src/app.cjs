const express = require('express');
const { requireAuth } = require('../middleware/auth.cjs');
const {
  legacyOrV2Client,
  listAll,
} = require('../services/challonge.service.cjs');
const { normalizeMatch } = require('../utils/normalizers.cjs');

const router = express.Router();

/**
 * MVP memory storage:
 * sharedTournaments[tournamentId] = {
 *   tournamentId,
 *   ownerUserId,
 *   enabled,
 *   createdAt
 * }
 *
 * Later we should persist this to data/db.json.
 */
const sharedTournaments = new Map();

const parseTournamentId = (input) => {
  const value = String(input || '').trim();

  const idMatch = value.match(/\/tournaments\/(\d+)/);
  if (idMatch) return idMatch[1];

  const numMatch = value.match(/^\d+$/);
  if (numMatch) return value;

  return value.split('/').filter(Boolean).pop();
};

/**
 * Organizer enables judge access.
 * Body:
 * {
 *   "tournament": "18060959"
 * }
 */
router.post('/enable', requireAuth, async (req, res) => {
  try {
    const { tournament } = req.body || {};
    const tournamentId = parseTournamentId(tournament);

    if (!tournamentId) {
      return res.status(400).json({
        error: 'Tournament link or ID is required.',
      });
    }

    sharedTournaments.set(String(tournamentId), {
      tournamentId: String(tournamentId),
      ownerUserId: req.user.id,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      tournamentId: String(tournamentId),
      shareCode: String(tournamentId),
      message: `Judge access enabled. Share tournament ID ${tournamentId}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Organizer disables judge access.
 */
router.post('/:tournamentId/disable', requireAuth, async (req, res) => {
  const tournamentId = String(req.params.tournamentId || '').trim();
  const shared = sharedTournaments.get(tournamentId);

  if (!shared) {
    return res.status(404).json({ error: 'Shared tournament not found.' });
  }

  if (String(shared.ownerUserId) !== String(req.user.id)) {
    return res.status(403).json({
      error: 'Only the organizer can disable judge access.',
    });
  }

  sharedTournaments.delete(tournamentId);

  res.json({
    success: true,
    tournamentId,
    message: 'Judge access disabled.',
  });
});

/**
 * Public room check.
 */
router.get('/:tournamentId', async (req, res) => {
  const tournamentId = String(req.params.tournamentId || '').trim();
  const shared = sharedTournaments.get(tournamentId);

  if (!shared || !shared.enabled) {
    return res.status(404).json({
      error: 'Judge access is not enabled for this tournament.',
    });
  }

  res.json({
    success: true,
    tournamentId,
    enabled: true,
  });
});

/**
 * Public judge match list.
 */
router.get('/:tournamentId/matches', async (req, res) => {
  try {
    const tournamentId = String(req.params.tournamentId || '').trim();
    const shared = sharedTournaments.get(tournamentId);

    if (!shared || !shared.enabled) {
      return res.status(404).json({
        error: 'Judge access is not enabled for this tournament.',
      });
    }

    const { mode, client } = await legacyOrV2Client(shared.ownerUserId);

    if (mode === 'v1') {
      const response = await client.get(
        `/tournaments/${tournamentId}/matches.json`
      );
      return res.json(response.data);
    }

    const rows = await listAll(client, `/tournaments/${tournamentId}/matches.json`);

    res.json(rows.map((row) => normalizeMatch(row, tournamentId)));
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

/**
 * Public judge score submit.
 */
router.put('/:tournamentId/matches/:matchId', async (req, res) => {
  try {
    const tournamentId = String(req.params.tournamentId || '').trim();
    const shared = sharedTournaments.get(tournamentId);

    if (!shared || !shared.enabled) {
      return res.status(404).json({
        error: 'Judge access is not enabled for this tournament.',
      });
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

    const { mode, client } = await legacyOrV2Client(shared.ownerUserId);

    if (mode === 'v1') {
      const response = await client.put(
        `/tournaments/${tournamentId}/matches/${req.params.matchId}.json`,
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
      `/tournaments/${tournamentId}/matches/${req.params.matchId}.json`,
      body
    );

    res.json({
      success: true,
      match: normalizeMatch(response.data.data, tournamentId),
    });
  } catch (err) {
    console.log(
      'SHARED SCORE ERROR:',
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