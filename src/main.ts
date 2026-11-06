import { AudioManager } from './audio/AudioManager';
import { bindBackgroundAudio } from './audio/backgroundAudio';
import { SOUNDS } from './audio/sounds';
import { PixelStormBackground } from './background/Background';
import { mountLogoIntro } from './page/logoIntro';
import { mountFooter } from './page/footer';
import { mountLeaderboard } from './page/leaderboard';
import { bindAnchorScroll } from './page/smoothScroll';
import { pixelIcon, type PixelIconName } from './page/pixelIcons';
import { mountAbout } from './page/about';
import { mountRunButton } from './page/runButton';
import { bindUiClicks } from './audio/uiClicks';
import { RunBudget } from './auth/runBudget';
import { mountTokenHud } from './page/tokenHud';
import { mountSoundToggle } from './page/soundToggle';
import { mountAuthMenu } from './page/authMenu';
import { mountCollection } from './collection/collection';
import { mountHamsterShop } from './collection/hamsterShop';
import { TokenLedger } from './auth/ledger';
import { Inventory } from './auth/inventory';
import { hutSleepers, mountHutMenu } from './page/hutMenu';
import { cardById, CARDS, ratePerBlock } from './collection/cards';
import { MockBackend, UnconfiguredBackend } from './auth/mockBackend';
import type { AuthBackend, Player } from './auth/types';
import { ChainFeed } from './chain/feed';
import type { ChainSource } from './chain/types';
import { mountRealCloud } from './page/realCloud';

const world = document.getElementById('world');
if (!world) throw new Error('#world bulunamadı');

const params = new URLSearchParams(location.search);
// Test kancaları (?dev&…) yalnızca geliştirme sunucusunda: yayın derlemesinde DEV=false olur ve
// bu kodların hepsi paketten silinir (sahte oturum, hızlı blok, ileri sarma, konsol erişimi).
const DEV = import.meta.env.DEV && params.has('dev');
const initial = params.get('weather');

// Test: ?dev&blockSec=0.1 → bloklar çok hızlı dolar (döngüyü baştan sona görmek için)
const blockSec = DEV ? Number(params.get('blockSec')) : 0;
const background = new PixelStormBackground(world, {
  weather: initial === 'storm' || initial === 'cloudy' || initial === 'sunny' ? { initial } : {},
  ...(blockSec > 0 ? { hamster: { secondsPerBlock: blockSec } } : {}),
});
background.start();

// Ses: kodla üretilen telifsiz yağmur, uzak gök gürültüsü ve sakin müzik (varsayılan kapalı)
const audio = new AudioManager();
audio.register(SOUNDS);
audio.attachUnlock();
bindBackgroundAudio(background.events, audio);
// Her butona basışta tık sesi (ses açıkken)
bindUiClicks(audio);

// Sahne ekrandan çıkınca (sayfa aşağı kaydırılınca) çizim durur ama oyun sürer:
// hamster koşmaya ve yıldız kazanmaya devam eder. Sekme değişince oyun tamamen durur.
new IntersectionObserver(([entry]) => background.setOffscreen(!entry?.isIntersecting)).observe(world);

// RUN butonu: çarkın altında, hamsteri uyandırıp koşturur / durdurur
const runUi = mountRunButton(world, background);
// ------------------------------------------------ X ile giriş + kalıcı token bakiyesi
async function createBackend(): Promise<AuthBackend> {
  const mock = DEV ? params.get('mockUser') : null;
  if (mock) return new MockBackend(mock, Number(params.get('mockBalance')) || 0);
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return new UnconfiguredBackend();
  // Supabase istemcisi ayrı parça olarak yüklenir: ilk açılışı yavaşlatmaz
  const { SupabaseBackend } = await import('./auth/supabaseBackend');
  return new SupabaseBackend(url, key);
}

