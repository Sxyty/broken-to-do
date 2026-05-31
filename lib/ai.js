const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";

async function generateTasks(tasks) {
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

  return { tasks: generatedTasks };
}

async function summarizeTasks(tasks) {
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
  return { summary: parsed.summary || "Brak podsumowania." };
}

async function callOpenAI({ instructions, input, schemaName, schema }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error("Brak OPENAI_API_KEY w zmiennych srodowiskowych.");
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

module.exports = {
  generateTasks,
  summarizeTasks
};
