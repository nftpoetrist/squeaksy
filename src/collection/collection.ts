import './collection.css';
import { friendlyError } from '../auth/inventory';
import { cardArt, mysteryArt } from './art';
import { CARDS, RARITIES, SET_NAME, SET_SIZE, STARTER_HAMSTER, STARTER_OWNED, type CardDef, type Rarity } from './cards';

/** Koleksiyonun ihtiyaç duyduğu envanter bilgisi */
export interface CollectionSource {
  isOwned(id: string): boolean;
  readonly active: string;
  onChange(fn: () => void): void;
  /** Eşya tak/çıkar (verilmezse eşya butonları gösterilmez) */
  isEquipped?(id: string): boolean;
  toggleItem?(id: string): Promise<void>;
  /** Koşan hamsteri değiştir (verilmezse hamster butonları gösterilmez) */
  equip?(id: string): Promise<void>;
  readonly busy?: boolean;
}

/** Yatay şerit + iki yanda piksel ok butonları (fareyle kaydırmak için) */
export function scroller(row: HTMLElement): HTMLElement {
  const wrap = el('div', 'collection__scroller');
  const prev = el('button', 'scroll-btn scroll-btn--prev', '‹');
  const next = el('button', 'scroll-btn scroll-btn--next', '›');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Scroll cards left');
  next.setAttribute('aria-label', 'Scroll cards right');
  const step = () => Math.max(268, Math.floor(row.clientWidth / 268) * 268 - 268);
  prev.onclick = () => row.scrollBy({ left: -step(), behavior: 'smooth' });
  next.onclick = () => row.scrollBy({ left: step(), behavior: 'smooth' });
  const sync = () => {
    const max = row.scrollWidth - row.clientWidth - 2;
    prev.disabled = row.scrollLeft <= 2;
    next.disabled = row.scrollLeft >= max;
    wrap.classList.toggle('is-scrollable', max > 0);
  };
  row.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(row);
  requestAnimationFrame(sync);
  wrap.append(prev, row, next);
  return wrap;
}

/** Eşya butonunun son sonucu (hata mesajı vb.) */
const itemStatus = new Map<string, string>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Piksel sanatı tam sayı katında büyütülür (pikseller eşit kalır) */
const ART_SCALE = { hamster: 3, sky: 3, inferno: 3, seraph: 3, pixsy: 4, 'pixsy-eth': 4, 'pixsy-btc': 4, mystery: 7 } as const;

