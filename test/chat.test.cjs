const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, describe, sameText, sleep } = require("./server-helpers.cjs");

const JOINED = (name) => `${name} הצטרפה לצ'אט`;
const LEFT = (name) => `${name} עזבה את הצ'אט`;
const EMPTY_ERROR = "חובה להזין כינוי";
const TAKEN_ERROR = "הכינוי כבר תפוס";

const sameUsers = (list, expected) =>
  Array.isArray(list) && list.length === expected.length && [...list].sort().join("|") === [...expected].sort().join("|");

/** Starts server.js for one test and stops it when the test ends. */
function chatServer(t) {
  const server = startServer();
  t.after(() => server.stop());
  return server;
}

// ---------------------------------------------------------------- Step 1

test("Step 1: GET / serves the chat page from the public folder", async (t) => {
  const server = chatServer(t);
  const res = await server.request("GET", "/");
  assert.equal(res.status, 200, `GET / should return public/index.html - use app.use(express.static("public")) ${describe(res)}`);
  assert.ok(res.text.includes("Analiza Chat") && res.text.includes("join-form"), "GET / should return the chat page (public/index.html)");
  const script = await server.request("GET", "/client.js");
  assert.equal(script.status, 200, "GET /client.js should return public/client.js - serve the whole public folder");
});

test("Step 1: Socket.io is attached to the server (GET /socket.io/socket.io.js works)", async (t) => {
  const server = chatServer(t);
  const res = await server.request("GET", "/socket.io/socket.io.js");
  assert.equal(
    res.status,
    200,
    `GET /socket.io/socket.io.js should return the Socket.io client - attach new Server(server) to the same http server that listens on 3000 (const server = http.createServer(app) ... server.listen(3000)) ${describe(res)}`
  );
});

test("Step 1: a client can connect and the server prints 'User connected: <socket.id>'", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const printed = await server.waitForOutput((lines) => lines.some((l) => l.includes(dana.id)));
  assert.ok(printed, `on every connection print: User connected: <socket.id> (the client's id was ${dana.id})${server.printedNote()}`);
  assert.ok(
    server.outputLines().some((l) => l.includes(dana.id) && /connected/i.test(l)),
    `the line should look like: User connected: ${dana.id}${server.printedNote()}`
  );
});

// ---------------------------------------------------------------- Step 2

test("Step 2: join with a valid nickname answers { ok: true }", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const answer = await dana.joinAnswer("Dana");
  assert.equal(answer && answer.ok, true, `call callback({ ok: true }) when the nickname is fine (got ${JSON.stringify(answer)})`);
});

test("Step 2: an empty nickname is rejected with 'חובה להזין כינוי'", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  for (const nickname of ["", "   "]) {
    const answer = await dana.joinAnswer(nickname);
    assert.equal(answer && answer.ok, false, `joining with ${JSON.stringify(nickname)} should answer ok: false (got ${JSON.stringify(answer)})`);
    assert.ok(sameText(answer.error, EMPTY_ERROR), `joining with ${JSON.stringify(nickname)} should answer error: "${EMPTY_ERROR}" (got ${JSON.stringify(answer)})`);
  }
});

test("Step 2: a nickname that is already taken is rejected with 'הכינוי כבר תפוס'", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const other = await server.connect("second tab");
  await dana.join("Dana");
  const answer = await other.joinAnswer("Dana");
  assert.equal(answer && answer.ok, false, `a second "Dana" should answer ok: false (got ${JSON.stringify(answer)})`);
  assert.ok(sameText(answer.error, TAKEN_ERROR), `a second "Dana" should answer error: "${TAKEN_ERROR}" (got ${JSON.stringify(answer)})`);
});

