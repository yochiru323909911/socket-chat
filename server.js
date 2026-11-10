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
