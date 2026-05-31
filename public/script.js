const authSection = document.getElementById("authSection");
const todoSection = document.getElementById("todoSection");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authUsername = document.getElementById("username");
const authPassword = document.getElementById("password");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authToggleBtn = document.getElementById("authToggleBtn");
const authModeHint = document.getElementById("authModeHint");
const authMessage = document.getElementById("authMessage");
const currentUserName = document.getElementById("currentUserName");
const logoutBtn = document.getElementById("logoutBtn");

const form = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const prioritySelect = document.getElementById("priority");
const taskList = document.getElementById("taskList");
const summary = document.getElementById("summary");
const clearAllBtn = document.getElementById("clearAllBtn");
const generateAiTasksBtn = document.getElementById("generateAiTasksBtn");
const summarizeAiTasksBtn = document.getElementById("summarizeAiTasksBtn");
const aiMessage = document.getElementById("aiMessage");

const DB_NAME = "todoApp";
const DB_VERSION = 2;
const TASK_STORE = "tasks";
const USER_STORE = "users";
const SESSION_KEY = "todoApp.currentUserId";

let db = null;
let tasks = [];
let currentUser = null;
let authMode = "login";

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Database failed to open");
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      const transaction = event.target.transaction;
      let taskStore;

      if (!database.objectStoreNames.contains(TASK_STORE)) {
        taskStore = database.createObjectStore(TASK_STORE, { keyPath: "id" });
      } else {
        taskStore = transaction.objectStore(TASK_STORE);
      }

      if (!taskStore.indexNames.contains("userId")) {
        taskStore.createIndex("userId", "userId", { unique: false });
      }

      if (!database.objectStoreNames.contains(USER_STORE)) {
        const userStore = database.createObjectStore(USER_STORE, { keyPath: "id" });
        userStore.createIndex("username", "username", { unique: true });
      }
    };
  });
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function getUserById(userId) {
  const transaction = db.transaction([USER_STORE], "readonly");
  const store = transaction.objectStore(USER_STORE);
  return requestAsPromise(store.get(userId));
}

function getUserByUsername(username) {
  const transaction = db.transaction([USER_STORE], "readonly");
  const store = transaction.objectStore(USER_STORE);
  const usernameIndex = store.index("username");
  return requestAsPromise(usernameIndex.get(username));
}

function saveUser(user) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([USER_STORE], "readwrite");
    const store = transaction.objectStore(USER_STORE);

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(user);

    store.add(user);
  });
}

function loadTasksFromDB() {
  if (!currentUser) {
    tasks = [];
    renderTasks();
    return Promise.resolve();
  }

  const transaction = db.transaction([TASK_STORE], "readonly");
  const store = transaction.objectStore(TASK_STORE);
  const userIndex = store.index("userId");

  return requestAsPromise(userIndex.getAll(currentUser.id)).then((savedTasks) => {
    tasks = savedTasks.sort((firstTask, secondTask) => {
      return getTaskTimestamp(firstTask) - getTaskTimestamp(secondTask);
    });
    renderTasks();
  });
}

function saveToDB() {
  if (!currentUser) {
    return Promise.resolve();
  }

  tasks = tasks.map((task) => ({
    ...task,
    id: task.id || createId(),
    userId: currentUser.id,
    priority: task.priority || "low"
  }));

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TASK_STORE], "readwrite");
    const store = transaction.objectStore(TASK_STORE);
    const userIndex = store.index("userId");
    const keysRequest = userIndex.getAllKeys(currentUser.id);

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();

    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((taskKey) => {
        store.delete(taskKey);
      });

      tasks.forEach((task) => {
        store.put({
          ...task,
          updatedAt: new Date().toISOString()
        });
      });
    };
  });
}

function claimLegacyTasks() {
  if (!currentUser) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TASK_STORE], "readwrite");
    const store = transaction.objectStore(TASK_STORE);
    const request = store.getAll();

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();

    request.onsuccess = () => {
      request.result
        .filter((task) => !task.userId)
        .forEach((task) => {
          store.put({
            ...task,
            userId: currentUser.id,
            updatedAt: new Date().toISOString()
          });
        });
    };
  });
}

