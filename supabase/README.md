# Squeaksy: Supabase kurulumu ve bakımı

X ile giriş, kalıcı yıldız bakiyesi, kartlar, Market ve Leaderboard bu veritabanında çalışır.
Gizli anahtarlar (X Client Secret, Supabase service_role) **hiçbir zaman** koda veya `.env.local` dosyasına girmez; yalnızca Supabase panelinde durur.

- SQL Editor: `https://supabase.com/dashboard/project/<PROJE-REF>/sql/new`

---

## 1. İlk kurulum (yeni bir Supabase projesi için)

### 1.1 Supabase projesi
1. https://supabase.com → **New project** (ücretsiz plan yeterli).
2. **SQL Editor** → `supabase/schema.sql` dosyasının **tamamını** yapıştır → **Run**.
3. **Project Settings → API**: `Project URL` ve `anon public` anahtarını kopyala.

### 1.2 X Developer uygulaması
1. https://developer.x.com → Projects & Apps → uygulama oluştur.
2. **User authentication settings → Set up**:
   - App permissions: **Read**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI: `https://<PROJE-REF>.supabase.co/auth/v1/callback`
   - Website URL: sitenin adresi
3. **Keys and tokens → OAuth 2.0 Client ID and Client Secret** değerlerini kopyala.

### 1.3 Supabase'de X sağlayıcısı
1. **Authentication → Sign In / Providers → X / Twitter (OAuth 2.0)** → Enable.
2. Client ID ve Client Secret'ı yapıştır → Save.
3. **Authentication → URL Configuration**:
   - Site URL: sitenin adresi
   - Redirect URLs: `http://localhost:5173/**` ve sitenin adresi (ör. `https://squeaksy.xyz/**`)

### 1.4 Projeye anahtarlar
Proje kökünde `.env.local`:

```
VITE_SUPABASE_URL=https://<PROJE-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public anahtarı>
```

`npm run dev` → sağ üstteki **Sign in with X** gerçek girişi açar.

---

## 2. Şema neleri kurar (`schema.sql`)

| Parça | Ne yapar |
|---|---|
| `profiles` | X kullanıcı adı, fotoğraf, yıldız bakiyesi, yarım yıldızlar (`star_fraction`), koşan hamster |
| `card_catalog` | Kartların nadirliği, fiyatı, Pixsy bonusu, dünya geneli adet sınırı (istemci okuyamaz) |
| `owned_cards` | Oyuncunun aldığı kartlar + **ödenen fiyat** (`price_paid`) |
| `equipped_items` | Sırtta takılı Pixsy (kayıt yoksa varsayılan Pixsy) |
| `sync_profile()` | Girişte X profilini kaydeder / günceller |
| `claim_tokens()` | Tamamlanan blokları ve fırtına bonusunu (+10) bakiyeye yazar (hile sınırlı) |
| `buy_card()` | Satın alma: bakiye, sahiplik ve adet sınırı sunucuda kontrol edilir |
| `sell_card()` | Satış: **ödenen fiyatın yarısı** geri verilir |
| `set_active_hamster()` | Koşan hamsteri değiştirir (sadece sahip olunan) |
| `set_equipped_item()` | Pixsy tak / çıkar |
| `card_supply()` | Market'teki Limited sayacı (herkese açık, sadece sayılar) |
| `leaderboard()` | Overall (yıldız) ve Top Collectors (kart) sıralaması (herkese açık) |

### Kartlar ve ekonomi

| Kart | Nadirlik | Blok başı | Fiyat | Adet sınırı |
|---|---|---|---|---|
| Squeaksy | Common | +1 | başlangıç | sınırsız |
| Skyeaksy | Rare | +2 | 1,000 | 5,000 |
| Infernoksy | Legendary | +4 | 4,000 | 1,000 |
| Seraphoksy | Mythic | +8 | 12,000 | 300 |
| Pixsy | Common | +0 | başlangıç | sınırsız |
| ETH Pixsy | Rare | +0.5 (takılıyken) | 600 | 5,000 |
| BTC Pixsy | Legendary | +1 (takılıyken) | 1,500 | 1,000 |

- Fiyatlar getiriye göre: `fiyat ≈ 2 × 481 × (ek yıldız)^1.3`; Pixsy'lerde üst üste binme payı ×1.5.
- Satış her zaman **ödenen fiyatın yarısı**. Fiyatlar değişse de kimse kâr ederek satamaz. ×2 fiyat güncellemesinden önce alınmış kartlar eski fiyatlarıyla işaretlidir (500 / 2,000 / 300 / 1,200).
- Fiyat değiştirmek için: `src/collection/cards.ts` **ve** `schema.sql` içindeki `insert into public.card_catalog` satırları birlikte değişmeli, sonra şema yeniden çalıştırılmalı.

---

## 3. Güncelleme yapınca

`schema.sql` **tekrar çalıştırılabilir** şekilde yazıldı: mevcut bakiyeler, kartlar ve takılı eşyalar korunur, sadece eksikler eklenir.

