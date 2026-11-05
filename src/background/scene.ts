import type { WeatherParams } from './types';

/** Çözünürlüğe bağlı, yeniden boyutlanınca baştan kurulan sahne geometrisi. */
export interface Scene {
  /** İç (düşük çözünürlüklü) tuval boyutu */
  W: number;
  H: number;
  /** Boyut birimi: 270 piksel yükseklik = 1 */
  u: number;
  /** Paralaks için katman tuvallerinin her iki yandaki fazlalığı */
  PAD: number;
  /** Gökyüzü gradyanının bittiği çizgi */
  horizon: number;
  /** Hamster çarkı (sol alt, zemin üstünde) */
  wheel: { cx: number; cy: number; R: number; groundY: number };
  /** Düz zemin bölgesi (sağ alt: kulübe + uyuyan hamsterler); x0..x1 arası y yüksekliğinde düz */
  plateau?: { x0: number; x1: number; y: number };
  /** Sırt çizgileri (uzunluk W + 2*PAD; indeks = x + PAD) */
  farRidge: Float32Array;
  midRidge: Float32Array;
  groundTop: Float32Array;
  /** Bu karedeki paralaks kaymaları (yıldırımın yere tam oturması için) */
  offsets: { far: number; mid: number; ground: number };
}

/** Her karede katmanlara verilen durum. */
export interface Frame {
  /** Animasyon zamanı (saniye) */
  t: number;
  dt: number;
  p: Readonly<WeatherParams>;
  /** Kalite çarpanı 0.4..1 */
  q: number;
  /** Yıldırım aydınlanması 0..1 */
  flash: number;
  /** Yumuşatılmış imleç konumu -1..1 */
  px: number;
  py: number;
  parallax: number;
}

export function offX(f: Frame, depth: number): number {
  return Math.round(-f.px * f.parallax * depth);
}

export function offY(f: Frame, depth: number): number {
  return Math.round(-f.py * f.parallax * depth * 0.35);
}

export function ridgeAt(ridge: Float32Array, scene: Scene, x: number, ox = 0): number {
  const i = Math.round(x - ox + scene.PAD);
  return ridge[i < 0 ? 0 : i >= ridge.length ? ridge.length - 1 : i]!;
}
