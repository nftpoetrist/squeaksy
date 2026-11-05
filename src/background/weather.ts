import type { BackgroundConfig } from './config';
import type { EventBus } from './events';
import type { BackgroundEvents, WeatherMode, WeatherParams } from './types';
import { approach, smoothstep } from './util/math';

const ALL_MODES: WeatherMode[] = ['storm', 'cloudy', 'sunny'];

/**
 * Hava durumu durum makinesi. Mod değişince parametreler ani değil,
 * her biri kendi hızında hedefe yaklaşır: önce bulutlar toplanır,
 * sonra kararır, ardından yağmur ve yıldırım başlar (tersi de aynı).
 */
export class WeatherSystem {
  mode: WeatherMode;
  autoCycle: boolean;
  readonly params: WeatherParams;
  private timer: number;

  constructor(
    private cfg: BackgroundConfig['weather'],
    private readonly bus: EventBus<BackgroundEvents>,
  ) {
    this.mode = cfg.initial;
    this.autoCycle = cfg.autoCycle;
    this.params = { ...cfg.modes[cfg.initial] };
    this.timer = this.duration(this.mode);
  }

  setConfig(cfg: BackgroundConfig['weather']): void {
    this.cfg = cfg;
  }

  setMode(mode: WeatherMode, instant = false): void {
    if (mode !== this.mode) {
      const from = this.mode;
      this.mode = mode;
      this.bus.emit('weather:change', { from, to: mode });
    }
    this.timer = this.duration(mode);
    if (instant) Object.assign(this.params, this.cfg.modes[mode]);
  }

  /** Mevcut moddan kalan süre (saniye) */
  get timeLeft(): number {
    return this.timer;
  }

  /** Bulutlar yeterince kararmadan yakın yıldırım düşmez (dakikada). */
  get nearRate(): number {
    return this.params.lightning * smoothstep(0.55, 0.92, this.params.cloudDarkness);
  }

  get farRate(): number {
    return this.params.farLightning * smoothstep(0.25, 0.6, this.params.cloudCover);
  }

  update(dt: number): void {
    if (this.autoCycle) {
      this.timer -= dt;
      if (this.timer <= 0) this.setMode(this.pickNext());
    }
    const t = this.cfg.modes[this.mode];
    const p = this.params;
    const k = Math.max(0.05, this.cfg.transitionSeconds / 10);

    p.cloudCover = approach(p.cloudCover, t.cloudCover, dt, 5 * k);
    p.cloudDarkness = approach(p.cloudDarkness, t.cloudDarkness, dt, 6 * k);

    // Yağmur bulutları takip eder: bulutlar kararmadan şiddetlenmez.
    const rainRising = t.rain > p.rain;
    const rainTarget = rainRising ? t.rain * smoothstep(0.35, 0.85, p.cloudDarkness + p.cloudCover * 0.3) : t.rain;
    p.rain = approach(p.rain, rainTarget, dt, (rainRising ? 4 : 3.5) * k);

    p.lightning = approach(p.lightning, t.lightning, dt, 2 * k);
    p.farLightning = approach(p.farLightning, t.farLightning, dt, 3 * k);

    // Güneş, bulutlar dağıldıkça açılır.
    const sunRising = t.sun > p.sun;
    const sunTarget = sunRising ? t.sun * (1 - smoothstep(0.4, 0.85, p.cloudCover)) : t.sun;
    p.sun = approach(p.sun, sunTarget, dt, (sunRising ? 6 : 4) * k);

    p.motes = approach(p.motes, t.motes, dt, 5 * k);
    p.wind = approach(p.wind, t.wind, dt, 6 * k);
  }

  private duration(m: WeatherMode): number {
    const [a, b] = this.cfg.durations[m];
    return a + Math.random() * (b - a);
  }

  private pickNext(): WeatherMode {
    const weights = this.cfg.next[this.mode];
    const entries = (Object.entries(weights) as Array<[WeatherMode, number]>).filter(([, w]) => w > 0);
    if (entries.length === 0) {
      const others = ALL_MODES.filter((m) => m !== this.mode);
      return others[Math.floor(Math.random() * others.length)]!;
    }
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [m, w] of entries) {
      r -= w;
      if (r <= 0) return m;
    }
    return entries[entries.length - 1]![0];
  }
}