function artCanvas(src: HTMLCanvasElement, cls: string, scale: number): HTMLCanvasElement {
  const c = el('canvas', cls);
  c.width = src.width;
  c.height = src.height;
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** Nadirlik taşı: common yuvarlak, rare elmas, legendary yıldız, mythic dört köşeli inci ışık */
function gem(rarity: Rarity): HTMLElement {
  const g = el('span', `gem gem--${rarity}`);
  g.setAttribute('aria-hidden', 'true');
  return g;
}

function pips(value: number): HTMLElement {
  const wrap = el('span', 'card__pips');
  for (let i = 0; i < 5; i++) wrap.append(el('i', i < value ? 'on' : ''));
  return wrap;
}

/** Tek kart. `locked` = henüz keşfedilmemiş (sadece nadirlik çerçevesi görünür) */
export function renderCard(
  def: CardDef | null,
  rarity: Rarity,
  opts: {
    locked?: boolean;
    count?: number;
    forSale?: boolean;
    running?: boolean;
    wearing?: boolean;
    /** Sınırlı arz rozeti (sadece Market'te gösterilir) */
    limited?: boolean;
    /** "Yakında" kartı: tür etiketi + merak uyandıran metin */
    soon?: { kind: string; title: string; text: string };
  } = {},
): HTMLElement {
  const locked = opts.locked || !def;
  const card = el('article', `card card--${rarity}${locked ? ' card--locked' : ''}${opts.forSale ? ' card--for-sale' : ''}${opts.soon ? ' card--soon' : ''}`);
  card.tabIndex = 0;
  card.setAttribute('aria-label', locked ? `Locked ${RARITIES[rarity].label} card` : `${def!.name}, ${RARITIES[rarity].label} ${def!.kind}`);

  const inner = el('div', 'card__inner');
  const frame = el('div', 'card__frame');

  // Üst: isim + güç
  const head = el('header', 'card__head');
  const title = el('div', 'card__title');
  title.append(
    el('span', 'card__kind', opts.soon ? opts.soon.kind : locked ? '???' : `${def!.kind} · ${def!.type}`),
    el('h3', 'card__name', opts.soon ? opts.soon.title : locked ? 'Undiscovered' : def!.name),
  );
  const power = el('div', 'card__power');
  // "/BLK" gibi birimler değerin arkasına yazılır
  if (!locked && def!.power.label.startsWith('/')) power.append(el('b', '', def!.power.value), el('small', '', def!.power.label));
  else if (!locked) power.append(el('small', '', def!.power.label), el('b', '', def!.power.value));
  else power.append(el('b', '', '?'));
  head.append(title, power);

  // Görsel penceresi
  const art = el('div', `card__art card__art--${def?.art ?? 'mystery'}`);
  art.append(el('span', 'card__art-bg'));
  art.append(
    locked ? artCanvas(mysteryArt(), 'card__sprite', ART_SCALE.mystery) : artCanvas(cardArt(def!.art), 'card__sprite', ART_SCALE[def!.art]),
  );
  if (!locked && opts.running) art.append(el('span', 'card__count card__count--running', 'Running'));
  else if (!locked && opts.wearing) art.append(el('span', 'card__count card__count--running', 'Wearing'));
  else if (!locked && opts.count) art.append(el('span', 'card__count', `×${opts.count}`));
  if (!locked && opts.limited && def?.maxSupply) art.append(el('span', 'card__limited', `Limited · ${def.maxSupply.toLocaleString('en-US')}`));
  if (opts.forSale && def?.price) {
    const lock = el('span', 'card__lock');
    lock.append(el('b', '', 'Locked'), el('span', '', `${def.price.toLocaleString('en-US')} stars · at the hut`));
    art.append(lock);
  }

  // Gövde: yetenekler + istatistikler
  const body = el('div', 'card__body');
  if (locked) {
    if (opts.soon) {
      const t = el('div', 'card__soon');
      t.append(el('b', '', 'Coming soon'), el('p', '', opts.soon.text));
      body.append(t);
    } else body.append(el('p', 'card__locked-text', 'Not discovered yet'));
  } else {
    for (const a of def!.abilities) {
      const ab = el('div', 'card__ability');
      ab.append(el('b', '', a.name), el('p', '', a.text.replace('{perBlock}', String(RARITIES[rarity].tokensPerBlock))));
      body.append(ab);
    }
    const stats = el('div', 'card__stats');
    for (const s of def!.stats) {
      const row = el('div', 'card__stat');
      row.append(el('span', '', s.label), pips(s.value));
      stats.append(row);
    }
    body.append(stats);
    body.append(el('p', 'card__flavor', def!.flavor));
  }

  // Alt: nadirlik + set numarası
  const foot = el('footer', 'card__foot');
  const rar = el('span', 'card__rarity');
  // "Yakında" kartında nadirlik henüz gizli
  if (opts.soon) rar.append(el('span', 'gem gem--soon'), document.createTextNode('???'));
  else rar.append(gem(rarity), document.createTextNode(RARITIES[rarity].label));
  foot.append(rar, el('span', 'card__no', locked ? `${SET_NAME} · ???` : `${SET_NAME} · ${String(def!.no).padStart(3, '0')}/${SET_SIZE}`));

  frame.append(head, art, body, foot);
  inner.append(frame, el('span', 'card__foil'), el('span', 'card__glare'));
  if (rarity === 'legendary' || rarity === 'mythic') {
    const sp = el('span', 'card__sparkles');
    for (let i = 0; i < 9; i++) sp.append(el('i'));
    inner.append(sp);
  }
  card.append(inner);
  if (rarity !== 'common') bindTilt(card, rarity === 'mythic' ? 16 : rarity === 'legendary' ? 14 : 10);
  else bindTilt(card, 0);
  return card;
}

/** Fareyle 3B eğilme + parlama noktası (common: sadece hafif kalkma, parlama yok) */
function bindTilt(card: HTMLElement, maxDeg: number): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  card.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      card.classList.add('is-active');
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--hyp', Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2).toFixed(3));
      if (!reduced && maxDeg) {
        card.style.setProperty('--rx', `${((0.5 - y) * maxDeg).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((x - 0.5) * maxDeg).toFixed(2)}deg`);
      }
    });
  });
  card.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    card.classList.remove('is-active');
    for (const p of ['--mx', '--my', '--hyp', '--rx', '--ry']) card.style.removeProperty(p);
  });
}

/** Koleksiyon bölümü: sahip olunan kartlar + keşfedilmemiş nadirlik yuvaları */
export function mountCollection(section: HTMLElement, opts: { preview?: boolean; source?: CollectionSource } = {}): void {
  const render = (): void => renderCollection(section, opts, render);
  opts.source?.onChange(render);
  render();
}

