const fs = require("fs");
const path = require("path");
const { applyDerivedContext, applyResultUpdates, calibrateAgainstResults } = require("./derived-context");
const { buildGroupStageFixtures } = require("./fixtures");
const predictorModel = require("./predictor");

function loadJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestDateFromResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const sorted = [...results]
    .filter((row) => row && row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return sorted.length ? sorted[sorted.length - 1].date : null;
}

function mergeTeamContext(teams, squadContext) {
  const byTeam = squadContext?.teams || {};

  return teams.map((team) => {
    const context = byTeam[team.name];
    if (!context) {
      return team;
    }

    return {
      ...team,
      adjustments: {
        ...(team.adjustments || {}),
        squad: Number(context.generated?.squad || 0),
        injuries: Number(context.generated?.injuries || 0),
        form: Number(context.manual?.form || 0),
        fatigue: Number(context.manual?.fatigue || 0),
        chemistry: Number(context.manual?.chemistry || 0)
      },
      squadContext: context
    };
  });
}

function loadTeamsWithContext(teamFilePath, squadContextPath, options) {
  const teams = JSON.parse(fs.readFileSync(teamFilePath, "utf8"));
  const squadContext = loadJsonIfExists(squadContextPath, { updatedAt: "", version: 1, teams: {} });

  const resultsPath = options?.resultsPath || path.resolve(path.dirname(teamFilePath), "results-2026.json");
  const historicalPath = options?.historicalResultsPath || path.resolve(path.dirname(teamFilePath), "historical-results.json");
  const results = loadJsonIfExists(resultsPath, []);
  const historicalResults = loadJsonIfExists(historicalPath, []);

  const merged = mergeTeamContext(teams, squadContext);
  const fixtures = buildGroupStageFixtures(merged);
  const asOfIso = options?.asOfIso || latestDateFromResults(results) || fixtures[0]?.date || null;

  const ratingUpdated = applyResultUpdates(merged, results);
  const enriched = applyDerivedContext(ratingUpdated, {
    results,
    fixtures,
    historicalResults,
    asOfIso
  });
  const calibrationResult = calibrateAgainstResults(enriched, results, predictorModel);

  return {
    teams: enriched,
    squadContext,
    results,
    historicalResults,
    asOfIso,
    calibration: calibrationResult.calibration,
    calibrationMeta: {
      tuned: calibrationResult.tuned,
      sampleSize: calibrationResult.sampleSize,
      reason: calibrationResult.reason,
      logLikelihood: calibrationResult.logLikelihood
    }
  };
}

module.exports = {
  loadTeamsWithContext
};
