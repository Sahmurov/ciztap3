const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ─── TƏHLÜKƏSİZLİK ──────────────────────────────────────────────────────────
app.use(function(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
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
  if (e.c > 120) return res.status(429).send('Çox sorğu.');
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
const CAT = {
  'Heyvanlar': [
    'it','pişik','at','inək','toyuq','ördək','aslan','pələng','fil','zürafə',
    'meymun','ayı','tülkü','dovşan','kirpi','ilan','tısbağa','balıq','quş','qartal',
    'göyərçin','qurbağa','köpəkbalığı','delfin','zebra','kərgədan','timsah','kərtənkələ',
    'maral','dəvə','kənguru','koala','pinqvin','flamingo','baykuş','eşşək','keçi','donuz',
    'xərçəng','ahtapot','arı','kəpənək','canavar','samur','qunduz','hipopotam','tukan',
    'papağan','leylək','qarğa','sərçə','bülbül','dəniz atı','dəvəquşu','şimpanze',
    'leopard','bufalo','ağ ayı','qorilla','kolibri','pelikan','ağcaqanad','salyangoz',
  ],
  'Meyvə və Tərəvəz': [
    'alma','armud','üzüm','qarpız','qovun','portağal','limon','gilas','ərik','pomidor',
    'xiyar','kartof','soğan','bibər','badımcan','göbələk','yerkökü','nanə','ispanaq',
    'kələm','turp','sarımsaq','çiyələk','moruq','heyva','əncir','xurma','nar','şaftalı',
    'gavalı','banan','ananas','mango','kivi','avokado','keşniş','reyhan','zoğal',
    'razyana','limon','qaragilə','böyürtkən','tərxun','brokkoli','qırmızı kələm',
  ],
  'Azərbaycan Yeməkləri': [
    'plov','qutab','dolma','düşbərə','xəngəl','bozbas','piti','qovurma','küftə',
    'lavangi','kebab','şorba','baklava','şəkərbura','halva','aşure','dovğa','qatıq',
    'dürüm','levengi','buğlama','paklavа','qənd','narsharab','saj','təndir çörəyi',
  ],
  'Gündəlik Yeməklər': [
    'çörək','yumurta','pendir','süd','pizza','burger','makaron','tort','dondurma',
    'şokolad','sandwich','omlet','düyü','çay','qəhvə','limonad','ayran','kərə yağı',
    'bal','konfet','keks','şəkər','çips','popcorn','waffle','krem','yoqart',
  ],
  'Nəqliyyat': [
    'avtomobil','avtobus','qatar','təyyarə','gəmi','motosiklet','velosiped','taksi',
    'metro','helikopter','yük maşını','ambulans','traktor','qayıq','yelkənli','tramvay',
    'raket','paraşut','skuter','kareta','pikap','ekskavator','buldozer','limuzin',
    'miniavtobus','at arabası','gondola','hava balonu',
  ],
  'Ev Əşyaları': [
    'stul','masa','divan','çarpayı','şkaf','soyuducu','televizor','telefon','kompüter',
    'kitab','qələm','makas','çanta','lampa','pəncərə','qapı','tava','qazan','çaydanıq',
    'fincan','boşqab','stəkan','açar','saat','güzgü','çətir','mişar','çəkic','pilləkən',
    'kərpic','mıx','vida','xalça','yastıq','yorğan','pərdə','şam','çıraq','kuzə',
    'termos','blender','mikrodalğalı soba','tozsoran','üzgəc','lifт','barmaqlıq',
  ],
  'Geyim': [
    'köynək','şalvar','ətək','palto','jaket','başlıq','corab','don','papaq','qurşaq',
    'boyunbağı','üzük','çəkmə','sandal','əlcək','kəmər','kostyum','qalstuk','plaş',
    'şlyapa','idman paltarı','bikini','kurtka','pencək','alt paltarı','şərfə',
  ],
  'Təbiət': [
    'dağ','dəniz','çay','göl','meşə','şəlalə','vulkan','ada','günəş','ay','ulduz',
    'bulud','yağış','qar','şimşək','göy qurşağı','gül','ağac','kaktus','palma','yarpaq',
    'göbələk','qaya','çöl','səhra','buzlaq','dalğa','külək','tufan','çiçək','torpaq',
    'mağara','dərə','yarımada','körfəz','delta','bataqlıq','tayqa','tropik',
  ],
  'İdman': [
    'futbol','basketbol','voleybol','tennis','üzgüçülük','boks','karate','şahmat',
    'qolf','badminton','skeytbord','gimnastika','güləş','oxatma','at yarışı',
    'marafon','yarış','polo','hokey','ragbi','kriket','nərd','dambıl','üzgüçülük',
    'triathlon','sürfing','dalğıclıq','alpinizm','qılınc oynatma',
  ],
  'Peşələr': [
    'həkim','müəllim','mühəndis','aşpaz','sürücü','pilot','polis','yanğınsöndürən',
    'bərbər','aktyor','müğənni','rəssam','yazıçı','jurnalist','hüquqşünas',
    'proqramçı','arxitektor','cərrah','bağban','balıqçı','fotoqraf','diplomat',
    'mühasib','psixoloq','diş həkimi','baytarlıq həkimi','astronavt','çoban',
  ],
  'Azərbaycan': [
    'Bakı','Şuşa','Gəncə','Naxçıvan','Lənkəran','Quba','Şəki','Mingəçevir',
    'xalça','tar','kamança','nar','qala','karvansara','İçərişəhər','Qəbələ',
    'İsmayıllı','bayraq','Biləsuvar','Zaqatala','Qax','Balakən','Şamaxı',
    'Lerik','Masallı','Astara','Bərdə','Ağdam','Füzuli','Şirvan',
  ],
};

const ALL = Object.values(CAT).reduce(function(a, b) { return a.concat(b); }, []);
CAT['Hamısı'] = ALL;

function getRandWords(cat, n) {
  const pool = (cat && CAT[cat]) ? CAT[cat].slice() : ALL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, n || 3);
}

function buildHint(word, ratio) {
  const chars = word.split('');
  const idxs = chars.map(function(c, i) { return c !== ' ' ? i : -1; }).filter(function(i) { return i >= 0; });
  const n = Math.floor(idxs.length * (ratio || 0));
  const show = new Set(idxs.slice(0, n));
  return chars.map(function(c, i) { return c === ' ' ? ' ' : (show.has(i) ? c : '_'); }).join(' ');
}

function genCode() { return Math.floor(10000 + Math.random() * 90000).toString(); }

// ─── OTAQLAR ─────────────────────────────────────────────────────────────────
const rooms = {};

function startTurn(code) {
  const r = rooms[code];
  if (!r || r.players.length < 2) return;
  r.word = null; r.guessed = []; r.timeLeft = r.drawTime; r.hintRatio = 0;
  const drawer = r.players[r.drawerIdx];
  r.choices = getRandWords(r.category, 3);
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
    if (nh > r.hintRatio) {
      r.hintRatio = nh;
      io.to(code).emit('hintUpdate', { hint: buildHint(word, nh) });
    }
    io.to(code).emit('tick', { t: r.timeLeft });
    if (r.timeLeft <= 0) { clearInterval(r.timer); endTurn(code); }
  }, 1000);
}

