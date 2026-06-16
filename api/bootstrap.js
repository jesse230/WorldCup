const { loadAppData } = require("../lib/data-store");

module.exports = async function handler(_request, response) {
  try {
    const data = await loadAppData();
    response.status(200).json(data);
  } catch (error) {
    response.status(500).json({
      error: "bootstrap_failed",
      message: error.message
    });
  }
};