1. SQL Editor'ü aç; editörde eski bir sorgu varsa **Cmd+A → Delete** ile temizle.
2. `schema.sql` dosyasının **tamamını** yapıştır → **Run**.
3. "Potential issue detected / destructive operation" uyarısı çıkarsa **Run this query** de. Bu uyarı `drop function` satırları içindir; fonksiyonlar yenilenir, oyuncu verisine dokunulmaz.
4. Altta **Success. No rows returned** görmelisin.

Şemaya yeni bir şey eklerken kurallar:
- Tablolar: `create table if not exists`, sütunlar: `add column if not exists`.
- Fonksiyonlar: önce `drop function if exists ...(tipler);`, sonra `create or replace function`.
- Yetkiler dosyanın sonunda yeniden verilir; yeni fonksiyon eklersen `grant execute` satırını da ekle.

---

## 4. Kontrol sorguları

Katalog doğru mu:
```sql
select id, rarity, price, max_supply, bonus from public.card_catalog order by price;
```

Limited sayaçları:
```sql
select * from public.card_supply();
```

Sıralama:
```sql
select * from public.leaderboard('stars', 1, 10);
```

---

## 5. Bir oyuncuya yıldız ekleme (yönetici)

İstemci bakiyeyi değiştiremez; sadece veritabanı sahibi SQL Editor'den yapabilir (ör. hata telafisi):

```sql
update public.profiles
set balance = balance + 500,
    updated_at = now()
where x_handle = '<kullanıcı-adı>'
returning x_handle, balance;
```

Geri almak için `+` yerine `-`. Bakiye sıfırın altına inemez (veritabanı reddeder).
Not: Leaderboard bakiyeye göre sıraladığı için eklenen yıldızlar sıralamada görünür.

---

## 6. Nasıl korunuyor
- Bakiye `profiles` tablosunda; kullanıcı yalnızca kendi satırını **okuyabilir**, doğrudan yazamaz. `owned_cards` ve `equipped_items` de sadece okunur.
- Yıldızlar sadece `claim_tokens()` ile eklenir: geçen süreye göre üst sınır vardır (blok başına en az ~0.7 sn), fazlası kırpılır. Geçen süre en fazla 10 dakika sayılır (oynamadan biriktirip tek seferde talep edilemez). Fırtına bonusu (+10) en az 30 blok tamamlanmadan verilmez.
- Günlük tavan: UTC günü başına en fazla 20,000 blok (normal hızda ~9 saat). Tavana gelince o gün yıldız ve fırtına bonusu yazılmaz.
- X kullanıcı adı ve fotoğrafı `auth.identities`'ten (X'in verdiği kimlik) okunur; kullanıcının değiştirebildiği metadata kullanılmaz. Fotoğraf yalnızca X'in resim sunucusundan kabul edilir.
- Blok başı oran sunucuda hesaplanır: koşan hamsterin nadirliği (`tokens_per_block`) + sırttaki Pixsy bonusu. İstemci oranı değiştiremez.
- Satın alma kart satırını kilitler: aynı anda gelen alımlar adet sınırını aşamaz.
- Kazanılan yıldızlar önce tarayıcıda kuyruğa yazılır, ~3 sn'de bir sunucuya gönderilir; ağ koparsa bir sonraki açılışta gönderilir.
- Yıldız sadece oyuncu sitedeyken kazanılır: sekme değişince, siteden çıkınca veya Leaderboard açılınca hamster uyur.
- Giriş yapmamış ziyaretçi (`anon`) sadece `card_supply()` ve `leaderboard()` çağırabilir.

---

## 7. Yayına geçerken (yapılacaklar)
- [ ] **Authentication → URL Configuration**: Site URL'yi gerçek alan adı yap, Redirect URLs'e `https://<alan-adı>/**` ekle (şu an sadece `http://localhost:5173/**` var).
- [ ] X Developer uygulamasında Website URL'yi gerçek alan adıyla güncelle.
- [ ] Barındırmada (Cloudflare Pages) `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` ve `VITE_SITE_URL` ortam değişkenlerini tanımla.

---

## 8. Sorun giderme
- **"Error getting user email from external provider"**: X uygulamasında *Request email from users* seçeneğini aç (Privacy/Terms URL ister) ya da Supabase'de bu sağlayıcı için e-posta zorunluluğunu kapat.
- **Girişten sonra ana sayfaya dönmüyor**: Redirect URLs listesinde adresin `/**` ile ekli olduğundan emin ol.
- **Market'te Limited sayacı görünmüyor / satın alma "not for sale" diyor**: şema güncel değil; `schema.sql` dosyasını yeniden çalıştır.
- **Leaderboard "opens soon" diyor**: `leaderboard()` fonksiyonu kurulu değil; şemayı yeniden çalıştır.

## 9. Geliştirme (Supabase olmadan)
- Sahte oturum: `?dev&mockUser=deneme&mockBalance=20000`
- Bloklar hızlı dolsun: `?dev&blockSec=0.1`
- Hamster hemen koşsun: `?dev&run`
- Panel olmadan (ekran görüntüsü için): `?dev&clean`
- Leaderboard'u örnek oyuncularla görmek: `?dev&mockUser=deneme#leaderboard`
- Hamster tasarım önizlemesi: `/hamster.html`
