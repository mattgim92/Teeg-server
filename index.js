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

/* ----------------- SOCKET LOGIC ----------------- */

function canPlay(card, room) {
  // Special cards always allowed
  if (card === "2" || card === "3" || card === "10") return true;

  if (room.pileValue === null) return true;

  return CARD_VALUES[card] >= room.pileValue;
}

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
      pileValue: null,       // current value to beat
      fourCount: 0,          // count toward 4-of-a-kind
      lastNonThree: null,     // for 3-copy logic
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
  hand: room.deck.splice(0, 3),
  faceUp: [],
  faceDown: [],
  stage: "hand" // hand → faceUp → faceDown
});

  // Send state directly to joiner
  socket.emit("state", room);

  // Re-sync everyone else
  socket.to(roomId).emit("state", room);
});

socket.on("play", ({ roomId, card }) => {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players[room.turn];
  if (player.id !== socket.id) return;

  // Determine source array based on stage
  let source;
  if (player.stage === "hand") source = player.hand;
  else if (player.stage === "faceUp") source = player.faceUp;
  else if (player.stage === "faceDown") source = player.faceDown;
  else return; // player is out

  // Check if the card exists
  const idx = source.indexOf(card);
  if (idx === -1) return;

  // STEP 5: Face-down failure
  if (!canPlay(card, room)) {
    // Pick up pile
    player.hand.push(...room.pile);
    room.pile = [];
    room.pileValue = null;
    room.fourCount = 0;
    room.lastNonThree = null;

    // Face-down failure → return to hand
    if (player.stage !== "hand") player.stage = "hand";

    io.to(roomId).emit("state", room);
    return;
  }

  // Remove card from correct stage
  source.splice(idx, 1);
  room.pile.push(card);

  /* ---------- SPECIAL CARDS ---------- */

  // 🔥 BOMB (10)
  if (card === "10") {
    room.pile = [];
    room.pileValue = null;
    room.fourCount = 0;
    room.lastNonThree = null;
    io.to(roomId).emit("bomb");
    io.to(roomId).emit("state", room);
    return; // same player goes again
  }

  // 🔄 RESET (2)
  if (card === "2") {
    room.pileValue = null;
    room.fourCount = 1;
  }

  // 🪞 COPY (3)
  else if (card === "3") {
    if (room.lastNonThree) {
      room.fourCount++;
      if (room.fourCount === 4) {
        room.pile = [];
        room.pileValue = null;
        room.fourCount = 0;
        room.lastNonThree = null;
        io.to(roomId).emit("bomb");
        io.to(roomId).emit("state", room);
        return; // same player goes again
      }
    }
  }

  // 🔢 NORMAL CARD
  else {
    if (room.lastNonThree === card) {
      room.fourCount++;
    } else {
      room.fourCount = 1;
    }

    room.pileValue = CARD_VALUES[card];
    room.lastNonThree = card;
  }

  // 🔥 4 OF A KIND BOMB
  if (room.fourCount === 4) {
    room.pile = [];
    room.pileValue = null;
    room.fourCount = 0;
    room.lastNonThree = null;
    io.to(roomId).emit("bomb");
    io.to(roomId).emit("state", room);
    return; // same player goes again
  }

  /* ---------- STEP 4: Auto-advance stage ---------- */
  function updateStage(player) {
    if (player.hand.length > 0) return;
    if (player.faceUp.length > 0) {
      player.stage = "faceUp";
      return;
    }
    if (player.faceDown.length > 0) {
      player.stage = "faceDown";
      return;
    }
    player.stage = "out"; // finished
  }
  updateStage(player);

  // Next player's turn (unless Bomb overrides)
  room.turn = (room.turn + 1) % room.players.length;
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
