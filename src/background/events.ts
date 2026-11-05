type Handler<T> = (payload: T) => void;

/** Küçük, tipli olay yayıncısı. Arka planı oyun mantığından ayırır. */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[Squeaksy] "${String(type)}" dinleyicisi hata verdi`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
