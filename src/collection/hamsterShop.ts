import { friendlyError, type Inventory } from '../auth/inventory';
import type { TokenLedger } from '../auth/ledger';
import { confirmDialog } from '../page/confirmDialog';
import { smoothScrollToEl } from '../page/smoothScroll';
import { cardArt } from './art';
import { CARDS, RARITIES, STARTER_HAMSTER, cardById, type CardDef } from './cards';
import { renderCard, scroller } from './collection';
import { mintButton, openMintDialog } from './mintUi';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Sınırlı arz sayacı: 20 piksel hücre, kalan oranda dolar; açılışta hücre hücre yanar */
const METER_CELLS = 20;
/** Dolum animasyonu her kart için bir kez oynar (yeniden çizimlerde tekrar etmez) */
const meterPlayed = new Set<string>();
const meterIO =
  'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const bar = e.target as HTMLElement;
            bar.classList.remove('is-wait');
            bar.classList.add('is-filling');
            meterPlayed.add(bar.dataset.card ?? '');
            meterIO?.unobserve(bar);
          }
        },
        { threshold: 0.6 },
      )
    : null;
function supplyMeter(id: string, left: number, max: number, owned: number, compact = false): HTMLElement {
  const fmt = new Intl.NumberFormat('en-US');
  const box = el('div', 'shop__meter');
  box.title = `${fmt.format(owned)} owned worldwide · ${fmt.format(left)} of ${fmt.format(max)} left`;
  const top = el('div', 'shop__meter-top');
  const tag = el('span', 'shop__meter-tag');
  tag.append(el('i', 'shop__meter-gem'), el('span', '', 'Limited'));
  const count = el('span', 'shop__meter-count');
  count.append(el('b', '', fmt.format(left)));
  if (!compact) count.append(el('small', '', ` / ${fmt.format(max)} left`));
  top.append(tag, count);
  const bar = el('div', 'shop__meter-bar');
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(max));
  bar.setAttribute('aria-valuenow', String(left));
  bar.setAttribute('aria-label', `${fmt.format(left)} of ${fmt.format(max)} left`);
  // En az bir hücre dolu kalsın (tükenmediyse)
  const on = left <= 0 ? 0 : Math.max(1, Math.round((left / max) * METER_CELLS));
  for (let i = 0; i < METER_CELLS; i++) {
    const cell = el('i', i < on ? 'is-on' : '');
    cell.style.setProperty('--i', String(i));
    bar.append(cell);
  }
  if (meterIO && !meterPlayed.has(id)) {
    bar.dataset.card = id;
    bar.classList.add('is-wait');
    meterIO.observe(bar);
  }
  box.append(top, bar);
  return box;
}

/**
 * "Market" bölümü: tüm hamster ve Pixsy kartları (satılıklar önde). Her kartın altında durumu:
 * Owned / Running, satın alınmamışsa fiyat + Buy butonu, alınmışsa "Run with this hamster".
 */
