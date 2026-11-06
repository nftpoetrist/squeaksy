/** ui: buton tıkları. Uzaklık boğuklaştırmasından ve sıkıştırıcıdan geçmez: sitenin her yerinde aynı net duyulur */
export type AudioChannel = 'ambience' | 'sfx' | 'music' | 'ui';

export interface SoundDef {
  id: string;
  channel: AudioChannel;
  /** Dosya yolu/yolları (birden çok → rastgele varyasyon). null = henüz bağlanmadı, sessizce atlanır. */
  src: string | string[] | null;
  /** Kodla üretilen ses (telifsiz): varsa dosya yerine bu kullanılır, sadece ses açılınca üretilir */
  synth?: (ctx: AudioContext) => AudioBuffer[] | Promise<AudioBuffer[]>;
  loop?: boolean;
  volume?: number;
  /**
   * Dosyadan döngü: yüklenince baş/sondaki sessizlik (kodlayıcı boşlukları dahil) kırpılır ve son N saniye
   * ilk N saniyenin üstüne yumuşakça bindirilir. Böylece dönüş noktasında tık / boşluk / ses düşmesi olmaz.
   */
  seamless?: number;
  /** Baştaki sessizlik (kodlayıcı boşluğu dahil) kırpılır: kısa efektler basıldığı anda duyulur */
  trim?: boolean;
}

/** Baştaki sessizliği kırpar (tık sesinde gecikme olmasın) */
function trimStart(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
  const thr = 0.003; // ~ -50 dB
  let s = 0;
  while (s < src.length - 1 && !chans.some((d) => Math.abs(d[s]!) > thr)) s++;
  // Tıklama (pop) olmasın diye 1 ms geriden başlar
  s = Math.max(0, s - Math.floor(src.sampleRate * 0.001));
  if (s === 0) return src;
  const out = ctx.createBuffer(src.numberOfChannels, src.length - s, src.sampleRate);
  chans.forEach((d, c) => out.getChannelData(c).set(d.subarray(s)));
  return out;
}

/** Döngüyü dikişsiz yapar: sessiz uçları kırpar, sonu başa eşit güçle (gürültü için) bindirir. */
function makeSeamless(ctx: BaseAudioContext, src: AudioBuffer, fadeSeconds: number): AudioBuffer {
  const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
  const thr = 0.001; // -60 dB
  const loud = (i: number) => chans.some((d) => Math.abs(d[i]!) > thr);
  let s = 0;
  let e = src.length - 1;
  while (s < e && !loud(s)) s++;
  while (e > s && !loud(e)) e--;
  const len = e - s + 1;
  const fade = Math.min(Math.floor(fadeSeconds * src.sampleRate), Math.floor(len / 4));
  if (fade < 32) return src;
  const out = ctx.createBuffer(src.numberOfChannels, len - fade, src.sampleRate);
  chans.forEach((d, c) => {
    const o = out.getChannelData(c);
    o.set(d.subarray(s + fade, s + len - fade), fade);
    for (let i = 0; i < fade; i++) {
      const t = (i / fade) * (Math.PI / 2);
      o[i] = d[s + i]! * Math.sin(t) + d[s + len - fade + i]! * Math.cos(t);
    }
  });
  return out;
}

export interface PlayOptions {
  volume?: number;
  /** -1 (sol) .. 1 (sağ) */
  pan?: number;
  rate?: number;
  /** Saniye cinsinden gecikme (ör. gök gürültüsü yıldırımdan sonra gelir) */
  delay?: number;
}

interface LoopState {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Web Audio tabanlı ses yöneticisi.
 * - Asla kendiliğinden ses çalmaz: önce kullanıcı etkileşimiyle `unlock()` ve `setEnabled(true)` gerekir.
 * - Kanal başına ses seviyesi (ambiyans / efekt / müzik) + ana ses.
 * - Ses dosyası tanımlı değilse (`src: null`) çağrılar sessizce yok sayılır.
 */
/** Hoparlöre giden son seviye: 1.3 = önceki sesin %30 fazlası */
const OUTPUT_GAIN = 1.3;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<AudioChannel, GainNode>();
  private defs = new Map<string, SoundDef>();
  private buffers = new Map<string, AudioBuffer[]>();
  private loading = new Map<string, Promise<void>>();
  private loops = new Map<string, LoopState>();
  /** Önceden indirilmiş dosyalar (ses motoru açılmadan): ilk basışta sadece çözme kalır */
  private prefetched = new Map<string, Promise<ArrayBuffer>>();
  // Saatlerce dinlense de yormasın: düşük seviyeler
  private volumes: Record<AudioChannel | 'master', number> = { master: 0.5, ambience: 0.5, sfx: 0.45, music: 0.32, ui: 0.42 };
  private enabled = false;
  /** Uzaklık: kaydırınca ses kısılır ve boğuklaşır (1 = oyun panelinin başında) */
  private near: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private proximity = 1;
  private hidden = false;
  private suspendTimer = 0;

