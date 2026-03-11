const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ─── TƏHLÜKƏSİZLİK BAŞLIQLAR ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// ─── HTTP RATE LIMIT ─────────────────────────────────────────────────────────
const httpRateMap = new Map();
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const e = httpRateMap.get(ip) || { c: 0, t: now };
  if (now - e.t > 60000) { e.c = 0; e.t = now; }
  e.c++;
  httpRateMap.set(ip, e);
  if (httpRateMap.size > 5000) {
    for (const [k, v] of httpRateMap) if (now - v.t > 60000) httpRateMap.delete(k);
  }
  if (e.c > 120) return res.status(429).send('Cok sorgu. Bir deqiqe gozleyin.');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── SOCKET RATE LIMIT ───────────────────────────────────────────────────────
const socketRate = new Map();
function rateCheck(id, limit, windowMs) {
  limit = limit || 40;
  windowMs = windowMs || 10000;
  const now = Date.now();
  const e = socketRate.get(id) || { c: 0, t: now };
  if (now - e.t > windowMs) { e.c = 0; e.t = now; }
  e.c++;
  socketRate.set(id, e);
  return e.c <= limit;
}

// ─── SÖZ BANKASI (yalnız çizilə bilən sözlər) ────────────────────────────────
const WORDS = [
  // Heyvanlar
  'it','pishik','at','inek','toyuq','ordek','aslan','peleng','fil','zurafa',
  'meymun','aya','tulku','dovshan','kirpi','ilan','tisbaga','balig','qush',
  'qartal','goyercin','qurbaga','kopekbaligi','delfin','zebra','kergeden',
  'timsah','kertenkele','maral','deve','kanguru','koala','pingvin','flamingo',
  'baykush','eshsek','keci','donuz','xerceng','ahtapot','ari','kepenk',
  // Meyvə/tərəvəz
  'alma','armud','uzum','qarpiz','qovun','portaqal','limon','gilas','erik',
  'pomidor','xiyar','kartof','soqan','biber','badimcan','gobelek','yerkoyu',
  // Yemək
  'plov','pizza','burger','makaron','tort','dondurma','shokolad','chorek',
  'yumurta','pendir','kebab','dolma','qutab','sud','sandwich',
  // Nəqliyyat
  'avtomobil','avtobus','qatar','teyare','gemi','motosiklet','velosiped',
  'taksi','metro','helikopter','yuk mashini','ambulans','traktor','qayiq',
  'yelkenli','tramvay','raket','parashut',
  // Ev əşyaları
  'stul','masa','divan','cherpayı','shkaf','soyuducu','televizor','telefon',
  'komputer','kitab','qelem','makas','chanta','lampa','pencere','qapi',
  'tava','qazan','chaydaniq','fincan','boshqab','stek','acar','saat',
  'guzgu','chetr','mishar','chekim','vida','mix','pillekan',
  // Geyim
  'koynak','shalvar','etek','palto','jaket','bashliq','corab','don',
  'papaq','qurshaq','boyunbagi','uzuk','chekmə','sandal','elcek',
  // Təbiət
  'dag','deniz','chay','gol','mesha','shalale','vulkan','ada',
  'gunesh','ay','ulduz','bulud','yagish','qar','shimsek',
  'gul','agac','kaktus','palma','yarpaq',
  // İdman
  'futbol','basketbol','voleybol','tennis','uzguculuk','boks',
  'velosiped','shahmat','golf','badminton','skeyt','karate',
  // Digər əşyalar
  'kamera','eynek','sach daragi','dish firechasi','uti','shem',
  'chadır','xeyte','pul','kilit','zeng','bayrag','chemər',
  // Azərbaycan
  'Baki','Shusha','Gence','xalcha','tar','nar','qala',
];

// ─── KÖMƏKÇI ─────────────────────────────────────────────────────────────────
function generateRoomCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function getRandomWords(count) {
  count = count || 3;
  const arr = WORDS.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, count);
}