void (async () => {
  const backend = await createBackend().catch((err) => {
    console.warn('[Squeaksy] giriş altyapısı yüklenemedi', err);
    return new UnconfiguredBackend();
  });
  const ledger = new TokenLedger(backend);
  const inventory = new Inventory(backend, ledger);
  // Blok başı yıldız: hamster nadirliği + sırttaki Pixsy bonusu (ETH +0.5, BTC +1)
  ledger.rate = () => ratePerBlock(inventory.active, inventory.equippedIn('back'));
  const signIn = () => {
    if (backend.configured) void backend.signIn().catch((err) => console.warn('[Squeaksy] X girişi başlatılamadı', err));
  };
  // Token sayacı: sahnenin sağ üstü
  const hud = mountTokenHud(world, background, ledger, signIn);

  // Squeekchain Live: Gerçek Bulut, Squeekchain'deki gerçek hamsterin (canlı yayındaki WHEELY9000 çarkı) verisiyle dolar.
  // Kaynak: önce sunucu (Supabase chain_live: doğrulanmış veri + Block Bounty); sunucu tarafı kurulu değilse
  // api.squeekchain.com doğrudan okunur (yalnızca görsel, ödül yok).
  // Test: ?dev&chain=active|idle|fault|delayed|pending|offline → sahte veri; G tuşu gerçek bir inişi tekrar oynatır.
  const chainMode = DEV ? params.get('chain') : null;
  const { DirectChainSource, FallbackChainSource } = await import('./chain/directSource');
  let chainSource: ChainSource;
  if (chainMode) {
    const { MockChain } = await import('./chain/mockChain');
    const mock = new MockChain(chainMode as import('./chain/mockChain').MockChainMode);
    mock.signedIn = () => ledger.signedIn;
    mock.running = () => !ledger.capped && background.hamsterRunning && background.hamsterState === 'run';
    if (backend instanceof MockBackend) mock.credit = (n) => backend.addMockBalance(n);
    chainSource = mock;
    const land = () => {
      mock.land();
      void chainFeed.poll();
    };
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) land();
    });
    const landAt = Number(params.get('landAt'));
    if (landAt > 0) window.setTimeout(land, landAt);
  } else if ('fetchChainLive' in backend && 'claimStormBounty' in backend) {
    chainSource = new FallbackChainSource(backend as unknown as ChainSource, new DirectChainSource());
  } else {
    chainSource = new DirectChainSource();
  }
  const chainFeed = new ChainFeed(chainSource);
  mountRealCloud(world, background, chainFeed, chainSource, ledger, signIn, { controlWeather: !initial });
  chainFeed.start();
  // Leaderboard: Overall (yıldız) / Top Collectors (kart)
  const lb = document.getElementById('leaderboard');
  const lbUi = lb
    ? mountLeaderboard(lb, backend, signIn, {
        buddy: () => {
          const id = inventory.equippedIn('back');
          return (id ? cardById(id)?.buddy : undefined) ?? null;
        },
      })
    : null;
  // Sırttaki Pixsy değişince "Your Rank" kartındaki hamster de güncellenir
  inventory.onChange(() => lbUi?.refreshMine());
  // Ses aç/kapa: sayacın hemen solunda
  const hudEl = world.querySelector<HTMLElement>('.token-hud');
  if (hudEl) mountSoundToggle(world, hudEl, audio);
  const slot = document.querySelector<HTMLElement>('[data-auth]');
  const menu = slot ? mountAuthMenu(slot, backend, ledger, () => Math.floor(ledger.total - background.coinsInFlight + 1e-6)) : null;
  ledger.onChange(() => menu?.refreshBalance());
  background.events.on('token:collect', () => menu?.refreshBalance());

  // Kazanç anında deftere yaz (coin uçarken sayfa kapansa bile kaybolmaz)
  background.events.on('chain:block', () => ledger.addBlock());
  background.events.on('chain:bonus', () => ledger.addBonus());

  // Koleksiyon kartları + kulübe (satın al / hamster değiştir)
  const collection = document.getElementById('collection');
  if (collection) mountCollection(collection, { preview: DEV && params.get('cards') === 'preview', source: inventory });
  const syncHamsters = () => {
    // Oyuncunun kendi değişikliklerinde animasyon: hamsterler yer değiştirir, Pixsy uçar
    const animate = inventory.lastChangeByUser;
    background.setActiveHamster(cardById(inventory.active)?.variant ?? 'starter', { animate });
    const backId = inventory.equippedIn('back');
    const backCard = backId ? cardById(backId) : undefined;
    background.setBackItem(backCard?.buddy ? { id: backCard.id, kind: backCard.buddy } : null, { animate });
    // Pixsy'ler oyun panelinin sağ alt köşesinde: hamsterler gibi hepsi (satılıklar fiyatıyla),
    // sırtta takılı olan hariç
    background.setStoredItems(
      CARDS.filter((c) => c.kind === 'Item' && c.buddy && !inventory.isEquipped(c.id)).map((c) => ({ id: c.id, kind: c.buddy! })),
    );
    background.setHutSleepers(hutSleepers(inventory).map((c) => ({ id: c.id, variant: c.variant ?? 'starter', owned: inventory.isOwned(c.id) })));
    background.setTokensPerBlock(ledger.perBlock);
    hud.refresh();
  };
  inventory.onChange(syncHamsters);

  // Oyunda hamsterin sırtındaki Pixsy'ye tıklayınca çıkarılır (sağ alt köşeye gider)
  world.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const over = e.target instanceof HTMLCanvasElement && background.hitBuddy(e.clientX, e.clientY);
    world.classList.toggle('is-over-buddy', over);
  });
  world.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLCanvasElement) || !background.hitBuddy(e.clientX, e.clientY)) return;
    const id = inventory.equippedIn('back');
    if (id) void inventory.toggleItem(id).catch((err) => console.warn('[Squeaksy] eşya çıkarılamadı', err));
  });
  // Oyun panelinde "Buy" → Market bölümündeki karta kayar (satın alma orada);
  // orada "Switch in game" → oyun paneline döner, hamster kulübede değiştirilir
  let hutUi: ReturnType<typeof mountHutMenu> | null = null;
  const hamsters = document.getElementById('market');
  const shop = hamsters ? mountHamsterShop(hamsters, inventory, ledger, signIn, { onSwitch: (id) => hutUi?.open(id) }) : null;
  hutUi = mountHutMenu(world, background, inventory, ledger, signIn, { onBuy: (id) => shop?.focus(id) });
  syncHamsters();

  // Hamster canı: her hamster 24 saatte en fazla 2 saat koşar (sunucu claim_tokens'ta uygular).
  // Can biterse hamster yatağına döner ve pencere bitene kadar uyur; başka bir hamster kendi canıyla koşabilir.
  const budget = new RunBudget();
  ledger.onRunBudgets = (all) => budget.syncAll(all);
  ledger.onRunBudget = (id, s) => budget.sync(id, s);
  ledger.resting = () => budget.resting;
  budget.setActive(inventory.active);
  inventory.onChange(() => budget.setActive(inventory.active));
  runUi.setBudget(budget);
  hutUi?.setBudget(budget);
  let lastTick = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(5, (now - lastTick) / 1000);
    lastTick = now;
    const running = ledger.signedIn && background.hamsterRunning && background.hamsterState === 'run' && !document.hidden;
    budget.tick(dt, running);
  }, 1000);

  // Yıldız kazanımı: giriş yapılmış, günlük tavan dolmamış ve hamsterin canı varsa
  const syncEarning = () => background.setEarning(ledger.signedIn && !ledger.capped && !budget.resting);
  ledger.onChange(syncEarning);
  let wasResting = false;
  budget.onChange(() => {
    const r = budget.resting;
    if (r === wasResting) return;
    wasResting = r;
    background.setRunLocked(r);
    syncEarning();
    // Son saniyelerin blokları hemen gönderilsin
    if (r) void ledger.flush();
  });
  const apply = (p: Player | null) => {
    background.setEarning(p !== null);
    menu?.render(p);
    void ledger.setPlayer(p);
    void inventory.setPlayer(p);
    hud.refresh();
  };
  backend.onChange(apply);
  void inventory.refreshSupply();
  apply(await backend.init().catch(() => null));

  // Test (sahte oturum): ?dev&mockUser=a&mockBalance=3000&buy=sky-unicorn&equip=sky-unicorn&openHut=inferno-king
  if (DEV) {
    await new Promise((r) => setTimeout(r, 50));
    const buy = params.get('buy');
    const equip = params.get('equip');
    try {
      if (buy) for (const id of buy.split(',')) await inventory.buy(id);
      if (equip) await inventory.equip(equip);
      // ?dev&toggle=pixsy → eşyayı çıkar / tak
      for (const id of (params.get('toggle') ?? '').split(',').filter(Boolean)) await inventory.toggleItem(id);
    } catch (err) {
      console.warn('[dev] satın alma testi', err);
    }
    // ?dev&clickBuddy → hamsterin sırtındaki Pixsy'ye gerçek bir tıklama gönderir
    if (params.has('clickBuddy')) {
      const r = world.getBoundingClientRect();
      const cv = world.querySelector('canvas')!;
      outer: for (let y = r.top; y < r.bottom; y += 3) {
        for (let x = r.left; x < r.right; x += 3) {
          if (!background.hitBuddy(x, y)) continue;
          cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x + 6, clientY: y + 6 }));
          break outer;
        }
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    const open = params.get('openHut');
    if (open) document.querySelector<HTMLButtonElement>(`.hut-spot[aria-label^="${cardById(open)?.name ?? ''}"]`)?.click();
  }

  // Test: ?dev&ff=12 → girişten sonra simülasyonu 12 sn ileri sarar
  const ff = DEV ? Number(params.get('ff')) : 0;
  if (ff > 0) background.fastForward(ff);
})();

