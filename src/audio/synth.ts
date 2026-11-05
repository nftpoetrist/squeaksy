/**
 * Telifsiz, tamamen kodla üretilen ortam sesleri (dosya indirilmez).
 * - Yağmur: şekillendirilmiş gürültü + seyrek damla tıkırtıları, kesintisiz döngü
 * - Gök gürültüsü: derin, yumuşak, uzaktan gelen gürleme (sert çatlama yok)
 * - Müzik: yavaş akorlar + seyrek pentatonik çan notaları + yankı, kesintisiz döngü
 * Hepsi sadece kullanıcı sesi açtığında bir kez üretilir.
 */

/** Tohumlu rastgele sayı (her açılışta aynı, düzgün döngü) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function makeBuffer(ctx: BaseAudioContext, seconds: number, channels = 2): AudioBuffer {
  return ctx.createBuffer(channels, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
}

/** Sondaki `fade` saniyeyi başa karıştırır: döngü dikişsiz olur. Uzunluk `fade` kadar kısalır. */
function seamless(ctx: BaseAudioContext, src: AudioBuffer, fade: number): AudioBuffer {
  const f = Math.round(fade * src.sampleRate);
  const len = src.length - f;
  const out = ctx.createBuffer(src.numberOfChannels, len, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c);
    const o = out.getChannelData(c);
    o.set(a.subarray(0, len));
    for (let i = 0; i < f; i++) {
      const k = i / f;
      // Eşit güçlü geçiş
      o[i] = a[i]! * Math.sin((k * Math.PI) / 2) + a[len + i]! * Math.cos((k * Math.PI) / 2);
    }
  }
  return out;
}

function normalize(buf: AudioBuffer, peak: number): void {
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) m = Math.max(m, Math.abs(v));
  if (m <= 0) return;
  const k = peak / m;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i]! *= k;
  }
}

/* ------------------------------------------------------------------ Yağmur */
/**
 * Uyku yağmuru tarzı: sıcak, yumuşak, kesintisiz bir yağmur dokusu.
 * - Zemin: pembe gürültü, tizleri alınmış (keskin "şelale" hışırtısı yok)
 * - Doku: çok yoğun ama çok kısık minik damla tıkırtıları; zemine karışır, tek tek seçilmez
 * - Hareket: yağmur yavaşça hafifçe artıp azalır (nefes gibi)
 * heavy=true: biraz daha dolgun ve koyu ikinci katman.
 */
export function rain(ctx: BaseAudioContext, heavy: boolean): AudioBuffer {
  const seconds = 20;
  const fade = 3;
  const buf = makeBuffer(ctx, seconds + fade);
  const sr = ctx.sampleRate;
  const pole = (hz: number) => Math.exp((-2 * Math.PI * hz) / sr);
  const aLp = pole(heavy ? 750 : 900);
  const aHp = pole(heavy ? 120 : 180);
  const aTex = pole(heavy ? 1000 : 1200);
  const tickRate = (heavy ? 230 : 150) / sr; // örnek başına minik damla olasılığı (seyrek)
  for (let c = 0; c < 2; c++) {
    const r = rng((heavy ? 71 : 13) + c);
    const d = buf.getChannelData(c);
    // Pembe gürültü (Paul Kellet)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let l1 = 0, l2 = 0, hpIn = 0, hp = 0;
    let tex = 0, tex2 = 0, tick = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      // İki kat alçak geçiren (yumuşak tepe) + yüksek geçiren (uğultu yok)
      l1 = aLp * l1 + (1 - aLp) * pink;
      l2 = aLp * l2 + (1 - aLp) * l1;
      hp = aHp * (hp + l2 - hpIn);
      hpIn = l2;
      // Minik damlalar: rastgele küçük vuruşlar, kısa sönüm, filtreyle yumuşatılır
      tick *= 0.93;
      if (r() < tickRate) tick += (r() * 2 - 1) * (0.3 + r() * 0.7);
      tex = aTex * tex + (1 - aTex) * tick;
      tex2 = aTex * tex2 + (1 - aTex) * tex;
      const t = i / sr;
      // Belirgin nefes: arada daha sessiz anlar (sürekli bir duvar gibi gelmesin)
      const swell = 0.68 + 0.32 * (0.5 + 0.5 * Math.sin(t * 0.29 + c * 1.3)) * (0.6 + 0.4 * Math.sin(t * 0.11 + 0.8));
      d[i] = (hp * 0.7 + tex2 * 2.2) * swell;
    }
  }
  normalize(buf, heavy ? 0.34 : 0.3);
  return seamless(ctx, buf, fade);
}

/* ------------------------------------------------------------------ Yıldırım çatırtısı */
/**
 * Şimşek göründüğü anda çalan kısa, yumuşak "zap": kısa bir gürültü patlaması + aşağı inen
 * piksel tonu. Sert değil; sadece görüntüyle sesi eşler, ardından gürleme gelir.
 */
