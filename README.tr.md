# LoL Pick/Ban Overlay

*(English version: [README.md](README.md))*

**League of Legends** şampiyon seçim (pick/ban) ekranı için, **OBS Browser
Source** olarak kullanılmak üzere hazırlanmış yerel bir yayın overlay'i.
Doğrudan açık olan League Client'a (LCU API) bağlanır, bu yüzden elle
girilmesi gereken hiçbir şey yoktur: takım isimleri, canlı pickler, banlar,
faz zamanlayıcısı ve hatta Bo3/Bo5 serideki önceki maç(lar)ın pickleri bile
otomatik olarak çekilip gösterilir.

İki parçadan oluşur:
- League Client ile konuşan ve veriyi HTTP + WebSocket üzerinden sunan bir
  **Node.js backend**.
- OBS'in tarayıcı kaynağı olarak yükleyeceği **statik bir frontend** (düz
  HTML/CSS/JS), buna ek olarak yayın sırasında takım bilgilerini
  düzenlemek için küçük bir kontrol paneli.

## Ne işe yarar?

Bir League of Legends maçını yayınlıyor veya kaydediyorsan ve draft sırasında
hiçbir şey elle yazmadan temiz, animasyonlu bir pick/ban overlay'i (takım
logoları, canlı banlar, oyuncu isimleriyle canlı pickler, geri sayım
zamanlayıcısı ve "önceki maç(lar)da ne seçilmişti" hatırlatma şeridi)
istiyorsan — bu araç istemciyi senin yerine izler ve veriyi doğrudan yayınına
aktarır.

## Klasör yapısı

```
lol-pickban-overlay/
├── backend/
│   ├── package.json
│   ├── server.js            <- LCU lockfile'ını okur, champ select'i polling'ler, API + WebSocket'i sunar
│   └── config.json           (her çalıştırmada otomatik oluşturulur)
└── frontend/
    ├── index.html            <- asıl overlay, bunu OBS Browser Source olarak eklersin
    ├── style.css
    ├── script.js
    ├── i18n.js               <- tüm sayfaların kullandığı ortak Türkçe/İngilizce metinler
    ├── control.html          <- takım ismi/logo/skor/dil düzenlemek için ayrı kontrol paneli
    ├── previous-picks.html   <- önceki maç(lar)ın picklerini girmek için form (sadece Bo3/Bo5)
    └── previous-picks.js
```

## 1) Kurulum

```bash
cd lol-pickban-overlay/backend
npm install
```

Bu komut `express`, `cors`, `axios` ve `ws` paketlerini kurar.

## 2) Backend'i başlatma

League of Legends istemcisini aç (henüz champ select'te olması gerekmez, ana
lobi ekranı yeterli), sonra şunu çalıştır:

```bash
npm start
# ya da: node server.js
```

Uygulama her seferinde sıfırdan başlar — önceki oturumdan hiçbir şey (takım
isimleri, skor, maç numarası, önceki pickler) taşınmaz. Her açılışta
terminalde şu sırayla birkaç soru sorar:

