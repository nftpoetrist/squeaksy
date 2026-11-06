-- Squeaksy: X profilleri, kalıcı yıldız bakiyesi, kartlar, market, leaderboard
-- Supabase Dashboard → SQL Editor'de çalıştırın. Tekrar çalıştırmak güvenlidir:
-- mevcut oyuncu verileri (bakiye, kartlar, takılı eşyalar) korunur, sadece eksikler eklenir.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  x_handle text,
  display_name text,
  avatar_url text,
  balance bigint not null default 0 check (balance >= 0),
  -- Hile koruması: son talepten bu yana geçen süre, kazanılabilecek blok sayısını sınırlar
  last_claim_at timestamptz not null default now(),
  -- Final ödülü (+10) yalnızca yeterince blok tamamlandıktan sonra verilebilir
  blocks_since_bonus integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Kart kataloğu (sunucu tarafı): blok başı token oranı aktif hamsterin nadirliğinden gelir.
-- İstemci bu tabloyu okuyamaz/yazamaz; sadece claim_tokens() kullanır.
create table if not exists public.card_catalog (
  id text primary key,
  kind text not null check (kind in ('hamster', 'item')),
  rarity text not null check (rarity in ('common', 'rare', 'legendary', 'mythic'))
);
alter table public.card_catalog enable row level security;
-- Mythic (Seraphoksy) eklendi: tablo daha önce kurulduysa nadirlik kontrolünü güncelle
alter table public.card_catalog drop constraint if exists card_catalog_rarity_check;
alter table public.card_catalog add constraint card_catalog_rarity_check check (rarity in ('common', 'rare', 'legendary', 'mythic'));
-- Satın alma fiyatı (token). 0 = satılmaz (başlangıç kartları herkese açık)
alter table public.card_catalog add column if not exists price integer not null default 0 check (price >= 0);
-- Eşyaların takıldığı yuva (hamsterlerde boş): back = sırt, head = baş
alter table public.card_catalog add column if not exists slot text check (slot in ('back', 'head'));
-- Eşya takılıyken blok başına ekstra yıldız (ETH Pixsy +0.5, BTC Pixsy +1)
alter table public.card_catalog add column if not exists bonus numeric(6, 2) not null default 0 check (bonus >= 0);
-- Sınırlı arz: dünya genelinde en fazla bu kadar sahip olunabilir (null = sınırsız)
alter table public.card_catalog add column if not exists max_supply integer check (max_supply is null or max_supply > 0);
insert into public.card_catalog (id, kind, rarity, price, slot, bonus, max_supply) values
  ('starter-hamster', 'hamster', 'common', 0, null, 0, null),
  ('pixsy', 'item', 'common', 0, 'back', 0, null),
  ('sky-unicorn', 'hamster', 'rare', 1000, null, 0, 5000),
  ('inferno-king', 'hamster', 'legendary', 4000, null, 0, 1000),
  ('seraph-twin', 'hamster', 'mythic', 12000, null, 0, 300),
  ('eth-pixsy', 'item', 'rare', 600, 'back', 0.5, 5000),
  ('btc-pixsy', 'item', 'legendary', 1500, 'back', 1, 1000)
on conflict (id) do update set kind = excluded.kind, rarity = excluded.rarity, price = excluded.price, slot = excluded.slot,
  bonus = excluded.bonus, max_supply = excluded.max_supply;

-- Oyuncunun satın aldığı kartlar (başlangıç kartları burada tutulmaz; herkes sahiptir)
create table if not exists public.owned_cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null references public.card_catalog (id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table public.owned_cards enable row level security;
-- Ödenen fiyat: satış bunun yarısını geri verir (fiyatlar sonradan değişse de istikrarlı)
alter table public.owned_cards add column if not exists price_paid integer check (price_paid is null or price_paid >= 0);
-- Fiyatlar ×2 olmadan önce alınmış kartlar eski fiyatlarıyla işaretlenir (bedava satış açığı olmasın)
update public.owned_cards set price_paid = case card_id
    when 'sky-unicorn' then 500
    when 'inferno-king' then 2000
    when 'eth-pixsy' then 300
    when 'btc-pixsy' then 1200
    else 0 end
  where price_paid is null;
drop policy if exists "owned_cards: read own" on public.owned_cards;
create policy "owned_cards: read own" on public.owned_cards
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.owned_cards from anon, authenticated;
grant select on public.owned_cards to authenticated;

-- Takılı eşyalar: yuva başına bir eşya. Satır yoksa yuvanın varsayılanı geçerlidir
-- (back → Pixsy takılı). card_id null = yuva boş (eşya çıkarılmış).
create table if not exists public.equipped_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('back', 'head')),
  card_id text references public.card_catalog (id),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);
alter table public.equipped_items enable row level security;
drop policy if exists "equipped_items: read own" on public.equipped_items;
create policy "equipped_items: read own" on public.equipped_items
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.equipped_items from anon, authenticated;
grant select on public.equipped_items to authenticated;

-- Günlük blok sayacı (UTC günü): günde en fazla daily_block_cap blok yazılır (claim_tokens)
alter table public.profiles add column if not exists day_start date not null default ((now() at time zone 'utc')::date);
alter table public.profiles add column if not exists day_blocks integer not null default 0 check (day_blocks >= 0);

-- Hamster canı: her hamster 24 saatte en fazla 2 saat koşar, sonra dinlenir (claim_tokens).
-- Her hamsterin kendi penceresi var: ilk koşuyla başlar; can biterse pencere bittiği andan yeniden başlar
-- (tam 24 saat dinlenme). Pencere dolunca can tek seferde tam yenilenir, arada hiç dolmaz.
create table if not exists public.hamster_runs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  hamster_id text not null,
  window_start timestamptz not null,
  run_seconds numeric(10, 2) not null default 0 check (run_seconds >= 0),
  primary key (user_id, hamster_id)
);
alter table public.hamster_runs enable row level security;
drop policy if exists "hamster_runs: read own" on public.hamster_runs;
create policy "hamster_runs: read own" on public.hamster_runs
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.hamster_runs from anon, authenticated;
grant select on public.hamster_runs to authenticated;

