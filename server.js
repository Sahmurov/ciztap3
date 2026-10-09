const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
// Render proxy arxasındadır: real istifadəçi IP-si X-Forwarded-For-dan gəlsin
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '4kb' }));

app.use(function(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' ws: wss: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});

// Limiter yalnız RAM-da, 1 dəqiqəlik pəncərə; köhnə qeydlər hər dəqiqə silinir.
// IP heç yerdə saxlanılmır və göstərilmir — yalnız sorğu sayını izləmək üçündür.
const httpRate = new Map();
setInterval(function() {
  const now = Date.now();
  for (const [k, e] of httpRate) if (now - e.t > 60000) httpRate.delete(k);
}, 60000).unref();
app.use(function(req, res, next) {
  const ip  = req.ip || 'x';
  const now = Date.now();
  const e   = httpRate.get(ip) || { c:0, t:now };
  if (now - e.t > 60000) { e.c=0; e.t=now; }
  if (++e.c > 200) return res.status(429).send('Too many requests.');
  httpRate.set(ip, e);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const sockRate = new Map();
function rateOk(id, limit, ms) {
  const key = id + ':' + (ms||10000);
  const now = Date.now();
  const e   = sockRate.get(key) || { c:0, t:now };
  if (now - e.t > (ms||10000)) { e.c=0; e.t=now; }
  e.c++;
  sockRate.set(key, e);
  return e.c <= (limit||40);
}

// ── Söz bankı (yalnız AZE, gündəlik, çəkilə bilən) ────────────────────────────
const WORDS = {
  'Heyvanlar': {
    easy: [
      'it', 'pişik', 'at', 'inək', 'toyuq', 'balıq', 'quş', 'aslan', 'fil', 'ayı', 'donuz', 'keçi',
      'ördək', 'siçan', 'dovşan', 'qaz', 'xoruz', 'qoyun', 'arı', 'kəpənək', 'ilan', 'qurbağa',
      'tülkü', 'sincap', 'kirpi', 'canavar', 'dəvə', 'maymun', 'pələng', 'zebra', 'dana', 'leylək',
      'göyərçin', 'tısbağa', 'qartal', 'eşşək', 'qarğa', 'cücə', 'şir', 'qurd', 'ceyran', 'sığır',
      'öküz', 'milçək', 'balina', 'ahtapot', 'dələ', 'bildirçin', 'qarışqa',
    ],
    medium: [
      'zürafə', 'bəbir', 'hörümçək', 'çəyirtkə',
    ],
    hard: [
      'dəvəquşu', 'şimpanze', 'kərgədan', 'hipopotam', 'pelikan', 'delfin', 'kənguru', 'pinqvin',
      'timsah', 'maral', 'xərçəng', 'meduza', 'köpək balığı', 'buzov', 'çöl donuzu', 'porsuq',
      'su samuru', 'tərlan', 'qu quşu', 'qaranquş', 'serçə', 'ağacdələn', 'bayquş', 'palıd quşu',
    ],
  },
  'Meyvə və tərəvəz': {
    easy: [
      'alma', 'armud', 'üzüm', 'qarpız', 'portağal', 'limon', 'pomidor', 'xiyar', 'kartof',
      'soğan', 'banan', 'gilas', 'çiyələk', 'kələm', 'yerkökü', 'bibər', 'sarımsaq', 'turp',
      'badımcan', 'göy soğan', 'alça', 'zoğal', 'qarağat', 'moruq', 'qoz', 'fındıq', 'badam',
      'nanə', 'reyhan', 'noxud', 'paxla', 'ərik',
    ],
    medium: [
      'heyva', 'əncir', 'nar', 'şaftalı', 'ananas', 'kivi', 'gavalı', 'qovun', 'şabalıd',
      'qaragilə', 'qırmızı kələm', 'ispanaq', 'qabaq', 'göy noxud', 'lobya', 'mərci', 'qarğıdalı',
      'manqo', 'papaya',
    ],
    hard: [],
  },
  'Ev əşyaları': {
    easy: [
      'stul', 'masa', 'divan', 'çarpayı', 'şkaf', 'soyuducu', 'televizor', 'telefon', 'qapı',
      'pəncərə', 'çıraq', 'pilləkən', 'yastıq', 'yorğan', 'vanna', 'tualet', 'mətbəx', 'balkon',
      'həyət', 'çəpər', 'qazan', 'tava', 'çömçə', 'stəkan', 'dolab', 'ütü', 'ocaq', 'süzgəc',
      'pərdə', 'qapaq', 'kasa', 'sürahi', 'tabaq', 'kran', 'səbət',
    ],
    medium: [
      'çaydanıq', 'fincan', 'boşqab', 'qaşıq', 'bıçaq', 'çəngəl', 'vedrə', 'süpürgə', 'güzgü',
      'xalça', 'çəkic', 'mişar', 'vida', 'eynək', 'saat', 'açar', 'lampochka', 'döşəmə', 'tavan',
      'divar',
    ],
    hard: [
      'tozsoran', 'termos', 'blender', 'mum', 'fırça', 'rəf',
    ],
  },
  'Yemək və içki': {
    easy: [
      'çörək', 'pizza', 'tort', 'dondurma', 'şokolad', 'plov', 'kabab', 'yumurta', 'süd', 'pendir',
      'çay', 'alma suyu', 'limonad', 'su', 'qəhvə', 'bal', 'kərə yağı', 'kotlet', 'aş', 'paxlava',
      'mürəbbə', 'qaymaq', 'yoğurd', 'lavaş', 'sıyıq', 'qovurma',
    ],
    medium: [
      'omlet', 'makaron', 'keks', 'salat', 'şorba', 'ayran', 'qatıq', 'souslu makaron', 'dolma',
      'qutab', 'düşbərə', 'piti', 'xəngəl', 'baklava', 'şəkərbura', 'pakhlava', 'bozbaş',
      'lülə kabab', 'kələm dolması', 'dovğa', 'nar şirəsi', 'üzüm şirəsi',
    ],
    hard: [],
  },
  'Nəqliyyat': {
    easy: [
      'maşın', 'avtobus', 'qatar', 'təyyarə', 'gəmi', 'velosiped', 'taksi', 'metro', 'motosiklet',
      'helikopter', 'ambulans', 'traktor', 'yük maşını', 'araba', 'raketa', 'furqon',
      'minik maşını',
    ],
    medium: [
      'tramvay', 'yelkənli', 'qanadlı', 'ekskavator', 'buldozer', 'yanğın maşını', 'polis maşını',
      'skuter', 'elektrikli skuter', 'qayıq', 'motorlu qayıq', 'reaktiv təyyarə', 'yük qatarı',
    ],
    hard: [
      'hava balonu', 'paraşut',
    ],
  },
  'Geyim': {
    easy: [
      'köynək', 'şalvar', 'palto', 'papaq', 'corab', 'çəkmə', 'sandal', 'don', 'jaket', 'çanta',
      'kəmər', 'ətək', 'saatı', 'paltar', 'yaxa', 'ayaqqabı', 'yaylıq', 'baş örtüyü', 'dəsmal',
      'sırğa', 'bilərzik', 'pencək', 'çarıq', 'bluza',
    ],
    medium: [
      'əlcək', 'boyunbağı', 'üzük', 'şərfə', 'kostyum', 'qalstuk', 'çadra', 'kürk', 'gödəkçə',
      'pijama', 'mayo', 'şort',
    ],
    hard: [
      'plaş', 'kəlağayı', 'araqçın',
    ],
  },
  'Təbiət': {
    easy: [
      'dağ', 'dəniz', 'göl', 'meşə', 'günəş', 'ay', 'ulduz', 'bulud', 'yağış', 'qar', 'ağac',
      'çiçək', 'od', 'külək', 'tufan', 'ildırım', 'göy qurşağı', 'günbatan', 'şəlalə', 'vadi',
      'bağ', 'kol', 'yarpaq', 'duman', 'qasırğa', 'leysan', 'şeh', 'qaya', 'lalə', 'qızılgül',
      'bənövşə',
    ],
    medium: [
      'ada', 'palma', 'dalğa', 'daş', 'torpaq', 'qum', 'buz', 'ot', 'çöl', 'meşə yanğını', 'sahil',
      'uçurum', 'çəmən', 'bulaq', 'mağara', 'buzlaq', 'gölməçə', 'dərə', 'səhra',
    ],
    hard: [
      'bataqlıq', 'yarımada', 'delta', 'körfəz', 'vulkan', 'kaktus', 'göbələk',
    ],
  },
  'İdman': {
    easy: [
      'futbol', 'basketbol', 'tennis', 'üzgüçülük', 'boks', 'qaçış', 'voleybol', 'top', 'qol',
      'məşq', 'stadion', 'velosiped sürməyi', 'şahmat', 'dama', 'cüdo', 'xizək', 'tullanma',
    ],
    medium: [
      'gimnastika', 'badminton', 'güləş', 'üzgüçülük hovuzu', 'ağırlıq qaldırma', 'atıcılıq',
      'ox atma', 'dalğıclıq', 'at yarışı', 'kürək çəkmə', 'ağır atletika',
    ],
    hard: [],
  },
  'Yer və bina': {
    easy: [
      'ev', 'məktəb', 'xəstəxana', 'mağaza', 'park', 'körpü', 'yol', 'küçə', 'bazar', 'kafe',
      'restoran', 'mehmanxana', 'bank', 'kitabxana', 'hamam', 'bağça', 'stansiya', 'dayanacaq',
      'kənd', 'şəhər', 'meydan', 'hasar', 'quyu', 'saray',
    ],
    medium: [
      'muzey', 'teatr', 'kinoteatr', 'hovuz', 'fabrik', 'çiçəkçi', 'bərbər', 'aptek', 'poçt',
      'məscid', 'kilsə', 'qəbiristanlıq', 'qala', 'hava limanı', 'qəhvəxana',
    ],
    hard: [
      'qüllə', 'piramida', 'sərgi pavilyonu',
    ],
  },
  'Əşya və alət': {
    easy: [
      'kitab', 'qələm', 'makas', 'lampa', 'kamera', 'kompüter', 'çətir', 'radio', 'şüşə', 'qab',
      'zəng', 'dəftər', 'silgi', 'kağız', 'qutu', 'fənər', 'bel', 'dırmıq', 'kompas', 'xəritə',
      'iynə', 'ip', 'düymə', 'boya', 'şam',
    ],
    medium: [
      'mikrofon', 'gitara', 'nağara', 'lövhə', 'çamadan', 'torba', 'tabanca', 'çilingər alətləri',
      'şpris', 'dürbün',
    ],
    hard: [],
  },
  'Azərbaycan': {
    easy: [
      'tar', 'bayraq', 'saz', 'buta', 'neft', 'alov', 'xəzər', 'bakı', 'şuşa', 'ləcək', 'ipək',
      'gəlin', 'küp', 'samovar', 'mirvari', 'şərbət',
    ],
    medium: [
      'kamança', 'balaban', 'karvansara', 'novruz', 'süməlak', 'semeni', 'xonça', 'kosa', 'keçəl',
      'qobustan', 'dəyirman',
    ],
    hard: [
      'zurna', 'qaval', 'tütək',
    ],
  },
  'Sevgi': {
    easy: [
      'ürək', 'gül', 'gül buketi', 'məktub', 'sevgi məktubu', 'balon', 'ürəkli balon', 'öpüş',
      'dodaq', 'qucaq', 'yelləncək', 'kartpostal', 'nişan üzüyü', 'toy tortu', 'şam yeməyi',
      'bilet', 'qəlb', 'oxlu ürək', 'iki ürək', 'ürəkli kilid', 'sevgi quşları', 'ətir', 'hədiyyə',
      'hədiyyə qutusu', 'şəkil', 'mahnı', 'piknik', 'iki fincan', 'əl ələ',
    ],
    medium: [
      'ulduzlu səma', 'ay işığı', 'sahil gəzintisi', 'uçan fənər', 'dəniz kənarı', 'ulduz yağışı',
      'musiqi qutusu', 'pianino', 'park skamyası', 'ürəkli fincan', 'ürəkli şokolad',
      'təbrik kartı', 'kino bileti', 'romantik şam', 'toy', 'gəlin buketi', 'ürəkli pəncərə',
      'ürəkli şəkil', 'qırmızı şərab', 'romantik axşam', 'sevgi ağacı', 'iki gül', 'gözəl mənzərə',
      'dəniz qırağı', 'ürəkli yastıq', 'ürəkli açar',
    ],
    hard: [
      'gecə yarısı', 'nişanlılar', 'bəy', 'valentin günü', 'öpüşmək', 'qucaqlaşmaq',
      'sevgi kilidi', 'ürəkli körpü', 'ürək döyüntüsü', 'ulduz tozu', 'ürək şəkilli', 'sevgili',
      'ürəkli məktub', 'kiçik ürək', 'qızıl üzük',
    ],
  },
};

function getPool(cat, diff) {
  // 'Hamısı' sevgi kateqoriyasını daxil etmir — sevgi sözləri yalnız seçiləndə çıxır
  const cats = cat === 'Hamısı'
    ? Object.keys(WORDS).filter(k => k !== 'Sevgi').map(k => WORDS[k])
    : [WORDS[cat] || Object.values(WORDS)[0]];
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
function pick5(room) {
  let pool = getPool(room.category, room.difficulty);
  if (room.customWords && room.customWords.length) pool = pool.concat(room.customWords);
  pool = shuffle(pool);
  // Avoid repeating recently used words
  const recent = room.recentWords || [];
  const fresh  = pool.filter(w => !recent.includes(w));
  return (fresh.length >= 5 ? fresh : pool).slice(0, 5);
}
function genCode() { return String(((Math.random() * 90000) | 0) + 10000); }
// Mövcud otaqla toqquşmayan kod (köhnə otağın üzərinə yazılmasın)
function newRoomCode() {
  for (let i = 0; i < 50; i++) { const c = genCode(); if (!rooms[c]) return c; }
  return null;
}

// ── Zaman əsaslı xal sistemi ──────────────────────────────────────────────────
// drawTime 8 bərabər hissəyə bölünür. Nə qədər tez tapsan xal bir o qədər çox.
function calcPts(drawTime, timeLeft) {
  const elapsed  = drawTime - timeLeft;
  const segment  = drawTime / 8;
  const tier     = Math.min(Math.floor(elapsed / segment), 7);  // 0–7
  return 10 - tier;   // 10,9,8,7,6,5,4,3
}

// ── Yaxın cavab yoxlama (Levenshtein məsafəsi ≤ 2) ───────────────────────────
function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  const prev = Array.from({length: n + 1}, (_, i) => i);
  const curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i-1] === b[j-1]
        ? prev[j-1]
        : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
    }
    prev.splice(0, n + 1, ...curr);
  }
  return prev[n];
}
// Azərbaycan hərfləri üçün düzgün kiçiltmə: I→ı, İ→i (JS standartı səhv verir)
function lowerAz(s) {
  return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}
// Uyğunluq açarı: ç/c, ş/s, ə/e, ı/i, ğ/g, ö/o, ü/u eyni sayılır
const AZ_TO_LAT = { 'ç':'c', 'ş':'s', 'ə':'e', 'ı':'i', 'ğ':'g', 'ö':'o', 'ü':'u' };
function keyAz(s) {
  return lowerAz(s).replace(/[çşəığöü]/g, ch => AZ_TO_LAT[ch]).replace(/\s+/g, ' ').trim();
}
// Cavab qəbulu: forma fərqləri (ürəkli/ürək, maşını/maşın) eyni sayılır
// Çoxsözlü sözdə onun hissələri də qəbul olunur (itfaiyə → itfaiyə maşını)
function stemTok(t) {
  for (const suf of ['nin', 'nun', 'li', 'lu', 'in', 'un', 'i', 'u']) {
    if (t.length - suf.length >= 3 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}
const ANS_STOP = ['iki', 'bir', 'bu', 'və', 'ilə', 'çox', 'ən', 'da', 'də'];
// İki söz forması eyni sayılır: eyni kök, ya da biri digərinin qısa forması (masin ~ masini)
function tokEq(a, b) {
  if (a === b) return true;
  if (stemTok(a) === stemTok(b)) return true;
  const m = Math.min(a.length, b.length);
  return m >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a));
}
function answerMatches(guess, word) {
  const g = keyAz(guess), w = keyAz(word);
  if (!g || !w) return false;
  if (g === w) return true;
  const gt = g.split(' ').filter(Boolean);
  const wt = w.split(' ').filter(Boolean);
  if (!gt.length || !wt.length) return false;
  if (gt.length === wt.length && gt.every((t, i) => tokEq(t, wt[i]))) return true;
  if (wt.length > 1) {
    return gt.every(t => t.length >= 3 && !ANS_STOP.includes(t) && wt.some(x => tokEq(t, x)));
  }
  return false;
}
function isClose(guess, word) {
  const g = keyAz(guess), w = keyAz(word);
  if (w.length <= 3) return false;
  if (g === w) return false;  // tam uyğunluq ayrıca yoxlanır
  return editDist(g, w) <= 2;
}

const rooms = {};

function safeTimer(r) {
  if (!r) return;
  if (r._tick)      { clearInterval(r._tick);   r._tick      = null; }
  if (r._choice)    { clearTimeout(r._choice);  r._choice    = null; }
  if (r._end)       { clearTimeout(r._end);     r._end       = null; }
  if (r._autoStart) { clearInterval(r._autoStart); r._autoStart = null; }
}

function startTurn(code) {
  const r = rooms[code];
  if (!r || r.players.length < 2) return;
  safeTimer(r);
  r._ending = false;
  r.word = null; r.guessed = []; r.timeLeft = r.drawTime;
  const drawer = r.players[r.drawerIdx];
  r.choices = pick5(r);
  io.to(drawer.id).emit('chooseWord', { words: r.choices });
  io.to(code).emit('waitingWord', { drawerName: drawer.name, drawerId: drawer.id });
  r._choice = setTimeout(function() {
    r._choice = null;
    if (!r.word && r.choices && r.choices.length) {
      beginTurn(code, r.choices[(Math.random() * r.choices.length) | 0]);
    }
  }, 15000);
}

function beginTurn(code, word) {
  const r = rooms[code];
  if (!r) return;
  safeTimer(r);
  r.word = word; r.timeLeft = r.drawTime;
  r.turnNo = (r.turnNo || 0) + 1;
  // Track recent words to avoid repeats
  if (!r.recentWords) r.recentWords = [];
  r.recentWords.push(word);
  if (r.recentWords.length > 20) r.recentWords.shift();

  const drawer = r.players[r.drawerIdx];
  io.to(drawer.id).emit('yourWord', { word });
  io.to(code).emit('turnStart', {
    drawerName: drawer.name, drawerId: drawer.id,
    round: r.round, maxRounds: r.maxRounds, timeLeft: r.timeLeft,
  });
  r._tick = setInterval(function() {
    if (!rooms[code]) { clearInterval(r._tick); r._tick = null; return; }
    r.timeLeft--;
    io.to(code).emit('tick', { t: r.timeLeft });
    if (r.timeLeft <= 0) { safeTimer(r); endTurn(code); }
  }, 1000);
}

function endTurn(code) {
  const r = rooms[code];
  if (!r) return;
  if (r._ending) return;
  r._ending = true;
  safeTimer(r);
  const drawer = r.players[r.drawerIdx];
  // Word history log for this room
  if (r.word) {
    if (!r.wordLog) r.wordLog = [];
    r.wordLog.push({
      word:       r.word,
      drawerName: drawer ? drawer.name : '?',
      guessed:    r.guessed.length,
      total:      r.players.filter(p => !drawer || p.id !== drawer.id).length,
      at:         Date.now(),
    });
    if (r.wordLog.length > 20) r.wordLog.shift();
  }
  r.players.forEach(function(p) {
    if (!p.stats) p.stats = { guessed: 0, drew: 0, totalPts: 0 };
    const drawer = r.players[r.drawerIdx];
    if (drawer && drawer.id === p.id) p.stats.drew++;
    const g = r.guessed.find(x => x.id === p.id);
    if (g) { p.stats.guessed++; p.stats.totalPts += g.pts; }
  });
  io.to(code).emit('turnEnd', {
    word: r.word || '?', turnNo: r.turnNo,
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

// Oyunçunu otaqdan çıxarır və drawerIdx-i düzgün saxlayır.
// Çəkən hələ də eyni oyunçudursa indeks onun yeni yerinə keçir;
// çəkən çıxıbsa indeks növbəti oyunçuya işarə edir (rotasiya itmir).
function removePlayerFromRoom(r, targetId) {
  const idx = r.players.findIndex(p => p.id === targetId);
  if (idx < 0) return null;
  const drawerBefore = r.players[r.drawerIdx];
  const removed = r.players.splice(idx, 1)[0];
  if (r.players.length > 0) {
    if (drawerBefore && drawerBefore.id !== targetId) {
      r.drawerIdx = r.players.findIndex(p => p.id === drawerBefore.id);
    } else {
      r.drawerIdx = idx % r.players.length;
    }
  } else {
    r.drawerIdx = 0;
  }
  return removed;
}

// Ortaq çıxarma axını: leave / kick / admin kick üçün eynidir
// opts.pauseFor: true olduqda çıxan oyunçu pauza zamanı geri qayıda bilər
function removeFromRoom(code, targetId, opts) {
  const r = rooms[code];
  if (!r) return null;
  const wasDrawer = r.started && r.players[r.drawerIdx] && r.players[r.drawerIdx].id === targetId;
  const removed = removePlayerFromRoom(r, targetId);
  if (!removed) return null;
  if (r.voteOf) delete r.voteOf[targetId];
  if (r.players.length === 0) { safeTimer(r); delete rooms[code]; return removed; }
  if (!r.players.find(p => p.isHost)) r.players[0].isHost = true;
  io.to(code).emit('playerUpdate', { players: r.players, msg: removed.name + ' ' + (opts && opts.msg || 'ayrıldı.') });
  if (!r.started) return removed;
  if (r.players.length < 2) {
    safeTimer(r); r.started = false; r.paused = true;
    r.awaitingPlayer = (opts && opts.pauseFor) ? { name: removed.name } : null;
    io.to(code).emit('gamePaused', { awaitingName: r.awaitingPlayer ? r.awaitingPlayer.name : null });
  } else if (wasDrawer) {
    safeTimer(r);
    io.to(code).emit('clearCanvas');
    setTimeout(() => { if (rooms[code] && rooms[code].started) startTurn(code); }, 1500);
  }
  return removed;
}

function doLeave(socket, code) {
  removeFromRoom(code, socket.id, { pauseFor: true });
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // undoSync PNG payload üçün (əvvəl 200KB idi)
});

// Server-wide stats (RAM only — resets on restart)
const serverStats = {
  startTime:  Date.now(),
  totalConns: 0,
  totalRooms: 0,
  peakOnline: 0,
};

// Connected sockets: id → { device, connectedAt, code }  ← IP saxlanmır
const connMeta = new Map();

// Activity log: son 500 event RAM-da saxlanır
const actLog = [];
function addLog(emoji, msg) {
  const ts = new Date().toLocaleString('az-AZ', { dateStyle:'short', timeStyle:'medium', timeZone:'Asia/Baku' });
  actLog.push({ ts, emoji, msg });
  if (actLog.length > 500) actLog.shift();
}

// ── Admin ─────────────────────────────────────────────────────────────────────
// ADMIN_KEY mühit dəyişənidir. Default YOXDUR: təyin edilməyibsə (min 8 simvol) admin söndürülür.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ADMIN_ENABLED = ADMIN_KEY.length >= 8;
// Hər restart-da yeni sessiya tokeni yaranır (RAM-da, saxlanmır) — köhnə cookie-lər etibarsız olur
const ADMIN_SESSION = crypto.randomBytes(32).toString('hex');
if (!ADMIN_ENABLED) console.log('⚠️ ADMIN_KEY təyin edilməyib (min 8 simvol) — admin paneli deaktivdir.');

function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
// HTML-ə yazılan hər istifadəçi mətni bu funksiyadan keçməlidir (XSS qarşısı)
function escH(v) {
  return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function isAdmin(req) {
  const m = /(?:^|;\s*)ct_admin=([^;]+)/.exec(req.headers.cookie || '');
  return ADMIN_ENABLED && !!m && safeEq(m[1], ADMIN_SESSION);
}
function adminGuard(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(503).type('text').send('Admin deaktivdir: ADMIN_KEY təyin edilməyib.');
  if (!isAdmin(req)) return res.redirect('/admin');
  next();
}
function loginPage(errMsg) {
  return '<!DOCTYPE html><html lang="az"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>CizTap Admin</title><style>' + ADMIN_CSS + '</style></head><body><h1>🔐 Admin girişi</h1>'
    + (errMsg ? '<div class="warn-box">' + escH(errMsg) + '</div>' : '')
    + '<form method="POST" action="/admin/login" style="display:flex;gap:8px;max-width:360px">'
    + '<input type="password" name="key" required autocomplete="current-password" '
    + 'style="flex:1;padding:8px;border-radius:6px;border:1px solid #30363d;background:#161b22;color:#e6edf3">'
    + '<button class="act-btn close-btn" style="padding:8px 14px">Daxil ol</button></form></body></html>';
}
function logoutForm() {
  return '<form method="POST" action="/admin/logout" style="display:inline;margin-left:auto">'
    + '<button class="act-btn close-btn" style="padding:3px 9px">Çıxış</button></form>';
}

function parseUA(ua) {
  if (!ua) return 'Naməlum';
  let os = 'Naməlum OS';
  if      (/Windows NT 10/i.test(ua))           os = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(ua))         os = 'Windows 8.1';
  else if (/Windows NT 6\.1/i.test(ua))         os = 'Windows 7';
  else if (/Android/i.test(ua))                 os = 'Android';
  else if (/iPhone OS ([\d_]+)/i.test(ua))      os = 'iOS '    + ua.match(/iPhone OS ([\d_]+)/i)[1].replace(/_/g,'.');
  else if (/iPad.*OS ([\d_]+)/i.test(ua))       os = 'iPadOS ' + ua.match(/iPad.*OS ([\d_]+)/i)[1].replace(/_/g,'.');
  else if (/Mac OS X/i.test(ua))                os = 'macOS';
  else if (/Linux/i.test(ua))                   os = 'Linux';
  const mob = /Mobile|Android|iPhone|iPod/i.test(ua);
  const tab = /iPad|Tablet/i.test(ua);
  const dev = tab ? '📱 Tablet' : mob ? '📱 Mobil' : '🖥️ PC';
  return dev + ' · ' + os;
}
function fmtUptime(ms) {
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
  if (d>0) return d+'g '+(h%24)+'s';
  if (h>0) return h+'s '+(m%60)+'d';
  return m+'d '+(s%60)+'s';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('az-AZ',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Baku'});
}
const ADMIN_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px;font-size:14px}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:1.3rem;margin-bottom:6px;color:#58a6ff}
h1 span{font-size:.8rem;color:#8b949e;font-weight:400;margin-left:10px}
nav{display:flex;gap:10px;margin-bottom:16px;font-size:.83rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:20px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px;text-align:center}
.stat .val{font-size:1.6rem;font-weight:800;color:#f5c842}
.stat .lbl{font-size:.72rem;color:#8b949e;margin-top:3px}
.stat.green .val{color:#3fb950}.stat.blue .val{color:#58a6ff}.stat.red .val{color:#f85149}
.room-card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;margin-bottom:12px}
.room-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.room-code{font-family:monospace;font-size:1rem;font-weight:800;color:#f5c842;letter-spacing:3px}
.badge{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:20px}
.badge.live{background:rgba(63,185,80,.15);color:#3fb950;border:1px solid #3fb950}
.badge.wait{background:rgba(88,166,255,.12);color:#58a6ff;border:1px solid #58a6ff}
.badge.pause{background:rgba(248,81,73,.12);color:#f85149;border:1px solid #f85149}
.room-info{font-size:.74rem;color:#8b949e}
.cur-word{font-size:.8rem;background:#1c2333;border-radius:6px;padding:5px 10px;margin-bottom:8px;color:#79c0ff}
.word-log{margin-bottom:8px}
.word-log-title{font-size:.72rem;color:#8b949e;margin-bottom:4px}
.word-log-row{display:flex;gap:6px;align-items:center;font-size:.76rem;padding:2px 0;border-bottom:1px solid #21262d30}
.wl-word{font-weight:700;color:#e6edf3;min-width:80px}
.wl-drawer{color:#8b949e}
.wl-result{color:#3fb950;margin-left:auto}
.wl-time{color:#484f58;font-size:.7rem}
.ptable{width:100%;border-collapse:collapse;font-size:.78rem}
.ptable th{text-align:left;color:#8b949e;font-weight:600;padding:4px 6px;border-bottom:1px solid #21262d}
.ptable td{padding:5px 6px;border-bottom:1px solid #21262d20;vertical-align:middle}
.ptable .score{font-weight:700;color:#f5c842}
.ptable .meta{color:#8b949e;font-size:.72rem}
.drawing-row td:first-child{color:#58a6ff;font-weight:700}
.act-btn{font-size:.72rem;font-weight:700;padding:3px 8px;border-radius:6px;border:none;cursor:pointer;transition:all .15s}
.kick-btn{background:rgba(248,81,73,.15);color:#f85149;border:1px solid rgba(248,81,73,.3)}
.kick-btn:hover{background:#f85149;color:#fff}
.close-btn{background:rgba(248,81,73,.1);color:#f85149;border:1px solid rgba(248,81,73,.25);font-size:.75rem;padding:3px 9px}
.close-btn:hover{background:#f85149;color:#fff}
.section-title{font-size:.85rem;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:1px;margin:20px 0 10px}
.free-table{width:100%;border-collapse:collapse;font-size:.78rem;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
.free-table th{text-align:left;color:#8b949e;padding:6px 10px;border-bottom:1px solid #30363d}
.free-table td{padding:5px 10px;border-bottom:1px solid #21262d20}
.mono{font-family:monospace;font-size:.75rem}
.empty{color:#8b949e;font-style:italic;padding:10px}
.refresh{font-size:.72rem;color:#8b949e;margin-bottom:14px}
footer{margin-top:24px;font-size:.7rem;color:#484f58;text-align:center}
.log-row{display:flex;gap:8px;font-size:.79rem;padding:4px 0;border-bottom:1px solid #21262d20}
.log-ts{color:#484f58;white-space:nowrap;font-size:.72rem;min-width:130px}
.log-msg{color:#e6edf3}
.warn-box{background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);border-radius:8px;padding:10px 14px;font-size:.8rem;color:#f5c842;margin-bottom:14px}
`;


app.post('/admin/login', function(req, res) {
  if (!ADMIN_ENABLED) return res.status(503).type('text').send('Admin deaktivdir.');
  const key = String((req.body && req.body.key) || '');
  if (!safeEq(key, ADMIN_KEY)) {
    // Yanlış açarda 1 saniyə gözlətmək — brute-force-u yavaşladır
    return setTimeout(function() { res.status(403).type('html').send(loginPage('Açar yanlışdır.')); }, 1000);
  }
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'ct_admin=' + ADMIN_SESSION + '; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400' + secure);
  res.redirect('/admin');
});

app.post('/admin/logout', function(req, res) {
  res.setHeader('Set-Cookie', 'ct_admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  res.redirect('/admin');
});

// ── Admin: main dashboard ─────────────────────────────────────────────────────
app.get('/admin', function(req, res) {
  if (!ADMIN_ENABLED) return res.status(503).type('text').send('Admin deaktivdir: ADMIN_KEY təyin edilməyib.');
  if (!isAdmin(req)) return res.type('html').send(loginPage(''));
  const now      = Date.now();
  const uptime   = fmtUptime(now - serverStats.startTime);
  const memMB    = Math.round(process.memoryUsage().rss/1024/1024);
  const online   = connMeta.size;
  const roomList = Object.values(rooms);
  const inGame   = roomList.filter(r=>r.started).length;
  const waiting  = roomList.filter(r=>!r.started).length;
  if (online > serverStats.peakOnline) serverStats.peakOnline = online;

  const roomsHtml = roomList.length === 0
    ? '<div class="empty">Aktiv otaq yoxdur.</div>'
    : roomList.map(function(r) {
        const drawer = r.started ? r.players[r.drawerIdx] : null;
        const statusBadge = r.started
          ? (r.paused ? '<span class="badge pause">⏸ Dayandı</span>' : '<span class="badge live">▶ Oyunda</span>')
          : '<span class="badge wait">⏳ Gözləyir</span>';

        let wlogHtml = '';
        if (r.wordLog && r.wordLog.length) {
          const rows = r.wordLog.slice().reverse().slice(0,5).map(w =>
            '<div class="word-log-row">'
            + '<span class="wl-word">' + escH(w.word) + '</span>'
            + '<span class="wl-drawer">✏️ ' + escH(w.drawerName) + '</span>'
            + '<span class="wl-result">' + w.guessed + '/' + w.total + ' tapdı</span>'
            + '<span class="wl-time">' + fmtTime(w.at) + '</span></div>'
          ).join('');
          wlogHtml = '<div class="word-log"><div class="word-log-title">📋 Son sözlər</div>' + rows + '</div>';
        }

        const playersHtml = r.players.map(function(p) {
          const meta = connMeta.get(p.id) || {};
          const isDrawer = drawer && drawer.id === p.id;
          const kick = p.isHost ? '' :
            '<form method="POST" action="/admin/kick" style="display:inline" onsubmit="return confirm(\'Oyunçu çıxarılsın?\')">'
            + '<input type="hidden" name="id" value="' + escH(p.id) + '">'
            + '<input type="hidden" name="code" value="' + escH(r.code) + '">'
            + '<button class="act-btn kick-btn">✕ Çıxar</button></form>';
          return '<tr class="' + (isDrawer ? 'drawing-row' : '') + '">'
            + '<td>' + (isDrawer ? '✏️ ' : '') + escH(p.name) + (p.isHost ? ' 👑' : '') + '</td>'
            + '<td class="meta" style="font-weight:700;color:#f5c842">' + (p.level||0) + '</td>'
            + '<td class="score">' + p.score + ' xal</td>'
            + '<td class="meta">' + escH(meta.device || '?') + '</td>'
            + '<td class="meta">' + (meta.connectedAt ? fmtTime(meta.connectedAt) : '?') + '</td>'
            + '<td>' + kick + '</td></tr>';
        }).join('');

        const closeForm = '<form method="POST" action="/admin/closeroom" style="margin-left:auto" onsubmit="return confirm(\'Otaq bağlansın?\')">'
          + '<input type="hidden" name="code" value="' + escH(r.code) + '">'
          + '<button class="act-btn close-btn">🚪 Bağla</button></form>';
        const curWord = (r.started && r.word)
          ? '<div class="cur-word">Söz: <b>' + escH(r.word) + '</b> · Qalan vaxt: <b>' + r.timeLeft + 's</b> · Tapanlar: <b>' + r.guessed.length + '</b></div>'
          : '';
        return '<div class="room-card"><div class="room-hd">'
          + '<span class="room-code">#' + escH(r.code) + '</span>' + statusBadge
          + '<span class="room-info">R ' + r.round + '/' + r.maxRounds + ' · ' + r.drawTime + 's · ' + escH(r.category) + '</span>'
          + '<span class="room-info">' + r.players.length + ' oyunçu</span>' + closeForm + '</div>'
          + curWord + wlogHtml
          + '<table class="ptable"><thead><tr><th>Ad</th><th>Lv</th><th>Xal</th><th>Cihaz</th><th>Qoşulma</th><th></th></tr></thead>'
          + '<tbody>' + playersHtml + '</tbody></table></div>';
      }).join('');

  let freeConns = '';
  connMeta.forEach(function(m, id) {
    if (!m.code) freeConns += '<tr><td class="mono">' + escH(id.substring(0,8)) + '…</td>'
      + '<td class="meta">' + escH(m.device || '?') + '</td><td class="meta">' + fmtTime(m.connectedAt) + '</td></tr>';
  });

  const html = '<!DOCTYPE html><html lang="az"><head>'
    + '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>CizTap Admin</title><meta http-equiv="refresh" content="6">'
    + '<style>' + ADMIN_CSS + '</style></head><body>'
    + '<h1>🎨 CizTap Admin <span>hər 6s yenilənir</span></h1>'
    + '<nav style="display:flex;gap:10px;align-items:center"><a href="/admin">📊 Dashboard</a>'
    + '<a href="/admin/logs">📋 Fəaliyyət logu</a>' + logoutForm() + '</nav>'
    + '<div class="refresh">Son yeniləmə: ' + new Date().toLocaleTimeString('az-AZ') + ' · Uptime: ' + uptime + '</div>'
    + '<div class="warn-box">⚠️ Bu server pulsuz planda işləyir — restart olduqda bütün məlumatlar sıfırlanır.</div>'
    + '<div class="grid">'
    + '<div class="stat green"><div class="val">' + online + '</div><div class="lbl">Online</div></div>'
    + '<div class="stat blue"><div class="val">' + roomList.length + '</div><div class="lbl">Aktiv otaq</div></div>'
    + '<div class="stat"><div class="val">' + inGame + '</div><div class="lbl">Oyunda</div></div>'
    + '<div class="stat"><div class="val">' + waiting + '</div><div class="lbl">Gözləyir</div></div>'
    + '<div class="stat"><div class="val">' + serverStats.totalConns + '</div><div class="lbl">Cəmi qoşulma</div></div>'
    + '<div class="stat"><div class="val">' + serverStats.peakOnline + '</div><div class="lbl">Peak online</div></div>'
    + '<div class="stat"><div class="val">' + serverStats.totalRooms + '</div><div class="lbl">Cəmi otaq</div></div>'
    + '<div class="stat red"><div class="val">' + memMB + ' MB</div><div class="lbl">RAM</div></div>'
    + '</div>'
    + '<div class="section-title">🏠 Aktiv otaqlar</div>' + roomsHtml
    + (freeConns ? '<div class="section-title">🔌 Otaqsız qoşulmalar</div>'
      + '<table class="free-table"><thead><tr><th>Socket ID</th><th>Cihaz</th><th>Qoşulma vaxtı</th></tr></thead>'
      + '<tbody>' + freeConns + '</tbody></table>' : '')
    + '<footer>CizTap Admin Panel</footer></body></html>';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

// ── Admin: oyunçu çıxar (POST) ────────────────────────────────────────────────
app.post('/admin/kick', adminGuard, function(req, res) {
  const targetId = String((req.body && req.body.id) || '');
  const code     = String((req.body && req.body.code) || '');
  const r = rooms[code];
  const target = r && r.players.find(p => p.id === targetId);
  if (target && !target.isHost) {
    const ts = io.sockets.sockets.get(targetId);
    if (ts) { ts.emit('kicked'); ts.leave(code); ts.data.code = null; }
    removeFromRoom(code, targetId, { msg: 'admin tərəfindən çıxarıldı.' });
    addLog('🦵', 'Admin ' + target.name + '-i #' + code + ' otağından çıxardı');
  }
  res.redirect('/admin');
});

// ── Admin: otağı bağla (POST) ─────────────────────────────────────────────────
app.post('/admin/closeroom', adminGuard, function(req, res) {
  const code = String((req.body && req.body.code) || '');
  const r = rooms[code];
  if (r) {
    safeTimer(r);
    io.to(code).emit('err', 'Otaq admin tərəfindən bağlandı.');
    io.to(code).emit('leftRoom');
    addLog('🚪', 'Admin #' + code + ' otağını bağladı (' + r.players.map(p => p.name).join(', ') + ')');
    delete rooms[code];
  }
  res.redirect('/admin');
});

// ── Admin: fəaliyyət logu ─────────────────────────────────────────────────────
app.get('/admin/logs', adminGuard, function(req, res) {
  const rows = actLog.slice().reverse().map(e =>
    '<div class="log-row"><span class="log-ts">' + escH(e.ts) + '</span><span>' + escH(e.emoji)
    + '</span><span class="log-msg">' + escH(e.msg) + '</span></div>'
  ).join('') || '<div class="empty">Log yoxdur.</div>';
  const html = '<!DOCTYPE html><html lang="az"><head>'
    + '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>CizTap Logs</title><meta http-equiv="refresh" content="10">'
    + '<style>' + ADMIN_CSS + '</style></head><body>'
    + '<h1>📋 Fəaliyyət Logu</h1>'
    + '<nav style="display:flex;gap:10px;align-items:center"><a href="/admin">📊 Dashboard</a> <a href="/admin/logs">📋 Log</a>' + logoutForm() + '</nav>'
    + '<div class="refresh">Son ' + actLog.length + ' hadisə · hər 10s yenilənir · restart olduqda sıfırlanır</div>'
    + rows + '<footer>CizTap Admin · Log</footer></body></html>';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

io.on('connection', function(socket) {
  serverStats.totalConns++;
  const ua = socket.handshake.headers['user-agent'] || '';
  // IP saxlanmır — yalnız cihaz məlumatı
  connMeta.set(socket.id, {
    device:      parseUA(ua),
    connectedAt: Date.now(),
    code:        null,
  });
  addLog('🟢', `Yeni qoşulma · ${parseUA(ua)}`);

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
      ? d.customWords.map(w => lowerAz(String(w).trim()).substring(0, 40)).filter(w => w.length > 1).slice(0, 50)
      : [];
    const level = Math.min(Math.max(parseInt(d && d.level) || 0, 0), 100);
    const code = newRoomCode();
    if (!code) return socket.emit('err', 'Otaq yaradıla bilmədi, bir az sonra yenidən cəhd edin.');
    rooms[code] = {
      code, round: 1, maxRounds: rounds, drawTime, category, difficulty, customWords,
      drawerIdx: 0, started: false, paused: false,
      word: null, choices: [], guessed: [], recentWords: [],
      _tick: null, _choice: null, _end: null, _autoStart: null,
      timeLeft: 0, _ending: false, awaitingPlayer: null,
      turnNo: 0, voteOf: {},
      players: [{ id: socket.id, name, avatar, level, score: 0, isHost: true, stats: { guessed: 0, drew: 0, totalPts: 0 } }],
    };
    socket.join(code); socket.data.code = code;
    const m = connMeta.get(socket.id); if (m) m.code = code;
    serverStats.totalRooms++;
    addLog('🏠', `Qoşuldu: ${name} (Lv.${level}) #${code} otağını yaratdı`);
    socket.emit('roomReady', { code, isHost: true, players: rooms[code].players,
      settings: { rounds, drawTime, category, difficulty, customWords } });
  });

  socket.on('joinRoom', function(d) {
    if (!rateOk(socket.id, 5, 30000)) return socket.emit('err', 'Çox tez cəhd.');
    const name   = String((d && d.name) || '').trim().substring(0, 16);
    const code   = String((d && d.code) || '').trim();
    const avatar = Math.min(Math.max(parseInt(d && d.avatar) || 0, 0), 7);
    const level  = Math.min(Math.max(parseInt(d && d.level)  || 0, 0), 100);
    if (!name) return socket.emit('err', 'Ad daxil edin.');
    if (!/^\d{5}$/.test(code)) return socket.emit('err', '5 rəqəmli kodu daxil edin.');
    const r = rooms[code];
    if (!r) return socket.emit('err', 'Otaq tapılmadı.');
    // Name uniqueness
    if (r.players.some(p => lowerAz(p.name) === lowerAz(name))) {
      return socket.emit('err', 'Bu ad artıq istifadə olunur. Başqa ad seçin.');
    }
    // If game is paused waiting for a specific player, only that player can join
    if (r.paused && r.awaitingPlayer) {
      if (lowerAz(r.awaitingPlayer.name) !== lowerAz(name)) {
        return socket.emit('err', `Otaq ${r.awaitingPlayer.name} adlı oyunçunu gözləyir.`);
      }
    }
    if (r.started && !r.paused) return socket.emit('err', 'Oyun davam edir.');
    if (r.players.length >= 8) return socket.emit('err', 'Otaq doludur (maks 8).');
    const p = { id: socket.id, name, avatar, level, score: 0, isHost: false, stats: { guessed: 0, drew: 0, totalPts: 0 } };
    r.players.push(p);
    socket.join(code); socket.data.code = code;
    const mj = connMeta.get(socket.id); if (mj) mj.code = code;
    addLog('👋', `Qoşuldu: ${name} (Lv.${level}) → #${code}`);
    socket.emit('roomReady', { code, isHost: false, players: r.players,
      settings: { rounds: r.maxRounds, drawTime: r.drawTime, category: r.category, difficulty: r.difficulty, customWords: r.customWords } });
    socket.to(code).emit('playerUpdate', { players: r.players, msg: name + ' qoşuldu! 👋' });
    if (r.paused && r.players.length >= 2) {
      r.paused = false; r.started = true; r.awaitingPlayer = null;
      io.to(code).emit('gameResumed');
      setTimeout(() => { if (rooms[code]) startTurn(code); }, 1500);
    }
  });

  socket.on('startGame', function() {
    const r = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost || r.started) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    r.started = true; r.paused = false; r.round = 1; r.drawerIdx = 0; r.recentWords = [];
    r.turnNo = 0; r.voteOf = {};
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

  socket.on('undoSync', function(d) {
    if (!rateOk(socket.id, 10, 5000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started) return;
    if (r.players[r.drawerIdx] && r.players[r.drawerIdx].id !== socket.id) return;
    socket.to(r.code).emit('undoSync', { img: d && d.img });
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
    // Always lowercase
    const guess = lowerAz(String((d && d.text) || '').trim()).substring(0, 80);
    if (!guess) return;

    if (answerMatches(guess, r.word)) {
      // Correct — time-based scoring
      const pts        = calcPts(r.drawTime, r.timeLeft);
      const drawerPts  = Math.ceil(pts / 2);
      me.score += pts;
      if (drawer) drawer.score += drawerPts;
      r.guessed.push({ id: socket.id, pts });
      io.to(r.code).emit('correctGuess', {
        name: me.name, id: socket.id, pts, drawerPts, drawerId: drawer ? drawer.id : null,
        scores: r.players.map(p => ({ id: p.id, name: p.name, score: p.score, avatar: p.avatar })),
      });
      const nd = r.players.filter(p => !drawer || p.id !== drawer.id);
      if (r.guessed.length >= nd.length) { safeTimer(r); endTurn(r.code); }
    } else if (isClose(guess, r.word)) {
      // Yaxın cavab — YALNIZ göndərənə göstərilir, çata yayılmır
      socket.emit('closeAnswer', { text: guess });
    } else {
      io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: guess, close: false });
    }
  });

  socket.on('chat', function(d) {
    if (!rateOk(socket.id, 10, 10000)) return;
    const r  = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me) return;
    const drawer = r.players[r.drawerIdx];
    if (r.started && drawer && drawer.id === socket.id) return;
    io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar,
      text: lowerAz(String((d && d.text) || '').trim()).substring(0, 80), close: false });
  });

  socket.on('kick', function(d) {
    const r  = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    const target = r.players.find(p => p.id === (d && d.targetId));
    if (!target || target.isHost) return;
    const ts = io.sockets.sockets.get(target.id);
    if (ts) { ts.emit('kicked'); ts.leave(r.code); ts.data.code = null; }
    removeFromRoom(r.code, target.id, { msg: 'çıxarıldı.' });
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
    const r  = rooms[socket.data && socket.data.code];
    if (!r || r.started) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    // Reset scores, don't start yet — 30s auto-start countdown
    r.round = 1; r.drawerIdx = 0; r.started = false; r.paused = false;
    r.recentWords = []; r.awaitingPlayer = null;
    r.turnNo = 0; r.voteOf = {};
    r.players.forEach(p => { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    let countdown = 30;
    io.to(r.code).emit('playAgainLobby', {
      timeLeft: countdown, players: r.players,
      settings: { rounds: r.maxRounds, drawTime: r.drawTime, category: r.category, difficulty: r.difficulty },
    });
    r._autoStart = setInterval(function() {
      if (!rooms[r.code]) { clearInterval(r._autoStart); r._autoStart = null; return; }
      countdown--;
      io.to(r.code).emit('autoStartTick', { t: countdown });
      if (countdown <= 0) {
        clearInterval(r._autoStart); r._autoStart = null;
        if (r.players.length < 2) return;
        r.started = true;
        io.to(r.code).emit('gameStarted');
        setTimeout(() => startTurn(r.code), 800);
      }
    }, 1000);
  });

  socket.on('forceStart', function() {
    const r  = rooms[socket.data && socket.data.code];
    if (!r || r.started) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    if (r._autoStart) { clearInterval(r._autoStart); r._autoStart = null; }
    r.started = true;
    io.to(r.code).emit('gameStarted');
    setTimeout(() => startTurn(r.code), 800);
  });

  socket.on('stopAutoStart', function() {
    const r  = rooms[socket.data && socket.data.code];
    if (!r) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    if (r._autoStart) { clearInterval(r._autoStart); r._autoStart = null; }
    io.to(r.code).emit('autoStartStopped');
  });

  socket.on('continueGame', function() {
    const r  = rooms[socket.data && socket.data.code];
    if (!r || !r.paused) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    if (r.players.length < 2) return socket.emit('err', 'Ən az 2 oyunçu lazımdır.');
    r.awaitingPlayer = null; r.paused = false; r.started = true;
    io.to(r.code).emit('gameResumed');
    setTimeout(() => startTurn(r.code), 800);
  });

  socket.on('updateSettings', function(d) {
    const r = rooms[socket.data && socket.data.code];
    if (!r || r.started) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    if (d.rounds)    r.maxRounds  = Math.min(Math.max(parseInt(d.rounds)||3,1),10);
    if (d.drawTime)  r.drawTime   = Math.min(Math.max(parseInt(d.drawTime)||80,30),180);
    if (d.category && (WORDS[d.category] || d.category==='Hamısı')) r.category = d.category;
    if (['easy','medium','hard','all'].includes(d.difficulty)) r.difficulty = d.difficulty;
    io.to(r.code).emit('settingsUpdated', {
      rounds: r.maxRounds, drawTime: r.drawTime, category: r.category, difficulty: r.difficulty,
    });
  });

  socket.on('findFriend', function(d) {
    const name = lowerAz(String((d && d.name) || '').trim());
    if (!name) return socket.emit('friendResult', { found: false });
    for (const r of Object.values(rooms)) {
      if (r.started) continue; // don't reveal active games
      const p = r.players.find(p => lowerAz(p.name) === name);
      if (p) return socket.emit('friendResult', { found: true, code: r.code, name: p.name });
    }
    socket.emit('friendResult', { found: false, name });
  });

  // Qalereya səsi: hər oyunçunun bir səsi var, səs dəyişdirilə bilər, eyni səsə yenidən klik səsi geri alır
  socket.on('vote', function(d) {
    if (!rateOk(socket.id, 20, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || r.started || !r.voteOf || !r.turnNo) return;
    if (!r.players.find(p => p.id === socket.id)) return;
    const turnNo = Number(d && d.turnNo);
    if (!Number.isInteger(turnNo) || turnNo < 1 || turnNo > r.turnNo) return;
    if (r.voteOf[socket.id] === turnNo) delete r.voteOf[socket.id];
    else r.voteOf[socket.id] = turnNo;
    const counts = {};
    Object.values(r.voteOf).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    io.to(r.code).emit('votesUpdated', { counts });
    socket.emit('myVote', { turnNo: r.voteOf[socket.id] || null });
  });

  // Çəkən oyunçu çəkə bilmirsə turu keçir: rəqiblər +5 xal alır, çəkən 0 alır
  socket.on('passTurn', function() {
    if (!rateOk(socket.id, 5, 10000)) return;
    const r = rooms[socket.data && socket.data.code];
    if (!r || !r.started || !r.word || r._ending) return;
    const drawer = r.players[r.drawerIdx];
    if (!drawer || drawer.id !== socket.id) return;
    r.players.forEach(p => { if (p.id !== drawer.id) p.score += 5; });
    io.to(r.code).emit('turnPassed', { drawerName: drawer.name });
    endTurn(r.code);
  });

  socket.on('disconnect', function() {
    const meta = connMeta.get(socket.id);
    // Find player name from room
    const code = socket.data && socket.data.code;
    let pname = null;
    if (code && rooms[code]) {
      const pl = rooms[code].players.find(p => p.id === socket.id);
      if (pl) pname = pl.name;
    }
    if (meta) addLog('🔴', `Ayrıldı${pname ? ': '+pname : ''} · ${meta.device||'?'}`);
    connMeta.delete(socket.id);
    for (const key of sockRate.keys()) {
      if (key.startsWith(socket.id + ':')) sockRate.delete(key);
    }
    if (code) doLeave(socket, code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  const total = Object.values(WORDS).reduce((s, c) => s + c.easy.length + c.medium.length + c.hard.length, 0);
  console.log('CizTap port:' + PORT + ' | söz sayı:' + total);
});
