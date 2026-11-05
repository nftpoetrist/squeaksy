import type { SoundDef } from './AudioManager';
import { thunder, zap } from './synth';

/**
 * Ses kataloğu. Yıldırım sesleri kodla üretilir (src/audio/synth.ts).
 * Yağmur: kullanıcının verdiği kayıt (public/audio/rain.m4a; kaynak 5a5360c5c4e13.mp3, sessiz uçları
 * kırpılmış, AAC 96 kbps). Kodla üretilen yağmur ve içindeki cızırtı katmanı kaldırıldı (kullanıcı, 2026-11-05).
 * Dosya yalnızca oyuncu sesi açınca indirilir. Seviye eski yağmura eşitlendi (ölçülen RMS'e göre).
 * Sakin kalsın diye: yıldırım anında sadece kısa, yumuşak bir piksel "zap", ardından derin gürleme;
 * elektrik cızırtısı bilerek sessiz (src: null).
 */
export const SOUNDS: SoundDef[] = [
  { id: 'ambience.rain', channel: 'ambience', src: '/audio/rain.m4a', loop: true, seamless: 2, volume: 0.39 },
  { id: 'ambience.wind', channel: 'ambience', src: null, loop: true, volume: 0.5 },
  { id: 'ambience.birds', channel: 'ambience', src: null, loop: true, volume: 0.4 },
  { id: 'sfx.lightning.crack', channel: 'sfx', src: null, synth: (c) => [31, 32, 33].map((s) => zap(c, s)), volume: 0.16 },
  { id: 'sfx.thunder.near', channel: 'sfx', src: null, synth: (c) => [11, 12, 13].map((s) => thunder(c, s, true)), volume: 0.36 },
  { id: 'sfx.thunder.far', channel: 'sfx', src: null, synth: (c) => [21, 22, 23].map((s) => thunder(c, s, false)), volume: 0.26 },
  { id: 'sfx.electric.sparks', channel: 'sfx', src: null, volume: 0.6 },
  // Müzik şimdilik kapalı (kullanıcı isteği): geri açmak için aşağıdaki satırı ve backgroundAudio'daki setLoop'u aç
  // { id: 'music.ambient', channel: 'music', src: null, synth: async () => [await music()], loop: true, volume: 0.38 },
];
