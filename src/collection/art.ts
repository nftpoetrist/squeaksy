import { COMPANION_PALETTE, companionPixels } from '../character/companion';
import { DEFAULT_POSE, drawHamsterPose } from '../character/hamsterBase';
import { BuddyFx, HamsterAura } from '../background/layers/hamsterFx';
import type { CardArt } from './cards';

/** Piksel haritasını tuvale çizer */
function paint(px: (string | null)[][], palette: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = px[0]!.length;
  c.height = px.length;
  const ctx = c.getContext('2d')!;
  px.forEach((row, y) =>
    row.forEach((k, x) => {
      if (!k) return;
      ctx.fillStyle = palette[k]!;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

/** Siyah kenar ekler: amblem koyu zeminde de net okunur */
function outlined(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width + 2;
  c.height = src.height + 2;
  const ctx = c.getContext('2d')!;
  const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  ctx.fillStyle = color;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! > 0) ctx.fillRect(x, y, 3, 3);
    }
  }
  ctx.drawImage(src, 1, 1);
  return c;
}

/** Pixsy'nin büyük (kenar çizgili) piksel görseli: efektsiz, canlı sahneler için */
export function pixsyImage(kind: 'pixsy' | 'eth' | 'btc'): HTMLCanvasElement {
  const edge = kind === 'eth' ? '#0e0c2a' : kind === 'btc' ? '#2a1002' : '#3a1c0e';
  return outlined(paint(companionPixels('full', kind), COMPANION_PALETTE), edge);
}

const cache = new Map<CardArt, HTMLCanvasElement>();

/** Kart görselinin piksel tuvali (1 piksel = 1 sanat pikseli; CSS ile büyütülür) */
export function cardArt(art: CardArt): HTMLCanvasElement {
  let c = cache.get(art);
  if (!c) {
    if (art === 'pixsy') c = outlined(paint(companionPixels('full'), COMPANION_PALETTE), '#3a1c0e');
    else if (art === 'pixsy-eth') c = BuddyFx.still('eth', outlined(paint(companionPixels('full', 'eth'), COMPANION_PALETTE), '#0e0c2a'), 4, 0);
    else if (art === 'pixsy-btc') c = BuddyFx.still('btc', outlined(paint(companionPixels('full', 'btc'), COMPANION_PALETTE), '#2a1002'), 4, 0);
    else {
      const variant = art === 'hamster' ? 'starter' : art;
      const img = drawHamsterPose({ ...DEFAULT_POSE, companion: false }, variant).img;
      // Rare/Legendary: kart görselinde de parıltı / alevler
      c = variant === 'starter' ? img : HamsterAura.still(variant, img);
    }
    cache.set(art, c);
  }
  return c;
}

/** Bilinmeyen (kilitli) kart: piksel soru işareti */
export function mysteryArt(): HTMLCanvasElement {
  const map = ['.####.', '##..##', '....##', '...##.', '..##..', '..##..', '......', '..##..'];
  return paint(
    map.map((r) => [...r].map((ch) => (ch === '#' ? 'q' : null))),
    { q: '#ffffff' },
  );
}
