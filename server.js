const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
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
  e.c++;
  httpRate.set(ip, e);
  if (httpRate.size > 5000) for (const [k, v] of httpRate) if (now - v.t > 60000) httpRate.delete(k);
  if (e.c > 150) return res.status(429).send('Çox sorğu.');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const sockRate = new Map();
function rateOk(id, limit, ms) {
  const now = Date.now();
  const e = sockRate.get(id) || { c: 0, t: now };
  if (now - e.t > (ms || 10000)) { e.c = 0; e.t = now; }
  e.c++;
  sockRate.set(id, e);
  return e.c <= (limit || 40);
}

// ─── SÖZ BANKASI ─────────────────────────────────────────────────────────────
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
    hard:   ['levengi','buğlama','narsharab','təndir çörəyi','qənd halva'],
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
    hard:   ['cərrah','diplomat','psixoloq','astronavt','kriptoqraf','nevroloq'],
  },
  'Azərbaycan': {
    easy:   ['nar','xalça','tar','bayraq','qala','çay','saz'],
    medium: ['kamança','karvansara','İçərişəhər','papaq','kəlağayı','balaban'],
    hard:   ['zurna','nağara','qaval','tütək','ud','qanun','qobustan'],
  },
};

function getPool(cat, diff) {
  if (cat === 'Hamısı') {
    const all = [];
    Object.values(WORDS).forEach(function(c) {
      const src = diff === 'all' ? c.easy.concat(c.medium).concat(c.hard) : (c[diff] || c.easy);
      all.push.apply(all, src);
    });
    return all;
  }
  const c = WORDS[cat];
  if (!c) return Object.values(WORDS)[0].easy;
  return diff === 'all' ? c.easy.concat(c.medium).concat(c.hard) : (c[diff] || c.easy);
}

function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function getRandWords(room, n) {
  let pool = getPool(room.category, room.difficulty);
  if (room.customWords && room.customWords.length) pool = pool.concat(room.customWords);
  return shuffle(pool).slice(0, n || 3);
}

function buildHint(word, ratio) {
  const chars = word.split('');
  const idxs = chars.map(function(c, i) { return c !== ' ' ? i : -1; }).filter(function(i) { return i >= 0; });
  const show = new Set(idxs.slice(0, Math.floor(idxs.length * (ratio || 0))));
  return chars.map(function(c, i) { return c === ' ' ? ' ' : (show.has(i) ? c : '_'); }).join(' ');
}

function genCode() { return Math.floor(10000 + Math.random() * 90000).toString(); }

// ─── ROOMS ───────────────────────────────────────────────────────────────────
const rooms = {};

function startTurn(code) {
  const r = rooms[code];
  if (!r || r.players.length < 2) return;
  r.word = null; r.guessed = []; r.timeLeft = r.drawTime; r.hintRatio = 0;
  const drawer = r.players[r.drawerIdx];
  r.choices = getRandWords(r, 3);
  io.to(drawer.id).emit('chooseWord', { words: r.choices });
  io.to(code).emit('waitingWord', { drawerName: drawer.name, drawerId: drawer.id });
  r.choiceTimer = setTimeout(function() {
    if (!r.word) beginTurn(code, r.choices[Math.floor(Math.random() * r.choices.length)]);
  }, 12000);
}

function beginTurn(code, word) {
  const r = rooms[code];
  if (!r) return;
  clearTimeout(r.choiceTimer);
  r.word = word; r.timeLeft = r.drawTime; r.hintRatio = 0;
  const drawer = r.players[r.drawerIdx];
  io.to(drawer.id).emit('yourWord', { word: word });
  io.to(code).emit('turnStart', {
    drawerName: drawer.name, drawerId: drawer.id,
    wordLen: word.length, hint: buildHint(word, 0),
    round: r.round, maxRounds: r.maxRounds, timeLeft: r.timeLeft,
  });
  r.timer = setInterval(function() {
    r.timeLeft--;
    const ratio = 1 - r.timeLeft / r.drawTime;
    const nh = ratio >= 0.75 ? 0.45 : ratio >= 0.5 ? 0.25 : 0;
    if (nh > r.hintRatio) { r.hintRatio = nh; io.to(code).emit('hintUpdate', { hint: buildHint(word, nh) }); }
    io.to(code).emit('tick', { t: r.timeLeft });
    if (r.timeLeft <= 0) { clearInterval(r.timer); endTurn(code); }
  }, 1000);
}

