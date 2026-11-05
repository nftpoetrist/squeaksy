import type { SoundDef } from './AudioManager';
import { rain, thunder, zap } from './synth';

/**
 * Ses kataloğu. Ortam sesleri telifsizdir: dosya yerine kodla üretilir (src/audio/synth.ts).
 * Sakin kalsın diye: yıldırım anında sadece kısa, yumuşak bir piksel "zap", ardından derin gürleme;
 * elektrik cızırtısı bilerek sessiz (src: null).
 */
export const SOUNDS: SoundDef[] = [
  { id: 'ambience.rain.light', channel: 'ambience', src: null, synth: (c) => [rain(c, false)], loop: true, volume: 0.24 },
  { id: 'ambience.rain.heavy', channel: 'ambience', src: null, synth: (c) => [rain(c, true)], loop: true, volume: 0.12 },
  { id: 'ambience.wind', channel: 'ambience', src: null, loop: true, volume: 0.5 },
  { id: 'ambience.birds', channel: 'ambience', src: null, loop: true, volume: 0.4 },
  { id: 'sfx.lightning.crack', channel: 'sfx', src: null, synth: (c) => [31, 32, 33].map((s) => zap(c, s)), volume: 0.16 },
  { id: 'sfx.thunder.near', channel: 'sfx', src: null, synth: (c) => [11, 12, 13].map((s) => thunder(c, s, true)), volume: 0.36 },
  { id: 'sfx.thunder.far', channel: 'sfx', src: null, synth: (c) => [21, 22, 23].map((s) => thunder(c, s, false)), volume: 0.26 },
  { id: 'sfx.electric.sparks', channel: 'sfx', src: null, volume: 0.6 },
  // Müzik şimdilik kapalı (kullanıcı isteği): geri açmak için aşağıdaki satırı ve backgroundAudio'daki setLoop'u aç
  // { id: 'music.ambient', channel: 'music', src: null, synth: async () => [await music()], loop: true, volume: 0.38 },
];
