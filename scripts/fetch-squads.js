const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const teamsPath = path.join(rootDir, "data", "teams-2026-qualified.json");
const squadContextPath = path.join(rootDir, "data", "squad-context.json");
const squadSourceUrl =
  "https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads&prop=text&formatversion=2&format=json";

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

const POSITION_WEIGHT = {
  GK: 11,
  DF: 10,
  MF: 10.5,
  FW: 10.75
};

const CLUB_BONUS_RULES = [
  [/Real Madrid|Barcelona|Manchester City|Arsenal|Liverpool|Bayern Munich|Paris Saint-Germain|Inter Milan/i, 7],
  [/Juventus|Milan|Napoli|Atletico Madrid|Chelsea|Tottenham|Borussia Dortmund|Leverkusen/i, 5],
  [/Benfica|Porto|Sporting CP|Ajax|PSV Eindhoven|Lyon|Roma|Marseille|Monaco|Sevilla|Real Betis/i, 4],
  [/West Ham United|Fulham|Genoa|Braga|Fenerbahce|PAOK|Wolverhampton Wanderers|Real Sociedad/i, 3],
  [/Slavia Prague|Sparta Prague|Guadalajara|Cruz Azul|Toluca|Viktoria Plzen/i, 2]
];

const TEAM_NAME_ALIASES = {
  "Czech Republic": "Czechia",
  "South Korea": "Korea Republic",
  Turkey: "Turkiye",
  "Cura\u00e7ao": "Curacao",
  "Ivory Coast": "Cote d'Ivoire",
  Iran: "IR Iran",
  "Cape Verde": "Cabo Verde",
  "DR Congo": "Congo DR"
};

function loadJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&minus;/g, "-");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeTeamName(name) {
  return TEAM_NAME_ALIASES[name] || name;
}

function normalizePosition(rawPosition) {
  const value = rawPosition.trim().toUpperCase();

  if (value.includes("GK")) {
    return "GK";
  }
  if (value.includes("DF")) {
    return "DF";
  }
  if (value.includes("MF")) {
    return "MF";
  }
  if (value.includes("FW")) {
    return "FW";
  }

  return value.split(/\s+/).pop() || value;
}

function extractTeamSections(html) {
  const sections = [];
  const headingRegex = /<h3[^>]*id="([^"]+)"[^>]*>(.*?)<\/h3>/g;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      id: decodeURIComponent(match[1]),
      title: stripTags(match[2]),
      index: match.index
    });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const sectionHtml = html.slice(current.index, next ? next.index : html.length);
    const tableMatch = sectionHtml.match(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/i);

    if (!tableMatch) {
      continue;
    }

    sections.push({
      teamName: normalizeTeamName(current.title),
      tableHtml: tableMatch[1]
    });
  }

  return sections;
}

function extractRows(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi)];
  return rows
    .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cell[1]))
    .filter((cells) => cells.length >= 6);
}

function inferRole(index, position) {
  if (position === "GK") {
    return index < 1 ? "starter" : index < 2 ? "rotation" : "bench";
  }

  if (index < 11) {
    return "starter";
  }

  if (index < 18) {
    return "rotation";
  }

  return "bench";
}

function clubBonus(club) {
  for (const [pattern, bonus] of CLUB_BONUS_RULES) {
    if (pattern.test(club)) {
      return bonus;
    }
  }

  return 0;
}

function estimateImpact(player, index) {
  const base = POSITION_WEIGHT[player.position] || 10;
  const capsValue = Math.min(player.caps, 100) * 0.05;
  const goalsValue =
    player.position === "FW"
      ? Math.min(player.goals, 40) * 0.14
      : player.position === "MF"
        ? Math.min(player.goals, 18) * 0.09
        : Math.min(player.goals, 10) * 0.05;
  const clubValue = clubBonus(player.club);
  const shirtBoost = index < 11 ? 1.2 : index < 18 ? 0.5 : 0;

  return Math.round(Math.max(4, Math.min(18, base + capsValue + goalsValue + clubValue + shirtBoost)));
}

function parsePlayers(tableHtml) {
  const rows = extractRows(tableHtml);
  const players = [];

  for (const cells of rows) {
    const values = cells.map(stripTags);
    const number = Number(values[0]);
    const position = normalizePosition(values[1]);
    const name = values[2];
    const caps = Number(values[4]);
    const goals = Number(values[5]);
    const club = values[6] || "";

    if (!number || !name || !position || Number.isNaN(caps) || Number.isNaN(goals)) {
      continue;
    }

    const player = {
      number,
      position,
      name,
      caps,
      goals,
      club,
      role: inferRole(players.length, position),
      status: "available"
    };

    player.impact = estimateImpact(player, players.length);
    players.push(player);
  }

  return players;
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

  return {
    squad: Math.round(clamp((weightedAvailable - 92) / 2.6, -18, 28)),
    injuries: -Math.round(
      clamp(weightedLoss / 2.1 + Math.max(0, 11 - availableStarters) * 3.5, 0, 40)
    ),
    starterQuality: Math.round(starterQuality),
    depthQuality: Math.round(rotationQuality),
    availableStarters,
    unavailablePlayers: players.filter((player) => statusWeight(player) === 0).length,
    doubtfulPlayers: players.filter((player) => player.status === "doubtful").length
  };
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function baseEntry(existing) {
  return {
    source: "wikipedia-squads",
    lastChecked: new Date().toISOString().slice(0, 10),
    manual: {
      form: Number(existing?.manual?.form || 0),
      fatigue: Number(existing?.manual?.fatigue || 0),
      chemistry: Number(existing?.manual?.chemistry || 0)
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
    notes: existing?.notes || ""
  };
}

async function refreshSquads(options = {}) {
  const { persist = true } = options;
  const tournamentTeams = loadJsonIfExists(teamsPath, []);
  const validTeamNames = new Set(tournamentTeams.map((team) => team.name));
  const response = await fetch(squadSourceUrl, {
    headers: {
      "User-Agent": "world-cup-2026-predictor/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch squads source: ${response.status}`);
  }

  const payload = await response.json();
  const html = payload?.parse?.text;
  if (!html) {
    throw new Error("Could not find parsed squad HTML in the source payload.");
  }

  const currentContext = loadJsonIfExists(squadContextPath, {
    updatedAt: "",
    version: 1,
    teams: {}
  });

  const sections = extractTeamSections(html);
  const teams = {};

  for (const section of sections) {
    if (!validTeamNames.has(section.teamName)) {
      continue;
    }

    const existing = currentContext.teams?.[section.teamName] || {};
    const entry = baseEntry(existing);
    entry.players = parsePlayers(section.tableHtml);
    entry.generated = calculateGenerated(entry.players);
    teams[section.teamName] = entry;
  }

  const nextContext = {
    updatedAt: new Date().toISOString().slice(0, 10),
    version: 1,
    source: squadSourceUrl,
    teams
  };

  if (persist) {
    fs.writeFileSync(squadContextPath, `${JSON.stringify(nextContext, null, 2)}\n`, "utf8");
    console.log(`Fetched and scored squads for ${Object.keys(teams).length} teams.`);
    console.log(`Saved: ${squadContextPath}`);
  }

  return nextContext;
}

module.exports = { refreshSquads };

if (require.main === module) {
  refreshSquads().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
