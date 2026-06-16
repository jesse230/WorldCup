const { persistState } = require("../lib/data-store");
const { refreshSquads } = require("../scripts/fetch-squads");
const { refreshResults } = require("../scripts/fetch-results");

function isAuthorized(request) {
  const expectedToken = process.env.CRON_SECRET || process.env.REFRESH_SECRET;

  if (!expectedToken) {
    return true;
  }

  const authHeader = request.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return bearerToken === expectedToken;
}

module.exports = async function handler(request, response) {
  if (!isAuthorized(request)) {
    response.status(401).json({
      error: "unauthorized"
    });
    return;
  }

  const target = request.query.target || "all";
  const updated = {};

  try {
    if (target === "all" || target === "squads") {
      const squadContext = await refreshSquads({ persist: false });
      await persistState("squad_context", squadContext);
      updated.squadContext = squadContext.updatedAt;
    }

    if (target === "all" || target === "results") {
      const results = await refreshResults({ persist: false });
      await persistState("results", results);
      updated.results = results.length;
    }

    response.status(200).json({
      ok: true,
      target,
      updated
    });
  } catch (error) {
    response.status(500).json({
      error: "refresh_failed",
      target,
      message: error.message
    });
  }
};
