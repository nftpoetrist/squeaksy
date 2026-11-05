import {
  ANCHOR_X,
  ANCHOR_Y,
  DEFAULT_POSE,
  drawHamsterPose as drawPose,
  EYE_RECT,
  HAMSTER_PALETTE,
  type Foot,
  type HamsterFrame,
  type HamsterPose,
  type HamsterVariant,
  variantPalette,
  companionBounds,
} from '../../character/hamsterBase';
import { BuddyFx, columnTops, HamsterAura } from './hamsterFx';
import type { PixsyKind } from '../../character/companion';
import type { Frame } from '../scene';
import { RectBatch } from '../util/pixel';

/* =====================================================================
 * ANİMASYON KARELERİ — onaylı temel karakterden üretilir
 *
 * Koşu (8 kare, tırıs): çapraz patiler birlikte basar (yakın ön + uzak arka,
 * yakın arka + uzak ön). Basan pati kare başına STRIDE piksel geriye gider;
 * animasyon hızı = bant hızı / STRIDE olduğundan patiler çarkın yüzeyinde kaymaz.
 * Her basışta gövde hafifçe sıkışır, sonra yükselir; kafa bir kare, kulaklar,
 * yanaklar ve kuyruk iki kare geriden takip eder. Silüet ve oranlar sabittir.
 * ===================================================================== */

const RUN_FRAMES = 8;
const STRIDE = 2;
const FOOT: Foot[] = [
  [3, 0],
  [1, 0],
  [-1, 0],
  [-3, 0],
  [-2, 1],
  [0, 1],
  [2, 1],
  [3, 1],
];
const BOB = {
  normal: [1, 0, -1, 0, 1, 0, -1, 0],
  fast: [1, 0, -1, -1, 1, 0, -1, -1],
  tired: [1, 1, 0, 0, 1, 1, 0, 0],
} as const;
type RunStyle = keyof typeof BOB;

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function runPose(k: number, style: RunStyle, eyes: HamsterPose['eyes'] = 'open'): HamsterPose {
  const b = BOB[style];
  const at = (i: number) => b[(i + RUN_FRAMES * 2) % RUN_FRAMES]!;
  const ph = (i: number) => FOOT[(i + RUN_FRAMES) % RUN_FRAMES]!;
  const landing = k % 4 === 0;
  return {
    bob: at(k),
    // Kafa bir kare, kulak/yanak iki kare geriden gelir (ikincil hareket)
    headBob: clamp1(at(k - 1) - at(k)) + (style === 'tired' ? 1 : 0),
    squash: landing ? (style === 'fast' ? 0.6 : 0.45) : 0,
    ear: clamp1(at(k - 2) - at(k - 1)),
    earNear: 0,
    cheek: (at(k - 2) - at(k - 1)) * 0.5,
    tail: clamp1(at(k - 1) - at(k)),
    feet: [ph(k + 4), ph(k), ph(k), ph(k + 4)],
    eyes: style === 'tired' ? 'half' : eyes,
    mouth: style === 'tired' ? (k % 4 < 2 ? 'pant' : 'open') : style === 'fast' ? 'open' : k % 4 === 2 ? 'open' : 'closed',
    rest: false,
    companion: true,
    // Sırttaki yaratık bir kare geriden zıplar (üstünde oturuyor hissi)
    companionBob: clamp1(at(k - 1) - at(k)),
  };
}

const pose = (p: Partial<HamsterPose>): HamsterPose => ({ ...DEFAULT_POSE, ...p });

class HamsterSprites {
  readonly run: HamsterFrame[];
  readonly fast: HamsterFrame[];
  readonly boost: HamsterFrame[];
  readonly tired: HamsterFrame[];
  readonly idle: HamsterFrame[];
  readonly idleEar: HamsterFrame;
  readonly sleep: HamsterFrame[];
  readonly alert: HamsterFrame;
  readonly crouch: HamsterFrame;
  readonly air: HamsterFrame;