function buildHint(word, ratio) {
  const chars = word.split('');
  const idxs = chars.map(function(c, i) { return c !== ' ' ? i : null; }).filter(function(i) { return i !== null; });
  const revealCount = Math.floor(idxs.length * ratio);
  const reveal = new Set(idxs.slice(0, revealCount));
  return chars.map(function(c, i) { return c === ' ' ? ' ' : (reveal.has(i) ? c : '_'); }).join(' ');
}

// ─── OTAQLAR ─────────────────────────────────────────────────────────────────
const rooms = {};

function startTurn(code) {
  const room = rooms[code];
  if (!room || room.players.length < 2) return;

  room.word = null;
  room.guessed = [];
  room.timeLeft = room.drawTime;
  room.hintRatio = 0;

  const drawer = room.players[room.drawerIdx];
  const choices = getRandomWords(3);
  room.wordChoices = choices;

  io.to(drawer.id).emit('chooseWord', { words: choices });
  io.to(code).emit('waitingWord', { drawerName: drawer.name, drawerId: drawer.id });

  room.choiceTimeout = setTimeout(function() {
    if (!room.word) {
      const w = choices[Math.floor(Math.random() * choices.length)];
      beginTurn(code, w);
    }
  }, 12000);
}

function beginTurn(code, word) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.choiceTimeout);
  room.word = word;
  room.timeLeft = room.drawTime;
  room.hintRatio = 0;

  const drawer = room.players[room.drawerIdx];
  io.to(drawer.id).emit('yourWord', { word: word });

  io.to(code).emit('turnStart', {
    drawerName: drawer.name,
    drawerId: drawer.id,
    wordLen: word.length,
    hint: buildHint(word, 0),
    round: room.round,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
  });

  room.timer = setInterval(function() {
    room.timeLeft--;
    const ratio = 1 - room.timeLeft / room.drawTime;
    let newHint = 0;
    if (ratio >= 0.5) newHint = 0.25;
    if (ratio >= 0.75) newHint = 0.45;
    if (newHint > room.hintRatio) {
      room.hintRatio = newHint;
      io.to(code).emit('hintUpdate', { hint: buildHint(word, newHint) });
    }
    io.to(code).emit('tick', { t: room.timeLeft });
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endTurn(code);
    }
  }, 1000);
}

function endTurn(code) {
  const room = rooms[code];
  if (!room) return;
  clearInterval(room.timer);
  clearTimeout(room.choiceTimeout);

  const drawer = room.players[room.drawerIdx];
  if (drawer && room.guessed.length > 0) {
    drawer.score += Math.min(room.guessed.length, 5);
  }

  io.to(code).emit('turnEnd', {
    word: room.word || '',
    scores: room.players.map(function(p) { return { id: p.id, name: p.name, score: p.score }; }),
  });

  setTimeout(function() {
    if (!rooms[code]) return;
    room.drawerIdx = (room.drawerIdx + 1) % room.players.length;
    if (room.drawerIdx === 0) room.round++;

    if (room.round > room.maxRounds) {
      const sorted = room.players.slice().sort(function(a, b) { return b.score - a.score; });
      io.to(code).emit('gameOver', {
        scores: room.players.map(function(p) { return { name: p.name, score: p.score }; }),
        winner: sorted[0].name,
      });
      room.started = false;
    } else {
      io.to(code).emit('clearCanvas');
      startTurn(code);
    }
  }, 5500);
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  maxHttpBufferSize: 1e5,
});

