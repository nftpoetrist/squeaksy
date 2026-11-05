import type { AuthBackend, LeaderKind, LeaderPage, LeaderRow } from '../auth/types';
import { DEFAULT_POSE, drawHamsterPose, type HamsterVariant } from '../character/hamsterBase';
import type { PixsyKind } from '../character/companion';
import { cardArt } from '../collection/art';
import { cardById, RARITIES } from '../collection/cards';
import { medalIcon, pixelIcon } from './pixelIcons';
import './leaderboard.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt = new Intl.NumberFormat('en-US');
const PAGE_SIZE = 8;

/* ------------------------------------------------------------------ Kürsü sahnesi (piksel) */
/** 5×7 piksel rakam (kürsüdeki "1") */
const DIGIT_1 = ['.11.', '111.', '.11.', '.11.', '.11.', '.11.', '1111'];

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Buz blok: üst yüz + ön yüz + koyu kenar + parıltı */
function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  px(ctx, '#1559d4', x - 1, y - 1, w + 2, h + 2);
  px(ctx, '#bfe6ff', x, y + 4, w, h - 4);
  px(ctx, '#eaf8ff', x, y, w, 4);
  px(ctx, '#ffffff', x + 1, y, w - 2, 1);
  px(ctx, '#8cc4ee', x, y + h - 3, w, 3);
  px(ctx, '#d9f3ff', x + 2, y + 6, 2, h - 11);
  // Çatlak/buz dokusu
  px(ctx, '#9fd2f3', x + Math.floor(w * 0.6), y + 8, 1, 4);
  px(ctx, '#9fd2f3', x + Math.floor(w * 0.6) + 1, y + 12, 1, 2);
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  px(ctx, color, x, y - s, 1, s * 2 + 1);
  px(ctx, color, x - s, y, s * 2 + 1, 1);
  px(ctx, '#ffffff', x, y, 1, 1);
}

/**
 * Sağ üstteki kürsü: 1 numaralı bloğun üstünde Squeaksy, solda altın kupa, sağda bayrak.
 * Parıltılar sırayla göz kırpar, hamster hafifçe zıplar (bölüm ekrandayken, saniyede 8 kare).
 */
