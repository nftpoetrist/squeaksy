/**
 * Onchain Market: Claim butonuyla aynı tasarımda Mint butonu ve mint penceresi.
 * Pencerede kartın bilgisi (fiyat, cüzdandaki STARS, kalan arz) ve Mint'e basınca Claim kutusundaki adımlar:
 * Prepare · Wallet · Sepolia, piksel ilerleme çubuğu, cüzdan cevap vermezse Cancel.
 */
import '../page/claim.css';
import './mint.css';
import type { Inventory } from '../auth/inventory';
import type { MintStatus } from '../onchain/mint';
import { drawStar } from '../page/tokenHud';
import { cardArt } from './art';
import { RARITIES, type CardDef } from './cards';

const fmt = new Intl.NumberFormat('en-US');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function starIcon(cls: string): HTMLCanvasElement {
  const c = el('canvas', cls);
  c.setAttribute('aria-hidden', 'true');
  drawStar(c);
  return c;
}

/**
 * Claim tarzı altın buton: [yıldız] MINT · fiyat. ready: parlar (parıltı, kıvılcım, ışık nabzı).
 * dim: sönük ama tıklanabilir (ör. yetersiz STARS: pencere nedenini söyler).
 */
export function mintButton(label: string, price: number | string | null, opts: { ready: boolean; dim?: boolean; disabled?: boolean }): {
  wrap: HTMLElement;
  btn: HTMLButtonElement;
} {
  const wrap = el('div', `claim__wrapbtn mint__wrap${opts.ready ? ' is-ready' : ''}`);
  const glow = el('span', 'claim__glow');
  glow.setAttribute('aria-hidden', 'true');
  const btn = el('button', `claim__btn mint__btn${opts.ready ? ' is-ready' : ''}${opts.dim ? ' is-dim' : ''}`);
  btn.type = 'button';
  btn.disabled = !!opts.disabled;
  const lab = el('span', 'claim__label', label);
  btn.append(starIcon('claim__star mint__star'), lab);
  if (price !== null) btn.append(el('span', 'mint__price', typeof price === 'number' ? fmt.format(price) : price));
  const shine = el('span', 'claim__shine');
  shine.setAttribute('aria-hidden', 'true');
  btn.append(shine);
  for (let i = 0; i < 3; i++) {
    const sp = el('span', `claim__spark claim__spark--${i}`);
    sp.setAttribute('aria-hidden', 'true');
    btn.append(sp);
  }
  wrap.append(glow, btn);
  return { wrap, btn };
}

const STEPS = ['Prepare', 'Wallet', 'Sepolia'] as const;

