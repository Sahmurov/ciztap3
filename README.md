# 🎨 CizTap — Azərbaycan Söz Oyunu

Gartic.io-dan ilham alaraq hazırlanmış, **tamamilə Azərbaycan dilindəki söz bankası** ilə çalışan multiplayer çizgi-tapma oyunu.

---

## Xüsusiyyətlər
- 300+ Azərbaycan sözü (heyvanlar, yeməklər, şəhərlər, idman, peşələr və s.)
- 2–8 oyunçu eyni otaqda
- Real-time çizgi sinxronizasiyası (Socket.io)
- Fırça, silgi, doldurma (flood fill) alətləri
- Söz seçimi sistemi (3 variantdan biri)
- Progressive hint sistemi (vaxt keçdikcə hərflər açılır)
- Otaq kodu ilə qoşulma
- Xal sistemi (vaxt bonusu + sıralama bonusu)

---

## Deploy: Render.com (Pulsuz)

### 1. GitHub-a yükləyin
```bash
cd ciztap
git init
git add .
git commit -m "ilk commit"
git branch -M main
git remote add origin https://github.com/SIZIN_ADANIZ/ciztap.git
git push -u origin main
```

### 2. Render.com-da qeydiyyat
1. https://render.com → "Sign Up" (GitHub ilə)
2. "New +" → "Web Service"
3. GitHub repo-nu seçin
4. Parametrlər:
   - **Name:** ciztap
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. "Create Web Service" düyməsinə basın

Render avtomatik deploy edəcək. URL belə görünəcək: `https://ciztap.onrender.com`

---

## Domain (ciztap.com) əlavə etmək

1. [Namecheap.com](https://namecheap.com) və ya [GoDaddy.com](https://godaddy.com)-dan `ciztap.com` satın alın (~$10-15/il)
2. Render Dashboard → Settings → Custom Domains → "Add Domain"
3. `ciztap.com` yazın
4. Render sizə bir CNAME dəyər verəcək
5. Domain qeydiyyatçınızın DNS panelindən bu CNAME-i əlavə edin
6. 24 saata qədər yayılacaq

---

## Yerli İşlətmə (test üçün)
```bash
npm install
npm start
# → http://localhost:3000
```

---

## Fayl Strukturu
```
ciztap/
├── server.js        ← Node.js + Socket.io backend
├── package.json
├── render.yaml      ← Render.com konfiqurasiyası
└── public/
    └── index.html   ← Bütün frontend (tək fayl)
```