1. **Dil** — `[1] Türkçe` ya da `[2] English`. Bu andan itibaren her şey
   (terminal soruları, konsol logları ve overlay'in sunduğu her sayfa)
   seçtiğin dilde gösterilir.
2. **Mavi/Kırmızı takım ismi ve logo URL'i** (logo opsiyonel — boş bırakıp
   Enter'a basabilirsin).
3. **Serinin kaçıncı maçında olduğunuz** (`1`, `2`, `3`, ... — varsayılan
   Bo3).
4. **2. maç veya sonrasıysa:** her takımın o ana kadarki galibiyet sayısı
   (skor tablosunda kullanılır) sorulur ve tarayıcıda otomatik olarak
   `previous-picks.html` sayfası açılır; burada önceki maç(lar)da seçilen
   **(maç numarası − 1) × 10** şampiyonu, her takım için rol rol
   (TOP/JUNGLE/MID/ADC/SUPPORT) girersin — canlı şampiyon ikonu ve
   otomatik tamamlama ile birlikte. Formu kaydettikten sonra bu sekmeyi
   kapatabilirsin; backend veriyi aldığı an otomatik devam eder, terminale
   dönmene gerek yoktur.
5. **Maç etiketi** (örn. `MAÇ 2 / BO3`).

Ardından şuna benzer bir çıktı görmelisin:

```
[LCU] Bağlanıldı -> https://127.0.0.1:XXXXX
[HTTP] Overlay: http://localhost:5000/index.html
[HTTP] Kontrol paneli: http://localhost:5000/control.html
[WS]   Overlay veri kanalı: ws://localhost:5001
```

> **Lockfile bulunamıyor mu?** League'i standart olmayan bir konuma
> kurduysan, başlatmadan önce yolu bir ortam değişkeniyle belirt:
> - Windows (PowerShell): `$env:LOL_PATH="D:\Games\League of Legends"`
> - macOS: `export LOL_PATH="/Applications/League of Legends.app/Contents/LoL"`
>
> Sonra `node server.js` komutunu tekrar çalıştır.

## 3) OBS'e ekleme

1. OBS'te: **Kaynak Ekle → Tarayıcı (Browser Source)**.
2. URL: `http://localhost:5000/index.html`
3. Genişlik: `1920`, Yükseklik: `1080`.
4. **"Görünür değilken kaynağı kapat" (Shutdown source when not visible)**
   kutucuğunu **işaretsiz** bırak (aksi halde her sahne geçişinde WebSocket
   bağlantısını yeniden kurar).
5. Arka plan zaten transparan — yeşil perdeye gerek yok.

## 4) Yayın sırasında takım bilgisi / skor düzenleme

Maçlar arasında skoru güncellemek için terminali yeniden başlatman gerekmez.
Herhangi bir tarayıcıda `http://localhost:5000/control.html` adresini aç
(OBS'e eklemene gerek yok — operatörün bilgisayarında açık tutman yeterli),
takım isimlerini, logolarını, skoru, maç etiketini ya da dili değiştir ve
**Kaydet**e bas. Overlay, WebSocket bağlantısı üzerinden anında güncellenir.

## 5) Nasıl çalışıyor?

- **Lockfile:** League Client açıldığı anda kurulum klasörüne bir `lockfile`
  dosyası yazar (`isim:pid:port:şifre:protokol`). Backend bu dosyayı okuyarak
  LCU API'nin portunu ve şifresini otomatik alır — hiçbir şeyi elle girmen
  gerekmez.
- **Self-signed sertifika sorunu:** LCU API, `https://127.0.0.1:PORT`
  üzerinde tarayıcıların doğrudan reddettiği kendi imzaladığı bir sertifika
  kullanır. Bu yüzden ona giden tüm istekler tarayıcıdan değil, **backend**
  (Node.js, sertifika doğrulaması kapatılmış bir `axios` istemcisiyle)
  üzerinden yapılır — frontend hiçbir zaman LCU'ya değil, sadece backend'in
  normal `http://` ve `ws://` uçlarına konuşur.
- **Polling:** Backend saniyede bir `/lol-champ-select/v1/session`
  endpoint'ini okur, veriyi normalize eder (banlar, pickler, oyuncu
  isimleri, faz zamanlayıcısı) ve bağlı tüm overlay/tarayıcılara WebSocket
  ile yayınlar.
- **Görseller:** Şampiyon splash-art'ı ve ikonları backend üzerinden proxy'lenir
  (`/champion-splash/:id`, `/champion-icon/:id`) — böylece tarayıcının LCU'nun
  https portuna hiç gitmesi gerekmez. Pick kartları önce ikonu dener, o
  bulunamazsa splash-art'a düşer; bir pick sadece üzerine gelinmiş/niyet
  aşamasındayken gri tonlu gösterilir, kilitlendiği anda tam renge geçer.
  Ban kutuları her zaman ikon gösterir.

## 6) İki dillilik (Türkçe / İngilizce)

Kullanıcının gördüğü her yer — terminal soruları, backend konsol logları,
overlay'in kendisi, kontrol paneli ve önceki-pickler formu — başlangıçta
seçilen (ya da kontrol panelinden sonradan değiştirilen) dile göre davranır.
Tüm çevrilmiş metinler tek bir yerde tutulur: frontend için
`frontend/i18n.js`, backend için `backend/server.js` dosyasının başındaki
`STRINGS` nesnesi.

## 7) Notlar ve kısıtlamalar

- LCU champ-select verisi, backend'in bağlandığı bilgisayarın bakış
  açısından `myTeam` / `theirTeam` olarak gelir; overlay bunları
  **Mavi = myTeam, Kırmızı = theirTeam** olarak eşler. Yayın bilgisayarın
  kırmızı tarafa bağlıysa, `server.js` içindeki `normalizeSession`
  fonksiyonunda bu etiketleri ters çevirebilirsin.
- LCU API resmi olarak desteklenmez ve Riot tarafından belgelenmez; istemci
  güncellemeleriyle asset yolları değişebilir. Bir patch sonrası splash-art
  ya da ikonlar yüklenmemeye başlarsa, backend konsolundaki
  `[GÖRSEL]`/`[IMAGE]` uyarılarına bak — ilgili şampiyon ID'si için denenen
  tüm yolları listeler.
- Riot'un gizlilik kısıtları nedeniyle LCU genellikle **rakip takımın**
  `summonerId`'sini `0` olarak gizler, bu yüzden gerçek ismi çekilemez —
  overlay bu durumda "Kırmızı Oyuncu 1" gibi genel bir etikete düşer. Bu,
  bu araçla aşılamayacak, istemci tarafındaki bir kısıtlamadır. İsimler
  genellikle özel lobide/practice tool'da sorunsuz gelir.
- Bu araç tamamen `localhost` üzerinde çalışır. Yayın bilgisayarın
  League'in çalıştığı makineden farklıysa, backend'i League'in çalıştığı
  makinede çalıştırıp OBS'in Browser Source URL'sini o makinenin IP'sine
  göre ayarlaman gerekir (örn. `http://192.168.1.20:5000/index.html`) ve
  `frontend/script.js` içindeki `WS_URL`'i buna göre güncellemelisin.