  constructor(
    readonly variant: HamsterVariant = 'starter',
    /** Sırttaki Pixsy türü (null = eşya takılı değil) */
    readonly buddy: PixsyKind | null = 'pixsy',
  ) {
    const drawHamsterPose = (p: HamsterPose) => drawPose({ ...p, companion: p.companion && buddy !== null }, variant, buddy ?? 'pixsy');
    const set = (style: RunStyle, eyes: HamsterPose['eyes'] = 'open') =>
      Array.from({ length: RUN_FRAMES }, (_, k) => drawHamsterPose(runPose(k, style, eyes)));
    this.run = set('normal');
    this.fast = set('fast');
    this.boost = set('fast', 'spark');
    this.tired = set('tired');
    // Nefes: hafif sıkışma döngüsü
    this.idle = [0, 0.2, 0.4, 0.2].map((sq) => drawHamsterPose(pose({ squash: sq, cheek: sq })));
    this.idleEar = drawHamsterPose(pose({ squash: 0.2, earNear: -1 }));
    this.sleep = [0.9, 1.2].map((sq) => drawHamsterPose(pose({ squash: sq, headBob: 1, eyes: 'closed', rest: true })));
    this.alert = drawHamsterPose(pose({ ear: -1, mouth: 'open' }));
    this.crouch = drawHamsterPose(
      pose({
        bob: 1,
        squash: 0.8,
        ear: 1,
        feet: [
          [1, 0],
          [-1, 0],
          [1, 0],
          [-1, 0],
        ],
        mouth: 'open',
      }),
    );
    this.air = drawHamsterPose(
      pose({
        bob: -1,
        ear: 1,
        tail: -1,
        feet: [
          [-2, 1],
          [3, 1],
          [-2, 1],
          [3, 1],
        ],
        mouth: 'open',
      }),
    );
  }
}

const EYE_W = EYE_RECT.w;
const EYE_H = EYE_RECT.h;
/** Göz kırpma kapağı: gözün olduğu bandın kürk rengi */
function lidColors(v: HamsterVariant): { fur: string; eye: string } {
  const p = variantPalette(v);
  return { fur: v === 'inferno' ? p.F2 : p.F, eye: p.E };
}
void HAMSTER_PALETTE;

/* =====================================================================
 * DAVRANIŞ: durum makinesi + koşu modları
 * ===================================================================== */

/**
 * sleep     : zeminde yatağında uyur (Zzz)
 * wake      : uyanır, kulaklar dikilir (!), kısa sıçrama
 * walkIn    : çarkın girişine yürür (sola bakar)
 * jumpIn    : yay çizerek çarkın içine zıplar
 * run       : çarkta koşar — çarkı döndüren güç hamsterdir
 * brake     : yavaşlar; ayaklar yavaşlayan bantla birlikte yavaşlar
 * wheelIdle : çarkta durur, nefes alır, göz kırpar, kulak oynatır
 * jumpOut   : çarktan zemine zıplar
 * walkOut   : yatağına yürür (sağa bakar)
 * settle    : kıvrılıp yatar, sonra uyur
 */
export type HamsterState = 'sleep' | 'wake' | 'walkIn' | 'jumpIn' | 'run' | 'brake' | 'wheelIdle' | 'jumpOut' | 'walkOut' | 'settle';

/** Koşu modu (oyun ilerledikçe kullanılacak) */
export type HamsterMood = 'normal' | 'fast' | 'tired';

export interface HamsterSpeeds {
  normal: number;
  fast: number;
  tired: number;
  boost: number;
}

export interface HamsterLayout {
  cx: number;
  cy: number;
  innerR: number;
  plateRight: number;
  groundY: number;
  plateTop: number;
  bedX: number;
}

const WALK_SPEED = 26; // iç piksel / sn
const WAKE_TIME = 0.85;
const JUMP_TIME = 0.55;
const SETTLE_TIME = 0.7;
const BOOST_TIME = 1.8;
const BOOST_WINDUP = 0.16;

export class HamsterActor {
  private sp = new HamsterSprites();
  private aura = new HamsterAura('starter');
  /** Sırttaki Rare/Legendary Pixsy'nin efekti (ETH yıldızlar, BTC alevler) */
  private buddyFx: BuddyFx | null = null;
  private pal = lidColors('starter');
  private L: HamsterLayout | null = null;
  state: HamsterState = 'sleep';
  mood: HamsterMood = 'normal';
  speeds: HamsterSpeeds = { normal: 48, fast: 72, tired: 28, boost: 100 };
  /** Çarktayken dinlenme süresi dolunca yatağa döner (sn) */
  restBeforeBed = 3;

