import type { EventBus } from '../background/events';
import type { BackgroundEvents } from '../background/types';
import type { AudioManager } from './AudioManager';

/**
 * Arka plan olaylarını seslere bağlar. Arka plan sesten habersizdir;
 * bağlantı sadece burada kurulur. Ses kapalıyken hiçbir şey çalmaz.
 * Sakin kalması için: gürlemeler seyreltilir (aynı anda düşen yıldırımlar tek gürleme olur),
 * müzik şimdilik kapalı (sadece yağmur + yıldırım).
 */
export function bindBackgroundAudio(bus: EventBus<BackgroundEvents>, audio: AudioManager): () => void {
  let lastZap = -1e9;
  let lastSuper = -1e9;
  let lastNear = -1e9;
  let lastFar = -1e9;
  // Olay, şimşeğin ekranda göründüğü karede gelir: "zap" hemen (gecikmesiz) çalar,
  // gürleme hemen ardından (yakınsa ~0.1 sn, uzaksa biraz daha geç) başlar.
  const offStrike = bus.on('lightning:strike', (e) => {
    const now = performance.now();
    const pan = (e.nx * 2 - 1) * 0.6;
    if (e.kind === 'super') {
      // Final vuruşu: tüm bulutlara aynı anda düşer (6 olay aynı karede) → TEK zap + TEK dolgun
      // gürleme. Şarjdaki şimşeklerin seyreltme sınırlarına takılmaz (önceden sessiz kalıyordu).
      if (now - lastSuper < 500) return;
      lastSuper = now;
      lastZap = now;
      lastNear = now;
      audio.play('sfx.lightning.crack', { pan: 0, volume: 1, rate: 0.9 });
      audio.play('sfx.thunder.near', { pan: 0, delay: 0.1, volume: 1, rate: 0.88 });
      return;
    }
    if (e.kind === 'near') {
      // Şarj aşamasında sıklaşan şimşekler: biraz daha kısık zap (final vuruşu öne çıksın)
      if (now - lastZap > 160) {
        lastZap = now;
        audio.play('sfx.lightning.crack', { pan, volume: 0.6, rate: 0.94 + Math.random() * 0.12 });
      }
      if (now - lastNear < 1000) return;
      lastNear = now;
      audio.play('sfx.thunder.near', { pan, delay: 0.08 + Math.random() * 0.06, volume: 0.75, rate: 0.92 + Math.random() * 0.12 });
    } else if (e.kind === 'far') {
      if (now - lastFar < 1800) return;
      lastFar = now;
      audio.play('sfx.thunder.far', { pan: pan * 0.6, delay: 0.25 + Math.random() * 0.25, volume: 0.7, rate: 0.9 + Math.random() * 0.15 });
    } else {
      // Bulut içi şimşek: çok hafif, uzak bir gürleme
      if (now - lastFar < 2500) return;
      lastFar = now;
      audio.play('sfx.thunder.far', { pan: pan * 0.5, delay: 0.3 + Math.random() * 0.3, volume: 0.45, rate: 0.9 + Math.random() * 0.15 });
    }
  });

  const offTick = bus.on('weather:tick', ({ params, rainDrops }) => {
    // Yağmur sesi ekrandaki yağmurla birebir (kullanıcı, 2026-11-05):
    // - ekranda tek damla yoksa ses tamamen durur (karar çizilen damla sayısından)
    // - yükseklik yağmur yoğunluğuyla: çok damlanın toplam sesi damla sayısının karekökü kadar büyür
    //   → fırtına (rain 0.8) tam ses, çisenti (0.06) ~%27, azaldıkça aynı oranda kısılır
    // - tick 0.25 sn; kısa geçiş (0.3 sn) görüntünün gerisinde kalmaz
    const level = rainDrops > 0 ? Math.sqrt(Math.min(1, params.rain / 0.8)) : 0;
    audio.setLoop('ambience.rain', level, 0.3);
    // Müzik şimdilik kapalı (kullanıcı isteği): audio.setLoop('music.ambient', 1, 4);
  });

  return () => {
    offStrike();
    offTick();
  };
}
