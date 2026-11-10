// Helpers for the tests. You don't need to read or change this file.
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { fork } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PRELOAD = path.join(__dirname, "preload.cjs");

function requireInstalled() {
  for (const pkg of ["express", "socket.io", "socket.io-client"]) {
    if (!fs.existsSync(path.join(ROOT, "node_modules", pkg))) {
      throw new Error(`${pkg} is not installed - run \`npm install\` first`);
    }
  }
}

/**
 * Runs server.js in its own process, exactly like `node server.js`, and waits until it calls listen(...).
 * Returns helpers to send HTTP requests, connect Socket.io clients and read what the server printed.
 */
function startServer(file = "server.js", { timeout = 8000 } = {}) {
  requireInstalled();
  const { io: ioClient } = require(path.join(ROOT, "node_modules", "socket.io-client"));

  const child = fork(path.join(ROOT, file), [], {
    cwd: ROOT,
    execArgv: ["--require", PRELOAD],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  let printed = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (printed += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (printed += chunk));

  const clients = [];
  const outputLines = () => printed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stop = () => {
    for (const c of clients) c.socket.disconnect();
    if (child.exitCode === null && !child.killed) child.kill();
  };
  const printedNote = () =>
    printed.trim()
      ? `\n--- the server printed ---\n${printed.trim().split(/\r?\n/).filter((l) => !/^\s+at /.test(l)).slice(-15).join("\n")}`
      : "";

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`${file} did not start a server within ${timeout / 1000}s - did you call server.listen(3000)?`));
    }, timeout);
    child.on("message", (msg) => {
      if (msg && msg.type === "listening") {
        clearTimeout(timer);
        resolve(msg.port);
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (/Error/.test(printed)) {
        const lines = printed.split(/\r?\n/);
        const error = (lines.find((l) => /^\w*Error\b/.test(l.trim())) || "").trim();
        const where = lines.find((l) => /[\\/][^\\/]+\.js:\d+/.test(l) && !/node_modules|node:/.test(l));
        const place = where ? ` (at ${where.trim().replace(/^at\s+/, "").replace(/^.*[\\/]/, "").replace(/\)$/, "")})` : "";
        reject(new Error(`${file} crashed: ${error || "see the output below"}${place}${printedNote()}`));
      } else {
        reject(new Error(`${file} finished without starting a server - create the servers and call server.listen(3000) (step 1)${printedNote()}`));
      }
    });
  });
  ready.catch(() => {}); // reported by request() / connect()

  /** Sends one HTTP request and returns { status, headers, text, json }. */
  async function request(method, urlPath = "/") {
    const port = await ready;
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, method, path: urlPath }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json: parsed });
        });
      });
      req.setTimeout(4000, () => req.destroy(new Error(`the server did not answer ${method} ${urlPath} within 4s${printedNote()}`)));
      req.on("error", (err) =>
        reject(err.message.includes("did not answer") ? err : new Error(`request ${method} ${urlPath} failed: ${err.message}${printedNote()}`))
      );
      req.end();
    });
  }

  /**
   * Connects a Socket.io client (like one browser tab) and records every event it receives.
   * Returns a client with: id, emit, join(nickname), waitFor(event, check, what), expectNothing(event, ms, what), disconnect().
   */
  async function connect(label = "client") {
    const port = await ready;
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
    });
    const received = []; // { event, args }
    socket.onAny((event, ...args) => received.push({ event, args }));
    const client = { label, socket, received };
    clients.push(client);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} could not connect with Socket.io within 3s - did you create new Server(server) on the same http server you call listen() on? (step 1)${printedNote()}`)), 3500);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timer);
        reject(new Error(`${label} could not connect with Socket.io (${err.message}) - did you create new Server(server) on the same http server you call listen() on? (step 1)${printedNote()}`));
      });
    });

    client.id = socket.id;
    client.emit = (event, ...args) => socket.emit(event, ...args);

    /** Emits "join" and returns the answer the server passed to the callback. */
    client.joinAnswer = async (nickname) => {
      try {
        return await socket.timeout(2000).emitWithAck("join", nickname);
      } catch {
        throw new Error(`the server did not answer "join" from ${label} within 2s - call the callback: callback({ ok: true }) (step 2)${printedNote()}`);
      }
    };

    /** Joins and makes sure it worked (used by the steps after step 2). */
    client.join = async (nickname) => {
      const answer = await client.joinAnswer(nickname);
      if (!answer || answer.ok !== true) {
        throw new Error(`joining as "${nickname}" should answer { ok: true } (step 2), got ${JSON.stringify(answer)}`);
      }
      return answer;
    };

    /** Waits until an event that passes check(...args) arrives (also looks at events that already arrived). */
    client.waitFor = async (event, check = () => true, what = `"${event}"`, ms = 1500) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const found = received.find((r) => r.event === event && safe(check, r.args));
        if (found) return found.args;
        await sleep(20);
      }
      const got = received.filter((r) => r.event === event).map((r) => JSON.stringify(r.args.length === 1 ? r.args[0] : r.args));
      throw new Error(`${label} did not get ${what}${got.length ? ` (it got "${event}" with: ${got.slice(-4).join(" | ")})` : ` (no "${event}" event arrived at all)`}${printedNote()}`);
    };

    /** Events of this name that arrived so far. */
    client.all = (event) => received.filter((r) => r.event === event).map((r) => r.args);

    client.disconnect = () => socket.disconnect();
    return client;
  }

  async function waitForOutput(check, waitMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      if (check(outputLines())) return true;
      await sleep(25);
    }
    return check(outputLines());
  }

  return { ready, request, connect, outputLines, waitForOutput, printedNote, stop };
}

function safe(check, args) {
  try {
    return check(...args);
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Short description of a response, for assertion messages. */
function describe(res) {
  const body = res.text.length > 300 ? res.text.slice(0, 300) + "..." : res.text;
  return `(got status ${res.status}, body: ${body || "<empty>"})`;
}

/** Hebrew texts: ignore extra spaces and the kind of apostrophe (' ׳ ’). */
function sameText(a, b) {
  const norm = (s) => String(s).replace(/[׳’`]/g, "'").replace(/\s+/g, " ").trim();
  return typeof a === "string" && norm(a) === norm(b);
}

module.exports = { startServer, describe, sameText, sleep, ROOT };
