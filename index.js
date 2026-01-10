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
  transports: ["polling"],
  allowEIO3: true
});

const PORT = process.env.PORT || 10000;
const rooms = {};

/* ----------------- UTILITIES ----------------- */

const CARD_VALUES = {
  "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "J": 11,
  "Q": 12, "K": 13, "A": 14
};

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

/* ----------------- GAME RULES ----------------- */

function canPlay(card, room) {
  if (card === "2" || card === "3" || card === "10") return true;
  if (room.pileValue === null) return true;
  return CARD_VALUES[card] >= room.pileValue;
}

/* ----------------- SOCKET LOGIC ----------------- */

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  /* ---------- CREATE ROOM ---------- */
  socket.on("create-room", (name, cb) => {
    const id = roomId();
    const deck = createDeck();

    rooms[id] = {
      players: [{
        id: socket.id,
        name,
        hand: deck.splice(0, 3),
        faceUp: deck.splice(0, 3),
        faceDown: deck.splice(0, 3),
        stage: "hand"
      }],
      deck,
      pile: [],
      pileValue: null,
      fourCount: 0,
      lastNonThree: null,
      turn: 0
    };

    socket.join(id);
    cb(id);
    socket.emit("state", rooms[id]);
  });

  /* ---------- JOIN ROOM ---------- */
  socket.on("join-room", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players.find(p => p.id === socket.id)) return;

    socket.join(roomId);

    room.players.push({
      id: socket.id,
      name,
      hand: room.deck.splice(0, 3),
      faceUp: room.deck.splice(0, 3),
      faceDown: room.deck.splice(0, 3),
      stage: "hand"
    });

    io.to(roomId).emit("state", room);
  });

  /* ---------- PLAY CARD ---------- */
  socket.on("play", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[room.turn];
    if (!player || player.id !== socket.id) return;

    /* 🔑 FORCE HAND STAGE */
    if (player.hand.length > 0) {
      player.stage = "hand";
    }

    /* Determine source */
    let source;
    if (player.stage === "hand") source = player.hand;
    else if (player.stage === "faceUp") source = player.faceUp;
    else if (player.stage === "faceDown") source = player.faceDown;
    else return;

    const idx = source.indexOf(card);
    if (idx === -1) return;

    /* ❌ INVALID PLAY → PICK UP */
    if (!canPlay(card, room)) {
      player.hand.push(...room.pile);
      room.pile = [];
      room.pileValue = null;
      room.fourCount = 0;
      room.lastNonThree = null;
      player.stage = "hand";

      io.to(roomId).emit("state", room);
      return;
    }

    /* ✅ VALID PLAY */
    source.splice(idx, 1);
    room.pile.push(card);

    /* ---------- SPECIAL CARDS ---------- */

    // 💣 10 BOMB
    if (card === "10") {
      room.pile = [];
      room.pileValue = null;
      room.fourCount = 0;
      room.lastNonThree = null;
      io.to(roomId).emit("bomb");
      io.to(roomId).emit("state", room);
      return;
    }

    // 🔄 RESET
    if (card === "2") {
      room.pileValue = null;
      room.fourCount = 1;
    }

    // 🪞 COPY
    else if (card === "3") {
      if (room.lastNonThree) room.fourCount++;
    }

    // 🔢 NORMAL
    else {
      room.fourCount = (room.lastNonThree === card) ? room.fourCount + 1 : 1;
      room.pileValue = CARD_VALUES[card];
      room.lastNonThree = card;
    }

    /* 🔥 4 OF A KIND */
    if (room.fourCount === 4) {
      room.pile = [];
      room.pileValue = null;
      room.fourCount = 0;
      room.lastNonThree = null;
      io.to(roomId).emit("bomb");
      io.to(roomId).emit("state", room);
      return;
    }

    /* ---------- STAGE ADVANCE ---------- */
    if (player.hand.length === 0 && player.stage === "hand") {
      player.stage = player.faceUp.length ? "faceUp" : "faceDown";
    }

    if (player.stage === "faceUp" && player.faceUp.length === 0) {
      player.stage = player.faceDown.length ? "faceDown" : "out";
    }

    if (player.stage === "faceDown" && player.faceDown.length === 0) {
      player.stage = "out";
    }

    room.turn = (room.turn + 1) % room.players.length;
    io.to(roomId).emit("state", room);
  });

  /* ---------- DISCONNECT ---------- */
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
