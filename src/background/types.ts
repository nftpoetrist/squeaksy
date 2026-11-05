export type WeatherMode = 'storm' | 'cloudy' | 'sunny';

export type QualityLevel = 'high' | 'medium' | 'low';

/**
 * near  : normal yıldırım (bir bloğa çarpar)
 * super : büyük yıldırım (kalın, daha çok kıvılcım, sarsıntı) → ileride büyük ödül
 * far   : ince, sönük yıldırım (bulutlu havada bloğa çarpar)
 * sheet : bulut içinde parlayan "yaprak" şimşek
 */
export type LightningKind = 'near' | 'super' | 'far' | 'sheet';

/** Hava durumunun anlık, sürekli (interpolasyonlu) parametreleri. */
export interface WeatherParams {
  /** 0..1 gökyüzündeki bulut miktarı */
  cloudCover: number;
  /** 0..1 bulutların koyuluğu (fırtına) */
  cloudDarkness: number;
  /** 0..1 yağmur şiddeti */
  rain: number;
  /** dakikada yakın yıldırım sayısı */
  lightning: number;
  /** dakikada uzak yıldırım / bulut içi şimşek sayısı */
  farLightning: number;
  /** 0..1 güneş ışığı */
  sun: number;
  /** 0..1 altın parçacık yoğunluğu */
  motes: number;
  /** -1..1 rüzgâr (yağmur eğimi ve bulut hızı) */
  wind: number;
}

/** Yıldırımın çarptığı blok (blok bulutu kümesi + blok indeksi) */
export interface StrikeTarget {
  cluster: number;
  tile: number;
}

export interface LightningStrikeEvent {
  id: number;
  kind: LightningKind;
  /** Çarpma noktası, iç (düşük çözünürlüklü) piksel koordinatı */
  x: number;
  y: number;
  /** Çarpma noktası, ekrana göre 0..1 */
  nx: number;
  ny: number;
  /** Göreli güç: sheet 0.1, far 0.25, near 1, super 3 → ödül çarpanı olarak kullanılabilir */
  power: number;
  /** Çarpılan blok; bulut içi şimşekte (sheet) null */
  target: StrikeTarget | null;
  /** Bu yıldırımla görsel olarak dökülen coin sayısı */
  coins: number;
  /** performance.now() zamanı (ms) */
  time: number;
  /** Elle (API / geliştirici paneli) mi tetiklendi */
  manual: boolean;
}

export interface BackgroundEvents {
  'lightning:strike': LightningStrikeEvent;
  'weather:change': { from: WeatherMode; to: WeatherMode };
  /** Saniyede ~4 kez: ses ambiyansı vb. için */
  'weather:tick': { mode: WeatherMode; params: Readonly<WeatherParams>; rainDrops: number };
  'quality:change': { level: QualityLevel };
  /** Hamsterin davranış durumu değişti (buton etiketi vb. için) */
  'hamster:state': { state: import('./layers/hamster').HamsterState; running: boolean };
  /** Sahne yeniden ölçeklendi (çarka bağlı arayüz yeniden konumlanmalı) */
  'scene:resize': Record<string, never>;
  /** Hamster bir bloğu tamamladı (token yolda, sayaca uçuyor) */
  'chain:block': { cluster: number; tile: number; filled: number; total: number };
  /** Bir bulutun tüm blokları doldu; zinciri altına döndü */
  'chain:cloud': { cluster: number; clouds: number; totalClouds: number };
  /** Final: charge = şimşekler şiddetleniyor, strike = tüm bulutlara aynı anda vurdu, reset = bulutlar sıfırlandı */
  'chain:finale': { phase: 'charge' | 'strike' | 'reset' };
  /** Final ödülü: tüm bloklar tamamlandı, yıldırımlar çarptı (yalnızca kazanç açıkken) */
  'chain:bonus': { tokens: number };
  /** Uçan token sayaca ulaştı (görsel; asıl kayıt chain:block / chain:bonus anında yapılır) */
  'token:collect': { bonus: boolean };
}