export function zap(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const r = rng(seed);
  const seconds = 0.7;
  const buf = makeBuffer(ctx, seconds);
  const sr = ctx.sampleRate;
  const aL = Math.exp((-2 * Math.PI * 1600) / sr);
  const aH = Math.exp((-2 * Math.PI * 500) / sr);
  const f0 = 600 + r() * 200;
  const f1 = 110 + r() * 40;
  for (let c = 0; c < 2; c++) {
    const rr = rng(seed * 13 + c);
    const d = buf.getChannelData(c);
    let lp = 0;
    let hpIn = 0;
    let hp = 0;
    let ph = 0;
    let sm = 0;
    const aS = Math.exp((-2 * Math.PI * 1800) / sr);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      // Çıtırtı: birkaç kısa tepe (şimşeğin titremesiyle aynı ritimde)
      const crackle = Math.exp(-t / 0.05) + 0.55 * Math.exp(-Math.max(0, t - 0.07) / 0.04) * (t > 0.07 ? 1 : 0) + 0.3 * Math.exp(-Math.max(0, t - 0.14) / 0.05) * (t > 0.14 ? 1 : 0);
      const w = rr() * 2 - 1;
      lp = aL * lp + (1 - aL) * w;
      hp = aH * (hp + lp - hpIn);
      hpIn = lp;
      // Aşağı inen yumuşak piksel tonu
      const f = f1 + (f0 - f1) * Math.exp(-t / 0.09);
      ph = (ph + f / sr) % 1;
      const tri = Math.round((1 - 4 * Math.abs(ph - 0.5)) * 6) / 6;
      sm = aS * sm + (1 - aS) * tri;
      const tone = sm * 0.35 * Math.exp(-t / 0.16);
      const tail = Math.min(1, (seconds - t) / 0.1);
      d[i] = (hp * 2.2 * crackle + tone) * tail;
    }
  }
  normalize(buf, 0.6);
  return buf;
}

/* ------------------------------------------------------------------ Gök gürültüsü */
/** Uzak, derin gürleme: yavaş yükselir, birkaç dalgayla yuvarlanarak söner. */
export function thunder(ctx: BaseAudioContext, seed: number, near: boolean): AudioBuffer {
  const r = rng(seed);
  const seconds = near ? 6.5 : 7.5;
  const buf = makeBuffer(ctx, seconds);
  const sr = ctx.sampleRate;
  const cut = near ? 260 : 150;
  const a = Math.exp((-2 * Math.PI * cut) / sr);
  // Gürleme dalgaları: başlangıç zamanı, genlik, sönme
  const rolls = Array.from({ length: near ? 4 : 3 }, (_, k) => ({
    at: k === 0 ? 0.05 + r() * 0.15 : 0.5 + r() * (seconds * 0.45),
    amp: k === 0 ? 1 : 0.35 + r() * 0.45,
    rise: 0.25 + r() * 0.5,
    decay: 1.2 + r() * 1.8,
  }));
  for (let c = 0; c < 2; c++) {
    const rr = rng(seed * 7 + c);
    const d = buf.getChannelData(c);
    let b = 0;
    let l1 = 0;
    let l2 = 0;
    let l3 = 0;
    for (let i = 0; i < d.length; i++) {
      // Kahverengi gürültü (derin) + üç kat alçak geçiren
      b = (b + (rr() * 2 - 1) * 0.02) * 0.998;
      l1 = a * l1 + (1 - a) * b;
      l2 = a * l2 + (1 - a) * l1;
      l3 = a * l3 + (1 - a) * l2;
      const t = i / sr;
      let env = 0;
      for (const ro of rolls) {
        const x = t - ro.at;
        if (x <= 0) continue;
        env += ro.amp * (1 - Math.exp(-x / ro.rise)) * Math.exp(-x / ro.decay);
      }
      // Sonda sıfıra in (tıklama olmasın)
      const tail = Math.min(1, (seconds - t) / 0.8);
      d[i] = l3 * env * tail;
    }
  }
  normalize(buf, near ? 0.75 : 0.55);
  return buf;
}

/* ------------------------------------------------------------------ Müzik */

/**
 * Sakin ambiyans müziği: 4 akor × 16 sn (Fmaj7 → Cmaj7/E → Am7 → G6sus), saf sinüs padler,
 * arada pentatonik çan notaları, uzun yankı. Çevrimdışı üretilir, dikişsiz döngü.
 */
