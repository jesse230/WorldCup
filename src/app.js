async function loadAppData() {
  try {
    const response = await fetch("./api/bootstrap");
    if (!response.ok) {
      throw new Error(`bootstrap request failed: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.warn("Falling back to static data files.", error);
    const [teamsResponse, resultsResponse, squadContextResponse] = await Promise.all([
      fetch("./data/teams-2026-qualified.json"),
      fetch("./data/results-2026.json"),
      fetch("./data/squad-context.json")
    ]);

    return {
      teams: await teamsResponse.json(),
      results: await resultsResponse.json(),
      squadContext: await squadContextResponse.json(),
      meta: {
        mode: "static-fallback"
      }
    };
  }
}

async function main() {
  const appData = await loadAppData();
  const teams = appData.teams;
  const completedResults = appData.results;
  const squadContext = appData.squadContext;

  const controls = {
    simulations: document.querySelector("#simulations"),
    seed: document.querySelector("#seed"),
    run: document.querySelector("#run"),
    selectedDate: document.querySelector("#selected-date")
  };

  const topTable = document.querySelector("#top-table tbody");
  const groupGrid = document.querySelector("#group-grid");
  const matchForecasts = document.querySelector("#match-forecasts");
  const todayCards = document.querySelector("#today-cards");
  const todayLabel = document.querySelector("#today-label");
  const modelStatus = document.querySelector("#model-status");
  const featuredMatch = document.querySelector("#featured-match");
  const trackerSummary = document.querySelector("#tracker-summary");
  const trackerList = document.querySelector("#tracker-list");
  const trackerStamp = document.querySelector("#tracker-stamp");
  const assumptions = document.querySelector("#assumptions");
  const sampleBracket = document.querySelector("#sample-bracket");
  const model = window.WorldCupPredictor;
  const fixturesApi = window.WorldCupFixtures;
  const fixtures = fixturesApi.buildGroupStageFixtures(teams);
  const fixtureDates = [...new Set(fixtures.map((fixture) => fixture.date))];

  function mergeTeamContext(teamList) {
    const contextTeams = squadContext?.teams || {};
    return teamList.map((team) => {
      const context = contextTeams[team.name];
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

  const teamsWithContext = mergeTeamContext(teams);

  function getTodayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  controls.selectedDate.min = fixtureDates[0];
  controls.selectedDate.max = fixtureDates[fixtureDates.length - 1];
  controls.selectedDate.value = fixtureDates.includes(getTodayIsoDate())
    ? getTodayIsoDate()
    : fixtureDates[0];

  function fixtureForecastMap(result) {
    return new Map(
      result.groupMatchForecasts.map((match) => [
        `${match.teamA}__${match.teamB}`,
        match
      ])
    );
  }

  function lookupForecast(forecasts, teamA, teamB) {
    return forecasts.get(`${teamA}__${teamB}`) || forecasts.get(`${teamB}__${teamA}`) || null;
  }

  function inferOutcome(scoreA, scoreB) {
    if (scoreA > scoreB) {
      return "A";
    }
    if (scoreB > scoreA) {
      return "B";
    }
    return "D";
  }

  function inferPredictedOutcome(forecast, isForward) {
    const teamAWin = isForward ? forecast.teamAWin : forecast.teamBWin;
    const teamBWin = isForward ? forecast.teamBWin : forecast.teamAWin;
    const values = [
      { key: "A", value: teamAWin },
      { key: "D", value: forecast.draw },
      { key: "B", value: teamBWin }
    ].sort((left, right) => right.value - left.value);

    return values[0].key;
  }

  function buildTracker(result) {
    const forecasts = fixtureForecastMap(result);
    const rows = completedResults
      .map((fixture) => {
        const forecast = lookupForecast(forecasts, fixture.teamA, fixture.teamB);
        if (!forecast) {
          return null;
        }

        const isForward = forecast.teamA === fixture.teamA;
        const predictedScoreA = isForward ? forecast.predictedScoreA : forecast.predictedScoreB;
        const predictedScoreB = isForward ? forecast.predictedScoreB : forecast.predictedScoreA;
        const predictedOutcome = inferPredictedOutcome(forecast, isForward);
        const actualOutcome = inferOutcome(fixture.scoreA, fixture.scoreB);

        return {
          ...fixture,
          predictedScoreA,
          predictedScoreB,
          predictedOutcome,
          actualOutcome,
          correctOutcome: predictedOutcome === actualOutcome,
          exactScore: predictedScoreA === fixture.scoreA && predictedScoreB === fixture.scoreB
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));

    const correctOutcomeCount = rows.filter((row) => row.correctOutcome).length;
    const exactScoreCount = rows.filter((row) => row.exactScore).length;
    const total = rows.length;

    return {
      rows,
      total,
      correctOutcomeCount,
      exactScoreCount,
      outcomeAccuracy: total ? correctOutcomeCount / total : 0,
      exactScoreAccuracy: total ? exactScoreCount / total : 0
    };
  }

  function renderTracker(result) {
    const tracker = buildTracker(result);
    trackerStamp.textContent = tracker.total
      ? `Completed matches logged through ${completedResults[completedResults.length - 1].date}`
      : "No completed matches logged yet";

    trackerSummary.innerHTML = `
      <div class="score-chip">
        <span class="score-label">Correct Result</span>
        <strong>${tracker.correctOutcomeCount}/${tracker.total || 0}</strong>
        <small>${(tracker.outcomeAccuracy * 100).toFixed(1)}%</small>
      </div>
      <div class="score-chip">
        <span class="score-label">Exact Score</span>
        <strong>${tracker.exactScoreCount}/${tracker.total || 0}</strong>
        <small>${(tracker.exactScoreAccuracy * 100).toFixed(1)}%</small>
      </div>
      <div class="score-chip">
        <span class="score-label">Active Sample</span>
        <strong>${tracker.total}</strong>
        <small>finished games</small>
      </div>
    `;

    trackerList.innerHTML = tracker.rows
      .map(
        (row) => `
          <article class="tracker-row ${row.correctOutcome ? "hit" : "miss"}">
            <div class="tracker-topline">
              <span>Group ${row.group}</span>
              <span>${row.date}</span>
            </div>
            <div class="tracker-match">
              <div class="tracker-teams">
                ${fixturesApi.buildFlagLabel(row.teamA)}
                <span>${row.teamA}</span>
                <strong>${row.scoreA}</strong>
              </div>
              <div class="tracker-separator">-</div>
              <div class="tracker-teams">
                <strong>${row.scoreB}</strong>
                <span>${row.teamB}</span>
                ${fixturesApi.buildFlagLabel(row.teamB)}
              </div>
            </div>
            <div class="tracker-bottomline">
              <span>Predicted: ${row.predictedScoreA}-${row.predictedScoreB}</span>
              <span>${row.correctOutcome ? "Result hit" : "Result miss"}</span>
              <span>${row.exactScore ? "Exact score hit" : "Exact score miss"}</span>
            </div>
          </article>
        `
      )
      .join("");
  }

  function buildFeaturedFixture(result, dailyFixtures) {
    const forecasts = fixtureForecastMap(result);
    const candidates = dailyFixtures
      .map((fixture) => {
        const forecast = lookupForecast(forecasts, fixture.teamA, fixture.teamB);
        if (!forecast) {
          return null;
        }

        const combinedWeight =
          (forecast.adjustedRatingA || 0) +
          (forecast.adjustedRatingB || 0) +
          Math.abs((forecast.teamAWin || 0) - (forecast.teamBWin || 0)) * 120;

        return {
          fixture,
          forecast,
          weight: combinedWeight
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.weight - left.weight);

    return candidates[0] || null;
  }

  function renderModelStatus(result) {
    const tracker = buildTracker(result);
    const lastResultsDate =
      completedResults[completedResults.length - 1]?.date ||
      appData.meta?.resultsUpdatedAt ||
      "pending";
    const lastSquadDate =
      appData.meta?.squadUpdatedAt ||
      squadContext?.updatedAt ||
      "pending";

    modelStatus.innerHTML = `
      <span class="status-pill">Matches tracked <strong>${tracker.total}</strong></span>
      <span class="status-pill">Engine <strong>attack/defense</strong></span>
      <span class="status-pill">Results <strong>${lastResultsDate}</strong></span>
      <span class="status-pill">Squads <strong>${lastSquadDate}</strong></span>
    `;
  }

  function renderFeaturedMatch(result) {
    const selectedDate = controls.selectedDate.value;
    const dailyFixtures = fixtures.filter((fixture) => fixture.date === selectedDate);
    const featured = buildFeaturedFixture(result, dailyFixtures);

    if (!featured) {
      featuredMatch.innerHTML = `
        <span class="featured-tag">Featured Match</span>
        <h2 class="featured-headline">No featured fixture for this date.</h2>
        <p class="lede">Move the date to another matchday to spotlight a fresh forecast card.</p>
      `;
      return;
    }

    const { fixture, forecast } = featured;
    const isForward = forecast.teamA === fixture.teamA;
    const teamAWin = isForward ? forecast.teamAWin : forecast.teamBWin;
    const teamBWin = isForward ? forecast.teamBWin : forecast.teamAWin;
    const predictedScoreA = isForward ? forecast.predictedScoreA : forecast.predictedScoreB;
    const predictedScoreB = isForward ? forecast.predictedScoreB : forecast.predictedScoreA;
    const ratingA = Math.round(isForward ? forecast.adjustedRatingA : forecast.adjustedRatingB);
    const ratingB = Math.round(isForward ? forecast.adjustedRatingB : forecast.adjustedRatingA);

    featuredMatch.innerHTML = `
      <span class="featured-tag">Featured Match</span>
      <h2 class="featured-headline">${fixture.teamA} vs ${fixture.teamB}</h2>
      <div class="featured-meta">
        <span>Group ${fixture.group}</span>
        <span>${fixturesApi.formatDisplayDate(fixture.date)}</span>
      </div>
      <div class="featured-body">
        <div class="featured-score">
          <div class="featured-team">
            ${fixturesApi.buildFlagLabel(fixture.teamA)}
            <strong>${fixture.teamA}</strong>
            <small>${(teamAWin * 100).toFixed(1)}% win</small>
            <small>Adj ${ratingA}</small>
          </div>
          <div class="featured-prediction">${predictedScoreA}-${predictedScoreB}</div>
          <div class="featured-team">
            ${fixturesApi.buildFlagLabel(fixture.teamB)}
            <strong>${fixture.teamB}</strong>
            <small>${(teamBWin * 100).toFixed(1)}% win</small>
            <small>Adj ${ratingB}</small>
          </div>
        </div>
        <div class="featured-foot">
          <span>Draw ${(forecast.draw * 100).toFixed(1)}%</span>
          <strong>${forecast.edgeSummary}</strong>
        </div>
      </div>
    `;
  }

  function renderTodayFixtures(result) {
    const selectedDate = controls.selectedDate.value;
    const dailyFixtures = fixtures.filter((fixture) => fixture.date === selectedDate);
    const forecasts = fixtureForecastMap(result);
    todayLabel.textContent = fixturesApi.formatDisplayDate(selectedDate);

    todayCards.innerHTML = dailyFixtures.length
      ? dailyFixtures
          .map((fixture) => {
            const forecast = lookupForecast(forecasts, fixture.teamA, fixture.teamB);
            if (!forecast) {
              return "";
            }

            const isForward = forecast.teamA === fixture.teamA;
            const teamAWin = isForward ? forecast.teamAWin : forecast.teamBWin;
            const teamBWin = isForward ? forecast.teamBWin : forecast.teamAWin;
            const predictedScoreA = isForward ? forecast.predictedScoreA : forecast.predictedScoreB;
            const predictedScoreB = isForward ? forecast.predictedScoreB : forecast.predictedScoreA;

            return `
              <article class="today-card">
                <div class="today-meta">
                  <span>Group ${fixture.group}</span>
                  <span>${fixture.date}</span>
                </div>
                <div class="today-teams">
                  <div class="today-team">
                    ${fixturesApi.buildFlagLabel(fixture.teamA)}
                    <strong>${fixture.teamA}</strong>
                    <small>${(teamAWin * 100).toFixed(1)}% win</small>
                    <small class="context-line">Adj ${isForward ? forecast.adjustedRatingA : forecast.adjustedRatingB}</small>
                  </div>
                  <div class="today-vs">vs</div>
                  <div class="today-team">
                    ${fixturesApi.buildFlagLabel(fixture.teamB)}
                    <strong>${fixture.teamB}</strong>
                    <small>${(teamBWin * 100).toFixed(1)}% win</small>
                    <small class="context-line">Adj ${isForward ? forecast.adjustedRatingB : forecast.adjustedRatingA}</small>
                  </div>
                </div>
                <div class="today-stats">
                  <span>Draw ${(forecast.draw * 100).toFixed(1)}%</span>
                  <span>Predicted ${predictedScoreA} - ${predictedScoreB}</span>
                </div>
                <div class="context-strip">
                  <strong>${forecast.edgeSummary}</strong>
                  <small>${forecast.edgeReasons.join(" | ")}</small>
                </div>
              </article>
            `;
          })
          .join("")
      : `<div class="today-empty">No scheduled group-stage matches for this date.</div>`;
  }

  function render(result) {
    renderModelStatus(result);
    renderFeaturedMatch(result);
    renderTracker(result);
    renderTodayFixtures(result);
    assumptions.innerHTML = "";
    Object.entries(result.assumptions).forEach(([key, value]) => {
      const item = document.createElement("div");
      item.className = "assumption";
      item.innerHTML = `<strong>${key}</strong><span>${value}</span>`;
      assumptions.appendChild(item);
    });

    topTable.innerHTML = "";
    result.probabilities.slice(0, 16).forEach((team, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${team.team}</td>
        <td>${team.group}</td>
        <td>${team.rating}</td>
        <td>${Math.round(team.adjustedRating)}</td>
        <td>${(team.winTournament * 100).toFixed(1)}%</td>
        <td>${(team.advanceFromGroup * 100).toFixed(1)}%</td>
        <td>${(team.reachFinal * 100).toFixed(1)}%</td>
        <td>${(team.reachSemiFinals * 100).toFixed(1)}%</td>
      `;
      topTable.appendChild(row);
    });

    groupGrid.innerHTML = result.groupProjections
      .map((group) => {
        const rows = group.teams
          .map(
            (team) => `
              <tr>
                <td>${team.team}</td>
                <td>${Math.round(team.adjustedRating)}</td>
                <td>${(team.groupWin * 100).toFixed(1)}%</td>
                <td>${(team.top2 * 100).toFixed(1)}%</td>
                <td>${(team.advance * 100).toFixed(1)}%</td>
                <td>${team.averagePoints.toFixed(2)}</td>
              </tr>
            `
          )
          .join("");

        return `
          <section class="group-card">
            <h3>Group ${group.group}</h3>
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Adj Rt</th>
                  <th>Win</th>
                  <th>Top 2</th>
                  <th>Advance</th>
                  <th>Avg Pts</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      })
      .join("");

    matchForecasts.innerHTML = result.groupMatchForecasts
      .slice(0, 10)
      .map(
        (match) => `
          <div class="match-card">
            <div class="match-header">
              <strong>Group ${match.group}</strong>
              <span>${match.teamA} vs ${match.teamB}</span>
            </div>
            <div class="odds-row">
              <span>${match.teamA}: ${(match.teamAWin * 100).toFixed(1)}%</span>
              <span>Draw: ${(match.draw * 100).toFixed(1)}%</span>
              <span>${match.teamB}: ${(match.teamBWin * 100).toFixed(1)}%</span>
            </div>
            <small>Predicted score: ${match.teamA} ${match.predictedScoreA} - ${match.predictedScoreB} ${match.teamB}</small>
            <small>${match.edgeSummary}</small>
          </div>
        `
      )
      .join("");

    const rounds = result.latestTournament.knockout;
    sampleBracket.innerHTML = [
      ["Round of 32", rounds.roundOf32],
      ["Round of 16", rounds.roundOf16],
      ["Quarter-finals", rounds.quarterFinals],
      ["Semi-finals", rounds.semiFinals],
      ["Final", rounds.final]
    ]
      .map(([label, matches]) => {
        const cards = matches
          .map(
            (match) => `
            <div class="match-card">
              <div>${match.teamA} ${match.goalsA} - ${match.goalsB} ${match.teamB}</div>
              <small>${match.winner} advanced${match.decidedBy === "pens" ? " on pens" : ""}</small>
            </div>
          `
          )
          .join("");

        return `<section><h3>${label}</h3><div class="match-grid">${cards}</div></section>`;
      })
      .join("");
  }

  function run() {
    const result = model.runSimulations(
      teamsWithContext,
      Number(controls.simulations.value || 5000),
      Number(controls.seed.value)
    );
    render(result);
  }

  controls.run.addEventListener("click", run);
  controls.selectedDate.addEventListener("input", run);
  run();
}

main();