test("Step 2: everyone gets the system message '<nickname> הצטרפה לצ'אט'", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await dana.waitFor("system", (text) => sameText(text, JOINED("Dana")), `"system" with "${JOINED("Dana")}"`);
  await michal.join("Michal");
  await dana.waitFor("system", (text) => sameText(text, JOINED("Michal")), `"system" with "${JOINED("Michal")}" - send it to everyone with io.emit`);
  await michal.waitFor("system", (text) => sameText(text, JOINED("Michal")), `"system" with "${JOINED("Michal")}" - the one who joined gets it too (io.emit)`);
});

test("Step 2: everyone gets the updated 'users' list, and the nickname is trimmed", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await dana.waitFor("users", (list) => sameUsers(list, ["Dana"]), `"users" with ["Dana"]`);
  await michal.join("  Michal  ");
  const what = `"users" with ["Dana", "Michal"] (an array of nicknames, without the spaces around "  Michal  ")`;
  await dana.waitFor("users", (list) => sameUsers(list, ["Dana", "Michal"]), what);
  await michal.waitFor("users", (list) => sameUsers(list, ["Dana", "Michal"]), what);
});

test("Step 2: a rejected join does not add anyone to the users list", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const other = await server.connect("second tab");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await other.joinAnswer("Dana");
  await other.joinAnswer("");
  await michal.join("Michal");
  await michal.waitFor("users", (list) => Array.isArray(list) && list.includes("Michal"), `"users" with "Michal"`);
  const last = michal.all("users").at(-1)[0];
  assert.ok(sameUsers(last, ["Dana", "Michal"]), `after a rejected join the users list should still be ["Dana", "Michal"] (got ${JSON.stringify(last)})`);
  await dana.waitFor("system", (text) => sameText(text, JOINED("Michal")), `"system" with "${JOINED("Michal")}"`);
  const joins = dana.all("system").map(([text]) => text).filter((text) => typeof text === "string" && /הצטרפה/.test(text));
  assert.equal(joins.length, 2, `only Dana and Michal joined - a rejected join should not send a "joined" message (got: ${joins.join(" | ")})`);
});

// ---------------------------------------------------------------- Step 3

test("Step 3: a chat message reaches everyone (also the sender) as { nickname, text, time }", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await michal.join("Michal");
  dana.emit("chat:message", "Hi everyone!");
  const isHi = (m) => m && m.text === "Hi everyone!";
  const [message] = await michal.waitFor("chat:message", isHi, `"chat:message" with text "Hi everyone!" - send it to everyone with io.emit`);
  await dana.waitFor("chat:message", isHi, `her own "chat:message" back - the sender gets it too (io.emit, not socket.broadcast.emit)`);
  assert.equal(message.nickname, "Dana", `the message should have nickname: "Dana" - the nickname of the socket that sent it (got ${JSON.stringify(message)})`);
  assert.ok(typeof message.time === "string" && !isNaN(Date.parse(message.time)), `the message should have time: new Date().toISOString() (got ${JSON.stringify(message)})`);
});

test("Step 3: the text is trimmed and empty messages are not sent", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await michal.join("Michal");
  dana.emit("chat:message", "   ");
  dana.emit("chat:message", "");
  dana.emit("chat:message", "  hello  ");
  await michal.waitFor("chat:message", (m) => m && m.text === "hello", `"chat:message" with text "hello" (trimmed from "  hello  ")`);
  await sleep(200);
  const texts = michal.all("chat:message").map(([m]) => JSON.stringify(m && m.text));
  assert.equal(texts.length, 1, `empty messages ("   ", "") should not be sent to anyone (got texts: ${texts.join(", ")})`);
});

test("Step 3: a socket that did not join cannot send messages", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const stranger = await server.connect("stranger");
  await dana.join("Dana");
  stranger.emit("chat:message", "I did not join");
  dana.emit("chat:message", "I did");
  await dana.waitFor("chat:message", (m) => m && m.text === "I did", `"chat:message" with text "I did"`);
  await sleep(200);
  assert.ok(
    !dana.all("chat:message").some(([m]) => m && m.text === "I did not join"),
    "a message from a socket without a nickname (never joined) should be ignored"
  );
});

