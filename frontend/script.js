/* =========================================================
   LoL Pick/Ban Overlay — Frontend Mantığı
   ---------------------------------------------------------
   - Kart DOM elemanları draft başında BİR KEZ oluşturulur, sonraki
     pollinglerde sadece değişen içerik güncellenir (animasyon loop etmez).
   - Görsel yükleme zinciri: splash-art -> bulunamazsa kare ikon ->
     o da bulunamazsa dekoratif placeholder (asla kırık resim ikonu göstermez).
   ========================================================= */

const WS_URL = "ws://localhost:5001";
const API_BASE = "http://localhost:5000";

const el = {
  topBar: document.getElementById("top-bar"),
  bottomBar: document.getElementById("bottom-bar"),
  recapBar: document.getElementById("recap-bar"),
  recapBlueName: document.getElementById("recap-blue-name"),
  recapRedName: document.getElementById("recap-red-name"),
  recapBlueIcons: document.getElementById("recap-blue-icons"),
  recapRedIcons: document.getElementById("recap-red-icons"),
  bluePicks: document.getElementById("blue-picks"),
  redPicks: document.getElementById("red-picks"),
  blueBans: document.getElementById("blue-bans"),
  redBans: document.getElementById("red-bans"),
  blueName: document.getElementById("blue-name"),
  redName: document.getElementById("red-name"),
  blueScore: document.getElementById("blue-score"),
  redScore: document.getElementById("red-score"),
  blueLogo: document.getElementById("blue-logo"),
  redLogo: document.getElementById("red-logo"),
  centerBlueLogo: document.getElementById("center-blue-logo"),
  centerRedLogo: document.getElementById("center-red-logo"),
  matchLabel: document.getElementById("match-label"),
  phaseLabel: document.getElementById("phase-label"),
  timerText: document.getElementById("timer-text"),
  timerFg: document.getElementById("timer-fg"),
  recapLabel: document.getElementById("recap-label"),
  bansLabel: document.getElementById("center-bans-label"),
};

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 45;

// Aktif dil: config'ten gelir (varsayılan "tr"). / Active language: comes from config (default "tr").
let currentLang = "tr";

let sessionActive = false;

const pickCardRegistry = { blue: new Map(), red: new Map() };
const banSlotRegistry = { blue: [], red: [] };

function champSplashUrl(championId) { return `${API_BASE}/champion-splash/${championId}`; }
function champIconUrl(championId) { return `${API_BASE}/champion-icon/${championId}`; }

// Görsel yükleme zinciri: verilen sırayla dener, hepsi başarısız olursa placeholder'a döner
// (asla tarayıcının kırık resim ikonunu göstermez).
// order: ["splash","icon"] -> pickler (önce splash-art, olmazsa ikon)
// order: ["icon","splash"] -> banlar (önce ikon, olmazsa splash)
function attachImageFallback(imgEl, placeholderEl, championId, order) {
  const urls = order.map((stage) => (stage === "splash" ? champSplashUrl(championId) : champIconUrl(championId)));
  let idx = 0;
  imgEl.onerror = () => {
    idx += 1;
    if (idx < urls.length) {
      imgEl.src = urls[idx];
    } else {
      imgEl.style.display = "none";
      if (placeholderEl) placeholderEl.style.display = "flex";
    }
  };
  imgEl.src = urls[0];
}

// ------------------------- PICK KARTI: OLUŞTURMA (bir kez) -------------------------
function createPickCard(container, player) {
  const card = document.createElement("div");
  card.className = "pick-card enter";
  card.dataset.cellId = player.cellId;

  const img = document.createElement("img");
  img.className = "splash-img";
  img.style.display = "none";

  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  const roleMark = document.createElement("div");
  roleMark.className = "role-mark";
  placeholder.appendChild(roleMark);

  const nameBar = document.createElement("div");
  nameBar.className = "name-bar";
  const playerNameEl = document.createElement("div");
  playerNameEl.className = "player-name";
  const champNameEl = document.createElement("div");
  champNameEl.className = "champ-name";
  nameBar.appendChild(playerNameEl);
  nameBar.appendChild(champNameEl);

  card.appendChild(placeholder);
  card.appendChild(img);
  card.appendChild(nameBar);
  container.appendChild(card);

  requestAnimationFrame(() => card.classList.remove("enter"));

  return { root: card, img, placeholder, playerNameEl, champNameEl, championId: null, locked: false };
}

