const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const resultsPath = path.join(rootDir, "data", "results-2026.json");
const teamsPath = path.join(rootDir, "data", "teams-2026-qualified.json");
const sourceUrl =
  "https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup&prop=text&formatversion=2&format=json";

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

function toIsoDate(monthName, day, year) {
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

  const month = `${months[monthName]}`.padStart(2, "0");
  const date = `${day}`.padStart(2, "0");
  return `${year}-${month}-${date}`;
}

function parseFootballBoxes(html, groupName, validTeams) {
  const matches = [];
  const regex =
    /<div itemscope="" itemtype="http&#58;\/\/schema\.org\/SportsEvent" class="footballbox"[\s\S]*?<div class="fdate">([\s\S]*?)<\/div>[\s\S]*?<th class="fhome"[\s\S]*?<span itemprop="name">([\s\S]*?)<\/span><\/th><th class="fscore">([\d]+)[^\d<]+([\d]+)<\/th><th class="faway"[\s\S]*?<span itemprop="name">([\s\S]*?)<\/span><\/th>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const dateText = stripTags(match[1]);
    const teamA = normalizeTeamName(stripTags(match[2]));
    const scoreA = Number(match[3]);
    const scoreB = Number(match[4]);
    const teamB = normalizeTeamName(stripTags(match[5]));

    if (!validTeams.has(teamA) || !validTeams.has(teamB)) {
      continue;
    }

    const isoDateMatch = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
    if (!isoDateMatch) {
      continue;
    }

    matches.push({
      date: toIsoDate(isoDateMatch[1], Number(isoDateMatch[2]), Number(isoDateMatch[3])),
      group: groupName,
      teamA,
      teamB,
      scoreA,
      scoreB
    });
  }

  return matches;
}

async function fetchWithRetry(url, label, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "world-cup-2026-predictor/0.1"
    }
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
  const headingRegex = /<h3[^>]*id="Group_([A-L])"[^>]*>[\s\S]*?<\/h3>/g;
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

async function refreshResults(options = {}) {
  const { persist = true } = options;
  const validTeams = buildValidTeamSet();
  const payload = await fetchWithRetry(sourceUrl, "2026_FIFA_World_Cup");
  const html = payload?.parse?.text || "";
  const sections = extractGroupSections(html);
  const allMatches = sections.flatMap((section) =>
    parseFootballBoxes(section.html, section.group, validTeams)
  );

  allMatches.sort((a, b) => {
    return (
      a.date.localeCompare(b.date) ||
      a.group.localeCompare(b.group) ||
      a.teamA.localeCompare(b.teamA)
    );
  });

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
