(function attachFixtures(globalScope) {
  const TEAM_FLAG_CODES = {
    Mexico: "mx",
    "South Africa": "za",
    "Korea Republic": "kr",
    Czechia: "cz",
    Canada: "ca",
    "Bosnia and Herzegovina": "ba",
    Qatar: "qa",
    Switzerland: "ch",
    Brazil: "br",
    Morocco: "ma",
    Haiti: "ht",
    Scotland: "gb-sct",
    "United States": "us",
    Paraguay: "py",
    Australia: "au",
    Turkiye: "tr",
    Germany: "de",
    Curacao: "cw",
    "Cote d'Ivoire": "ci",
    Ecuador: "ec",
    Netherlands: "nl",
    Japan: "jp",
    Sweden: "se",
    Tunisia: "tn",
    Belgium: "be",
    Egypt: "eg",
    "IR Iran": "ir",
    "New Zealand": "nz",
    Spain: "es",
    "Cabo Verde": "cv",
    "Saudi Arabia": "sa",
    Uruguay: "uy",
    France: "fr",
    Senegal: "sn",
    Iraq: "iq",
    Norway: "no",
    Argentina: "ar",
    Algeria: "dz",
    Austria: "at",
    Jordan: "jo",
    Portugal: "pt",
    "Congo DR": "cd",
    Uzbekistan: "uz",
    Colombia: "co",
    England: "gb-eng",
    Croatia: "hr",
    Ghana: "gh",
    Panama: "pa"
  };

  const SPECIAL_FLAG_SVGS = {
    "gb-eng": `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 36">
        <rect width="60" height="36" fill="#ffffff"/>
        <rect x="24" width="12" height="36" fill="#ce1126"/>
        <rect y="12" width="60" height="12" fill="#ce1126"/>
      </svg>
    `,
    "gb-sct": `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 36">
        <rect width="60" height="36" fill="#005eb8"/>
        <path d="M0 0 L26 0 L60 20.5 L60 36 L34 36 L0 15.5 Z" fill="#ffffff"/>
        <path d="M60 0 L34 0 L0 20.5 L0 36 L26 36 L60 15.5 Z" fill="#ffffff"/>
      </svg>
    `
  };

  function encodeSvg(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  }

  function flagImageUrl(code) {
    if (!code) {
      return null;
    }

    if (SPECIAL_FLAG_SVGS[code]) {
      return encodeSvg(SPECIAL_FLAG_SVGS[code]);
    }

    if (code.includes("-")) {
      return null;
    }

    return `https://flagcdn.com/w80/${code}.png`;
  }

  function buildFlagLabel(teamName) {
    const code = TEAM_FLAG_CODES[teamName];
    const imageUrl = flagImageUrl(code);

    if (!imageUrl) {
      return `<span class="flag flag-fallback">${teamName.slice(0, 2).toUpperCase()}</span>`;
    }

    return `<span class="flag"><img class="flag-image" src="${imageUrl}" alt="${teamName} flag" loading="lazy" decoding="async"></span>`;
  }

  function groupMapFromTeams(teams) {
    const groups = new Map();
    for (const team of teams) {
      if (!groups.has(team.group)) {
        groups.set(team.group, []);
      }
      groups.get(team.group).push(team);
    }
    return groups;
  }

  function makeFixture(date, group, teamA, teamB) {
    return { date, group, teamA, teamB };
  }

  function buildGroupStageFixtures(teams) {
    const groups = groupMapFromTeams(teams);
    const fixtures = [];

    function addGroup(groupName, dates) {
      const groupTeams = groups.get(groupName) || [];
      if (groupTeams.length !== 4) {
        return;
      }

      fixtures.push(
        makeFixture(dates[0], groupName, groupTeams[0].name, groupTeams[1].name),
        makeFixture(dates[1], groupName, groupTeams[2].name, groupTeams[3].name),
        makeFixture(dates[2], groupName, groupTeams[0].name, groupTeams[2].name),
        makeFixture(dates[3], groupName, groupTeams[3].name, groupTeams[1].name),
        makeFixture(dates[4], groupName, groupTeams[3].name, groupTeams[0].name),
        makeFixture(dates[5], groupName, groupTeams[1].name, groupTeams[2].name)
      );
    }

    addGroup("A", ["2026-06-11", "2026-06-11", "2026-06-18", "2026-06-18", "2026-06-24", "2026-06-24"]);
    addGroup("B", ["2026-06-12", "2026-06-13", "2026-06-18", "2026-06-19", "2026-06-24", "2026-06-24"]);
    addGroup("C", ["2026-06-13", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-24", "2026-06-24"]);
    addGroup("D", ["2026-06-12", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-25", "2026-06-25"]);
    addGroup("E", ["2026-06-14", "2026-06-14", "2026-06-20", "2026-06-20", "2026-06-25", "2026-06-25"]);
    addGroup("F", ["2026-06-14", "2026-06-15", "2026-06-20", "2026-06-20", "2026-06-25", "2026-06-25"]);
    addGroup("G", ["2026-06-15", "2026-06-15", "2026-06-21", "2026-06-21", "2026-06-26", "2026-06-26"]);
    addGroup("H", ["2026-06-15", "2026-06-16", "2026-06-21", "2026-06-21", "2026-06-26", "2026-06-26"]);
    addGroup("I", ["2026-06-16", "2026-06-16", "2026-06-22", "2026-06-22", "2026-06-26", "2026-06-26"]);
    addGroup("J", ["2026-06-16", "2026-06-17", "2026-06-22", "2026-06-22", "2026-06-27", "2026-06-27"]);
    addGroup("K", ["2026-06-17", "2026-06-17", "2026-06-23", "2026-06-23", "2026-06-27", "2026-06-27"]);
    addGroup("L", ["2026-06-17", "2026-06-17", "2026-06-23", "2026-06-23", "2026-06-27", "2026-06-27"]);

    return fixtures.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
  }

  function formatDisplayDate(isoDate) {
    const date = new Date(`${isoDate}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  globalScope.WorldCupFixtures = {
    buildFlagLabel,
    buildGroupStageFixtures,
    formatDisplayDate
  };
})(window);
