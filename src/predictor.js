const GROUP_ORDER = "ABCDEFGHIJKL".split("");
const HOST_GROUPS = {
  Mexico: "A",
  Canada: "B",
  "United States": "C"
};
const MAX_GOAL_BUCKET = 7;
const HOST_ATTACK_BONUS = 24;
const HOST_DEFENSE_BONUS = 18;
const BASE_HOME_GOALS = 1.3;
const BASE_AWAY_GOALS = 1.08;
const GOAL_RATING_DIVISOR = 575;
const CONTEXT_LABELS = {
  form: "form",
  squad: "squad",
  injuries: "injuries",
  fatigue: "fatigue",
  chemistry: "chemistry"
};

function createRng(seed = Date.now()) {
  let value = Math.floor(seed) % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }

  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffle(items, rng) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function poisson(lambda, rng) {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let count = 0;

  while (product > threshold) {
    product *= rng();
    count += 1;
  }

  return count - 1;
}

function poissonPmf(lambda, goals) {
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals);
}

function factorial(value) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }
  return result;
}

function sortByStrengthDescending(teams) {
  return [...teams].sort(
    (a, b) => effectiveRating(b) - effectiveRating(a) || b.rating - a.rating || a.name.localeCompare(b.name)
  );
}

function validateTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error("Expected a non-empty array of teams.");
  }

  const names = new Set();

  for (const team of teams) {
    if (names.has(team.name)) {
      throw new Error(`Duplicate team name detected: ${team.name}`);
    }
    names.add(team.name);
  }
}

function hasGroups(teams) {
  return teams.every((team) => typeof team.group === "string" && team.group.length === 1);
}

function finalizeGroupedTeams(teams) {
  const countsByGroup = new Map();

  for (const team of teams) {
    countsByGroup.set(team.group, (countsByGroup.get(team.group) || 0) + 1);
  }

  for (const groupName of GROUP_ORDER) {
    if ((countsByGroup.get(groupName) || 0) !== 4) {
      throw new Error(`Group ${groupName} must contain exactly 4 teams.`);
    }
  }

  return teams;
}

function confedLimit(confederation) {
  return confederation === "UEFA" ? 2 : 1;
}

function canJoinGroup(team, currentGroup) {
  if (currentGroup.length >= 4) {
    return false;
  }

  const sameConfedCount = currentGroup.filter(
    (groupTeam) => groupTeam.confederation === team.confederation
  ).length;

  return sameConfedCount < confedLimit(team.confederation);
}

function createPots(teams) {
  const sorted = sortByStrengthDescending(teams);
  const hosts = Object.keys(HOST_GROUPS)
    .map((hostName) => sorted.find((team) => team.name === hostName))
    .filter(Boolean);
  const hostNames = new Set(hosts.map((team) => team.name));
  const nonHosts = sorted.filter((team) => !hostNames.has(team.name));
  const pot1 = sortByStrengthDescending([...hosts, ...nonHosts.slice(0, 9)]);
  const pot1Names = new Set(pot1.map((team) => team.name));
  const remaining = sorted.filter((team) => !pot1Names.has(team.name));

  return [
    pot1,
    remaining.slice(0, 12),
    remaining.slice(12, 24),
    remaining.slice(24, 36)
  ];
}

