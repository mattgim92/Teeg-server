const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* REQUIRED FOR RENDER */
app.get("/", (req, res) => {
  res.send("TEEG SERVER RUNNING");
});

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling"],     // 🔑 critical
  allowEIO3: true
});

const PORT = process.env.PORT || 10000;
const rooms = {};

/* ----------------- UTILITIES ----------------- */

function createDeck() {
  const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const deck = [];
  for (const v of values) {
    for (let i = 0; i < 4; i++) deck.push(v);
  }
  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function roomId() {
  return Math.random().toString(36).substring(2, 7);
}

/* ----------------- SOCKET LOGIC ----------------- */

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);
  socket.on("create-room", (name, cb) => {
    console.log("Create room request from", name, socket.id);
    
    const id = roomId();
    const deck = createDeck();

    rooms[id] = {
      players: [{
        id: socket.id,
        name,
        hand: deck.splice(0, 3)
      }],
      deck,
      pile: [],
      turn: 0
    };

    socket.join(id);
    cb(id);
    socket.emit("state", rooms[id]);
  });

  socket.on("join-room", ({ roomId, name }) => {
  const room = rooms[roomId];
  if (!room) return;

  // Prevent duplicates
  if (room.players.find(p => p.id === socket.id)) return;

  socket.join(roomId);

  room.players.push({
    id: socket.id,
    name,
    hand: room.deck.splice(0, 3)
  });

  // Send state directly to joiner
  socket.emit("state", room);

  // Re-sync everyone else
  socket.to(roomId).emit("state", room);
});

  socket.on("play", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const current = room.players[room.turn];
    if (current.id !== socket.id) return;

    const i = current.hand.indexOf(card);
    if (i === -1) return;
    current.hand.splice(i, 1);

    room.pile.push(card);

    if (card === "10") {
      room.pile = [];
      io.to(roomId).emit("bomb");
    } else {
      room.turn = (room.turn + 1) % room.players.length;
    }

    const active = room.players.filter(p => p.hand.length > 0);
    if (active.length === 1) {
      io.to(roomId).emit("game-over", { teeg: active[0].name });
      return;
    }

    io.to(roomId).emit("state", room);
  });

  socket.on("disconnect", () => {
    for (const id in rooms) {
      rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
      if (rooms[id].players.length === 0) delete rooms[id];
      else io.to(id).emit("state", rooms[id]);
    }
  });
});

server.listen(PORT, () => {
  console.log("Teeg server running on port", PORT);
});
