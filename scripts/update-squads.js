const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const teamsPath = path.join(rootDir, "data", "teams-2026-qualified.json");
const squadContextPath = path.join(rootDir, "data", "squad-context.json");

const ROLE_WEIGHT = {
  starter: 1,
  rotation: 0.68,
  bench: 0.38
};

const STATUS_WEIGHT = {
  available: 1,
  doubtful: 0.55,
  suspended: 0,
  out: 0
};

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function impactValue(player) {
  return Number(player.impact || 0);
}

function roleWeight(player) {
  return ROLE_WEIGHT[player.role] || ROLE_WEIGHT.bench;
}

function statusWeight(player) {
  return STATUS_WEIGHT[player.status] ?? STATUS_WEIGHT.available;
}

function calculateGenerated(players) {
  const starters = players.filter((player) => player.role === "starter");
  const rotations = players.filter((player) => player.role === "rotation");
  const availableStarters = starters.filter((player) => statusWeight(player) > 0.5).length;

  const weightedAvailable = players.reduce((sum, player) => {
    return sum + impactValue(player) * roleWeight(player) * statusWeight(player);
  }, 0);

  const weightedLoss = players.reduce((sum, player) => {
    return sum + impactValue(player) * roleWeight(player) * (1 - statusWeight(player));
  }, 0);

  const starterQuality = starters.reduce((sum, player) => {
    return sum + impactValue(player) * statusWeight(player);
  }, 0);

  const rotationQuality = rotations.reduce((sum, player) => {
    return sum + impactValue(player) * statusWeight(player);
  }, 0);

  const squadBoost = Math.round(clamp((weightedAvailable - 92) / 2.6, -18, 28));
  const injuriesPenalty =
    -Math.round(
      clamp(weightedLoss / 2.1 + Math.max(0, 11 - availableStarters) * 3.5, 0, 40)
    );

  return {
    squad: squadBoost,
    injuries: injuriesPenalty,
    starterQuality: Math.round(starterQuality),
    depthQuality: Math.round(rotationQuality),
    availableStarters,
    unavailablePlayers: players.filter((player) => statusWeight(player) === 0).length,
    doubtfulPlayers: players.filter((player) => player.status === "doubtful").length
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultTeamEntry() {
  return {
    source: "manual",
    lastChecked: "",
    manual: {
      form: 0,
      fatigue: 0,
      chemistry: 0
    },
    players: [],
    generated: {
      squad: 0,
      injuries: 0,
      starterQuality: 0,
      depthQuality: 0,
      availableStarters: 0,
      unavailablePlayers: 0,
      doubtfulPlayers: 0
    },
    notes: ""
  };
}

function mergeEntries(base, existing) {
  return {
    ...base,
    ...existing,
    manual: {
      ...base.manual,
      ...(existing.manual || {})
    },
    generated: {
      ...base.generated,
      ...(existing.generated || {})
    },
    players: Array.isArray(existing.players) ? existing.players : base.players
  };
}

function main() {
  const teams = loadJson(teamsPath, []);
  const currentContext = loadJson(squadContextPath, {
    updatedAt: "",
    version: 1,
    teams: {}
  });

  const nextTeams = {};

  for (const team of teams) {
    const existing = currentContext.teams?.[team.name] || {};
    const entry = mergeEntries(defaultTeamEntry(), existing);
    entry.generated = calculateGenerated(entry.players);
    nextTeams[team.name] = entry;
  }

  const nextContext = {
    updatedAt: new Date().toISOString().slice(0, 10),
    version: 1,
    teams: nextTeams
  };

  fs.writeFileSync(squadContextPath, `${JSON.stringify(nextContext, null, 2)}\n`, "utf8");

  console.log(`Updated squad context for ${teams.length} teams.`);
  console.log(`File: ${squadContextPath}`);
  console.log("");
  console.log("Next step:");
  console.log("Fill players[] for each team, then rerun this script to refresh generated squad/injury modifiers.");
}

main();
