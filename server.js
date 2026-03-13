const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);

app.use(function(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  next();
});

const httpRate = new Map();
app.use(function(req, res, next) {
  const ip  = req.socket.remoteAddress || 'x';
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
      'it','pişik','at','inək','toyuq','balıq','quş','aslan','fil','ayı',
      'donuz','keçi','ördək','siçan','dovşan','qaz','xoruz','qoyun','arı',
      'kəpənək','ilan','qurbağa','tülkü','sincap','kirpi','canavar','dəvə',
      'maymun','pələng','zebra','dana','leylək','göyərçin','tısbağa','qartal',
    ],
    medium: [
      'zürafə','delfin','kənguru','pinqvin','timsah','maral','xərçəng',
      'meduza','köpək balığı','buzov','çöl donuzu','porsuq','su samuru',
      'tərlan','qu quşu','qaranquş','serçə','ağacdələn','bayquş','palıd quşu',
    ],
    hard: [
      'flamingo','koala','dəvəquşu','şimpanze','kərgədan','hipopotam','pelikan',
    ],
  },

  'Meyvə və tərəvəz': {
    easy: [
      'alma','armud','üzüm','qarpız','portağal','limon','pomidor','xiyar',
      'kartof','soğan','banan','gilas','çiyələk','kələm','yerkökü',
      'bibər','sarımsaq','turp','badımcan','göy soğan',
    ],
    medium: [
      'heyva','əncir','nar','şaftalı','ananas','kivi','gavalı','qovun',
      'şabalıd','qaragilə','qırmızı kələm','ispanaq','qabaq','göy noxud',
      'lobya','mərci','qarğıdalı','portağal','manqo','papaya',
    ],
    hard: [
      'avokado','brokkoli','kərəviz','artişok','kambuça',
    ],
  },

  'Ev əşyaları': {
    easy: [
      'stul','masa','divan','çarpayı','şkaf','soyuducu','televizor','telefon',
      'qapı','pəncərə','çıraq','pilləkən','yastıq','yorğan','vanna',
      'tualet','mətbəx','balkon','həyət','çəpər',
    ],
    medium: [
      'çaydanıq','fincan','boşqab','qaşıq','bıçaq','çəngəl','vedrə','süpürgə',
      'güzgü','xalça','çəkic','mişar','vida','eynək','saat','açar',
      'lampochka','döşəmə','tavan','divar',
    ],
    hard: [
      'tozsoran','termos','blender','mum','fırça','rəf',
    ],
  },

  'Yemək və içki': {
    easy: [
      'çörək','pizza','burger','tort','dondurma','şokolad','plov','kabab',
      'yumurta','süd','pendir','çay','alma suyu','limonad','su','qəhvə',
      'bal','kərə yağı','toyuq','kotlet',
    ],
    medium: [
      'sandwich','omlet','makaron','keks','donut','hotdog','salat','şorba',
      'konfet','ayran','qatıq','souslu makaron','dolma','qutab','düşbərə',
      'piti','xəngəl','baklava','şəkərbura','pakhlava',
    ],
    hard: [
      'tiramisu','sufle','lasanya','fondu','waffle',
    ],
  },

  'Nəqliyyat': {
    easy: [
      'maşın','avtobus','qatar','təyyarə','gəmi','velosiped','taksi','metro',
      'motosiklet','helikopter','ambulans','traktor','yük maşını',
    ],
    medium: [
      'tramvay','yelkənli','kater','qanadlı','ekskavator','buldozer',
      'yanğın maşını','polismaşını','skuter','elektrikli skuter','qayıq',
    ],
    hard: [
      'hava balonu','gondola','paraşut',
    ],
  },

  'Geyim': {
    easy: [
      'köynək','şalvar','palto','papaq','corab','çəkmə','sandal','don',
      'jaket','çanta','kəmər','ətək','eynək','saatı',
    ],
    medium: [
      'əlcək','boyunbağı','üzük','şərfə','kostyum','qalstuk','kepka',
      'çadra','kürk','gödəkçə','pijama','mayo','şort',
    ],
    hard: [
      'plaş','kəlağayı','araqçın',
    ],
  },

  'Təbiət': {
    easy: [
      'dağ','dəniz','çay','göl','meşə','günəş','ay','ulduz','bulud',
      'yağış','qar','ağac','çiçək','od','külək','tufan','ildırım',
      'göy qurşağı','günbatan','şəlalə',
    ],
    medium: [
      'vulkan','ada','kaktus','palma','dalğa','göbələk','daş','torpaq',
      'qum','buz','ot','çöl','meşə yanğını','sahil','uçurum',
      'çəmən','bulaq','mağara','buzlaq',
    ],
    hard: [
      'bataqlıq','yarımada','delta','körfəz',
    ],
  },

  'İdman': {
    easy: [
      'futbol','basketbol','tennis','üzgüçülük','boks','qaçış','voleybol',
      'skeytbord','top','qol','məşq','stadion','velosiped sürməyi',
    ],
    medium: [
      'gimnastika','karate','qolf','badminton','hokey','güləş','baseball',
      'üzgüçülük hovuzu','ağırlıq qaldırma','atıcılıq','ox atma','dalğıclıq',
    ],
    hard: [
      'sörfinq','alpinizm','polo',
    ],
  },

  'Yer və bina': {
    easy: [
      'ev','məktəb','xəstəxana','mağaza','park','körpü','yol','küçə',
      'bazar','kafe','restoran','mehmanxana','bank','kitabxana',
    ],
    medium: [
      'muzey','teatr','kinoteatr','stadion','hovuz','fabrik','çiçəkçi',
      'bərbər','aptek','poçt','məscid','kilsə','qəbiristanlıq','qala',
    ],
    hard: [
      'qüllə','piramida','sərgi pavilyonu',
    ],
  },

  'Əşya və alət': {
    easy: [
      'kitab','qələm','makas','açar','lampa','kamera','kompüter','çətir',
      'top','saat','radio','mum','şüşə','qab','zəng',
    ],
    medium: [
      'mikrofon','gitara','nağara','teleskop','lövhə','çamadan','torba',
      'tabanca','bıçaq','mişar','çəkic','çilingər alətləri','şpris',
      'stethoscope','dürbün',
    ],
    hard: [
      'akkordeon','mikroskop','proyektor','periskop',
    ],
  },

  'Azərbaycan': {
    easy: [
      'nar','xalça','tar','bayraq','qala','saz','plov','dolma','çay',
      'papaq','buta','neft','alov','xəzər','bakı','şuşa',
    ],
    medium: [
      'kamança','kəlağayı','balaban','karvansara','qutab','şəkərbura',
      'baklava','novruz','süməlak','semeni','xonça','kosa','keçəl',
    ],
    hard: [
      'zurna','nağara','qaval','tütək',
    ],
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
function isClose(guess, word) {
  if (word.length <= 3) return false;
  const g = guess.toLowerCase().trim();
  const w = word.toLowerCase().trim();
  if (g === w) return false;  // exact match handled separately
  return editDist(g, w) <= 2;
}

const rooms = {};

function safeTimer(r) {
  if (!r) return;
  if (r._tick)   { clearInterval(r._tick);  r._tick   = null; }
  if (r._choice) { clearTimeout(r._choice); r._choice = null; }
  if (r._end)    { clearTimeout(r._end);    r._end    = null; }
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
  const wasDrawer = r.started && me && r.players[r.drawerIdx] && r.players[r.drawerIdx].id === me.id;
  r.players = r.players.filter(p => p.id !== socket.id);
  if (r.players.length === 0) { safeTimer(r); delete rooms[code]; return; }
  if (!r.players.find(p => p.isHost)) r.players[0].isHost = true;
  io.to(code).emit('playerUpdate', { players: r.players, msg: (me ? me.name : 'Oyunçu') + ' ayrıldı.' });
  if (!r.started) return;
  if (r.drawerIdx >= r.players.length) r.drawerIdx = r.players.length - 1;
  if (r.players.length < 2) {
    safeTimer(r); r.started = false; r.paused = true;
    io.to(code).emit('gamePaused');
  } else if (wasDrawer) {
    safeTimer(r);
    io.to(code).emit('clearCanvas');
    setTimeout(() => { if (rooms[code] && rooms[code].started) startTurn(code); }, 1500);
  }
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 2e5,
});

