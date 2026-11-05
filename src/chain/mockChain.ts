import type { BountyClaim, ChainLive, ChainSource, ChainStorm, WheelStatus } from './types';

export type MockChainMode = 'active' | 'idle' | 'fault' | 'delayed' | 'pending' | 'offline';

/**
 * Gerçek Squeekchain inişleri (api.squeekchain.com/v1/settlements, 2026-11-05, hepsi 'safe').
 * Sahte iniş bunları sırayla oynatır: blok sayısı, aralık ve Sepolia işlemi gerçektir, bağlantı açılır.
 */
const REAL_LANDINGS: Array<{ tx: string; blocks: number; first: number; last: number }> = [
  { tx: '0x9119d1c0b190566a6fee40a86b1f6f26db098742331b775d61d6ad3754380ad1', blocks: 17, first: 114, last: 130 },
  { tx: '0x4a83612a20d6e4414ef3010ae3f86ebcfb6c1529d74a5d0731a41fb72329ed68', blocks: 43, first: 131, last: 173 },
  { tx: '0x0d537c5ad7119ed663b2244c22bb943d03b1f48e3c6bc2fced0efbece54dbe63', blocks: 12, first: 174, last: 185 },
  { tx: '0xf17cef25d8a8350f3479c2b4b175a6176339d94f2fa579c238fda766a9d0025c', blocks: 47, first: 186, last: 232 },
  { tx: '0x8794fa64ead201b6c8e53bbfe68997233a7a33977665a70eeecd7bd4174ee5ec', blocks: 5, first: 233, last: 237 },
  { tx: '0x0cfc3802a7a8ecd819339fb72aef9ed0bf74ec8806201617c733a19cfebf3e34', blocks: 30, first: 238, last: 267 },
  { tx: '0x69091f857db8d3976a014895b74d15e4dff21409ccc0e60c3149a6075a76aa71', blocks: 32, first: 268, last: 299 },
  { tx: '0x629f4afaa6de0b538de10ce5278a63c3e99e412f270aa46206bdaf5c95b5449f', blocks: 33, first: 300, last: 332 },
  { tx: '0x353a527f486f0ff60f30096adc7117255d645707b483b8bfa18e870cf94d0143', blocks: 16, first: 333, last: 348 },
  { tx: '0xc3f1179202187c85fa674c6d39050b4d89ad6d77478244b277231e07e41c9750', blocks: 18, first: 349, last: 366 },
];

/**
 * Yalnızca geliştirme: ?dev&chain=active|idle|fault|delayed|pending|offline
 * Arayüzü her durumda denemek için. land() → sıradaki gerçek iniş tekrar oynatılır (fırtına).
 * Ödül sunucudaki kuralı taklit eder: yalnızca o an hamster koşuyorsa verilir.
 */
export class MockChain implements ChainSource {
  private ppb = 425_653_103;
  private pending = 0;
  private storm: ChainStorm;
  private next = 0;
  private seq = 0;
  private claimed = new Set<string>();
  /** Sahte bakiyeye ödül ekler (MockBackend), yeni bakiyeyi döner */
  credit: ((n: number) => number) | null = null;
  signedIn: () => boolean = () => false;
  /** Sunucudaki "son saniyelerde blok kazandı mı" kontrolünün karşılığı */
  running: () => boolean = () => false;

  constructor(private mode: MockChainMode) {
    if (mode === 'pending') this.pending = 18;
    const last = REAL_LANDINGS[REAL_LANDINGS.length - 1]!;
    this.storm = { id: 'mock-0', ...last, at: new Date(Date.now() - 11 * 3600_000).toISOString(), bounty: 54 };
  }

  private get height(): number {
    return this.storm.last;
  }

  /** Sıradaki gerçek inişi şimdi olmuş gibi oynatır */
  land(): void {
    const r = REAL_LANDINGS[this.next % REAL_LANDINGS.length]!;
    this.next++;
    this.seq++;
    this.pending = 0;
    this.ppb = Math.floor(Math.random() * 600_000_000);
    this.storm = { id: `mock-${this.seq}`, ...r, at: new Date().toISOString(), bounty: Math.min(150, Math.max(25, r.blocks * 3)) };
  }

  async fetchChainLive(): Promise<ChainLive | null> {
    if (this.mode === 'offline') throw new Error('mock offline');
    const now = Date.now();
    if (this.mode === 'active' && this.pending === 0) this.ppb = (this.ppb + 160_000_000) % 1_000_000_000;
    const status: WheelStatus = this.mode === 'active' || this.mode === 'pending' ? 'ACTIVE' : this.mode === 'fault' ? 'COUNTER_FAULT' : 'IDLE';
    const iso = (t: number) => new Date(t).toISOString();
    return {
      serverTime: iso(now),
      statusAt: this.mode === 'delayed' ? iso(now - 10 * 60_000) : iso(now - 4000),
      coreAt: iso(now - 4000),
      wheel: { status, hardware: true, fresh: this.mode !== 'delayed', observedAt: iso(now - 3000) },
      build: { settledHeight: this.height, settledProgressPpb: this.ppb, projectedHeight: this.height + this.pending, projectedProgressPpb: this.ppb },
      lastStorm: this.storm,
      bounty: { enabled: true, perBlock: 3, min: 25, max: 150, windowSeconds: 120 },
    };
  }

  async claimStormBounty(id: string): Promise<BountyClaim | null> {
    if (!this.signedIn()) return null;
    const bal = this.credit ? this.credit(0) : null;
    if (id !== this.storm.id || this.storm.bounty <= 0) return { status: 'unavailable', bounty: 0, balance: bal };
    if (!this.running()) return { status: 'not_running', bounty: 0, balance: bal };
    if (this.claimed.has(id)) return { status: 'already', bounty: 0, balance: bal };
    this.claimed.add(id);
    return { status: 'granted', bounty: this.storm.bounty, balance: this.credit ? this.credit(this.storm.bounty) : null };
  }
}
