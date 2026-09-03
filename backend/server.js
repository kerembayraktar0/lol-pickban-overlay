/**
 * LoL Pick/Ban Overlay - Backend
 * ---------------------------------------------------------
 * 1) Başlatıldığında terminalden maçın iki takımını (isim + logo) sorar
 * 2) Kaçıncı maçta olduğumuzu sorar (BO3 varsayılan). 1'den büyükse:
 *    - Takımların o ana kadarki skorunu sorar
 *    - Önceki maç(lar)da seçilen (matchNumber-1)*10 şampiyonu girmek için
 *      tarayıcıda otomatik bir "Önceki Pickler" ekranı açar ve bekler
 * 3) League Client'in "lockfile" dosyasını bulur (Port + Token alır)
 * 4) LCU API'ye HTTPS ile bağlanır (self-signed sertifikayı yok sayar)
 * 5) /lol-champ-select/v1/session endpoint'ini saniyede 1 kez polling yapar
 * 6) Oyuncu isimlerini (summonerId -> displayName) client'tan çeker
 * 7) Veriyi temizleyip normalize eder, tüm bağlı frontend'lere WebSocket ile yayınlar
 * 8) Şampiyon görsellerini (ikon + splash-art) CORS sorunu yaşamadan proxy'ler
 * ---------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const https = require("https");
const { exec } = require("child_process");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { WebSocketServer } = require("ws");

// ------------------------- AYARLAR -------------------------
const HTTP_PORT = process.env.HTTP_PORT || 5000;
const WS_PORT = process.env.WS_PORT || 5001;
const POLL_INTERVAL_MS = 1000;

const CANDIDATE_PATHS = [
  process.env.LOL_PATH,
  "C:\\Riot Games\\League of Legends",
  "/Applications/League of Legends.app/Contents/LoL",
].filter(Boolean);

const CONFIG_PATH = path.join(__dirname, "config.json");
const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

// ------------------------- CONFIG.JSON -------------------------
const DEFAULT_CONFIG = {
  language: "tr", // "tr" | "en"
  blueTeam: { name: "BLUE TEAM", logo: "", score: 0 },
  redTeam: { name: "RED TEAM", logo: "", score: 0 },
  matchLabel: "MAÇ 1 / BO3",
  matchNumber: 1,
  previousGames: [], // [{ game:1, blue:{TOP:"Darius",...}, red:{...} }, ...]
};

// Uygulama HER başlatıldığında sıfırdan başlar: önceki oturumdan kalan takım
// isimleri, skorlar, maç numarası ve özellikle önceki maç pickleri
// (previousGames) bir sonraki açılışa ASLA taşınmaz. config.json her
// başlangıçta varsayılan değerlerle yeniden yazılır.
// The app ALWAYS starts fresh: team names, scores, match number, and
// especially previous-game picks (previousGames) NEVER carry over to the
// next launch. config.json is rewritten with defaults on every start.
function loadConfig() {
  const fresh = { ...DEFAULT_CONFIG };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(fresh, null, 2));
  } catch (e) {
    console.error("config.json yazılamadı / could not write config.json:", e.message);
  }
  return fresh;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let currentConfig = loadConfig();

// ------------------------- TR/EN METİNLER -------------------------
const STRINGS = {
  tr: {
    header: "=== Pick/Ban Overlay — Maç Bilgileri ===",
    subheader: "(Boş bırakıp Enter'a basarsan köşeli parantezdeki mevcut değer kullanılır)",
    blueName: "Mavi Takım İsmi",
    blueLogo: "Mavi Takım Logo URL/yolu (opsiyonel)",
    redName: "Kırmızı Takım İsmi",
    redLogo: "Kırmızı Takım Logo URL/yolu (opsiyonel)",
    matchNumberQ: "Kaçıncı maçtayız? (Bo3 için 1/2/3)",
    scoreInfo: (n) => `\n1'den büyük bir maç numarası girdin (${n}). Skor bilgisi soruluyor...`,
    scoreQ: (team) => `${team} — şu ana kadarki galibiyet sayısı`,
    matchLabelQ: "Maç Etiketi",
    matchLabelDefault: (n) => `MAÇ ${n} / BO3`,
    summary: (b, r, m) => `\n✔ ${b}  VS  ${r}  (${m})\n`,
    prevPicksInfo: (count) => `Önceki maç(lar)da seçilen ${count} şampiyonu gireceğin sayfa açılıyor:`,
    prevPicksHint: "Sayfadaki formu doldurup 'Kaydet' butonuna basınca overlay otomatik devam edecek...\n",
    prevPicksDone: "✔ Önceki pick bilgileri kaydedildi, devam ediliyor...\n",
    browserFail: (url) => `\n(Tarayıcı otomatik açılamadı. Bu adresi elle aç:)\n${url}\n`,
    connectingLcu: "\nLeague istemcisine bağlanılıyor (açık değilse açman yeterli, otomatik bağlanacak)...",
    overlayUrl: (u) => `[HTTP] Overlay: ${u}`,
    controlUrl: (u) => `[HTTP] Kontrol paneli: ${u}`,
    wsUrl: (u) => `[WS]   Overlay veri kanalı: ${u}`,
    wsNewConnection: (n) => `[WS] Yeni bağlantı. Toplam istemci: ${n}`,
    lockfileNotFound: "[LCU] lockfile bulunamadı — League istemcisi açık değil. 3sn sonra tekrar denenecek...",
    lcuConnected: (url) => `[LCU] Bağlanıldı -> ${url}`,
    phaseChanged: (oldP, newP) => `[LCU] Faz değişti: ${oldP} -> ${newP}`,
    champSelectExited: "[LCU] Champ select ekranından çıkıldı.",
    lcuConnError: "[LCU] Bağlantı hatası, yeniden bağlanılıyor:",
    duplicateChampionRecord: (name, count, ids, chosen) =>
      `[LCU] "${name}" için ${count} kayıt bulundu (${ids}) — gerçek olan ${chosen} kullanılacak.`,
    championsLoaded: (count) => `[LCU] ${count} güncel şampiyon yüklendi (classic/eski kayıtlar hariç).`,
    championDataError: "[LCU] Şampiyon verisi alınamadı:",
    splashNotConnected: (id) => `[GÖRSEL] LCU'ya henüz bağlı değil, splash-art istendi: id=${id}`,
    iconNotConnected: (id) => `[GÖRSEL] LCU'ya henüz bağlı değil, ikon istendi: id=${id}`,
    splashNotFound: (id, paths) => `[GÖRSEL] Splash-art bulunamadı: champion id=${id} (denenen yollar: ${paths})`,
    iconNotFound: (id, paths) => `[GÖRSEL] İkon bulunamadı: champion id=${id} (denenen yollar: ${paths})`,
    teamBlue: "Mavi",
    teamRed: "Kırmızı",
    playerFallback: (team, idx) => `${team} Oyuncu ${idx}`,
  },
  en: {
    header: "=== Pick/Ban Overlay — Match Info ===",
    subheader: "(Press Enter to keep the value shown in brackets)",
    blueName: "Blue Team Name",
    blueLogo: "Blue Team Logo URL/path (optional)",
    redName: "Red Team Name",
    redLogo: "Red Team Logo URL/path (optional)",
    matchNumberQ: "Which game are we on? (1/2/3 for Bo3)",
    scoreInfo: (n) => `\nYou entered a game number greater than 1 (${n}). Asking for the current score...`,
    scoreQ: (team) => `${team} — wins so far`,
    matchLabelQ: "Match Label",
    matchLabelDefault: (n) => `GAME ${n} / BO3`,
    summary: (b, r, m) => `\n✔ ${b}  VS  ${r}  (${m})\n`,
    prevPicksInfo: (count) => `Opening the page to enter the ${count} champions picked in the previous game(s):`,
    prevPicksHint: "Fill in the form and click 'Save' — the overlay will continue automatically...\n",
    prevPicksDone: "✔ Previous pick data saved, continuing...\n",
    browserFail: (url) => `\n(Couldn't open the browser automatically. Open this address manually:)\n${url}\n`,
    connectingLcu: "\nConnecting to the League client (just open it if it isn't running — it will connect automatically)...",
    overlayUrl: (u) => `[HTTP] Overlay: ${u}`,
    controlUrl: (u) => `[HTTP] Control panel: ${u}`,
    wsUrl: (u) => `[WS]   Overlay data channel: ${u}`,
    wsNewConnection: (n) => `[WS] New connection. Total clients: ${n}`,
    lockfileNotFound: "[LCU] lockfile not found — the League client isn't open. Retrying in 3s...",
    lcuConnected: (url) => `[LCU] Connected -> ${url}`,
    phaseChanged: (oldP, newP) => `[LCU] Phase changed: ${oldP} -> ${newP}`,
    champSelectExited: "[LCU] Left the champ select screen.",
    lcuConnError: "[LCU] Connection error, reconnecting:",
    duplicateChampionRecord: (name, count, ids, chosen) =>
      `[LCU] Found ${count} records for "${name}" (${ids}) — using ${chosen} as the real one.`,
    championsLoaded: (count) => `[LCU] Loaded ${count} current champions (classic/legacy records excluded).`,
    championDataError: "[LCU] Couldn't fetch champion data:",
    splashNotConnected: (id) => `[IMAGE] Not connected to LCU yet, splash-art requested: id=${id}`,
    iconNotConnected: (id) => `[IMAGE] Not connected to LCU yet, icon requested: id=${id}`,
    splashNotFound: (id, paths) => `[IMAGE] Splash-art not found: champion id=${id} (tried: ${paths})`,
    iconNotFound: (id, paths) => `[IMAGE] Icon not found: champion id=${id} (tried: ${paths})`,
    teamBlue: "Blue",
    teamRed: "Red",
    playerFallback: (team, idx) => `${team} Player ${idx}`,
  },
};

// Programın herhangi bir yerinden, o an seçili dilin metinlerine erişim.
// Access the currently selected language's strings from anywhere in the app.
function T() {
  return STRINGS[currentConfig.language === "en" ? "en" : "tr"];
}

// ------------------------- TERMİNAL SORULARI -------------------------
function ask(rl, question, fallback) {
  return new Promise((resolve) => {
    const label = fallback !== undefined && fallback !== "" ? `${question} [${fallback}]: ` : `${question}: `;
    rl.question(label, (answer) => {
      const val = answer.trim();
      resolve(val.length > 0 ? val : fallback);
    });
  });
}

async function promptLanguageAndMatchConfig() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const langAnswer = await ask(rl, "Dil / Language  [1] Türkçe  [2] English", "1");
  const language = langAnswer.trim() === "2" ? "en" : "tr";
  const t = STRINGS[language];
  currentConfig.language = language;

  console.log(`\n${t.header}`);
  console.log(`${t.subheader}\n`);

  const blueName = await ask(rl, t.blueName, currentConfig.blueTeam.name);
  const blueLogo = await ask(rl, t.blueLogo, currentConfig.blueTeam.logo);
  const redName = await ask(rl, t.redName, currentConfig.redTeam.name);
  const redLogo = await ask(rl, t.redLogo, currentConfig.redTeam.logo);

  const matchNumberRaw = await ask(rl, t.matchNumberQ, String(currentConfig.matchNumber || 1));
  const matchNumber = Math.max(1, parseInt(matchNumberRaw, 10) || 1);

  let blueScore = 0;
  let redScore = 0;

  if (matchNumber > 1) {
    console.log(t.scoreInfo(matchNumber));
    blueScore = parseInt(await ask(rl, t.scoreQ(blueName), "0"), 10) || 0;
    redScore = parseInt(await ask(rl, t.scoreQ(redName), "0"), 10) || 0;
  }

  const matchLabel = await ask(rl, t.matchLabelQ, t.matchLabelDefault(matchNumber));

  rl.close();

  currentConfig = {
    ...currentConfig,
    language,
    blueTeam: { name: blueName, logo: blueLogo || "", score: blueScore },
    redTeam: { name: redName, logo: redLogo || "", score: redScore },
    matchLabel,
    matchNumber,
  };
  saveConfig(currentConfig);

  console.log(t.summary(currentConfig.blueTeam.name, currentConfig.redTeam.name, matchLabel));

  return { matchNumber, language };
}

// ------------------------- ÖNCEKİ PICKLERİ TARAYICIDAN ALMA -------------------------
let previousPicksResolver = null;
const previousPicksPromise = new Promise((resolve) => {
  previousPicksResolver = resolve;
});

function openBrowser(url, t) {
  const platform = process.platform;
  const cmd = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(t.browserFail(url));
    }
  });
}

async function collectPreviousPicksIfNeeded(matchNumber, language) {
  if (matchNumber <= 1) return;
  const t = STRINGS[language];

  const champCount = (matchNumber - 1) * 10;
  const url = `http://localhost:${HTTP_PORT}/previous-picks.html?games=${matchNumber - 1}&matchNumber=${matchNumber}`;

  console.log(t.prevPicksInfo(champCount));
  console.log(url);
  console.log(t.prevPicksHint);

  openBrowser(url, t);
  await previousPicksPromise;
  console.log(t.prevPicksDone);
}

// ------------------------- LOCKFILE OKUMA -------------------------
function findLockfile() {
  for (const base of CANDIDATE_PATHS) {
    const p = path.join(base, "lockfile");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readLockfile() {
  const lockPath = findLockfile();
  if (!lockPath) return null;
  try {
    const content = fs.readFileSync(lockPath, "utf-8").trim();
    const [name, pid, port, password, protocol] = content.split(":");
    return { name, pid, port, password, protocol };
  } catch (e) {
    return null;
  }
}

// ------------------------- LCU HTTP İSTEMCİSİ -------------------------
let lcuClient = null;
let lcuInfo = null;

function buildLcuClient(lock) {
  const agent = new https.Agent({ rejectUnauthorized: false });
  const authToken = Buffer.from(`riot:${lock.password}`).toString("base64");
  return axios.create({
    baseURL: `https://127.0.0.1:${lock.port}`,
    httpsAgent: agent,
    timeout: 2000,
    headers: { Authorization: `Basic ${authToken}` },
  });
}

// ------------------------- ŞAMPİYON VERİSİ -------------------------
let championMap = {}; // { [id]: { name, alias } }
let championByName = {}; // { "darius": id, ... } (küçük harf isim/alias -> id, autocomplete için)

async function loadChampionData() {
  if (!lcuClient) return false;
  try {
    const { data } = await lcuClient.get("/lol-game-data/assets/v1/champion-summary.json");

    // Bazı eski şampiyonlar (Ashe, Heimerdinger, Annie vb.) için LCU verisinde HEM güncel
    // HEM de anlamsız/çok büyük numaralı sahte bir kayıt daha bulunabiliyor
    // (örn. Annie: gerçek id=1, ama ayrıca id=60001 diye geçersiz bir kayıt da geliyor).
    // Gerçek League şampiyon ID'leri HER ZAMAN küçük sayılardır (şu an en yükseği ~1000
    // civarı); bu yüzden:
    // 1) rankedPlayEnabled=false olanları atıyoruz,
    // 2) id'si anormal büyük (>=10000) olan sahte/gölge kayıtları baştan eliyoruz,
    // 3) yine de aynı isimde birden fazla kayıt kalırsa, EN KÜÇÜK id'yi gerçek kabul ediyoruz
    //    (büyük id değil — büyük id genelde sahte/gölge kayıt oluyor, Annie örneğinde olduğu gibi).
    const valid = data.filter((c) => c.id > 0 && c.id < 10000 && c.rankedPlayEnabled !== false);

    const idsByName = {};
    for (const c of valid) {
      const key = c.name.toLowerCase();
      (idsByName[key] = idsByName[key] || []).push(c.id);
    }

    const canonicalIds = new Set();
    for (const [name, ids] of Object.entries(idsByName)) {
      const chosen = Math.min(...ids);
      canonicalIds.add(chosen);
      if (ids.length > 1) {
        console.log(T().duplicateChampionRecord(name, ids.length, ids.join(", "), chosen));
      }
    }

    const map = {};
    const byName = {};
    for (const champ of valid) {
      if (!canonicalIds.has(champ.id)) continue; // eski/gölge kayıt, atla
      map[champ.id] = { name: champ.name, alias: champ.alias };
      byName[champ.name.toLowerCase()] = champ.id;
      byName[champ.alias.toLowerCase()] = champ.id;
    }
    championMap = map;
    championByName = byName;
    console.log(T().championsLoaded(Object.keys(map).length));
    return true;
  } catch (e) {
    console.warn(T().championDataError, e.message);
    return false;
  }
}

function champInfo(championId) {
  if (!championId || championId === 0) return null;
  const c = championMap[championId];
  if (!c) return { id: championId, name: `#${championId}`, alias: null };
  return { id: championId, name: c.name, alias: c.alias };
}

// ------------------------- OYUNCU İSMİ -------------------------
const summonerNameCache = new Map();

async function getSummonerName(summonerId, fallbackLabel) {
  if (!summonerId || summonerId === 0) return fallbackLabel || null;
  if (summonerNameCache.has(summonerId)) return summonerNameCache.get(summonerId);
  try {
    const { data } = await lcuClient.get(`/lol-summoner/v1/summoners/${summonerId}`);
    const name = data.gameName || data.displayName || fallbackLabel;
    summonerNameCache.set(summonerId, name);
    return name;
  } catch (e) {
    return fallbackLabel || null;
  }
}

// ------------------------- CHAMP SELECT SESSION -> TEMİZ VERİ -------------------------
async function normalizeSession(raw) {
  if (!raw) return { inChampSelect: false };

  const buildTeam = async (team, sideLabel) => {
    const players = team || [];
    return Promise.all(
      players.map(async (p, idx) => {
        const fallback = T().playerFallback(sideLabel, idx + 1);
        const name = await getSummonerName(p.summonerId, fallback);
        return {
          cellId: p.cellId,
          playerName: name,
          champion: champInfo(p.championId),
          pickIntent: champInfo(p.championPickIntent),
          locked: !!p.championId,
        };
      })
    );
  };

  const actions = (raw.actions || []).flat();

  const bans = { blue: [], red: [] };
  for (const action of actions) {
    if (action.type === "ban" && action.completed && action.championId) {
      const isMyTeam = (raw.myTeam || []).some((m) => m.cellId === action.actorCellId);
      bans[isMyTeam ? "blue" : "red"].push(champInfo(action.championId));
    }
  }

  const timer = raw.timer || {};
  const activeAction = actions.find((a) => !a.completed && a.isInProgress);

  const [blueTeam, redTeam] = await Promise.all([
    buildTeam(raw.myTeam, T().teamBlue),
    buildTeam(raw.theirTeam, T().teamRed),
  ]);

  return {
    inChampSelect: true,
    phase: timer.phase || "UNKNOWN",
    timeLeftMs: Math.max(0, Math.round(timer.adjustedTimeLeftInPhase ?? 0)),
    totalTimeMs: Math.round(timer.totalTimeInPhase ?? 0),
    activeActorCellId: activeAction ? activeAction.actorCellId : null,
    blueTeam,
    redTeam,
    bans,
    config: currentConfig,
  };
}

// ------------------------- WEBSOCKET SUNUCUSU -------------------------
let wss = null;
const clients = new Set();

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ------------------------- POLLING DÖNGÜSÜ -------------------------
let lastPhase = null;

async function pollChampSelect() {
  if (!lcuClient) return;
  try {
    const { data } = await lcuClient.get("/lol-champ-select/v1/session");
    const normalized = await normalizeSession(data);
    if (normalized.phase !== lastPhase) {
      console.log(T().phaseChanged(lastPhase, normalized.phase));
      lastPhase = normalized.phase;
    }
    broadcast({ type: "champSelect", data: normalized });
  } catch (e) {
    if (e.response && e.response.status === 404) {
      if (lastPhase !== null) console.log(T().champSelectExited);
      lastPhase = null;
      broadcast({ type: "champSelect", data: { inChampSelect: false, config: currentConfig } });
    } else {
      console.warn(T().lcuConnError, e.message);
      lcuClient = null;
      ensureLcuConnected();
    }
  }
}

// ------------------------- LCU'YA BAĞLANMA (ilk bağlantıda beklenebilir) -------------------------
let connecting = false;

function ensureLcuConnected() {
  if (connecting || lcuClient) return waitForFirstConnection();
  connecting = true;

  return new Promise((resolve) => {
    const attempt = async () => {
      const lock = readLockfile();
      if (!lock) {
        console.log(T().lockfileNotFound);
        setTimeout(attempt, 3000);
        return;
      }
      lcuInfo = lock;
      lcuClient = buildLcuClient(lock);
      console.log(T().lcuConnected(`https://127.0.0.1:${lock.port}`));
      const ok = await loadChampionData();
      if (!ok) {
        // İstemci daha lobiye tam açılmamış olabilir, kısa süre sonra tekrar dene
        lcuClient = null;
        setTimeout(attempt, 3000);
        return;
      }
      connecting = false;
      resolve(true);
    };
    attempt();
  });
}

function waitForFirstConnection() {
  return new Promise((resolve) => {
    const check = () => {
      if (lcuClient && Object.keys(championMap).length > 0) resolve(true);
      else setTimeout(check, 300);
    };
    check();
  });
}

// ------------------------- EXPRESS -------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/api/config", (req, res) => res.json(currentConfig));

app.post("/api/config", (req, res) => {
  currentConfig = { ...currentConfig, ...req.body };
  saveConfig(currentConfig);
  broadcast({ type: "config", data: currentConfig });
  res.json(currentConfig);
});

// Autocomplete için: tüm şampiyonların isim listesi (previous-picks.html kullanır)
app.get("/api/champions", (req, res) => {
  const list = Object.entries(championMap).map(([id, c]) => ({ id: Number(id), name: c.name }));
  res.json(list.sort((a, b) => a.name.localeCompare(b.name, "tr")));
});

// Önceki maç(lar)ın picklerini kaydetme — previous-picks.html buraya POST eder
app.post("/api/previous-picks", (req, res) => {
  const rawGames = req.body.games || [];

  const resolveRoles = (roles) => {
    const out = {};
    for (const role of ROLES) {
      const typed = ((roles && roles[role]) || "").trim();
      if (!typed) {
        out[role] = null;
        continue;
      }
      const id = championByName[typed.toLowerCase()];
      out[role] = id ? { id, name: championMap[id].name } : { id: null, name: typed };
    }
    return out;
  };

  currentConfig.previousGames = rawGames.map((g) => ({
    game: g.game,
    blue: resolveRoles(g.blue),
    red: resolveRoles(g.red),
  }));

  saveConfig(currentConfig);
  broadcast({ type: "config", data: currentConfig });
  if (previousPicksResolver) {
    previousPicksResolver(true);
    previousPicksResolver = null;
  }
  res.json({ ok: true, previousGames: currentConfig.previousGames });
});

// Şampiyon adı -> id çözümleme (previous-picks.html anlık önizleme için kullanır)
app.get("/api/champion-lookup", (req, res) => {
  const q = (req.query.name || "").toLowerCase().trim();
  const id = championByName[q];
  if (!id) return res.status(404).json({ found: false });
  res.json({ found: true, id, ...champInfo(id) });
});

// ------------------------- GÖRSEL PROXY (splash-art + ikon, çoklu yol denemesi) -------------------------
const workingSplashPath = new Map();
const workingIconPath = new Map();

function splashCandidates(id) {
  return [
    `/lol-game-data/assets/v1/champion-splashes/${id}/${id}000.jpg`,
    `/lol-game-data/assets/v1/champion-splashes/uncentered/${id}/${id}000.jpg`,
    `/lol-game-data/assets/v1/champion-splashes/centered/${id}/${id}000.jpg`,
  ];
}
function iconCandidates(id) {
  return [
    `/lol-game-data/assets/v1/champion-icons/${id}.png`,
    // Bazı client sürümlerinde square icon yerine tile görseli çalışır — ek yedek yol.
    // On some client versions the square icon path 404s but the tile path works — extra fallback.
    `/lol-game-data/assets/v1/champion-tiles/${id}/${id}000.jpg`,
  ];
}

async function fetchFirstWorking(candidates, cacheMap, id) {
  const cached = cacheMap.get(id);
  const ordered = cached ? [cached, ...candidates.filter((c) => c !== cached)] : candidates;
  for (const p of ordered) {
    try {
      const response = await lcuClient.get(p, { responseType: "arraybuffer" });
      if (response.data && response.data.byteLength > 300) {
        cacheMap.set(id, p);
        return { data: response.data, path: p };
      }
    } catch (e) {
      // sıradaki yolu dene
    }
  }
  return null;
}

function contentTypeFor(path) {
  return path.endsWith(".png") ? "image/png" : "image/jpeg";
}

app.get("/champion-splash/:id", async (req, res) => {
  const id = req.params.id;
  if (!lcuClient) {
    console.warn(T().splashNotConnected(id));
    return res.status(503).end();
  }
  const result = await fetchFirstWorking(splashCandidates(id), workingSplashPath, id);
  if (!result) {
    console.warn(T().splashNotFound(id, splashCandidates(id).join(" | ")));
    return res.status(404).end();
  }
  res.set("Content-Type", contentTypeFor(result.path));
  res.set("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(result.data));
});

app.get("/champion-icon/:id", async (req, res) => {
  const id = req.params.id;
  if (!lcuClient) {
    console.warn(T().iconNotConnected(id));
    return res.status(503).end();
  }
  const result = await fetchFirstWorking(iconCandidates(id), workingIconPath, id);
  if (!result) {
    console.warn(T().iconNotFound(id, iconCandidates(id).join(" | ")));
    return res.status(404).end();
  }
  res.set("Content-Type", contentTypeFor(result.path));
  res.set("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(result.data));
});

app.get("/api/status", (req, res) => {
  res.json({ lcuConnected: !!lcuClient, lcuPort: lcuInfo ? lcuInfo.port : null, wsPort: WS_PORT });
});

// ------------------------- BAŞLATMA -------------------------
async function main() {
  const { matchNumber, language } = await promptLanguageAndMatchConfig();
  const t = STRINGS[language];

  // Express + WS'i hemen ayağa kaldır: "Önceki Pickler" sayfası ve LCU verisi buna ihtiyaç duyacak
  wss = new WebSocketServer({ port: WS_PORT });
  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(t.wsNewConnection(clients.size));
    ws.send(JSON.stringify({ type: "config", data: currentConfig }));
    ws.on("close", () => clients.delete(ws));
  });

  app.listen(HTTP_PORT, () => {
    console.log(t.overlayUrl(`http://localhost:${HTTP_PORT}/index.html`));
    console.log(t.controlUrl(`http://localhost:${HTTP_PORT}/control.html`));
    console.log(t.wsUrl(`ws://localhost:${WS_PORT}`));
  });

  console.log(t.connectingLcu);
  await ensureLcuConnected();

  await collectPreviousPicksIfNeeded(matchNumber, language);

  setInterval(pollChampSelect, POLL_INTERVAL_MS);
}

main();
