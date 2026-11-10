// Loaded by the tests before server.js (node --require). You don't need to read or change this file.
//
// Whatever port you pass to listen() (3000), the server gets a free random port instead,
// so the tests never clash with a server you already run in another terminal,
// and the tests are told which port it is.
const net = require("node:net");

const send = (msg) => {
  if (process.send) process.send(msg);
};

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] !== null && typeof args[0] === "object") {
    args[0] = { ...args[0], port: 0, host: undefined };
  } else if (args.length === 0 || typeof args[0] === "function") {
    args.unshift(0);
  } else {
    args[0] = 0;
    if (typeof args[1] === "string") args.splice(1, 1); // drop a host like "localhost"
  }
  this.once("listening", () => send({ type: "listening", port: this.address().port }));
  return originalListen.apply(this, args);
};