io.on('connection', function(socket) {

  socket.on('createRoom', function(data) {
    if (!rateCheck(socket.id, 5, 30000)) return socket.emit('err', 'Cok tez cemhd. Gozleyin.');
    const name = ((data && data.name) || '').trim().substring(0, 16);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    const rounds = Math.min(Math.max(parseInt((data && data.rounds) || 3), 1), 8);
    const drawTime = Math.min(Math.max(parseInt((data && data.drawTime) || 80), 30), 180);
    const code = generateRoomCode();
    rooms[code] = {
      code: code, round: 1, maxRounds: rounds, drawTime: drawTime,
      drawerIdx: 0, started: false,
      word: null, wordChoices: [], guessed: [], hintRatio: 0,
      timer: null, choiceTimeout: null, timeLeft: 0,
      players: [{ id: socket.id, name: name, score: 0, isHost: true }],
    };
    socket.join(code);
    socket.data.code = code;
    socket.emit('roomReady', {
      code: code, isHost: true,
      players: rooms[code].players,
      settings: { rounds: rounds, drawTime: drawTime },
    });
  });

  socket.on('joinRoom', function(data) {
    if (!rateCheck(socket.id, 5, 30000)) return socket.emit('err', 'Cok tez cemhd. Gozleyin.');
    const name = ((data && data.name) || '').trim().substring(0, 16);
    const code = ((data && data.code) || '').trim();
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    if (!/^\d{5}$/.test(code)) return socket.emit('err', '5 reqemli kodu daxil edin.');
    const room = rooms[code];
    if (!room) return socket.emit('err', 'Otaq tapilmadi.');
    if (room.started) return socket.emit('err', 'Oyun artiq baslayib.');
    if (room.players.length >= 8) return socket.emit('err', 'Otaq doludur.');
    room.players.push({ id: socket.id, name: name, score: 0, isHost: false });
    socket.join(code);
    socket.data.code = code;
    socket.emit('roomReady', {
      code: code, isHost: false,
      players: room.players,
      settings: { rounds: room.maxRounds, drawTime: room.drawTime },
    });
    socket.to(code).emit('playerUpdate', { players: room.players, msg: name + ' qoshuldu!' });
  });

  socket.on('startGame', function() {
    const room = rooms[socket.data.code];
    if (!room) return;
    const me = room.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    if (room.players.length < 2) return socket.emit('err', 'En az 2 oyuncu lazimdir.');
    if (room.started) return;
    room.started = true;
    room.round = 1;
    room.drawerIdx = 0;
    room.players.forEach(function(p) { p.score = 0; });
    io.to(room.code).emit('gameStarted');
    setTimeout(function() { startTurn(room.code); }, 800);
  });

  socket.on('wordChosen', function(data) {
    if (!rateCheck(socket.id, 3, 15000)) return;
    const room = rooms[socket.data.code];
    if (!room || room.word) return;
    const drawer = room.players[room.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    const word = data && data.word;
    if (!word || room.wordChoices.indexOf(word) === -1) return;
    beginTurn(room.code, word);
  });

  socket.on('draw', function(data) {
    if (!rateCheck(socket.id, 200, 1000)) return;
    const room = rooms[socket.data.code];
    if (!room || !room.started) return;
    if (room.players[room.drawerIdx] && room.players[room.drawerIdx].id !== socket.id) return;
    socket.to(room.code).emit('draw', data);
  });

  socket.on('fill', function(data) {
    if (!rateCheck(socket.id, 10, 5000)) return;
    const room = rooms[socket.data.code];
    if (!room || !room.started) return;
    if (room.players[room.drawerIdx] && room.players[room.drawerIdx].id !== socket.id) return;
    socket.to(room.code).emit('fill', data);
  });

  socket.on('clear', function() {
    const room = rooms[socket.data.code];
    if (!room || !room.started) return;
    if (room.players[room.drawerIdx] && room.players[room.drawerIdx].id !== socket.id) return;
    io.to(room.code).emit('clearCanvas');
  });

  socket.on('guess', function(data) {
    if (!rateCheck(socket.id, 15, 10000)) return;
    const room = rooms[socket.data.code];
    if (!room || !room.started || !room.word) return;
    const drawer = room.players[room.drawerIdx];
    if (drawer && drawer.id === socket.id) return;
    const me = room.players.find(function(p) { return p.id === socket.id; });
    if (!me) return;
    const alreadyGuessed = room.guessed.find(function(g) { return g.id === socket.id; });
    if (alreadyGuessed) return;

    const guess = String((data && data.text) || '').trim().substring(0, 80);
    if (!guess) return;

    if (guess.toLowerCase() === room.word.toLowerCase()) {
      // FIX: 1ci = 10xal, 2ci = 9xal, 3cu = 8xal ... (min 5)
      const rank = room.guessed.length;
      const pts = Math.max(10 - rank, 5);
      me.score += pts;
      room.guessed.push({ id: socket.id, pts: pts });

      io.to(room.code).emit('correctGuess', {
        name: me.name,
        id: socket.id,
        pts: pts,
        scores: room.players.map(function(p) { return { id: p.id, name: p.name, score: p.score }; }),
      });

      const nonDrawers = room.players.filter(function(p) { return !drawer || p.id !== drawer.id; });
      if (room.guessed.length >= nonDrawers.length) {
        clearInterval(room.timer);
        endTurn(room.code);
      }
    } else {
      const wl = room.word.toLowerCase();
      const gl = guess.toLowerCase();
      const matchCount = gl.split('').filter(function(c) { return wl.includes(c); }).length;
      const close = wl.length > 3 && gl.length > 2 &&
        Math.abs(wl.length - gl.length) <= 2 &&
        matchCount >= Math.floor(gl.length * 0.6);

      io.to(room.code).emit('chat', {
        name: me.name,
        text: guess,
        close: close,
        correct: false,
      });
    }
  });

  socket.on('chat', function(data) {
    if (!rateCheck(socket.id, 10, 10000)) return;
    const room = rooms[socket.data.code];
    if (!room) return;
    const me = room.players.find(function(p) { return p.id === socket.id; });
    if (!me) return;
    const drawer = room.players[room.drawerIdx];
    if (room.started && drawer && drawer.id === socket.id) return;
    io.to(room.code).emit('chat', {
      name: me.name,
      text: String((data && data.text) || '').trim().substring(0, 80),
      close: false,
      correct: false,
    });
  });

  socket.on('playAgain', function() {
    const room = rooms[socket.data.code];
    if (!room || room.started) return;
    const me = room.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    room.round = 1; room.drawerIdx = 0; room.started = true;
    room.players.forEach(function(p) { p.score = 0; });
    io.to(room.code).emit('gameStarted');
    setTimeout(function() { startTurn(room.code); }, 800);
  });

  socket.on('disconnect', function() {
    socketRate.delete(socket.id);
    const code = socket.data && socket.data.code;
    const room = rooms[code];
    if (!room) return;

    const me = room.players.find(function(p) { return p.id === socket.id; });
    room.players = room.players.filter(function(p) { return p.id !== socket.id; });

    if (room.players.length === 0) {
      clearInterval(room.timer);
      clearTimeout(room.choiceTimeout);
      delete rooms[code];
      return;
    }

    if (!room.players.find(function(p) { return p.isHost; })) {
      room.players[0].isHost = true;
    }

    io.to(code).emit('playerUpdate', {
      players: room.players,
      msg: (me ? me.name : 'Oyuncu') + ' ayrildi.',
    });

    if (room.started) {
      if (room.drawerIdx >= room.players.length) room.drawerIdx = 0;
      if (room.players.length < 2) {
        clearInterval(room.timer);
        clearTimeout(room.choiceTimeout);
        room.started = false;
        io.to(code).emit('gamePaused');
      } else if (me && room.players[room.drawerIdx] && me.id === room.players[room.drawerIdx].id) {
        clearInterval(room.timer);
        clearTimeout(room.choiceTimeout);
        io.to(code).emit('clearCanvas');
        setTimeout(function() { startTurn(code); }, 2000);
      }
    }
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('CizTap calishir — port ' + PORT + ' — ' + WORDS.length + ' soz');
});
