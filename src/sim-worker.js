self.importScripts("./fixtures.js", "./predictor.js", "./derived-context.js");

self.onmessage = function (event) {
  const data = event.data || {};
  if (data.type !== "run") return;

  const { runId, teams, simulationCount, seed, calibration } = data;

  try {
    const result = self.WorldCupPredictor.runSimulations(teams, simulationCount, seed, calibration);
    self.postMessage({ type: "result", runId, result });
  } catch (error) {
    self.postMessage({ type: "error", runId, message: error && error.message ? error.message : String(error) });
  }
};