function renderCollection(section: HTMLElement, opts: { preview?: boolean; source?: CollectionSource }, render: () => void): void {
  section.classList.add('collection');
  section.replaceChildren();
  const panel = el('div', 'panel collection__panel collection__panel--silver');
  section.append(panel);
  const isOwned = (id: string) => (opts.source ? opts.source.isOwned(id) : STARTER_OWNED.includes(id));
  const active = opts.source?.active ?? STARTER_HAMSTER;

  const head = el('div', 'collection__head');
  const titles = el('div');
  // Önce hamsterler, sonra eşyalar (Pixsy); her grupta Common → Rare → Legendary
  const owned = CARDS.filter((c) => isOwned(c.id)).sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'Hamster' ? -1 : 1) || RARITIES[a.rarity].order - RARITIES[b.rarity].order || a.no - b.no,
  );
  titles.append(el('h2', 'collection__title', 'My Collection'), el('p', 'collection__sub', `${owned.length} cards owned · ${SET_NAME} set`));
  const legend = el('ul', 'collection__legend');
  legend.setAttribute('aria-label', 'Rarity tiers');
  for (const r of Object.keys(RARITIES) as Rarity[]) {
    const li = el('li', `legend legend--${r}`);
    li.append(gem(r), document.createTextNode(RARITIES[r].label));
    legend.append(li);
  }
  head.append(titles, legend);

  // Tek sıra, sağa kayan şerit: önce hamsterler, sonra Pixsy'ler (owned zaten bu sırada)
  const grid = el('div', 'collection__grid collection__grid--row');
  // Sadece sahip olunan kartlar (satılık hamsterler "Hamsters" bölümünde)
  const src = opts.source;
  for (const c of owned) {
    const wearing = c.kind === 'Item' && !!src?.isEquipped?.(c.id);
    const card = renderCard(c, c.rarity, { count: 1, running: c.id === active, wearing });
    // Hamster: "Run with" (sarı) / "Running" (beyazımsı); değişim oyunda animasyonla görünür
    if (c.kind === 'Hamster' && src?.equip) {
      const running = c.id === active;
      const slot = el('div', 'shop__slot');
      const row = el('div', 'shop__row shop__row--buy');
      if (running) {
        const st = el('div', 'shop__buy shop__buy--owned is-running');
        st.setAttribute('role', 'status');
        st.append(el('i', 'shop__check'), el('span', '', 'Running'));
        row.append(st);
      } else {
        const btn = el('button', 'shop__buy shop__buy--wear');
        btn.type = 'button';
        btn.append(el('i', 'shop__play'), el('span', '', `Run with ${c.name}`));
        btn.disabled = !!src.busy;
        btn.onclick = async () => {
          itemStatus.delete(c.id);
          try {
            await src.equip!(c.id);
          } catch (err) {
            itemStatus.set(c.id, friendlyError(err));
            render();
          }
        };
        row.append(btn);
      }
      const msg = el('p', 'shop__msg', itemStatus.get(c.id) ?? (running ? 'On the wheel now' : 'Resting in the hut'));
      slot.append(card, row, msg);
      grid.append(slot);
      continue;
    }
    if (c.kind !== 'Item' || !c.slot || !src?.toggleItem) {
      grid.append(card);
      continue;
    }
    // Eşya: tak / çıkar butonu (Buy / Owned butonlarıyla aynı biçim)
    const slot = el('div', 'shop__slot');
    const row = el('div', 'shop__row shop__row--buy');
    const btn = el('button', wearing ? 'shop__buy shop__buy--owned' : 'shop__buy shop__buy--wear');
    btn.type = 'button';
    btn.append(el('i', wearing ? 'shop__check' : 'shop__plus'), el('span', '', wearing ? `Wearing · Take off` : `Put on ${c.name}`));
    btn.disabled = !!src.busy;
    btn.onclick = async () => {
      itemStatus.delete(c.id);
      try {
        await src.toggleItem!(c.id);
      } catch (err) {
        itemStatus.set(c.id, friendlyError(err));
        render();
      }
    };
    row.append(btn);
    const msg = el('p', 'shop__msg', itemStatus.get(c.id) ?? (wearing ? `On your hamster's ${c.slot}` : 'Not worn'));
    slot.append(card, row, msg);
    grid.append(slot);
  }
  panel.append(head, scroller(grid));

  if (opts.preview) {
    // Geliştirici önizlemesi (?dev&cards=preview): aynı kartların üç nadirlikte görünümü
    const ph = el('div', 'collection__head');
    ph.append(el('h2', 'collection__title collection__title--small', 'Rarity preview (dev)'));
    const pg = el('div', 'collection__grid');
    for (const r of ['common', 'rare', 'legendary'] as Rarity[]) for (const c of CARDS) pg.append(renderCard(c, r));
    panel.append(ph, pg);
  }
}
