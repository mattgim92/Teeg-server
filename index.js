const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  return VALUES.flatMap(v => Array(4).fill(v));
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

io.on("connection", socket => {

  socket.on("create-room", (name, cb) => {
    const roomId = Math.random().toString(36).substring(2, 7);
    const deck = createDeck();
    shuffle(deck);

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
    cb(roomId);
  });

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

  socket.on("play", ({ roomId, card }) => {
  const room = rooms[roomId];
  const currentPlayer = room.players[room.turn];

  if (!room || currentPlayer.id !== socket.id) return;

  // Remove card from hand
  currentPlayer.hand = currentPlayer.hand.filter(c => c !== card);

  // Add to pile
  room.pile.push(card);

  // 💥 BOMB CARD (10)
  if (card === "10") {
    room.pile = []; // clear pile
    io.to(roomId).emit("bomb"); // tell clients
    // same player goes again
  } else {
    // normal turn progression
    room.turn = (room.turn + 1) % room.players.length;
  }

  io.to(roomId).emit("state", room);
});

});

server.listen(3000);