// Server-wide stats (RAM only, resets on restart)
const serverStats = {
  startTime:    Date.now(),
  totalConns:   0,
  totalRooms:   0,
  peakOnline:   0,
};
// Connected sockets metadata: id → { name, ip, ua, connectedAt, code }
const connMeta = new Map();

// ── Admin dashboard ───────────────────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || 'ciztap-admin-2025';

function parseUA(ua) {
  if (!ua) return 'Naməlum';
  // OS
  let os = 'Naməlum OS';
  if (/Windows NT 10/i.test(ua))      os = 'Windows 10/11';
  else if (/Windows NT 6/i.test(ua))  os = 'Windows 7/8';
  else if (/Android (\d+)/i.test(ua)) os = 'Android ' + ua.match(/Android (\d+)/i)[1];
  else if (/iPhone OS ([\d_]+)/i.test(ua)) os = 'iOS ' + ua.match(/iPhone OS ([\d_]+)/i)[1].replace(/_/g,'.');
  else if (/iPad.*OS ([\d_]+)/i.test(ua))  os = 'iPadOS ' + ua.match(/iPad.*OS ([\d_]+)/i)[1].replace(/_/g,'.');
  else if (/Mac OS X/i.test(ua))      os = 'macOS';
  else if (/Linux/i.test(ua))         os = 'Linux';
  // Browser
  let br = 'Naməlum brauzer';
  if (/SamsungBrowser\/([\d.]+)/i.test(ua))  br = 'Samsung ' + ua.match(/SamsungBrowser\/([\d.]+)/i)[1];
  else if (/OPR\/([\d.]+)/i.test(ua))        br = 'Opera ' + ua.match(/OPR\/([\d.]+)/i)[1];
  else if (/Edg\/([\d.]+)/i.test(ua))        br = 'Edge ' + ua.match(/Edg\/([\d.]+)/i)[1];
  else if (/Chrome\/([\d.]+)/i.test(ua))     br = 'Chrome ' + ua.match(/Chrome\/([\d.]+)/i)[1].split('.')[0];
  else if (/Firefox\/([\d.]+)/i.test(ua))    br = 'Firefox ' + ua.match(/Firefox\/([\d.]+)/i)[1].split('.')[0];
  else if (/Safari\/([\d.]+)/i.test(ua))     br = 'Safari';
  // Device type
  const mob = /Mobile|Android|iPhone|iPod/i.test(ua);
  const tab = /iPad|Tablet/i.test(ua);
  const dev = tab ? '📱 Tablet' : mob ? '📱 Mobil' : '🖥️ PC';
  return dev + ' · ' + os;
}

