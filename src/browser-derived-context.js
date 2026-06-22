(function attachDerivedContext(globalScope) {
  const FORM_LOOKBACK = 5;
  const FORM_GOAL_DIFF_WEIGHT = 4;
  const FORM_RESULT_WEIGHT = 6;
  const FORM_MAX = 28;

  const REST_BASELINE_DAYS = 4;
  const REST_PER_DAY = 1.6;
  const REST_MAX = 12;

  const H2H_LOOKBACK = 6;
  const H2H_HALF_LIFE_YEARS = 3;
  const H2H_PER_RESULT = 5;
  const H2H_PER_GOAL_DIFF = 1.5;
  const H2H_MAX = 22;

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(later, earlier) {
    return Math.round((later.getTime() - earlier.getTime()) / 86400000);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function teamMatchesFromResults(results, teamName) {
    if (!Array.isArray(results)) return [];
    return results
      .filter((row) => row && (row.teamA === teamName || row.teamB === teamName))
      .map((row) => {
        const isA = row.teamA === teamName;
        const goalsFor = isA ? Number(row.scoreA) : Number(row.scoreB);
        const goalsAgainst = isA ? Number(row.scoreB) : Number(row.scoreA);
        const date = parseDate(row.date);
        let result = "D";
        if (goalsFor > goalsAgainst) result = "W";
        else if (goalsFor < goalsAgainst) result = "L";
        return { date, goalsFor, goalsAgainst, result };
      })
      .filter((row) => row.date && Number.isFinite(row.goalsFor) && Number.isFinite(row.goalsAgainst))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  function deriveFormAdjustment(results, teamName) {
    const recent = teamMatchesFromResults(results, teamName).slice(0, FORM_LOOKBACK);
    if (recent.length === 0) return 0;

    let score = 0;
    for (const match of recent) {
      const goalDiff = clamp(match.goalsFor - match.goalsAgainst, -3, 3);
      score += goalDiff * FORM_GOAL_DIFF_WEIGHT;
      if (match.result === "W") score += FORM_RESULT_WEIGHT;
      else if (match.result === "L") score -= FORM_RESULT_WEIGHT;
    }

    const normalised = score / recent.length;
    return Math.round(clamp(normalised, -FORM_MAX, FORM_MAX));
  }

  function lastPlayedDate(results, teamName) {
    const matches = teamMatchesFromResults(results, teamName);
    return matches.length ? matches[0].date : null;
  }

  function nextFixtureDate(fixtures, teamName, asOfDate) {
    if (!Array.isArray(fixtures) || !asOfDate) return null;
    const candidates = fixtures
      .filter((fixture) => fixture && (fixture.teamA === teamName || fixture.teamB === teamName))
      .map((fixture) => parseDate(fixture.date))
      .filter((date) => date && date.getTime() >= asOfDate.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    return candidates[0] || null;
  }

  function computeRestAdjustment(results, fixtures, teamName, asOfIso) {
    const asOf = parseDate(asOfIso);
    if (!asOf) return 0;
    const lastPlayed = lastPlayedDate(results, teamName);
    const nextDate = nextFixtureDate(fixtures, teamName, asOf);
    if (!lastPlayed || !nextDate) return 0;
    const days = daysBetween(nextDate, lastPlayed);
    if (!Number.isFinite(days)) return 0;
    const delta = (days - REST_BASELINE_DAYS) * REST_PER_DAY;
    return Math.round(clamp(delta, -REST_MAX, REST_MAX));
  }

  function computeH2HBias(historicalResults, teamA, teamB, asOfIso) {
    if (!Array.isArray(historicalResults) || historicalResults.length === 0) return 0;
    const asOf = parseDate(asOfIso) || new Date();

    const matches = historicalResults
      .filter((row) => {
        if (!row) return false;
        return (
          (row.teamA === teamA && row.teamB === teamB) ||
          (row.teamA === teamB && row.teamB === teamA)
        );
      })
      .map((row) => {
        const date = parseDate(row.date);
        if (!date) return null;
        const isAHome = row.teamA === teamA;
        const goalsForA = isAHome ? Number(row.scoreA) : Number(row.scoreB);
        const goalsForB = isAHome ? Number(row.scoreB) : Number(row.scoreA);
        if (!Number.isFinite(goalsForA) || !Number.isFinite(goalsForB)) return null;
        return { date, goalsForA, goalsForB };
      })
      .filter(Boolean)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, H2H_LOOKBACK);

    if (matches.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const match of matches) {
      const yearsAgo = Math.max(0, (asOf.getTime() - match.date.getTime()) / (365.25 * 86400000));
      const weight = Math.pow(0.5, yearsAgo / H2H_HALF_LIFE_YEARS);
      const goalDiff = clamp(match.goalsForA - match.goalsForB, -4, 4);
      let resultPoints = 0;
      if (match.goalsForA > match.goalsForB) resultPoints = H2H_PER_RESULT;
      else if (match.goalsForA < match.goalsForB) resultPoints = -H2H_PER_RESULT;
      weightedSum += weight * (resultPoints + goalDiff * H2H_PER_GOAL_DIFF);
      totalWeight += weight;
    }

    if (totalWeight === 0) return 0;
    const bias = weightedSum / totalWeight;
    return Math.round(clamp(bias, -H2H_MAX, H2H_MAX));
  }

  function buildH2HMap(historicalResults, teamNames, asOfIso) {
    const map = {};
    if (!Array.isArray(historicalResults) || historicalResults.length === 0) return map;
    for (const teamName of teamNames) {
      const inner = {};
      for (const opponent of teamNames) {
        if (opponent === teamName) continue;
        const bias = computeH2HBias(historicalResults, teamName, opponent, asOfIso);
        if (bias !== 0) inner[opponent] = bias;
      }
      if (Object.keys(inner).length > 0) {
        map[teamName] = inner;
      }
    }
    return map;
  }

  function applyDerivedContext(teams, options) {
    const opts = options || {};
    const results = opts.results || [];
    const fixtures = opts.fixtures || [];
    const historicalResults = opts.historicalResults || [];
    const asOfIso = opts.asOfIso || null;

    const teamNames = teams.map((team) => team.name);
    const h2hByTeam = buildH2HMap(historicalResults, teamNames, asOfIso);

    return teams.map((team) => {
      const existing = team.adjustments || {};
      const manualForm = Number(existing.form || 0);
      const derivedForm = manualForm !== 0 ? manualForm : deriveFormAdjustment(results, team.name);
      const restAdjustment = computeRestAdjustment(results, fixtures, team.name, asOfIso);
      const h2hVs = h2hByTeam[team.name] || {};

      return {
        ...team,
        adjustments: {
          ...existing,
          form: derivedForm
        },
        restAdjustment,
        h2hVs,
        derivedContext: {
          formSource: manualForm !== 0 ? "manual" : derivedForm !== 0 ? "results" : "none",
          restDaysBaseline: REST_BASELINE_DAYS,
          h2hLookback: H2H_LOOKBACK
        }
      };
    });
  }

  globalScope.WorldCupDerivedContext = {
    deriveFormAdjustment,
    computeRestAdjustment,
    computeH2HBias,
    buildH2HMap,
    applyDerivedContext
  };
})(window);