  private wantRun = false;
  private stateT = 0;
  private time = 0;
  private x = 0;
  private y = 0;
  private facing: 1 | -1 = -1;
  private jumpFrom = { x: 0, y: 0 };
  private jumpTo = { x: 0, y: 0 };
  private cycle = 0;
  private blinkIn = 2.5;
  private blinkT = 0;
  private earTwitchIn = 3;
  private earTwitchT = 0;
  private boostT = 0;
  private tread = 0;
  private onChange: ((s: HamsterState) => void) | null = null;

  private puffs: Array<{ x: number; y: number; age: number; life: number }> = [];
  private sparks: Array<{ x: number; y: number; age: number; life: number; seed: number }> = [];
  private puffIn = 0;
  private sparkIn = 0;
  private puffBatch = new RectBatch();
  private puffShade = new RectBatch();
  private lines = new RectBatch();
  private fx = new RectBatch();
  private sparkA = new RectBatch();
  private sparkB = new RectBatch();
  private shadow = new RectBatch();
  private lid = new RectBatch();
  private lidLine = new RectBatch();

  get variant(): HamsterVariant {
    return this.sp.variant;
  }

  /** Koşan hamsterin türünü değiştirir (satın alınmış hamsterle değiş-tokuş) */
  /** İç piksel (x, y) sırttaki Pixsy'nin üstünde mi (çıkarmak için tıklama) */
  buddyHit(x: number, y: number): boolean {
    if (!this.L || this.sp.buddy === null) return false;
    const [fx, fy] = this.footPos();
    const ox = Math.round(fx - ANCHOR_X);
    const oy = Math.round(fy - ANCHOR_Y);
    const flip = this.frame().flip;
    const b = companionBounds();
    const pad = 2;
    const sx0 = flip ? ox + 2 * ANCHOR_X - b.x1 : ox + b.x0;
    const sx1 = flip ? ox + 2 * ANCHOR_X - b.x0 : ox + b.x1;
    return x >= sx0 - pad && x <= sx1 + pad && y >= oy + b.y0 - pad - 1 && y <= oy + b.y1 + pad;
  }

  /** Sırttaki Pixsy türü (null = takılı değil) */
  get buddy(): PixsyKind | null {
    return this.sp.buddy;
  }

  /** Görünüm: hamster türü + sırttaki eşya. Değişince kareler yeniden üretilir. */
  setLook(v: HamsterVariant, buddy: PixsyKind | null): void {
    if (v === this.sp.variant && buddy === this.sp.buddy) return;
    const variantChanged = v !== this.sp.variant;
    this.sp = new HamsterSprites(v, buddy);
    if (variantChanged) {
      this.aura = new HamsterAura(v);
      this.pal = lidColors(v);
    }
    // Değişim anı: küçük toz/ışık bulutu
    const [px, py] = this.L ? this.footPos() : [0, 0];
    for (let i = 0; i < 6; i++) this.puffs.push({ x: px + (Math.random() - 0.5) * 24, y: py - Math.random() * 14, age: 0, life: 0.5 + Math.random() * 0.3 });
  }

  onStateChange(fn: (s: HamsterState) => void): void {
    this.onChange = fn;
  }

  layout(L: HamsterLayout): void {
    const first = this.L === null;
    this.L = L;
    if (first || this.state === 'sleep' || this.state === 'settle') {
      this.x = L.bedX;
      this.y = L.groundY - 1;
    } else if (!this.inWheel) {
      this.x = Math.min(Math.max(this.x, L.plateRight - 10), L.bedX);
      this.y = this.floorAt(this.x);
    }
  }

  get desired(): boolean {
    return this.wantRun;
  }

  get boosting(): boolean {
    return this.boostT > 0;
  }

  setRunning(on: boolean): void {
    if (on === this.wantRun) return;
    this.wantRun = on;
    if (!on) {
      this.boostT = 0;
      if (this.state === 'run') this.go('brake');
      return;
    }
    switch (this.state) {
      case 'sleep':
      case 'settle':
        this.go('wake');
        break;
      case 'walkOut':
        this.go('walkIn');
        break;
      case 'wheelIdle':
      case 'brake':
        this.go('run');
        break;
      default:
        break;
    }
  }

