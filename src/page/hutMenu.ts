import { friendlyError, type Inventory } from '../auth/inventory';
import type { TokenLedger } from '../auth/ledger';
import type { PixelStormBackground } from '../background/Background';
import { cardArt } from '../collection/art';
import { cardById, CARDS, RARITIES, type CardDef } from '../collection/cards';
import { smoothScrollToEl } from './smoothScroll';

/** Kulübenin önünde uyuyan hamsterler: koşan hariç tüm hamster kartları */
export function hutSleepers(inv: Inventory): CardDef[] {
  return CARDS.filter((c) => c.kind === 'Hamster' && c.id !== inv.active);
}

/**
 * Kulübe arayüzü: uyuyan her hamsterin üstünde tıklanabilir alan + küçük fiyat
 * etiketi. Tıklanınca kart penceresi açılır: satın al / bu hamsterle koş.
 */
export function mountHutMenu(
  stage: HTMLElement,
  bg: PixelStormBackground,
  inv: Inventory,
  ledger: TokenLedger,
  signIn: () => void,
  opts: { onBuy?: (id: string) => void } = {},
): { refresh: () => void; open: (id: string) => void } {
  const layer = document.createElement('div');
  layer.className = 'hut-ui';
  stage.appendChild(layer);
  const pop = document.createElement('div');
  pop.className = 'hut-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  stage.appendChild(pop);

  const fmt = new Intl.NumberFormat('en-US');
  let openId: string | null = null;
  let status = '';

  const close = () => {
    openId = null;
    status = '';
    pop.hidden = true;
  };

  const renderSpots = () => {
    layer.replaceChildren();
    const spots = bg.getHutSpotsInStage();
    for (const sp of spots) {
      const c = cardById(sp.id);
      if (!c) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hut-spot hut-spot--${c.rarity}`;
      b.style.left = `${sp.x}px`;
      b.style.top = `${sp.y}px`;
      b.style.width = `${sp.w}px`;
      b.style.height = `${sp.h}px`;
      b.setAttribute('aria-label', `${c.name} (${RARITIES[c.rarity].label}), ${inv.isOwned(c.id) ? 'owned' : `${c.price} stars`}`);
      // Satın alınmamış: gölgeli hamsterin ortasında yıldızlı fiyat; sahip olunana yazı yok
      if (!inv.isOwned(c.id)) {
        b.classList.add('is-locked');
        const tag = document.createElement('span');
        tag.className = 'hut-tag hut-tag--price';
        tag.append(Object.assign(document.createElement('i'), { className: 'hut-tag__coin' }), document.createTextNode(fmt.format(c.price ?? 0)));
        b.append(tag);
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openId === c.id) close();
        else {
          openId = c.id;
          status = '';
          renderPop();
        }
      });
      layer.append(b);
    }
  };

  // Eşya köşesi: tıklayınca eşya hamstere geri takılır
  const renderItems = () => {
    for (const sp of bg.getItemSpotsInStage()) {
      const c = cardById(sp.id);
      if (!c) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hut-spot hut-spot--item';
      b.style.left = `${sp.x}px`;
      b.style.top = `${sp.y}px`;
      b.style.width = `${sp.w}px`;
      b.style.height = `${sp.h}px`;
      const owned = inv.isOwned(c.id);
      b.setAttribute('aria-label', `${c.name} (${RARITIES[c.rarity].label}), ${owned ? 'owned' : `${c.price} stars`}`);
      // Satılık olanlarda fiyat; sahip olunanlarda yazı yok
      if (!owned) {
        const tag = document.createElement('span');
        tag.className = 'hut-tag hut-tag--item';
        tag.append(Object.assign(document.createElement('i'), { className: 'hut-tag__coin' }), document.createTextNode(fmt.format(c.price ?? 0)));
        b.append(tag);
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openId === c.id) close();
        else {
          openId = c.id;
          status = '';
          renderPop();
        }
      });
      layer.append(b);
    }
  };

  const renderPop = () => {
    if (!openId) return close();
    const c = cardById(openId);
    const spot = [...bg.getHutSpotsInStage(), ...bg.getItemSpotsInStage()].find((s) => s.id === openId);
    const isItem = c?.kind === 'Item';
    if (!c || !spot) return close();
    pop.replaceChildren();
    pop.className = `hut-pop hut-pop--${c.rarity}`;

    const art = document.createElement('canvas');
    const src = cardArt(c.art);
    art.width = src.width;
    art.height = src.height;
    art.getContext('2d')!.drawImage(src, 0, 0);
    art.className = 'hut-pop__art';
    art.style.width = `${src.width * 2}px`;
    art.style.height = `${src.height * 2}px`;

    const info = document.createElement('div');
    info.className = 'hut-pop__info';
    const rar = document.createElement('span');
    rar.className = 'hut-pop__rarity';
    rar.textContent = RARITIES[c.rarity].label;
    const name = document.createElement('h4');
    name.textContent = c.name;
    const per = document.createElement('p');
    per.className = 'hut-pop__per';
    const n = RARITIES[c.rarity].tokensPerBlock;
    if (isItem) {
      const b = c.bonusPerBlock ?? 0;
      per.innerHTML = b > 0 ? `<b>+${b}</b> ${b === 1 ? 'star' : 'stars'} per block when worn` : 'Pixsy buddy · rides on your hamster’s back';
    }
    else per.innerHTML = `<b>+${n}</b> ${n === 1 ? 'star' : 'stars'} per block`;
    const stock = inv.supplyLeft(c.id);
    const lim = document.createElement('p');
    lim.className = 'hut-pop__limited';
    if (stock !== null && c.maxSupply) {
      lim.textContent = stock === 0 ? `Sold out · ${fmt.format(c.maxSupply)} owned` : `Limited · ${fmt.format(stock)} of ${fmt.format(c.maxSupply)} left`;
    }
    const flavor = document.createElement('p');
    flavor.className = 'hut-pop__flavor';
    flavor.textContent = c.flavor;
    info.append(rar, name, per, ...(lim.textContent ? [lim] : []), flavor);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hut-pop__btn';
    const owned = inv.isOwned(c.id);
    const price = c.price ?? 0;
    let need = '';
    if (owned && !inv.signedIn) {
      btn.textContent = 'Sign in with X';
      btn.onclick = () => signIn();
    } else if (owned && isItem) {
      // Sahip olunan Pixsy: hamstere tak (sırttaki eskisi köşeye uçar)
      btn.textContent = `Put on ${c.name}`;
      btn.disabled = inv.busy;
      btn.onclick = async () => {
        try {
          await inv.toggleItem(c.id);
          close();
        } catch (err) {
          status = friendlyError(err);
          renderPop();
        }
      };
    } else if (owned) {
      btn.textContent = 'Run with this hamster';
      btn.disabled = inv.busy;
      btn.onclick = async () => {
        try {
          await inv.equip(c.id);
          close();
        } catch (err) {
          status = friendlyError(err);
          renderPop();
        }
      };
    } else {
      // Satın alma Hamsters bölümündeki kartta yapılır: sayfa o karta kayar
      const have = ledger.total;
      btn.textContent = `Buy · ${fmt.format(price)} stars`;
      btn.classList.add('is-buy');
      if (inv.signedIn && have < price) need = `You need ${fmt.format(price - have)} more stars`;
      btn.onclick = () => {
        close();
        opts.onBuy?.(c.id);
      };
    }
    const msg = document.createElement('p');
    msg.className = 'hut-pop__status';
    msg.textContent = status || need;
    msg.setAttribute('aria-live', 'polite');

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'hut-pop__close';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.onclick = close;

    pop.append(x, art, info, btn, msg);
    pop.hidden = false;
    // Hamsterin üstünde açılır; sahne dışına taşmaz
    const sw = stage.clientWidth;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.min(Math.max(12, spot.x + spot.w / 2 - pw / 2), sw - pw - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(12, spot.y - ph - 14)}px`;
  };

  const refresh = () => {
    renderSpots();
    renderItems();
    if (openId) renderPop();
  };

  /** Oyun paneline kaydırır ve o hamsterin penceresini açar (Hamsters bölümünden "Switch in game") */
  const open = (id: string) => {
    // Pencere, kaydırma bitince açılır (yolda açılıp kaymasın)
    void smoothScrollToEl(stage, 'center').then(() => {
      openId = id;
      status = '';
      renderPop();
    });
  };

  document.addEventListener('click', (e) => {
    if (openId && !pop.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  bg.events.on('scene:resize', refresh);
  ledger.onChange(() => {
    if (openId && !inv.busy) renderPop();
  });
  inv.onChange(refresh);
  refresh();
  return { refresh, open };
}
