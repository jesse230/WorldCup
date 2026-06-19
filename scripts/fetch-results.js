const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const resultsPath = path.join(rootDir, "data", "results-2026.json");
const teamsPath = path.join(rootDir, "data", "teams-2026-qualified.json");
const sourceUrl =
  "https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup&prop=text&formatversion=2&format=json";
const REQUEST_TIMEOUT_MS = 12000;

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

function normalizeTeamName(name) {
  return TEAM_NAME_ALIASES[name] || name;
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&minus;/g, "-");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildValidTeamSet() {
  const teams = loadJson(teamsPath);
  return new Set(teams.map((team) => team.name));
}

function extractIsoDate(dateHtml) {
  const hiddenIsoMatch = dateHtml.match(/(\d{4}-\d{2}-\d{2})/);
  if (hiddenIsoMatch) {
    return hiddenIsoMatch[1];
  }

  const dateText = stripTags(dateHtml);
  const parsedDateMatch = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!parsedDateMatch) {
    return null;
  }

  const months = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12
  };

  const month = `${months[parsedDateMatch[1]]}`.padStart(2, "0");
  const day = `${parsedDateMatch[2]}`.padStart(2, "0");
  return `${parsedDateMatch[3]}-${month}-${day}`;
}

function parseFootballBoxes(html, groupName, validTeams) {
  const matches = [];
  const startToken = '<div itemscope="" itemtype="http&#58;//schema.org/SportsEvent" class="footballbox"';
  const chunks = [];
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf(startToken, cursor);
    if (start === -1) {
      break;
    }

    const nextStart = html.indexOf(startToken, start + startToken.length);
    chunks.push(html.slice(start, nextStart === -1 ? html.length : nextStart));
    cursor = nextStart === -1 ? html.length : nextStart;
  }

  for (const chunk of chunks) {
    const dateMatch = chunk.match(/<div class="fdate">([\s\S]*?)<\/div>/i);
    const homeCellMatch = chunk.match(/<th class="fhome"[\s\S]*?>([\s\S]*?)<\/th>/i);
    const awayCellMatch = chunk.match(/<th class="faway"[\s\S]*?>([\s\S]*?)<\/th>/i);
    const scoreCellMatch = chunk.match(/<th class="fscore">([\s\S]*?)<\/th>/i);

    if (!dateMatch || !homeCellMatch || !awayCellMatch || !scoreCellMatch) {
      continue;
    }

    const isoDate = extractIsoDate(dateMatch[1]);
    const teamA = normalizeTeamName(stripTags(homeCellMatch[1]));
    const teamB = normalizeTeamName(stripTags(awayCellMatch[1]));
    const scoreText = stripTags(scoreCellMatch[1]);
    const scoreParts = scoreText.match(/(\d+)\s*[-–]\s*(\d+)/);

    if (!scoreParts) {
      continue;
    }

    const scoreA = Number(scoreParts[1]);
    const scoreB = Number(scoreParts[2]);

    if (!isoDate || !validTeams.has(teamA) || !validTeams.has(teamB)) {
      continue;
    }

    matches.push({
      date: isoDate,
      group: groupName,
      teamA,
      teamB,
      scoreA,
      scoreB
    });
  }

  console.log(`Group ${groupName}: ${matches.length} matches parsed.`);
  return matches;
}

async function fetchWithRetry(url, label, attempt = 1) {
  console.log(`Fetching ${label} (attempt ${attempt})`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "world-cup-2026-predictor/0.1"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (response.ok) {
    return response.json();
  }

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await wait(600 * attempt);
    return fetchWithRetry(url, label, attempt + 1);
  }

  throw new Error(`Failed to fetch ${label}: ${response.status}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGroupSections(html) {
  const headingRegex =
    /<div class="mw-heading mw-heading3"><h3 id="Group_([A-L])">[\s\S]*?<\/h3>[\s\S]*?<\/div>/g;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      group: match[1],
      index: match.index
    });
  }

  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      group: heading.group,
      html: html.slice(heading.index, next ? next.index : html.length)
    };
  });
}

function dedupeMatches(matches) {
  const byKey = new Map();

  for (const match of matches) {
    const key = [match.date, match.group, match.teamA, match.teamB].join("__");
    byKey.set(key, match);
  }

  return [...byKey.values()];
}

async function refreshResults(options = {}) {
  const { persist = true } = options;
  const validTeams = buildValidTeamSet();
  const payload = await fetchWithRetry(sourceUrl, "2026_FIFA_World_Cup");
  const html = payload?.parse?.text || "";
  const sections = extractGroupSections(html);
  console.log(`Found ${sections.length} group sections in tournament page.`);
  const allMatches = dedupeMatches(
    sections.flatMap((section) => parseFootballBoxes(section.html, section.group, validTeams))
  )
    .filter((match) => Number.isFinite(match.scoreA) && Number.isFinite(match.scoreB))
    .sort((a, b) => {
      return (
        a.date.localeCompare(b.date) ||
        a.group.localeCompare(b.group) ||
        a.teamA.localeCompare(b.teamA)
      );
    });

  console.log(`Parsed ${allMatches.length} completed group-stage matches.`);

  if (persist) {
    fs.writeFileSync(resultsPath, `${JSON.stringify(allMatches, null, 2)}\n`, "utf8");
    console.log(`Fetched ${allMatches.length} completed group-stage results.`);
    console.log(`Saved: ${resultsPath}`);
  }

  return allMatches;
}

module.exports = { refreshResults };

if (require.main === module) {
  refreshResults().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