// Sayfa: navbar logosu
// Açılış: logodaki çarkta koşan hamster yazıyı altına boyar, sonra logonun yanında uyur
const logo = document.querySelector<HTMLCanvasElement>('.nav__logo');
const word = document.querySelector<HTMLElement>('.nav__brand span');
// Footer: çark logosu + uyuyan Squeaksy
const footer = document.getElementById('footer');
if (footer) mountFooter(footer);
const introAt = DEV && params.has('introAt') ? Number(params.get('introAt')) : NaN;
if (logo && word) mountLogoIntro(logo, word, Number.isFinite(introAt) ? { simulateTo: introAt } : {});

// About: Skyeaksy ve BTC Pixsy oyunu anlatır
const about = document.getElementById('about');
if (about) mountAbout(about);

// Leaderboard ayrı bir sayfa gibi: #leaderboard açıkken sadece o bölüm görünür (navbar + footer kalır).
// Ayrı HTML yerine aynı uygulama: giriş, yıldızlar ve arka planda koşan hamster kesilmez.
{
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const route = (initial = false) => {
    const lb = location.hash === '#leaderboard';
    const was = document.body.classList.contains('is-page-lb');
    // Sayfa değişimi (oyun ↔ Leaderboard): anlık kesme yerine kısa, yumuşak bir geçiş (View Transitions)
    if (!initial && lb !== was && 'startViewTransition' in document && !reducedMotion.matches) {
      document.startViewTransition(() => apply(lb, was));
      return;
    }
    apply(lb, was);
  };
  const apply = (lb: boolean, was: boolean) => {
    document.body.classList.toggle('is-page-lb', lb);
    // Kaydırma geçişin içinde ve anında (smooth değil): yeni görüntü doğru yerden alınır, sonradan zıplama olmaz
    if (lb && !was) window.scrollTo({ top: 0, behavior: 'instant' });
    // Leaderboard'a bakarken hamster uyur: yıldız sadece oyun sayfasındayken kazanılır
    if (lb) background.sleepHamster();
    // Leaderboard'dan ana sayfadaki bir bölüme dönüş: bölümler görünür olduktan sonra oraya kay
    if (!lb && was) {
      const target = location.hash ? document.querySelector<HTMLElement>(location.hash) : null;
      if (target) target.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: 0, behavior: 'instant' });
    }
    window.dispatchEvent(new Event('squeaksy:page'));
  };
  window.addEventListener('hashchange', () => route());
  route(true);
}

