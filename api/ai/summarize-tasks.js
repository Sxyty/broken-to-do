const { summarizeTasks } = require("../../lib/ai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metoda nie jest obsługiwana." });
    return;
  }

  try {
    const body = getBody(req);
    const result = await summarizeTasks(body.tasks);
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || "Wystąpił błąd serwera." });
  }
};

function getBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}
