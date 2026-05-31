const fs = require("fs");
const http = require("http");
const path = require("path");
const { generateTasks, summarizeTasks } = require("./lib/ai");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PROJECT_ROOT = __dirname;
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");

loadDotEnv(path.join(PROJECT_ROOT, ".env"));

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
  const result = await generateTasks(tasks);
  sendJson(res, 200, result);
}

async function handleSummarizeTasks(req, res) {
  const { tasks } = await readJsonBody(req);
  const result = await summarizeTasks(tasks);
  sendJson(res, 200, result);
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
  const filePath = path.normalize(path.join(PUBLIC_ROOT, safePath));

  if (!filePath.startsWith(PUBLIC_ROOT)) {
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
