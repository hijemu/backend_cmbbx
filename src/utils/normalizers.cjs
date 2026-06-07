function normalizeTournament(row) {
  if (row.tournament) return row;

  const attrs = row.attributes || {};
  return {
    tournament: {
      id: Number(row.id),
      name: attrs.name,
      url: attrs.url,
      game_name: attrs.game_name,
      tournament_type: attrs.tournament_type,
      state: attrs.state,
      description: attrs.description,
      created_at: attrs.timestamps?.created_at || attrs.created_at,
      updated_at: attrs.timestamps?.updated_at || attrs.updated_at,
      participants_count: attrs.participants_count || attrs.participant_count || 0,
    },
  };
}

function relationId(row, key) {
  const attrs = row.attributes || row;
  return Number(
    row.relationships?.[key]?.data?.id ||
      attrs.relationships?.[key]?.data?.id ||
      attrs[key + '_id'] ||
      attrs[key]?.id ||
      0
  ) || null;
}

function normalizeMatch(row, tournamentId) {
  if (row.match) return row;

  const attrs = row.attributes || {};
  const points = Array.isArray(attrs.points_by_participant)
    ? attrs.points_by_participant
    : [];

  const p1 = points[0]?.participant_id || null;
  const p2 = points[1]?.participant_id || null;

  return {
    match: {
      id: Number(row.id),
      tournament_id: Number(tournamentId),
      state: attrs.state,
      round: attrs.round,
      identifier: attrs.identifier,
      scores_csv: attrs.scores || attrs.scores_csv || '',
      winner_id: Number(attrs.winner_id || 0) || null,
      player1_id: Number(p1) || relationId(row, 'player1'),
      player2_id: Number(p2) || relationId(row, 'player2'),
      suggested_play_order: attrs.suggested_play_order,
    },
  };
}

function normalizeParticipant(row) {
  if (row.participant) return row;

  const attrs = row.attributes || {};
  return {
    participant: {
      id: Number(row.id),
      name: attrs.name || attrs.display_name || attrs.username || `Participant ${row.id}`,
      seed: attrs.seed,
      final_rank: attrs.final_rank,
      misc: attrs.misc,
    },
  };
}

module.exports = {
  normalizeTournament,
  normalizeMatch,
  normalizeParticipant,
  relationId,
};