function endTurn(code) {
  const r = rooms[code];
  if (!r) return;
  clearInterval(r.timer); clearTimeout(r.choiceTimer);
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
        scores: r.players.map(function(p) { return { name: p.name, score: p.score, avatar: p.avatar }; }),
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
  if (r.players.length === 0) {
    clearInterval(r.timer); clearTimeout(r.choiceTimer);
    delete rooms[code]; return;
  }
  if (!r.players.find(function(p) { return p.isHost; })) r.players[0].isHost = true;
  io.to(code).emit('playerUpdate', {
    players: r.players,
    msg: (me ? me.name : 'Oyunçu') + ' ayrıldı.',
  });
  if (r.started) {
    if (r.drawerIdx >= r.players.length) r.drawerIdx = 0;
    if (r.players.length < 2) {
      clearInterval(r.timer); clearTimeout(r.choiceTimer);
      r.started = false;
      io.to(code).emit('gamePaused');
    } else if (me && r.players[r.drawerIdx] && me.id === r.players[r.drawerIdx].id) {
      clearInterval(r.timer); clearTimeout(r.choiceTimer);
      io.to(code).emit('clearCanvas');
      setTimeout(function() { if (rooms[code]) startTurn(code); }, 2000);
    }
  }
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 60000, maxHttpBufferSize: 1e5 });

