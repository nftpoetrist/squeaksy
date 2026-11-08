/**
 * "Connect wallet" konsolu: kullanıcının referans görselindeki el konsolunun piksel sanatı, kodla temiz çizim.
 * Izgara 218 × 166 hücre (masaüstünde 1 hücre = 4 px, referansın 4 pikseli). Ölçüler ve renkler referanstan
 * ölçüldü; her piksel net, yumuşak geçiş / leke yok. Işık sol üstten gelir: dışta camgöbeği kenar ışığı,
 * koyu dış hat, içte beyazdan camgöbeğine parlama; sağ ve alt kenarlar daha loş.
 * Hamster (referanstaki, kendi 4 px ızgarasından çıkarıldı, simetrik) ve parıltılar ayrı katmanlarda çizilir.
 */
import { EMBLEM_MINI } from '../character/companion';

export const ART_W = 218;
export const ART_H = 166;

type RGB = string;

class Grid {
  readonly px: (RGB | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: RGB | null): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x] ?? null;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  toCanvas(cls: string): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.className = cls;
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    // Tek seferde yaz (36 bin fillRect yerine bir putImageData)
    const img = ctx.createImageData(this.w, this.h);
    const d = img.data;
    const cache = new Map<string, number[]>();
    for (let i = 0; i < this.px.length; i++) {
      const c = this.px[i];
      if (!c) continue;
      let rgb = cache.get(c);
      if (!rgb) {
        const n = parseInt(c.slice(1), 16);
        rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        cache.set(c, rgb);
      }
      d[i * 4] = rgb[0]!;
      d[i * 4 + 1] = rgb[1]!;
      d[i * 4 + 2] = rgb[2]!;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cv.setAttribute('aria-hidden', 'true');
    return cv;
  }
}

/** Tek boyutlu maske: (x, y) şeklin içinde mi */
type Shape = (x: number, y: number) => boolean;

/** Şeklin dış kenar halkası: içte olup komşusu dışarıda olan hücreler; yön (üst/sol/sağ/alt) ile */
function ringSide(inside: Shape, x: number, y: number): 'top' | 'left' | 'right' | 'bottom' | null {
  if (!inside(x, y)) return null;
  if (!inside(x, y - 1)) return 'top';
  if (!inside(x - 1, y)) return 'left';
  if (!inside(x + 1, y)) return 'right';
  if (!inside(x, y + 1)) return 'bottom';
  return null;
}

/** Basamaklı yuvarlak dikdörtgen (r = köşe yarıçapı, hücre) */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
    const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= (r + 0.35) * (r + 0.35);
  };
}

