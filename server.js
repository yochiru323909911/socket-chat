// Analiza Chat - write your server here.
// Run it with: npm start   then open http://localhost:3000 in two tabs and chat with yourself :)
// The event names and texts are in the "event contract" table in README.md.

// Step 1: an express app that serves the "public" folder,
//         an http server made from the app, a Socket.io server attached to it, and listen(3000).
//         On every connection print:  User connected: <socket.id>

// Step 2: "join" (nickname, callback)
//         - empty nickname      -> callback({ ok: false, error: "חובה להזין כינוי" })
//         - nickname is taken   -> callback({ ok: false, error: "הכינוי כבר תפוס" })
//         - otherwise save it, callback({ ok: true }), and send to everyone:
//           "system" -> "<nickname> הצטרפה לצ'אט"   and   "users" -> [all nicknames]

// Step 3: "chat:message" (text) -> send to everyone: "chat:message" -> { nickname, text, time }

// Step 4: "typing" -> send to everyone except the sender: "typing" -> nickname

// Step 5: "disconnect" -> send to everyone: "system" -> "<nickname> עזבה את הצ'אט"  and  "users"

// Bonus: GET /api/messages -> the last 20 chat messages


import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
})

const users = [];
const messages = [];

io.on("connection", (socket) => { 
    console.log(`User connected: ${socket.id}`);
    socket.on("join", (nickname, callback) => {
        const trimmedNickname = nickname.trim();
        if (!trimmedNickname) {
            callback({ ok: false, error: "חובה להזין כינוי" });
            return;
        }
        if (users.includes(trimmedNickname)) {
            callback({ ok: false, error: "הכינוי כבר תפוס" });
            return;
        }
        socket.data.nickname = trimmedNickname;
        users.push(trimmedNickname);
        callback({ ok: true });
        io.emit("system", `${trimmedNickname} הצטרפה לצ'אט`);
        io.emit("users", users);
    })
    socket.on("chat:message", (text) => {
        const trimmedText = text.trim();
        if (!trimmedText || !socket.data.nickname)
            return;
        const nickname = socket.data.nickname;
        const time = new Date().toISOString();
        const message = { nickname, text: trimmedText, time };
        messages.push(message);
        if (messages.length > 20)
            messages.shift();
        io.emit("chat:message", message);
    });
    socket.on("typing", () => {
        const nickname = socket.data.nickname;
        socket.broadcast.emit("typing", nickname);
    })
    socket.on("disconnect", () => {
        const nickname = socket.data.nickname;
        if (nickname) {
            users.splice(users.indexOf(nickname), 1);
            io.emit("system", `${nickname} עזבה את הצ'אט`);
            io.emit("users", users);
        }
    }) 
})


app.get("/api/messages", (req, res) => {
    res.json(messages);
});