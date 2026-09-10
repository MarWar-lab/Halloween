/**
 * A browser just big enough to run LocalBackend under Node.
 *
 * The point is to drive the *real* backend in tests rather than a mock of it:
 * the rules that matter (sealing, scoring, turn order) live in that file, and a
 * mock would only ever confirm what the mock believes. `tab()` swaps
 * sessionStorage so one test process can be several people at once — which is
 * exactly the situation the backend was written for.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  /** `Object.keys(localStorage)` is how the backend finds a game by round id. */
  keys() {
    return [...this.map.keys()];
  }
}

const tabs = new Map<string, MemoryStorage>();

/** Switch the process to a different person's tab. */
export function tab(name: string) {
  if (!tabs.has(name)) tabs.set(name, new MemoryStorage());
  install(tabs.get(name)!);
}

const shared = new MemoryStorage();

function install(session: MemoryStorage) {
  const g = globalThis as Record<string, unknown>;
  // Proxy so `Object.keys(localStorage)` enumerates entries, as it does in a
  // browser — the backend relies on that to resolve a round id to a game.
  g.localStorage = new Proxy(shared, {
    ownKeys: (t) => t.keys(),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
  g.sessionStorage = session;
}

export function installBrowser() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const g = globalThis as Record<string, unknown>;

  g.window = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (e: { type: string }) => {
      for (const fn of listeners.get(e.type) ?? []) fn(e);
      return true;
    },
    setInterval: () => 0,
    clearInterval: () => {},
  };
  g.CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  // No BroadcastChannel: LocalBackend already guards for its absence, and
  // leaving it out keeps every tab in one process talking through localStorage.
  delete g.BroadcastChannel;

  shared.clear();
  tabs.clear();
  tab('host');
}