function updatePickCard(entry, player) {
  entry.playerNameEl.textContent = player.playerName || "";

  const shown = player.champion || player.pickIntent;
  const championId = shown ? shown.id : null;
  const isLocked = !!player.champion;

  if (championId !== entry.championId || isLocked !== entry.locked) {
    entry.championId = championId;
    entry.locked = isLocked;

    if (championId) {
      entry.placeholder.style.display = "none";
      entry.img.style.display = "block";
      entry.img.className = "splash-img " + (isLocked ? "locked" : "hover-only");
      // Pickler: önce ikon (daha güvenilir), bulunamazsa splash-art'a düş.
      // Locked olmayan (henüz kesinleşmemiş) seçimler CSS ile gri tonlu,
      // kilitlenince (locked) kendi renklerinde gösterilir.
      // Picks: try the icon first (more reliable), fall back to splash-art.
      // Not-yet-locked picks are shown grayscale via CSS; once locked
      // (championId confirmed) they show in full color.
      attachImageFallback(entry.img, entry.placeholder, championId, ["icon", "splash"]);
      entry.champNameEl.textContent = shown.name;
    } else {
      entry.img.removeAttribute("src");
      entry.img.style.display = "none";
      entry.placeholder.style.display = "flex";
      entry.champNameEl.textContent = "";
    }
  }

  entry.root.classList.toggle("active", player.cellId != null && window.__activeCellId === player.cellId);
}

// ------------------------- BAN SLOTU -------------------------
function createBanSlots(container) {
  const arr = [];
  for (let i = 0; i < 5; i++) {
    const div = document.createElement("div");
    div.className = "ban-icon";
    arr.push({ root: div, championId: null });
    container.appendChild(div);
  }
  return arr;
}

function updateBanSlot(entry, champion, isNewSession) {
  const championId = champion ? champion.id : null;
  if (championId === entry.championId) return;
  entry.championId = championId;
  entry.root.innerHTML = "";

  if (championId) {
    const img = document.createElement("img");
    img.alt = champion.name;
    // Banlar: önce ikon, bulunamazsa splash-art'a düş
    attachImageFallback(img, entry.root, championId, ["icon", "splash"]);
    entry.root.appendChild(img);
    if (!isNewSession) {
      entry.root.classList.add("enter");
      setTimeout(() => entry.root.classList.remove("enter"), 450);
    }
  }
}

// ------------------------- SESSION BAŞLANGICI / BİTİŞİ -------------------------
function startNewSession(data) {
  sessionActive = true;

  el.bluePicks.innerHTML = "";
  el.redPicks.innerHTML = "";
  el.blueBans.innerHTML = "";
  el.redBans.innerHTML = "";
  pickCardRegistry.blue.clear();
  pickCardRegistry.red.clear();

  (data.blueTeam || []).forEach((p) => pickCardRegistry.blue.set(p.cellId, createPickCard(el.bluePicks, p)));
  (data.redTeam || []).forEach((p) => pickCardRegistry.red.set(p.cellId, createPickCard(el.redPicks, p)));

  banSlotRegistry.blue = createBanSlots(el.blueBans);
  banSlotRegistry.red = createBanSlots(el.redBans);

  el.topBar.classList.remove("hidden");
  el.bottomBar.classList.remove("hidden");
  el.topBar.classList.add("entered");
  el.bottomBar.classList.add("entered");
}

function endSession() {
  sessionActive = false;
  el.topBar.classList.add("hidden");
  el.bottomBar.classList.add("hidden");
  el.topBar.classList.remove("entered");
  el.bottomBar.classList.remove("entered");
  el.bluePicks.innerHTML = "";
  el.redPicks.innerHTML = "";
  el.blueBans.innerHTML = "";
  el.redBans.innerHTML = "";
  pickCardRegistry.blue.clear();
  pickCardRegistry.red.clear();
  banSlotRegistry.blue = [];
  banSlotRegistry.red = [];
}

// ------------------------- CONFIG (takım isim/logo/skor) -------------------------
function setLogo(imgEl, url) {
  if (url) {
    imgEl.onerror = () => { imgEl.removeAttribute("src"); };
    imgEl.src = url;
  } else {
    imgEl.removeAttribute("src");
  }
}

