import type { PixelStormBackground } from '../background/Background';
import type { HamsterState } from '../background/layers/hamster';
import { clock, type RunBudget } from '../auth/runBudget';

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

const LIFE_CELLS = 10;

export interface RunButtonUi {
  /** Hamster canı: RUN altında can çubuğu, can bitince uyanma sayacı */
  setBudget(b: RunBudget): void;
}

/**
 * Çarkın altındaki piksel RUN / STOP butonu. Konumu çarkın sahnedeki yerinden hesaplanır
 * ve sahne yeniden ölçeklenince güncellenir. Giriş yapılmışsa altında hamsterin canı (2 saat) görünür;
 * can bitince buton "Rest" olur, uyuyan hamsterin başının üstünde uyanma sayacı çıkar.
 */
export function mountRunButton(stage: HTMLElement, bg: PixelStormBackground): RunButtonUi {
  const wrap = document.createElement('div');
  wrap.className = 'run-control';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'run-btn';

  // Can çubuğu: piksel kalp + 10 hücre + kalan süre
  const life = document.createElement('div');
  life.className = 'run-life';
  life.hidden = true;
  const heart = document.createElement('i');
  heart.className = 'run-life__heart';
  heart.setAttribute('aria-hidden', 'true');
  const cells = document.createElement('span');
  cells.className = 'run-life__bar';
  cells.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < LIFE_CELLS; i++) cells.append(document.createElement('i'));
  const lifeText = document.createElement('span');
  lifeText.className = 'run-life__time';
  life.append(heart, cells, lifeText);

  const hint = document.createElement('p');
  hint.className = 'run-hint';
  hint.setAttribute('aria-live', 'polite');
  wrap.append(btn, life, hint);
  stage.appendChild(wrap);

  // Uyanma sayacı: uyuyan hamsterin başının üstünde
  const rest = document.createElement('div');
  rest.className = 'rest-tag';
  rest.hidden = true;
  rest.setAttribute('role', 'status');
  const moon = document.createElement('i');
  moon.className = 'rest-tag__moon';
  moon.setAttribute('aria-hidden', 'true');
  const restBody = document.createElement('span');
  restBody.className = 'rest-tag__body';
  const restLabel = document.createElement('span');
  restLabel.className = 'rest-tag__label';
  restLabel.textContent = 'Wakes in';
  const restTime = document.createElement('b');
  restTime.className = 'rest-tag__time';
  restBody.append(restLabel, restTime);
  rest.append(moon, restBody);
  stage.appendChild(rest);

  let budget: RunBudget | null = null;

  const sync = () => {
    const resting = budget?.resting ?? false;
    const running = bg.hamsterRunning;
    btn.textContent = resting ? 'Rest' : running ? 'Stop' : 'Run';
    btn.classList.toggle('is-running', running && !resting);
    btn.classList.toggle('is-resting', resting);
    btn.setAttribute('aria-disabled', String(resting));
    btn.setAttribute('aria-pressed', String(running));
    btn.setAttribute('aria-label', resting ? 'The hamster is resting' : running ? 'Stop the hamster' : 'Wake the hamster and run');

    const show = budget?.active ?? false;
    life.hidden = !show;
    if (budget && show) {
      const left = budget.left();
      const on = resting ? 0 : Math.ceil(budget.fraction() * LIFE_CELLS);
      [...cells.children].forEach((c, i) => c.classList.toggle('is-on', i < on));
      life.classList.toggle('is-low', !resting && left <= 10 * 60);
      life.classList.toggle('is-empty', resting);
      lifeText.textContent = resting ? 'Out of energy' : `${clock(left)} left`;
      life.setAttribute('aria-label', resting ? 'Out of energy' : `Energy: ${clock(left)} of running left today`);
    }
    if (resting && budget) {
      restTime.textContent = clock(budget.wakeInMs() / 1000);
      // Sayaç hamster yatağına varınca çıkar (yürürken etiket peşinden zıplamasın)
      const was = rest.hidden;
      rest.hidden = bg.hamsterState !== 'sleep' && bg.hamsterState !== 'settle';
      if (was && !rest.hidden) requestAnimationFrame(placeRest);
      hint.textContent = 'Resting after 2 hours of running';
    } else {
      rest.hidden = true;
      hint.textContent = HINTS[bg.hamsterState];
    }
  };

  const place = () => {
    const g = bg.getWheelGeometryInStage();
    if (!g) return;
    wrap.style.left = `${Math.round(g.x)}px`;
    wrap.style.top = `${Math.round(g.groundY + 18)}px`;
    placeRest();
  };
  const placeRest = () => {
    if (rest.hidden) return;
    const h = bg.getHamsterHeadInStage();
    if (!h) return;
    // Sahnenin içinde kalsın (dar ekranda hamster kenara yakın olabilir)
    const half = rest.offsetWidth / 2;
    const x = Math.min(Math.max(h.x, half + 8), stage.clientWidth - half - 8);
    rest.style.left = `${Math.round(x)}px`;
    rest.style.top = `${Math.round(h.y - 10)}px`;
  };

  btn.addEventListener('click', () => {
    if (budget?.resting) {
      // Dinleniyor: buton sallanır, sayaç dikkat çeker
      btn.classList.remove('is-nudge');
      rest.classList.remove('is-nudge');
      void btn.offsetWidth;
      btn.classList.add('is-nudge');
      rest.classList.add('is-nudge');
      return;
    }
    bg.toggleHamster();
    sync();
  });
  bg.events.on('hamster:state', () => {
    sync();
    placeRest();
  });
  bg.events.on('scene:resize', place);
  place();
  sync();

  return {
    setBudget(b) {
      budget = b;
      b.onChange(() => {
        sync();
        placeRest();
      });
      sync();
    },
  };
}