export function mountHamsterShop(
  section: HTMLElement,
  inv: Inventory,
  ledger: TokenLedger,
  signIn: () => void,
  _opts: { onSwitch?: (id: string) => void } = {},
): { focus: (id: string) => void } {
  const fmt = new Intl.NumberFormat('en-US');
  const status = new Map<string, string>();
  const star = (n: number) => `★ ${fmt.format(n)}`;

  /** Satın alma onayı: "Emin misin?" paneli; Evet → satın al */
  const askBuy = (c: CardDef) => {
    const price = c.price ?? 0;
    const have = ledger.total;
    const per = RARITIES[c.rarity].tokensPerBlock;
    if (have < price) {
      confirmDialog({
        tone: 'info',
        kicker: RARITIES[c.rarity].label,
        kickerTone: c.rarity,
        title: 'Not enough stars',
        art: cardArt(c.art),
        rows: [
          ['Price', star(price)],
          ['Your stars', star(have)],
          ['You need', star(price - have)],
        ],
        note: 'Keep running to collect more stars, then come back!',
        cancelLabel: 'OK',
      });
      return;
    }
    confirmDialog({
      tone: 'buy',
      kicker: RARITIES[c.rarity].label,
      kickerTone: c.rarity,
      title: `Buy ${c.name}?`,
      art: cardArt(c.art),
      rows: [
        ['Price', star(price)],
        ...(c.maxSupply ? ([['Left', `${fmt.format(inv.supplyLeft(c.id) ?? 0)} of ${fmt.format(c.maxSupply)}`]] as Array<[string, string]>) : []),
        ['Your stars', `${star(have)} → ${star(have - price)}`],
        c.kind === 'Item'
          ? ['Bonus when worn', (c.bonusPerBlock ?? 0) > 0 ? `+${c.bonusPerBlock} ★ / block` : 'Style only']
          : ['Earns', `+${per} ${per === 1 ? 'star' : 'stars'} / block`],
      ],
      note: 'Are you sure? You can sell it back later for half price.',
      confirmLabel: 'Yes, buy',
      cancelLabel: 'No',
      formatError: friendlyError,
      onConfirm: async () => {
        await inv.buy(c.id);
        if (c.kind === 'Item') {
          status.set(c.id, 'Yours! Put it on in My Collection.');
          return `${c.name} is yours! Put it on in My Collection or in the game.`;
        }
        status.set(c.id, 'Yours! Run with it in My Collection.');
        return `${c.name} is yours! Run with it from My Collection or the hut in the game.`;
      },
    });
  };

  /** Satış onayı: yarı fiyatına geri satılır */
  const askSell = (c: CardDef) => {
    const refund = inv.refundFor(c.id);
    const have = ledger.total;
    const running = inv.active === c.id;
    confirmDialog({
      tone: 'sell',
      kicker: RARITIES[c.rarity].label,
      kickerTone: c.rarity,
      title: `Sell ${c.name}?`,
      art: cardArt(c.art),
      rows: [
        ['You get back', `${star(refund)} (half of what you paid)`],
        ['Your stars', `${star(have)} → ${star(have + refund)}`],
      ],
      note: c.kind === 'Item' && inv.isEquipped(c.id)
        ? 'Are you sure? It is on your hamster now, so it will be taken off.'
        : running
        ? `Are you sure? It is running now, so ${cardById(STARTER_HAMSTER)?.name ?? 'your starter'} will take over the wheel.`
        : 'Are you sure? You can buy it again later for the full price.',
      confirmLabel: 'Yes, sell',
      cancelLabel: 'No',
      formatError: friendlyError,
      onConfirm: async () => {
        await inv.sell(c.id);
        status.set(c.id, `Sold! +${fmt.format(refund)} stars`);
        return `Sold! +${fmt.format(refund)} stars added.`;
      },
    });
  };

  /** Hediyesi olan oyuncuya ilk girişte bir kez teşekkür penceresi */
  const welcomeGift = () => {
    const id = inv.giftCard;
    const player = inv.playerId;
    if (!id || !player || inv.isOwned(id)) return;
    const key = `squeaksy.giftSeen.${player}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    const card = cardById(id);
    if (card) openMintDialog(card, inv, true, true);
  };

  /** Şeritte hangi tür önde: sağ üstteki Hamster / Pixsy düğmeleriyle değişir */
  let priority: 'hamster' | 'pixsy' = 'hamster';

  const render = () => {
    section.classList.add('collection');
    // Onchain: Limited göstergesi Mint butonlarıyla aynı dilde (mint.css)
    section.classList.toggle('collection--mint', inv.mintEnabled);
    section.replaceChildren();
    const panel = el('div', 'panel collection__panel collection__panel--brass');
    section.append(panel);

    // Alınmamış early oyuncu hediyesi
    const pendingGift = inv.giftCard && !inv.isOwned(inv.giftCard) ? inv.giftCard : null;
    // Satın alınmamışlar önde, sahip olunanlar sırada en sona (kendi içinde katalog sırası korunur)
    const forSaleFirst = (list: CardDef[]) =>
      list
        .map((c, i) => ({ c, i }))
        // Oyuncunun hediyesi en önde, sonra satın alınmamışlar
        .sort((a, b) => Number(b.c.id === pendingGift) - Number(a.c.id === pendingGift) || Number(inv.isOwned(a.c.id)) - Number(inv.isOwned(b.c.id)) || a.i - b.i)
        .map((x) => x.c);
    const hamsterList = forSaleFirst(CARDS.filter((x) => x.kind === 'Hamster'));
    const pixsyList = forSaleFirst(CARDS.filter((x) => x.kind === 'Item' && x.buddy));

    const head = el('div', 'collection__head');
    const titles = el('div');
    titles.append(
      el('h2', 'collection__title', 'Market'),
      el('p', 'collection__sub', inv.mintEnabled ? 'Mint new hamsters and Pixsy buddies with the STARS in your wallet' : 'Spend your stars on new hamsters and Pixsy buddies'),
    );

    // Sağ üst: ürün türleri. Tıklanan tür şeritte öne geçer; sayılar o türdeki kart adedi
    const types = el('nav', 'market__types');
    types.setAttribute('aria-label', 'Item types');
    const typeTab = (kind: 'hamster' | 'pixsy', label: string, list: CardDef[]) => {
      const b = el('button', `market__type${priority === kind ? ' is-on' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(priority === kind));
      b.append(el('span', 'market__type-name', label), el('span', 'market__type-count', String(list.length)));
      b.title = `${list.length} ${label.toLowerCase()} cards · show them first`;
      b.onclick = () => {
        if (priority === kind) return;
        priority = kind;
        render();
      };
      return b;
    };
    types.append(typeTab('hamster', 'Hamster', hamsterList), el('span', 'market__type-sep'), typeTab('pixsy', 'Pixsy', pixsyList));
    head.append(titles, types);

    // Seçili türün kısa bilgisi
    const hint = el(
      'p',
      'collection__sub market__hint',
      priority === 'hamster'
        ? 'Rarer hamsters earn more stars per block · Common +1 · Rare +2 · Legendary +4 · Mythic +8'
        : 'Worn on your hamster’s back · extra stars per block: ETH +0.5 · BTC +1',
    );

    // Tek satır, sağa kayan şerit: seçili tür önde, her grubun sonunda "yakında" kartı
    const grid = el('div', 'collection__grid collection__grid--row');
    // Her grubun sonunda "yakında" kartı: yeni hamsterler ve Pixsy'ler yolda
    const soon = (kind: string, text: string) => {
      const slot = el('div', 'shop__slot');
      slot.append(renderCard(null, 'common', { locked: true, soon: { kind, title: '???', text } }));
      const row = el('div', 'shop__row shop__row--buy');
      const chip = el('div', 'shop__buy shop__buy--soon');
      chip.setAttribute('role', 'status');
      chip.append(el('span', '', 'Coming soon'));
      row.append(chip);
      slot.append(row, el('p', 'shop__msg', 'Keep collecting stars'));
      return slot;
    };
    const hamGroup: [CardDef[], () => HTMLElement] = [hamsterList, () => soon('Hamster · ???', 'Something is stirring in the hut. A new hamster is getting ready to run.')];
    const pixGroup: [CardDef[], () => HTMLElement] = [pixsyList, () => soon('Pixsy · ???', 'A new buddy is being drawn pixel by pixel. Stay tuned.')];
    const groups = priority === 'hamster' ? [hamGroup, pixGroup] : [pixGroup, hamGroup];
    // Alınmamış hediye şeridin en solunda (türü ne olursa olsun)
    if (pendingGift) {
      const g = groups.find(([list]) => list.some((c) => c.id === pendingGift));
      const giftCard = g?.[0].find((c) => c.id === pendingGift);
      if (g && giftCard) {
        const rest = g[0].filter((c) => c.id !== pendingGift);
        groups[groups.indexOf(g)] = [rest, g[1]];
        groups[0] = [[giftCard, ...groups[0][0]], groups[0][1]];
      }
    }
    const target = grid;
    for (const [list, teaser] of groups) {
    for (const c of list) {
      const slot = el('div', 'shop__slot');
      slot.dataset.card = c.id;
      const owned = inv.isOwned(c.id);
      const isItem = c.kind === 'Item';
      const running = !isItem && c.id === inv.active;
      const wearing = isItem && inv.isEquipped(c.id);
      slot.append(renderCard(c, c.rarity, { running, wearing, limited: true }));
      let sellBtn: HTMLButtonElement | null = null;

      const row = el('div', `shop__row shop__row--${c.rarity}`);
      const price = c.price ?? 0;
      if (inv.mintEnabled) {
        // Onchain: kartlar cüzdandaki STARS ile mint edilir (Claim butonu tarzında). Soulbound: satış yok.
        if (owned) {
          row.dataset.need = c.chainType ? 'Soulbound in your wallet · in your collection' : 'In your collection';
        } else {
          row.classList.add('shop__row--buy');
          const have = inv.walletStars;
          const soldOut = inv.supplyLeft(c.id) === 0;
          const isGift = inv.giftCard === c.id;
          let need = '';
          let ready = false;
          let onClick = () => openMintDialog(c, inv, isGift);
          if (soldOut) need = 'Every one has an owner.';
          else if (isGift) {
            // Early oyuncu hediyesi: STARS ve claim gerekmez; buton hep parlak. Cüzdan yoksa pencere önce "Connect wallet" der,
            // bağlanınca kendiliğinden "Claim gift" ile geri açılır.
            ready = true;
            need = inv.walletConnected ? 'Your early player gift · free' : 'Your early player gift · connect your wallet';
          }
          else if (!inv.signedIn) {
            need = 'Sign in to mint';
            onClick = () => signIn();
          } else if (!inv.walletConnected) {
            need = 'Connect your wallet to mint';
            onClick = () => inv.openWallet();
          } else if (have !== null && !inv.linkedWallet) need = 'Claim your stars to your wallet first';
          else if (have !== null && have < price) need = `Need ${fmt.format(price - have)} more STARS in your wallet`;
          else ready = have !== null;
          const { wrap, btn } = soldOut
            ? mintButton('Sold out', null, { ready: false, disabled: true })
            : isGift
              ? mintButton('Gift', 'Free', { ready, dim: !ready })
              : mintButton('Mint', price, { ready, dim: !ready });
          btn.title = soldOut ? 'Sold out' : isGift ? `Claim your free ${c.name}` : `Mint ${c.name} for ${fmt.format(price)} STARS`;
          btn.onclick = () => {
            if (!inv.busy) onClick();
          };
          if (need && !status.has(c.id)) row.dataset.need = need;
          row.append(wrap);
        }
      } else if (owned) {
        // Market sadece alım-satım yeri: kuşanma (Put on / Wearing / Running) My Collection'da ve oyunda.
        // Satın alınmış kartın altında sadece Limited sayacı + Sell (başlangıç kartları satılmaz).
        row.dataset.need = 'In your collection';
        if (price > 0) {
          const refund = inv.refundFor(c.id);
          sellBtn = el('button', 'shop__sell');
          sellBtn.type = 'button';
          sellBtn.title = `Sell back for ${fmt.format(refund)} stars (half of what you paid)`;
          const label = el('span', 'shop__sell-label');
          label.append(el('b', '', 'Sell'), el('small', '', `+${fmt.format(refund)}`));
          sellBtn.append(label, el('i', 'shop__coin'));
          sellBtn.disabled = inv.busy;
          sellBtn.onclick = () => askSell(c);
        }
      } else {
        // Tek buton: fiyat net, her durumda aynı altın renk
        row.classList.add('shop__row--buy');
        const buy = el('button', 'shop__buy');
        buy.type = 'button';
        buy.append(el('i', 'shop__coin'), el('span', '', `Buy · ${fmt.format(price)} stars`));
        const have = ledger.total;
        if (inv.signedIn && have < price && !status.has(c.id)) row.dataset.need = `Need ${fmt.format(price - have)} more stars`;
        if (inv.supplyLeft(c.id) === 0) {
          // Tükendi: hepsinin sahibi var (biri satarsa yeniden alınabilir)
          buy.className = 'shop__buy shop__buy--soldout';
          buy.replaceChildren(el('span', '', 'Sold out'));
          buy.disabled = true;
          row.dataset.need = 'Every one has an owner. Check back later.';
        } else if (!inv.signedIn) {
          buy.onclick = () => signIn();
          row.dataset.need = 'Sign in with X to buy';
        } else {
          buy.onclick = () => {
            if (!inv.busy) askBuy(c);
          };
        }
        row.append(buy);
      }
      // Alt satır: solda sınırlı arz sayacı (piksel piksel dolar), sağda kırmızı Sell
      const left = inv.supplyLeft(c.id);
      const limited = left !== null && !!c.maxSupply;
      if (row.parentElement !== slot && row.childElementCount > 0) slot.append(row);
      if (limited || sellBtn) {
        const foot = el('div', `shop__foot shop__foot--${c.rarity}`);
        if (limited) foot.append(supplyMeter(c.id, left!, c.maxSupply!, inv.supplyOwned(c.id), !!sellBtn));
        if (sellBtn) foot.append(sellBtn);
        slot.append(foot);
      }
      const msg = el('p', 'shop__msg', status.get(c.id) ?? row.dataset.need ?? '');
      msg.setAttribute('aria-live', 'polite');
      slot.append(msg);
      target.append(slot);
    }
    grid.append(teaser());
    }
    panel.append(head);
    // Hediye bandı: alınmamış hediye varsa Market'in en üstünde
    if (pendingGift) {
      const card = cardById(pendingGift);
      const bar = el('div', 'mint__giftbar');
      const text = el('p', 'mint__giftbar-text');
      text.append(el('b', '', 'Early player gift'), document.createTextNode(` A free ${card?.name ?? 'card'} is waiting for you. Thank you for being here from the start.`));
      const go = el('button', 'px-btn px-btn--ok', 'See my gift');
      go.type = 'button';
      go.onclick = () => {
        priority = card?.kind === 'Item' ? 'pixsy' : 'hamster';
        render();
        focus(pendingGift);
      };
      bar.append(text, go);
      panel.append(bar);
    }
    panel.append(hint, scroller(grid));
    welcomeGift();
  };

  inv.onChange(render);
  // Bakiye değişince "Buy" butonu açılabilir; açık işlem yokken yeniden çiz
  let pending = 0;
  ledger.onChange(() => {
    if (inv.busy) return;
    window.clearTimeout(pending);
    pending = window.setTimeout(render, 300);
  });
  render();

  /** Oyun panelinden "Buy": sayfayı o karta kaydırır ve kartı vurgular */
  const focus = (id: string) => {
    const slot = section.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (!slot) return;
    // Yatay kart sırasında kartı ortaya getir (tarayıcının yumuşak yatay kaydırması kısa mesafede sorunsuz)
    const row = scrollParentX(slot);
    if (row) {
      const rr = row.getBoundingClientRect();
      const sr = slot.getBoundingClientRect();
      row.scrollBy({ left: sr.left + sr.width / 2 - (rr.left + rr.width / 2), behavior: 'smooth' });
    }
    void smoothScrollToEl(slot, 'center');
    slot.classList.remove('is-focus');
    void slot.offsetWidth;
    slot.classList.add('is-focus');
    window.setTimeout(() => slot.querySelector<HTMLButtonElement>('.shop__buy, .shop__btn, .mint__btn')?.focus({ preventScroll: true }), 600);
  };
  return { focus };
}

/** Yatay kaydırılabilen en yakın ata */
function scrollParentX(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return p;
  }
  return null;
}