  register(defs: SoundDef[]): void {
    for (const d of defs) this.defs.set(d.id, d);
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** İlk kullanıcı etkileşiminde ses bağlamını hazırlar (ses çalmaz). */
  attachUnlock(target: Window | HTMLElement = window): () => void {
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const handler = () => {
      void this.unlock();
      for (const e of events) target.removeEventListener(e, handler);
    };
    for (const e of events) target.addEventListener(e, handler, { passive: true });
    return () => {
      for (const e of events) target.removeEventListener(e, handler);
    };
  }

  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volumes.master : 0;
      // ana ses → boğuklaştırma (uzaklık) → yakınlık kısıcısı → hoparlör
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.Q.value = 0.5;
      this.near = this.ctx.createGain();
      // Ani tepeleri (gürleme) yumuşatan hafif sıkıştırıcı: kulak hiç irkilmesin
      const soft = this.ctx.createDynamicsCompressor();
      soft.threshold.value = -26;
      soft.knee.value = 18;
      soft.ratio.value = 4;
      soft.attack.value = 0.02;
      soft.release.value = 0.4;
      this.applyProximity(0);
      // Son çıkış: sıkıştırıcıdan sonra (sesin tamamı aynı oranda %30 yükselir; önceye konsa sıkıştırıcı yutardı)
      const out = this.ctx.createGain();
      out.gain.value = OUTPUT_GAIN;
      this.master.connect(soft).connect(this.muffle).connect(this.near).connect(out).connect(this.ctx.destination);
      for (const ch of ['ambience', 'sfx', 'music'] as const) {
        const g = this.ctx.createGain();
        g.gain.value = this.volumes[ch];
        g.connect(this.master);
        this.channels.set(ch, g);
      }
      // Buton tıkları: doğrudan son çıkışa (ses kapalıyken 0)
      const ui = this.ctx.createGain();
      ui.gain.value = this.enabled ? this.volumes.ui : 0;
      ui.connect(out);
      this.channels.set('ui', ui);
    }
    if (this.ctx.state === 'suspended' && !this.hidden) await this.ctx.resume();
    // Buton sesi küçük: ses kapalıyken de önceden hazırlanır, açılınca ilk tıkta gecikmesiz çalar
    void Promise.all([...this.defs.values()].filter((d) => d.channel === 'ui').map((d) => this.load(d.id)));
    // Sesler sadece ses açıksa üretilir/yüklenir (kapalıyken hiç işlemci harcanmaz)
    if (this.enabled) await this.loadAll();
  }

  /** Küçük bir sesi (ör. buton tıkı) sayfa açılırken indirir; ses motoru açılınca anında çözülür */
  prefetch(id: string): void {
    const def = this.defs.get(id);
    const url = def && typeof def.src === 'string' ? def.src : null;
    if (!url || this.prefetched.has(url)) return;
    this.prefetched.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    );
  }

  /** Ses şu an çalınabilir mi (açık, motor çalışıyor, dosya hazır) */
  canPlay(id: string): boolean {
    return this.enabled && this.unlocked && (this.buffers.get(id)?.length ?? 0) > 0;
  }

  /** Ses hazır olunca çözülür (yüklü değilse yükler) */
  ready(id: string): Promise<void> {
    return this.load(id);
  }

  private loadAll(): Promise<void> {
    return Promise.all([...this.defs.keys()].map((id) => this.load(id))).then(() => undefined);
  }

  /** 0..1: oyun paneline yakınlık. Uzaklaştıkça ses kısılır ve tizler yumuşar. */
  setProximity(k: number): void {
    this.proximity = Math.max(0, Math.min(1, k));
    this.applyProximity(0.25);
  }

  private applyProximity(fade: number): void {
    if (!this.ctx || !this.near || !this.muffle) return;
    const k = this.hidden ? 0 : this.proximity;
    this.ramp(this.near.gain, Math.pow(k, 1.6), fade);
    // Tizler hep kırpık (en çok 6 kHz): uzun dinlemede kulak yorulmaz; uzaklaştıkça daha da boğuklaşır
    const hz = 400 + 5600 * k * k;
    const now = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, now);
    this.muffle.frequency.exponentialRampToValueAtTime(hz, now + Math.max(0.01, fade));
  }

  /** Sayfa gizlenince (sekme değişti / başka sayfa) yumuşakça susar ve ses motoru durur. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    window.clearTimeout(this.suspendTimer);
    if (!this.ctx) return;
    if (hidden) {
      this.applyProximity(0.35);
      this.suspendTimer = window.setTimeout(() => void this.ctx?.suspend(), 450);
    } else {
      void this.ctx.resume().then(() => this.applyProximity(0.8));
    }
  }

  /** Sesi aç/kapat (kullanıcının açık tercihi). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.ramp(this.master.gain, on ? this.volumes.master : 0, on ? 1.2 : 0.4);
    const ui = this.channels.get('ui');
    if (ui) this.ramp(ui.gain, on ? this.volumes.ui : 0, 0.02);
    if (!on) for (const id of [...this.loops.keys()]) this.setLoop(id, 0, 0.4);
    else if (this.ctx) void this.loadAll();
  }

  setVolume(channel: AudioChannel | 'master', v: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, v));
    const node = channel === 'master' ? this.master : this.channels.get(channel);
    if (node && ((channel !== 'master' && channel !== 'ui') || this.enabled)) this.ramp(node.gain, this.volumes[channel], 0.15);
  }

  private load(id: string): Promise<void> {
    const def = this.defs.get(id);
    if (!def || (!def.src && !def.synth) || !this.ctx) return Promise.resolve();
    const existing = this.loading.get(id);
    if (existing) return existing;
    const ctx = this.ctx;
    if (def.synth) {
      const synth = def.synth;
      // Her ses ayrı bir görevde üretilir: açılışta sayfa bir anda donmaz
      const p = new Promise<void>((r) => setTimeout(r, 0))
        .then(() => synth(ctx))
        .then((bufs) => {
          this.buffers.set(id, bufs);
        })
        .catch((err) => {
          console.warn(`[Squeaksy ses] "${id}" üretilemedi`, err);
        });
      this.loading.set(id, p);
      return p;
    }
    if (!def.src) return Promise.resolve();
    const srcs = Array.isArray(def.src) ? def.src : [def.src];
    const p = Promise.all(
      srcs.map(async (url) => {
        const pre = this.prefetched.get(url);
        let bytes: ArrayBuffer;
        if (pre) {
          this.prefetched.delete(url);
          bytes = await pre;
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          bytes = await res.arrayBuffer();
        }
        const buf = await ctx.decodeAudioData(bytes);
        if (def.loop && def.seamless) return makeSeamless(ctx, buf, def.seamless);
        return def.trim ? trimStart(ctx, buf) : buf;
      }),
    )
      .then((bufs) => {
        this.buffers.set(id, bufs);
      })
      .catch((err) => {
        console.warn(`[Squeaksy ses] "${id}" yüklenemedi`, err);
      });
    this.loading.set(id, p);
    return p;
  }

  private buffer(id: string): AudioBuffer | null {
    const list = this.buffers.get(id);
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)]!;
  }

  /** Tek seferlik ses. Hazır değilse sessizce atlar. */
  play(id: string, opts: PlayOptions = {}): void {
    if (!this.enabled || !this.unlocked || !this.ctx) return;
    const def = this.defs.get(id);
    const buf = this.buffer(id);
    if (!def || !buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = (def.volume ?? 1) * (opts.volume ?? 1);
    let node: AudioNode = gain;
    if (opts.pan !== undefined && 'createStereoPanner' in ctx) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(pan);
      node = pan;
    }
    src.connect(gain);
    node.connect(this.channels.get(def.channel)!);
    src.start(ctx.currentTime + (opts.delay ?? 0));
  }

  /** Döngüsel sesin seviyesini yumuşakça ayarlar; 0 → durdurur, >0 → gerekirse başlatır. */
  setLoop(id: string, volume: number, fade = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const current = this.loops.get(id);
    if (volume <= 0.001) {
      if (!current) return;
      this.ramp(current.gain.gain, 0, fade);
      current.source.stop(ctx.currentTime + fade + 0.05);
      this.loops.delete(id);
      return;
    }
    if (!this.enabled || !this.unlocked) return;
    const def = this.defs.get(id);
    if (current) {
      this.ramp(current.gain.gain, volume * (def?.volume ?? 1), fade);
      return;
    }
    const buf = this.buffer(id);
    if (!def || !buf) return;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.channels.get(def.channel)!);
    source.start();
    this.ramp(gain.gain, volume * (def.volume ?? 1), fade);
    this.loops.set(id, { source, gain });
  }

  private ramp(param: AudioParam, value: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
  }

  async destroy(): Promise<void> {
    for (const id of [...this.loops.keys()]) this.setLoop(id, 0, 0.05);
    await this.ctx?.close();
    this.ctx = null;
  }
}
