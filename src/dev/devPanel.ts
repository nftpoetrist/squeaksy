import type { PixelStormBackground } from '../background/Background';
import type { WeatherMode } from '../background/types';

const MODES: Array<[WeatherMode, string, string]> = [
  ['storm', 'Storm', '1'],
  ['cloudy', 'Cloudy', '2'],
  ['sunny', 'Sunny', '3'],
];

/** Review panel, only shown with ?dev (not part of the game UI). */
export function mountDevPanel(bg: PixelStormBackground): void {
  const style = document.createElement('style');
  style.textContent = `
  .sqk-dev{position:fixed;left:12px;bottom:12px;z-index:50;pointer-events:auto;font:12px/1.35 ui-monospace,Menlo,monospace;
    color:#e8e4ff;background:rgba(10,8,30,.86);border:1px solid #4b3a86;border-radius:10px;
    padding:10px;min-width:220px;max-width:calc(100vw - 48px)}
  .sqk-dev h4{margin:0 0 6px;font-size:12px;color:#ffd84d;letter-spacing:.08em}
  .sqk-dev .row{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
  .sqk-dev button{font:inherit;color:#e8e4ff;background:#21184a;border:1px solid #4b3a86;border-radius:6px;padding:3px 7px;cursor:pointer}
  .sqk-dev button:hover{background:#2e2364}
  .sqk-dev button.on{background:#ffd84d;color:#1a1240;border-color:#fff6c8}
  .sqk-dev .stats{white-space:pre;color:#b9b2ff;font-size:11px}
  .sqk-dev .log{color:#7ef0ff;font-size:11px;margin-top:4px}
  .sqk-dev .hide{position:absolute;top:4px;right:6px;padding:0 5px}`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'sqk-dev';
  el.innerHTML = `<button class="hide" title="Hide (H)">×</button><h4>SQUEAKSY · DEV</h4>
    <div class="row" data-modes></div>
    <div class="row"><button data-auto>Auto cycle (A)</button></div>
    <div class="row"><button data-strike="near">⚡ Strike (L)</button><button data-strike="super">⚡⚡ Big (B)</button><button data-strike="far">Far</button></div>
    <div class="row"><button data-coins>💰 Reward strike preview (C)</button></div>
    <div class="row"><button data-run>🐹 Run / stop (R)</button><button data-fill>Reset chain</button><button data-finale>⚡ Finale (F)</button></div>
    <div class="row" data-moods><button data-mood="normal">Normal</button><button data-mood="fast">Fast</button><button data-mood="tired">Tired</button><button data-boost>⚡ Thunder boost (T)</button></div>
    <div class="stats"></div><div class="log">Lightning events: 0</div>`;
  document.body.appendChild(el);

  const modesRow = el.querySelector<HTMLDivElement>('[data-modes]')!;
  const modeButtons = new Map<WeatherMode, HTMLButtonElement>();
  for (const [mode, label, key] of MODES) {
    const b = document.createElement('button');
    b.textContent = `${label} (${key})`;
    b.onclick = () => {
      bg.setAutoCycle(false);
      bg.setWeather(mode);
      sync();
    };
    modesRow.appendChild(b);
    modeButtons.set(mode, b);
  }
  const autoBtn = el.querySelector<HTMLButtonElement>('[data-auto]')!;
  autoBtn.onclick = () => {
    bg.setAutoCycle(!bg.getStats().autoCycle);
    sync();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-strike]').forEach((b) => {
    b.onclick = () => bg.strike(b.dataset.strike as 'near' | 'super' | 'far');
  });
  el.querySelector<HTMLButtonElement>('[data-coins]')!.onclick = () => bg.strikeBlock({ kind: 'super', coins: 40 });
  const runBtn = el.querySelector<HTMLButtonElement>('[data-run]')!;
  runBtn.onclick = () => bg.toggleHamster();
  el.querySelector<HTMLButtonElement>('[data-fill]')!.onclick = () => bg.resetChain();
  el.querySelector<HTMLButtonElement>('[data-finale]')!.onclick = () => bg.triggerFinale();
  const moodButtons = el.querySelectorAll<HTMLButtonElement>('[data-mood]');
  moodButtons.forEach((b) => {
    b.onclick = () => {
      bg.setHamsterMood(b.dataset.mood as 'normal' | 'fast' | 'tired');
      sync();
    };
  });
  el.querySelector<HTMLButtonElement>('[data-boost]')!.onclick = () => bg.boostHamster();
  el.querySelector<HTMLButtonElement>('.hide')!.onclick = () => (el.style.display = 'none');

  const stats = el.querySelector<HTMLDivElement>('.stats')!;
  const log = el.querySelector<HTMLDivElement>('.log')!;
  let count = 0;
  let power = 0;
  bg.events.on('lightning:strike', (e) => {
    count++;
    power += e.power;
    log.textContent = `Lightning events: ${count} · total power ${power.toFixed(2)} · last: ${e.kind}${e.target ? ` → cluster ${e.target.cluster}` : ''}${e.coins ? ` · ${e.coins} coins` : ''}`;
  });

  function sync(): void {
    const s = bg.getStats();
    for (const [m, b] of modeButtons) b.classList.toggle('on', s.mode === m);
    autoBtn.classList.toggle('on', s.autoCycle);
    runBtn.classList.toggle('on', bg.hamsterRunning);
    moodButtons.forEach((b) => b.classList.toggle('on', b.dataset.mood === bg.hamsterMood));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    const k = e.key.toLowerCase();
    const m = MODES.find(([, , key]) => key === k);
    if (m) {
      bg.setAutoCycle(false);
      bg.setWeather(m[0]);
    } else if (k === 'l') bg.strike('near');
    else if (k === 'b') bg.strike('super');
    else if (k === 'c') bg.strikeBlock({ kind: 'super', coins: 40 });
    else if (k === 'r') bg.toggleHamster();
    else if (k === 't') bg.boostHamster();
    else if (k === 'f') bg.triggerFinale();
    else if (k === 'a') bg.setAutoCycle(!bg.getStats().autoCycle);
    else if (k === 'h') el.style.display = el.style.display === 'none' ? '' : 'none';
    sync();
  });

  bg.events.on('weather:change', sync);
  bg.events.on('hamster:state', sync);
  window.setInterval(() => {
    const s = bg.getStats();
    const p = bg.params;
    stats.textContent =
      `fps ${s.fps}  draw ${s.workMs}ms  quality ${s.quality}\n` +
      `canvas ${s.width}×${s.height} ×${s.scale}\n` +
      `clouds ${p.cloudCover.toFixed(2)} dark ${p.cloudDarkness.toFixed(2)}\n` +
      `rain ${p.rain.toFixed(2)} sun ${p.sun.toFixed(2)}\n` +
      `hamster ${bg.hamsterState} · wheel ${bg.wheelSpeed.toFixed(1)} rad/s · \n` +
      `chain ${bg.chainStatus.filled}/${bg.chainStatus.total} blocks · clouds ${bg.chainStatus.clouds}/${bg.chainStatus.totalClouds} · ${bg.chainStatus.phase} · earning ${bg.isEarning} · in flight ${bg.coinsInFlight}` +
      (s.autoCycle ? `\nnext weather in ${Math.max(0, s.timeLeft).toFixed(0)}s` : '');
  }, 250);
  sync();
}