io.on('connection', function(socket) {

  socket.on('createRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd. Gözləyin.');
    const name = ((d && d.name) || '').trim().substring(0, 16);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    const avatar = Math.min(Math.max(parseInt(d && d.avatar) || 0, 0), 7);
    const rounds = Math.min(Math.max(parseInt(d && d.rounds) || 3, 1), 10);
    const drawTime = Math.min(Math.max(parseInt(d && d.drawTime) || 80, 30), 180);
    const category = (d && d.category && CAT[d.category]) ? d.category : 'Hamısı';
    const code = genCode();
    rooms[code] = {
      code: code, round: 1, maxRounds: rounds, drawTime: drawTime, category: category,
      drawerIdx: 0, started: false,
      word: null, choices: [], guessed: [], hintRatio: 0,
      timer: null, choiceTimer: null, timeLeft: 0,
      players: [{ id: socket.id, name: name, avatar: avatar, score: 0, isHost: true }],
    };
    socket.join(code);
    socket.data.code = code;
    socket.emit('roomReady', {
      code: code, isHost: true, players: rooms[code].players,
      settings: { rounds: rounds, drawTime: drawTime, category: category },
    });
  });

  socket.on('joinRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd. Gözləyin.');
    const name = ((d && d.name) || '').trim().substring(0, 16);
    const code = ((d && d.code) || '').trim();
    const avatar = Math.min(Math.max(parseInt(d && d.avatar) || 0, 0), 7);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    if (!/^\d{5}$/.test(code)) return socket.emit('err', '5 rəqəmli kodu daxil edin.');
    const r = rooms[code];
    if (!r) return socket.emit('err', 'Otaq tapılmadı. Kodu yoxlayın.');
    if (r.started) return socket.emit('err', 'Oyun artıq başlayıb.');
    if (r.players.length >= 8) return socket.emit('err', 'Otaq doludur (maks 8).');
    r.players.push({ id: socket.id, name: name, avatar: avatar, score: 0, isHost: false });
    socket.join(code);
    socket.data.code = code;
    socket.emit('roomReady', {
      code: code, isHost: false, players: r.players,
      settings: { rounds: r.maxRounds, drawTime: r.drawTime, category: r.category },
    });
    socket.to(code).emit('playerUpdate', { players: r.players, msg: name + ' qoşuldu! 👋' });
  });

  socket.on('startGame', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(function(p) { return p.id === socket.id; });
    if (!me || !me.isHost) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    if (r.started) return;
    r.started = true; r.round = 1; r.drawerIdx = 0;
    r.players.forEach(function(p) { p.score = 0; });
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
    if (!rateOk(socket.id, 200, 1000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(r.code).emit('draw', d);
  });

  socket.on('fill', function(d) {
    if (!rateOk(socket.id, 10, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(r.code).emit('fill', d);
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
      if (drawer) drawer.score += 5; // çizənə 5 xal
      r.guessed.push({ id: socket.id });
      io.to(r.code).emit('correctGuess', {
        name: me.name, id: socket.id, pts: pts,
        drawerId: drawer ? drawer.id : null,
        scores: r.players.map(function(p) { return { id: p.id, name: p.name, score: p.score, avatar: p.avatar }; }),
      });
      const nd = r.players.filter(function(p) { return !drawer || p.id !== drawer.id; });
      if (r.guessed.length >= nd.length) { clearInterval(r.timer); endTurn(r.code); }
    } else {
      const wl = r.word.toLowerCase(), gl = guess.toLowerCase();
      const mc = gl.split('').filter(function(c) { return wl.includes(c); }).length;
      const close = wl.length > 3 && gl.length > 2 && Math.abs(wl.length - gl.length) <= 2 && mc >= Math.floor(gl.length * 0.6);
      io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: guess, close: close });
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
    io.to(r.code).emit('chat', {
      name: me.name, avatar: me.avatar,
      text: String((d && d.text) || '').trim().substring(0, 80),
      close: false,
    });
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
      r.started = false; io.to(r.code).emit('gamePaused');
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
    r.round = 1; r.drawerIdx = 0; r.started = true;
    r.players.forEach(function(p) { p.score = 0; });
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
  console.log('CizTap isleyir — port ' + PORT + ' — ' + ALL.length + ' soz');
});
