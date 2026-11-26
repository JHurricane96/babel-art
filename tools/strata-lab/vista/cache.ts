// Vista's saved world: today's land, kept in the browser (IndexedDB) so a second visit the same
// day starts in a few seconds instead of making the world again.
//
// What is kept is only ever used by the code that made it:
// - Each record carries what it was made from: the cache's own FORMAT, the hash of the code that
//   makes the land (`code`: build.mjs hashes the bundled world generator and land code, so any
//   change there, and only there, changes it), the day's seed and the world's size. A record that
//   differs in any of them, or does not look like a land, is deleted when read and the land is made
//   again.
// - There is one record per kind (today: "land"). Saving one deletes everything else in the store,
//   and on opening anything this version does not know is deleted, so nothing old piles up.
// - A change to how records are laid out bumps FORMAT; a change to the store itself bumps
//   DB_VERSION (which empties it).
// Everything fails quietly: without storage (a private window, blocked site data, a sandboxed frame,
// a full disk) the page just makes everything, as it would on a first visit.
const DB = "strata-vista",
  DB_VERSION = 2,
  STORE = "saved";
export const FORMAT = 1;
/** The kinds of record this version keeps. */
const KINDS = ["land"];

export interface Meta {
  format: number;
  code: string;
  seed: number;
  n: number;
}
export interface Saved<T> extends Meta {
  kind: string;
  /** When it was saved (ms since 1970), and its size in bytes (its typed arrays). */
  made: number;
  bytes: number;
  value: T;
}
/** Does a saved record hold what we want (and is it the right shape)? */
export function matches(r: unknown, kind: string, want: Meta, valid: (v: unknown) => boolean): boolean {
  if (!r || typeof r !== "object") return false;
  const s = r as Saved<unknown>;
  return s.kind === kind && s.format === want.format && s.code === want.code && s.seed === want.seed && s.n === want.n && valid(s.value);
}
/** The bytes held in a value's typed arrays (what a record costs to keep). */
export function bytesOf(v: unknown, seen = new Set<unknown>()): number {
  if (!v || typeof v !== "object" || seen.has(v)) return 0;
  seen.add(v);
  if (ArrayBuffer.isView(v)) return v.byteLength;
  let n = 0;
  for (const x of Object.values(v)) n += bytesOf(x, seen);
  return n;
}

let opened: Promise<IDBDatabase | null> | null = null;
/** The store, or null where there is none (never waits more than `wait` ms for it). */
function db(wait = 500): Promise<IDBDatabase | null> {
  return (opened ??= new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), wait);
    const done = (d: IDBDatabase | null) => {
      clearTimeout(timer);
      resolve(d);
    };
    try {
      const rq = indexedDB.open(DB, DB_VERSION);
      rq.onupgradeneeded = () => {
        // A new layout: start empty.
        const d = rq.result;
        for (const name of Array.from(d.objectStoreNames)) d.deleteObjectStore(name);
        d.createObjectStore(STORE);
      };
      rq.onsuccess = () => {
        const d = rq.result;
        // Another tab opening a newer layout: let it.
        d.onversionchange = () => d.close();
        done(d);
        // Anything this version does not keep.
        void keysOf(d).then((keys) => {
          for (const k of keys) if (!KINDS.includes(String(k))) void remove(d, k);
        });
      };
      rq.onerror = rq.onblocked = () => done(null);
    } catch {
      done(null);
    }
  }));
}
/** One request in a transaction of its own: whether the transaction completed, and the result. */
function request<T>(d: IDBDatabase, mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; result?: T }> {
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode),
        rq = make(tx.objectStore(STORE));
      tx.oncomplete = () => resolve({ ok: true, result: rq.result });
      tx.onerror = tx.onabort = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}
const keysOf = async (d: IDBDatabase) => (await request(d, "readonly", (s) => s.getAllKeys())).result ?? [];
const remove = (d: IDBDatabase, k: IDBValidKey) => request(d, "readwrite", (s) => s.delete(k));

/** What is saved under `kind`, if it is what we want; a record that is not is deleted. */
export async function load<T>(kind: string, want: Meta, valid: (v: unknown) => boolean): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  const r = (await request(d, "readonly", (s) => s.get(kind))).result;
  if (r === undefined) return undefined;
  if (matches(r, kind, want, valid)) return (r as Saved<T>).value;
  await remove(d, kind);
  return undefined;
}
/** Save `value` as `kind`, and delete everything else in the store. True if it was saved. */
export async function save(kind: string, want: Meta, value: unknown): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const rec: Saved<unknown> = { kind, ...want, made: Date.now(), bytes: bytesOf(value), value };
  return new Promise<boolean>((resolve) => {
    try {
      const tx = d.transaction(STORE, "readwrite"),
        st = tx.objectStore(STORE);
      st.clear();
      st.put(rec, kind);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
/** What is saved: each record's kind, when it was saved and its size (nothing of its value). */
export async function list(): Promise<{ kind: string; made: number; bytes: number; code: string; seed: number }[] | null> {
  const d = await db();
  if (!d) return null;
  const all = ((await request(d, "readonly", (s) => s.getAll())).result ?? []) as Saved<unknown>[];
  return all.map((r) => ({ kind: r.kind, made: r.made, bytes: r.bytes, code: r.code, seed: r.seed }));
}
/** Forget everything saved. True if the store could be emptied. */
export async function forget(): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return (await request(d, "readwrite", (s) => s.clear())).ok;
}