function fmtUptime(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
  if (d > 0) return d+'g '+( h%24)+'s';
  if (h > 0) return h+'s '+(m%60)+'d';
  return m+'d '+(s%60)+'s';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('az-AZ',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

app.get('/admin', function(req, res) {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send('<h2>403 — Giriş qadağandır</h2>');
  }

  const now       = Date.now();
  const uptime    = fmtUptime(now - serverStats.startTime);
  const mem       = process.memoryUsage();
  const memMB     = Math.round(mem.rss / 1024 / 1024);
  const online    = connMeta.size;
  const roomList  = Object.values(rooms);
  const inGame    = roomList.filter(r => r.started).length;
  const waiting   = roomList.filter(r => !r.started).length;
  if (online > serverStats.peakOnline) serverStats.peakOnline = online;

  // Build rooms HTML
  let roomsHtml = '';
  if (roomList.length === 0) {
    roomsHtml = '<div class="empty">Aktiv otaq yoxdur.</div>';
  } else {
    roomList.forEach(function(r) {
      const drawer = r.started ? r.players[r.drawerIdx] : null;
      const statusBadge = r.started
        ? (r.paused ? '<span class="badge pause">⏸ Dayandı</span>' : '<span class="badge live">▶ Oyunda</span>')
        : '<span class="badge wait">⏳ Gözləyir</span>';
      let playersHtml = r.players.map(function(p) {
        const meta = connMeta.get(p.id) || {};
        const isDrawer = drawer && drawer.id === p.id;
        return `<tr class="${isDrawer?'drawing-row':''}">
          <td>${isDrawer?'✏️':''} ${p.name}${p.isHost?' 👑':''}</td>
          <td class="score">${p.score} xal</td>
          <td class="meta">${meta.device||'?'}</td>
          <td class="meta">${meta.connectedAt?fmtTime(meta.connectedAt):'?'}</td>
        </tr>`;
      }).join('');
      roomsHtml += `
      <div class="room-card">
        <div class="room-hd">
          <span class="room-code">#${r.code}</span>
          ${statusBadge}
          <span class="room-info">R ${r.round}/${r.maxRounds} · ${r.drawTime}s · ${r.category} · ${r.difficulty}</span>
          <span class="room-info">${r.players.length} oyunçu</span>
        </div>
        ${r.started && r.word ? `<div class="cur-word">Söz: <b>${r.word}</b> · Qalan vaxt: <b>${r.timeLeft}s</b> · Tapanlar: <b>${r.guessed.length}</b></div>` : ''}
        <table class="ptable">
          <thead><tr><th>Ad</th><th>Xal</th><th>Cihaz</th><th>Qoşulma</th></tr></thead>
          <tbody>${playersHtml}</tbody>
        </table>
      </div>`;
    });
  }

  // Build connections HTML (all connected sockets, even those not in a room)
  let freeConns = '';
  connMeta.forEach(function(m, id) {
    if (!m.code) {
      freeConns += `<tr>
        <td class="mono">${id.substring(0,8)}…</td>
        <td>${m.device||'?'}</td>
        <td>${fmtTime(m.connectedAt)}</td>
      </tr>`;
    }
  });

  const html = `<!DOCTYPE html>
<html lang="az">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CizTap Admin</title>
<meta http-equiv="refresh" content="6">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px;font-size:14px}
h1{font-size:1.3rem;margin-bottom:16px;color:#58a6ff}
h1 span{font-size:.8rem;color:#8b949e;font-weight:400;margin-left:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px;text-align:center}
.stat .val{font-size:1.6rem;font-weight:800;color:#f5c842}
.stat .lbl{font-size:.72rem;color:#8b949e;margin-top:3px}
.stat.green .val{color:#3fb950}
.stat.blue  .val{color:#58a6ff}
.stat.red   .val{color:#f85149}
.room-card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;margin-bottom:12px}
.room-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.room-code{font-family:monospace;font-size:1rem;font-weight:800;color:#f5c842;letter-spacing:3px}
.badge{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:20px}
.badge.live{background:rgba(63,185,80,.15);color:#3fb950;border:1px solid #3fb950}
.badge.wait{background:rgba(88,166,255,.12);color:#58a6ff;border:1px solid #58a6ff}
.badge.pause{background:rgba(248,81,73,.12);color:#f85149;border:1px solid #f85149}
.room-info{font-size:.74rem;color:#8b949e}
.cur-word{font-size:.8rem;background:#1c2333;border-radius:6px;padding:5px 10px;margin-bottom:8px;color:#79c0ff}
.ptable{width:100%;border-collapse:collapse;font-size:.78rem}
.ptable th{text-align:left;color:#8b949e;font-weight:600;padding:4px 6px;border-bottom:1px solid #21262d}
.ptable td{padding:4px 6px;border-bottom:1px solid #21262d20}
.ptable .score{font-weight:700;color:#f5c842}
.ptable .meta{color:#8b949e;font-size:.72rem}
.drawing-row td:first-child{color:#58a6ff;font-weight:700}
.section-title{font-size:.85rem;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:1px;margin:20px 0 10px}
table.free-table{width:100%;border-collapse:collapse;font-size:.78rem;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
table.free-table th{text-align:left;color:#8b949e;padding:6px 10px;border-bottom:1px solid #30363d}
table.free-table td{padding:5px 10px;border-bottom:1px solid #21262d20}
.mono{font-family:monospace;font-size:.75rem}
.empty{color:#8b949e;font-style:italic;padding:10px}
.refresh{font-size:.72rem;color:#8b949e;margin-bottom:16px}
footer{margin-top:24px;font-size:.7rem;color:#484f58;text-align:center}
</style>
</head>
<body>
<h1>🎨 CizTap Admin <span>hər 6 saniyədə yenilənir</span></h1>
<div class="refresh">Son yeniləmə: ${new Date().toLocaleTimeString('az-AZ')} · Uptime: ${uptime}</div>

<div class="grid">
  <div class="stat green"><div class="val">${online}</div><div class="lbl">Online</div></div>
  <div class="stat blue"><div class="val">${roomList.length}</div><div class="lbl">Aktiv otaq</div></div>
  <div class="stat"><div class="val">${inGame}</div><div class="lbl">Oyunda</div></div>
  <div class="stat"><div class="val">${waiting}</div><div class="lbl">Gözləyir</div></div>
  <div class="stat"><div class="val">${serverStats.totalConns}</div><div class="lbl">Cəmi qoşulma</div></div>
  <div class="stat"><div class="val">${serverStats.peakOnline}</div><div class="lbl">Peak online</div></div>
  <div class="stat"><div class="val">${serverStats.totalRooms}</div><div class="lbl">Cəmi otaq</div></div>
  <div class="stat red"><div class="val">${memMB} MB</div><div class="lbl">RAM</div></div>
</div>

<div class="section-title">🏠 Aktiv otaqlar</div>
${roomsHtml}

${freeConns ? `<div class="section-title">🔌 Otaqsız qoşulmalar</div>
<table class="free-table">
  <thead><tr><th>Socket ID</th><th>Cihaz</th><th>Qoşulma vaxtı</th></tr></thead>
  <tbody>${freeConns}</tbody>
</table>` : ''}

<footer>CizTap Admin Panel · Yalnız sizin üçün</footer>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

io.on('connection', function(socket) {
  serverStats.totalConns++;
  const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  const ua = socket.handshake.headers['user-agent'] || '';
  connMeta.set(socket.id, {
    ip:          ip || 'Naməlum',
    device:      parseUA(ua),
    connectedAt: Date.now(),
    code:        null,
  });

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
      ? d.customWords.map(w => String(w).trim().toLowerCase().substring(0, 40)).filter(w => w.length > 1).slice(0, 50)
      : [];
    const code = genCode();
    rooms[code] = {
      code, round: 1, maxRounds: rounds, drawTime, category, difficulty, customWords,
      drawerIdx: 0, started: false, paused: false,
      word: null, choices: [], guessed: [], recentWords: [],
      _tick: null, _choice: null, _end: null, timeLeft: 0, _ending: false,
      players: [{ id: socket.id, name, avatar, score: 0, isHost: true, stats: { guessed: 0, drew: 0, totalPts: 0 } }],
    };
    socket.join(code); socket.data.code = code;
    const m = connMeta.get(socket.id); if (m) m.code = code;
    serverStats.totalRooms++;
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
    const mj = connMeta.get(socket.id); if (mj) mj.code = code;
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
    r.started = true; r.paused = false; r.round = 1; r.drawerIdx = 0; r.recentWords = [];
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
    const guess = String((d && d.text) || '').trim().toLowerCase().substring(0, 80);
    if (!guess) return;

    if (guess === r.word.toLowerCase()) {
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
      // Close — only visible to the guesser themselves
      socket.emit('closeAnswer', { text: guess });
      // Still show in chat for others but without close marking
      io.to(r.code).emit('chat', { name: me.name, avatar: me.avatar, text: guess, close: false });
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
      text: String((d && d.text) || '').trim().toLowerCase().substring(0, 80), close: false });
  });

  socket.on('kick', function(d) {
    const r  = rooms[socket.data && socket.data.code];
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
    const r  = rooms[socket.data && socket.data.code];
    if (!r || r.started) return;
    const me = r.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    r.round = 1; r.drawerIdx = 0; r.started = true; r.paused = false; r.recentWords = [];
    r.players.forEach(p => { p.score = 0; p.stats = { guessed: 0, drew: 0, totalPts: 0 }; });
    io.to(r.code).emit('gameStarted');
    setTimeout(() => startTurn(r.code), 800);
  });

  socket.on('disconnect', function() {
    connMeta.delete(socket.id);
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
  console.log('CizTap port:' + PORT + ' | söz sayı:' + total);
});
