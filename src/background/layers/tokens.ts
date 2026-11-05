import { ridgeAt, type Scene } from '../scene';
import { hex } from '../util/color';
import { lerp } from '../util/math';
import { drawCentered, glowSprite, RectBatch } from '../util/pixel';

const MAX = 220;

interface StarBatches {
  light: RectBatch;
  body: RectBatch;
  dark: RectBatch;
  edge: RectBatch;
}

/**
 * Piksel yıldız (oyunun para birimi). Kare: 0 büyük 5×5 yıldız, 1/3 orta,
 * 2 minik parıltı → dönerken büyüyüp küçülerek parıldar.
 */
function addStar(b: StarBatches, x: number, y: number, frame: number): void {
  if (frame === 0) {
    b.light.add(x, y - 2, 1, 1);
    b.light.add(x - 1, y - 1, 1, 1);
    b.body.add(x, y - 1, 2, 1);
    b.body.add(x - 2, y, 5, 1);
    b.light.add(x - 1, y, 1, 1);
    b.body.add(x - 1, y + 1, 3, 1);
    b.dark.add(x + 1, y + 1, 1, 1);
    b.dark.add(x - 1, y + 2, 1, 1);
    b.dark.add(x + 1, y + 2, 1, 1);
  } else if (frame === 2) {
    b.light.add(x, y, 1, 1);
    b.edge.add(x, y - 1, 1, 1);
    b.edge.add(x, y + 1, 1, 1);
    b.edge.add(x - 1, y, 1, 1);
    b.edge.add(x + 1, y, 1, 1);
  } else {
    b.light.add(x, y - 1, 1, 1);
    b.body.add(x - 1, y, 3, 1);
    b.light.add(x, y, 1, 1);
    b.dark.add(x, y + 1, 1, 1);
  }
}

/**
 * Bloktan dökülen dönen piksel coinler (görsel efekt).
 * İleride "hamster yüksek değerli coin kazandı → yıldırım bloğa çarpar → token dökülür"
 * akışında kullanılmak üzere hazır. Herhangi bir bakiye/ödül mantığı içermez.
 */
export class TokenSpill {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private spinV = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private floor = new Float32Array(MAX);
  private bounced = new Uint8Array(MAX);
  private next = 0;
  private scene: Scene | null = null;
  private glow: HTMLCanvasElement | null = null;
  readonly light = new RectBatch();
  readonly body = new RectBatch();
  readonly dark = new RectBatch();
  readonly edge = new RectBatch();

  build(scene: Scene): void {
    this.scene = scene;
    this.life.fill(0);
    this.glow = glowSprite(4 * scene.u + 1, hex('#ffc04a'), 0.6, 3, 1.3);
  }

  spill(x: number, y: number, count: number): void {
    const s = this.scene;
    if (!s) return;
    for (let k = 0; k < count; k++) {
      const j = this.next;
      this.next = (j + 1) % MAX;
      this.x[j] = x + (Math.random() - 0.5) * 6 * s.u;
      this.y[j] = y;
      this.vx[j] = (Math.random() - 0.5) * 90 * s.u;
      this.vy[j] = -(25 + Math.random() * 70) * s.u;
      this.spin[j] = Math.random() * 4;
      this.spinV[j] = 8 + Math.random() * 10;
      this.life[j] = 3.2 + Math.random() * 1.2;
      const g = ridgeAt(s.groundTop, s, this.x[j]!, s.offsets.ground);
      this.floor[j] = g + 2 + Math.random() * (s.H - g) * 0.5;
      this.bounced[j] = 0;
    }
  }

