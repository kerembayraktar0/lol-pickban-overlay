/* =========================================================
   Ortak TR/EN sözlüğü — index.html, control.html ve
   previous-picks.html bu dosyayı kullanır.
   Shared TR/EN dictionary — used by index.html, control.html
   and previous-picks.html.
   ========================================================= */

const I18N = {
  tr: {
    phase: {
      PLANNING: "STRATEJİ",
      BAN_PICK: "PICK / BAN",
      FINALIZATION: "SON HAZIRLIK",
      GAME_STARTING: "OYUN BAŞLIYOR",
    },
    bansLabel: "BANLAR",
    recapLabel: "ÖNCEKİ MAÇ(LAR)DA OYNANANLAR",
    blueTeamDefault: "MAVİ TAKIM",
    redTeamDefault: "KIRMIZI TAKIM",
    control: {
      title: "Pick/Ban Overlay — Kontrol Paneli",
      langLabel: "Dil",
      matchLegend: "Maç",
      matchLabelField: "Maç etiketi (örn. MAÇ 1 / BO5)",
      blueLegend: "Mavi Takım",
      redLegend: "Kırmızı Takım",
      nameField: "İsim",
      logoField: "Logo URL",
      scoreField: "Skor",
      saveBtn: "Kaydet ve Yayına Gönder",
      saved: (time) => `Kaydedildi ✔ (${time})`,
    },
    prevPicks: {
      title: (n) => `Önceki Maç Pickleri (Maç ${n} başlamadan önce)`,
      subtitle: (count) =>
        `Toplam ${count} şampiyon giriliyor — bir kutuya şampiyon ismini yaz, kutudan çıkınca ikonu otomatik gelir.`,
      gameTitle: (g) => `MAÇ ${g} — SEÇİLEN ŞAMPİYONLAR`,
      blueTeam: "MAVİ TAKIM",
      redTeam: "KIRMIZI TAKIM",
      inputPlaceholder: "Şampiyon ismi yaz...",
      saveBtn: "Kaydet ve Devam Et",
      saving: "Kaydediliyor...",
      saved: "✔ Kaydedildi! Bu sekmeyi kapatabilirsin, overlay otomatik devam ediyor.",
      saveError: "Kaydedilemedi — backend (server.js) çalışıyor mu kontrol et.",
      champListError:
        "Şampiyon listesi alınamadı (League istemcisi bağlı mı?) — yine de isim yazıp kaydedebilirsin.",
    },
  },
  en: {
    phase: {
      PLANNING: "STRATEGY",
      BAN_PICK: "PICK / BAN",
      FINALIZATION: "FINAL PREP",
      GAME_STARTING: "GAME STARTING",
    },
    bansLabel: "BANS",
    recapLabel: "PREVIOUS GAME(S) PICKS",
    blueTeamDefault: "BLUE TEAM",
    redTeamDefault: "RED TEAM",
    control: {
      title: "Pick/Ban Overlay — Control Panel",
      langLabel: "Language",
      matchLegend: "Match",
      matchLabelField: "Match label (e.g. GAME 1 / BO5)",
      blueLegend: "Blue Team",
      redLegend: "Red Team",
      nameField: "Name",
      logoField: "Logo URL",
      scoreField: "Score",
      saveBtn: "Save & Send to Broadcast",
      saved: (time) => `Saved ✔ (${time})`,
    },
    prevPicks: {
      title: (n) => `Previous Game Picks (before Game ${n} starts)`,
      subtitle: (count) =>
        `Entering ${count} champions in total — type a champion name into a box, its icon appears automatically once you leave the box.`,
      gameTitle: (g) => `GAME ${g} — CHAMPIONS PICKED`,
      blueTeam: "BLUE TEAM",
      redTeam: "RED TEAM",
      inputPlaceholder: "Type champion name...",
      saveBtn: "Save & Continue",
      saving: "Saving...",
      saved: "✔ Saved! You can close this tab, the overlay will continue automatically.",
      saveError: "Couldn't save — check that the backend (server.js) is running.",
      champListError:
        "Couldn't fetch the champion list (is the League client connected?) — you can still type a name and save.",
    },
  },
};

// Backend'den gelen config.language değeri "tr"/"en" değilse güvenli varsayılan.
// Safe fallback if config.language isn't "tr"/"en".
function resolveLang(lang) {
  return lang === "en" ? "en" : "tr";
}