function endTurn(code) {
  const r = rooms[code];
  if (!r) return;
  clearInterval(r.timer); clearTimeout(r.choiceTimer);
  r.players.forEach(function(p) {
    if (!p.stats) p.stats = { guessed: 0, drew: 0, totalPts: 0 };
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id === p.id) p.stats.drew++;
    const g = r.guessed.find(function(x) { return x.id === p.id; });
    if (g) { p.stats.guessed++; p.stats.totalPts += g.pts; }
  });
  io.to(code).emit('turnEnd', {
    word: r.word || '?',
    scores: r.players.map(function(p) { return { id: p.id, name: p.name, score: p.score, avatar: p.avatar }; }),
  });
  setTimeout(function() {
    if (!rooms[code]) return;
    r.drawerIdx = (r.drawerIdx + 1) % r.players.length;
    if (r.drawerIdx === 0) r.round++;
    if (r.round > r.maxRounds) {
      const s = r.players.slice().sort(function(a, b) { return b.score - a.score; });
      io.to(code).emit('gameOver', {
        scores: r.players.map(function(p) { return { name: p.name, score: p.score, avatar: p.avatar, stats: p.stats }; }),
        winner: s[0].name, winnerAvatar: s[0].avatar,
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
  const me = r.players.find(function(p) { return p.id === socket.id; });
  r.players = r.players.filter(function(p) { return p.id !== socket.id; });
  if (r.players.length === 0) { clearInterval(r.timer); clearTimeout(r.choiceTimer); delete rooms[code]; return; }
  if (!r.players.find(function(p) { return p.isHost; })) r.players[0].isHost = true;
  io.to(code).emit('playerUpdate', { players: r.players, msg: (me ? me.name : 'Oyunçu') + ' ayrıldı.' });
  if (r.started) {
    if (r.drawerIdx >= r.players.length) r.drawerIdx = 0;
    if (r.players.length < 2) {
      clearInterval(r.timer); clearTimeout(r.choiceTimer);
      r.started = false; r.paused = true;
      io.to(code).emit('gamePaused');
    } else if (me && r.players[r.drawerIdx] && me.id === r.players[r.drawerIdx].id) {
      clearInterval(r.timer); clearTimeout(r.choiceTimer);
      io.to(code).emit('clearCanvas');
      setTimeout(function() { if (rooms[code]) startTurn(code); }, 2000);
    }
  }
}

// ─── SOCKET ───────────────────────────────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 60000, maxHttpBufferSize: 2e5 });

io.on('connection', function(socket) {

  socket.on('createRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd. Gözləyin.');
    const name = ((d && d.name) || '').trim().substring(0, 16);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    const avatar   = Math.min(Math.max(parseInt(d && d.avatar)   || 0, 0), 7);
    const rounds   = Math.min(Math.max(parseInt(d && d.rounds)   || 3, 1), 10);
    const drawTime = Math.min(Math.max(parseInt(d && d.drawTime) || 80, 30), 180);
    const category = (d && d.category && (WORDS[d.category] || d.category === 'Hamısı')) ? d.category : 'Hamısı';
    const difficulty = ['easy','medium','hard','all'].includes(d && d.difficulty) ? d.difficulty : 'all';
    const customWords = Array.isArray(d && d.customWords)
      ? d.customWords.map(function(w) { return String(w).trim().substring(0, 40); }).filter(function(w) { return w.length > 1; }).slice(0, 50)
      : [];
    const code = genCode();
    rooms[code] = {
      code, round: 1, maxRounds: rounds, drawTime, category, difficulty, customWords,
      drawerIdx: 0, started: false, paused: false,
      word: null, choices: [], guessed: [], hintRatio: 0,
      timer: null, choiceTimer: null, timeLeft: 0,
      players: [{ id: socket.id, name, avatar, score: 0, isHost: true, stats: { guessed: 0, drew: 0, totalPts: 0 } }],
    };
    socket.join(code); socket.data.code = code;
    socket.emit('roomReady', { code, isHost: true, players: rooms[code].players,
      settings: { rounds, drawTime, category, difficulty, customWords } });
  });

  socket.on('joinRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd. Gözləyin.');
    const name = ((d && d.name) || '').trim().substring(0, 16);
    const code = ((d && d.code) || '').trim();
    const avatar = Math.min(Math.max(parseInt(d && d.avatar) || 0, 0), 7);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    if (!/^\d{5}$/.test(code)) return socket.emit('err', '5 rəqəmli kodu daxil edin.');
    const r = rooms[code];
    if (!r) return socket.emit('err', 'Otaq tapılmadı.');
    // FIX: allow joining paused game (was started but now < 2 players)
    if (r.started && !r.paused) return socket.emit('err', 'Oyun davam edir. Növbəti raundda qoşulun.');
    if (r.players.length >= 8) return socket.emit('err', 'Otaq doludur (maks 8).');
    const newPlayer = { id: socket.id, name, avatar, score: 0, isHost: false, stats: { guessed: 0, drew: 0, totalPts: 0 } };
    r.players.push(newPlayer);
    socket.join(code); socket.data.code = code;
    socket.emit('roomReady', { code, isHost: false, players: r.players,
      settings: { rounds: r.maxRounds, drawTime: r.drawTime, category: r.category, difficulty: r.difficulty, customWords: r.customWords } });
    socket.to(code).emit('playerUpdate', { players: r.players, msg: name + ' qoşuldu! 👋' });
    // FIX: if game was paused and now has 2+ players, resume automatically
    if (r.paused && r.players.length >= 2) {
      r.paused = false; r.started = true;
      r.players.forEach(function(p) { p.score = 0; });
      io.to(code).emit('gameStarted');
      setTimeout(function() { startTurn(code); }, 1500);
    }
  });

  socket.on('startGame', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    if (r.started) return;
    r.started = true; r.paused = false; r.round = 1; r.drawerIdx = 0;
    r.players.forEach(function(p) { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    io.to(r.code).emit('gameStarted');
    setTimeout(function() { startTurn(r.code); }, 800);
  });

  socket.on('wordChosen', function(d) {
    if (!rateOk(socket.id, 3, 15000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || r.word) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    const w = d && d.word;
    if (!w || r.choices.indexOf(w) === -1) return;
    beginTurn(r.code, w);
  });

  socket.on('draw', function(d) {
    if (!rateOk(socket.id, 400, 1000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(r.code).emit('draw', d);
  });

  socket.on('fill', function(d) {
    if (!rateOk(socket.id, 15, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(r.code).emit('fill', d);
  });

  socket.on('shape', function(d) {
    if (!rateOk(socket.id, 30, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(r.code).emit('shape', d);
  });

  socket.on('clear', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    io.to(r.code).emit('clearCanvas');
  });

  socket.on('guess', function(d) {
    if (!rateOk(socket.id, 15, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started || !r.word) return;
    const drawer = r.players[r.drawerIdx];
    if (drawer && drawer.id === socket.id) return;
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me) return;
    if (r.guessed.find(function(g) { return g.id === socket.id; })) return;
    const guess = String((d && d.text) || '').trim().substring(0, 80);
    if (!guess) return;
    if (guess.toLowerCase() === r.word.toLowerCase()) {
      const pts = Math.max(10 - r.guessed.length, 5);
      me.score += pts;
      if (drawer) drawer.score += 5;
      r.guessed.push({ id: socket.id, pts });
      io.to(r.code).emit('correctGuess', {
        name: me.name, id: socket.id, pts,
        drawerId: drawer ? drawer.id : null,
        scores: r.players.map(function(p) { return { id: p.id, name: p.name, score: p.score, avatar: p.avatar }; }),
      });
      const nd = r.players.filter(function(p) { return !drawer || p.id !== drawer.id; });
      if (r.guessed.length >= nd.length) { clearInterval(r.timer); endTurn(r.code); }
    } else {
      const wl = r.word.toLowerCase(), gl = guess.toLowerCase();
      const mc = gl.split('').filter(function(c) { return wl.includes(c); }).length;
      const close = wl.length > 3 && gl.length > 2 && Math.abs(wl.length - gl.length) <= 2 && mc >= Math.floor(gl.length * 0.6);
      io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: guess, close });
    }
  });

  socket.on('chat', function(d) {
    if (!rateOk(socket.id, 10, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me) return;
    const drawer = r.players[r.drawerIdx];
    if (r.started && drawer && drawer.id === socket.id) return;
    io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: String((d && d.text) || '').trim().substring(0, 80), close: false });
  });

  socket.on('kick', function(d) {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    const tid = d && d.targetId;
    const target = r.players.find(function(p) { return p.id === tid; });
    if (!target || target.isHost) return;
    r.players = r.players.filter(function(p) { return p.id !== tid; });
    const ts = io.sockets.sockets.get(tid);
    if (ts) { ts.emit('kicked'); ts.leave(r.code); ts.data.code = null; }
    io.to(r.code).emit('playerUpdate', { players: r.players, msg: target.name + ' çıxarıldı.' });
    if (r.started && r.players.length < 2) {
      clearInterval(r.timer); clearTimeout(r.choiceTimer);
      r.started = false; r.paused = true;
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
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    r.round = 1; r.drawerIdx = 0; r.started = true; r.paused = false;
    r.players.forEach(function(p) { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    io.to(r.code).emit('gameStarted');
    setTimeout(function() { startTurn(r.code); }, 800);
  });

  socket.on('disconnect', function() {
    sockRate.delete(socket.id);
    const code = socket.data && socket.data.code;
    if (code) doLeave(socket, code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  const total = Object.values(WORDS).reduce(function(s, c) { return s + c.easy.length + c.medium.length + c.hard.length; }, 0);
  console.log('CizTap calishir — port ' + PORT + ' — ' + total + ' soz');
});
