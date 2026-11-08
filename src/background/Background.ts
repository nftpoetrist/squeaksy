import { DEFAULT_CONFIG, mergeConfig, type BackgroundConfig, type DeepPartial } from './config';
import { EventBus } from './events';
import { CelestialLayer } from './layers/celestial';
import { BlockCloudLayer, REAL_CLUSTER, type RealCloudState } from './layers/blockClouds';
import { LandscapeLayer } from './layers/landscape';
import { LightningSystem } from './layers/lightning';
import { HamsterActor, type HamsterMood, type HamsterState } from './layers/hamster';
import { HutLayer, itemSprite, type HutSpot } from './layers/hut';
import { LookTransitions } from './layers/swapFx';
import type { HamsterVariant } from '../character/hamsterBase';
import type { PixsyKind } from '../character/companion';
import { WheelLayer, type WheelGeometry } from './layers/wheel';
import { MotesLayer } from './layers/motes';
import { RainLayer } from './layers/rain';
import { SkyLayer } from './layers/sky';
import { StarsLayer } from './layers/stars';
import { CoinFlights, TokenSpill } from './layers/tokens';
import type { Frame, Scene } from './scene';
import type { BackgroundEvents, LightningKind, QualityLevel, WeatherMode, WeatherParams } from './types';
import { clamp, smoothstep } from './util/math';
import { bayer, createCanvas } from './util/pixel';
import { mulberry32 } from './util/rng';
import { WeatherSystem } from './weather';

const QUALITY_MULT: Record<QualityLevel, number> = { high: 1, medium: 0.65, low: 0.4 };
const QUALITY_ORDER: QualityLevel[] = ['high', 'medium', 'low'];
/** Sarsıntıda kenarların boş görünmemesi için her yandaki fazlalık (iç piksel) */
const MARGIN = 3;

/** Zincir döngüsü: dolum → final şimşek fırtınası → hepsine vuruş → bekleme → baştan */
type ChainPhase = 'fill' | 'charge' | 'cooldown';

export interface BackgroundStats {
  fps: number;
  /** Ortalama çizim süresi (ms) */
  workMs: number;
  quality: QualityLevel;
  scale: number;
  width: number;
  height: number;
  mode: WeatherMode;
  autoCycle: boolean;
  timeLeft: number;
}

/**
 * Squeaksy'nin yaşayan piksel sanat arka planı.
 *
 * Düşük çözünürlüklü tek bir tuvale çizer ve CSS ile tam sayı katında büyütür.
 * Oyun mantığından tamamen bağımsızdır; dış dünya ile sadece `events`
 * (ör. 'lightning:strike') ve aşağıdaki küçük API üzerinden konuşur.
 */
export class PixelStormBackground {
  readonly events = new EventBus<BackgroundEvents>();

  private cfg: BackgroundConfig;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly weather: WeatherSystem;

  private scene: Scene | null = null;
  private readonly sky = new SkyLayer();
  private readonly stars = new StarsLayer();
  private readonly celestial = new CelestialLayer();
  private readonly land = new LandscapeLayer();
  private readonly wheel = new WheelLayer();
  private readonly hamster = new HamsterActor();
  private readonly hut = new HutLayer();
  private readonly looks = new LookTransitions();
  private readonly blocks = new BlockCloudLayer();
  private readonly tokens = new TokenSpill();
  private readonly flights = new CoinFlights();
  /** Token kazanımı açık mı (X ile giriş yapılmışsa) */
  private earning = false;
  /** Blok başı uçan coin (= token) sayısı */
  private perBlock = 1;
  /** Küsuratlı oranlarda (1.5) uçacak yıldız biriktiricisi */
  private coinAcc = 0;
  private chainPhase: ChainPhase = 'fill';
  private phaseT = 0;
  private finaleGap = 0;
  private resetAt = -1;
  private megaFlash = 0;
  /** Gerçek blok inişi: sıradaki camgöbeği yıldırımların zamanları (saniye) */
  private realStrikes: number[] = [];
  /** Token sayacının sahnedeki (CSS piksel) konumu */
  private tokenTarget = { x: 0, y: 0 };
  private readonly rain = new RainLayer();
  private readonly motes = new MotesLayer();
  private readonly lightning: LightningSystem;
  private vignette: HTMLCanvasElement | null = null;

  private running = false;
  private raf = 0;
  private lastRender = 0;
  /** Ekran dışında: simülasyon sürer (hamster koşar, yıldız kazanılır) ama çizim yapılmaz */
  private offscreen = false;
  private time = 0;
  private scale = 3;
  private quality: QualityLevel = 'high';
  private perfAcc = 0;
  private perfFrames = 0;
  private workMs = 0;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private tickAcc = 0;
  private pointer = { tx: 0, ty: 0, x: 0, y: 0 };
  private reduced = false;
  private resizeTimer = 0;
  private readonly cleanups: Array<() => void> = [];
  private readonly frame: Frame;