-- Son blok kazanılan an (claim_tokens'ta en az bir blok yazıldığında). Block Bounty "koşuyor mu" diye buna bakar.
alter table public.profiles add column if not exists last_run_at timestamptz;

-- Yarım yıldızlar (ör. ETH Pixsy +0.5): tam yıldız olana kadar burada birikir, kaybolmaz
alter table public.profiles add column if not exists star_fraction numeric(10, 4) not null default 0;

-- Koşan hamster (şimdilik herkes başlangıç hamsteriyle). İstemci değiştiremez.
alter table public.profiles
  add column if not exists active_hamster text not null default 'starter-hamster' references public.card_catalog (id);

-- Blok başı token: Common 1 · Rare 2 · Legendary 4 · Mythic 8
drop function if exists public.tokens_per_block(text);
create or replace function public.tokens_per_block(p_rarity text)
returns integer
language sql
immutable
as $$
  select case p_rarity when 'mythic' then 8 when 'legendary' then 4 when 'rare' then 2 else 1 end;
$$;

-- Kullanıcı yalnızca kendi profilini okuyabilir. Yazma politikası YOK:
-- bakiye istemciden doğrudan değiştirilemez, sadece aşağıdaki fonksiyonlarla.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
-- "Automatically expose new tables" kapalıyken de çalışsın: giriş yapan kullanıcıya yalnızca okuma izni
-- (hangi satırı görebileceğini yukarıdaki RLS politikası belirler: sadece kendi satırı)
grant select on public.profiles to authenticated;

-- Girişte çağrılır: X profil bilgisini (kullanıcı adı, foto) alıp profili oluşturur/günceller.
-- Kaynak auth.identities (X'in girişte verdiği kimlik): kullanıcı bunu değiştiremez.
-- auth.users.raw_user_meta_data KULLANILMAZ: istemci auth.updateUser({ data }) ile onu istediği gibi
-- yazabilir (başkasının adını / rastgele bir resim adresini leaderboard'a koyabilirdi).
drop function if exists public.sync_profile();
create or replace function public.sync_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb;
  result public.profiles;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select i.identity_data into meta
  from auth.identities i
  where i.user_id = uid and i.provider in ('x', 'twitter')
  order by i.updated_at desc nulls last
  limit 1;
  meta := coalesce(meta, '{}'::jsonb);

  insert into public.profiles as p (id, x_handle, display_name, avatar_url)
  values (
    uid,
    -- X kullanıcı adı kuralı: 1-15 harf/rakam/alt çizgi; uymayan değer kaydedilmez
    (select h from (select coalesce(meta ->> 'user_name', meta ->> 'preferred_username') as h) v
      where h ~ '^[A-Za-z0-9_]{1,15}$'),
    left(coalesce(meta ->> 'full_name', meta ->> 'name'), 50),
    -- Avatar yalnızca X'in kendi resim sunucusundan
    (select a from (select coalesce(meta ->> 'avatar_url', meta ->> 'picture') as a) v
      where a ~ '^https://(pbs|abs)\.twimg\.com/')
  )
  on conflict (id) do update set
    x_handle = excluded.x_handle,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

-- Tamamlanan blokları ve final ödüllerini (+10) bakiyeye yazar.
-- Blok başı: hamster nadirliği (1/2/4) + sırttaki Pixsy bonusu (ETH +0.5, BTC +1); küsurat star_fraction'da birikir.
-- Sınır: en hızlı koşuda bile bir blok ~0.77 sn sürer; geçen süreye göre fazlası kırpılır.
-- Geçen süre en fazla max_window_seconds sayılır: uzun süre talep etmeyip sonra tek seferde
-- binlerce blok istemek (oynamadan biriktirmek) mümkün olmaz. İstemci her ~3 sn'de gönderir.
-- Günlük tavan: UTC günü başına en fazla daily_block_cap blok (normal hızda ~9 saat oyun). 7/24 açık
-- bir bot da en fazla çok oynayan bir insan kadar kazanır. Tavana gelince bloklar (ve final ödülü) yazılmaz.
-- Hamster canı: koşan hamster, kendi ilk koşusundan itibaren 24 saatte en fazla run_limit_seconds (2 saat).
-- Can kademeli dolmaz: bitmediyse ilk koşudan 24 saat sonra, bittiyse bittiği andan 24 saat sonra tek seferde tam dolar. Süre, talepler arası
-- geçen zamandan (en fazla 15 sn) ve blok sayısından (blok başı en az 0.7 sn) büyük olanıyla sayılır:
-- blokları biriktirip toplu göndermek süreyi kısaltmaz. Süre dolunca pencere bitene kadar blok yazılmaz.
drop function if exists public.claim_tokens(integer, integer);
create or replace function public.claim_tokens(p_blocks integer, p_bonus integer default 0)
returns table (balance bigint, credited_blocks integer, credited_bonus integer, daily_left integer, run_left integer, run_reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  min_seconds_per_block constant numeric := 0.7;
  max_window_seconds constant numeric := 600;
  daily_block_cap constant integer := 20000;
  today date := (now() at time zone 'utc')::date;
  day_used integer;
  bonus_tokens constant integer := 10;
  bonus_min_blocks constant integer := 30;
  run_limit_seconds constant numeric := 7200;
  run_window constant interval := interval '24 hours';
  win_start timestamptz;
  run_used numeric;
  elapsed numeric;
  allowed integer;
  per_block numeric;
  item_bonus numeric;
  earned numeric;
  whole bigint;
  cb integer;
  cbonus integer := 0;
  i integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_blocks < 0 or p_bonus < 0 or p_blocks > 100000 or p_bonus > 1000 then
    raise exception 'invalid amount';
  end if;

  select * into prof from public.profiles where id = uid for update;
  if not found then
    perform public.sync_profile();
    select * into prof from public.profiles where id = uid for update;
  end if;

  select public.tokens_per_block(c.rarity) into per_block
  from public.card_catalog c where c.id = prof.active_hamster;
  per_block := coalesce(per_block, 1);
  -- Sırttaki eşyanın bonusu (kayıt yoksa varsayılan Pixsy: 0)
  select c.bonus into item_bonus
  from public.equipped_items e join public.card_catalog c on c.id = e.card_id
  where e.user_id = uid and e.slot = 'back';
  per_block := per_block + coalesce(item_bonus, 0);

  elapsed := greatest(0, extract(epoch from (now() - prof.last_claim_at)));
  allowed := floor(least(elapsed, max_window_seconds) / min_seconds_per_block)::integer + 3;
  -- Koşan hamsterin canı: 24 saat dolduysa yenilenir
  select h.window_start, h.run_seconds into win_start, run_used
  from public.hamster_runs h where h.user_id = uid and h.hamster_id = prof.active_hamster for update;
  run_used := coalesce(run_used, 0);
  if win_start is not null and now() >= win_start + run_window then
    win_start := null;
    run_used := 0;
  end if;
  -- Kalan koşu süresi kadar blok (dinlenirken 0)
  allowed := least(allowed, greatest(0, ceil((run_limit_seconds - run_used) / min_seconds_per_block)::integer));
  -- Yeni UTC günü: sayaç sıfırlanır
  day_used := case when prof.day_start = today then prof.day_blocks else 0 end;
  cb := greatest(0, least(p_blocks, allowed, daily_block_cap - day_used));
  day_used := day_used + cb;
  if cb > 0 then
    if win_start is null then
      win_start := now();
    end if;
    run_used := least(run_limit_seconds, run_used + greatest(least(elapsed, 15), cb * min_seconds_per_block));
    -- Can bu talepte bitti: dinlenme tam 24 saat, bittiği andan sayılır (arada hiç dolmaz)
    if run_used >= run_limit_seconds then
      win_start := now();
    end if;
  end if;
  prof.blocks_since_bonus := prof.blocks_since_bonus + cb;

  -- Her final ödülü en az bonus_min_blocks blok gerektirir; günlük tavan dolmuşsa verilmez
  -- Dinlenen hamster (koşu süresi doldu) final ödülü de alamaz
  if cb > 0 or (day_used < daily_block_cap and run_used < run_limit_seconds) then
    for i in 1..p_bonus loop
      exit when prof.blocks_since_bonus < bonus_min_blocks;
      cbonus := cbonus + 1;
      prof.blocks_since_bonus := 0;
    end loop;
  end if;

  earned := cb * per_block + prof.star_fraction;
  whole := floor(earned);

  update public.profiles as p set
    balance = p.balance + whole + cbonus * bonus_tokens,
    star_fraction = earned - whole,
    blocks_since_bonus = prof.blocks_since_bonus,
    day_start = today,
    day_blocks = day_used,
    last_claim_at = now(),
    -- Squeekchain Live: hamster gerçekten blok kazandıysa "koşuyor" kanıtı (Block Bounty bunu arar)
    last_run_at = case when cb > 0 then now() else p.last_run_at end,
    updated_at = now()
  where p.id = uid
  returning p.balance into prof.balance;

  if win_start is not null then
    insert into public.hamster_runs as h (user_id, hamster_id, window_start, run_seconds)
    values (uid, prof.active_hamster, win_start, run_used)
    on conflict (user_id, hamster_id) do update set window_start = excluded.window_start, run_seconds = excluded.run_seconds;
  end if;

  return query select prof.balance, cb, cbonus, daily_block_cap - day_used,
    ceil(run_limit_seconds - run_used)::integer,
    case when win_start is null then null else win_start + run_window end;
end;
$$;

-- Kart satın alma: bakiye yeterliyse düşer, kart profile eklenir (aynı kart iki kez alınamaz)
drop function if exists public.buy_card(text);
create or replace function public.buy_card(p_card text)
returns table (balance bigint, card_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item public.card_catalog;
  bal bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  -- Kart satırı kilitlenir: aynı anda gelen satın almalar sırayla işlenir, arz aşılamaz
  select * into item from public.card_catalog c where c.id = p_card for update;
  if not found or item.price <= 0 then
    raise exception 'not for sale';
  end if;
  if exists (select 1 from public.owned_cards o where o.user_id = uid and o.card_id = p_card) then
    raise exception 'already owned';
  end if;
  if item.max_supply is not null
     and (select count(*) from public.owned_cards o where o.card_id = p_card) >= item.max_supply then
    raise exception 'sold out';
  end if;

  select p.balance into bal from public.profiles p where p.id = uid for update;
  if not found then
    raise exception 'no profile';
  end if;
  if bal < item.price then
    raise exception 'insufficient tokens';
  end if;

  update public.profiles as p set balance = p.balance - item.price, updated_at = now()
  where p.id = uid
  returning p.balance into bal;
  insert into public.owned_cards (user_id, card_id, price_paid) values (uid, p_card, item.price);

  return query select bal, p_card;
end;
$$;

-- Koşan hamsteri değiştirir: yalnızca başlangıç hamsteri ya da satın alınmış bir hamster
drop function if exists public.set_active_hamster(text);
create or replace function public.set_active_hamster(p_card text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.card_catalog c where c.id = p_card and c.kind = 'hamster') then
    raise exception 'not a hamster';
  end if;
  if p_card <> 'starter-hamster'
     and not exists (select 1 from public.owned_cards o where o.user_id = uid and o.card_id = p_card) then
    raise exception 'not owned';
  end if;
  update public.profiles as p set active_hamster = p_card, updated_at = now() where p.id = uid;
  return p_card;
end;
$$;

-- Eşya tak / çıkar: p_card null → yuvayı boşalt. Sadece sahip olunan (ya da başlangıç) eşya takılabilir.
drop function if exists public.set_equipped_item(text, text);
create or replace function public.set_equipped_item(p_slot text, p_card text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item public.card_catalog;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_slot not in ('back', 'head') then
    raise exception 'invalid slot';
  end if;
  if p_card is not null then
    select * into item from public.card_catalog c where c.id = p_card;
    if not found or item.kind <> 'item' or item.slot is distinct from p_slot then
      raise exception 'not an item for this slot';
    end if;
    -- Başlangıç eşyaları (fiyatı 0) herkesindir; diğerleri satın alınmış olmalı
    if item.price > 0
       and not exists (select 1 from public.owned_cards o where o.user_id = uid and o.card_id = p_card) then
      raise exception 'not owned';
    end if;
  end if;
  insert into public.equipped_items as e (user_id, slot, card_id, updated_at)
  values (uid, p_slot, p_card, now())
  on conflict (user_id, slot) do update set card_id = excluded.card_id, updated_at = now();
  return p_card;
end;
$$;

-- Kart satma: satın alınmış kart yarı fiyatına geri satılır (başlangıç kartları satılamaz).
-- Koşan hamster satılırsa oyuncu başlangıç hamsterine döner.
drop function if exists public.sell_card(text);
create or replace function public.sell_card(p_card text)
returns table (balance bigint, card_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item public.card_catalog;
  refund integer;
  paid integer;
  bal bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into item from public.card_catalog c where c.id = p_card;
  if not found or item.price <= 0 then
    raise exception 'not sellable';
  end if;
  -- Kilitle ve sahipliği doğrula (aynı anda iki satış olmasın)
  perform 1 from public.profiles p where p.id = uid for update;
  delete from public.owned_cards o where o.user_id = uid and o.card_id = p_card
  returning o.price_paid into paid;
  if not found then
    raise exception 'not owned';
  end if;

  -- Takılı eşya satılırsa çıkarılır
  update public.equipped_items as e set card_id = null, updated_at = now()
  where e.user_id = uid and e.card_id = p_card;

  -- Ödenen fiyatın yarısı (kayıt yoksa katalog fiyatı)
  refund := coalesce(paid, item.price) / 2;
  update public.profiles as p set
    balance = p.balance + refund,
    active_hamster = case when p.active_hamster = p_card then 'starter-hamster' else p.active_hamster end,
    updated_at = now()
  where p.id = uid
  returning p.balance into bal;

  return query select bal, p_card;
end;
$$;

-- Sınırlı kartların arzı: herkes görebilir (sadece toplam sayılar; kimin aldığı görünmez)
drop function if exists public.card_supply();
create or replace function public.card_supply()
returns table (card_id text, max_supply integer, owned integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.max_supply, (select count(*)::integer from public.owned_cards o where o.card_id = c.id)
  from public.card_catalog c
  where c.max_supply is not null;
$$;
revoke all on function public.card_supply() from public;
grant execute on function public.card_supply() to anon, authenticated;

revoke all on function public.set_equipped_item(text, text) from public, anon;
grant execute on function public.set_equipped_item(text, text) to authenticated;
revoke all on function public.sell_card(text) from public, anon;
grant execute on function public.sell_card(text) to authenticated;
revoke all on function public.buy_card(text) from public, anon;
revoke all on function public.set_active_hamster(text) from public, anon;
grant execute on function public.buy_card(text) to authenticated;
grant execute on function public.set_active_hamster(text) to authenticated;
revoke all on function public.tokens_per_block(text) from public, anon, authenticated;
revoke all on function public.sync_profile() from public, anon;
revoke all on function public.claim_tokens(integer, integer) from public, anon;
grant execute on function public.sync_profile() to authenticated;
grant execute on function public.claim_tokens(integer, integer) to authenticated;

-- ---------------------------------------------------------------- Leaderboard (herkese açık sıralama)
-- p_kind: 'stars' (toplam yıldız) | 'cards' (sahip olunan kart; başlangıç kartları dahil = +2).
-- Sadece herkese açık alanlar döner: X kullanıcı adı, avatar, yıldız, kart sayısı, koşan hamster.
-- Giriş yapmış oyuncunun kendi satırı is_me = true olarak sona eklenir (sayfada olmasa bile).
drop function if exists public.leaderboard(text, integer, integer);
create or replace function public.leaderboard(p_kind text default 'stars', p_page integer default 1, p_size integer default 10)
returns table (rank bigint, x_handle text, avatar_url text, stars bigint, cards integer, active_hamster text, total bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.x_handle, p.avatar_url, p.balance as stars, p.created_at,
           2 + (select count(*)::integer from public.owned_cards o where o.user_id = p.id) as cards,
           p.active_hamster
    from public.profiles p
    where p.x_handle is not null
  ), ranked as (
    select b.*,
           -- Eşitlikte aynı numara yok: önce katılan önde (sonra kullanıcı adı), her oyuncunun tek bir sırası olur
           row_number() over (order by case when p_kind = 'cards' then b.cards::bigint else b.stars end desc, b.stars desc, b.created_at, b.x_handle) as rank,
           count(*) over () as total
    from base b
  ), page as (
    select r.rank, r.x_handle, r.avatar_url, r.stars, r.cards, r.active_hamster, r.total, false as is_me
    from ranked r
    order by r.rank
    limit greatest(1, least(p_size, 100)) offset (greatest(1, p_page) - 1) * greatest(1, least(p_size, 100))
  )
  select q.* from (
    select * from page
    union all
    select r.rank, r.x_handle, r.avatar_url, r.stars, r.cards, r.active_hamster, r.total, true
    from ranked r where r.id = auth.uid()
  ) q
  order by q.is_me, q.rank, q.x_handle;
$$;
revoke all on function public.leaderboard(text, integer, integer) from public;
grant execute on function public.leaderboard(text, integer, integer) to anon, authenticated;

-- ================================================================ Squeekchain Live
-- Gerçek Squeekchain verisi oyuna buradan girer (bkz. docs/squeekchain-live.md).
-- Veri, Postgres'in içinden okunur (pg_cron + pg_net): hiçbir gizli anahtar yok.
--   chain_tick() her 30 sn: önceki isteklerin yanıtlarını işler, yenilerini gönderir.
--   ingest_status(): çark durumu + inşa edilen blok (görsel; optimistic veri olabilir).
--   ingest_core(): güvenli (12 onaylı) BatchSettled olayları → kesinleşme kaydı + Block Bounty.
-- Değer (yıldız) yalnızca güvenli kesinleşmiş zincir olayından doğar. Bir kural bozulursa o adımda
-- hiçbir şey yazılmaz, hata chain_live.last_error'a düşer, oyun etkilenmez.
-- pg_cron / pg_net kurulu değilse bu bölüm sessizce pasif kalır.

-- Ayarlar (tek satır, sadece sunucu). Zincir kimliği ilk okumada doldurulur; değişirse ödüller durur.
create table if not exists public.chain_config (
  id smallint primary key default 1 check (id = 1),
  -- Acil kapatma: false iken veri toplanır, fırtına görünür ama yıldız verilmez
  rewards_enabled boolean not null default false,
  api_base text not null default 'https://api.squeekchain.com',
  expected_chain_id text not null default '11155111',
  expected_core text not null default '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4',
  installation_id text,
  genesis_ts bigint,
  round_seconds integer,
  block_units bigint,
  -- Block Bounty: gerçek blok başına yıldız, alt / üst sınır
  bounty_per_block integer not null default 3 check (bounty_per_block >= 0),
  bounty_min integer not null default 25 check (bounty_min >= 0),
  bounty_max integer not null default 150 check (bounty_max >= 0),
  -- Ödül yalnızca fırtına anında hamsteri koşan oyuncuya: inişten sonra bu kadar saniye içinde istenmeli ve
  -- oyuncu son running_grace_seconds içinde gerçekten blok kazanmış olmalı (claim_tokens → last_run_at)
  claim_window_seconds integer not null default 120 check (claim_window_seconds between 30 and 900),
  running_grace_seconds integer not null default 15 check (running_grace_seconds between 5 and 60),
  -- Zincir kimliği beklenenden farklı geldiyse sebebi (null = sorun yok)
  paused_reason text
);
insert into public.chain_config (id) values (1) on conflict (id) do nothing;
alter table public.chain_config enable row level security;
revoke all on public.chain_config from anon, authenticated;

alter table public.chain_config add column if not exists claim_window_seconds integer not null default 120;
alter table public.chain_config add column if not exists running_grace_seconds integer not null default 15;
alter table public.chain_config drop column if exists min_round_blocks;

-- Canlı durum (tek satır). İstemci yalnızca chain_live() fonksiyonuyla okur.
create table if not exists public.chain_live (
  id smallint primary key default 1 check (id = 1),
  wheel_status text not null default 'UNKNOWN',
  wheel_hardware boolean not null default false,
  wheel_fresh boolean not null default false,
  wheel_observed_at timestamptz,
  projected_height bigint,
  projected_progress_ppb bigint,
  -- Güvenli kesinleşmiş zincir başı (ingest_core)
  settled_height bigint,
  settled_progress_ppb bigint,
  settled_through_round bigint,
  settled_cumulative_units numeric,
  last_storm_id text,
  last_storm_blocks integer,
  last_storm_first bigint,
  last_storm_last bigint,
  last_storm_tx text,
  last_storm_round bigint,
  last_storm_at timestamptz,
  last_storm_chain_at timestamptz,
  -- Bu fırtınada koşan oyuncuya verilecek ödül (0 = ödül yok: kapalı / donanım dışı)
  last_storm_bounty integer not null default 0,
  status_at timestamptz,
  core_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  last_error_at timestamptz
);
insert into public.chain_live (id) values (1) on conflict (id) do nothing;
alter table public.chain_live enable row level security;
revoke all on public.chain_live from anon, authenticated;

-- Her BatchSettled olayı (tx_hash:log_index). Aynı olay ikinci kez işlenemez.
create table if not exists public.chain_settlements (
  id text primary key,
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  eth_block bigint not null,
  chain_time timestamptz,
  prev_round bigint not null,
  through_round bigint not null,
  active_rounds integer not null,
  cumulative_units numeric not null,
  first_block bigint,
  last_block bigint,
  completed_blocks integer not null,
  -- Koşan oyuncu başına Block Bounty (0 = bu inişte ödül yok)
  bounty integer not null default 0,
  -- baseline: ilk okumadaki başlangıç noktası · gap: kesinti sonrası kopuk aralık (ikisinde de ödül yok)
  kind text not null default 'normal' check (kind in ('normal', 'baseline', 'gap')),
  grants_count integer not null default 0,
  grants_total bigint not null default 0,
  ingested_at timestamptz not null default now()
);
alter table public.chain_settlements add column if not exists bounty integer not null default 0;
alter table public.chain_live add column if not exists last_storm_bounty integer not null default 0;
alter table public.chain_settlements enable row level security;
revoke all on public.chain_settlements from anon, authenticated;

-- Block Bounty ödülleri: bir inişten oyuncu başına en fazla bir ödül (birincil anahtar).
-- Sadece claim_storm_bounty() yazar: fırtına anında hamsteri koşan oyuncu.
create table if not exists public.storm_grants (
  settlement_id text not null references public.chain_settlements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  bounty integer not null check (bounty >= 0),
  created_at timestamptz not null default now(),
  primary key (settlement_id, user_id)
);
create index if not exists storm_grants_user_idx on public.storm_grants (user_id, created_at desc);
alter table public.storm_grants enable row level security;
revoke all on public.storm_grants from anon, authenticated;

-- pg_net istek defteri (yanıt bir sonraki tick'te okunur)
create table if not exists public.chain_fetch (
  request_id bigint primary key,
  kind text not null check (kind in ('status', 'core')),
  sent_at timestamptz not null default now()
);
alter table public.chain_fetch enable row level security;
revoke all on public.chain_fetch from anon, authenticated;

-- Hata kaydı: art arda hata sayısı artar (başarılı bir okuma sıfırlar)
create or replace function public.chain_note_error(p_msg text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chain_live set
    consecutive_failures = consecutive_failures + 1,
    last_error = left(p_msg, 500),
    last_error_at = now()
  where id = 1;
$$;

-- /v1/status yanıtı: çark durumu ve inşa edilen blok. Sadece görsel alanlar; değer üretmez.
create or replace function public.ingest_status(j jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.chain_config;
  m jsonb := j -> 'measurement';
  st text;
  observed timestamptz;
  stale_after integer;
  units numeric;
begin
  select * into cfg from public.chain_config where id = 1;
  if cfg.installation_id is not null and j ->> 'installationId' is distinct from cfg.installation_id then
    raise exception 'status: installation % does not match %', j ->> 'installationId', cfg.installation_id;
  end if;

  -- Squeekchain şeması: coreStatus ∈ IDLE | ACTIVE | COUNTER_FAULT, freshness ∈ online | stale
  st := m ->> 'coreStatus';
  if st is null or st not in ('IDLE', 'ACTIVE', 'COUNTER_FAULT') then
    st := 'UNKNOWN';
  end if;
  observed := (m ->> 'observedAt')::timestamptz;
  stale_after := least(coalesce((m ->> 'staleAfterSeconds')::integer, 120), 600);

  -- İnşa edilen blok (optimistic: yalnızca bulutun dolum görseli için)
  if j #>> '{builder,status}' = 'available' and cfg.block_units > 0 then
    units := (j #>> '{builder,projected,cumulativeBlockUnits}')::numeric;
  end if;

  update public.chain_live set
    wheel_status = st,
    wheel_hardware = coalesce(m ->> 'provenance' = 'hardware', false),
    wheel_fresh = coalesce(m ->> 'freshness' = 'online' and observed > now() - make_interval(secs => stale_after), false),
    wheel_observed_at = observed,
    projected_height = case when units is null then null else floor(units / cfg.block_units)::bigint end,
    projected_progress_ppb = case when units is null then null
      else floor(mod(units, cfg.block_units) * 1000000000 / cfg.block_units)::bigint end,
    status_at = now(),
    consecutive_failures = 0
  where id = 1;
end;
$$;

-- /v1/core yanıtı: güvenli BatchSettled olaylarını sırayla işler, Block Bounty yazar. Tek işlem, idempotent.
create or replace function public.ingest_core(j jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.chain_config;
  live public.chain_live;
  core_addr text := lower(j #>> '{identities,core}');
  safe_head bigint := (j #>> '{chain,safeThroughBlock}')::bigint;
  g bigint := (j #>> '{configuration,genesisTimestamp}')::bigint;
  rs integer := (j #>> '{configuration,roundDuration}')::integer;
  upb bigint := (j #>> '{configuration,blockUnitsPerBlock}')::bigint;
  max_rounds integer := coalesce((j #>> '{configuration,maxRoundsPerBatch}')::integer, 16);
  ev record;
  a jsonb;
  sid text;
  tx text;
  prev_r bigint;
  thru bigint;
  active integer;
  cum numeric;
  prev_h bigint;
  new_h bigint;
  done integer;
  kind text;
  bounty integer;
  newest_round bigint;
begin
  select * into cfg from public.chain_config where id = 1 for update;
  select * into live from public.chain_live where id = 1 for update;

  -- 1) Doğru zincir ve doğru kontrat mı
  if j #>> '{chain,chainId}' is distinct from cfg.expected_chain_id then
    raise exception 'core: chainId % (expected %)', j #>> '{chain,chainId}', cfg.expected_chain_id;
  end if;
  if core_addr is distinct from lower(cfg.expected_core) then
    raise exception 'core: core address % (expected %)', core_addr, cfg.expected_core;
  end if;
  if g is null or rs is null or rs <= 0 or upb is null or upb <= 0 or safe_head is null then
    raise exception 'core: missing configuration';
  end if;

  -- 2) Zincir ayarı: ilk okumada kaydedilir; sonradan değişirse (yeni sürüm) ödüller durur
  if cfg.genesis_ts is null then
    update public.chain_config set installation_id = j ->> 'installationId', genesis_ts = g, round_seconds = rs, block_units = upb
    where id = 1;
    cfg.genesis_ts := g;
    cfg.round_seconds := rs;
    cfg.block_units := upb;
  elsif cfg.genesis_ts <> g or cfg.round_seconds <> rs or cfg.block_units <> upb
     or cfg.installation_id is distinct from j ->> 'installationId' then
    -- Hata fırlatılmaz (yoksa bu kayıt da geri alınırdı): durdurma sebebi yazılır, hiçbir olay işlenmez.
    -- Yeni sürümü elle onaylamak için: genesis_ts/round_seconds/block_units/installation_id/paused_reason null yapılır.
    update public.chain_config set paused_reason = 'chain configuration changed: ' || coalesce(j ->> 'installationId', '?')
    where id = 1;
    update public.chain_live set core_at = now(), last_error = 'chain configuration changed, rewards paused', last_error_at = now()
    where id = 1;
    return;
  end if;

  -- 3) Güvenli olaylar, tur sırasıyla
  select max(((select x ->> 'value' from jsonb_array_elements(e -> 'arguments') x where x ->> 'name' = 'settledThroughRound'))::bigint)
  into newest_round
  from jsonb_array_elements(coalesce(j -> 'events', '[]'::jsonb)) as e
  where e ->> 'eventName' = 'BatchSettled'
    and lower(e ->> 'contractAddress') = core_addr
    and (e ->> 'blockNumber')::bigint <= safe_head;

  for ev in
    select e
    from jsonb_array_elements(coalesce(j -> 'events', '[]'::jsonb)) as e
    where e ->> 'eventName' = 'BatchSettled'
      and lower(e ->> 'contractAddress') = core_addr
      and (e ->> 'blockNumber')::bigint <= safe_head
    order by ((select x ->> 'value' from jsonb_array_elements(e -> 'arguments') x where x ->> 'name' = 'settledThroughRound'))::bigint
  loop
    select jsonb_object_agg(x ->> 'name', x ->> 'value') into a from jsonb_array_elements(ev.e -> 'arguments') x;
    tx := lower(ev.e ->> 'transactionHash');
    if tx !~ '^0x[0-9a-f]{64}$' then
      raise exception 'core: bad transaction hash %', tx;
    end if;
    sid := tx || ':' || (ev.e ->> 'logIndex');
    thru := (a ->> 'settledThroughRound')::bigint;
    prev_r := (a ->> 'previousSettledThroughRound')::bigint;
    active := (a ->> 'activeRoundCount')::integer;
    cum := (a ->> 'cumulativeBlockUnits')::numeric;
    if thru is null or prev_r is null or active is null or cum is null or thru <= prev_r or active < 0
       or active > thru - prev_r or thru - prev_r > max_rounds then
      raise exception 'core: malformed BatchSettled %', sid;
    end if;

    -- Zaten işlenmiş (ya da başlangıç noktasından eski) olay
    continue when live.settled_through_round is not null and thru <= live.settled_through_round;
    -- İlk okumada sadece en son güvenli olay başlangıç noktası olur (eski olaylar yeniden fırtına çıkarmaz)
    continue when live.settled_through_round is null and thru < newest_round;

    new_h := floor(cum / upb)::bigint;
    if live.settled_through_round is null then
      -- İlk okuma: geçmişe ödül verilmez, sadece başlangıç noktası
      kind := 'baseline';
      done := 0;
    elsif prev_r <> live.settled_through_round then
      -- Kesinti: aradaki olaylar artık görünmüyor; kopuk aralığa ödül verilmez
      kind := 'gap';
      done := 0;
    else
      kind := 'normal';
      if cum < live.settled_cumulative_units then
        raise exception 'core: cumulative block units went backwards at %', sid;
      end if;
      prev_h := floor(live.settled_cumulative_units / upb)::bigint;
      done := (new_h - prev_h)::integer;
      if done > max_rounds * 1000 then
        raise exception 'core: implausible block count % at %', done, sid;
      end if;
    end if;

    -- Block Bounty tutarı: gerçek blok tamamlandıysa ve ödüller açıksa. Kimseye otomatik yazılmaz;
    -- fırtına anında hamsteri koşan oyuncu claim_storm_bounty() ile alır.
    bounty := 0;
    if kind = 'normal' and done > 0 and active > 0 and cfg.rewards_enabled and cfg.paused_reason is null
       and live.wheel_hardware then
      bounty := least(cfg.bounty_max, greatest(cfg.bounty_min, done * cfg.bounty_per_block));
    end if;

    insert into public.chain_settlements (id, tx_hash, eth_block, chain_time, prev_round, through_round, active_rounds,
      cumulative_units, first_block, last_block, completed_blocks, kind, bounty)
    values (sid, tx, (ev.e ->> 'blockNumber')::bigint, to_timestamp((ev.e ->> 'blockTimestamp')::bigint), prev_r, thru, active,
      cum, case when done > 0 then new_h - done + 1 end, case when done > 0 then new_h end, done, kind, bounty)
    on conflict (id) do nothing;
    if not found then
      continue;
    end if;

    live.settled_through_round := thru;
    live.settled_cumulative_units := cum;
    update public.chain_live set
      settled_through_round = thru,
      settled_cumulative_units = cum,
      settled_height = new_h,
      settled_progress_ppb = floor(mod(cum, upb) * 1000000000 / upb)::bigint
    where id = 1;
    -- Herkesin ekranındaki fırtına: gerçek blok tamamlanan her güvenli kesinleşme
    if kind = 'normal' and done > 0 then
      update public.chain_live set
        last_storm_id = sid,
        last_storm_blocks = done,
        last_storm_first = new_h - done + 1,
        last_storm_last = new_h,
        last_storm_tx = tx,
        last_storm_round = thru,
        last_storm_at = now(),
        last_storm_chain_at = to_timestamp((ev.e ->> 'blockTimestamp')::bigint),
        last_storm_bounty = bounty
      where id = 1;
    end if;
  end loop;

  update public.chain_live set core_at = now(), consecutive_failures = 0 where id = 1;
end;
$$;

-- Zamanlayıcının çağırdığı adım: önceki yanıtları işler, yeni istekleri gönderir, eski kayıtları temizler.
-- pg_net istekleri ancak bu işlem bittikten sonra gönderir; yanıt bir sonraki adımda okunur.
create or replace function public.chain_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  resp record;
  cfg public.chain_config;
begin
  if to_regclass('net._http_response') is null then
    return;
  end if;
  select * into cfg from public.chain_config where id = 1;

  for f in select * from public.chain_fetch order by sent_at loop
    select r.status_code, r.content, r.timed_out, r.error_msg into resp
    from net._http_response r where r.id = f.request_id;
    if not found then
      -- Yanıt henüz gelmedi; 3 dakikadan eskiyse vazgeç
      if f.sent_at < now() - interval '3 minutes' then
        delete from public.chain_fetch where request_id = f.request_id;
        perform public.chain_note_error(f.kind || ': no response');
      end if;
      continue;
    end if;
    delete from public.chain_fetch where request_id = f.request_id;
    begin
      if resp.status_code = 200 and resp.content is not null then
        if f.kind = 'status' then
          perform public.ingest_status(resp.content::jsonb);
        else
          perform public.ingest_core(resp.content::jsonb);
        end if;
      else
        perform public.chain_note_error(f.kind || ': http ' || coalesce(resp.status_code::text, 'none')
          || coalesce(' ' || resp.error_msg, '') || case when resp.timed_out then ' (timeout)' else '' end);
      end if;
    exception when others then
      -- ingest_* içindeki her şey geri alınır (yarım kayıt kalmaz); sadece hata not edilir
      perform public.chain_note_error(sqlerrm);
    end;
  end loop;

  -- Yeni istekler (aynı türden bekleyen yoksa)
  if not exists (select 1 from public.chain_fetch where kind = 'status') then
    insert into public.chain_fetch (request_id, kind)
    values (net.http_get(url := cfg.api_base || '/v1/status',
      headers := '{"accept": "application/json", "user-agent": "Squeaksy/1.0 (+https://squeaksy.xyz)"}'::jsonb,
      timeout_milliseconds := 8000), 'status');
  end if;
  if not exists (select 1 from public.chain_fetch where kind = 'core') then
    insert into public.chain_fetch (request_id, kind)
    values (net.http_get(url := cfg.api_base || '/v1/core',
      headers := '{"accept": "application/json", "user-agent": "Squeaksy/1.0 (+https://squeaksy.xyz)"}'::jsonb,
      timeout_milliseconds := 8000), 'core');
  end if;
end;
$$;

-- Herkese açık canlı durum (anon dahil). Kimlik ya da iç hata ayrıntısı içermez.
create or replace function public.chain_live()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'serverTime', now(),
    'statusAt', l.status_at,
    'coreAt', l.core_at,
    'wheel', jsonb_build_object('status', l.wheel_status, 'hardware', l.wheel_hardware, 'fresh', l.wheel_fresh,
      'observedAt', l.wheel_observed_at),
    'build', jsonb_build_object('settledHeight', l.settled_height, 'settledProgressPpb', l.settled_progress_ppb,
      'projectedHeight', l.projected_height, 'projectedProgressPpb', l.projected_progress_ppb),
    'lastStorm', case when l.last_storm_id is null then null else jsonb_build_object('id', l.last_storm_id,
      'blocks', l.last_storm_blocks, 'first', l.last_storm_first, 'last', l.last_storm_last, 'tx', l.last_storm_tx,
      'at', l.last_storm_at, 'chainAt', l.last_storm_chain_at, 'bounty', l.last_storm_bounty) end,
    'bounty', jsonb_build_object('enabled', c.rewards_enabled and c.paused_reason is null, 'perBlock', c.bounty_per_block,
      'min', c.bounty_min, 'max', c.bounty_max, 'windowSeconds', c.claim_window_seconds)
  )
  from public.chain_live l cross join public.chain_config c
  where l.id = 1 and c.id = 1;
$$;

-- Block Bounty'yi al: yalnızca fırtına anında hamsteri gerçekten koşan oyuncu.
-- Kanıt sunucuda: oyuncu son running_grace_seconds içinde claim_tokens ile en az bir blok kazanmış olmalı
-- (last_run_at) ve iniş claim_window_seconds'tan eski olmamalı. Bir inişten oyuncu başına bir kez.
-- Dönüş: status = granted | not_running | expired | already | unavailable, bounty, balance
drop function if exists public.my_storm_grants(timestamptz);
create or replace function public.claim_storm_bounty(p_settlement text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cfg public.chain_config;
  st public.chain_settlements;
  ran timestamptz;
  bal bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into cfg from public.chain_config where id = 1;
  select * into st from public.chain_settlements s where s.id = p_settlement;
  if not found or st.kind <> 'normal' or st.bounty <= 0 or not cfg.rewards_enabled or cfg.paused_reason is not null then
    return jsonb_build_object('status', 'unavailable', 'bounty', 0);
  end if;
  if st.ingested_at < now() - make_interval(secs => cfg.claim_window_seconds) then
    return jsonb_build_object('status', 'expired', 'bounty', 0);
  end if;

  -- Profil kilitlenir: aynı anda gelen iki istek sırayla işlenir
  select p.last_run_at, p.balance into ran, bal from public.profiles p where p.id = uid for update;
  if not found or ran is null or ran < now() - make_interval(secs => cfg.running_grace_seconds) then
    return jsonb_build_object('status', 'not_running', 'bounty', 0, 'balance', bal);
  end if;

  insert into public.storm_grants (settlement_id, user_id, bounty) values (st.id, uid, st.bounty)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('status', 'already', 'bounty', 0, 'balance', bal);
  end if;
  update public.profiles p set balance = p.balance + st.bounty, updated_at = now()
  where p.id = uid
  returning p.balance into bal;
  update public.chain_settlements s set grants_count = s.grants_count + 1, grants_total = s.grants_total + st.bounty
  where s.id = st.id;
  return jsonb_build_object('status', 'granted', 'bounty', st.bounty, 'balance', bal);
end;
$$;

revoke all on function public.chain_note_error(text) from public, anon, authenticated;
revoke all on function public.ingest_status(jsonb) from public, anon, authenticated;
revoke all on function public.ingest_core(jsonb) from public, anon, authenticated;
revoke all on function public.chain_tick() from public, anon, authenticated;
revoke all on function public.chain_live() from public;
grant execute on function public.chain_live() to anon, authenticated;
revoke all on function public.claim_storm_bounty(text) from public, anon;
grant execute on function public.claim_storm_bounty(text) to authenticated;

-- Zamanlayıcı: pg_cron varsa her 30 sn (pg_cron 1.5+), değilse her dakika. Eski iş adıyla bulunup silinir.
do $$
declare
  v int[];
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'squeaksy-chain-tick';
    select string_to_array(regexp_replace(extversion, '[^0-9.]', '', 'g'), '.')::int[] into v
    from pg_extension where extname = 'pg_cron';
    perform cron.schedule('squeaksy-chain-tick', case when v >= array[1, 5] then '30 seconds' else '* * * * *' end,
      'select public.chain_tick()');
  end if;
end;
$$;
