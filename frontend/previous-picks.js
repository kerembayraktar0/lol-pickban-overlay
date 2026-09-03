/* =========================================================
   Önceki Maç Pickleri — Giriş Ekranı / Previous Game Picks — Entry Screen
   URL parametreleri: ?games=N&matchNumber=M
   N adet "maç grubu" oluşturur, her grupta 2 takım x 5 rol input'u olur.
   Bir role şampiyon ismi yazıldığında (input'tan çıkınca) backend'e
   sorup ikon önizlemesini gösterir. Sayfa dili backend config'inden
   (dil seçimi terminalde yapılır) okunur.
   ========================================================= */

const API_BASE = "http://localhost:5000";
const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const params = new URLSearchParams(window.location.search);
const gameCount = Math.max(1, parseInt(params.get("games") || "1", 10));
const matchNumber = parseInt(params.get("matchNumber") || "2", 10);

const groupsEl = document.getElementById("groups");
const statusEl = document.getElementById("status");

let currentLang = "tr";

// { game: 1, blue: { TOP: {input, preview}, ... }, red: {...} }
const registry = [];

function buildTeamColumn(container, teamLabel, colorClass) {
  const col = document.createElement("div");
  col.className = `team-col ${colorClass}`;

  const title = document.createElement("div");
  title.className = "team-col-title";
  title.textContent = teamLabel;
  col.appendChild(title);

  const roleEntries = {};

  for (const role of ROLES) {
    const row = document.createElement("div");
    row.className = "role-row";

    const label = document.createElement("div");
    label.className = "role-label";
    label.textContent = role;

    const preview = document.createElement("div");
    preview.className = "champ-preview";

    const input = document.createElement("input");
    input.className = "champ-input";
    input.setAttribute("list", "champion-list");
    input.placeholder = I18N[currentLang].prevPicks.inputPlaceholder;

    input.addEventListener("change", () => lookupAndPreview(input.value, preview));
    input.addEventListener("blur", () => lookupAndPreview(input.value, preview));

    row.appendChild(label);
    row.appendChild(preview);
    row.appendChild(input);
    col.appendChild(row);

    roleEntries[role] = { input, preview };
  }

  container.appendChild(col);
  return roleEntries;
}

async function lookupAndPreview(name, previewEl) {
  previewEl.innerHTML = "";
  if (!name || !name.trim()) return;
  try {
    const res = await fetch(`${API_BASE}/api/champion-lookup?name=${encodeURIComponent(name.trim())}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.found) {
      const img = document.createElement("img");
      img.src = `${API_BASE}/champion-icon/${data.id}`;
      previewEl.appendChild(img);
    }
  } catch (e) {
    /* sessizce geç / fail silently */
  }
}

function buildPage() {
  const t = I18N[currentLang].prevPicks;
  document.getElementById("pageTitle").textContent = t.title(matchNumber);
  document.getElementById("pageSub").textContent = t.subtitle(gameCount * 10);
  document.getElementById("saveBtn").textContent = t.saveBtn;

  for (let g = 1; g <= gameCount; g++) {
    const group = document.createElement("div");
    group.className = "game-group";

    const title = document.createElement("div");
    title.className = "game-title";
    title.textContent = t.gameTitle(g);
    group.appendChild(title);

    const teamsRow = document.createElement("div");
    teamsRow.className = "teams-row";
    group.appendChild(teamsRow);
    groupsEl.appendChild(group);

    const blue = buildTeamColumn(teamsRow, t.blueTeam, "blue");
    const red = buildTeamColumn(teamsRow, t.redTeam, "red");

    registry.push({ game: g, blue, red });
  }

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const games = registry.map(({ game, blue, red }) => {
      const collect = (roleEntries) => {
        const out = {};
        for (const role of ROLES) out[role] = roleEntries[role].input.value.trim();
        return out;
      };
      return { game, blue: collect(blue), red: collect(red) };
    });

    statusEl.classList.remove("err");
    statusEl.textContent = t.saving;

    try {
      const res = await fetch(`${API_BASE}/api/previous-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games }),
      });
      if (!res.ok) throw new Error("server error");
      statusEl.textContent = t.saved;
    } catch (e) {
      statusEl.textContent = t.saveError;
      statusEl.classList.add("err");
    }
  });
}

fetch(`${API_BASE}/api/config`)
  .then((r) => r.json())
  .then((cfg) => {
    currentLang = resolveLang(cfg.language);
  })
  .catch(() => {
    currentLang = "tr";
  })
  .finally(() => {
    buildPage();

    fetch(`${API_BASE}/api/champions`)
      .then((r) => r.json())
      .then((list) => {
        const datalist = document.createElement("datalist");
        datalist.id = "champion-list";
        for (const c of list) {
          const opt = document.createElement("option");
          opt.value = c.name;
          datalist.appendChild(opt);
        }
        document.body.appendChild(datalist);
      })
      .catch(() => {
        statusEl.textContent = I18N[currentLang].prevPicks.champListError;
        statusEl.classList.add("err");
      });
  });
