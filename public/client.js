// ===================================================================
// The chat client - it is ready, you don't need to change this file.
// Read it to see which events it sends (emit) and which it listens to (on).
// Your job is the server in server.js.
// ===================================================================

const joinScreen = document.getElementById("join-screen");
const joinForm = document.getElementById("join-form");
const nicknameInput = document.getElementById("nickname-input");
const joinError = document.getElementById("join-error");
const statusEl = document.getElementById("connection-status");

const chatScreen = document.getElementById("chat-screen");
const usersList = document.getElementById("users-list");
const usersCount = document.getElementById("users-count");
const meEl = document.getElementById("me");
const messagesEl = document.getElementById("messages");
const typingEl = document.getElementById("typing");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let myNickname = null;
let joining = false; // true from pressing "join" until the server answers
let lastUsers = [];

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind || ""}`;
}

function showJoinError(text) {
  joinError.textContent = text;
  joinError.hidden = false;
}

// /socket.io/socket.io.js did not load -> the Socket.io server is not attached yet
if (typeof io === "undefined") {
  setStatus("לא נמצא /socket.io/socket.io.js - האם חיברתן את Socket.io לשרת? (שלב 1)", "offline");
  throw new Error("Socket.io client not found - attach a Socket.io server to your http server (step 1)");
}

// Connects to the same server that served this page
const socket = io();

socket.on("connect", () => setStatus("מחוברת לשרת ✓", "online"));
socket.on("connect_error", () => setStatus("אין חיבור לשרת - האם השרת רץ?", "offline"));
socket.on("disconnect", () => setStatus("החיבור לשרת נותק", "offline"));

// ---------- joining ----------
joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinError.hidden = true;
  joining = true;
  const nickname = nicknameInput.value;

  // If the server never calls the callback, tell the student why nothing happens
  const noAnswer = setTimeout(() => {
    showJoinError("השרת לא ענה ל-join. האם קראתן ל-callback בשרת? (שלב 2)");
  }, 3000);

  // emit with a callback (acknowledgement): the server answers { ok, error }
  socket.emit("join", nickname, (answer) => {
    clearTimeout(noAnswer);
    joining = false;
    if (!answer || !answer.ok) {
      messagesEl.innerHTML = "";
      showJoinError((answer && answer.error) || "לא הצלחנו להיכנס לצ'אט");
      return;
    }
    myNickname = nickname.trim();
    meEl.textContent = `מחוברת בתור ${myNickname}`;
    joinScreen.hidden = true;
    chatScreen.hidden = false;
    renderUsers(lastUsers);
    messageInput.focus();
    loadHistory();
  });
});

// Bonus: older messages from GET /api/messages (ignored if the route does not exist yet)
async function loadHistory() {
  try {
    const res = await fetch("/api/messages");
    if (!res.ok) return;
    const history = await res.json();
    if (!Array.isArray(history) || history.length === 0) return;
    const marker = messagesEl.firstChild;
    for (const message of history) messagesEl.insertBefore(renderMessage(message), marker);
    addSystem("— הודעות קודמות —", marker);
    scrollDown();
  } catch {
    // no history - that's fine
  }
}

// ---------- sending ----------
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value;
  if (!text.trim()) return;
  socket.emit("chat:message", text);
  messageInput.value = "";
  messageInput.focus();
});

// Tell the others that I am typing (at most once a second)
let lastTyping = 0;
messageInput.addEventListener("input", () => {
  if (Date.now() - lastTyping < 1000) return;
  lastTyping = Date.now();
  socket.emit("typing");
});

// ---------- receiving ----------
const inChat = () => myNickname !== null || joining;

socket.on("chat:message", (message) => {
  if (!inChat()) return;
  stopTyping(message.nickname);
  messagesEl.appendChild(renderMessage(message));
  scrollDown();
});

socket.on("system", (text) => {
  if (!inChat()) return;
  addSystem(text);
  scrollDown();
});

socket.on("users", (users) => {
  lastUsers = Array.isArray(users) ? users : [];
  renderUsers(lastUsers);
});

function renderUsers(users) {
  usersList.innerHTML = "";
  for (const name of users) {
    const li = document.createElement("li");
    li.textContent = name === myNickname ? `${name} (את)` : name;
    if (name === myNickname) li.classList.add("me");
    usersList.appendChild(li);
  }
  usersCount.textContent = users.length;
}

const typingNow = new Map(); // nickname -> timeout id
socket.on("typing", (nickname) => {
  clearTimeout(typingNow.get(nickname));
  typingNow.set(nickname, setTimeout(() => stopTyping(nickname), 2000));
  renderTyping();
});

function stopTyping(nickname) {
  clearTimeout(typingNow.get(nickname));
  typingNow.delete(nickname);
  renderTyping();
}

function renderTyping() {
  const names = [...typingNow.keys()];
  if (names.length === 0) typingEl.textContent = "";
  else if (names.length === 1) typingEl.textContent = `${names[0]} מקלידה...`;
  else typingEl.textContent = `${names.join(", ")} מקלידות...`;
}

// ---------- rendering helpers ----------
function renderMessage({ nickname, text, time }) {
  const li = document.createElement("li");
  li.className = nickname === myNickname ? "message mine" : "message";

  const meta = document.createElement("div");
  meta.className = "meta";
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = nickname;
  const when = document.createElement("span");
  const date = new Date(time);
  when.textContent = isNaN(date) ? "" : date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  meta.append(author, when);

  const body = document.createElement("div");
  body.className = "text";
  body.textContent = text;

  li.append(meta, body);
  return li;
}

function addSystem(text, before = null) {
  const li = document.createElement("li");
  li.className = "system";
  li.textContent = text;
  messagesEl.insertBefore(li, before);
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
