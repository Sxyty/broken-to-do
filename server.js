const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";

loadDotEnv(path.join(ROOT, ".env"));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/ai/generate-tasks") {
      await handleGenerateTasks(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/summarize-tasks") {
      await handleSummarizeTasks(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Metoda nie jest obsługiwana." });
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.message || "Wystąpił błąd serwera." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aplikacja działa pod adresem http://${HOST}:${PORT}`);
});

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const entries = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  entries.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

async function handleGenerateTasks(req, res) {
  const { tasks } = await readJsonBody(req);
  const savedTasks = normalizeTasks(tasks);
  const response = await callOpenAI({
    instructions: [
      "Jestes asystentem produktywnosci dla prostej listy zadan.",
      "Odpowiadaj tylko poprawnym JSON zgodnym ze schematem.",
      "Wygeneruj 3 nowe, konkretne zadania po polsku.",
      "Nie powielaj istniejacych zadan.",
      "Priorytet musi byc jednym z: low, medium, high."
    ].join(" "),
    input: `Istniejace zadania JSON:\n${JSON.stringify(savedTasks, null, 2)}`,
    schemaName: "generated_tasks",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["text", "priority"]
          }
        }
      },
      required: ["tasks"]
    }
  });

  const parsed = parseJsonOutput(response);
  const generatedTasks = normalizeTasks(parsed.tasks).filter((task) => task.text);

  if (generatedTasks.length === 0) {
    throw new Error("OpenAI nie zwrocil zadnych zadan.");
  }

  sendJson(res, 200, { tasks: generatedTasks });
}

async function handleSummarizeTasks(req, res) {
  const { tasks } = await readJsonBody(req);
  const savedTasks = normalizeTasks(tasks);
  const response = await callOpenAI({
    instructions: [
      "Jestes asystentem produktywnosci dla prostej listy zadan.",
      "Odpowiadaj tylko poprawnym JSON zgodnym ze schematem.",
      "Podsumuj stan zadan po polsku w maksymalnie 3 zdaniach.",
      "Uwzglednij liczbe zadan wykonanych, niewykonanych i najwazniejsze priorytety."
    ].join(" "),
    input: `Zadania JSON:\n${JSON.stringify(savedTasks, null, 2)}`,
    schemaName: "task_summary",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" }
      },
      required: ["summary"]
    }
  });

  const parsed = parseJsonOutput(response);
  sendJson(res, 200, { summary: parsed.summary || "Brak podsumowania." });
}

async function callOpenAI({ instructions, input, schemaName, schema }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error("Brak OPENAI_API_KEY w pliku .env.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      instructions,
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || "OpenAI API zwrocilo blad.";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function parseJsonOutput(response) {
  const outputText = response.output_text || findOutputText(response.output);

  if (!outputText) {
    throw new Error("OpenAI API nie zwrocilo tekstu odpowiedzi.");
  }

  return JSON.parse(outputText);
}

function findOutputText(output) {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("");
}

function normalizeTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) {
    return [];
  }

  return rawTasks.map((task) => ({
    text: String(task.text || "").trim(),
    priority: ["low", "medium", "high"].includes(task.priority) ? task.priority : "low",
    completed: Boolean(task.completed)
  }));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1000000) {
        req.destroy();
        reject(new Error("Zbyt duze zapytanie."));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Niepoprawny JSON."));
      }
    });

    req.on("error", reject);
  });
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Brak dostepu." });
    return;
  }

  if (path.basename(filePath) === ".env" || path.basename(filePath) === ".env.example") {
    sendJson(res, 404, { error: "Nie znaleziono pliku." });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Nie znaleziono pliku." });
      return;
    }

    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(content);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extension] || "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