// ---------------------------------------------------------------- Step 4

test("Step 4: 'typing' goes to everyone except the sender, with her nickname", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  const noa = await server.connect("Noa");
  await dana.join("Dana");
  await michal.join("Michal");
  await noa.join("Noa");
  dana.emit("typing");
  await michal.waitFor("typing", (name) => name === "Dana", `"typing" with "Dana"`);
  await noa.waitFor("typing", (name) => name === "Dana", `"typing" with "Dana"`);
  await sleep(200);
  assert.equal(dana.all("typing").length, 0, "the one who types should NOT get her own \"typing\" - use socket.broadcast.emit");
});

// ---------------------------------------------------------------- Step 5

test("Step 5: when someone disconnects, the others get '<nickname> עזבה את הצ'אט' and the new users list", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await michal.join("Michal");
  await dana.waitFor("users", (list) => sameUsers(list, ["Dana", "Michal"]), `"users" with ["Dana", "Michal"]`);
  michal.disconnect();
  await dana.waitFor("system", (text) => sameText(text, LEFT("Michal")), `"system" with "${LEFT("Michal")}" - listen to socket.on("disconnect")`);
  await dana.waitFor("users", (list) => sameUsers(list, ["Dana"]), `"users" with ["Dana"] after Michal left`);
});

test("Step 5: the nickname is free again after its owner leaves", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const michal = await server.connect("Michal");
  await dana.join("Dana");
  await michal.join("Michal");
  michal.disconnect();
  await dana.waitFor("users", (list) => sameUsers(list, ["Dana"]), `"users" with ["Dana"] after Michal left`);
  const again = await server.connect("Michal again");
  const answer = await again.joinAnswer("Michal");
  assert.equal(answer && answer.ok, true, `after Michal left, joining as "Michal" again should answer { ok: true } (got ${JSON.stringify(answer)})`);
});

test("Step 5: a socket that never joined leaves quietly", async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  const stranger = await server.connect("stranger");
  await dana.join("Dana");
  await dana.waitFor("system", (text) => sameText(text, JOINED("Dana")), `"system" with "${JOINED("Dana")}"`);
  stranger.disconnect();
  dana.emit("chat:message", "still here");
  await dana.waitFor("chat:message", (m) => m && m.text === "still here", `"chat:message" with text "still here"`);
  await sleep(200);
  const leaves = dana.all("system").filter(([text]) => typeof text === "string" && /עזב/.test(text));
  assert.equal(leaves.length, 0, `a socket that never joined has no nickname - don't send a "left" message for it (got: ${leaves.map(([x]) => x).join(" | ")})`);
});

// ---------------------------------------------------------------- Bonus

test("Bonus: GET /api/messages returns the last 20 chat messages", { todo: "bonus" }, async (t) => {
  const server = chatServer(t);
  const dana = await server.connect("Dana");
  await dana.join("Dana");
  for (let i = 1; i <= 22; i++) dana.emit("chat:message", `message ${i}`);
  await dana.waitFor("chat:message", (m) => m && m.text === "message 22", `"chat:message" with text "message 22"`);
  const res = await server.request("GET", "/api/messages");
  assert.equal(res.status, 200, `GET /api/messages should answer 200 ${describe(res)}`);
  assert.ok(Array.isArray(res.json), `GET /api/messages should answer a JSON array ${describe(res)}`);
  assert.equal(res.json.length, 20, `after 22 messages it should return only the last 20 (got ${res.json.length})`);
  assert.equal(res.json[0].text, "message 3", "the oldest message comes first: the first one should be \"message 3\"");
  assert.equal(res.json[19].text, "message 22", "the newest message comes last: \"message 22\"");
  assert.equal(res.json[19].nickname, "Dana", "every message keeps its nickname");
});
