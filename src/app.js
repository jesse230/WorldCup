async function loadAppData() {
  try {
    const response = await fetch("./api/bootstrap");
    if (!response.ok) {
      throw new Error(`bootstrap request failed: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.warn("Falling back to static data files.", error);
    const [teamsResponse, resultsResponse, squadContextResponse, historicalResponse] = await Promise.all([
      fetch("./data/teams-2026-qualified.json"),
      fetch("./data/results-2026.json"),
      fetch("./data/squad-context.json"),
      fetch("./data/historical-results.json").catch(() => null)
    ]);

    return {
      teams: await teamsResponse.json(),
      results: await resultsResponse.json(),
      squadContext: await squadContextResponse.json(),
      historicalResults: historicalResponse && historicalResponse.ok ? await historicalResponse.json() : [],
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
  const historicalResults = appData.historicalResults || [];
  const derivedContextApi = window.WorldCupDerivedContext;

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

  const DEFAULT_SETTINGS = {
    eloK: 20,
    maxNudge: 25,
    minResults: 12,
    calibrationOverride: { goalRatingDivisor: null, hostBonusScale: null, baseGoalsScale: null }
  };

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem("worldcup-settings-v1") || "{}");
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        calibrationOverride: { ...DEFAULT_SETTINGS.calibrationOverride, ...(stored.calibrationOverride || {}) }
      };
    } catch {
      return { ...DEFAULT_SETTINGS, calibrationOverride: { ...DEFAULT_SETTINGS.calibrationOverride } };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem("worldcup-settings-v1", JSON.stringify(settings));
    } catch {}
  }

  let settings = loadSettings();

  function enrichWithDerivedContext(teamList, asOfIso) {
    if (!derivedContextApi) return teamList;
    const ratingUpdated = derivedContextApi.applyResultUpdates(teamList, completedResults, {
      eloK: settings.eloK,
      maxNudge: settings.maxNudge
    });
    return derivedContextApi.applyDerivedContext(ratingUpdated, {
      results: completedResults,
      fixtures,
      historicalResults,
      asOfIso
    });
  }

  function computeCalibration(teamList) {
    if (!derivedContextApi) return { calibration: null, meta: { tuned: false } };
    const tuned = derivedContextApi.calibrateAgainstResults(teamList, completedResults, model, {
      minResults: settings.minResults
    });
    const override = settings.calibrationOverride || {};
    const merged = { ...tuned.calibration };
    if (override.goalRatingDivisor !== null && Number.isFinite(override.goalRatingDivisor)) merged.goalRatingDivisor = override.goalRatingDivisor;
    if (override.hostBonusScale !== null && Number.isFinite(override.hostBonusScale)) merged.hostBonusScale = override.hostBonusScale;
    if (override.baseGoalsScale !== null && Number.isFinite(override.baseGoalsScale)) merged.baseGoalsScale = override.baseGoalsScale;
    return { calibration: merged, meta: tuned };
  }

  const baseTeamsWithContext = mergeTeamContext(teams);
  let teamsWithContext = enrichWithDerivedContext(baseTeamsWithContext, null);
  let activeCalibration = computeCalibration(teamsWithContext).calibration;

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
        ${renderScoreGrid(forecast, isForward)}
        ${renderFactorBreakdown(forecast, isForward)}
      </div>
    `;
  }

  function renderScoreGrid(forecast, isForward) {
    if (!forecast.scoreGrid) return "";
    const rows = forecast.scoreGrid.cells;
    const axisMax = forecast.scoreGrid.axisLabel;
    const reorient = (rowIdx, colIdx) => (isForward ? rows[rowIdx][colIdx] : rows[colIdx][rowIdx]);
    let max = 0;
    for (const row of rows) for (const v of row) if (v > max) max = v;
    const cells = [];
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows.length; c += 1) {
        const p = reorient(r, c);
        const intensity = max > 0 ? Math.min(1, p / max) : 0;
        cells.push(`<div class="grid-cell" style="background: rgba(232, 79, 47, ${0.08 + 0.62 * intensity})" title="${r}-${c}: ${(p * 100).toFixed(1)}%">${p >= 0.05 ? (p * 100).toFixed(0) : ""}</div>`);
      }
    }
    const axisLabels = Array.from({ length: rows.length }, (_, i) => i === axisMax ? `${i}+` : `${i}`);
    return `
      <div class="score-grid-wrap">
        <div class="score-grid-title">Likely scoreline (% chance)</div>
        <div class="score-grid" style="grid-template-columns: 18px repeat(${rows.length}, minmax(0, 1fr))">
          <div class="grid-corner"></div>
          ${axisLabels.map((l) => `<div class="grid-axis">${l}</div>`).join("")}
          ${axisLabels
            .map(
              (rowLabel, rowIdx) => `
                <div class="grid-axis">${rowLabel}</div>
                ${cells.slice(rowIdx * rows.length, (rowIdx + 1) * rows.length).join("")}
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderFactorBreakdown(forecast, isForward) {
    if (!forecast.factorBreakdown || !forecast.factorBreakdown.length) return "";
    const items = forecast.factorBreakdown;
    const maxAbs = items.reduce((acc, item) => Math.max(acc, Math.abs(item.delta)), 0) || 1;
    const rows = items
      .map((item) => {
        const delta = isForward ? item.delta : -item.delta;
        const width = Math.max(2, Math.min(100, (Math.abs(delta) / maxAbs) * 100));
        const side = delta >= 0 ? "favourA" : "favourB";
        const sign = delta > 0 ? "+" : "";
        return `
          <div class="breakdown-row">
            <div class="breakdown-label">${item.factor}</div>
            <div class="breakdown-bar"><div class="breakdown-fill ${side}" style="width: ${width}%"></div></div>
            <div class="breakdown-delta">${sign}${delta}</div>
          </div>
        `;
      })
      .join("");
    return `
      <details class="why-prediction">
        <summary>Why this prediction?</summary>
        <div class="breakdown-list">${rows}</div>
      </details>
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
                    <small class="context-line">Adj ${Math.round(isForward ? forecast.adjustedRatingA : forecast.adjustedRatingB)}</small>
                  </div>
                  <div class="today-vs">vs</div>
                  <div class="today-team">
                    ${fixturesApi.buildFlagLabel(fixture.teamB)}
                    <strong>${fixture.teamB}</strong>
                    <small>${(teamBWin * 100).toFixed(1)}% win</small>
                    <small class="context-line">Adj ${Math.round(isForward ? forecast.adjustedRatingB : forecast.adjustedRatingA)}</small>
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
                ${renderScoreGrid(forecast, isForward)}
                ${renderFactorBreakdown(forecast, isForward)}
              </article>
            `;
          })
          .join("")
      : `<div class="today-empty">No scheduled group-stage matches for this date.</div>`;
  }

  const fmtPct = (value) => `${(value * 100).toFixed(1)}%`;
  const fmtCi = (low, high) => {
    if (low === undefined || high === undefined) return "";
    const half = ((high - low) / 2) * 100;
    return `<small class="ci-band">±${half.toFixed(1)}</small>`;
  };
  const confederationFor = (teamName) => (teamsWithContext.find((t) => t.name === teamName) || {}).confederation || "";

  function renderTopTable(result) {
    const rows = result.probabilities
      .filter((row) => tableState.confederations.has(confederationFor(row.team)))
      .slice();
    const direction = tableState.sortDirection === "asc" ? 1 : -1;
    const col = tableState.sortColumn;
    rows.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (typeof av === "string") return direction * av.localeCompare(bv);
      return direction * ((av || 0) - (bv || 0));
    });

    topTable.innerHTML = "";
    rows.slice(0, 16).forEach((team, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td><button type="button" class="team-link" data-team="${team.team}">${team.team}</button></td>
        <td>${team.group}</td>
        <td>${team.rating}</td>
        <td>${Math.round(team.adjustedRating)}</td>
        <td>${fmtPct(team.winTournament)} ${fmtCi(team.winTournamentLow, team.winTournamentHigh)}</td>
        <td>${fmtPct(team.advanceFromGroup)} ${fmtCi(team.advanceFromGroupLow, team.advanceFromGroupHigh)}</td>
        <td>${fmtPct(team.reachFinal)} ${fmtCi(team.reachFinalLow, team.reachFinalHigh)}</td>
        <td>${fmtPct(team.reachSemiFinals)}</td>
      `;
      topTable.appendChild(tr);
    });

    document.querySelectorAll("#top-table thead th[data-sort]").forEach((th) => {
      const key = th.dataset.sort;
      th.classList.toggle("sort-active", key === col);
      th.classList.toggle("sort-asc", key === col && direction > 0);
      th.classList.toggle("sort-desc", key === col && direction < 0);
    });
  }

  function renderConfedFilters() {
    const host = document.querySelector("#confed-filters");
    if (!host) return;
    host.innerHTML = ["UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC"]
      .map(
        (key) => `<button type="button" class="confed-chip ${tableState.confederations.has(key) ? "active" : ""}" data-confed="${key}">${key}</button>`
      )
      .join("");
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

    renderTopTable(result);

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

  let simWorker = null;
  let pendingRunId = 0;
  let latestResult = null;

  function getWorker() {
    if (simWorker || typeof Worker === "undefined") return simWorker;
    try {
      simWorker = new Worker("./src/sim-worker.js");
      simWorker.onmessage = (event) => {
        const data = event.data || {};
        if (data.runId !== pendingRunId) return;
        setSpinner(false);
        if (data.type === "result") {
          latestResult = data.result;
          render(data.result);
        }
      };
      simWorker.onerror = () => {
        simWorker = null;
        setSpinner(false);
      };
    } catch {
      simWorker = null;
    }
    return simWorker;
  }

  function setSpinner(visible) {
    const el = document.querySelector("#sim-spinner");
    if (!el) return;
    el.classList.toggle("active", !!visible);
  }

  function run() {
    teamsWithContext = enrichWithDerivedContext(baseTeamsWithContext, controls.selectedDate.value);
    activeCalibration = computeCalibration(teamsWithContext).calibration;
    const simulationCount = Number(controls.simulations.value || 5000);
    const seed = Number(controls.seed.value);
    pendingRunId += 1;

    const worker = getWorker();
    if (worker) {
      setSpinner(true);
      worker.postMessage({
        type: "run",
        runId: pendingRunId,
        teams: teamsWithContext,
        simulationCount,
        seed,
        calibration: activeCalibration
      });
      return;
    }

    const result = model.runSimulations(teamsWithContext, simulationCount, seed, activeCalibration);
    latestResult = result;
    render(result);
  }

  controls.run.addEventListener("click", run);
  controls.selectedDate.addEventListener("input", run);

  // ---- Settings drawer ----
  const drawer = document.querySelector("#settings-drawer");
  const drawerBackdrop = document.querySelector("#settings-backdrop");
  const settingsToggle = document.querySelector("#settings-toggle");
  const settingsClose = document.querySelector("#settings-close");
  let debounceHandle = null;
  const debouncedRun = () => {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      run();
    }, 200);
  };
  const openDrawer = () => {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.hidden = false;
  };
  const closeDrawer = () => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.hidden = true;
  };
  settingsToggle.addEventListener("click", openDrawer);
  settingsClose.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);

  const fields = {
    eloK: document.querySelector("#settings-eloK"),
    maxNudge: document.querySelector("#settings-maxNudge"),
    minResults: document.querySelector("#settings-minResults"),
    goalRatingDivisor: document.querySelector("#settings-goalRatingDivisor"),
    hostBonusScale: document.querySelector("#settings-hostBonusScale"),
    baseGoalsScale: document.querySelector("#settings-baseGoalsScale")
  };
  function syncFieldsFromSettings() {
    fields.eloK.value = settings.eloK;
    fields.maxNudge.value = settings.maxNudge;
    fields.minResults.value = settings.minResults;
    fields.goalRatingDivisor.value = settings.calibrationOverride.goalRatingDivisor ?? "";
    fields.hostBonusScale.value = settings.calibrationOverride.hostBonusScale ?? "";
    fields.baseGoalsScale.value = settings.calibrationOverride.baseGoalsScale ?? "";
    document.querySelector("#eloK-value").textContent = settings.eloK;
    document.querySelector("#maxNudge-value").textContent = settings.maxNudge;
  }
  syncFieldsFromSettings();

  function parseOverride(input) {
    if (input.value === "" || input.value === null) return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  fields.eloK.addEventListener("input", () => {
    settings.eloK = Number(fields.eloK.value);
    document.querySelector("#eloK-value").textContent = settings.eloK;
    saveSettings();
    debouncedRun();
  });
  fields.maxNudge.addEventListener("input", () => {
    settings.maxNudge = Number(fields.maxNudge.value);
    document.querySelector("#maxNudge-value").textContent = settings.maxNudge;
    saveSettings();
    debouncedRun();
  });
  fields.minResults.addEventListener("input", () => {
    const value = Number(fields.minResults.value);
    if (Number.isFinite(value) && value >= 0) {
      settings.minResults = value;
      saveSettings();
      debouncedRun();
    }
  });
  ["goalRatingDivisor", "hostBonusScale", "baseGoalsScale"].forEach((key) => {
    fields[key].addEventListener("input", () => {
      settings.calibrationOverride[key] = parseOverride(fields[key]);
      saveSettings();
      debouncedRun();
    });
  });

  document.querySelector("#settings-reset-calibration").addEventListener("click", () => {
    settings.calibrationOverride = { goalRatingDivisor: null, hostBonusScale: null, baseGoalsScale: null };
    saveSettings();
    syncFieldsFromSettings();
    debouncedRun();
  });
  document.querySelector("#settings-reset-all").addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS, calibrationOverride: { ...DEFAULT_SETTINGS.calibrationOverride } };
    saveSettings();
    syncFieldsFromSettings();
    debouncedRun();
  });

  // ---- Team modal ----
  const teamModal = document.querySelector("#team-modal");
  const teamModalBody = document.querySelector("#team-modal-body");
  const teamModalTitle = document.querySelector("#team-modal-title");
  document.querySelector("#team-modal-close").addEventListener("click", () => teamModal.close());
  teamModal.addEventListener("click", (event) => {
    const rect = teamModal.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      teamModal.close();
    }
  });

  function openTeamModal(teamName) {
    if (!latestResult) return;
    const probabilityRow = latestResult.probabilities.find((row) => row.team === teamName);
    if (!probabilityRow) return;
    const teamRecord = teamsWithContext.find((team) => team.name === teamName) || {};
    const ciStr = (p, low, high) => {
      const half = ((high - low) / 2) * 100;
      return `${(p * 100).toFixed(1)}% <small class="ci-band">±${half.toFixed(1)}</small>`;
    };
    const ratingLine = teamRecord.ratingDelta
      ? `${teamRecord.baseRating} → ${teamRecord.rating} <small>(${teamRecord.ratingDelta > 0 ? "+" : ""}${teamRecord.ratingDelta} from results)</small>`
      : `${teamRecord.rating || probabilityRow.rating}`;
    const adjustments = teamRecord.adjustments || {};
    const contextRows = ["form", "squad", "injuries", "fatigue", "chemistry"]
      .map((key) => {
        const value = Number(adjustments[key] || 0);
        return value !== 0 ? `<li>${key}: <strong>${value > 0 ? "+" : ""}${value}</strong></li>` : "";
      })
      .filter(Boolean);
    if (teamRecord.restAdjustment) {
      contextRows.push(`<li>rest: <strong>${teamRecord.restAdjustment > 0 ? "+" : ""}${teamRecord.restAdjustment}</strong></li>`);
    }
    const h2hRows = Object.entries(teamRecord.h2hVs || {}).map(([opp, bias]) => `<li>${opp}: <strong>${bias > 0 ? "+" : ""}${bias}</strong></li>`);
    const matchForecasts = latestResult.groupMatchForecasts
      .filter((forecast) => forecast.teamA === teamName || forecast.teamB === teamName)
      .map((forecast) => {
        const isForward = forecast.teamA === teamName;
        return `
          <article class="modal-match">
            <div class="modal-match-head">
              <strong>${forecast.teamA} vs ${forecast.teamB}</strong>
              <span>Group ${forecast.group}</span>
            </div>
            <div class="modal-match-row">
              <span>${(isForward ? forecast.teamAWin : forecast.teamBWin) * 100 | 0}% win</span>
              <span>Draw ${(forecast.draw * 100).toFixed(0)}%</span>
              <span>${(isForward ? forecast.teamBWin : forecast.teamAWin) * 100 | 0}% loss</span>
            </div>
            ${renderFactorBreakdown(forecast, isForward)}
          </article>
        `;
      })
      .join("");

    teamModalTitle.textContent = teamName;
    teamModalBody.innerHTML = `
      <section class="modal-stats">
        <div><span class="stat-label">Rating</span><strong>${ratingLine}</strong></div>
        <div><span class="stat-label">Group</span><strong>${probabilityRow.group}</strong></div>
        <div><span class="stat-label">Advance</span><strong>${ciStr(probabilityRow.advanceFromGroup, probabilityRow.advanceFromGroupLow, probabilityRow.advanceFromGroupHigh)}</strong></div>
        <div><span class="stat-label">Reach Final</span><strong>${ciStr(probabilityRow.reachFinal, probabilityRow.reachFinalLow, probabilityRow.reachFinalHigh)}</strong></div>
        <div><span class="stat-label">Win Cup</span><strong>${ciStr(probabilityRow.winTournament, probabilityRow.winTournamentLow, probabilityRow.winTournamentHigh)}</strong></div>
      </section>
      ${contextRows.length ? `<section><h4>Context modifiers</h4><ul class="modal-list">${contextRows.join("")}</ul></section>` : ""}
      ${h2hRows.length ? `<section><h4>Head-to-head biases</h4><ul class="modal-list">${h2hRows.join("")}</ul></section>` : ""}
      <section><h4>Group-stage forecasts</h4>${matchForecasts || "<p>No forecasts available.</p>"}</section>
    `;
    if (typeof teamModal.showModal === "function") teamModal.showModal();
    else teamModal.setAttribute("open", "");
  }

  // ---- Sortable + filterable top table ----
  const ALL_CONFEDS = ["UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC"];
  const tableState = {
    sortColumn: "winTournament",
    sortDirection: "desc",
    confederations: new Set(ALL_CONFEDS)
  };

  renderConfedFilters();

  document.querySelectorAll("#top-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const column = th.dataset.sort;
      if (tableState.sortColumn === column) {
        tableState.sortDirection = tableState.sortDirection === "asc" ? "desc" : "asc";
      } else {
        tableState.sortColumn = column;
        tableState.sortDirection = column === "team" || column === "group" ? "asc" : "desc";
      }
      if (latestResult) renderTopTable(latestResult);
    });
  });

  document.querySelector("#confed-filters").addEventListener("click", (event) => {
    const target = event.target.closest("[data-confed]");
    if (!target) return;
    const key = target.dataset.confed;
    if (tableState.confederations.has(key)) {
      tableState.confederations.delete(key);
    } else {
      tableState.confederations.add(key);
    }
    target.classList.toggle("active");
    if (latestResult) renderTopTable(latestResult);
  });

  topTable.addEventListener("click", (event) => {
    const target = event.target.closest("[data-team]");
    if (!target) return;
    openTeamModal(target.dataset.team);
  });

  run();
}

main();