function createProvisionalGroups(teams) {
  const groups = new Map(GROUP_ORDER.map((groupName) => [groupName, []]));
  const assigned = new Set();

  for (const [hostName, groupName] of Object.entries(HOST_GROUPS)) {
    const host = teams.find((team) => team.name === hostName);
    if (host) {
      groups.get(groupName).push({ ...host, group: groupName });
      assigned.add(host.name);
    }
  }

  const pots = createPots(teams);

  for (let potIndex = 0; potIndex < pots.length; potIndex += 1) {
    const expectedGroupSize = potIndex + 1;
    const pendingTeams = pots[potIndex].filter((team) => !assigned.has(team.name));

    while (pendingTeams.length > 0) {
      const withCandidates = pendingTeams.map((team) => {
        const candidates = GROUP_ORDER.filter((groupName) => {
          const currentGroup = groups.get(groupName);
          return currentGroup.length < expectedGroupSize && canJoinGroup(team, currentGroup);
        });

        return { team, candidates };
      });

      withCandidates.sort((left, right) => {
        return (
          left.candidates.length - right.candidates.length ||
          right.team.rating - left.team.rating ||
          left.team.name.localeCompare(right.team.name)
        );
      });

      const next = withCandidates[0];
      if (!next || next.candidates.length === 0) {
        throw new Error("Could not create provisional groups with the current constraints.");
      }

      const targetGroupName = next.candidates.sort((left, right) => {
        const leftGroup = groups.get(left);
        const rightGroup = groups.get(right);
        return (
          leftGroup.length - rightGroup.length ||
          leftGroup.filter((team) => team.confederation === next.team.confederation).length -
            rightGroup.filter((team) => team.confederation === next.team.confederation).length ||
          left.localeCompare(right)
        );
      })[0];

      groups.get(targetGroupName).push({ ...next.team, group: targetGroupName });
      assigned.add(next.team.name);

      const index = pendingTeams.findIndex((team) => team.name === next.team.name);
      pendingTeams.splice(index, 1);
    }
  }

  return finalizeGroupedTeams(
    GROUP_ORDER.flatMap((groupName) => sortByStrengthDescending(groups.get(groupName)))
  );
}

function normalizeTeams(teams) {
  return hasGroups(teams) ? finalizeGroupedTeams(teams) : createProvisionalGroups(teams);
}

function getContextAdjustments(team) {
  const adjustments = team.adjustments || {};
  return {
    form: Number(adjustments.form || 0),
    squad: Number(adjustments.squad || 0),
    injuries: Number(adjustments.injuries || 0),
    fatigue: Number(adjustments.fatigue || 0),
    chemistry: Number(adjustments.chemistry || 0)
  };
}

function contextTotal(team) {
  const adjustments = getContextAdjustments(team);
  return adjustments.form + adjustments.squad + adjustments.injuries + adjustments.fatigue + adjustments.chemistry;
}