// Akıcı sayfa içi kaydırma (menü bağlantıları vb.)
bindAnchorScroll();

// Akıcılık: ekranda görünmeyen bölümlerin sonsuz CSS animasyonları duraklatılır (style.css .is-offscreen).
// Kenardan biraz önce açılır ki kaydırınca animasyon zaten dönüyor olsun.
{
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.target.classList.toggle('is-offscreen', !e.isIntersecting);
    },
    { rootMargin: '200px 0px' },
  );
  for (const el of document.querySelectorAll<HTMLElement>('main > section:not(#play), #footer')) io.observe(el);
}

// Menü ikonları (piksel): referanstaki gibi her bağlantının solunda
{
  const icons: Record<string, PixelIconName> = { play: 'play', collection: 'cards', market: 'market', leaderboard: 'trophy', about: 'about' };
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav__links a')) {
    const name = icons[a.hash.slice(1)];
    if (name) a.prepend(pixelIcon(name, 2));
  }
}

// Telefon / tablet menüsü: düğmeyle açılır; bağlantıya, dışarıya dokununca ya da Esc ile kapanır
{
  const nav = document.querySelector<HTMLElement>('.nav');
  const btn = document.querySelector<HTMLButtonElement>('.nav__menu');
  if (nav && btn) {
    const set = (open: boolean) => {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      set(!nav.classList.contains('is-open'));
    });
    nav.querySelector('.nav__links')?.addEventListener('click', (e) => {
      if ((e.target as Element).closest('a')) set(false);
    });
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('is-open') && !nav.contains(e.target as Node)) set(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') set(false);
    });
    window.addEventListener('squeaksy:page', () => set(false));
  }
}