function getTaskTimestamp(task) {
  if (task.createdAt) {
    return new Date(task.createdAt).getTime();
  }

  return Number(task.id) || 0;
}

function createId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generateSalt() {
  if (window.crypto && crypto.getRandomValues) {
    const values = crypto.getRandomValues(new Uint8Array(16));
    return bytesToHex(values);
  }

  return Math.random().toString(36).slice(2);
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  const value = `${salt}:${password}`;

  if (window.crypto && crypto.subtle) {
    const encoder = new TextEncoder();
    const encodedValue = encoder.encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedValue);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  return fallbackHash(value);
}

function fallbackHash(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `fallback-${(hash >>> 0).toString(16)}`;
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function validateCredentials() {
  const username = normalizeUsername(authUsername.value);
  const password = authPassword.value;

  if (username.length < 3) {
    throw new Error("Nazwa użytkownika musi mieć co najmniej 3 znaki.");
  }

  if (password.length < 4) {
    throw new Error("Hasło musi mieć co najmniej 4 znaki.");
  }

  return { username, password };
}

async function registerUser(username, password) {
  const existingUser = await getUserByUsername(username);

  if (existingUser) {
    throw new Error("Taki użytkownik już istnieje.");
  }

  const salt = generateSalt();
  const user = {
    id: createId(),
    username,
    salt,
    passwordHash: await hashPassword(password, salt),
    createdAt: new Date().toISOString()
  };

  await saveUser(user);
  await setCurrentUser(user);
}

async function logInUser(username, password) {
  const user = await getUserByUsername(username);

  if (!user) {
    throw new Error("Nie znaleziono użytkownika.");
  }

  const passwordHash = await hashPassword(password, user.salt);

  if (passwordHash !== user.passwordHash) {
    throw new Error("Nieprawidłowe hasło.");
  }

  await setCurrentUser(user);
}

async function restoreSession() {
  const userId = localStorage.getItem(SESSION_KEY);

  if (!userId) {
    showAuth();
    return;
  }

  const savedUser = await getUserById(userId);

  if (!savedUser) {
    showAuth();
    return;
  }

  await setCurrentUser(savedUser);
}

async function setCurrentUser(user) {
  currentUser = user;
  localStorage.setItem(SESSION_KEY, user.id);
  await showTodo();
}

function showAuth() {
  currentUser = null;
  tasks = [];
  localStorage.removeItem(SESSION_KEY);
  todoSection.hidden = true;
  authSection.hidden = false;
  renderTasks();
  authForm.reset();
  setAuthMode("login");
  authUsername.focus();
}

async function showTodo() {
  authSection.hidden = true;
  todoSection.hidden = false;
  currentUserName.textContent = currentUser.username;
  setAuthMessage("");
  await claimLegacyTasks();
  await loadTasksFromDB();
  taskInput.focus();
}

function setAuthMode(mode) {
  authMode = mode;
  setAuthMessage("");

  if (authMode === "login") {
    authTitle.textContent = "Zaloguj się";
    authSubmitBtn.textContent = "Zaloguj";
    authModeHint.textContent = "Nie masz konta?";
    authToggleBtn.textContent = "Utwórz konto";
    authPassword.autocomplete = "current-password";
    return;
  }

  authTitle.textContent = "Utwórz konto";
  authSubmitBtn.textContent = "Zarejestruj";
  authModeHint.textContent = "Masz już konto?";
  authToggleBtn.textContent = "Zaloguj się";
  authPassword.autocomplete = "new-password";
}

function setAuthMessage(message, type = "error") {
  authMessage.textContent = message;
  authMessage.className = `auth-message ${type}`;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authSubmitBtn.disabled = true;

  try {
    const { username, password } = validateCredentials();

    if (authMode === "login") {
      await logInUser(username, password);
    } else {
      await registerUser(username, password);
    }
  } catch (error) {
    setAuthMessage(error.message || "Nie udało się zalogować.");
  } finally {
    authSubmitBtn.disabled = false;
  }
});

authToggleBtn.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