function explicitRating(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function derivedAttackRating(team) {
  const explicit = explicitRating(team.attackRating);
  if (explicit !== null) {
    return explicit;
  }

  const adjustments = getContextAdjustments(team);
  return (
    team.rating +
    adjustments.form * 0.7 +
    adjustments.squad * 0.45 +
    adjustments.chemistry * 0.4 +
    adjustments.injuries * 0.15 +
    adjustments.fatigue * 0.1
  );
}

function derivedDefenseRating(team) {
  const explicit = explicitRating(team.defenseRating);
  if (explicit !== null) {
    return explicit;
  }

  const adjustments = getContextAdjustments(team);
  return (
    team.rating +
    adjustments.form * 0.3 +
    adjustments.squad * 0.35 +
    adjustments.chemistry * 0.45 +
    adjustments.injuries * 0.7 +
    adjustments.fatigue * 0.35
  );
}

function effectiveRating(team) {
  return (derivedAttackRating(team) + derivedDefenseRating(team)) / 2;
}

function describeContext(team) {
  const adjustments = getContextAdjustments(team);
  const entries = Object.entries(adjustments)
    .filter(([, value]) => value !== 0)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .map(([key, value]) => `${value > 0 ? "+" : ""}${value} ${CONTEXT_LABELS[key]}`);

  if (team.host) {
    entries.unshift(`+${HOST_ATTACK_BONUS}/${HOST_DEFENSE_BONUS} host attack/defense`);
  }

  return entries.length ? entries : ["no extra modifiers"];
}

function teamStrength(team) {
  return (attackStrength(team) + defenseStrength(team)) / 2;
}

function attackStrength(team) {
  return derivedAttackRating(team) + (team.host ? HOST_ATTACK_BONUS : 0);
}

function defenseStrength(team) {
  return derivedDefenseRating(team) + (team.host ? HOST_DEFENSE_BONUS : 0);
}

function enrichTeams(teams) {
  return teams.map((team) => ({
    ...team,
    context: getContextAdjustments(team),
    adjustedRating: effectiveRating(team),
    adjustedAttackRating: attackStrength(team),
    adjustedDefenseRating: defenseStrength(team)
  }));
}

function expectedResult(teamA, teamB) {
  const delta = teamStrength(teamA) - teamStrength(teamB);
  return 1 / (1 + Math.pow(10, -delta / 400));
}

function goalExpectancy(teamA, teamB) {
  const attackVsDefenseA = (attackStrength(teamA) - defenseStrength(teamB)) / GOAL_RATING_DIVISOR;
  const attackVsDefenseB = (attackStrength(teamB) - defenseStrength(teamA)) / GOAL_RATING_DIVISOR;
  const expectation = expectedResult(teamA, teamB);
  const paceAdjustment = 1 + Math.abs(expectation - 0.5) * 0.14;
  const home = BASE_HOME_GOALS * Math.exp(attackVsDefenseA) * paceAdjustment;
  const away = BASE_AWAY_GOALS * Math.exp(attackVsDefenseB) * paceAdjustment;

  return {
    home: clamp(home, 0.2, 3.9),
    away: clamp(away, 0.15, 3.4)
  };
}

function poissonBuckets(lambda, maxBucket = MAX_GOAL_BUCKET) {
  const values = [];
  let cumulative = 0;

  for (let goals = 0; goals < maxBucket; goals += 1) {
    const probability = poissonPmf(lambda, goals);
    values.push(probability);
    cumulative += probability;
  }

  values.push(Math.max(0, 1 - cumulative));
  return values;
}

function buildMatchForecast(teamA, teamB, knockout = false) {
  const xg = goalExpectancy(teamA, teamB);
  const homeBuckets = poissonBuckets(xg.home);
  const awayBuckets = poissonBuckets(xg.away);
  let teamAWin = 0;
  let draw = 0;
  let teamBWin = 0;
  let mostLikelyScore = {
    goalsA: 0,
    goalsB: 0,
    probability: 0
  };

  for (let goalsA = 0; goalsA < homeBuckets.length; goalsA += 1) {
    for (let goalsB = 0; goalsB < awayBuckets.length; goalsB += 1) {
      const probability = homeBuckets[goalsA] * awayBuckets[goalsB];
      if (probability > mostLikelyScore.probability) {
        mostLikelyScore = { goalsA, goalsB, probability };
      }
      if (goalsA > goalsB) {
        teamAWin += probability;
      } else if (goalsB > goalsA) {
        teamBWin += probability;
      } else {
        draw += probability;
      }
    }
  }

  const penaltiesEdge = expectedResult(teamA, teamB);
  const ratingGap = teamStrength(teamA) - teamStrength(teamB);
  const edgeTeam = ratingGap >= 0 ? teamA : teamB;
  const edgeAmount = Math.abs(ratingGap);
  const edgeReasons = describeContext(edgeTeam);

  return {
    teamA: teamA.name,
    teamB: teamB.name,
    xgA: xg.home,
    xgB: xg.away,
    adjustedRatingA: effectiveRating(teamA),
    adjustedRatingB: effectiveRating(teamB),
    attackRatingA: attackStrength(teamA),
    attackRatingB: attackStrength(teamB),
    defenseRatingA: defenseStrength(teamA),
    defenseRatingB: defenseStrength(teamB),
    contextA: describeContext(teamA),
    contextB: describeContext(teamB),
    edgeSummary:
      edgeAmount < 25
        ? "Near-even matchup after team context adjustments"
        : `${edgeTeam.name} carries a ${Math.round(edgeAmount)}-point edge after adjustments`,
    edgeReasons,
    predictedScoreA: mostLikelyScore.goalsA,
    predictedScoreB: mostLikelyScore.goalsB,
    teamAWin,
    draw,
    teamBWin,
    teamAAdvance: knockout ? teamAWin + draw * penaltiesEdge : null,
    teamBAdvance: knockout ? teamBWin + draw * (1 - penaltiesEdge) : null
  };
}

function simulateMatch(teamA, teamB, rng, knockout = false) {
  const xg = goalExpectancy(teamA, teamB);
  const forecast = buildMatchForecast(teamA, teamB, knockout);
  let goalsA = poisson(xg.home, rng);
  let goalsB = poisson(xg.away, rng);
  let winner = null;
  let decidedBy = "normal";

  if (knockout && goalsA === goalsB) {
    decidedBy = "pens";
    winner = rng() < forecast.teamAAdvance ? teamA : teamB;

    if (winner === teamA) {
      goalsA += 1;
    } else {
      goalsB += 1;
    }
  } else if (goalsA > goalsB) {
    winner = teamA;
  } else if (goalsB > goalsA) {
    winner = teamB;
  }

  return {
    teamA: teamA.name,
    teamB: teamB.name,
    goalsA,
    goalsB,
    winner: winner ? winner.name : null,
    decidedBy
  };
}

function groupTeams(teams) {
  const groups = new Map();
  for (const team of teams) {
    if (!groups.has(team.group)) {
      groups.set(team.group, []);
    }
    groups.get(team.group).push(team);
  }
  return groups;
}

function initTable(team) {
  return {
    name: team.name,
    group: team.group,
    rating: team.rating,
    points: 0,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0
  };
}

function compareTables(a, b) {
  return (
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    b.wins - a.wins ||
    b.rating - a.rating ||
    a.name.localeCompare(b.name)
  );
}

function buildGroupMatchForecasts(teams) {
  const grouped = groupTeams(teams);
  const forecasts = [];

  for (const groupName of GROUP_ORDER) {
    const teamsInGroup = grouped.get(groupName) || [];
    for (let index = 0; index < teamsInGroup.length; index += 1) {
      for (let inner = index + 1; inner < teamsInGroup.length; inner += 1) {
        forecasts.push({
          group: groupName,
          ...buildMatchForecast(teamsInGroup[index], teamsInGroup[inner], false)
        });
      }
    }
  }

  return forecasts.sort((a, b) => {
    const certaintyA = Math.max(a.teamAWin, a.teamBWin);
    const certaintyB = Math.max(b.teamAWin, b.teamBWin);
    return certaintyA - certaintyB || a.group.localeCompare(b.group);
  });
}

function simulateGroupStage(teams, rng) {
  const grouped = groupTeams(teams);
  const standings = [];
  const matches = [];

  for (const groupName of GROUP_ORDER) {
    const teamsInGroup = grouped.get(groupName) || [];
    const table = new Map(teamsInGroup.map((team) => [team.name, initTable(team)]));

    for (let index = 0; index < teamsInGroup.length; index += 1) {
      for (let inner = index + 1; inner < teamsInGroup.length; inner += 1) {
        const teamA = teamsInGroup[index];
        const teamB = teamsInGroup[inner];
        const result = simulateMatch(teamA, teamB, rng, false);
        matches.push({ group: groupName, ...result });

        const rowA = table.get(teamA.name);
        const rowB = table.get(teamB.name);
        rowA.played += 1;
        rowB.played += 1;
        rowA.goalsFor += result.goalsA;
        rowA.goalsAgainst += result.goalsB;
        rowB.goalsFor += result.goalsB;
        rowB.goalsAgainst += result.goalsA;

        if (result.goalsA > result.goalsB) {
          rowA.wins += 1;
          rowA.points += 3;
          rowB.losses += 1;
        } else if (result.goalsB > result.goalsA) {
          rowB.wins += 1;
          rowB.points += 3;
          rowA.losses += 1;
        } else {
          rowA.draws += 1;
          rowB.draws += 1;
          rowA.points += 1;
          rowB.points += 1;
        }
      }
    }

    const ordered = [...table.values()]
      .map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
      .sort(compareTables);

    standings.push({ group: groupName, table: ordered });
  }

  const groupWinners = standings.map((group) => ({ ...group.table[0], finish: 1 }));
  const groupRunnersUp = standings.map((group) => ({ ...group.table[1], finish: 2 }));
  const thirdPlaced = standings
    .map((group) => ({ ...group.table[2], finish: 3 }))
    .sort(compareTables)
    .slice(0, 8);

  return {
    matches,
    standings,
    qualifiers: {
      winners: groupWinners,
      runnersUp: groupRunnersUp,
      thirds: thirdPlaced
    }
  };
}

function rankQualifiedTeams(teams) {
  return [...teams].sort(compareTables);
}

function pairRoundOf32(qualifiers) {
  const winners = rankQualifiedTeams(qualifiers.winners);
  const runners = [...qualifiers.runnersUp].sort((a, b) => compareTables(a, b)).reverse();
  const thirds = rankQualifiedTeams(qualifiers.thirds);
  const priorityOpponents = [...thirds, ...runners];
  const usedOpponents = new Set();
  const pairs = [];

  for (const winner of winners) {
    const opponent = priorityOpponents.find((candidate) => {
      if (usedOpponents.has(candidate.name)) {
        return false;
      }
      return candidate.group !== winner.group;
    });

    if (!opponent) {
      continue;
    }

    usedOpponents.add(opponent.name);
    pairs.push([winner, opponent]);
  }

  const leftovers = [
    ...qualifiers.winners.filter((team) => !pairs.some((pair) => pair[0].name === team.name)),
    ...priorityOpponents.filter((team) => !usedOpponents.has(team.name))
  ];
  const seededLeftovers = rankQualifiedTeams(leftovers);

  while (seededLeftovers.length > 1) {
    pairs.push([seededLeftovers.shift(), seededLeftovers.pop()]);
  }

  return pairs.slice(0, 16);
}

function simulateKnockoutRound(pairs, teamMap, rng, roundName) {
  const matches = [];
  const winners = [];

  for (const [left, right] of pairs) {
    const teamA = teamMap.get(left.name);
    const teamB = teamMap.get(right.name);
    const result = simulateMatch(teamA, teamB, rng, true);
    matches.push({ round: roundName, ...result });
    winners.push(teamMap.get(result.winner));
  }

  return { matches, winners };
}

function pairSequential(teams) {
  const pairs = [];
  for (let index = 0; index < teams.length; index += 2) {
    pairs.push([teams[index], teams[index + 1]]);
  }
  return pairs;
}

function simulateTournament(teams, rng) {
  const teamMap = new Map(teams.map((team) => [team.name, team]));
  const groupStage = simulateGroupStage(teams, rng);
  const roundOf32Pairs = pairRoundOf32(groupStage.qualifiers);
  const roundOf32 = simulateKnockoutRound(roundOf32Pairs, teamMap, rng, "Round of 32");
  const roundOf16 = simulateKnockoutRound(pairSequential(roundOf32.winners), teamMap, rng, "Round of 16");
  const quarterFinals = simulateKnockoutRound(pairSequential(roundOf16.winners), teamMap, rng, "Quarter-finals");
  const semiFinals = simulateKnockoutRound(pairSequential(quarterFinals.winners), teamMap, rng, "Semi-finals");
  const final = simulateKnockoutRound(pairSequential(semiFinals.winners), teamMap, rng, "Final");

  return {
    standings: groupStage.standings,
    qualifiers: groupStage.qualifiers,
    groupMatches: groupStage.matches,
    knockout: {
      roundOf32: roundOf32.matches,
      roundOf16: roundOf16.matches,
      quarterFinals: quarterFinals.matches,
      semiFinals: semiFinals.matches,
      final: final.matches
    },
    champion: final.winners[0].name
  };
}

function blankRecord() {
  return {
    finish1: 0,
    finish2: 0,
    finish3: 0,
    finish4: 0,
    groupWin: 0,
    advanceFromGroup: 0,
    roundOf32: 0,
    roundOf16: 0,
    quarterFinals: 0,
    semiFinals: 0,
    final: 0,
    champion: 0,
    totalPoints: 0,
    totalGoalDifference: 0
  };
}

function groupProjectionRows(normalizedTeams, summary, simulationCount) {
  const grouped = groupTeams(normalizedTeams);

  return GROUP_ORDER.map((groupName) => {
    const teams = sortByStrengthDescending(grouped.get(groupName) || []).map((team) => {
      const record = summary.get(team.name);
      return {
        team: team.name,
        rating: team.rating,
        adjustedRating: effectiveRating(team),
        adjustedAttackRating: attackStrength(team),
        adjustedDefenseRating: defenseStrength(team),
        context: describeContext(team),
        groupWin: record.groupWin / simulationCount,
        top2: (record.finish1 + record.finish2) / simulationCount,
        bestThird: record.finish3 / simulationCount,
        advance: record.advanceFromGroup / simulationCount,
        averagePoints: record.totalPoints / simulationCount,
        averageGoalDifference: record.totalGoalDifference / simulationCount
      };
    });

    teams.sort((a, b) => b.advance - a.advance || b.groupWin - a.groupWin || b.rating - a.rating);
    return { group: groupName, teams };
  });
}

function runSimulations(teams, simulationCount = 2000, seed = 20260611) {
  validateTeams(teams);
  const normalizedTeams = enrichTeams(normalizeTeams(teams));
  const rng = createRng(seed);
  const summary = new Map(normalizedTeams.map((team) => [team.name, blankRecord()]));
  let latestTournament = null;

  for (let run = 0; run < simulationCount; run += 1) {
    const tournament = simulateTournament(shuffle(normalizedTeams, rng), rng);
    latestTournament = tournament;

    for (const group of tournament.standings) {
      for (let position = 0; position < group.table.length; position += 1) {
        const team = group.table[position];
        const record = summary.get(team.name);
        record[`finish${position + 1}`] += 1;
        record.totalPoints += team.points;
        record.totalGoalDifference += team.goalDifference;
      }

      const winner = group.table[0].name;
      summary.get(winner).groupWin += 1;
      summary.get(group.table[0].name).advanceFromGroup += 1;
      summary.get(group.table[1].name).advanceFromGroup += 1;
    }

    for (const team of tournament.qualifiers.thirds) {
      summary.get(team.name).advanceFromGroup += 1;
    }

    const roundOf32Teams = new Set(
      tournament.knockout.roundOf32.flatMap((match) => [match.teamA, match.teamB])
    );
    for (const teamName of roundOf32Teams) {
      summary.get(teamName).roundOf32 += 1;
    }

    for (const match of tournament.knockout.roundOf32) {
      summary.get(match.winner).roundOf16 += 1;
    }
    for (const match of tournament.knockout.roundOf16) {
      summary.get(match.winner).quarterFinals += 1;
    }
    for (const match of tournament.knockout.quarterFinals) {
      summary.get(match.winner).semiFinals += 1;
    }
    for (const match of tournament.knockout.semiFinals) {
      summary.get(match.winner).final += 1;
    }
    for (const match of tournament.knockout.final) {
      summary.get(match.winner).champion += 1;
    }
  }

  const probabilities = normalizedTeams
    .map((team) => {
      const record = summary.get(team.name);
      return {
        team: team.name,
        group: team.group,
        rating: team.rating,
        adjustedRating: effectiveRating(team),
        adjustedAttackRating: attackStrength(team),
        adjustedDefenseRating: defenseStrength(team),
        context: describeContext(team),
        finish1: record.finish1 / simulationCount,
        finish2: record.finish2 / simulationCount,
        finish3: record.finish3 / simulationCount,
        finish4: record.finish4 / simulationCount,
        groupWin: record.groupWin / simulationCount,
        advanceFromGroup: record.advanceFromGroup / simulationCount,
        averagePoints: record.totalPoints / simulationCount,
        averageGoalDifference: record.totalGoalDifference / simulationCount,
        reachRoundOf32: record.roundOf32 / simulationCount,
        reachRoundOf16: record.roundOf16 / simulationCount,
        reachQuarterFinals: record.quarterFinals / simulationCount,
        reachSemiFinals: record.semiFinals / simulationCount,
        reachFinal: record.final / simulationCount,
        winTournament: record.champion / simulationCount
      };
    })
    .sort((a, b) => b.winTournament - a.winTournament || b.reachFinal - a.reachFinal);

  return {
    assumptions: {
      format: "48 teams, 12 groups of 4, top 2 plus best 8 third-placed teams",
      groups: hasGroups(teams)
        ? "Using provided group assignments"
        : "Using a provisional auto-draw from ratings, hosts, and confederation limits",
      knockoutSeeding: "Approximate round-of-32 seeding that favors group winners and avoids same-group pairings where possible",
      matchModel: "Attack-vs-defense Poisson scoring with analytical win/draw/loss estimates, context modifiers, and split host boost"
    },
    probabilities,
    groupProjections: groupProjectionRows(normalizedTeams, summary, simulationCount),
    groupMatchForecasts: buildGroupMatchForecasts(normalizedTeams),
    latestTournament
  };
}

module.exports = {
  GROUP_ORDER,
  runSimulations
};
