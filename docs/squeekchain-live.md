# Squeekchain Live: mimari

Durum (2026-11-06): Faz 1 + Faz 2 **canlıda** (squeaksy.xyz, commit 76855d2 ve 81a247f).
Supabase tarafı 2026-11-05'te kuruldu (`pg_cron` + `pg_net`, `schema.sql` çalıştırıldı); zamanlayıcının 30 sn'de bir okuduğu doğrulandı,
`last_error` boş; ödüller açık (`chain_config.rewards_enabled = true`). İlk gerçek inişte dağıtım `chain_settlements` üzerinden kontrol edilecek.
Doğrulama: canlı API ve Squeekchain'in kendi istemci şeması; sunucu PGlite'ta 66 test + ilk okuma testiyle; istemci sahte zincir ve gerçek veriyle, ekran görüntüleriyle.

Uygulamada tasarımdan farklar:
- Ayrı rozet yerine **Gerçek Bulut**: çark bulutunun solunda camgöbeği bir bulut, çark bulutuna zincirle bağlı. Etiket bulutun altında
  ("Squeekchain · Block 367 · piksel çubuk · Wheel resting"), tıklayınca bilgi balonu. Piksel yazı tipinde `#` ve `%` okunaksız olduğu için kullanılmadı.
- Oyuncunun bulut zinciri (şekiller, blok sayısı, final) değişmedi; Gerçek Bulut kendi sabit üreteciyle çizilir.
- Fırtına: Gerçek Bulut'a camgöbeği yıldırım (blok sayısına göre 1-4), sahne camgöbeği parlar, zincirden çark bulutuna enerji akar, afiş + Sepolia bağlantısı.
- **Ödül kuralı değişti (kullanıcı, 2026-11-05):** Block Bounty yalnızca iniş anında hamsteri koşan oyuncuya. Tur bazlı uygunluk
  (`round_activity`) kaldırıldı. Sunucu kanıtı: `profiles.last_run_at` (claim_tokens'ta blok yazılınca) son 15 sn içinde olmalı;
  istek `claim_storm_bounty(settlement)` ile, inişten sonra 120 sn içinde. Koşmuyorsa yıldızlar buluttan dökülür, sayaca uçmaz, kaydedilmez.
- Bulut her zaman gerçek hamsterin verisine dayanır: sunucu (Supabase) kurulu değilse tarayıcı api.squeekchain.com'u doğrudan okur
  (`DirectChainSource`, yalnızca görsel, ödül yok). Sunucu kurulunca otomatik olarak sunucuya geçer.
- Faz 3 (×1.5 Real Run) **yapılmadı**.
- Bundan eski (5 dk+) bir iniş fırtına olarak gösterilmez ve ödül doğurmaz (o an kimse koşmuyordu).

Kurulum ve izleme adımları: `supabase/README.md` bölüm 10.

Hedef: gerçek Squeekchain verisi oyunu gerçekten değiştirsin, hile yapılamasın, oyuncu için anlaşılır olsun.

---

## 1. Doğrulanmış gerçekler (varsayım değil)

Kaynak: `https://api.squeekchain.com/v1/{status,core,settlements?range=24h}` ve squeekchain.com JS paketindeki zod şemaları.

| Konu | Gerçek | Tasarıma etkisi |
|---|---|---|
| Çark durumu | `measurement.coreStatus` ∈ `IDLE \| ACTIVE \| COUNTER_FAULT`. **`SPINNING` yok.** | Kod `ACTIVE` arar. `COUNTER_FAULT` = arıza durumu. |
| Ölçüm kaynağı | `provenance` ∈ `hardware \| simulated \| replay \| derived` | Değer verilen her şey `hardware` şartı arar. |
| Tazelik | `freshness` ∈ `online \| stale`, `staleAfterSeconds = 120` | `stale` ya da 120 sn'den eski = "çark verisi yok". |
| Turlar | `roundDuration = 600`. Tur *r*, `genesisTimestamp + r·600` anında kapanır (r=277 → 18:00:00, kesinleşme 18:00:36). | Tur numarası sunucu saatinden hesaplanabilir. |
| Bloklar | **Tek tek gelmez.** Her tur kapanınca bir `BatchSettled` işlemi o turun bütün bloklarını bir kerede yazar. Gözlenen: aktif turda 5 ile 47 blok. | "Her blokta bir yıldırım" yanlış olur. Fırtına **kesinleşme (settlement) başına** bir kez. |
| Kesinleşme | Her 10 dk bir `BatchSettled`, çark dursa bile (o zaman 0 blok). `chain.confirmations = 12`, `safeThroughBlock` verilir. | Sadece `blockNumber ≤ safeThroughBlock` olan olaylar değer üretir. |
| Blok/ilerleme | `blockUnitsPerBlock = 1e9`; yükseklik = `cumulativeBlockUnits / 1e9`, ilerleme = kalan. Şu an 366 + 0.4257 → rozet "Block #367 · 42%". | Rozet doğru hesaplanabilir. |
| Optimistic | `builder.projected.lifecycle = "optimistic"`, `anchor` = kesinleşmiş | Görsel optimistic'i kullanabilir, değer yalnızca kesinleşmişten. |
| Gerçek etkinlik | Ağ 2026-11-03'te başladı. Son 24 saatte 91 kesinleşme, **yalnızca 14 aktif tur** (04:40 ile 07:00 UTC arası), toplam 366 blok. Son 11 saattir çark boşta. | Çark çoğu zaman `IDLE`. Tasarım "nadir olay" için yapılmalı. |
| `/v1/core` | Son 25 `BatchSettled` olayı (yaklaşık 4 saat) ham argümanlarıyla, ~25 KB | Kesinleşme kaynağı bu. 4 saate kadar kesinti kayıpsız telafi edilir. |
| CORS | `access-control-allow-origin: *`, CDN önbelleği `s-maxage=1..5` | Tarayıcı doğrudan okuyabilir, ama bu tasarımda okumaz (bkz. 3). |

Henüz doğrulanamayanlar (Faz 0'da ve ilk aktif turda kontrol edilecek):
- Supabase projesinde `pg_cron` ve `pg_net` eklentilerinin açılabildiği ve `pg_cron` sürümünün saniyelik zamanlamayı desteklediği.
- Çark `ACTIVE` iken `builder.projected` değerinin tur içinde canlı ilerleyip ilerlemediği (çark boşta olduğu için şu an görülemiyor). İlerlemiyorsa rozetteki çubuk 10 dakikada bir sıçrar. Bu bir hata değil, gerçek zincirin davranışı.
- `/v1/settlements` içindeki `recentSettlements` listesinin tam anlamı (gözlemde yalnızca blok tamamlayan 10 kesinleşme vardı). Bu yüzden kaynak olarak `/v1/core` olayları seçildi.

---

## 2. Öneri metnine göre değişenler

1. **Fırtına blok başına değil, kesinleşme başına.** Gerçek bir tur blok ürettiğinde bir "Block Storm" olur; büyüklüğü o turdaki gerçek blok sayısıyla ölçeklenir ("18 real blocks").
2. **×1.5 bonus anlık çark durumuna bağlanamaz.** `coreStatus` kesinleşmemiş (optimistic) donanım telemetrisi. Bunun yerine bonus **kesinleşmiş aktif turlara** bağlanır: gerçek hamster koşarken senin kazandığın yıldızların %50'si, o tur zincire yazıldığında fırtınayla birlikte ödenir. Oyuncu çark `ACTIVE` iken "×1.5 pending" görür, fırtınada alır. Kuralın kendisi Squeekchain'in optimistic/settled ayrımını öğretir.
3. **"O anda koşuyor mu" değil, "o turda koştu mu".** Sunucu bir oyuncunun fırtına anında ekranda olduğunu kanıtlayamaz. Kanıtlayabildiği şey, `claim_tokens` kayıtlarından oyuncunun gerçek turun zaman aralığında blok kazandığıdır. Uygunluk bu yüzden turdaki kazanca bakar. Fırtına anında sayfada olmayan oyuncu ödülünü kaybetmez, dönünce görür.
4. **Rakamlar.** Bir oyuncu 10 dakikalık turda yaklaşık 375 blok tamamlar (Common 375★, Mythic + BTC Pixsy ~3.375★). Sabit +25★ bunun %1 ile %7'si, hissedilmez. Öneri bölüm 7'de.

---

## 3. Genel akış

```
 Gerçek çark (WHEELY9000)
        │ donanım
        ▼
 api.squeekchain.com  ◄─────── pg_net (her 30 sn, Supabase içinden)
        │                          │
        │                          ▼
        │                 chain_tick()  ── doğrula ──►  ingest_status(jsonb)
        │                                               ingest_core(jsonb)
        │                                                   │ tek işlem, idempotent
        │                                                   ▼
        │        chain_live (tek satır) · chain_settlements · storm_grants
        │                                                   ▲          │ bakiye +
        │                         claim_tokens ──► round_activity      ▼
        │                                                         profiles.balance
        ▼
 (tarayıcı doğrudan okumaz)

 Tarayıcı ── her 20 sn ── rpc chain_live()  ──► rozet, hava, ×1.5 göstergesi
          └─ yeni settlement_id ──► Block Storm animasyonu
                                 └─ rpc my_storm_grants() ──► yıldızlar HUD'a
```

Temel ilkeler:

- **Tek doğruluk kaynağı: Supabase'deki `chain_live`.** Rozet, hava, fırtına ve ödül aynı kayıttan gelir. Rozet "#367" derken fırtınanın "#366" demesi gibi tutarsızlık olamaz. Fırtına göründüğünde ödül zaten yazılmıştır.
- **Sırsız.** Veri çekme Postgres'in içinden (pg_cron + pg_net). Cloudflare'de ya da repoda hiçbir anahtar yok. Public repo kuralı korunur, `wrangler.jsonc` statik kalır.
- **Oyun API'ye bağımlı değil.** Veri gelmezse oyun bugünkü gibi çalışır (otomatik hava döngüsü, normal kazanç); sadece rozet "feed delayed" der ve bonuslar durur.
- **Değer yalnızca güvenli (safe) kesinleşmiş zincir olayından.** Optimistic veri sadece görsel.

Neden Cloudflare cron değil: Worker'a script, Supabase'e servis anahtarı ve iki sistem arası güven gerekirdi. pg_cron + pg_net hepsini tek yerde, `schema.sql` içinde tutar.

Neden Realtime değil (şimdilik): yoklama (polling) daha basit ve kopmalara dayanıklı; ±20 sn senkron "hep birlikte" hissi için yeterli. Eşzamanlı oyuncu sayısı büyürse Faz 4'te `realtime.send` ile anlık yayına geçilir; istemci arayüzü değişmez.

---

## 4. Sunucu (Supabase)

### 4.1 Tablolar

Hepsinde RLS açık; istemcinin hiçbirine yazma yetkisi yok.

**`chain_config`** (tek satır, sadece sunucu)
- `enabled bool`: acil kapatma anahtarı. `false` → veri toplanır ama hiçbir ödül verilmez.
- `expected_chain_id = 11155111`, `expected_core = 0xfd6c166d…c4de0c4`
- `genesis_ts`, `round_seconds`: API'den ilk okumada doldurulur, değişirse ödüller durur ve `last_error` yazılır (yeni release = elle onay).
- Ödül ayarları: `bounty_per_block`, `bounty_min`, `bounty_max`, `match_pct`, `min_round_blocks` (bkz. 7).

**`chain_live`** (tek satır, herkes `chain_live()` ile okur)
- Çark: `wheel_status` (`ACTIVE|IDLE|COUNTER_FAULT|UNKNOWN`), `wheel_hardware bool`, `wheel_observed_at`
- Zincir: `settled_height`, `settled_progress_ppb`, `projected_height`, `projected_progress_ppb`, `settled_through_round`
- Son fırtına: `last_storm_id`, `last_storm_blocks`, `last_storm_first`, `last_storm_last`, `last_storm_tx`, `last_storm_at`
- Sağlık: `status_fetched_at`, `core_fetched_at`, `consecutive_failures`, `last_error`

**`chain_settlements`** (her `BatchSettled` olayı, sadece sunucu)
- PK `id = tx_hash || ':' || log_index`
- `eth_block`, `chain_time`, `prev_round`, `through_round`, `active_rounds`, `cumulative_block_units`, `first_block`, `last_block`, `completed_blocks`
- `grants_count`, `grants_total`, `ingested_at`

**`round_activity`** (oyuncu × gerçek tur, oyuncu kendi satırını okur)
- PK `(user_id, round_no)`; `blocks int`, `stars int`
- `claim_tokens` doldurur; 48 saatten eski satırlar her tick'te silinir.

**`storm_grants`** (oyuncu kendi satırını okur)
- PK `(settlement_id, user_id)` → bir fırtınadan iki kez ödül fiziksel olarak imkânsız.
- `bounty int`, `match int`, `total int`, `created_at`

**`chain_fetch`** (pg_net istek defteri): `request_id`, `kind` (`status|core`), `sent_at`.

### 4.2 Fonksiyonlar

| Fonksiyon | Kim çağırır | Ne yapar |
|---|---|---|
| `chain_tick()` | yalnız pg_cron | 1) Önceki tick'in pg_net yanıtlarını `net._http_response`'tan alır, `ingest_*`'e verir. 2) Yeni istekleri gönderir. 3) Eski `round_activity` / yanıtları temizler. Hata yutulur, `last_error` + `consecutive_failures` yazılır. |
| `ingest_status(jsonb)` | `chain_tick` | Çark ve rozet alanlarını günceller. Saf SQL, ağ yok → PGlite'ta test edilir. |
| `ingest_core(jsonb)` | `chain_tick` | Yeni, güvenli `BatchSettled` olaylarını sırayla işler, ödülleri yazar. Saf SQL, test edilir. |
| `chain_live()` | anon + authenticated | Herkese açık alanları döner (kimlik yok). |
| `my_storm_grants(p_since timestamptz)` | authenticated | Oyuncunun o tarihten sonraki ödülleri + güncel bakiye. |
| `claim_tokens(...)` | authenticated | Bugünkü davranış aynen + `round_activity` yazımı (4.4). |

Hepsi `security definer`, `set search_path = public`; `chain_tick` ve `ingest_*` için `revoke all from public, anon, authenticated`.

### 4.3 `ingest_core` doğrulama kuralları (fail closed)

Kural bozulursa o tick'te hiçbir şey yazılmaz, `last_error` dolar, ödüller durur, oyun etkilenmez.

1. `chain.chainId = 11155111` ve `identities.core = expected_core`, değilse reddet.
2. `configuration.genesisTimestamp` / `roundDuration` kayıtlıyla aynı olmalı.
3. Yalnızca `eventName = 'BatchSettled'`, `contractAddress = core`, `blockNumber ≤ chain.safeThroughBlock` olan olaylar.
4. Olaylar `settledThroughRound` sırasıyla işlenir. Her olay için `previousSettledThroughRound` = kayıtlı son `through_round` olmalı (zincir kopmamalı). İlk çalıştırmada sadece başlangıç noktası kaydedilir, geçmişe ödül verilmez.
5. `completed = floor(cum_new / 1e9) - floor(cum_prev / 1e9)`; `cum_new ≥ cum_prev` (geri gidemez); `completed ≤ 16 tur × 1000` gibi bir akıl sınırı.
6. `tx_hash` ~ `^0x[0-9a-f]{64}$`.
7. Ödül şartı: `chain_config.enabled` + son `status` okumasında `provenance = 'hardware'` + `active_rounds > 0` + `completed > 0`.
8. Kayıt + ödüller + `chain_live.last_storm_*` güncellemesi **tek işlemde**. `on conflict do nothing` ile aynı olay ikinci kez gelirse hiçbir şey olmaz.

Kesinti: `/v1/core` son 25 olayı (~4 saat) verdiği için o süreye kadar kayıpsız telafi edilir. Daha uzun kesintide kural 4 kopukluğu görür: kopuk aralık tek "missed" kaydı olarak işlenir, ödül verilmez, sonra normal devam eder.

### 4.4 `claim_tokens` değişikliği

Mevcut hile korumaları (0.7 sn/blok, 600 sn pencere, günlük 20.000 blok) aynen kalır. Eklenen tek şey, kredilenen `cb` blok için:

```
round_no := ceil((extract(epoch from now()) - genesis_ts) / round_seconds)
insert into round_activity (user_id, round_no, blocks, stars)
values (uid, round_no, cb, whole_stars_this_claim)
on conflict (user_id, round_no) do update
  set blocks = least(round_activity.blocks + excluded.blocks, 858),
      stars  = round_activity.stars + excluded.stars
```

- 858 = 600 sn / 0.7 sn tavanı. Bir turda fiziksel olarak mümkün olandan fazlası eşleşmeye sayılmaz (biriktirilmiş claim'i tur başında boşaltma hilesi kapanır).
- Günlük tavana takılan oyuncu `cb = 0` alır, dolayısıyla tura da kaydedilmez. 7/24 bot avantajı yok.
- `genesis_ts` yoksa (veri gelmemişse) hiçbir şey yazılmaz, claim normal çalışır.
- İstemci zaten ~3 sn'de bir claim gönderiyor; tura atama hatası en fazla birkaç saniye.

### 4.5 Ödül hesabı (kesinleşme başına, oyuncu başına)

Kesinleşme `prev_round+1 .. through_round` turlarını kapsar (gözlemde hep 1 tur).

```
rb      = o turlardaki round_activity.blocks toplamı
rs      = o turlardaki round_activity.stars toplamı
uygun   = rb ≥ min_round_blocks
bounty  = clamp(completed × bounty_per_block, bounty_min, bounty_max)
match   = floor(rs × match_pct / 100 × active_rounds / round_count)
total   = bounty + match
```

`active_rounds / round_count` oranı, birikmiş çok turlu kesinleşmede (raporlayıcı gecikirse) sadece aktif turların payını verir.

---

## 5. İstemci

### 5.1 Yeni modüller

| Dosya | Görev |
|---|---|
| `src/chain/types.ts` | `ChainLive`, `StormGrant`, `WheelStatus` tipleri |
| `src/chain/feed.ts` | `ChainFeed`: sekme görünürken 20 sn (±3 sn jitter) `chain_live()` yoklar, gizliyken durur. Olaylar: `live` (her güncelleme), `storm` (yeni `last_storm_id`), `health` (`ok \| delayed`). İlk yüklemede fırtına tetiklemez. |
| `src/page/chainBadge.ts` + css | Sahne sol üstünde piksel rozet. Mobilde daraltılmış hali. |
| `src/page/stormBanner.ts` | Fırtına anında kısa piksel afiş + Sepolia işlem bağlantısı. |

### 5.2 Mevcut koda dokunuşlar

- `AuthBackend`: `fetchChainLive()`, `fetchStormGrants(since)`. `mockBackend` için `?dev&chain=active|idle|fault|delayed` ve `S` tuşu = sahte fırtına.
- `Background`: yeni `blockStorm({ blocks })`. Mevcut süper yıldırım altyapısını kullanır ama **ayırt edici** olmalı: rastgele yıldırımlardan ve zincir finalinden farklı olarak Squeekchain camgöbeği renkte, gerçek blok sayısıyla ölçeklenen bir dizi vuruş (örn. her 6 gerçek blok için bir bulut). Bulut dolum durumunu bozmaz, final ile çakışırsa sıraya girer.
- Hava (`WeatherSystem` zaten `setWeather` / `setAutoCycle` sunuyor):
  - `ACTIVE` + hardware + taze → `autoCycle` kapalı, `sunny`.
  - `IDLE` → `autoCycle` kapalı, `cloudy` (hafif çisenti, yakın yıldırım yok).
  - `COUNTER_FAULT` / veri bayat → `autoCycle` açık, bugünkü davranış.
- `TokenLedger`: fırtınada `fetchStormGrants` → yıldızlar buluttan HUD'a uçar → `setServerBalance`. Bekleyen (gönderilmemiş) bloklar etkilenmez.
- Sayfaya dönüşte: `localStorage`'daki son görülen fırtına zamanından sonraki ödüller "While you were away: Block Storm +N★" olarak gösterilir (sadece görsel kolaylık; asıl kayıt sunucuda).

### 5.3 Rozet metinleri (em dash yok, `&` yok)

| Durum | Metin |
|---|---|
| ACTIVE | `● SQUEEKCHAIN LIVE · Wheel running · Block #367 · ▓▓▓░░ 42% · ×1.5` |
| IDLE | `● SQUEEKCHAIN LIVE · Wheel resting · Block #367 · last block 11h ago` |
| COUNTER_FAULT | `● SQUEEKCHAIN · Wheel sensor check · Block #367` |
| Veri bayat | `○ SQUEEKCHAIN · Feed delayed` |

Rozete dokununca küçük açıklama: "When the real hamster runs, its blocks land on Sepolia every 10 minutes. Each landing strikes the clouds for everyone. Run with it to earn the Block Bounty and +50%."

---

## 6. Hile analizi

| Saldırı | Neden çalışmaz |
|---|---|
| Tarayıcıda "yeni blok geldi" demek | Fırtına ödülü istemciden istenmez; sunucu kendi okuduğu zincir olayıyla kendisi yazar. |
| Sahte `chain_live` | İstemcinin yazma yetkisi yok, okuma bile security definer fonksiyon üzerinden. |
| Aynı fırtınadan iki kez almak | `storm_grants` PK `(settlement_id, user_id)`. |
| Aktif turda biriktirilmiş claim boşaltmak | 600 sn pencere zaten var + tur başına 858 blok tavanı. |
| Bot ile her tura katılmak | Günlük 20.000 blok tavanı; tavandaki oyuncu tura kaydedilmez. |
| Squeekchain'in simülasyon/replay verisi | `provenance = 'hardware'` şartı. |
| Reorg | Yalnızca `safeThroughBlock` (12 onay) altındaki olaylar. |
| Release değişimi / farklı zincir | chainId, core adresi, genesis kontrolü → ödüller durur. |
| Squeekchain API'nin kendisi yanlış veri verirse | Kalan güven noktası bu. İleride: Sepolia RPC'den `BatchSettled` işlemini doğrulamak (opsiyonel sertleştirme, bkz. 9). |

---

## 7. Açık kararlar (rakamlar)

Veri: aktif kesinleşme başına 5 ile 47 gerçek blok; oyuncu tur başına ~375 blok.

| Ayar | Öneri | Gerekçe |
|---|---|---|
| Block Bounty | 3★ × gerçek blok, en az 25★, en fazla 150★ | Rakam gerçek zincire bağlı ("18 real blocks → +54★"), herkese eşit. |
| Real Run bonusu (`match_pct`) | %50 | Önerideki ×1.5'in kesinleşmiş hali. |
| Uygunluk (`min_round_blocks`) | 30 blok | Mevcut final kuralıyla aynı eşik; turun en az ~1 dakikası koşmak. |
| IDLE havası | `cloudy` (çisenti) | Önerideki "yağmur". Çark günün ~%90'ında boşta, sağanak sürekli olursa yorar. |

---

## 8. Fazlar

**Faz 0. Ön koşul (kullanıcı, 5 dk)**
- Supabase SQL editörde bekleyen `schema.sql` (günlük tavan) çalıştırılmış olmalı; bu tasarım ona dayanıyor.
- Dashboard → Database → Extensions: `pg_cron` ve `pg_net` aç. Ben `select extname, extversion from pg_extension` çıktısıyla doğrularım.

**Faz 1. Canlı bağlantı (ödülsüz)**
- `chain_config`, `chain_live`, `chain_fetch`, `chain_tick`, `ingest_status`, `chain_live()`, cron.
- Rozet + hava bağlantısı + "feed delayed" durumu.
- Test: PGlite ile gerçek API yanıtlarından fixture; hata/bayat/fault senaryoları; ekran görüntüleri (masaüstü + mobil yatay).

**Faz 2. Block Storm + Block Bounty**
- `chain_settlements`, `round_activity`, `storm_grants`, `ingest_core`, `claim_tokens` eklentisi, `my_storm_grants`.
- `blockStorm` animasyonu, afiş, yıldız akışı, "while you were away".
- Test: aynı yanıt iki kez (idempotent), safe olmayan olay, yükseklik gerilemesi, yanlış chainId, kopuk tur, çok turlu kesinleşme, tavandaki oyuncu, 0 bloklu tur.

**Faz 3. Real Run bonusu**
- `match` hesabı açılır; rozette "×1.5 pending" ve fırtınada "+N★ Real Run".

**Faz 4. (sonra) İsteğe bağlı**
- Realtime yayına geçiş, Sepolia RPC ile çift doğrulama, SQK / NFT sahibi ayrıcalıkları.

Her faz ayrı inceleme; bir sonraki faz onaydan sonra.

---

## 9. Sonraya bırakılanlar

- Sepolia RPC doğrulaması: `ingest_core` olayı kabul etmeden önce `eth_getTransactionReceipt` ile işlemin Core adresinden `BatchSettled` logu içerdiğini kontrol etmek. API'ye güveni sıfırlar; ek bir RPC sağlayıcısı ister.
- Cüzdan bağlantısı ile SQK / Squeekchain NFT sahiplerine ayrıcalık.