/** Claim kutusunun aynısı: başlık, 3 adım, çubuk, mesaj, bağlantı / Cancel */
function statusBox(s: MintStatus, cardName: string, onCancel: () => void, gift = false): HTMLElement {
  const box = el('div', `claim__box mint__box is-${s.kind}`);
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  const head = el('div', 'claim__head');
  head.append(starIcon('claim__icon'), el('span', 'claim__title', s.kind === 'busy' ? (gift ? 'Claiming gift' : 'Minting') : s.kind === 'done' ? (gift ? 'Gift claimed' : 'Minted') : (s.title ?? (gift ? 'Not claimed' : 'Not minted'))));
  box.append(head);
  const now = s.kind === 'done' ? 4 : s.step;
  const steps = el('ol', 'claim__steps');
  STEPS.forEach((name, i) => {
    const n = i + 1;
    const li = el('li', 'claim__step', name);
    li.classList.add(n < now ? 'is-done' : n === now ? (s.kind === 'error' ? 'is-fail' : 'is-now') : 'is-todo');
    steps.append(li);
  });
  const bar = el('div', 'claim__bar');
  bar.append(el('i'));
  box.append(steps, bar);
  const row = el('div', 'claim__row');
  const link = (href: string, text: string) => {
    const a = el('a', '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  if (s.kind === 'done') {
    const big = el('p', 'claim__big');
    big.append(starIcon('claim__icon claim__icon--sm'), document.createTextNode(`${cardName} is yours!`));
    box.append(big, el('p', 'claim__msg', 'Soulbound in your wallet. Find it in My Collection.'));
    row.append(link(s.tx, 'View transaction'));
  } else {
    box.append(el('p', 'claim__msg', s.text));
    const href = s.kind === 'busy' ? s.tx : s.link?.href;
    if (href) row.append(link(href, s.kind === 'busy' ? 'View transaction' : (s.link?.label ?? 'View')));
    if (s.kind === 'busy' && s.step < 3) {
      const cancel = el('button', 'claim__cancel', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = onCancel;
      row.append(cancel);
    }
  }
  if (row.childElementCount) box.append(row);
  return box;
}

let closeOpen: (() => void) | null = null;
/** Hediye penceresinden cüzdan bağlamaya gidildi: bağlanınca pencere geri açılır */
let reopenGift: { c: CardDef; inv: Inventory; welcome: boolean } | null = null;
let reopenListening = false;

/** Mint penceresi. gift: early oyuncu hediyesi (STARS yakılmaz) */
export function openMintDialog(c: CardDef, inv: Inventory, gift = false, welcome = false): void {
  closeOpen?.();
  const price = c.price ?? 0;
  const back = el('div', 'px-modal');
  const box = el('div', `px-modal__box px-modal__box--buy px-modal__box--${c.rarity} mint__dialog`);
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'mint-title');

  const head = el('div', 'px-modal__head');
  const src = cardArt(c.art);
  const art = el('canvas', 'px-modal__art');
  art.width = src.width;
  art.height = src.height;
  art.getContext('2d')!.drawImage(src, 0, 0);
  art.style.width = `${src.width * 2}px`;
  art.style.height = `${src.height * 2}px`;
  const titles = el('div');
  const kicker = el('span', 'px-modal__kicker', gift ? 'Early player gift' : RARITIES[c.rarity].label);
  const h = el('h3', '', welcome ? 'Thank you for being early' : gift ? `Claim your ${c.name}` : `Mint ${c.name}?`);
  h.id = 'mint-title';
  titles.append(kicker, h);
  head.append(art, titles);

  const rows = el('dl', 'px-modal__rows');
  const per = RARITIES[c.rarity].tokensPerBlock;
  const have = inv.walletStars;
  const left = inv.supplyLeft(c.id);
  const add = (k: string, v: string) => rows.append(el('dt', '', k), el('dd', '', v));
  if (welcome) add('Your gift', c.name);
  if (gift) add('Price', 'Free');
  else {
    add('Price', `★ ${fmt.format(price)} STARS`);
    add('In your wallet', have === null ? '…' : have >= price ? `★ ${fmt.format(have)} → ${fmt.format(have - price)}` : `★ ${fmt.format(have)}`);
  }
  if (c.maxSupply) add('Left', `${fmt.format(left ?? 0)} of ${fmt.format(c.maxSupply)}`);
  add(
    c.kind === 'Item' ? 'Bonus when worn' : 'Earns',
    c.kind === 'Item' ? ((c.bonusPerBlock ?? 0) > 0 ? `+${c.bonusPerBlock} ★ / block` : 'Style only') : `+${per} ${per === 1 ? 'star' : 'stars'} / block`,
  );

  const note = el('p', 'px-modal__note', welcome ? `The game has started fresh and everyone begins at zero. Here is your free ${c.name}: no stars needed, only the small network fee. You can also claim it later in the Market.` : gift ? 'A thank you for being early. No stars needed, only the small network fee. Soulbound: it stays in your wallet for good.' : 'Soulbound: it stays in your wallet for good. It cannot be sold or sent to anyone. One per wallet.');
  const slot = el('div', 'mint__status');
  const actions = el('div', 'px-modal__actions mint__actions');
  const no = el('button', 'px-btn px-btn--ghost', gift ? 'Later' : 'No');
  no.type = 'button';
  const { wrap: yesWrap, btn: yes } = mintButton(gift ? (inv.walletConnected ? 'Claim gift' : 'Connect wallet') : 'Mint', null, { ready: true });
  actions.append(no, yesWrap);
  box.append(head, rows, note, slot, actions);
  back.append(box);
  document.body.append(back);
  const prevFocus = document.activeElement as HTMLElement | null;
  yes.focus();

  let busy = false;
  let stuck = 0;
  const close = () => {
    if (busy) return;
    window.clearTimeout(stuck);
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    closeOpen = null;
    prevFocus?.focus({ preventScroll: true });
  };
  const cancel = async () => {
    await inv.cancelMint();
    busy = false;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  no.onclick = close;
  closeOpen = () => {
    busy = false;
    close();
  };

  const show = (s: MintStatus) => {
    window.clearTimeout(stuck);
    note.hidden = true;
    const sb = statusBox(s, c.name, () => void cancel(), gift);
    slot.replaceChildren(sb);
    if (s.kind === 'busy' && s.step === 2) {
      // 20 sn cevap yoksa: cüzdan büyük ihtimalle kapatıldı
      stuck = window.setTimeout(() => {
        sb.insertBefore(el('p', 'claim__msg claim__msg--hint', `No answer from your wallet? If you closed it, press Cancel and ${gift ? 'claim' : 'mint'} again.`), sb.querySelector('.claim__row'));
      }, 20_000);
    }
    // Bekleme sırasında alttaki butonlar gizli (Cancel kutunun içinde)
    actions.hidden = s.kind === 'busy';
    if (s.kind === 'done') {
      yesWrap.remove();
      no.textContent = 'Close';
      no.className = 'px-btn px-btn--ok';
      no.focus();
    } else if (s.kind === 'error') {
      yes.querySelector('.claim__label')!.textContent = 'Try again';
    }
  };

  yes.onclick = async () => {
    if (busy) return;
    // Hediye: cüzdan yoksa önce bağlanır; bağlanınca bu pencere kendiliğinden geri gelir
    if (gift && !inv.walletConnected) {
      reopenGift = { c, inv, welcome };
      if (!reopenListening) {
        reopenListening = true;
        inv.onChange(() => {
          if (!reopenGift || !inv.walletConnected) return;
          const r = reopenGift;
          reopenGift = null;
          if (!inv.isOwned(r.c.id)) openMintDialog(r.c, r.inv, true, r.welcome);
        });
      }
      close();
      inv.openWallet();
      return;
    }
    busy = true;
    show({ kind: 'busy', step: 1, text: 'Getting ready…' });
    try {
      await inv.mint(c.id, show, gift);
    } catch (err) {
      const msg = err instanceof Error && err.message === 'busy' ? 'One moment, finishing the last action…' : 'Something went wrong. Your STARS are safe, try again.';
      show({ kind: 'error', step: 1, text: msg });
    } finally {
      busy = false;
    }
  };
}
