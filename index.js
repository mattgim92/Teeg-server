const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;

const rooms = {};

/* ======================
   CARD / DECK UTILITIES
====================== */

function createDeck() {
  const values = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suits = ["♠", "♥", "♦", "♣"];
  const deck = [];

  for (const v of values) {
    for (const s of suits) {
      deck.push(v);
    }
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

function generateRoomId() {
  return Math.random().toString(36).substring(2, 7);
}

/* ======================
   SOCKET.IO LOGIC
====================== */

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);
  console.log("Connected:", socket.id);

  /* CREATE ROOM */
  socket.on("create-room", (name, callback) => {
    const roomId = generateRoomId();
    const deck = createDeck();

    rooms[roomId] = {
      players: [{
        id: socket.id,
        name,
        hand: deck.splice(0, 3)
      }],
      deck,
      pile: [],
      turn: 0
    };

    socket.join(roomId);

    if (callback) callback(roomId);
    io.to(roomId).emit("state", rooms[roomId]);
  });

  /* JOIN ROOM */
  socket.on("join-room", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.players.push({
      id: socket.id,
      name,
      hand: room.deck.splice(0, 3)
    });

    socket.join(roomId);
    io.to(roomId).emit("state", room);
  });

  /* PLAY CARD */
  socket.on("play", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const currentPlayer = room.players[room.turn];
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

    // Remove ONE instance of the card
    const index = currentPlayer.hand.indexOf(card);
    if (index === -1) return;
    currentPlayer.hand.splice(index, 1);

    room.pile.push(card);

    // 💥 BOMB CARD (10)
    if (card === "10") {
      room.pile = [];
      io.to(roomId).emit("bomb");
      // same player keeps turn
    } else {
      room.turn = (room.turn + 1) % room.players.length;
    }

    /* GAME OVER CHECK */
    const activePlayers = room.players.filter(p => p.hand.length > 0);

    if (activePlayers.length === 1) {
      io.to(roomId).emit("game-over", {
        teeg: activePlayers[0].name
      });
      return;
    }

    io.to(roomId).emit("state", room);
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("state", room);
      }
    }
  });
});

/* ======================
   START SERVER
====================== */

server.listen(PORT, () => {
  console.log(`TEEG server running on port ${PORT}`);
});
