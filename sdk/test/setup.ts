// Node 26 ships a `localStorage` global getter that shadows jsdom's; give the tests a real Web Storage.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  key(i: number): string | null {
    return Array.from(this.m.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(String(k), String(v));
  }
}
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.Storage !== "function") g.Storage = MemoryStorage;
else Object.setPrototypeOf(MemoryStorage.prototype, (g.Storage as { prototype: object }).prototype);
for (const k of ["localStorage", "sessionStorage"]) {
  let v: unknown;
  try {
    v = g[k];
  } catch {
    v = undefined;
  }
  if (!v || typeof (v as Storage).getItem !== "function") {
    const s = new MemoryStorage();
    Object.defineProperty(g, k, { value: s, configurable: true, writable: true });
    try {
      Object.defineProperty(window, k, { value: s, configurable: true, writable: true });
    } catch {
      /* ignore */
    }
  }
}