  /**
   * Hemen uyu: koşu isteği kapanır, hamster animasyonsuz olarak yatağına yerleşir.
   * Siteden çıkınca / başka sekmeye geçince / leaderboard açılınca kullanılır (yıldız kazanımı durur).
   */
  sleepNow(): void {
    this.wantRun = false;
    this.boostT = 0;
    if (this.L) {
      this.x = this.L.bedX;
      this.y = this.L.groundY - 1;
    }
    this.go('sleep');
  }

  /** Thunder boost: kısa ivmelenme + hızlı koşu + elektrik kıvılcımları (sadece koşarken) */
  boost(): void {
    if (this.state !== 'run') return;
    this.boostT = BOOST_TIME + BOOST_WINDUP;
  }

  get inWheel(): boolean {
    return this.state === 'run' || this.state === 'brake' || this.state === 'wheelIdle';
  }

  /** Çark bandının hedef hızı (iç piksel/sn): çarkı hamster döndürür */
  get targetTread(): number {
    if (this.state !== 'run') return 0;
    if (this.boostT > 0) return this.speeds.boost;
    return this.speeds[this.mood];
  }

  private go(s: HamsterState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
    const L = this.L;
    if (L && s === 'jumpIn') {
      this.jumpFrom = { x: this.x, y: this.y };
      this.jumpTo = { x: L.cx, y: L.cy + L.innerR - 1 };
    }
    if (L && s === 'jumpOut') {
      this.jumpFrom = { x: L.cx, y: L.cy + L.innerR - 1 };
      this.jumpTo = { x: L.plateRight + 8, y: L.groundY - 1 };
    }
    this.onChange?.(s);
  }

  private floorAt(x: number): number {
    const L = this.L!;
    return x < L.plateRight ? L.plateTop - 1 : L.groundY - 1;
  }

  update(dt: number, wheelSpeed: number): void {
    const L = this.L;
    if (!L) return;
    this.time += dt;
    this.stateT += dt;
    this.tread = Math.abs(wheelSpeed) * L.innerR;
    const entryX = L.cx + L.innerR * 0.7;

    switch (this.state) {
      case 'sleep':
        break;
      case 'wake':
        if (this.stateT >= WAKE_TIME) this.go(this.wantRun ? 'walkIn' : 'settle');
        break;
      case 'walkIn':
        this.facing = -1;
        this.x -= WALK_SPEED * dt;
        this.y = this.floorAt(this.x);
        this.cycle += (dt * WALK_SPEED) / STRIDE;
        if (this.x <= entryX) {
          this.x = entryX;
          this.go(this.wantRun ? 'jumpIn' : 'walkOut');
        }
        break;
      case 'jumpIn':
        if (this.stateT >= JUMP_TIME) this.go(this.wantRun ? 'run' : 'wheelIdle');
        break;
      case 'run':
        this.facing = 1;
        if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt);
        // Başlangıçta çarkı iterek hızlandırır; sonra adımlar bant hızına kilitlenir
        this.cycle += dt * Math.max(10, this.tread / STRIDE);
        break;
      case 'brake':
        this.cycle += (dt * this.tread) / STRIDE;
        if (this.tread < 5) this.go('wheelIdle');
        break;
      case 'wheelIdle':
        if (this.wantRun) this.go('run');
        else if (this.stateT >= this.restBeforeBed) this.go('jumpOut');
        break;
      case 'jumpOut':
        if (this.stateT >= JUMP_TIME) {
          this.x = this.jumpTo.x;
          this.y = this.jumpTo.y;
          this.go(this.wantRun ? 'walkIn' : 'walkOut');
        }
        break;
      case 'walkOut':
        this.facing = 1;
        this.x += WALK_SPEED * dt;
        this.y = this.floorAt(this.x);
        this.cycle += (dt * WALK_SPEED) / STRIDE;
        if (this.x >= L.bedX) {
          this.x = L.bedX;
          this.go('settle');
        }
        break;
      case 'settle':
        if (this.stateT >= SETTLE_TIME) this.go('sleep');
        break;
    }
    this.cycle %= RUN_FRAMES * 1000;

