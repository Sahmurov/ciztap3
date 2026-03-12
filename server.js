const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);

app.use(function(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const httpRate = new Map();
app.use(function(req, res, next) {
  const ip = req.socket.remoteAddress || 'x';
  const now = Date.now();
  const e = httpRate.get(ip) || { c: 0, t: now };
  if (now - e.t > 60000) { e.c = 0; e.t = now; }
  if (++e.c > 200) return res.status(429).send('Too many requests.');
  httpRate.set(ip, e);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const sockRate = new Map();
function rateOk(id, limit, ms) {
  const key = id + ':' + (ms || 10000);
  const now = Date.now();
  const e = sockRate.get(key) || { c: 0, t: now };
  if (now - e.t > (ms || 10000)) { e.c = 0; e.t = now; }
  e.c++;
  sockRate.set(key, e);
  return e.c <= (limit || 40);
}

const WORDS = {
  'Heyvanlar': {
    easy:   ['it','pişik','at','inək','toyuq','balıq','quş','aslan','fil','ayı','donuz','keçi','eşşək'],
    medium: ['zürafə','delfin','kənguru','koala','pinqvin','flamingo','timsah','maral','dəvə','tısbağa','kərtənkələ'],
    hard:   ['kərgədan','hipopotam','şimpanze','dəvəquşu','kolibri','pelikan','gorilla','leopard','bufalo','samur'],
  },
  'Meyvə və Tərəvəz': {
    easy:   ['alma','armud','üzüm','qarpız','portağal','limon','pomidor','xiyar','kartof','soğan','bibər'],
    medium: ['heyva','əncir','xurma','nar','şaftalı','gavalı','ananas','kivi','avokado','ispanaq','kələm'],
    hard:   ['razyana','zoğal','qaragilə','böyürtkən','tərxun','brokkoli','feijoa'],
  },
  'Azərbaycan Yeməkləri': {
    easy:   ['plov','kebab','dolma','qutab','çörək','şorba','baklava','şəkərbura'],
    medium: ['düşbərə','xəngəl','bozbas','piti','qovurma','küftə','lavangi','aşure','dovğa'],
    hard:   ['levengi','buğlama','narsharab','qənd halva'],
  },
  'Gündəlik Yeməklər': {
    easy:   ['çörək','yumurta','süd','pizza','burger','tort','dondurma','şokolad','çay','qəhvə'],
    medium: ['makaron','sandwich','omlet','limonad','ayran','kərə yağı','bal','konfet','keks'],
    hard:   ['waffle','sufle','tiramisu','fondü','bruschetta','paella','lasanya'],
  },
  'Nəqliyyat': {
    easy:   ['avtomobil','avtobus','qatar','təyyarə','gəmi','velosiped','taksi','metro'],
    medium: ['motosiklet','helikopter','tramvay','yük maşını','ambulans','traktor','yelkənli'],
    hard:   ['ekskavator','buldozer','limuzin','gondola','hava balonu','paraşut'],
  },
  'Ev Əşyaları': {
    easy:   ['stul','masa','divan','çarpayı','şkaf','soyuducu','televizor','telefon','qapı','pəncərə'],
    medium: ['kompüter','çaydanıq','fincan','boşqab','stəkan','açar','güzgü','çətir','xalça','pərdə'],
    hard:   ['tozsoran','blender','termos','kuzə','mişar','çəkic','vida'],
  },
  'Geyim': {
    easy:   ['köynək','şalvar','palto','papaq','corab','çəkmə','sandal','don'],
    medium: ['jaket','ətək','əlcək','qurşaq','boyunbağı','üzük','kəmər','kostyum'],
    hard:   ['qalstuk','plaş','şərfə','araqçın','kəlağayı'],
  },
  'Təbiət': {
    easy:   ['dağ','dəniz','çay','göl','meşə','günəş','ay','ulduz','bulud','yağış','qar'],
    medium: ['şəlalə','vulkan','ada','şimşək','göy qurşağı','kaktus','palma','dalğa'],
    hard:   ['bataqlıq','tayqa','buzlaq','mağara','yarımada','körfəz','delta'],
  },
  'İdman': {
    easy:   ['futbol','basketbol','voleybol','tennis','üzgüçülük','boks','şahmat','qaçış'],
    medium: ['karate','qolf','badminton','skeytbord','gimnastika','güləş','hokey','polo'],
    hard:   ['triathlon','sörfinq','dalğıclıq','alpinizm','qılınc oynatma','biatlon'],
  },
  'Peşələr': {
    easy:   ['həkim','müəllim','aşpaz','sürücü','polis','pilot','bərbər','rəssam'],
    medium: ['mühəndis','aktyor','müğənni','yazıçı','jurnalist','proqramçı','arxitektor'],
    hard:   ['cərrah','diplomat','psixoloq','astronavt','nevroloq'],
  },
  'Azərbaycan': {
    easy:   ['nar','xalça','tar','bayraq','qala','çay','saz'],
    medium: ['kamança','karvansara','İçərişəhər','papaq','kəlağayı','balaban'],
    hard:   ['zurna','nağara','qaval','tütək','ud','qanun','qobustan'],
  },
};

function getPool(cat, diff) {
  const cats = cat === 'Hamısı' ? Object.values(WORDS) : [WORDS[cat] || Object.values(WORDS)[0]];
  const pool = [];
  cats.forEach(function(c) {
    const src = diff === 'all' ? c.easy.concat(c.medium, c.hard) : (c[diff] || c.easy);
    pool.push.apply(pool, src);
  });
  return pool;
}
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function pick3(room) {
  let pool = getPool(room.category, room.difficulty);
  if (room.customWords && room.customWords.length) pool = pool.concat(room.customWords);
  return shuffle(pool).slice(0, 3);
}
function buildHint(word, ratio) {
  const chars = word.split('');
  const idxs = chars.map((c, i) => c !== ' ' ? i : -1).filter(i => i >= 0);
  const show = new Set(idxs.slice(0, (idxs.length * (ratio || 0)) | 0));
  return chars.map((c, i) => c === ' ' ? ' ' : (show.has(i) ? c : '_')).join(' ');
}
function genCode() { return String(((Math.random() * 90000) | 0) + 10000); }

const rooms = {};

function safeTimer(r) {
  if (!r) return;
  if (r._tick)   { clearInterval(r._tick);  r._tick  = null; }
  if (r._choice) { clearTimeout(r._choice); r._choice= null; }
  if (r._end)    { clearTimeout(r._end);    r._end   = null; }
}

function startTurn(code) {
  const r = rooms[code];
  if (!r || r.players.length < 2) return;
  safeTimer(r);
  r.word = null; r.guessed = []; r.timeLeft = r.drawTime; r.hintRatio = 0;
  const drawer = r.players[r.drawerIdx];
  r.choices = pick3(r);
  io.to(drawer.id).emit('chooseWord', { words: r.choices });
  io.to(code).emit('waitingWord', { drawerName: drawer.name, drawerId: drawer.id });
  r._choice = setTimeout(function() {
    r._choice = null;
    if (!r.word) beginTurn(code, r.choices[(Math.random() * r.choices.length) | 0]);
  }, 12000);
}

function beginTurn(code, word) {
  const r = rooms[code];
  if (!r) return;
  safeTimer(r);
  r.word = word; r.timeLeft = r.drawTime; r.hintRatio = 0;
  const drawer = r.players[r.drawerIdx];
  io.to(drawer.id).emit('yourWord', { word });
  io.to(code).emit('turnStart', {
    drawerName: drawer.name, drawerId: drawer.id,
    wordLen: word.length, hint: buildHint(word, 0),
    round: r.round, maxRounds: r.maxRounds, timeLeft: r.timeLeft,
  });
  r._tick = setInterval(function() {
    if (!rooms[code]) { clearInterval(r._tick); r._tick = null; return; }
    r.timeLeft--;
    const ratio = 1 - r.timeLeft / r.drawTime;
    const nh = ratio >= 0.75 ? 0.45 : ratio >= 0.5 ? 0.25 : 0;
    if (nh > r.hintRatio) { r.hintRatio = nh; io.to(code).emit('hintUpdate', { hint: buildHint(word, nh) }); }
    io.to(code).emit('tick', { t: r.timeLeft });
    if (r.timeLeft <= 0) { safeTimer(r); endTurn(code); }
  }, 1000);
}

function endTurn(code) {
  const r = rooms[code];
  if (!r) return;
  safeTimer(r);
  r.players.forEach(function(p) {
    if (!p.stats) p.stats = { guessed: 0, drew: 0, totalPts: 0 };
    const drawer = r.players[r.drawerIdx];
    if (drawer && drawer.id === p.id) p.stats.drew++;
    const g = r.guessed.find(x => x.id === p.id);
    if (g) { p.stats.guessed++; p.stats.totalPts += g.pts; }
  });
  io.to(code).emit('turnEnd', {
    word: r.word || '?',
    scores: r.players.map(p => ({ id: p.id, name: p.name, score: p.score, avatar: p.avatar })),
  });
  r._end = setTimeout(function() {
    r._end = null;
    if (!rooms[code]) return;
    r.drawerIdx = (r.drawerIdx + 1) % r.players.length;
    if (r.drawerIdx === 0) r.round++;
    if (r.round > r.maxRounds) {
      const sorted = r.players.slice().sort((a, b) => b.score - a.score);
      io.to(code).emit('gameOver', {
        scores: r.players.map(p => ({ name: p.name, score: p.score, avatar: p.avatar, stats: p.stats })),
        winner: sorted[0].name, winnerAvatar: sorted[0].avatar,
      });
      r.started = false;
    } else {
      io.to(code).emit('clearCanvas');
      startTurn(code);
    }
  }, 5500);
}

function doLeave(socket, code) {
  const r = rooms[code];
  if (!r) return;
  const me = r.players.find(p => p.id === socket.id);
  r.players = r.players.filter(p => p.id !== socket.id);
  if (r.players.length === 0) { safeTimer(r); delete rooms[code]; return; }
  if (!r.players.find(p => p.isHost)) r.players[0].isHost = true;
  io.to(code).emit('playerUpdate', { players: r.players, msg: (me ? me.name : 'Oyunçu') + ' ayrıldı.' });
  if (!r.started) return;
  if (r.drawerIdx >= r.players.length) r.drawerIdx = r.players.length - 1;
  if (r.players.length < 2) {
    safeTimer(r); r.started = false; r.paused = true;
    io.to(code).emit('gamePaused');
  } else if (me) {
    const drawer = r.players[r.drawerIdx];
    if (!drawer || me.id === drawer.id) {
      safeTimer(r);
      io.to(code).emit('clearCanvas');
      setTimeout(() => { if (rooms[code]) startTurn(code); }, 1500);
    }
  }
}

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 2e5,
});

io.on('connection', function(socket) {

  socket.on('createRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd.');
    const name = String((d && d.name) || '').trim().substring(0, 16);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    const avatar     = Math.min(Math.max(parseInt(d && d.avatar)   || 0, 0), 7);
    const rounds     = Math.min(Math.max(parseInt(d && d.rounds)   || 3, 1), 10);
    const drawTime   = Math.min(Math.max(parseInt(d && d.drawTime) || 80, 30), 180);
    const category   = (d && d.category && (WORDS[d.category] || d.category === 'Hamısı')) ? d.category : 'Hamısı';
    const difficulty = ['easy','medium','hard','all'].includes(d && d.difficulty) ? d.difficulty : 'all';
    const customWords = Array.isArray(d && d.customWords)
      ? d.customWords.map(w => String(w).trim().substring(0, 40)).filter(w => w.length > 1).slice(0, 50)
      : [];
    const code = genCode();
    rooms[code] = {
      code, round: 1, maxRounds: rounds, drawTime, category, difficulty, customWords,
      drawerIdx: 0, started: false, paused: false,
      word: null, choices: [], guessed: [], hintRatio: 0,
      _tick: null, _choice: null, _end: null, timeLeft: 0,
      players: [{ id: socket.id, name, avatar, score: 0, isHost: true, stats: { guessed: 0, drew: 0, totalPts: 0 } }],
    };
    socket.join(code); socket.data.code = code;
    socket.emit('roomReady', { code, isHost: true, players: rooms[code].players,
      settings: { rounds, drawTime, category, difficulty, customWords } });
  });

  socket.on('joinRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd.');
    const name   = String((d && d.name) || '').trim().substring(0, 16);
    const code   = String((d && d.code) || '').trim();
    const avatar = Math.min(Math.max(parseInt(d && d.avatar) || 0, 0), 7);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    if (!/^\d{5}$/.test(code)) return socket.emit('err', '5 rəqəmli kodu daxil edin.');
    const r = rooms[code];
    if (!r) return socket.emit('err', 'Otaq tapılmadı.');
    if (r.started && !r.paused) return socket.emit('err', 'Oyun davam edir.');
    if (r.players.length >= 8) return socket.emit('err', 'Otaq doludur (maks 8).');
    const p = { id: socket.id, name, avatar, score: 0, isHost: false, stats: { guessed: 0, drew: 0, totalPts: 0 } };
    r.players.push(p);
    socket.join(code); socket.data.code = code;
    socket.emit('roomReady', { code, isHost: false, players: r.players,
      settings: { rounds: r.maxRounds, drawTime: r.drawTime, category: r.category, difficulty: r.difficulty, customWords: r.customWords } });
    socket.to(code).emit('playerUpdate', { players: r.players, msg: name + ' qoşuldu! 👋' });
    if (r.paused && r.players.length >= 2) {
      r.paused = false; r.started = true;
      r.players.forEach(p => p.score = 0);
      io.to(code).emit('gameStarted');
      setTimeout(() => { if (rooms[code]) startTurn(code); }, 1500);
    }
  });

  socket.on('startGame', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost || r.started) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    r.started = true; r.paused = false; r.round = 1; r.drawerIdx = 0;
    r.players.forEach(p => { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    io.to(r.code).emit('gameStarted');
    setTimeout(() => startTurn(r.code), 800);
  });

  socket.on('wordChosen', function(d) {
    if (!rateOk(socket.id, 3, 15000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || r.word) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    const w = d && d.word;
    if (!w || !r.choices.includes(w)) return;
    beginTurn(r.code, w);
  });

  socket.on('draw', function(d) {
    if (!rateOk(socket.id, 500, 1000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id !== socket.id) return;
    socket.to(r.code).emit('draw', d);
  });

  socket.on('fill', function(d) {
    if (!rateOk(socket.id, 15, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id !== socket.id) return;
    socket.to(r.code).emit('fill', d);
  });

  socket.on('shape', function(d) {
    if (!rateOk(socket.id, 30, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id !== socket.id) return;
    socket.to(r.code).emit('shape', d);
  });

  socket.on('clear', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id !== socket.id) return;
    io.to(r.code).emit('clearCanvas');
  });

  socket.on('guess', function(d) {
    if (!rateOk(socket.id, 15, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started || !r.word) return;
    const drawer = r.players[r.drawerIdx];
    if (drawer && drawer.id === socket.id) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || r.guessed.find(g => g.id === socket.id)) return;
    const guess = String((d && d.text) || '').trim().substring(0, 80);
    if (!guess) return;
    if (guess.toLowerCase() === r.word.toLowerCase()) {
      const pts = Math.max(10 - r.guessed.length, 5);
      me.score += pts;
      if (drawer) drawer.score += 5;
      r.guessed.push({ id: socket.id, pts });
      io.to(r.code).emit('correctGuess', {
        name: me.name, id: socket.id, pts, drawerId: drawer ? drawer.id : null,
        scores: r.players.map(p => ({ id: p.id, name: p.name, score: p.score, avatar: p.avatar })),
      });
      const nd = r.players.filter(p => !drawer || p.id !== drawer.id);
      if (r.guessed.length >= nd.length) { safeTimer(r); endTurn(r.code); }
    } else {
      const wl = r.word.toLowerCase(), gl = guess.toLowerCase();
      const mc = gl.split('').filter(c => wl.includes(c)).length;
      const close = wl.length > 3 && gl.length > 2 &&
        Math.abs(wl.length - gl.length) <= 2 && mc >= Math.floor(gl.length * 0.6);
      io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: guess, close });
    }
  });

  socket.on('chat', function(d) {
    if (!rateOk(socket.id, 10, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me) return;
    const drawer = r.players[r.drawerIdx];
    if (r.started && drawer && drawer.id === socket.id) return;
    io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar,
      text: String((d && d.text) || '').trim().substring(0, 80), close: false });
  });

  socket.on('kick', function(d) {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    const target = r.players.find(p => p.id === (d && d.targetId));
    if (!target || target.isHost) return;
    r.players = r.players.filter(p => p.id !== target.id);
    const ts = io.sockets.sockets.get(target.id);
    if (ts) { ts.emit('kicked'); ts.leave(r.code); ts.data.code = null; }
    io.to(r.code).emit('playerUpdate', { players: r.players, msg: target.name + ' çıxarıldı.' });
    if (r.started && r.players.length < 2) {
      safeTimer(r); r.started = false; r.paused = true;
      io.to(r.code).emit('gamePaused');
    }
  });

  socket.on('leaveRoom', function() {
    const code = socket.data && socket.data.code;
    if (!code) return;
    socket.data.code = null;
    doLeave(socket, code);
    socket.leave(code);
    socket.emit('leftRoom');
  });

  socket.on('playAgain', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r || r.started) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    r.round = 1; r.drawerIdx = 0; r.started = true; r.paused = false;
    r.players.forEach(p => { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    io.to(r.code).emit('gameStarted');
    setTimeout(() => startTurn(r.code), 800);
  });

  socket.on('disconnect', function() {
    for (const key of sockRate.keys()) {
      if (key.startsWith(socket.id + ':')) sockRate.delete(key);
    }
    const code = socket.data && socket.data.code;
    if (code) doLeave(socket, code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  const total = Object.values(WORDS).reduce((s, c) => s + c.easy.length + c.medium.length + c.hard.length, 0);
  console.log('CizTap port:' + PORT + ' words:' + total);
});
