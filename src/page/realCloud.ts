import type { TokenLedger } from '../auth/ledger';
import type { PixelStormBackground } from '../background/Background';
import type { ChainFeed, FeedState } from '../chain/feed';
import { sepoliaTxUrl, type ChainSource, type ChainStorm } from '../chain/types';

/** Sunucu zaman damgası (mikrosaniyeli olabilir) → ms */
function parseTime(s: string | null | undefined): number {
  if (!s) return NaN;
  return Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
}

function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type View = 'loading' | 'delayed' | 'active' | 'idle' | 'fault' | 'pending';

interface Derived {
  view: View;
  /** İnşa edilen gerçek blok (#) */
  building: number | null;
  /** 0..100 */
  percent: number;
  /** Zincire yazılmayı bekleyen tamamlanmış blok */
  pendingBlocks: number;
}

function derive(s: FeedState): Derived {
  const l = s.live;
  if (!l || l.build.settledHeight === null) return { view: s.health === 'loading' ? 'loading' : 'delayed', building: null, percent: 0, pendingBlocks: 0 };
  const settled = l.build.settledHeight;
  const projected = l.build.projectedHeight ?? settled;
  const ppb = l.build.projectedHeight !== null ? (l.build.projectedProgressPpb ?? 0) : (l.build.settledProgressPpb ?? 0);
  const pendingBlocks = Math.max(0, projected - settled);
  const base = { building: projected + 1, percent: Math.floor(Math.min(999_999_999, Math.max(0, ppb)) / 10_000_000), pendingBlocks };
  if (s.health !== 'ok') return { view: 'delayed', ...base };
  if (pendingBlocks > 0) return { view: 'pending', ...base };
  const w = l.wheel;
  if (!w.fresh || w.status === 'UNKNOWN') return { view: 'delayed', ...base };
  if (w.status === 'COUNTER_FAULT') return { view: 'fault', ...base };
  return { view: w.status === 'ACTIVE' ? 'active' : 'idle', ...base };
}

const STATE_TEXT: Record<View, string> = {
  loading: 'Connecting',
  delayed: 'Feed delayed',
  active: 'Wheel running',
  idle: 'Wheel resting',
  fault: 'Wheel sensor check',
  pending: 'On its way to Sepolia',
};

const WHEEL_TEXT: Record<View, string> = {
  loading: 'Connecting to Squeekchain',
  delayed: 'No fresh signal right now',
  active: 'Running right now',
  idle: 'Resting',
  fault: 'Sensor check in progress',
  pending: 'Just ran, blocks are landing',
};

/**
 * Gerçek Bulut arayüzü (Squeekchain Live): bulutun altındaki etiket, bilgi balonu, gerçek blok
 * inişindeki fırtına afişi; havayı gerçek çarka bağlar. Block Bounty yalnızca o an koşan hamstere kaydedilir.
 */