logoutBtn.addEventListener("click", () => {
  showAuth();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    return;
  }

  const text = taskInput.value.trim();
  const priority = prioritySelect.value;

  if (text === "") {
    alert("Wpisz treść zadania.");
    return;
  }

  tasks.push({
    id: createId(),
    userId: currentUser.id,
    text,
    priority,
    completed: false,
    createdAt: new Date().toISOString()
  });

  taskInput.value = "";
  renderTasks();
  await saveToDB();
});

function renderTasks() {
  taskList.innerHTML = "";

  tasks.forEach((task, index) => {
    const li = document.createElement("li");
    li.classList.add(task.priority || "low");

    const span = document.createElement("span");
    span.textContent = task.text;

    if (task.completed) {
      span.classList.add("done");
    }

    const actionsDiv = document.createElement("div");
    actionsDiv.classList.add("task-actions");
    actionsDiv.innerHTML = `
      <button class="complete-btn" data-index="${index}">Zrobione</button>
      <button class="delete-btn" data-index="${index}">Usuń</button>
    `;

    li.appendChild(span);
    li.appendChild(actionsDiv);
    taskList.appendChild(li);
  });

  updateSummary();
}

taskList.addEventListener("click", async (event) => {
  const index = Number(event.target.dataset.index);

  if (Number.isNaN(index)) {
    return;
  }

  if (event.target.classList.contains("complete-btn")) {
    tasks[index].completed = !tasks[index].completed;
    renderTasks();
    await saveToDB();
  }

  if (event.target.classList.contains("delete-btn")) {
    tasks.splice(index, 1);
    renderTasks();
    await saveToDB();
  }
});

async function clearAllTasks() {
  if (tasks.length === 0) {
    alert("Brak zadań do usunięcia.");
    return;
  }

  if (confirm("Jesteś pewny? Wszystkie zadania zostaną usunięte!")) {
    tasks = [];
    renderTasks();
    await saveToDB();
  }
}

clearAllBtn.addEventListener("click", clearAllTasks);

generateAiTasksBtn.addEventListener("click", generateAiTasks);
summarizeAiTasksBtn.addEventListener("click", summarizeAiTasks);

function updateSummary() {
  summary.textContent = "Liczba zadań: " + tasks.length;
}

async function generateAiTasks() {
  if (!currentUser) {
    return;
  }

  setAiLoading(true, "Generuję nowe zadania...");

  try {
    const result = await postAiRequest("/api/ai/generate-tasks");
    const createdAt = new Date().toISOString();
    const generatedTasks = result.tasks.map((task) => ({
      id: createId(),
      userId: currentUser.id,
      text: task.text,
      priority: task.priority,
      completed: false,
      createdAt
    }));

    tasks.push(...generatedTasks);
    renderTasks();
    await saveToDB();
    setAiMessage(`Dodano ${generatedTasks.length} zadania wygenerowane przez AI.`, "success");
  } catch (error) {
    setAiMessage(error.message || "Nie udało się wygenerować zadań.");
  } finally {
    setAiLoading(false);
  }
}

async function summarizeAiTasks() {
  if (!currentUser) {
    return;
  }

  setAiLoading(true, "Tworzę podsumowanie...");

  try {
    const result = await postAiRequest("/api/ai/summarize-tasks");
    setAiMessage(result.summary, "success");
  } catch (error) {
    setAiMessage(error.message || "Nie udało się podsumować zadań.");
  } finally {
    setAiLoading(false);
  }
}

async function postAiRequest(url) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tasks: tasks.map((task) => ({
        text: task.text,
        priority: task.priority || "low",
        completed: Boolean(task.completed)
      }))
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Serwer AI zwrócił błąd.");
  }

  return data;
}

function setAiLoading(isLoading, message = "") {
  generateAiTasksBtn.disabled = isLoading;
  summarizeAiTasksBtn.disabled = isLoading;

  if (message) {
    setAiMessage(message);
  }
}

function setAiMessage(message, type = "error") {
  aiMessage.textContent = message;
  aiMessage.className = `ai-message ${type}`;
}

initDB().then(restoreSession).catch((error) => {
  console.error("Failed to initialize database:", error);
  alert("Błąd podczas inicjalizacji bazy danych. Dane nie będą zachowywane.");
});