function podium(): { canvas: HTMLCanvasElement; tick: (t: number) => void } {
  const W = 120;
  const H = 82;
  const S = 4;
  const canvas = el('canvas', 'lb__podium');
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W * S}px`;
  canvas.style.height = `${H * S}px`;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d')!;
  const hamster = drawHamsterPose({ ...DEFAULT_POSE, companion: true }, 'starter').img;
  const trophy = pixelIcon('trophy', 1);
  const t2 = drawHamsterPose({ ...DEFAULT_POSE, eyes: 'spark' as const }, 'starter').img;

  const tick = (t: number) => {
    ctx.clearRect(0, 0, W, H);
    // Kürsü blokları: 2 (sol), 1 (orta, yüksek), 3 (sağ)
    block(ctx, 14, 58, 26, 22);
    block(ctx, 41, 46, 34, 34);
    block(ctx, 76, 62, 26, 18);
    // "1"
    DIGIT_1.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '1') continue;
        px(ctx, '#0f2a6b', 54 + x * 2 - 1, 57 + y * 2 - 1, 3, 3);
      }
    });
    DIGIT_1.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '1') px(ctx, y < 2 ? '#fff1a8' : '#ffc93c', 54 + x * 2, 57 + y * 2, 2, 2);
    });
    // Kupa: sol blokta (büyütülmüş piksel ikon)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(trophy, 18, 36, trophy.width * 2, trophy.height * 2);
    // Bayrak: sağ blokta
    px(ctx, '#0f2a6b', 92, 30, 2, 32);
    px(ctx, '#ffffff', 92, 29, 2, 2);
    const wave = Math.sin(t * 3) > 0 ? 0 : 1;
    px(ctx, '#0f2a6b', 94, 31 + wave, 17, 12);
    px(ctx, '#2c8ff4', 95, 32 + wave, 15, 10);
    px(ctx, '#62b8ff', 95, 32 + wave, 15, 2);
    // Bayraktaki yıldız
    px(ctx, '#fff1a8', 101, 34 + wave, 1, 5);
    px(ctx, '#fff1a8', 99, 36 + wave, 5, 1);
    // Squeaksy: 1. bloğun üstünde, ara sıra zıplar
    const hop = (t * 0.7) % 1 < 0.12 ? -2 : 0;
    const img = (t * 0.7) % 1 < 0.12 ? t2 : hamster;
    ctx.drawImage(img, 41 + Math.round((34 - img.width) / 2), 46 - img.height + 3 + hop);
    // Parıltılar
    const sp: Array<[number, number, number, string, number]> = [
      [12, 22, 2, '#9fe0ff', 0],
      [30, 14, 1, '#ffffff', 0.3],
      [86, 12, 2, '#fff1a8', 0.55],
      [112, 26, 1, '#9fe0ff', 0.8],
      [64, 8, 1, '#fff1a8', 0.15],
    ];
    for (const [x, y, s, c, off] of sp) if (Math.sin((t * 1.2 + off) * Math.PI * 2) > -0.2) sparkle(ctx, x, y, s, c);
    // Buzlu çimen tutamları
    for (const [x, h] of [[10, 4], [13, 6], [16, 3], [104, 5], [107, 7], [110, 4]] as const) {
      px(ctx, '#3ad6d0', x, 80 - h, 2, h);
      px(ctx, '#8af5cf', x, 80 - h, 1, h - 1);
    }
  };
  return { canvas, tick };
}

/* ------------------------------------------------------------------ Satırlar */
function variantOf(id: string): HamsterVariant {
  return cardById(id)?.variant ?? 'starter';
}

/** Avatar: X fotoğrafı varsa o, yoksa oyuncunun koşan hamsteri (piksel) */
function avatar(row: LeaderRow, size: number): HTMLElement {
  const wrap = el('span', 'lb__avatar');
  wrap.style.width = wrap.style.height = `${size}px`;
  if (row.avatarUrl) {
    const img = el('img');
    img.src = row.avatarUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    wrap.append(img);
  } else {
    const def = cardById(row.hamster);
    const art = cardArt(def?.art ?? 'hamster');
    const c = el('canvas', 'lb__avatar-art');
    c.width = art.width;
    c.height = art.height;
    c.getContext('2d')!.drawImage(art, 0, 0);
    wrap.append(c);
  }
  return wrap;
}

function rankCell(rank: number): HTMLElement {
  const cell = el('div', 'lb__rank');
  if (rank >= 1 && rank <= 3) {
    cell.append(medalIcon(rank as 1 | 2 | 3, 3), el('b', 'lb__medal-num', String(rank)));
    cell.classList.add('lb__rank--medal');
  } else {
    // 0 = sıra henüz bilinmiyor (tam sıralama açılmadan önce)
    cell.append(el('b', 'lb__rank-num', rank > 0 ? fmt.format(rank) : '—'));
  }
  return cell;
}

function hamsterCell(id: string): HTMLElement {
  const def = cardById(id);
  const r = def?.rarity ?? 'common';
  const cell = el('div', `lb__cell lb__hamster lb__hamster--${r}`);
  cell.append(el('span', `gem gem--${r}`), el('span', '', def?.name ?? 'Squeaksy'));
  cell.title = `${RARITIES[r].label} · +${RARITIES[r].tokensPerBlock} stars per block`;
  return cell;
}

function rowEl(row: LeaderRow, isMe: boolean): HTMLElement {
  const top = row.rank >= 1 && row.rank <= 3;
  const li = el('li', `lb__row${top ? ` lb__row--top lb__row--${row.rank}` : ''}${isMe ? ' is-me' : ''}`);
  const player = el('div', 'lb__player');
  const names = el('div', 'lb__names');
  names.append(el('b', 'lb__handle', `@${row.handle}`), el('span', 'lb__tagline', `Runs with ${cardById(row.hamster)?.name ?? 'Squeaksy'}`));
  player.append(avatar(row, top ? 56 : 40), names);
  const stars = el('div', 'lb__cell lb__stars');
  stars.append(pixelIcon('star', 2), el('b', '', fmt.format(row.stars)));
  const cards = el('div', 'lb__cell lb__cards');
  cards.append(pixelIcon('card', 2), el('b', '', fmt.format(row.cards)));
  li.append(rankCell(row.rank), player, stars, cards, hamsterCell(row.hamster));
  if (row.rank === 1) {
    // Birinci satırda iki küçük parıltı
    li.append(el('i', 'lb__spark lb__spark--a'), el('i', 'lb__spark lb__spark--b'));
  }
  return li;
}

/* ------------------------------------------------------------------ Bölüm */
/**
 * Leaderboard: Overall (toplam yıldız) ve Top Collectors (kart sayısı).
 * Veri sunucudaki `leaderboard` fonksiyonundan gelir; yoksa (henüz kurulmadıysa) sakin bir boş durum gösterilir.
 */
export interface LeaderboardMine {
  /** Oyuncunun sırtında takılı Pixsy (yoksa null): "Your Rank" kartındaki hamsterde görünür */
  buddy: () => PixsyKind | null;
}

export function mountLeaderboard(section: HTMLElement, backend: AuthBackend, signIn: () => void, mineSrc?: LeaderboardMine): { refreshMine: () => void } {
  section.classList.add('lb');
  section.replaceChildren();

  // --- Başlık + kürsü
  const head = el('div', 'lb__head');
  const copy = el('div', 'lb__copy');
  const badge = el('span', 'lb__badge');
  badge.append(pixelIcon('trophy', 2), el('span', '', 'Top Hamsters'));
  const title = el('h2', 'lb__title');
  title.append(el('span', 'lb__title-a', 'Leader'), el('span', 'lb__title-b', 'board'));
  copy.append(badge, title, el('p', 'lb__sub', 'See the top players, earn more stars and climb the ranks!'));
  const pod = podium();
  head.append(copy, pod.canvas);

  // --- Sekmeler
  const tabs = el('div', 'lb__tabs');
  tabs.setAttribute('role', 'tablist');
  const mkTab = (kind: LeaderKind, label: string, icon: 'trophy' | 'gem') => {
    const b = el('button', 'lb__tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.kind = kind;
    b.append(pixelIcon(icon, 2), el('span', '', label));
    b.onclick = () => {
      if (state.kind === kind) return;
      state.kind = kind;
      state.page = 1;
      void load();
    };
    return b;
  };
  const tabStars = mkTab('stars', 'Overall', 'trophy');
  const tabCards = mkTab('cards', 'Top Collectors', 'gem');
  tabs.append(tabStars, tabCards);

  // --- Tablo + Your Rank
  const body = el('div', 'lb__body');
  const board = el('div', 'lb__board');
  const thead = el('div', 'lb__thead');
  const th = (label: string, icon?: 'star' | 'card' | 'gem') => {
    const c = el('div', 'lb__th');
    if (icon) c.append(pixelIcon(icon, 2));
    c.append(el('span', '', label));
    return c;
  };
  thead.append(th('#'), th('Player'), th('Stars', 'star'), th('Cards', 'card'), th('Hamster', 'gem'));
  const list = el('ol', 'lb__list');
  board.append(thead, list);

  const mine = el('aside', 'lb__mine');
  body.append(board, mine);

  const pager = el('nav', 'lb__pager');
  pager.setAttribute('aria-label', 'Leaderboard pages');

  section.append(head, tabs, body, pager);

  const state: { kind: LeaderKind; page: number; data: LeaderPage | null; error: boolean } = { kind: 'stars', page: 1, data: null, error: false };

  const renderMine = () => {
    mine.replaceChildren();
    const h = el('h3', 'lb__mine-title');
    h.append(pixelIcon('trophy', 2), el('span', '', 'Your Rank'));
    const me = state.data?.me ?? null;
    const variant = me ? variantOf(me.hamster) : 'starter';
    // Giriş yapan oyuncu: oyundaki gibi sırtındaki Pixsy ile (takılı değilse Pixsy'siz); misafir: varsayılan
    const buddy = me && mineSrc ? mineSrc.buddy() : 'pixsy';
    const art = drawHamsterPose({ ...DEFAULT_POSE, companion: buddy !== null, eyes: me ? 'spark' : 'open' }, variant, buddy ?? 'pixsy').img;
    const c = el('canvas', 'lb__mine-art');
    c.width = art.width;
    c.height = art.height;
    c.style.width = `${art.width * 3}px`;
    c.style.height = `${art.height * 3}px`;
    c.getContext('2d')!.drawImage(art, 0, 0);
    const btn = el('a', 'lb__cta');
    mine.append(h);
    if (me?.avatarUrl) {
      // Oyuncunun kendi X fotoğrafı; yanında koşan hamsteri
      const who = el('div', 'lb__mine-who');
      const av = avatar(me, 84);
      av.classList.add('lb__avatar--mine');
      c.classList.add('lb__mine-art--small');
      c.style.width = `${art.width * 2}px`;
      c.style.height = `${art.height * 2}px`;
      who.append(av, c);
      mine.append(who, el('span', 'lb__mine-handle', `@${me.handle}`));
    } else {
      mine.append(c);
      if (me) mine.append(el('span', 'lb__mine-handle', `@${me.handle}`));
    }
    if (me) {
      mine.append(el('b', 'lb__mine-rank', me.rank > 0 ? `#${fmt.format(me.rank)}` : '#—'));
      const st = el('div', 'lb__mine-stars');
      st.append(pixelIcon('star', 2), el('span', '', `${fmt.format(me.stars)} Stars`));
      mine.append(st);
      btn.href = '#play';
      btn.append(el('i', 'lb__cta-play'), el('span', '', 'Keep Playing!'));
    } else {
      mine.append(el('b', 'lb__mine-rank lb__mine-rank--none', '#?'), el('p', 'lb__mine-note', 'Sign in with X to join the ranks'));
      btn.href = '#play';
      btn.append(el('i', 'lb__cta-play'), el('span', '', 'Sign in'));
      btn.onclick = (e) => {
        e.preventDefault();
        signIn();
      };
    }
    mine.append(btn);
  };

  const renderPager = () => {
    pager.replaceChildren();
    const total = state.data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return;
    const go = (p: number) => {
      state.page = Math.min(pages, Math.max(1, p));
      void load();
    };
    const from = Math.max(1, Math.min(state.page - 2, pages - 4));
    for (let p = from; p <= Math.min(pages, from + 4); p++) {
      const b = el('button', `lb__page${p === state.page ? ' is-on' : ''}`, String(p));
      b.type = 'button';
      b.setAttribute('aria-current', String(p === state.page));
      b.onclick = () => go(p);
      pager.append(b);
    }
    const next = el('button', 'lb__page lb__page--next');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next page');
    next.disabled = state.page >= pages;
    next.append(el('i', 'lb__chev'));
    next.onclick = () => go(state.page + 1);
    pager.append(next);
  };

  const render = () => {
    tabStars.classList.toggle('is-on', state.kind === 'stars');
    tabCards.classList.toggle('is-on', state.kind === 'cards');
    tabStars.setAttribute('aria-selected', String(state.kind === 'stars'));
    tabCards.setAttribute('aria-selected', String(state.kind === 'cards'));
    list.replaceChildren();
    const rows = state.data?.rows ?? [];
    const me = state.data?.me ?? null;
    if (state.data?.partial) {
      // Tam sıralama henüz açık değil: oyuncu kendi satırını hemen görür
      const note = el('li', 'lb__empty lb__empty--note');
      note.append(el('b', '', 'Full ranking opens soon'), el('span', '', 'Your stars already count. Here is where you stand so far.'));
      list.append(note);
    } else if (!rows.length) {
      const empty = el('li', 'lb__empty');
      empty.append(
        el('b', '', state.error ? 'The leaderboard opens soon' : 'Loading the ranks…'),
        el('span', '', state.error ? 'Keep spinning: your stars will count from day one.' : ''),
      );
      list.append(empty);
    }
    const meHandle = me?.handle;
    rows.forEach((r, i) => {
      list.append(rowEl(r, r.handle === meHandle));
      if (r.rank === 3 && rows[i + 1]) list.append(el('li', 'lb__divider'));
    });
    // Giriş yapan oyuncu bu sayfada değilse: kendi satırı tablonun altına sabitlenir
    if (me && !rows.some((r) => r.handle === me.handle)) {
      if (rows.length) list.append(el('li', 'lb__divider'));
      const mineRow = rowEl(me, true);
      mineRow.classList.add('lb__row--pinned');
      list.append(mineRow);
    }
    renderMine();
    renderPager();
  };

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    render();
    try {
      const data = await backend.fetchLeaderboard(state.kind, state.page, PAGE_SIZE);
      if (my !== seq) return;
      state.data = data;
      state.error = false;
    } catch {
      if (my !== seq) return;
      state.data = null;
      state.error = true;
    }
    render();
  };

  backend.onChange(() => void load());

  // Kürsü canlanması ve veri yenileme: sadece bölüm ekrandayken
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  pod.tick(0.5);
  let anim = 0;
  let refresh = 0;
  new IntersectionObserver(([e]) => {
    window.clearInterval(anim);
    window.clearInterval(refresh);
    if (!e?.isIntersecting) return;
    // Sayfa her açıldığında taze veri (ilk açılışta da hemen)
    void load();
    refresh = window.setInterval(() => !document.hidden && void load(), 60_000);
    if (reduced) return;
    anim = window.setInterval(() => {
      if (document.hidden) return;
      t += 1 / 8;
      pod.tick(t);
    }, 1000 / 8);
  }).observe(section);
  render();
  return { refreshMine: renderMine };
}
