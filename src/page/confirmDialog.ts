/**
 * Piksel tarzı onay paneli ("Emin misin?"). Evet'e basınca verilen işlemi çalıştırır,
 * bekleme / başarı / hata durumunu aynı panelde gösterir.
 */
export interface ConfirmOptions {
  tone: 'buy' | 'sell' | 'info';
  /** Üst küçük etiket (ör. nadirlik) */
  kicker?: string;
  kickerTone?: 'common' | 'rare' | 'legendary' | 'mythic';
  title: string;
  art?: HTMLCanvasElement;
  /** [etiket, değer] satırları */
  rows?: Array<[string, string]>;
  note?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Evet'e basınca çalışır; hata fırlatırsa mesajı panelde gösterilir */
  onConfirm?: () => Promise<string | void>;
  /** Hata nesnesini oyuncuya gösterilecek metne çevirir */
  formatError?: (err: unknown) => string;
}

let openDialog: (() => void) | null = null;

export function confirmDialog(o: ConfirmOptions): void {
  openDialog?.();
  const back = document.createElement('div');
  back.className = 'px-modal';
  const box = document.createElement('div');
  box.className = `px-modal__box px-modal__box--${o.tone}${o.kickerTone ? ` px-modal__box--${o.kickerTone}` : ''}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'px-modal-title');

  const head = document.createElement('div');
  head.className = 'px-modal__head';
  if (o.art) {
    const art = document.createElement('canvas');
    art.width = o.art.width;
    art.height = o.art.height;
    art.getContext('2d')!.drawImage(o.art, 0, 0);
    art.className = 'px-modal__art';
    art.style.width = `${o.art.width * 2}px`;
    art.style.height = `${o.art.height * 2}px`;
    head.append(art);
  }
  const titles = document.createElement('div');
  if (o.kicker) {
    const k = document.createElement('span');
    k.className = 'px-modal__kicker';
    k.textContent = o.kicker;
    titles.append(k);
  }
  const h = document.createElement('h3');
  h.id = 'px-modal-title';
  h.textContent = o.title;
  titles.append(h);
  head.append(titles);

  const list = document.createElement('dl');
  list.className = 'px-modal__rows';
  for (const [k, v] of o.rows ?? []) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    list.append(dt, dd);
  }

  const note = document.createElement('p');
  note.className = 'px-modal__note';
  note.textContent = o.note ?? '';
  note.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'px-modal__actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'px-btn px-btn--ghost';
  cancel.textContent = o.cancelLabel ?? 'Cancel';
  actions.append(cancel);
  let yes: HTMLButtonElement | null = null;
  if (o.onConfirm) {
    yes = document.createElement('button');
    yes.type = 'button';
    yes.className = `px-btn px-btn--${o.tone}`;
    yes.textContent = o.confirmLabel ?? 'Yes';
    actions.append(yes);
  }

  box.append(head);
  if (o.rows?.length) box.append(list);
  box.append(note, actions);
  back.append(box);
  document.body.append(back);
  const prevFocus = document.activeElement as HTMLElement | null;
  (yes ?? cancel).focus();

  let busy = false;
  const close = () => {
    if (busy) return;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    openDialog = null;
    prevFocus?.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Odağı panelin içinde tut
      const items = [...box.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      items[next]!.focus();
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  cancel.onclick = close;
  openDialog = () => {
    busy = false;
    close();
  };

  if (yes && o.onConfirm) {
    const run = o.onConfirm;
    yes.onclick = async () => {
      busy = true;
      yes!.disabled = true;
      cancel.disabled = true;
      box.classList.add('is-busy');
      note.textContent = o.tone === 'sell' ? 'Selling…' : 'Buying…';
      try {
        const done = await run();
        box.classList.remove('is-busy');
        box.classList.add('is-done');
        note.textContent = done || 'Done!';
        yes!.remove();
        cancel.disabled = false;
        cancel.textContent = 'Close';
        cancel.className = 'px-btn px-btn--ok';
        cancel.focus();
        busy = false;
      } catch (err) {
        busy = false;
        box.classList.remove('is-busy');
        box.classList.add('is-error');
        note.textContent = o.formatError ? o.formatError(err) : 'Something went wrong, try again';
        yes!.disabled = false;
        cancel.disabled = false;
      }
    };
  }
}