// Dik tutulan telefonda oyun panelinin üstünde "yan çevir" ipucu (CSS yalnızca dik + dar ekranda gösterir).
// "Play here" ile kapatılır; bu oturum boyunca tekrar çıkmaz.
{
  let off = false;
  try {
    off = sessionStorage.getItem('squeaksy.rotateHint') === 'off';
  } catch {
    /* depolama kapalı */
  }
  if (!off) {
    const hint = document.createElement('div');
    hint.className = 'rotate-hint';
    hint.setAttribute('role', 'note');
    const card = document.createElement('div');
    card.className = 'rotate-hint__card';
    const icon = document.createElement('i');
    icon.className = 'rotate-hint__phone';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('b');
    title.textContent = 'Turn your phone sideways';
    const text = document.createElement('p');
    text.textContent = 'Squeaksy plays best in landscape: the full wheel, the hut and every cloud fit on screen.';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'rotate-hint__btn';
    dismiss.textContent = 'Play here';
    dismiss.addEventListener('click', () => {
      hint.remove();
      try {
        sessionStorage.setItem('squeaksy.rotateHint', 'off');
      } catch {
        /* depolama kapalı */
      }
    });
    card.append(icon, title, text, dismiss);
    hint.append(card);
    world.append(hint);
  }
}

// Menü: ekranda olan bölümün başlığı vurgulanır (aria-current)
{
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.nav__links a')];
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  const visible = new Map<string, number>();
  const mark = () => {
    let best = 'play';
    let ratio = 0;
    for (const [id, r] of visible) if (r > ratio) [best, ratio] = [id, r];
    for (const [id, a] of byId) a.setAttribute('aria-current', String(id === best));
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      mark();
    },
    { threshold: [0, 0.15, 0.35, 0.6, 0.85] },
  );
  for (const id of byId.keys()) {
    const sec = document.getElementById(id);
    if (sec) io.observe(sec);
  }
  mark();
}

// Uzaklaşma: oyun panelinden aşağı kaydırdıkça ses kısılır ve boğuklaşır (sanki uzaklaşıyormuş gibi)
{
  let queued = false;
  const update = () => {
    queued = false;
    // Leaderboard sayfasında oyun sesi susar (oyun panelinden "uzaktayız")
    if (document.body.classList.contains('is-page-lb')) {
      audio.setProximity(0);
      return;
    }
    const r = world.getBoundingClientRect();
    const past = Math.max(0, -r.top); // panelin üstünden ne kadar aşağı inildi
    audio.setProximity(1 - past / (r.height + window.innerHeight * 0.9));
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('squeaksy:page', onScroll);
  update();
  // Sekme değişince / başka sayfaya geçince ses kendiliğinden susar, dönünce yumuşakça geri gelir
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
  window.addEventListener('pagehide', () => audio.setHidden(true));
  window.addEventListener('pageshow', () => audio.setHidden(document.hidden));
}

if (DEV) {
  // ?dev&clean → panel gizli (ekran görüntüsü / tanıtım karesi için)
  if (!params.has('clean')) void import('./dev/devPanel').then(({ mountDevPanel }) => mountDevPanel(background));
  // Test: ?dev&progress=0.6&run → zincir doluluğu ve hamsteri koşturma
  const prog = Number(params.get('progress'));
  if (prog > 0) background.setChainProgress(prog);
  if (params.has('run')) background.setHamsterRunning(true);
  // Test: ?dev&strikeAt=5800&strike=super → belirtilen ms'de yıldırım düşürür
  const at = Number(params.get('strikeAt'));
  if (at > 0) {
    const kind = params.get('strike');
    window.setTimeout(() => {
      if (kind === 'coins') background.strikeBlock({ kind: 'super', coins: 40 });
      else background.strike(kind === 'super' || kind === 'far' ? kind : 'near');
    }, at);
  }
}

// Konsoldan inceleme için (yalnızca geliştirme)
if (import.meta.env.DEV) Object.assign(window, { squeaksy: { background, audio } });
