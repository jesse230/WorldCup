const fs = require("fs");
const path = require("path");
const { runSimulations } = require("./predictor");
const { loadTeamsWithContext } = require("./context-loader");

function loadBundle(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath || "data/teams-2026-qualified.json");
  const squadContextPath = path.resolve(process.cwd(), "data/squad-context.json");
  return loadTeamsWithContext(fullPath, squadContextPath);
}

const simulationCount = Number(process.argv[2] || 5000);
const seed = Number(process.argv[3] || 20260611);
const inputPath = process.argv[4] || "data/teams-2026-qualified.json";
const bundle = loadBundle(inputPath);
const teams = bundle.teams;
const result = runSimulations(teams, simulationCount, seed, bundle.calibration);

console.log(`Simulations: ${simulationCount}`);
console.log(`Seed: ${seed}`);
console.log("");
console.table(
  result.probabilities.slice(0, 12).map((team) => ({
    Team: team.team,
    Group: team.group,
    Rating: team.rating,
    "Adj Rt": Math.round(team.adjustedRating),
    "Win %": (team.winTournament * 100).toFixed(2),
    "Advance %": (team.advanceFromGroup * 100).toFixed(2),
    "Group Win %": (team.groupWin * 100).toFixed(2),
    "Final %": (team.reachFinal * 100).toFixed(2),
    "Semi %": (team.reachSemiFinals * 100).toFixed(2),
    "QF %": (team.reachQuarterFinals * 100).toFixed(2)
  }))
);

console.log("");
console.log("Most balanced group-stage matches:");
console.table(
  result.groupMatchForecasts.slice(0, 6).map((match) => ({
    Group: match.group,
    Match: `${match.teamA} vs ${match.teamB}`,
    Score: `${match.predictedScoreA}-${match.predictedScoreB}`,
    "A Win %": (match.teamAWin * 100).toFixed(1),
    "Draw %": (match.draw * 100).toFixed(1),
    "B Win %": (match.teamBWin * 100).toFixed(1)
  }))
);
