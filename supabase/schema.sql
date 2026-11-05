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
drop function if exists public.claim_tokens(integer, integer);
create or replace function public.claim_tokens(p_blocks integer, p_bonus integer default 0)
returns table (balance bigint, credited_blocks integer, credited_bonus integer, daily_left integer)
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

  allowed := floor(least(extract(epoch from (now() - prof.last_claim_at)), max_window_seconds) / min_seconds_per_block)::integer + 3;
  -- Yeni UTC günü: sayaç sıfırlanır
  day_used := case when prof.day_start = today then prof.day_blocks else 0 end;
  cb := greatest(0, least(p_blocks, allowed, daily_block_cap - day_used));
  day_used := day_used + cb;
  prof.blocks_since_bonus := prof.blocks_since_bonus + cb;

  -- Her final ödülü en az bonus_min_blocks blok gerektirir; günlük tavan dolmuşsa verilmez
  if cb > 0 or day_used < daily_block_cap then
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
    updated_at = now()
  where p.id = uid
  returning p.balance into prof.balance;

  return query select prof.balance, cb, cbonus, daily_block_cap - day_used;
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
    select p.id, p.x_handle, p.avatar_url, p.balance as stars,
           2 + (select count(*)::integer from public.owned_cards o where o.user_id = p.id) as cards,
           p.active_hamster
    from public.profiles p
    where p.x_handle is not null
  ), ranked as (
    select b.*,
           rank() over (order by case when p_kind = 'cards' then b.cards::bigint else b.stars end desc, b.stars desc) as rank,
           count(*) over () as total
    from base b
  ), page as (
    select r.rank, r.x_handle, r.avatar_url, r.stars, r.cards, r.active_hamster, r.total, false as is_me
    from ranked r
    order by r.rank, r.x_handle
    limit greatest(1, least(p_size, 50)) offset (greatest(1, p_page) - 1) * greatest(1, least(p_size, 50))
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
