const express = require('express');
const { requireAuth } = require('../middleware/auth.cjs');
const { legacyOrV2Client, listAll } = require('../services/challonge.service.cjs');
const {
  normalizeTournament,
  normalizeMatch,
  normalizeParticipant,
} = require('../utils/normalizers.cjs');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.get('/tournaments.json');
      return res.json(response.data);
    }

    const rows = await listAll(client, '/tournaments.json');
    res.json(rows.map(normalizeTournament));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}.json`);
      return res.json(response.data);
    }

    const response = await client.get(`/tournaments/${req.params.id}.json`);
    res.json(normalizeTournament(response.data.data));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

router.get('/:id/matches', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}/matches.json`);
      return res.json(response.data);
    }

    const rows = await listAll(client, `/tournaments/${req.params.id}/matches.json`);
    res.json(rows.map((row) => normalizeMatch(row, req.params.id)));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

router.get('/:id/participants', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.get(`/tournaments/${req.params.id}/participants.json`);
      return res.json(response.data);
    }

    const rows = await listAll(client, `/tournaments/${req.params.id}/participants.json`);
    res.json(rows.map(normalizeParticipant));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

router.put('/:tournamentId/matches/:matchId', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    const { scores_csv, winner_id, player1_id, player2_id, p1_score, p2_score } = req.body;

    if (mode === 'v1') {
      const response = await client.put(
        `/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`,
        { match: { scores_csv, winner_id } }
      );
      return res.json(response.data);
    }

    const p1 = player1_id;
    const p2 = player2_id;
    const scoreParts = String(scores_csv || '0-0').split('-');

    const body = {
      data: {
        type: 'match',
        attributes: {
          match: [
            {
              participant_id: String(p1),
              score_set: String(p1_score ?? scoreParts[0] ?? 0),
              rank: Number(winner_id) === Number(p1) ? 1 : 2,
              advancing: Number(winner_id) === Number(p1),
            },
            {
              participant_id: String(p2),
              score_set: String(p2_score ?? scoreParts[1] ?? 0),
              rank: Number(winner_id) === Number(p2) ? 1 : 2,
              advancing: Number(winner_id) === Number(p2),
            },
          ],
          tie: false,
        },
      },
    };

    const response = await client.put(
      `/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`,
      body
    );

    res.json(normalizeMatch(response.data.data, req.params.tournamentId));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

router.get('/:id/standings', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    let participants;
    let matches;

    if (mode === 'v1') {
      participants = (await client.get(`/tournaments/${req.params.id}/participants.json`)).data;
      matches = (await client.get(`/tournaments/${req.params.id}/matches.json`)).data;
    } else {
      participants = (await listAll(client, `/tournaments/${req.params.id}/participants.json`)).map(normalizeParticipant);
      matches = (await listAll(client, `/tournaments/${req.params.id}/matches.json`)).map((row) =>
        normalizeMatch(row, req.params.id)
      );
    }

    const standings = {};

    participants.forEach((p) => {
      const participant = p.participant;
      standings[participant.id] = {
        id: participant.id,
        name: participant.name,
        wins: 0,
        losses: 0,
        pointsScored: 0,
        pointsAgainst: 0,
      };
    });

    matches.forEach((m) => {
      const match = m.match;
      if (match.state !== 'complete' || !match.player1_id || !match.player2_id) return;

      const parts = String(match.scores_csv || '')
        .split('-')
        .map((n) => Number(String(n).trim()) || 0);

      const p1Score = parts[0] || 0;
      const p2Score = parts[1] || 0;

      if (standings[match.player1_id]) {
        standings[match.player1_id].pointsScored += p1Score;
        standings[match.player1_id].pointsAgainst += p2Score;
      }

      if (standings[match.player2_id]) {
        standings[match.player2_id].pointsScored += p2Score;
        standings[match.player2_id].pointsAgainst += p1Score;
      }

      if (match.winner_id && standings[match.winner_id]) standings[match.winner_id].wins += 1;

      const loserId = Number(match.winner_id) === Number(match.player1_id)
        ? match.player2_id
        : match.player1_id;

      if (loserId && standings[loserId]) standings[loserId].losses += 1;
    });

    res.json(
      Object.values(standings).sort(
        (a, b) =>
          b.wins - a.wins ||
          (b.pointsScored - b.pointsAgainst) - (a.pointsScored - a.pointsAgainst)
      )
    );
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

module.exports = router;