function applyConfig(cfg) {
  if (!cfg) return;

  currentLang = resolveLang(cfg.language);
  const t = I18N[currentLang];
  el.recapLabel.textContent = t.recapLabel;
  el.bansLabel.textContent = t.bansLabel;

  if (cfg.blueTeam) {
    el.blueName.textContent = cfg.blueTeam.name || t.blueTeamDefault;
    el.blueScore.textContent = cfg.blueTeam.score ?? 0;
    setLogo(el.blueLogo, cfg.blueTeam.logo);
    setLogo(el.centerBlueLogo, cfg.blueTeam.logo);
    el.recapBlueName.textContent = cfg.blueTeam.name || t.blueTeamDefault;
  }
  if (cfg.redTeam) {
    el.redName.textContent = cfg.redTeam.name || t.redTeamDefault;
    el.redScore.textContent = cfg.redTeam.score ?? 0;
    setLogo(el.redLogo, cfg.redTeam.logo);
    setLogo(el.centerRedLogo, cfg.redTeam.logo);
    el.recapRedName.textContent = cfg.redTeam.name || t.redTeamDefault;
  }
  if (cfg.matchLabel) el.matchLabel.textContent = cfg.matchLabel;

  renderRecap(cfg.previousGames);
}

// ------------------------- ÖNCEKİ MAÇ PICKLERİ ŞERİDİ -------------------------
// Draft aktif olsun olmasın, her zaman gösterilir. Veri değişmediyse DOM'u
// yeniden oluşturmuyoruz (animasyon/loop sorunu yaşamamak için).
let lastRecapKey = null;

function flattenTeamChampions(previousGames, side) {
  const map = new Map(); // id -> name
  for (const g of previousGames || []) {
    const roles = (g && g[side]) || {};
    for (const role of Object.keys(roles)) {
      const c = roles[role];
      if (c && c.id) map.set(c.id, c.name);
    }
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function renderIconStrip(container, champions) {
  container.innerHTML = "";
  for (const champ of champions) {
    const box = document.createElement("div");
    box.className = "recap-champ";
    box.title = champ.name;
    const img = document.createElement("img");
    img.alt = champ.name;
    attachImageFallback(img, null, champ.id, ["icon", "splash"]);
    box.appendChild(img);
    container.appendChild(box);
  }
}

function renderRecap(previousGames) {
  const key = JSON.stringify(previousGames || []);
  if (key === lastRecapKey) return; // değişmediyse dokunma
  lastRecapKey = key;

  const blueChamps = flattenTeamChampions(previousGames, "blue");
  const redChamps = flattenTeamChampions(previousGames, "red");

  if (blueChamps.length === 0 && redChamps.length === 0) {
    el.recapBar.classList.add("hidden");
    return;
  }

  renderIconStrip(el.recapBlueIcons, blueChamps);
  renderIconStrip(el.recapRedIcons, redChamps);
  el.recapBar.classList.remove("hidden");
}

// ------------------------- ANA RENDER -------------------------
function render(data) {
  if (data.config) applyConfig(data.config);

  if (!data.inChampSelect) {
    if (sessionActive) endSession();
    return;
  }

  if (!sessionActive) startNewSession(data);

  el.phaseLabel.textContent = I18N[currentLang].phase[data.phase] || data.phase || "";
  const totalSec = Math.max(1, Math.round((data.totalTimeMs || 30000) / 1000));
  const leftSec = Math.max(0, Math.round((data.timeLeftMs || 0) / 1000));
  el.timerText.textContent = leftSec;
  const ratio = Math.min(1, leftSec / totalSec);
  el.timerFg.style.strokeDashoffset = TIMER_CIRCUMFERENCE * (1 - ratio);
  el.timerFg.style.stroke = leftSec <= 5 ? "#ff4655" : "#c8aa6e";

  window.__activeCellId = data.activeActorCellId;

  (data.blueTeam || []).forEach((p) => {
    const entry = pickCardRegistry.blue.get(p.cellId);
    if (entry) updatePickCard(entry, p);
  });
  (data.redTeam || []).forEach((p) => {
    const entry = pickCardRegistry.red.get(p.cellId);
    if (entry) updatePickCard(entry, p);
  });

  const blueBans = (data.bans && data.bans.blue) || [];
  banSlotRegistry.blue.forEach((entry, i) => updateBanSlot(entry, blueBans[i] || null, false));
  const redBans = (data.bans && data.bans.red) || [];
  banSlotRegistry.red.forEach((entry, i) => updateBanSlot(entry, redBans[i] || null, false));
}

// ------------------------- WEBSOCKET BAĞLANTISI -------------------------
function connect() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "champSelect") render(msg.data);
      if (msg.type === "config") applyConfig(msg.data);
    } catch (e) {
      console.error("Veri parse hatası:", e);
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}

connect();