export function mountRealCloud(
  stage: HTMLElement,
  bg: PixelStormBackground,
  feed: ChainFeed,
  source: ChainSource,
  ledger: TokenLedger,
  signIn: () => void,
  opts: { controlWeather: boolean },
): void {
  const fmt = new Intl.NumberFormat('en-US');

  // ---------------------------------------------------------------- etiket
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'real-tag';
  tag.setAttribute('aria-haspopup', 'dialog');
  tag.setAttribute('aria-expanded', 'false');
  const name = document.createElement('span');
  name.className = 'real-tag__name';
  const dot = document.createElement('i');
  dot.className = 'real-tag__dot';
  dot.setAttribute('aria-hidden', 'true');
  name.append(dot, document.createTextNode('Squeekchain'));
  const line = document.createElement('span');
  line.className = 'real-tag__line';
  // Piksel ilerleme çubuğu (10 hücre): inşa edilen gerçek bloğun doluluğu
  const bar = document.createElement('span');
  bar.className = 'real-tag__bar';
  bar.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 10; i++) bar.append(document.createElement('i'));
  const state = document.createElement('span');
  state.className = 'real-tag__state';
  tag.append(name, line, bar, state);
  stage.append(tag);

  // ---------------------------------------------------------------- bilgi balonu
  const pop = document.createElement('div');
  pop.className = 'hut-pop hut-pop--rare chain-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Squeekchain live');
  stage.append(pop);

  // ---------------------------------------------------------------- fırtına afişi
  const banner = document.createElement('div');
  banner.className = 'storm-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  stage.append(banner);
  let bannerTimer = 0;

  let cur: FeedState = feed.state;
  let d: Derived = derive(cur);

  const place = () => {
    const b = bg.getRealCloudInStage();
    if (!b) return;
    tag.style.left = `${Math.round(b.x)}px`;
    tag.style.top = `${Math.round(b.y + b.h + 4)}px`;
    if (!pop.hidden) placePop();
  };
  const placePop = () => {
    const sr = stage.getBoundingClientRect();
    const tr = tag.getBoundingClientRect();
    const w = Math.min(330, sr.width - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(tr.left - sr.left, sr.width - w - 8)))}px`;
    const below = tr.bottom - sr.top + 8;
    const h = pop.offsetHeight;
    pop.style.top = `${Math.round(below + h > sr.height - 8 ? Math.max(8, tr.top - sr.top - h - 8) : below)}px`;
  };

  const renderTag = () => {
    tag.dataset.state = d.view;
    // Piksel yazı tipinde '#' ve '%' okunaksız: "Block 367" + çubuk
    if (d.view === 'pending') line.textContent = `${fmt.format(d.pendingBlocks)} ${d.pendingBlocks === 1 ? 'block' : 'blocks'} landing`;
    else line.textContent = d.building === null ? '' : `Block ${fmt.format(d.building)}`;
    line.hidden = line.textContent === '';
    const cells = d.view === 'pending' ? 10 : Math.floor(d.percent / 10);
    [...bar.children].forEach((c, i) => c.classList.toggle('is-on', i < cells));
    bar.hidden = d.building === null;
    state.textContent = STATE_TEXT[d.view];
    tag.setAttribute('aria-label', `Squeekchain live: ${STATE_TEXT[d.view]}${d.building !== null ? `, building block ${d.building} at ${d.percent} percent` : ''}. Open details.`);
  };

  const row = (k: string, v: string) => {
    const r = document.createElement('div');
    r.className = 'chain-pop__row';
    const a = document.createElement('span');
    a.textContent = k;
    const b = document.createElement('b');
    b.textContent = v;
    r.append(a, b);
    return r;
  };

  const renderPop = () => {
    if (pop.hidden) return;
    pop.replaceChildren();
    const l = cur.live;
    const kicker = document.createElement('span');
    kicker.className = 'hut-pop__rarity';
    kicker.textContent = 'Live on Sepolia';
    const title = document.createElement('h4');
    title.textContent = 'Squeekchain';
    const rows = document.createElement('div');
    rows.className = 'chain-pop__rows';
    rows.append(row('Real wheel', WHEEL_TEXT[d.view]));
    if (d.building !== null) {
      rows.append(row('Building', d.view === 'pending' ? `${fmt.format(d.pendingBlocks)} blocks on the way` : `Block ${fmt.format(d.building)} · ${d.percent} percent`));
    }
    const last = l?.lastStorm;
    if (last) {
      const when = ago(cur.serverNow() - parseTime(last.at));
      rows.append(row('Last landing', `${fmt.format(last.blocks)} ${last.blocks === 1 ? 'block' : 'blocks'} · ${when}`));
    }
    const text = document.createElement('p');
    text.className = 'hut-pop__flavor';
    text.textContent = 'This cloud is filled by the real hamster on Squeekchain. When its blocks land on Sepolia, lightning strikes here for everyone on the site.';
    const bounty = document.createElement('p');
    bounty.className = 'chain-pop__bounty';
    const bo = l?.bounty;
    if (bo?.enabled) {
      bounty.textContent = `Block Bounty: when real blocks land, every signed-in player whose hamster is running at that moment gets ${bo.perBlock} stars per real block (${bo.min} to ${bo.max}). A resting hamster gets nothing.`;
    } else bounty.textContent = 'Block Bounty: stars for every running hamster when real blocks land. Starting soon.';
    pop.append(kicker, title, rows, text, bounty);
    const url = last ? sepoliaTxUrl(last.tx) : null;
    if (url) {
      const a = document.createElement('a');
      a.className = 'hut-pop__btn chain-pop__link';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'View on Sepolia';
      pop.append(a);
    }
    placePop();
  };

  const setOpen = (open: boolean) => {
    pop.hidden = !open;
    tag.setAttribute('aria-expanded', String(open));
    if (open) renderPop();
  };
  tag.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(pop.hidden !== false);
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    if (!pop.hidden) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) setOpen(false);
  });

  // ---------------------------------------------------------------- hava: gerçek çarka bağlı
  let weatherOwned = false;
  const applyWeather = () => {
    if (!opts.controlWeather) return;
    const l = cur.live;
    const ok = cur.health === 'ok' && l?.wheel.fresh && l.wheel.hardware;
    const mode = ok && l.wheel.status === 'ACTIVE' ? 'sunny' : ok && l.wheel.status === 'IDLE' ? 'cloudy' : null;
    if (mode) {
      bg.setAutoCycle(false);
      if (bg.mode !== mode || !weatherOwned) bg.setWeather(mode);
      weatherOwned = true;
    } else if (weatherOwned) {
      // Veri yok / arıza: eski otomatik hava döngüsüne dönülür
      weatherOwned = false;
      bg.setAutoCycle(true);
    }
  };

  const applyCloud = () => {
    const live = d.view !== 'loading' && d.view !== 'delayed';
    bg.setRealChain({ fill: d.percent / 100, pending: d.view === 'pending', live, active: d.view === 'active' });
  };

  feed.onUpdate((s) => {
    cur = s;
    d = derive(s);
    applyCloud();
    renderTag();
    renderPop();
    applyWeather();
  });

  // ---------------------------------------------------------------- afiş
  const showBanner = (parts: { title: string; sub?: string; url?: string | null; reward?: Node | null }, ms = 9000) => {
    banner.replaceChildren();
    const t = document.createElement('b');
    t.className = 'storm-banner__title';
    t.textContent = parts.title;
    banner.append(t);
    if (parts.sub || parts.url) {
      const sub = document.createElement('span');
      sub.className = 'storm-banner__sub';
      if (parts.sub) sub.append(document.createTextNode(parts.sub));
      if (parts.url) {
        if (parts.sub) sub.append(document.createTextNode(' · '));
        const a = document.createElement('a');
        a.href = parts.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'View on Sepolia';
        sub.append(a);
      }
      banner.append(sub);
    }
    const reward = document.createElement('span');
    reward.className = 'storm-banner__reward';
    if (parts.reward) reward.append(parts.reward);
    banner.append(reward);
    banner.hidden = false;
    banner.classList.remove('is-in');
    void banner.offsetWidth;
    banner.classList.add('is-in');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      banner.hidden = true;
    }, ms);
  };
  const setReward = (node: Node) => {
    const r = banner.querySelector('.storm-banner__reward');
    if (!r || banner.hidden) return;
    r.replaceChildren(node);
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      banner.hidden = true;
    }, 9000);
  };
  const starLine = (text: string) => {
    const frag = document.createDocumentFragment();
    frag.append(Object.assign(document.createElement('i'), { className: 'hut-tag__coin' }), document.createTextNode(text));
    return frag;
  };
  const signInLine = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'storm-banner__signin';
    b.textContent = 'Sign in with X to earn the Block Bounty';
    b.addEventListener('click', () => signIn());
    return b;
  };

  // ---------------------------------------------------------------- Block Bounty
  // Kural (sunucuda doğrulanır): ödül YALNIZCA gerçek blok indiği anda hamsteri koşan oyuncuya yazılır.
  // Koşmuyorsa (ya da misafirse) yıldızlar yine buluttan dökülür ama sayaca uçmaz ve kaydedilmez.
  const hamsterRunning = () => bg.hamsterRunning && bg.hamsterState === 'run';
  const notRunningLine = () =>
    document.createTextNode(ledger.capped ? 'Daily limit reached, these stars were not saved' : 'Your hamster was resting, these stars were not saved');

  const claim = async (storm: ChainStorm): Promise<void> => {
    // Bekleyen bloklar önce gönderilir: sunucudaki "son saniyelerde blok kazandı" kanıtı taze olsun
    await ledger.flush();
    let res = await source.claimStormBounty(storm.id).catch(() => null);
    // Koşuya yeni başladıysa ilk blok henüz tamamlanmamış olabilir: bir kez daha dener
    if (res?.status === 'not_running' && hamsterRunning() && !ledger.capped) {
      await new Promise((r) => window.setTimeout(r, 4000));
      await ledger.flush();
      res = await source.claimStormBounty(storm.id).catch(() => null);
    }
    if (res?.status === 'granted' && res.bounty > 0) {
      bg.spillRealCoins(res.bounty);
      if (res.balance !== null) ledger.setServerBalance(res.balance);
      setReward(starLine(`+${fmt.format(res.bounty)} Block Bounty`));
      void ledger.syncBalance();
      return;
    }
    if (res?.status === 'already') {
      setReward(document.createTextNode('Block Bounty already collected'));
      return;
    }
    // Kayıt yok: yıldızlar düşer. Mesaj sebebe göre
    bg.dropRealStars(storm.bounty);
    const why =
      res === null
        ? 'Could not reach the server, these stars were not saved'
        : res.status === 'expired'
          ? 'This landing is over, these stars were not saved'
          : res.status === 'unavailable'
            ? 'No Block Bounty for this landing'
            : null;
    setReward(why ? document.createTextNode(why) : notRunningLine());
  };

  feed.onStorm((storm: ChainStorm, fresh: boolean) => {
    // Birkaç dakikadan eski iniş (sekme arka plandaydı): "şimdi oldu" gibi gösterilmez, ödül de yok
    if (!fresh) return;
    bg.realStorm(storm.blocks);
    const url = sepoliaTxUrl(storm.tx);
    const range = storm.blocks === 1 ? `Block ${fmt.format(storm.last)}` : `Blocks ${fmt.format(storm.first)} to ${fmt.format(storm.last)}`;
    showBanner({ title: `${fmt.format(storm.blocks)} real ${storm.blocks === 1 ? 'block' : 'blocks'} landed`, sub: range, url });
    if (!cur.live?.bounty.enabled || storm.bounty <= 0) return;
    // Karar fırtına anındaki duruma göre: o an koşmuyorsa sonradan koşmaya başlamak ödül getirmez
    const runningNow = ledger.signedIn && !ledger.capped && hamsterRunning();
    window.setTimeout(() => {
      if (runningNow) {
        void claim(storm);
        return;
      }
      bg.dropRealStars(storm.bounty);
      setReward(ledger.signedIn ? notRunningLine() : signInLine());
    }, 700);
  });

  bg.events.on('scene:resize', place);
  window.addEventListener('resize', place);
  // Bulutlar hafifçe sallanır; etiket sabit kalsın diye sadece yerleşim değişince güncellenir
  place();
  applyCloud();
  renderTag();
}