  update(dt: number): void {
    const s = this.scene;
    if (!s) return;
    const g = 240 * s.u;
    for (let j = 0; j < MAX; j++) {
      if (this.life[j]! <= 0) continue;
      this.life[j]! -= dt;
      if (this.bounced[j] === 2) continue;
      this.vy[j]! += g * dt;
      this.x[j]! += this.vx[j]! * dt;
      this.y[j]! += this.vy[j]! * dt;
      this.spin[j]! += this.spinV[j]! * dt;
      if (this.y[j]! >= this.floor[j]!) {
        this.y[j] = this.floor[j]!;
        if (this.bounced[j] === 0) {
          this.vy[j] = -this.vy[j]! * 0.35;
          this.vx[j]! *= 0.5;
          this.bounced[j] = 1;
        } else {
          this.bounced[j] = 2; // yerde durur, yüzü görünür
          this.spin[j] = 0;
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.glow) return;
    let any = false;
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < MAX; j++) {
      const life = this.life[j]!;
      if (life <= 0) continue;
      any = true;
      const blink = life < 0.8 ? (Math.floor(life * 12) % 2 === 0 ? 0 : 1) : 1;
      if (!blink) continue;
      ctx.globalAlpha = this.bounced[j] === 2 ? 0.35 : 0.75;
      drawCentered(ctx, this.glow, this.x[j]!, this.y[j]!);
      const x = Math.round(this.x[j]!);
      const y = Math.round(this.y[j]!);
      addStar(this, x, y, Math.floor(this.spin[j]!) % 4);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!any) return;
    this.body.flush(ctx, '#ffd84d');
    this.light.flush(ctx, '#fff6c8');
    this.dark.flush(ctx, '#d8961e');
    this.edge.flush(ctx, '#fff0a0');
  }
}

const MAX_FLIGHTS = 96;

/**
 * Tamamlanan bloktan çıkıp oyun çerçevesinin sağ üstündeki token sayacına uçan coinler.
 * Coin hedefe varınca `onArrive` çağrılır (sayaç o anda artar).
 */
export class CoinFlights {
  onArrive: ((bonus: boolean) => void) | null = null;
  private x0 = new Float32Array(MAX_FLIGHTS);
  private y0 = new Float32Array(MAX_FLIGHTS);
  private t = new Float32Array(MAX_FLIGHTS);
  private dur = new Float32Array(MAX_FLIGHTS);
  private alive = new Uint8Array(MAX_FLIGHTS);
  private bonus = new Uint8Array(MAX_FLIGHTS);
  private next = 0;
  private flying = 0;
  private tx = 0;
  private ty = 0;
  private u = 1;
  private glow: HTMLCanvasElement | null = null;
  readonly light = new RectBatch();
  readonly body = new RectBatch();
  readonly dark = new RectBatch();
  readonly edge = new RectBatch();
  private trail = new RectBatch();

  build(scene: Scene): void {
    this.u = scene.u;
    this.glow = glowSprite(5 * scene.u + 1, hex('#ffc04a'), 0.7, 3, 1.3);
  }

  /** Sayacın sahnedeki konumu (iç piksel) */
  setTarget(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
  }

  /** Henüz sayaca varmamış coin sayısı */
  get inFlight(): number {
    return this.flying;
  }

  launch(x: number, y: number, delay = 0, bonus = false): void {
    const j = this.next;
    // Halka dolarsa en eski coini hemen teslim et
    if (this.alive[j]) {
      this.alive[j] = 0;
      this.flying--;
      this.onArrive?.(this.bonus[j] === 1);
    }
    this.next = (j + 1) % MAX_FLIGHTS;
    this.bonus[j] = bonus ? 1 : 0;
    this.flying++;
    this.x0[j] = x;
    this.y0[j] = y;
    this.t[j] = -delay;
    this.dur[j] = 0.75 + Math.min(0.6, Math.hypot(this.tx - x, this.ty - y) / (900 * this.u));
    this.alive[j] = 1;
  }

  private pos(j: number, k: number): [number, number] {
    const x0 = this.x0[j]!;
    const y0 = this.y0[j]!;
    // Önce yukarı küçük bir sıçrama, sonra sayaca doğru hızlanan yay
    const cx = lerp(x0, this.tx, 0.25);
    const cy = Math.max(2, Math.min(y0, this.ty) - 22 * this.u);
    const e = k * k * (3 - 2 * k);
    const a = 1 - e;
    return [a * a * x0 + 2 * a * e * cx + e * e * this.tx, a * a * y0 + 2 * a * e * cy + e * e * this.ty];
  }

  update(dt: number): void {
    for (let j = 0; j < MAX_FLIGHTS; j++) {
      if (!this.alive[j]) continue;
      this.t[j]! += dt;
      if (this.t[j]! >= this.dur[j]!) {
        this.alive[j] = 0;
        this.flying--;
        this.onArrive?.(this.bonus[j] === 1);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.glow) return;
    let any = false;
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < MAX_FLIGHTS; j++) {
      if (!this.alive[j] || this.t[j]! < 0) continue;
      any = true;
      const k = this.t[j]! / this.dur[j]!;
      const [x, y] = this.pos(j, k);
      ctx.globalAlpha = 0.8;
      drawCentered(ctx, this.glow, x, y);
      const [px, py] = this.pos(j, Math.max(0, k - 0.06));
      this.trail.add(Math.round(px), Math.round(py));
      const [qx, qy] = this.pos(j, Math.max(0, k - 0.12));
      this.trail.add(Math.round(qx), Math.round(qy));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!any) return;
    this.trail.flush(ctx, '#ffe58a', 0.7);
    for (let j = 0; j < MAX_FLIGHTS; j++) {
      if (!this.alive[j] || this.t[j]! < 0) continue;
      const [fx, fy] = this.pos(j, this.t[j]! / this.dur[j]!);
      const x = Math.round(fx);
      const y = Math.round(fy);
      addStar(this, x, y, Math.floor(this.t[j]! * 14 + j) % 4);
    }
    this.body.flush(ctx, '#ffd84d');
    this.light.flush(ctx, '#fff6c8');
    this.dark.flush(ctx, '#d8961e');
    this.edge.flush(ctx, '#fff0a0');
  }
}
