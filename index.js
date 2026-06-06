require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const challonge = axios.create({
  baseURL: 'https://api.challonge.com/v1',
  auth: {
    username: process.env.CHALLONGE_USERNAME,
    password: process.env.CHALLONGE_API_KEY,
  },
});

app.get('/tournaments', async (req, res) => {
  try {
    const response = await challonge.get('/tournaments.json');
    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: 'Failed to fetch tournaments',
      details: err.response?.data || err.message,
    });
  }
});

app.get('/tournaments/:id', async (req, res) => {
  try {

    const response = await challonge.get(
      `/tournaments/${req.params.id}.json`
    );

    res.json(response.data);

  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: err.message,
    });
  }
});

app.get('/tournaments/:id/matches', async (req, res) => {
  try {

    const response = await challonge.get(
      `/tournaments/${req.params.id}/matches.json`
    );

    res.json(response.data);

  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: err.message,
    });
  }
});

app.get('/tournaments/:id/participants', async (req, res) => {
  try {

    const response = await challonge.get(
      `/tournaments/${req.params.id}/participants.json`
    );

    res.json(response.data);

  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: err.message,
    });
  }
});

app.put(
  '/tournaments/:tournamentId/matches/:matchId',
  async (req, res) => {

    try {

      const {
        scores_csv,
        winner_id,
      } = req.body;

      console.log(req.body);

      const response =
        await challonge.put(
          `/tournaments/${req.params.tournamentId}/matches/${req.params.matchId}.json`,
          {
            match: {
              scores_csv,
              winner_id,
            },
          }
        );

      res.json(response.data);

    } catch (err) {

      console.error(
        err.response?.data ||
        err.message
      );

      res.status(
        err.response?.status || 500
      ).json({
        error: err.message,
        details:
          err.response?.data,
      });
    }
  }
);

app.get(
  '/tournaments/:id/standings',
  async (req, res) => {

    try {

      const participantsResponse =
        await challonge.get(
          `/tournaments/${req.params.id}/participants.json`
        );

      const matchesResponse =
        await challonge.get(
          `/tournaments/${req.params.id}/matches.json`
        );

      const participants =
        participantsResponse.data;

      const matches =
        matchesResponse.data;

      const standings = {};

      participants.forEach((p) => {

        const participant =
          p.participant;

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

        if (
          match.state !== 'complete'
        ) {
          return;
        }

        const p1 =
          standings[match.player1_id];

        const p2 =
          standings[match.player2_id];

        if (!p1 || !p2) {
          return;
        }

        const scores =
          match.scores_csv
            ?.split('-')
            .map(Number);

        const p1Score =
          scores?.[0] || 0;

        const p2Score =
          scores?.[1] || 0;

        p1.pointsScored += p1Score;
        p1.pointsAgainst += p2Score;

        p2.pointsScored += p2Score;
        p2.pointsAgainst += p1Score;

        if (
          match.winner_id ===
          match.player1_id
        ) {

          p1.wins += 1;
          p2.losses += 1;

        } else if (
          match.winner_id ===
          match.player2_id
        ) {

          p2.wins += 1;
          p1.losses += 1;
        }
      });

      const sorted =
        Object.values(standings)
          .sort((a, b) => {

            if (b.wins !== a.wins) {
              return b.wins - a.wins;
            }

            return (
              b.pointsScored -
              a.pointsScored
            );
          });

      res.json(sorted);

    } catch (err) {

      console.error(
        err.response?.data ||
        err.message
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

app.listen(3001, () => {
  console.log('Backend running on http://localhost:3001');
});