export async function music(): Promise<AudioBuffer> {
  const SR = 44100;
  const bar = 16;
  const loop = bar * 4;
  // İlk akor döngünün sonunda başlar ve tamamı başa sarılır (22 sn) + yankı payı
  const tailS = 26;
  const Off = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Off(2, Math.round((loop + tailS) * SR), SR);

  // Yankı: üretilmiş, yavaş sönen stereo dürtü yanıtı
  // (Ham beyaz gürültü yankısı çızırtı yapıyordu: gürültü önce iki kat yumuşatılır, kuyruk koyu ve kısa)
  const ir = ctx.createBuffer(2, Math.round(3.2 * SR), SR);
  const aIr = Math.exp((-2 * Math.PI * 1400) / SR);
  for (let c = 0; c < 2; c++) {
    const r = rng(900 + c);
    const d = ir.getChannelData(c);
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < d.length; i++) {
      l1 = aIr * l1 + (1 - aIr) * (r() * 2 - 1);
      l2 = aIr * l2 + (1 - aIr) * l1;
      d[i] = l2 * Math.pow(1 - i / d.length, 4);
    }
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  const verbTone = ctx.createBiquadFilter();
  verbTone.type = 'lowpass';
  verbTone.frequency.value = 1000;
  const dry = ctx.createGain();
  dry.gain.value = 0.6;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1200;
  tone.Q.value = 0.5;
  tone.connect(dry).connect(ctx.destination);
  tone.connect(verb).connect(verbTone).connect(wet).connect(ctx.destination);
  // Arka plandaki sürekli pad/kök: çok kısık ve boğuk ("dınnn" uğultusu olmasın)
  const padTone = ctx.createBiquadFilter();
  padTone.type = 'lowpass';
  padTone.frequency.value = 650;
  padTone.Q.value = 0.4;
  padTone.connect(tone);

  const chords = [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 60], // Cmaj7/E
    [57, 60, 64, 67], // Am7
    [55, 60, 62, 64], // G6sus
  ];
  // İlk akor döngünün SONUNDA (loop-3) çalınır; kuyruk başa sarılınca 0. saniyeden itibaren
  // kesintisiz duyulur. Diğerleri kendi yerinde, 3 sn önceden yumuşakça girer.
  chords.forEach((ch, k) => {
    const t0 = k === 0 ? loop - 3 : k * bar - 3;
    const t1 = t0 + bar + 6;
    for (const n of ch) {
      // Sadece saf sinüs (üçgen dalganın tiz harmonikleri çızırtı gibi duyuluyordu)
      for (const [type, det, lvl] of [['sine', 0, 0.015], ['sine', 6, 0.009]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = midi(n);
        o.detune.value = det;
        const g = ctx.createGain();
        const s = Math.max(0, t0);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(lvl, s + 4.5);
        g.gain.setValueAtTime(lvl, Math.max(s + 4.5, t1 - 5));
        g.gain.linearRampToValueAtTime(0, t1);
        o.connect(g).connect(padTone);
        o.start(s);
        o.stop(t1 + 0.1);
      }
    }
    // Alçak kök notası: sıcak zemin
    const root = ctx.createOscillator();
    root.type = 'sine';
    root.frequency.value = midi(ch[0]! - 12);
    const rg = ctx.createGain();
    const s = Math.max(0, t0);
    rg.gain.setValueAtTime(0, s);
    rg.gain.linearRampToValueAtTime(0.008, s + 5);
    rg.gain.setValueAtTime(0.008, Math.max(s + 5, t1 - 5));
    rg.gain.linearRampToValueAtTime(0, t1);
    root.connect(rg).connect(padTone);
    root.start(s);
    root.stop(t1 + 0.1);
  });

  // Çan notaları: A minör pentatonik, seyrek ve yumuşak (yağmur damlası gibi)
  const pent = [69, 72, 74, 76, 79, 81, 84];
  const r = rng(4242);
  let t = 2.2;
  while (t < loop - 2.5) {
    const n = pent[Math.floor(r() * pent.length)]!;
    // Çok kısık, yumuşak girişli ("ding" vuruşu yok), kısa çınlama, seyrek
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midi(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(tone);
    o.start(t);
    o.stop(t + 2.3);
    t += 5 + r() * 5;
  }

  const out = await ctx.startRendering();
  // Kuyruğu (yankı) başa sar: dikişsiz döngü
  const L = Math.round(loop * SR);
  const T = out.length - L;
  const res = new AudioBuffer({ numberOfChannels: 2, length: L, sampleRate: SR });
  for (let c = 0; c < 2; c++) {
    const a = out.getChannelData(c);
    const o = res.getChannelData(c);
    o.set(a.subarray(0, L));
    for (let i = 0; i < T; i++) o[i]! += a[L + i]!;
  }
  // Sabit kazanç (otomatik seviyeleme yok): pad kısılınca çan notaları yükselmesin
  for (let c = 0; c < 2; c++) {
    const d = res.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i]! *= 1.3;
  }
  return res;
}
