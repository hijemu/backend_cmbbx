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
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    const {
      name,
      url,
      tournament_type,
      game_name,
      description,
      tie_breaks,
      ranking,
      finals_cut,
      swiss_rounds,
      round_robin_iterations,
    } = req.body || {};

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    const isSwissToSingleElim = tournament_type === 'swiss_single_elim';
    const isRoundRobinToSingleElim =
      tournament_type === 'round_robin_single_elim';

    const isTwoStage = isSwissToSingleElim || isRoundRobinToSingleElim;

    const groupStageType = isSwissToSingleElim
      ? 'swiss'
      : isRoundRobinToSingleElim
        ? 'round robin'
        : null;

    const challongeTournamentType = isTwoStage
      ? 'single elimination'
      : tournament_type;

    const safeSwissRounds = Math.max(
      1,
      Math.min(Number(swiss_rounds) || 5, 20)
    );

    const safeRoundRobinIterations = Math.max(
      1,
      Math.min(Number(round_robin_iterations) || 1, 3)
    );

    const safeFinalsCut = [4, 8, 16].includes(Number(finals_cut))
      ? Number(finals_cut)
      : 8;

    const defaultTieBreaks = [
      'points difference',
      'points scored',
      'median buchholz',
    ];

    const allowedTieBreaks = [
      'points difference',
      'points scored',
      'median buchholz',
    ];

    const selectedTieBreaks =
      Array.isArray(tie_breaks) && tie_breaks.length > 0
        ? tie_breaks.filter((tb) => allowedTieBreaks.includes(tb))
        : defaultTieBreaks;

    const finalTieBreaks =
      selectedTieBreaks.length > 0 ? selectedTieBreaks : defaultTieBreaks;

    const twoStageMeta = isTwoStage
      ? {
        enabled: true,
        original_type: tournament_type,
        stage1_type: groupStageType,
        stage2_type: 'single elimination',
        finals_cut: safeFinalsCut,
      }
      : null;

    const safeDescription = String(description || '').trim();

    const descriptionWithMeta = twoStageMeta
      ? `${safeDescription}\n\n[BBX_TWO_STAGE:${JSON.stringify(twoStageMeta)}]`
      : safeDescription;

    if (mode === 'v1') {
      const response = await client.post('/tournaments.json', {
        tournament: {
          name,
          url,
          tournament_type: challongeTournamentType,
          game_name,
          description: descriptionWithMeta,
        },
      });

      return res.json(response.data);
    }

    const attributes = {
      name,
      url,
      tournament_type: challongeTournamentType,
      game_name,
      description: descriptionWithMeta,
    };

    if (isTwoStage) {
      attributes.group_stage_enabled = true;

      attributes.group_stage_options = {
        stage_type: groupStageType,
        group_size: 999,
        participant_count_to_advance_per_group: safeFinalsCut,
      };

      if (groupStageType === 'round robin') {
        attributes.group_stage_options.round_robin_options = {
          ranking: ranking || 'match wins',
          iterations: safeRoundRobinIterations,
          pts_for_match_win: 1,
          pts_for_match_tie: 0.5,
          pts_for_game_win: 0,
          pts_for_game_tie: 0,
        };

        attributes.group_stage_options.tie_breaks = finalTieBreaks;
      }

      if (groupStageType === 'swiss') {
        attributes.group_stage_options.swiss_options = {
          rounds: safeSwissRounds,
          pts_for_bye: 1,
          pts_for_match_win: 1,
          pts_for_match_tie: 0.5,
          pts_for_game_win: 0,
          pts_for_game_tie: 0,
        };

        attributes.group_stage_options.tie_breaks = finalTieBreaks;
      }
    }

    if (!isTwoStage && challongeTournamentType === 'round robin') {
      attributes.round_robin_options = {
        ranking: ranking || 'match wins',
        iterations: safeRoundRobinIterations,
        pts_for_match_win: 1,
        pts_for_match_tie: 0.5,
        pts_for_game_win: 0,
        pts_for_game_tie: 0,
      };

      attributes.tie_breaks = finalTieBreaks;
    }

    if (!isTwoStage && challongeTournamentType === 'swiss') {
      attributes.swiss_options = {
        rounds: safeSwissRounds,
        pts_for_bye: 1,
        pts_for_match_win: 1,
        pts_for_match_tie: 0.5,
        pts_for_game_win: 0,
        pts_for_game_tie: 0,
      };

      attributes.tie_breaks = finalTieBreaks;
    }

    console.log(
      'CREATE TOURNAMENT PAYLOAD:',
      JSON.stringify(
        {
          data: {
            type: 'tournament',
            attributes,
          },
        },
        null,
        2
      )
    );

    const response = await client.post('/tournaments.json', {
      data: {
        type: 'tournament',
        attributes,
      },
    });

    const normalized = normalizeTournament(response.data.data);

    res.json({
      ...normalized,
      two_stage: twoStageMeta,
    });
  } catch (err) {
    console.log(
      'CREATE TOURNAMENT ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    const response = await client.get(`/tournaments/${req.params.id}.json`);

    if (mode === 'v1') return res.json(response.data);

    const data = response.data?.data;
    const attrs = data?.attributes || {};

    res.json({
      id: Number(data?.id),
      type: data?.type,

      ...attrs,

      relationships: data?.relationships || {},
      included: response.data?.included || [],
      links: data?.links || {},

      raw: response.data,
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.put('/:id/tiebreaks', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      return res.status(400).json({
        error: 'Tie breaks are only supported in Challonge v2 OAuth mode.',
      });
    }

    const {
      ranking = 'match wins',
      tie_breaks = [
        'points difference',
        'points scored',
        'median buchholz',
      ],
    } = req.body || {};

    const current = await client.get(`/tournaments/${req.params.id}.json`);
    const attrs = current.data?.data?.attributes || {};
    const type = attrs.tournament_type;

    const updateAttrs = {
      tie_breaks,
    };

    if (type === 'round robin') {
      updateAttrs.round_robin_options = {
        ...(attrs.round_robin_options || {}),
        ranking,
      };
    }

    if (type === 'swiss') {
      updateAttrs.swiss_options = {
        ...(attrs.swiss_options || {}),
      };
    }

    const response = await client.put(`/tournaments/${req.params.id}.json`, {
      data: {
        type: 'tournament',
        attributes: updateAttrs,
      },
    });

    res.json({
      success: true,
      tournament: response.data?.data,
    });
  } catch (err) {
    console.log(
      'UPDATE TIEBREAKS ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
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
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
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
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.post('/:id/participants', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    const { name, seed, misc } = req.body || {};

    if (!name) return res.status(400).json({ error: 'name is required' });

    if (mode === 'v1') {
      const response = await client.post(`/tournaments/${req.params.id}/participants.json`, {
        participant: { name, seed, misc },
      });

      return res.json(response.data);
    }

    const response = await client.post(`/tournaments/${req.params.id}/participants.json`, {
      data: {
        type: 'participant',
        attributes: { name, seed, misc },
      },
    });

    res.json(normalizeParticipant(response.data.data));
  } catch (err) {
    console.log('CREATE PARTICIPANT ERROR:', JSON.stringify(err.response?.data, null, 2));
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.post('/:id/participants/bulk', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);
    const { names } = req.body || {};

    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'names array is required' });
    }

    const cleanNames = names.map((name) => String(name || '').trim()).filter(Boolean);

    if (cleanNames.length === 0) {
      return res.status(400).json({ error: 'No valid participant names.' });
    }

    const created = [];

    for (const name of cleanNames) {
      if (mode === 'v1') {
        const response = await client.post(`/tournaments/${req.params.id}/participants.json`, {
          participant: { name },
        });
        created.push(response.data);
      } else {
        const response = await client.post(`/tournaments/${req.params.id}/participants.json`, {
          data: {
            type: 'participant',
            attributes: { name },
          },
        });
        created.push(normalizeParticipant(response.data.data));
      }
    }

    res.json({
      success: true,
      count: created.length,
      participants: created,
    });
  } catch (err) {
    console.log('BULK CREATE PARTICIPANTS ERROR:', JSON.stringify(err.response?.data, null, 2));
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.post('/:id/participants/shuffle', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.post(`/tournaments/${req.params.id}/participants/randomize.json`);
      return res.json(response.data);
    }

    const rows = await listAll(client, `/tournaments/${req.params.id}/participants.json`);
    const participants = rows.map(normalizeParticipant).map((row) => row.participant);

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const updated = [];

    for (let index = 0; index < shuffled.length; index += 1) {
      const participant = shuffled[index];
      const seed = index + 1;

      const response = await client.put(`/tournaments/${req.params.id}/participants/${participant.id}.json`, {
        data: {
          type: 'participant',
          attributes: { seed },
        },
      });

      updated.push(normalizeParticipant(response.data.data));
    }

    res.json({
      success: true,
      count: updated.length,
      participants: updated,
    });
  } catch (err) {
    console.log('SHUFFLE ERROR:', err.response?.status, JSON.stringify(err.response?.data, null, 2));
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      const response = await client.post(`/tournaments/${req.params.id}/start.json`);
      return res.json(response.data);
    }

    let response;

    try {
      response = await client.put(`/tournaments/${req.params.id}/change_state.json`, {
        data: {
          type: 'TournamentState',
          attributes: {
            state: 'start',
          },
        },
      });
    } catch (err) {
      const detail = JSON.stringify(err.response?.data || {});

      if (detail.includes('group stage')) {
        response = await client.put(`/tournaments/${req.params.id}/change_state.json`, {
          data: {
            type: 'TournamentState',
            attributes: {
              state: 'start_group_stage',
            },
          },
        });
      } else {
        throw err;
      }
    }

    return res.json({
      success: true,
      status: response.status,
      data: response.data || {},
    });
  } catch (err) {
    console.log(
      'START ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
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
      `/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`,
      body
    );

    res.json(normalizeMatch(response.data.data, req.params.tournamentId));
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
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

      if (match.winner_id && standings[match.winner_id]) {
        standings[match.winner_id].wins += 1;
      }

      const loserId =
        Number(match.winner_id) === Number(match.player1_id)
          ? match.player2_id
          : match.player1_id;

      if (loserId && standings[loserId]) {
        standings[loserId].losses += 1;
      }
    });

    res.json(
      Object.values(standings).sort(
        (a, b) =>
          b.wins - a.wins ||
          b.pointsScored - b.pointsAgainst - (a.pointsScored - a.pointsAgainst)
      )
    );
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data,
    });
  }
});