function circle(cx: number, cy: number, r: number): Shape {
  return (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= (r + 0.3) * (r + 0.3);
}

/** Gövdenin sol kenarı (y → x); sağ kenar simetrik: 218 - L(y). Referansın dış hattından. */
const LEFT: Array<[number, number]> = [
  [22, 21], [23, 18], [24, 16], [25, 15], [26, 14], [27, 13], [28, 12], [29, 12], [30, 11], [31, 11], [32, 10],
  [34, 10], [35, 9], [40, 9], [41, 8], [56, 8], [57, 7], [58, 6], [59, 5], [142, 5], [143, 6], [144, 7],
];
const BOTTOM = 163;
function leftEdge(y: number): number {
  if (y > 144) return 7 + Math.round((y - 144) * (19 / (BOTTOM - 144))); // alt pah: 45°'ye yakın
  let x = LEFT[0]![1];
  for (const [yy, xx] of LEFT) if (y >= yy) x = xx;
  return x;
}
const body: Shape = (x, y) => y >= 22 && y <= BOTTOM && x >= leftEdge(y) && x <= 217 - leftEdge(y);

/** Bantlı gövde rengi: üstte parlak, aşağı doğru koyulaşır; sağ yarı biraz daha loş (ışık sol üstten) */
const BODY_BANDS = ['#2b74ee', '#276ce3', '#2464d6', '#215cc8', '#1f54ba', '#1d4dab', '#1c479f', '#1b4194', '#1a3b88'];
function bodyColor(x: number, y: number): RGB {
  const t = (y - 22) / (BOTTOM - 22);
  let i = Math.min(BODY_BANDS.length - 1, Math.floor(t * BODY_BANDS.length));
  // Bantlar arasında 2 sıralık dama geçişi (piksel sanatı yumuşatması, bulanıklık değil)
  const f = t * BODY_BANDS.length - i;
  if (f > 0.82 && (x + y) % 2 === 0 && i < BODY_BANDS.length - 1) i++;
  if (x > 109) i = Math.min(BODY_BANDS.length - 1, i + 1);
  return BODY_BANDS[i]!;
}

/** Üst paneller ile gövde arasındaki eğri derz (sol): üst köşeden yan kenara */
function seamY(x: number): number {
  // (46, 22) → (9, 58): hafif kavis
  const t = (46 - x) / 37;
  return 22 + 36 * (t * t * 0.35 + t * 0.65);
}

function star4(g: Grid, cx: number, cy: number, arm: number, core: RGB, edge: RGB): void {
  for (let i = 1; i <= arm; i++) {
    const c = i === arm ? edge : core;
    g.set(cx + i, cy, c);
    g.set(cx - i, cy, c);
    g.set(cx, cy + i, c);
    g.set(cx, cy - i, c);
  }
  g.set(cx, cy, '#ffffff');
}

/** Konsol gövdesi (hamster ve parıltılar hariç). Bir kez çizilir, sonra aynı tuval yeniden kullanılır. */
let consoleCache: HTMLCanvasElement | null = null;
export function drawConsole(): HTMLCanvasElement {
  consoleCache ??= paintConsole();
  return consoleCache;
}

function paintConsole(): HTMLCanvasElement {
  const g = new Grid(ART_W, ART_H);

  // ------------------------------------------------ omuz tuşları (gövdenin arkasında, üstte)
  for (const sx of [52, 148]) {
    const sh = roundRect(sx, 16, sx + 17, 24, 3);
    for (let y = 15; y <= 24; y++)
      for (let x = sx - 1; x <= sx + 18; x++) {
        if (sh(x, y)) {
          const side = ringSide(sh, x, y);
          g.set(x, y, side ? '#030a3e' : y <= 17 ? '#d2fcfe' : y === 18 ? '#7fe6fc' : y <= 20 ? '#0f6ef0' : '#0f3aa4');
        } else if (sh(x, y + 1) || sh(x + 1, y) || sh(x - 1, y)) {
          g.set(x, y, '#46d9fc'); // kenar ışığı
        }
      }
  }

  // ------------------------------------------------ gövde
  for (let y = 21; y <= BOTTOM + 1; y++)
    for (let x = 0; x < ART_W; x++) {
      if (body(x, y)) {
        g.set(x, y, bodyColor(x, y));
      } else if (body(x, y + 1) || body(x + 1, y) || body(x - 1, y) || body(x, y - 1)) {
        // dış camgöbeği kenar ışığı: üstte ve solda parlak, altta loş
        g.set(x, y, body(x, y + 1) || body(x + 1, y) ? '#45e3fd' : body(x - 1, y) ? '#38c8fb' : '#2a8fe8');
      }
    }
  // Üst paneller (derzin üstü): daha parlak, sağda ayna
  for (let x = 6; x <= 47; x++) {
    const sy = Math.round(seamY(x));
    for (let y = 22; y < sy; y++) {
      if (body(x, y)) g.set(x, y, y < 30 ? '#2f7af2' : '#2a71ea');
      const mx = 217 - x;
      if (body(mx, y)) g.set(mx, y, y < 30 ? '#2668dc' : '#2361d2');
    }
    // derz: koyu çizgi + altında ince ışık
    g.set(x, sy, '#14378f');
    g.set(x, sy + 1, '#3b84f0');
    g.set(217 - x, sy, '#12317f');
    g.set(217 - x, sy + 1, '#2f6fdc');
  }
  // Kanat kenarı (yanlarda dışa taşan alt kanatların üst çizgisi)
  for (let x = 5; x <= 9; x++) {
    g.set(x, 59, '#3b84f0');
    g.set(217 - x, 59, '#2f6fdc');
  }

  // Dış hat + iç parlama (ışık sol üstten)
  const inner = (x: number, y: number) => body(x, y) && body(x - 1, y) && body(x + 1, y) && body(x, y - 1) && body(x, y + 1);
  const inner2 = (x: number, y: number) => inner(x, y) && inner(x - 1, y) && inner(x + 1, y) && inner(x, y - 1) && inner(x, y + 1);
  for (let y = 22; y <= BOTTOM; y++)
    for (let x = 0; x < ART_W; x++) {
      if (!body(x, y)) continue;
      const s1 = ringSide(body, x, y);
      if (s1) {
        g.set(x, y, '#05081d');
        continue;
      }
      const s2 = ringSide(inner, x, y);
      if (s2) {
        g.set(x, y, s2 === 'top' ? '#d8f7fd' : s2 === 'left' ? '#c4f1fd' : s2 === 'right' ? '#58b4f4' : '#3157c4');
        continue;
      }
      const s3 = ringSide(inner2, x, y);
      if (s3 && s3 !== 'bottom') g.set(x, y, s3 === 'right' ? '#2f7ee6' : '#74d2fe');
    }

  // ------------------------------------------------ ekran çerçevesi + ekran + liste paneli
  const bezel = roundRect(46, 26, 172, 151, 7);
  const bezelIn = roundRect(48, 28, 170, 149, 6);
  for (let y = 24; y <= 153; y++)
    for (let x = 44; x <= 174; x++) {
      if (bezel(x, y)) {
        if (bezelIn(x, y)) {
          const s = ringSide(bezelIn, x, y);
          g.set(x, y, s ? '#0b1040' : '#111644');
        } else {
          const s = ringSide(bezel, x, y);
          // çerçeve: dış koyu hat, üst/sol ışıklı eğim, alt/sağ gölge
          g.set(x, y, s ? '#070b33' : y < 40 || x < 60 ? '#2a4aa8' : '#1a2f7a');
        }
      } else if (bezel(x, y + 1) || bezel(x + 1, y)) {
        g.set(x, y, '#3f8ef0'); // çerçevenin üst/sol dış ışığı
      }
    }
  // Liste paneli (canlı listenin zemini)
  const panel = roundRect(50, 45, 168, 146, 3);
  for (let y = 44; y <= 147; y++)
    for (let x = 49; x <= 169; x++) {
      if (!panel(x, y)) continue;
      g.set(x, y, ringSide(panel, x, y) ? '#0a0a30' : '#0f0f31');
    }
  // Başlığın iki yanındaki altın yıldızlar
  const gold = (cx: number, cy: number) => {
    const S = ['..o..', '.oGo.', 'oGGGo', '.oGo.', '.o.o.'];
    S.forEach((r, yy) => {
      for (let xx = 0; xx < 5; xx++) {
        const ch = r[xx];
        if (ch === 'o') g.set(cx - 2 + xx, cy - 2 + yy, '#d8961e');
        else if (ch === 'G') g.set(cx - 2 + xx, cy - 2 + yy, yy <= 1 ? '#fff1a8' : '#ffc93c');
      }
    });
  };
  gold(59, 37);
  gold(159, 37);

  // ------------------------------------------------ alt dudak (ekranın altı): üstte ışık, koyu bant, altta camgöbeği ışık
  for (let y = 152; y <= BOTTOM - 1; y++)
    for (let x = 0; x < ART_W; x++) {
      if (!inner2(x, y) || bezel(x, y)) continue;
      const d = Math.abs(x - 109) / 100;
      const c =
        y === 152
          ? '#5993f4'
          : y === 153
            ? '#212e7d'
            : y >= BOTTOM - 2
              ? '#37b4fc'
              : d < 0.22
                ? '#132a8c'
                : d < 0.45
                  ? '#10206f'
                  : d < 0.7
                    ? '#0e195f'
                    : '#0c1452';
      g.set(x, y, c);
    }
  // Parlayan çizgiler (iki yanda) + hare
  const LINES: Array<[number, number]> = [
    [66, 91],
    [127, 152],
  ];
  for (const [x0, x1] of LINES) {
    for (let x: number = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1;
      g.set(x, 157, edge ? '#2f8fe8' : '#9ff4ff');
      g.set(x, 156, '#1c55c4');
      g.set(x, 158, '#1c55c4');
    }
  }
  // Ortadaki amblem tablası (ekran çerçevesinin alt kenarına biner)
  const tab = roundRect(96, 148, 122, BOTTOM - 2, 2);
  for (let y = 147; y <= BOTTOM; y++)
    for (let x = 94; x <= 124; x++) {
      if (!tab(x, y)) continue;
      const s = ringSide(tab, x, y);
      g.set(x, y, s ? (s === 'top' ? '#3a6fe0' : '#070a35') : y <= 150 ? '#16348f' : '#0e1a66');
    }
  // Squeekchain amblemi (sitenin kendi amblemi): parlayan camgöbeği dış hat + hafif hare
  EMBLEM_MINI.forEach((row, yy) => {
    for (let xx = 0; xx < row.length; xx++) {
      const ch = row[xx];
      const X = 103 + xx;
      const Y = 151 + yy;
      if (ch === '#') g.set(X, Y, '#9ff4ff');
      else if (ch === 'o') g.set(X, Y, '#1d4fc2');
    }
  });

  // ------------------------------------------------ yön tuşu
  const dH: Shape = (x, y) => x >= 13 && x <= 41 && y >= 67 && y <= 77;
  const dV: Shape = (x, y) => x >= 22 && x <= 32 && y >= 55 && y <= 85;
  const dpad: Shape = (x, y) => dH(x, y) || dV(x, y);
  // gölge
  for (let y = 56; y <= 87; y++) for (let x = 14; x <= 43; x++) if (dpad(x - 1, y - 2) && !dpad(x, y)) g.set(x, y, '#12317f');
  for (let y = 55; y <= 85; y++)
    for (let x = 13; x <= 41; x++) {
      if (!dpad(x, y)) continue;
      const s = ringSide(dpad, x, y);
      if (s) {
        g.set(x, y, '#070722');
        continue;
      }
      const top = !dpad(x, y - 2);
      const left = !dpad(x - 2, y);
      const bottom = !dpad(x, y + 2);
      const right = !dpad(x + 2, y);
      g.set(x, y, top || left ? '#4a45b2' : bottom || right ? '#0c0c3c' : '#15164f');
    }
  // ok kabartmaları
  const arrow = (cx: number, cy: number, dx: number, dy: number) => {
    for (let i = 0; i < 3; i++)
      for (let j = -i; j <= i; j++) {
        const x = cx + dx * i + (dy !== 0 ? j : 0);
        const y = cy + dy * i + (dx !== 0 ? j : 0);
        g.set(x, y, '#0b0b38');
      }
  };
  arrow(27, 59, 0, 1);
  arrow(27, 81, 0, -1);
  arrow(17, 72, 1, 0);
  arrow(37, 72, -1, 0);
  // merkez: parlayan nokta
  const dot = circle(27, 72, 2.2);
  for (let y = 69; y <= 75; y++)
    for (let x = 24; x <= 30; x++) if (dot(x, y)) g.set(x, y, ringSide(dot, x, y) ? '#1b49ab' : x <= 26 && y <= 71 ? '#9fe0ff' : '#3489ea');

  // ------------------------------------------------ SELECT / BACK pill'leri (yazılar sayfada)
  for (const py of [97, 109]) {
    const pill = roundRect(17, py, 38, py + 8, 4);
    for (let y = py - 1; y <= py + 10; y++)
      for (let x = 16; x <= 40; x++) {
        if (pill(x, y)) {
          const s = ringSide(pill, x, y);
          g.set(x, y, s ? '#05041e' : y === py + 1 ? '#6a5ad0' : y >= py + 7 ? '#0d0e44' : '#18195c');
        } else if (pill(x - 1, y - 1)) {
          g.set(x, y, '#12317f'); // gölge
        }
      }
  }

  // ------------------------------------------------ A / B (harfler sayfada)
  for (const [cx, cy] of [
    [199, 68],
    [185, 83],
  ] as const) {
    const btn = circle(cx, cy, 7.6);
    const btnIn = circle(cx, cy, 6.6);
    for (let y = cy - 10; y <= cy + 10; y++)
      for (let x = cx - 10; x <= cx + 10; x++) {
        if (btn(x, y)) {
          if (!btnIn(x, y)) {
            g.set(x, y, '#07042a');
            continue;
          }
          const s = ringSide(btnIn, x, y);
          const dx = x - cx;
          const dy = y - cy;
          if (s) g.set(x, y, dx + dy < 0 ? '#5fe0f8' : '#3d95f5');
          else g.set(x, y, dy < -3 ? '#2a6fd8' : dy < 2 ? '#1f5ac2' : '#1a4fb0');
        } else if (btn(x - 1, y - 2)) {
          g.set(x, y, '#0e1a55'); // gölge
        }
      }
  }

  // ------------------------------------------------ X (kapat)
  const xb = roundRect(192, 28, 202, 37, 1);
  for (let y = 27; y <= 39; y++)
    for (let x = 191; x <= 204; x++) {
      if (xb(x, y)) {
        const s = ringSide(xb, x, y);
        g.set(x, y, s ? (s === 'right' || s === 'bottom' ? '#86edfb' : '#58b5de') : '#222b7c');
      } else if (xb(x - 1, y - 1)) g.set(x, y, '#0e1a55');
    }
  for (let i = 0; i < 6; i++) {
    g.set(194 + i, 30 + i, '#ffffff');
    g.set(195 + i, 30 + i, '#ffffff');
    g.set(199 - i, 30 + i, '#ffffff');
    g.set(200 - i, 30 + i, '#ffffff');
  }

  // ------------------------------------------------ hoparlör ızgaraları (eğik oluklar)
  for (const [gx, dir] of [
    [17, 1],
    [186, -1],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      const y0 = 125 + k * 5;
      for (let i = 0; i < 15; i++) {
        const x = gx + i;
        const yy = y0 + Math.round(((dir === 1 ? 14 - i : i) * 2) / 14);
        g.set(x, yy, '#070429');
        g.set(x, yy + 1, '#0b0c3c');
        g.set(x, yy + 2, '#305cad');
      }
    }
  }

  return g.toCanvas('wcon__art');
}

/**
 * Referanstaki hamster: kendi 4 px ızgarasından çıkarıldı, sol yarısı aynalanarak simetrik (36 × 18).
 * O dış hat, F tüy, D tüy gölgesi, C kulak içi / burun, W beyaz, P karın gölgesi, H göz parlaması
 */
const HAMSTER = [
  '.......OOOO..............OOOO.......',
  '.......ODFFO............OFFDO.......',
  '.......ODCCFO.OOOOOOOO.OFCCDO.......',
  '.......ODCCDDCFFFFFFFFCDDCCDO.......',
  '.......OFCCFFFFFFFFFFFFFFCCFO.......',
  '.......OFCFFFFFFFFFFFFFFFFCFO.......',
  '.......OOFFFFFFFFFFFFFFFFFFOO.......',
  '.......OOFFFFFFFFFFFFFFFFFFOO.......',
  '.......OFFFFOOFFFFFFFFOOFFFFO.......',
  '......OFFFFOHOFFFFFFFFOHOFFFFO......',
  '......OFFFFOOOFFFWWFFFOOOFFFFO......',
  '.....OFFFFFFFFFWFFFFWFFFFFFFFFO.....',
  '....OFFWFFFFFWWWWCCWWWWFFFFFWFFO....',
  '....OFFWWWWWWWWPWDDWPWWWWWWWWFFO....',
  '..OOODWWWWWWWWWWDDDDWWWWWWWWWWDOOO..',
  'OFFFFDOPWWWWWWWWWWWWWWWWWWWWPODFFFFO',
  'FFFWWFCCPPWWWWWWWWWWWWWWWWPPCCFWWFFF',
  'FFWWPWPOPPPPPPPPPPPPPPPPPPPPOPWPWWFF',
  'ODPPOPDOOOOOOOOOOOOOOOOOOOOOODPOPPDO',
];
const HAM_PAL: Record<string, RGB> = {
  O: '#26131f',
  F: '#f0a46e',
  D: '#ae675a',
  C: '#7a4038',
  W: '#faf3ec',
  P: '#c6a9c6',
  H: '#ffffff',
};
export const HAMSTER_W = HAMSTER[0]!.length;
export const HAMSTER_H = HAMSTER.length;
/** Hamsterin sol üst köşesi (konsol hücresi): alt satırı konsolun üst kenarına oturur */
export const HAMSTER_AT = { x: 91, y: 22 - HAMSTER.length + 1 };

const hamsterCache = new Map<boolean, HTMLCanvasElement>();
export function drawHamster(blink = false): HTMLCanvasElement {
  let c = hamsterCache.get(blink);
  if (!c) hamsterCache.set(blink, (c = paintHamster(blink)));
  return c;
}

function paintHamster(blink: boolean): HTMLCanvasElement {
  const g = new Grid(HAMSTER_W, HAMSTER_H);
  HAMSTER.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let ch = row[x]!;
      if (blink && (y === 8 || y === 9 || y === 10) && (ch === 'O' || ch === 'H') && ((x >= 11 && x <= 13) || (x >= 22 && x <= 24))) {
        ch = y === 10 ? 'O' : 'F';
      }
      if (ch !== '.') g.set(x, y, HAM_PAL[ch]!);
    }
  });
  return g.toCanvas('wcon__hamster');
}

/** Parıltı (4 köşeli yıldız, 9 × 9) */
export function drawSparkle(): HTMLCanvasElement {
  const g = new Grid(9, 9);
  star4(g, 4, 4, 4, '#bff4ff', '#3fa6ff');
  g.set(3, 3, '#7fd6ff');
  g.set(5, 3, '#7fd6ff');
  g.set(3, 5, '#7fd6ff');
  g.set(5, 5, '#7fd6ff');
  return g.toCanvas('wcon__spark');
}

/** Açılıştan önce (boşta) her şeyi hazırla: butona basınca panel beklemeden açılır */
export function prewarmConsole(): void {
  drawConsole();
  drawHamster(false);
  drawHamster(true);
}