    // Göz kırpma ve kulak seğirmesi
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0.12;
      this.blinkIn = 2.2 + Math.random() * 3.5;
    }
    this.blinkT = Math.max(0, this.blinkT - dt);
    this.earTwitchIn -= dt;
    if (this.earTwitchIn <= 0) {
      this.earTwitchT = 0.18;
      this.earTwitchIn = 3 + Math.random() * 4;
    }
    this.earTwitchT = Math.max(0, this.earTwitchT - dt);

    // Toz: hızlı koşu / boost / yürüme
    this.puffIn -= dt;
    const fastRun = this.state === 'run' && (this.mood === 'fast' || this.boostT > 0) && this.tread > 30;
    const walking = this.state === 'walkIn' || this.state === 'walkOut';
    if ((fastRun || walking) && this.puffIn <= 0) {
      const [px, py] = this.footPos();
      this.puffs.push({ x: px - this.facing * 10, y: py, age: 0, life: 0.4 + Math.random() * 0.2 });
      this.puffIn = fastRun ? 0.08 + Math.random() * 0.06 : 0.32;
    }
    for (const p of this.puffs) {
      p.age += dt;
      p.x -= this.state === 'run' ? this.facing * dt * this.tread * 0.6 : 0;
      p.y -= dt * 6;
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);

    // Thunder boost kıvılcımları
    this.sparkIn -= dt;
    if (this.boostT > 0 && this.state === 'run' && this.sparkIn <= 0) {
      const [px, py] = this.footPos();
      this.sparks.push({ x: px + (Math.random() - 0.5) * 32, y: py - 2 - Math.random() * 19, age: 0, life: 0.2 + Math.random() * 0.2, seed: Math.random() });
      this.sparkIn = 0.025;
    }
    for (const sp of this.sparks) sp.age += dt;
    this.sparks = this.sparks.filter((sp) => sp.age < sp.life);
  }

  private footPos(): [number, number] {
    const L = this.L!;
    if (this.inWheel) return [L.cx, L.cy + L.innerR - 1];
    if (this.state === 'jumpIn' || this.state === 'jumpOut') {
      const k = Math.min(1, this.stateT / JUMP_TIME);
      const x = this.jumpFrom.x + (this.jumpTo.x - this.jumpFrom.x) * k;
      const apex = Math.min(this.jumpFrom.y, this.jumpTo.y) - 14;
      const yLin = this.jumpFrom.y + (this.jumpTo.y - this.jumpFrom.y) * k;
      return [x, yLin - 4 * k * (1 - k) * (yLin - apex)];
    }
    return [this.x, this.y];
  }

  private runSet(): HamsterFrame[] {
    if (this.boostT > 0) return this.sp.boost;
    if (this.mood === 'fast') return this.sp.fast;
    if (this.mood === 'tired') return this.sp.tired;
    return this.sp.run;
  }

  private frame(): { f: HamsterFrame; flip: boolean; airborne: boolean } {
    const sp = this.sp;
    const flip = this.facing < 0;
    const k = Math.floor(this.cycle) % RUN_FRAMES;
    switch (this.state) {
      case 'sleep':
        return { f: sp.sleep[Math.sin(this.time * 1.6) > 0 ? 1 : 0]!, flip: false, airborne: false };
      case 'settle':
        return { f: this.stateT < SETTLE_TIME * 0.5 ? sp.crouch : sp.sleep[0]!, flip: false, airborne: false };
      case 'wake':
        return { f: this.stateT < 0.15 ? sp.sleep[0]! : this.stateT < 0.32 ? sp.crouch : sp.alert, flip: true, airborne: false };
      case 'jumpIn':
      case 'jumpOut': {
        const j = this.stateT / JUMP_TIME;
        return { f: j < 0.14 || j > 0.88 ? sp.crouch : sp.air, flip: this.state === 'jumpIn' ? j < 0.5 : false, airborne: j > 0.14 && j < 0.88 };
      }
      case 'run':
        if (this.boostT > BOOST_TIME) return { f: sp.crouch, flip, airborne: false }; // ivmelenme hazırlığı
        return { f: this.runSet()[k]!, flip, airborne: k % 4 === 2 };
      case 'brake':
      case 'walkIn':
      case 'walkOut':
        return { f: sp.run[k]!, flip, airborne: false };
      case 'wheelIdle': {
        if (this.earTwitchT > 0) return { f: sp.idleEar, flip: false, airborne: false };
        const i = Math.floor(this.time * 2.4) % sp.idle.length;
        return { f: sp.idle[i]!, flip: false, airborne: false };
      }
    }
  }

  /** Değiş-tokuş animasyonu sırasında gizli (yerine koşan hamster gelene kadar) */
  hidden = false;

  /** Ayak noktası (iç piksel): değiş-tokuş koşucularının hedefi */
  get feet(): [number, number] {
    return this.L ? this.footPos() : [0, 0];
  }

  /** Sırttaki Pixsy'nin sahnedeki merkezi (iç piksel): uçuş animasyonu için */
  buddyCenter(): [number, number] {
    const [fx, fy] = this.footPos();
    const ox = Math.round(fx - ANCHOR_X);
    const oy = Math.round(fy - ANCHOR_Y);
    const b = companionBounds();
    const flip = this.frame().flip;
    const cx = (b.x0 + b.x1) / 2;
    return [flip ? ox + 2 * ANCHOR_X - cx : ox + cx, oy + (b.y0 + b.y1) / 2];
  }

  draw(ctx: CanvasRenderingContext2D, fr: Frame): void {
    if (!this.L || this.hidden) return;
    const [fx, fy] = this.footPos();
    const wakeHop = this.state === 'wake' && this.stateT > 0.32 && this.stateT < 0.56 ? -2 : 0;
    const ox = Math.round(fx - ANCHOR_X);
    const oy = Math.round(fy - ANCHOR_Y + wakeHop);
    const { f, flip, airborne } = this.frame();

    // Gövde altındaki gölge (havadayken küçülür)
    if (this.state !== 'jumpIn' && this.state !== 'jumpOut') {
      const w = this.state === 'sleep' || this.state === 'settle' ? 24 : airborne ? 18 : 24;
      const gx = Math.round(fx - w / 2 + (flip ? -1 : 1));
      const gy = Math.round(fy + 1);
      this.shadow.add(gx + 2, gy, w - 4, 1);
      this.shadow.add(gx, gy - 1, w, 1);
      this.shadow.flush(ctx, '#0c0818', 0.35);
    }

    // Hız çizgileri: hızlı koşu / boost
    if (this.state === 'run' && (this.mood === 'fast' || this.boostT > 0) && this.tread > 40) {
      const k = Math.min(1, (this.tread - 40) / 30);
      for (let i = 0; i < 4; i++) {
        if (Math.sin(fr.t * 24 + i * 2.1) < -0.25) continue;
        const len = 4 + ((i * 3 + Math.floor(fr.t * 14)) % 5);
        this.lines.add(ox + 2 - len - i * 2, oy + 14 + i * 3, len, 1);
      }
      this.lines.flush(ctx, this.boostT > 0 ? '#bff4ff' : '#dff1ff', 0.55 * k);
    }

    // Tür efekti (alev / parıltı): sprite'ın arkası
    const power = this.state === 'run' ? 1 : this.state === 'sleep' || this.state === 'settle' ? 0.25 : 0.6;
    this.aura.update(fr.dt, fx, fy - 10, power);
    this.aura.drawBehind(ctx, f.img, ox, oy, flip, fr.t, power);

    // Sırttaki Pixsy'nin efekti (arka katman: ışık + BTC alevleri)
    const kind = this.sp.buddy;
    if (kind === 'eth' || kind === 'btc') {
      if (this.buddyFx?.kind !== kind) this.buddyFx = new BuddyFx(kind);
      const b = companionBounds();
      const [bcx, bcy] = this.buddyCenter();
      const tops = columnTops(f.img, b.x0, b.x1).map(([x, y]) => [flip ? ox + 2 * ANCHOR_X - x : ox + x, oy + y] as [number, number]);
      this.buddyFx.update(fr.dt, bcx, bcy, b.x1 - b.x0 + 1);
      this.buddyFx.drawBehind(ctx, bcx, bcy, tops, fr.t);
    } else {
      this.buddyFx = null;
    }

    // Sprite (yönüne göre aynalanır)
    if (flip) {
      ctx.save();
      ctx.translate(ox + 2 * ANCHOR_X + 1, oy);
      ctx.scale(-1, 1);
      ctx.drawImage(f.img, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(f.img, ox, oy);
    }

    // Göz katmanları: kırpma ve boost parıltısı (göz konumu kare verisinden)
    if (f.eye) {
      const [exs, eys] = f.eye;
      const ex = flip ? ox + 2 * ANCHOR_X + 1 - (exs + EYE_W) : ox + exs;
      const ey = oy + eys;
      if (this.blinkT > 0 && this.state !== 'wake') {
        this.lid.add(ex, ey, EYE_W, EYE_H);
        this.lidLine.add(ex, ey + 3, EYE_W, 1);
        this.lid.flush(ctx, this.pal.fur);
        this.lidLine.flush(ctx, this.pal.eye);
      }
    }

    this.aura.drawFront(ctx);
    this.buddyFx?.drawFront(ctx);

    // Toz bulutları
    for (const p of this.puffs) {
      const t = p.age / p.life;
      const r = 1 + Math.round(t * 2);
      const x = Math.round(p.x);
      const y = Math.round(p.y - 1);
      this.puffBatch.add(x - r + 1, y - 1, r * 2 - 1, 2);
      this.puffBatch.add(x - r + 2, y - 2, Math.max(1, r * 2 - 3), 1);
      this.puffShade.add(x - r + 1, y + 1, r * 2 - 1, 1);
    }
    this.puffBatch.flush(ctx, '#ffffff', 0.7);
    this.puffShade.flush(ctx, '#cfc8ee', 0.55);

    // Thunder boost: hamsterin çevresinde çıtırdayan mavi elektrik
    for (const sp of this.sparks) {
      const x = Math.round(sp.x);
      const y = Math.round(sp.y);
      const b = sp.seed > 0.5 ? this.sparkA : this.sparkB;
      b.add(x, y, 1, 1);
      b.add(x + (sp.seed > 0.3 ? 1 : -1), y + 1, 1, 1);
      b.add(x, y + 2, 1, 1);
      if (sp.seed > 0.7) b.add(x + 1, y + 3, 1, 1);
    }
    this.sparkA.flush(ctx, '#ffffff');
    this.sparkB.flush(ctx, '#6fe3ff');

    // Uyku: yükselen "z"ler · Uyanış: "!!"
    if (this.state === 'sleep') {
      for (let i = 0; i < 3; i++) {
        const t = (this.time * 0.35 + i / 3) % 1;
        const zx = Math.round(ox + 27 + t * 6 + i);
        const zy = Math.round(oy + 11 - t * 12);
        const sz = i === 2 ? 3 : 2;
        this.fx.add(zx, zy, sz, 1);
        for (let k = 1; k < sz; k++) this.fx.add(zx + sz - 1 - k, zy + k, 1, 1);
        this.fx.add(zx, zy + sz, sz, 1);
      }
      this.fx.flush(ctx, '#bfe6ff', 0.9);
    } else if (this.state === 'wake' && this.stateT > 0.15) {
      const bx = ox + 23;
      const by = oy + 1;
      this.fx.add(bx, by, 1, 3);
      this.fx.add(bx, by + 4, 1, 1);
      this.fx.add(bx + 3, by - 1, 1, 3);
      this.fx.add(bx + 3, by + 3, 1, 1);
      this.fx.flush(ctx, '#ffd84d');
    }
  }
}

/** Geliştirme/inceleme için tüm kareler */
/** Değiş-tokuş koşucuları için koşu kareleri (tür + sırttaki eşya başına önbellekli) */
const runCache = new Map<string, HamsterFrame[]>();
export function hamsterRunFrames(variant: HamsterVariant, buddy: PixsyKind | null): HamsterFrame[] {
  const key = `${variant}:${buddy}`;
  let f = runCache.get(key);
  if (!f) {
    f = new HamsterSprites(variant, buddy).run;
    runCache.set(key, f);
  }
  return f;
}

/** Koşu karesi başına ilerleme (iç piksel): patiler zeminde kaymasın */
export const RUN_STRIDE = STRIDE;
