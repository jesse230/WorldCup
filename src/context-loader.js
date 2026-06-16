const fs = require("fs");
const path = require("path");

function loadJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function loadTeamsWithContext(teamFilePath, squadContextPath) {
  const teams = JSON.parse(fs.readFileSync(teamFilePath, "utf8"));
  const context = loadJsonIfExists(squadContextPath, { updatedAt: "", version: 1, teams: {} });

  return {
    teams: mergeTeamContext(teams, context),
    squadContext: context
  };
}

module.exports = {
  loadTeamsWithContext
};
