import type { PixelStormBackground } from '../background/Background';
import type { HamsterState } from '../background/layers/hamster';

const HINTS: Record<HamsterState, string> = {
  sleep: 'Zzz… wake the hamster up!',
  wake: 'Huh?!',
  walkIn: 'Heading to the wheel…',
  jumpIn: 'Hop!',
  run: 'Running! Filling the clouds…',
  brake: 'Slowing down…',
  wheelIdle: 'Taking a breather',
  jumpOut: 'Hop!',
  walkOut: 'Going back to bed…',
  settle: 'Getting cozy…',
};

/**
 * Çarkın altındaki piksel RUN / STOP butonu. Konumu çarkın sahnedeki yerinden hesaplanır
 * ve sahne yeniden ölçeklenince güncellenir.
 */
export function mountRunButton(stage: HTMLElement, bg: PixelStormBackground): void {
  const wrap = document.createElement('div');
  wrap.className = 'run-control';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'run-btn';
  const hint = document.createElement('p');
  hint.className = 'run-hint';
  hint.setAttribute('aria-live', 'polite');
  wrap.append(btn, hint);
  stage.appendChild(wrap);

  const sync = () => {
    const running = bg.hamsterRunning;
    btn.textContent = running ? 'Stop' : 'Run';
    btn.classList.toggle('is-running', running);
    btn.setAttribute('aria-pressed', String(running));
    btn.setAttribute('aria-label', running ? 'Stop the hamster' : 'Wake the hamster and run');
    hint.textContent = HINTS[bg.hamsterState];
  };
  const place = () => {
    const g = bg.getWheelGeometryInStage();
    if (!g) return;
    wrap.style.left = `${Math.round(g.x)}px`;
    wrap.style.top = `${Math.round(g.groundY + 18)}px`;
  };

  btn.addEventListener('click', () => {
    bg.toggleHamster();
    sync();
  });
  bg.events.on('hamster:state', sync);
  bg.events.on('scene:resize', place);
  place();
  sync();
}
