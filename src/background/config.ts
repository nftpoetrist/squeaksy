import type { QualityLevel, WeatherMode, WeatherParams } from './types';

export type QualitySetting = 'auto' | QualityLevel;

export interface BackgroundConfig {
  /** Manzara (dağ, kristal, blok yerleşimi) için sabit tohum: her açılışta aynı dünya */
  seed: number;
  pixel: {
    /** 'auto' → ekran boyutuna göre tam sayı ölçek; sayı → sabit ölçek */
    scale: 'auto' | number;
    /** auto ölçek = round(sqrt(genişlik*yükseklik) / autoDivisor) */
    autoDivisor: number;
    minScale: number;
    maxScale: number;
  };
  /** Çizim FPS üst sınırı (120Hz ekranlarda boşa GPU harcamamak için) */
  maxFps: number;
  quality: QualitySetting;
  /** Tüm animasyonlar için genel hız çarpanı */
  animationSpeed: number;
  /** Fare ile derinlik efekti (iç piksel). 0 = kapalı: sahne kullanıcı hareketine tepki vermez */
  parallax: number;
  /** prefers-reduced-motion açıksa sarsıntı/parlama/paralaks azaltılır */
  respectReducedMotion: boolean;
  weather: {
    initial: WeatherMode;
    autoCycle: boolean;
    /** Geçiş yumuşaklığı (saniye ölçeği). 10 = varsayılan, büyüdükçe yavaşlar */
    transitionSeconds: number;
    /** Her modun kaç saniye süreceği [min, max] */
    durations: Record<WeatherMode, [number, number]>;
    /** Otomatik döngüde bir moddan sonra hangisine geçileceği (ağırlıklar) */
    next: Record<WeatherMode, Partial<Record<WeatherMode, number>>>;
    /** Her modun hedef parametreleri */
    modes: Record<WeatherMode, WeatherParams>;
  };
  rain: { maxDrops: number; speed: number; splashes: boolean };
  lightning: {
    enabled: boolean;
    /** Mod hedeflerindeki yıldırım sıklığı ile çarpılır */
    rateMultiplier: number;
    /** İki yakın yıldırım arasındaki en kısa süre */
    minGapSeconds: number;
    branchChance: number;
    /** Ekran aydınlanma gücü 0..1 */
    flashStrength: number;
    /** Yakın yıldırımın "büyük yıldırım" olma ihtimali */
    superChance: number;
    shake: boolean;
    shakePixels: number;
    sparkCount: number;
  };
  particles: { maxMotes: number; maxSparks: number };
  /** blockClouds: gökyüzündeki blok bulutu kümesi sayısı */
  chain: { blockClouds: number; pulses: boolean };
  hamster: {
    /** Koşu modlarına göre koşu bandı hızı (iç piksel/sn). Patiler bu hıza kilitlidir. */
    speeds: { normal: number; fast: number; tired: number; boost: number };
    /** Normal hızda koşarken bir bloğun dolma süresi (sn). Hızlı koşu daha çabuk doldurur. */
    secondsPerBlock: number;
    /** STOP'tan sonra çarkta dinlenip yatağa dönmeden önceki süre (sn) */
    restBeforeBed: number;
  };
  /** Tüm bulutlar dolunca: şimşek fırtınası → hepsine aynı anda vuruş → sıfırlama */
  finale: {
    /** Şimşeklerin şiddetlendiği süre (sn) */
    chargeSeconds: number;
    /** Büyük vuruştan sonra yeniden dolmaya başlamadan önceki bekleme (sn) */
    cooldownSeconds: number;
  };
  stars: { density: number };
  /** 0..1 köşe karartması */
  vignette: number;
}

export const DEFAULT_CONFIG: BackgroundConfig = {
  seed: 9000,
  pixel: { scale: 'auto', autoDivisor: 270, minScale: 2, maxScale: 6 },
  // 120 Hz ekranlarda (ProMotion vb.) akıcı; 60 Hz ekranda rAF zaten 60'ta kalır
  maxFps: 120,
  quality: 'auto',
  animationSpeed: 1,
  parallax: 0,
  respectReducedMotion: true,
  weather: {
    initial: 'storm',
    autoCycle: true,
    transitionSeconds: 10,
    durations: { storm: [45, 75], cloudy: [22, 38], sunny: [30, 50] },
    next: {
      storm: { cloudy: 1 },
      cloudy: { sunny: 1, storm: 1 },
      sunny: { cloudy: 1 },
    },
    modes: {
      storm: {
        cloudCover: 1,
        cloudDarkness: 1,
        rain: 0.8,
        lightning: 10,
        farLightning: 8,
        sun: 0,
        motes: 0.12,
        wind: 0.35,
      },
      cloudy: {
        cloudCover: 0.68,
        cloudDarkness: 0.3,
        rain: 0.06,
        lightning: 0,
        farLightning: 4,
        sun: 0.06,
        motes: 0.4,
        wind: 0.15,
      },
      sunny: {
        cloudCover: 0.22,
        cloudDarkness: 0,
        rain: 0,
        lightning: 0,
        farLightning: 0,
        sun: 1,
        motes: 1,
        wind: 0.06,
      },
    },
  },
  rain: { maxDrops: 360, speed: 0.85, splashes: true },
  lightning: {
    enabled: true,
    rateMultiplier: 1,
    minGapSeconds: 1.4,
    branchChance: 0.13,
    flashStrength: 0.55,
    superChance: 0.12,
    /** Ekran sarsıntısı: kapalı (bulutlar dışında hiçbir şey kımıldamaz) */
    shake: false,
    shakePixels: 2,
    sparkCount: 36,
  },
  particles: { maxMotes: 45, maxSparks: 260 },
  chain: { blockClouds: 6, pulses: true },
  hamster: { speeds: { normal: 48, fast: 72, tired: 28, boost: 100 }, secondsPerBlock: 1.6, restBeforeBed: 3 },
  finale: { chargeSeconds: 3.6, cooldownSeconds: 1.6 },
  stars: { density: 1.1 },
  vignette: 0.55,
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : Array.isArray(v) ? [...v] : v;
  }
  return out as T;
}

export function mergeConfig(base: BackgroundConfig, patch: DeepPartial<BackgroundConfig> = {}): BackgroundConfig {
  return deepMerge(structuredClone(base), patch);
}