  constructor(container: HTMLElement, overrides: DeepPartial<BackgroundConfig> = {}) {
    this.root = container;
    this.cfg = mergeConfig(DEFAULT_CONFIG, overrides);
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D desteklenmiyor');
    this.ctx = ctx;
    container.appendChild(this.canvas);

    this.weather = new WeatherSystem(this.cfg.weather, this.events);
    this.hamster.restBeforeBed = this.cfg.hamster.restBeforeBed;
    this.hamster.speeds = { ...this.cfg.hamster.speeds };
    this.hamster.onStateChange((state) => this.events.emit('hamster:state', { state, running: this.hamster.desired }));
    this.lightning = new LightningSystem(this.events);
    // Yıldırım hedefleri = blok bulutları; isabette coin dökülmesi isteğe bağlı
    this.lightning.setTargets({
      pick: (prefer) => this.blocks.pickTarget(prefer),
      hit: (target, power, coins) => {
        this.blocks.hit(target, power);
        if (coins > 0) this.tokens.spill(target.x, target.y, Math.round(coins * Math.max(0.5, this.frame?.q ?? 1)));
      },
    });
    this.flights.onArrive = (bonus) => this.events.emit('token:collect', { bonus });
    this.frame = { t: 0, dt: 0, p: this.weather.params, q: 1, flash: 0, px: 0, py: 0, parallax: 0 };

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.cfg.respectReducedMotion && mq.matches;
    const onMq = () => {
      this.reduced = this.cfg.respectReducedMotion && mq.matches;
    };
    mq.addEventListener('change', onMq);
    this.cleanups.push(() => mq.removeEventListener('change', onMq));

    this.quality = this.cfg.quality === 'auto' ? (window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high') : this.cfg.quality;

    let hidden = false;
    const onResize = () => {
      window.clearTimeout(this.resizeTimer);
      // Panel gizliyken (Leaderboard sayfası: display:none → 0×0) sahne yeniden kurulmaz; aksi halde
      // pencere boyutunda kurulur ve geri dönüşte panel bir an büyüyüp küçülür. Boyut aynıysa da kurulmaz.
      if (this.root.clientWidth === 0 || this.root.clientHeight === 0) {
        hidden = true;
        return;
      }
      const wasHidden = hidden;
      hidden = false;
      if (this.root.clientWidth === this.builtW && this.root.clientHeight === this.builtH) return;
      // Gizliyken pencere boyutu değiştiyse panel görünür olur olmaz (beklemeden) yeniden kurulur
      if (wasHidden) this.rebuild();
      else {
        // Yeniden kurulana kadar mevcut görüntü yeni kutuya anında esnetilir: panel genişlerken (ör. MetaMask'ın
        // Chrome yan paneli kapanırken) sağda boş / kara şerit kalmaz
        this.stretchToBox();
        this.resizeTimer = window.setTimeout(() => this.rebuild(), 120);
      }
    };
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));
    if ('ResizeObserver' in window) {
      let first = true;
      const ro = new ResizeObserver(() => {
        if (first) {
          first = false;
          return;
        }
        onResize();
      });
      ro.observe(container);
      this.cleanups.push(() => ro.disconnect());
    }

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || this.cfg.parallax <= 0) return;
      this.pointer.tx = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      this.pointer.ty = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    this.cleanups.push(() => window.removeEventListener('pointermove', onPointer));

    const onVisibility = () => {
      if (document.hidden) {
        // Başka sekme / uygulama: hamster uyur (geri dönünce yatağında), oyun durur
        this.sleepHamster();
        this.pauseLoop();
      } else if (this.running) this.resumeLoop();
    };
    // Sayfadan ayrılırken de uyusun (geri/ileri önbelleğine giderken visibilitychange gelmeyebilir)
    const onLeave = () => this.sleepHamster();
    window.addEventListener('pagehide', onLeave);
    this.cleanups.push(() => window.removeEventListener('pagehide', onLeave));
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // Geri/ileri önbelleğinden dönüş veya sekme dondurma sonrası: bekleyen kare isteği
    // düşmüş olabilir, döngü sıfırdan kurulur (aksi halde oyun paneli donuk kalır)
    const restart = () => {
      if (!this.running || document.hidden) return;
      this.pauseLoop();
      this.resumeLoop();
    };
    window.addEventListener('pageshow', restart);
    document.addEventListener('resume', restart);
    // Bekçi: çalışıyor ve görünürken 1.5 sn hiç kare çizilmediyse döngüyü yeniden başlat
    const watchdog = window.setInterval(() => {
      if (this.running && !document.hidden && performance.now() - this.lastRender > 1500) restart();
    }, 2000);
    this.cleanups.push(() => {
      window.removeEventListener('pageshow', restart);
      document.removeEventListener('resume', restart);
      window.clearInterval(watchdog);
    });

    this.rebuild();
  }

  // ------------------------------------------------------------------ API

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resumeLoop();
  }

  stop(): void {
    this.running = false;
    this.pauseLoop();
  }

  /**
   * Sahne ekrandan çıkınca (sayfa aşağı kaydırılınca) çağrılır: oyun durmaz, hamster koşmaya
   * ve yıldız kazanmaya devam eder; sadece çizim atlanır ve döngü saniyede 15 adıma iner.
   * Sekme gizlenince ise döngü tamamen durur (visibilitychange).
   */
  setOffscreen(on: boolean): void {
    if (on === this.offscreen) return;
    this.offscreen = on;
    // Geri gelince hemen güncel bir kare çizilsin
    if (!on && this.running && !document.hidden) this.renderOnce();
  }

  destroy(): void {
    this.stop();
    for (const c of this.cleanups) c();
    this.events.clear();
    this.canvas.remove();
  }

  get mode(): WeatherMode {
    return this.weather.mode;
  }

  get params(): Readonly<WeatherParams> {
    return this.weather.params;
  }

  setWeather(mode: WeatherMode, opts: { instant?: boolean } = {}): void {
    this.weather.setMode(mode, opts.instant ?? false);
  }

  setAutoCycle(on: boolean): void {
    this.weather.autoCycle = on;
  }

  /** Elle yıldırım (geliştirici paneli vb.). Her zaman bir bloğa çarpar (sheet hariç). */
  strike(kind: LightningKind = 'near'): void {
    this.lightning.strike(kind, this.cfg.lightning, this.frame.q, this.reduced, true);
  }

  /**
   * Belirli/rastgele bir blok kümesine yıldırım düşürür ve isteğe bağlı olarak
   * coin döktürür. İleride "hamster yüksek değerli coin kazandı" anına bağlanacak.
   */
  strikeBlock(opts: { kind?: 'near' | 'super'; cluster?: number; coins?: number } = {}): void {
    this.lightning.strike(opts.kind ?? 'super', this.cfg.lightning, this.frame.q, this.reduced, true, {
      cluster: opts.cluster,
      coins: opts.coins ?? 0,
    });
  }

  /** Can bitti (dinleniyor): kilitliyken hamster koşmaya başlayamaz; koşuyorsa yatağına döner */
  private runLocked = false;
  setRunLocked(on: boolean): void {
    if (on === this.runLocked) return;
    this.runLocked = on;
    if (on && this.hamster.desired) this.setHamsterRunning(false);
    else this.events.emit('hamster:state', { state: this.hamster.state, running: this.hamster.desired });
  }

  get runLockedNow(): boolean {
    return this.runLocked;
  }

  /** Hamsteri koşturur / durdurur. Çarkı hamster döndürür. */
  setHamsterRunning(on: boolean): void {
    if (on && this.runLocked) return;
    this.hamster.setRunning(on);
    this.events.emit('hamster:state', { state: this.hamster.state, running: this.hamster.desired });
  }

  /**
   * Hamsteri hemen uyutur (çark da anında durur). Siteden çıkınca, başka sekmeye geçince veya
   * leaderboard sayfası açılınca: yıldız sadece oyuncu sitedeyken kazanılır.
   */
  sleepHamster(): void {
    if (this.hamster.state === 'sleep' && !this.hamster.desired) return;
    this.hamster.sleepNow();
    this.wheel.speed = 0;
    this.events.emit('hamster:state', { state: this.hamster.state, running: false });
    if (this.running && !document.hidden && !this.offscreen) this.renderOnce();
  }

  /** Koşu modu: normal / fast (hızlı, toz) / tired (yavaş, soluyarak) */
  setHamsterMood(mood: HamsterMood): void {
    this.hamster.mood = mood;
  }

  get hamsterMood(): HamsterMood {
    return this.hamster.mood;
  }

  /** Thunder boost: kısa ivmelenme + hızlı koşu + elektrik kıvılcımları (koşarken) */
  boostHamster(): void {
    this.hamster.boost();
  }

  toggleHamster(): void {
    this.setHamsterRunning(!this.hamster.desired);
  }

  get hamsterState(): HamsterState {
    return this.hamster.state;
  }

  /** Kullanıcı koşmasını istedi mi (buton durumu) */
  get hamsterRunning(): boolean {
    return this.hamster.desired;
  }

  /** Çarkın gerçek dönüş hızı (rad/sn) */
  get wheelSpeed(): number {
    return this.wheel.speed;
  }

  /** Tüm zincirin doluluğu (0..1). Ödül üretmez: test/geliştirici için. */
  setChainProgress(p: number): void {
    this.blocks.setProgress(p);
    if (this.chainPhase === 'fill' && this.blocks.allFull) this.startFinale();
  }

  get chainProgress(): number {
    return this.blocks.fillProgress;
  }

  /** Zincir durumu: doluluk, bulut sayısı ve döngü evresi */
  get chainStatus(): { filled: number; total: number; clouds: number; totalClouds: number; phase: ChainPhase } {
    return {
      filled: this.blocks.filledBlocks,
      total: this.blocks.total,
      clouds: this.blocks.filledClouds,
      totalClouds: this.blocks.count,
      phase: this.chainPhase,
    };
  }

  /** Token kazanımı: kapalıyken bulutlar yine dolar ama coin/ödül üretilmez */
  setEarning(on: boolean): void {
    this.earning = on;
  }

  /** Blok başı token: aktif hamsterin nadirliği belirler (Common 2, Legendary 3) */
  setTokensPerBlock(n: number): void {
    this.perBlock = Math.max(0, n);
  }

  get isEarning(): boolean {
    return this.earning;
  }

  /** Henüz sayaca varmamış coin sayısı (sayaç: bakiye − yoldaki coinler) */
  get coinsInFlight(): number {
    return this.flights.inFlight;
  }

  /** Token sayacının sahne kutusuna (#world) göre CSS piksel konumu: coinler buraya uçar */
  setTokenTarget(x: number, y: number): void {
    this.tokenTarget = { x, y };
    this.flights.setTarget(x / this.scale + MARGIN, y / this.scale + MARGIN);
  }

  /** Koşan hamsterin türü (satın alınmış hamsterle değiştirilir) */
  /**
   * Koşan hamsterin türü. animate: yeni hamster kulübeden çarka, eskisi çarktan
   * kulübedeki yerine hızla koşar (sayfa açılışındaki yüklemede animasyon yok).
   */
  setActiveHamster(variant: HamsterVariant, opts: { animate?: boolean } = {}): void {
    // Bulutlar bundan sonra bu hamsterin renginde dolar (altın / gök / ateş)
    this.blocks.setTheme(variant);
    const prev = this.hamster.variant;
    if (prev === variant) return;
    if (this.looks.busy) this.looks.finishAll();
    const from = opts.animate ? this.hut.sleeperPos(variant) : null;
    const buddy = this.hamster.buddy;
    if (!from) {
      this.hamster.setLook(variant, buddy);
      return;
    }
    const ground = this.hut.groundLine;
    // Eski hamster çarktan kulübeye (yeri, kulübe listesi güncellenince belli olur)
    this.hut.hiddenVariant = prev;
    this.looks.run(prev, null, this.hamster.feet, ground, () => this.hut.sleeperPos(prev), () => {
      if (this.hut.hiddenVariant === prev) this.hut.hiddenVariant = null;
    });
    // Yeni hamster kulübeden çarka; varınca asıl hamster görünür olur
    this.hamster.setLook(variant, buddy);
    this.hamster.hidden = true;
    this.looks.run(variant, null, from, ground, () => this.hamster.feet, () => {
      this.hamster.hidden = false;
    });
  }

  /** Sırttaki eşyanın kart kimliği (uçuş animasyonunda köşedeki yerini bulmak için) */
  private backId: string | null = null;

  /**
   * Sırttaki eşya (null = çıkarılmış). animate: eski Pixsy sırttan sağ alt köşeye,
   * yenisi köşeden hamsterin sırtına uçar. Köşedeki yerler eşya listesi güncellenince belli olur.
   */
  setBackItem(item: { id: string; kind: PixsyKind } | null, opts: { animate?: boolean } = {}): void {
    const prevId = this.backId;
    const prevKind = this.hamster.buddy;
    if ((item?.id ?? null) === prevId && (item?.kind ?? null) === prevKind) return;
    this.backId = item?.id ?? null;
    if (!opts.animate || this.looks.busy) {
      if (this.looks.busy) this.looks.finishAll();
      this.hamster.setLook(this.hamster.variant, item?.kind ?? null);
      return;
    }
    // Yenisinin köşedeki yeri: liste güncellenmeden önce alınır
    const nextFrom = item ? this.hut.itemPos(item.id) : null;
    if (prevId && prevKind) {
      // Eskisi sırttan köşedeki mindere uçar
      const from = this.hamster.buddyCenter();
      this.hut.hiddenItem = prevId;
      this.looks.fly(itemSprite(prevKind), from, () => this.hut.itemPos(prevId), () => {
        if (this.hut.hiddenItem === prevId) this.hut.hiddenItem = null;
      });
    }
    this.hamster.setLook(this.hamster.variant, null);
    if (item) {
      if (!nextFrom) {
        this.hamster.setLook(this.hamster.variant, item.kind);
        return;
      }
      // Yenisi köşeden hamsterin sırtına uçar; varınca takılır
      this.looks.fly(itemSprite(item.kind), nextFrom, () => this.hamster.buddyCenter(), () => {
        if (this.backId === item.id) this.hamster.setLook(this.hamster.variant, item.kind);
      });
    }
  }

  /** Kulübenin önünde uyuyacak hamsterler (koşan hariç) */
  setHutSleepers(list: Array<{ id: string; variant: HamsterVariant; owned?: boolean }>): void {
    this.hut.setSleepers(list);
    this.events.emit('scene:resize', {});
  }

  /** Ekran (CSS) koordinatı hamsterin sırtındaki Pixsy'nin üstünde mi */
  hitBuddy(clientX: number, clientY: number): boolean {
    const r = this.root.getBoundingClientRect();
    const x = (clientX - r.left) / this.scale + MARGIN;
    const y = (clientY - r.top) / this.scale + MARGIN;
    return this.hamster.buddyHit(x, y);
  }

  /** Takılı olmayan eşyalar: oyun panelinin sağ alt köşesinde toplanır */
  setStoredItems(items: Array<{ id: string; kind: PixsyKind }>): void {
    this.hut.setStoredItems(items);
    this.events.emit('scene:resize', {});
  }

  /** Eşya köşesindeki eşyaların sahneye göre CSS piksel kutuları */
  getItemSpotsInStage(): HutSpot[] {
    const k = this.scale;
    return this.hut.itemSpots().map((sp) => ({ id: sp.id, x: (sp.x - MARGIN) * k, y: (sp.y - MARGIN) * k, w: sp.w * k, h: sp.h * k }));
  }

  /** Uyuyan hamsterlerin sahne kutusuna (#world) göre CSS piksel kutuları */
  getHutSpotsInStage(): HutSpot[] {
    const k = this.scale;
    return this.hut.spots().map((sp) => ({ id: sp.id, x: (sp.x - MARGIN) * k, y: (sp.y - MARGIN) * k, w: sp.w * k, h: sp.h * k }));
  }

  /** Tüm bulutlar dolu: finali hemen başlatır (geliştirici paneli) */
  triggerFinale(): void {
    if (this.chainPhase !== 'fill') return;
    this.blocks.setProgress(1);
    this.startFinale();
  }

  /** Yalnızca test: simülasyonu `seconds` kadar ileri sarar (çizim dahil). */
  fastForward(seconds: number, fps = 60): void {
    for (let i = 0; i < seconds * fps; i++) this.step(1 / fps, 1000 / fps);
  }

  /** Zinciri ve bulutları baştan başlatır */
  resetChain(): void {
    this.blocks.reset();
    this.chainPhase = 'fill';
    this.resetAt = -1;
  }

  // ------------------------------------------------ Squeekchain Live (Gerçek Bulut)

  /** Gerçek Bulut'un canlı durumu: gerçek bloğun doluluğu, bekleyen iniş, veri tazeliği, gerçek çark */
  setRealChain(s: RealCloudState): void {
    this.blocks.setReal(s);
  }

  /**
   * Gerçek bloklar zincire indi: Gerçek Bulut'a camgöbeği yıldırım(lar) düşer (blok sayısıyla 1-4),
   * bulut bir an dolu parlar ve zincirden çark bulutuna enerji akar. Herkesin ekranında aynı an.
   */
  realStorm(blocks: number): void {
    const n = clamp(1 + Math.floor(blocks / 12), 1, 4);
    this.realStrikes = Array.from({ length: n }, (_, i) => i * 0.22);
    this.blocks.burstReal();
    this.hamster.boost();
  }

  /** Block Bounty: yıldızlar Gerçek Bulut'tan sayaca uçar (her biri bir yıldız) */
  spillRealCoins(n: number): void {
    const p = this.blocks.cloudCenter(REAL_CLUSTER);
    const count = Math.max(0, Math.min(150, Math.floor(n)));
    for (let k = 0; k < count; k++) this.flights.launch(p.x + (Math.random() - 0.5) * 14, p.y + (Math.random() - 0.5) * 6, 0.1 + k * 0.045, true);
  }

  /**
   * Hamster koşmuyorken (ya da misafirken) Block Bounty yıldızları: buluttan dökülüp yere düşer ve söner.
   * Sayaca uçmaz, hiçbir yere kaydedilmez (yalnızca görsel).
   */
  dropRealStars(n: number): void {
    const p = this.blocks.cloudCenter(REAL_CLUSTER);
    const count = Math.max(0, Math.min(60, Math.floor(n)));
    for (let k = 0; k < count; k += 6) this.tokens.spill(p.x, p.y, Math.min(6, count - k));
  }

  /** Gerçek Bulut'un sahne kutusuna (#world) göre CSS piksel kutusu: etiket ve bilgi düğmesi için */
  getRealCloudInStage(): { x: number; y: number; w: number; h: number } | null {
    const b = this.blocks.realBox();
    if (!b) return null;
    const k = this.scale;
    return { x: (b.x - MARGIN) * k, y: (b.y - MARGIN) * k, w: b.w * k, h: b.h * k };
  }

  /** Çarka bağlı bulut kümesinin indeksi: strikeBlock({ cluster }) için */
  get wheelCluster(): number {
    return this.blocks.wheelCluster;
  }

  /** Hamsterin başının üstü, sahne kutusuna (#world) göre CSS piksel: can / uyanma sayacı için */
  getHamsterHeadInStage(): { x: number; y: number } | null {
    if (!this.scene) return null;
    const [x, y] = this.hamster.headTop();
    const k = this.scale;
    return { x: (x - MARGIN) * k, y: (y - MARGIN) * k };
  }

  /** Çarkın sahne kutusuna (#world) göre CSS piksel geometrisi: buton vb. yerleşimi için */
  getWheelGeometryInStage(): WheelGeometry | null {
    return this.scene ? this.wheel.geometry(this.scene, this.scale, MARGIN) : null;
  }

  /** Çarkın sayfadaki (viewport, CSS piksel) geometrisi: hamster bu bilgiye göre yerleştirilecek. */
  getWheelGeometry(): WheelGeometry | null {
    if (!this.scene) return null;
    const g = this.wheel.geometry(this.scene, this.scale, MARGIN);
    const r = this.root.getBoundingClientRect();
    return { ...g, x: g.x + r.left, y: g.y + r.top, groundY: g.groundY + r.top };
  }

  /** Gökyüzündeki blok bulutu kümesi sayısı */
  get blockClusterCount(): number {
    return this.blocks.count;
  }

  /** Yapılandırmayı çalışırken değiştirir. Boyut/yerleşim etkileyenler sahneyi yeniden kurar. */
  setConfig(patch: DeepPartial<BackgroundConfig>): void {
    this.cfg = mergeConfig(this.cfg, patch);
    this.weather.setConfig(this.cfg.weather);
    if (patch.quality) this.quality = patch.quality === 'auto' ? this.quality : patch.quality;
    if (patch.seed !== undefined || patch.pixel || patch.rain || patch.particles || patch.chain || patch.stars) {
      this.rebuild();
    }
  }

  get config(): Readonly<BackgroundConfig> {
    return this.cfg;
  }

  getStats(): BackgroundStats {
    return {
      fps: Math.round(this.fps),
      workMs: Math.round(this.workMs * 100) / 100,
      quality: this.quality,
      scale: this.scale,
      width: this.scene?.W ?? 0,
      height: this.scene?.H ?? 0,
      mode: this.weather.mode,
      autoCycle: this.weather.autoCycle,
      timeLeft: this.weather.timeLeft,
    };
  }

  // ------------------------------------------------------------- kurulum

  private computeScale(vw: number, vh: number): number {
    const p = this.cfg.pixel;
    if (p.scale !== 'auto') return Math.max(1, Math.round(p.scale));
    let s = clamp(Math.round(Math.sqrt(vw * vh) / p.autoDivisor), p.minScale, p.maxScale);
    // Sahne en az ~340 iç piksel genişlikte kalsın: yoksa kulübe + uyuyan hamsterler sığmaz ve gizlenir
    // (ör. 1024 px genişlik ölçek 3'e yuvarlanınca). 1440 px masaüstünde değişmez.
    while (s > p.minScale && vw / s < 340) s--;
    return s;
  }

  /** Kurulu sahneyi (yeniden kurmadan) kutunun yeni boyutuna esnetir: yalnızca CSS, çok ucuz */
  private stretchToBox(): void {
    if (this.builtW <= 0 || this.builtH <= 0) return;
    const sx = this.root.clientWidth / this.builtW;
    const sy = this.root.clientHeight / this.builtH;
    if (!(sx > 0 && sy > 0)) return;
    const s = this.scale;
    this.canvas.style.width = `${this.canvas.width * s * sx}px`;
    this.canvas.style.height = `${this.canvas.height * s * sy}px`;
    this.canvas.style.left = `${-MARGIN * s * sx}px`;
    this.canvas.style.top = `${-MARGIN * s * sy}px`;
  }

  /** Sahnenin en son kurulduğu kutu boyutu (CSS px) */
  private builtW = -1;
  private builtH = -1;

  private rebuild(): void {
    // Gizli panel (0×0): mevcut sahne korunur
    if (this.builtW >= 0 && (this.root.clientWidth === 0 || this.root.clientHeight === 0)) return;
    this.builtW = this.root.clientWidth;
    this.builtH = this.root.clientHeight;
    const vw = Math.max(1, this.root.clientWidth || window.innerWidth);
    const vh = Math.max(1, this.root.clientHeight || window.innerHeight);
    const scale = this.computeScale(vw, vh);
    this.scale = scale;
    // CSS için: ölçek 2'de hamsterler sık durur, fiyat etiketleri küçülür (style.css [data-px-scale])
    this.root.dataset.pxScale = String(scale);
    const W = Math.ceil(vw / scale) + MARGIN * 2;
    const H = Math.ceil(vh / scale) + MARGIN * 2;
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${W * scale}px`;
    this.canvas.style.height = `${H * scale}px`;
    this.canvas.style.left = `${-MARGIN * scale}px`;
    this.canvas.style.top = `${-MARGIN * scale}px`;
    this.ctx.imageSmoothingEnabled = false;

    const u = H / 270;
    const portrait = W < H;
    // Hamster çarkı: sol alt, düz zeminin üstünde
    const R = Math.round(Math.min(H * 0.21, W * (portrait ? 0.32 : 0.17)));
    // Zemin çizgisi: önde geniş bir zemin şeridi kalsın (Pixsy köşesi, kulübe önü)
    const groundY = Math.round(H * 0.8);
    const gap = Math.max(4, Math.round(R * 0.18));
    const wheelCx = Math.round(Math.max(R + 16 * u, W * (portrait ? 0.36 : 0.2)));
    const scene: Scene = {
      W,
      H,
      u,
      PAD: Math.ceil(this.cfg.parallax) + 2,
      horizon: Math.round(H * 0.74),
      wheel: { cx: wheelCx, cy: groundY - R - gap, R, groundY },
      // Sağ alt: kulübe (46) + üç uyuyan hamster (32 aralıklı); kulübe tabanı hizasında düz zemin.
      // Son hamsterin solunda da pay kalır ki eğim başlamadan önce ayakları zemine bassın.
      plateau: { x0: W - 46 - 8 - 16 - 2 * 32 - 40, x1: W, y: groundY - 5 },
      farRidge: new Float32Array(0),
      midRidge: new Float32Array(0),
      groundTop: new Float32Array(0),
      offsets: { far: 0, mid: 0, ground: 0 },
    };
    this.scene = scene;

    // Her katman kendi tohumlu üreticisiyle: biri değişse de diğerleri aynı kalır.
    const seed = this.cfg.seed;
    this.sky.build(scene);
    this.land.build(scene, mulberry32(seed + 1));
    this.stars.build(scene, mulberry32(seed + 2), this.cfg.stars.density);
    this.celestial.build(scene);
    this.wheel.build(scene);
    const bedX = Math.round(Math.min(scene.W - 26, scene.wheel.cx + scene.wheel.R * 1.55));
    this.hamster.layout({
      cx: scene.wheel.cx,
      cy: scene.wheel.cy,
      innerR: this.wheel.innerRadius,
      plateRight: scene.wheel.cx + this.wheel.plateHalf,
      plateTop: scene.wheel.groundY - 3,
      groundY: scene.wheel.groundY,
      bedX,
    });
    this.hut.build(scene, bedX + 30);
    const prevProgress = this.blocks.fillProgress;
    this.blocks.build(scene, mulberry32(seed + 3), this.cfg.chain.blockClouds);
    this.blocks.setProgress(prevProgress);
    this.tokens.build(scene);
    this.flights.build(scene);
    this.flights.setTarget(this.tokenTarget.x / scale + MARGIN, this.tokenTarget.y / scale + MARGIN);
    this.rain.build(scene, this.cfg.rain.maxDrops);
    this.motes.build(scene, this.cfg.particles.maxMotes);
    this.lightning.build(scene);
    this.vignette = this.buildVignette(W, H);

    if (!this.running) this.renderOnce();
    this.events.emit('scene:resize', {});
  }

  private buildVignette(W: number, H: number): HTMLCanvasElement {
    const { canvas, ctx } = createCanvas(W, H);
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const cx = W / 2;
    const cy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const a = smoothstep(0.62, 1.32, Math.sqrt(dx * dx * 0.85 + dy * dy));
        if (a <= 0) continue;
        const o = (y * W + x) * 4;
        d[o] = 4;
        d[o + 1] = 3;
        d[o + 2] = 14;
        // İki kademe + dither: yumuşak ama piksel sanatına uygun
        d[o + 3] = a > 0.5 + bayer(x, y) * 0.5 ? 200 : a > bayer(x, y) * 0.5 ? 110 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // -------------------------------------------------------------- döngü

  private resumeLoop(): void {
    if (this.raf) return;
    this.lastRender = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const fpsCap = this.offscreen ? 15 : this.quality === 'low' ? Math.min(30, this.cfg.maxFps) : this.cfg.maxFps;
      const minDelta = 1000 / fpsCap - 1.5;
      const elapsed = now - this.lastRender;
      if (elapsed < minDelta) return;
      this.lastRender = now;
      this.step(Math.min(0.1, elapsed / 1000), elapsed);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private pauseLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private renderOnce(): void {
    this.step(0, 16);
  }

  /** Düzenli yıldırım sayacı (gerçek saniye): her ambientEverySeconds'ta rastgele bir buluta */
  private ambientT = 0;

  private step(realDt: number, elapsedMs: number): void {
    const scene = this.scene;
    if (!scene) return;
    const t0 = performance.now();
    const speed = this.cfg.animationSpeed * (this.reduced ? 0.7 : 1);
    const dt = realDt * speed;
    this.time += dt;

    // İmleç paralaksı (yumuşatılmış)
    const k = 1 - Math.exp(-realDt * 3);
    this.pointer.x += (this.pointer.tx - this.pointer.x) * k;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * k;

    this.weather.update(dt);
    const f = this.frame;
    f.t = this.time;
    f.dt = dt;
    f.q = QUALITY_MULT[this.quality];
    f.px = this.pointer.x;
    f.py = this.pointer.y;
    f.parallax = this.reduced ? 0 : this.cfg.parallax;

    this.safe('update', () => {
      this.lightning.update(dt, f, this.cfg.lightning, this.weather.nearRate, this.weather.farRate, this.reduced);
      // Hava ne olursa olsun düzenli yıldırım: rastgele bir blok bulutu, şimşek + gök gürültüsü sesiyle.
      // Final şarjında (zaten şimşekler sıklaşıyor) atlanır. Sekme gizliyken döngü durduğu için sayaç da durur.
      const every = this.cfg.lightning.ambientEverySeconds;
      if (every > 0 && this.cfg.lightning.enabled) {
        this.ambientT += realDt;
        if (this.ambientT >= every) {
          this.ambientT = 0;
          if (this.chainPhase !== 'charge') this.strikeBlock({ kind: 'near', coins: 0 });
        }
      }
      f.flash = this.lightning.flash;
      // Hamster çarkı döndürür: çarkın hedef hızı hamsterin koşu gücünden gelir
      this.hamster.update(dt, this.wheel.speed);
      this.wheel.update(dt, this.hamster.targetTread / this.wheel.innerRadius);
      this.updateChain(dt, f);
      this.blocks.update(dt, this.cfg.chain.pulses);
      this.tokens.update(dt);
      this.flights.update(dt);
      this.hut.update(dt);
      this.looks.update(dt);
      this.rain.update(dt, f, this.cfg.rain.speed, this.cfg.rain.splashes);
      this.motes.update(dt, f);
    });

    if (this.offscreen) {
      this.measure(performance.now() - t0, elapsedMs, realDt);
      return;
    }
    this.render(f, scene);

    // Sarsıntı: CSS transform (yeniden çizim gerektirmez)
    const sx = this.lightning.shakeX * this.scale;
    const sy = this.lightning.shakeY * this.scale;
    this.canvas.style.transform = sx || sy ? `translate3d(${sx}px, ${sy}px, 0)` : '';

    this.measure(performance.now() - t0, elapsedMs, realDt);
  }

  /** Hata veren katmanı atlar, diğerleri çizilmeye devam eder (tek bir katmanın hatası
   *  tüm sahneyi, örn. çark ve hamsteri, her karede silmesin). Her hata bir kez raporlanır. */
  private readonly failed = new Set<string>();
  private safe(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      if (!this.failed.has(name)) {
        this.failed.add(name);
        console.error(`[Squeaksy] "${name}" hata verdi, bu katman atlandı`, err);
      }
    }
  }

  private render(f: Frame, s: Scene): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    this.safe('sky.draw', () => this.sky.draw(ctx, f));
    this.safe('stars.draw', () => this.stars.draw(ctx, f));
    this.safe('celestial.draw', () => this.celestial.draw(ctx, f, s));
    this.safe('lightning.drawSheets', () => this.lightning.drawSheets(ctx));
    this.safe('land.drawFar', () => this.land.drawFar(ctx, f, s));
    this.safe('land.drawHaze', () => this.land.drawHaze(ctx, f));
    this.blocks.setWheel(s.wheel.cx, s.wheel.cy - s.wheel.R - 2, this.wheel.intensity);
    this.safe('blocks.draw', () => this.blocks.draw(ctx, f));
    this.safe('lightning.drawBolts', () => this.lightning.drawBolts(ctx));
    this.safe('land.drawMid', () => this.land.drawMid(ctx, f, s));
    this.safe('land.drawGround', () => this.land.drawGround(ctx, f, s));
    this.safe('hut.draw', () => this.hut.draw(ctx, f));
    // Çarktaysa ön jantın arkasına, değilse (zeminde / zıplarken) çarkın önüne çizilir
    this.safe('wheel.draw', () =>
      this.wheel.draw(ctx, f, s, () => {
        if (this.hamster.inWheel) this.safe('hamster.draw', () => this.hamster.draw(ctx, f));
      }),
    );
    if (!this.hamster.inWheel) this.safe('hamster.draw', () => this.hamster.draw(ctx, f));
    this.safe('looks.draw', () => this.looks.draw(ctx, f));
    this.safe('lightning.drawSparks', () => this.lightning.drawSparks(ctx));
    this.safe('tokens.draw', () => this.tokens.draw(ctx));
    this.safe('lightning.drawCloudGlow', () => this.lightning.drawCloudGlow(ctx));
    this.safe('rain.draw', () => this.rain.draw(ctx, f));
    this.safe('motes.draw', () => this.motes.draw(ctx, f));
    this.safe('flights.draw', () => this.flights.draw(ctx));

    // Yıldırım aydınlanması: tüm sahne kısa süre mavi-beyaz (bazen mor) parlar
    if (f.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, f.flash);
      const tint = this.lightning.flashTint;
      ctx.fillStyle = tint === 'chain' ? '#3a9cc0' : tint === 'purple' ? '#7a5ad0' : '#6f8fd8';
      ctx.fillRect(0, 0, s.W, s.H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Final vuruşu: kısa, güçlü beyaz patlama (gündüz de görünür)
    if (this.megaFlash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, this.megaFlash) * (this.reduced ? 0.35 : 0.8);
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(0, 0, s.W, s.H);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.vignette && this.cfg.vignette > 0) {
      ctx.globalAlpha = this.cfg.vignette * (1 - f.flash * 0.5);
      ctx.drawImage(this.vignette, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** Hamster koştukça zinciri doldurur, blok başına token uçurur; tüm bulutlar dolunca finali yürütür. */
  private updateChain(dt: number, f: Frame): void {
    this.megaFlash = Math.max(0, this.megaFlash - dt * 1.4);
    // Gerçek blok inişinin yıldırımları (oyuncunun zincirinden bağımsız; final ile çakışsa da olur)
    if (this.realStrikes.length) {
      this.realStrikes = this.realStrikes.map((t) => t - dt);
      while (this.realStrikes.length && this.realStrikes[0]! <= 0) {
        this.realStrikes.shift();
        this.lightning.strike('super', this.cfg.lightning, f.q, this.reduced, false, { cluster: REAL_CLUSTER, tint: 'chain' });
      }
    }
    if (this.resetAt >= 0) {
      this.resetAt -= dt;
      if (this.resetAt < 0) {
        this.blocks.reset();
        this.events.emit('chain:finale', { phase: 'reset' });
      }
    }

    if (this.chainPhase === 'fill') {
      const tread = this.wheel.speed * this.wheel.innerRadius;
      if (this.hamster.state !== 'run' || tread <= 20) return;
      // Hızlı koşan hamster daha çabuk doldurur
      const amount = (dt * (tread / this.cfg.hamster.speeds.normal)) / this.cfg.hamster.secondsPerBlock;
      const res = this.blocks.advance(amount);
      if (res) {
        res.blocks.forEach((b, i) => {
          if (this.earning) {
            // 1.5 gibi oranlarda yarımlar birikir: iki blokta bir ekstra yıldız uçar
            this.coinAcc += this.perBlock;
            const n = Math.floor(this.coinAcc + 1e-6);
            this.coinAcc -= n;
            for (let k = 0; k < n; k++) this.flights.launch(b.x, b.y, i * 0.08 + k * 0.12);
          }
          this.events.emit('chain:block', { cluster: b.cluster, tile: b.tile, filled: this.blocks.filledBlocks, total: this.blocks.total });
        });
        for (const c of res.clouds) {
          this.events.emit('chain:cloud', { cluster: c, clouds: this.blocks.filledClouds, totalClouds: this.blocks.count });
        }
      }
      if (this.blocks.allFull) this.startFinale();
      return;
    }

    this.phaseT += dt;
    if (this.chainPhase === 'charge') {
      const fc = this.cfg.finale;
      const k = clamp(this.phaseT / fc.chargeSeconds, 0, 1);
      // Şimşekler giderek sıklaşır: önce aralıklı, sonunda neredeyse kesintisiz
      this.finaleGap -= dt;
      if (this.finaleGap <= 0) {
        const r = Math.random();
        const kind: LightningKind = r < 0.55 + k * 0.25 ? 'near' : r < 0.85 ? 'sheet' : 'far';
        const cluster = Math.floor(Math.random() * this.blocks.count);
        this.lightning.strike(kind, this.cfg.lightning, f.q, this.reduced, false, { cluster });
        if (k > 0.55 && Math.random() < k * 0.6) this.lightning.strike('sheet', this.cfg.lightning, f.q, this.reduced);
        this.finaleGap = (0.42 - 0.36 * k) * (0.7 + Math.random() * 0.6);
      }
      if (k >= 1) {
        // Büyük vuruş: aynı anda tüm bulutlara
        for (let i = 0; i < this.blocks.count; i++) {
          this.lightning.strike('super', this.cfg.lightning, f.q, this.reduced, false, { cluster: i });
        }
        this.megaFlash = 1;
        this.resetAt = 0.22; // altın, beyaz patlamanın altında kaybolur
        if (this.earning) {
          // Final ödülü: +10 token, yıldırımların çarptığı bulutlardan sayaca saçılır
          const BONUS = 10;
          for (let k = 0; k < BONUS; k++) {
            const p = this.blocks.cloudCenter(k % this.blocks.count);
            this.flights.launch(p.x + (Math.random() - 0.5) * 12, p.y, 0.15 + k * 0.07, true);
          }
          this.events.emit('chain:bonus', { tokens: BONUS });
        }
        this.hamster.boost();
        this.events.emit('chain:finale', { phase: 'strike' });
        this.chainPhase = 'cooldown';
        this.phaseT = 0;
      }
    } else if (this.chainPhase === 'cooldown' && this.phaseT >= this.cfg.finale.cooldownSeconds) {
      this.chainPhase = 'fill';
      this.phaseT = 0;
    }
  }

  private startFinale(): void {
    this.chainPhase = 'charge';
    this.phaseT = 0;
    this.finaleGap = 0.25;
    this.events.emit('chain:finale', { phase: 'charge' });
  }

  private measure(workMs: number, elapsedMs: number, realDt: number): void {
    this.fpsAcc += elapsedMs;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.perfAcc += workMs;
    this.perfFrames++;
    if (this.perfFrames >= 90) {
      this.workMs = this.perfAcc / this.perfFrames;
      if (this.cfg.quality === 'auto' && this.workMs > 9) {
        const i = QUALITY_ORDER.indexOf(this.quality);
        if (i < QUALITY_ORDER.length - 1) {
          this.quality = QUALITY_ORDER[i + 1]!;
          this.events.emit('quality:change', { level: this.quality });
        }
      }
      this.perfAcc = 0;
      this.perfFrames = 0;
    }
    this.tickAcc += realDt;
    if (this.tickAcc >= 0.25) {
      this.tickAcc = 0;
      this.events.emit('weather:tick', { mode: this.weather.mode, params: this.weather.params, rainDrops: this.rain.activeDrops });
    }
  }
}