router.get('/:id/debug', requireAuth, async (req, res) => {
  try {
    const { client } = await legacyOrV2Client(req.user.id);

    const response = await client.get(
      `/tournaments/${req.params.id}.json`
    );

    console.log(
      JSON.stringify(response.data, null, 2)
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json(err.response?.data || err.message);
  }
});

router.post('/:id/start-group-stage', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      return res.status(400).json({
        error: 'Group stage actions require Challonge v2 OAuth mode.',
      });
    }

    const response = await client.put(
      `/tournaments/${req.params.id}/change_state.json`,
      {
        data: {
          type: 'TournamentState',
          attributes: {
            state: 'start_group_stage',
          },
        },
      }
    );

    return res.json({
      success: true,
      status: response.status,
      data: response.data || {},
    });
  } catch (err) {
    console.log(
      'START GROUP STAGE ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
  }
});

router.post('/:id/finalize-group-stage', requireAuth, async (req, res) => {
  try {
    const { mode, client } = await legacyOrV2Client(req.user.id);

    if (mode === 'v1') {
      return res.status(400).json({
        error: 'Group stage actions require Challonge v2 OAuth mode.',
      });
    }

    const response = await client.put(
      `/tournaments/${req.params.id}/change_state.json`,
      {
        data: {
          type: 'TournamentState',
          attributes: {
            state: 'finalize_group_stage',
          },
        },
      }
    );

    return res.json({
      success: true,
      status: response.status,
      data: response.data || {},
    });
  } catch (err) {
    console.log(
      'FINALIZE GROUP STAGE ERROR:',
      err.response?.status,
      JSON.stringify(err.response?.data || {}, null, 2)
    );

    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
  }
});

module.exports = router;