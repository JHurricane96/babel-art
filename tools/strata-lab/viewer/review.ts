// Review tools for the Strata viewer: a "Go to" panel (places Claude points
// to, kept in the artifact's shared store so the list can change without a
// new version; a seed-and-region jump; your own notes) and "Note here",
// which saves a comment with the exact place it was made.
//
// Store (the artifact's `db` capability):
//   places/<id>  { title, seed, x, y?, scale?, why?, order }   written by Claude
//   notes/<id>   { text, seed, x, y, scale, region, place, at, build }
// Everything here works without the store too, minus those two lists.

/** What the viewer offers the review tools. */
export interface ReviewHost {
  /** The current view: world column x and row y at the centre, zoom, and what the place is called. */
  here(): { seed: number; x: number; y: number; scale: number; place: string };
  /** Jump to a place (y and scale optional: the surface, and the zoom as it is). */
  go(seed: number, x: number, y?: number, scale?: number): void;
  /** Which build this is (saved with each note). */
  build: string;
}

interface Place {
  id: string;
  title: string;
  seed: number;
  x: number;
  y?: number;
  scale?: number;
  why?: string;
  order: number;
}
interface Note {
  id: string;
  text: string;
  seed: number;
  x: number;
  y: number;
  scale: number;
  region: number;
  place: string;
  at: string;
}

type Db = {
  collection(path: string): {
    doc(id?: string): {
      set(d: Record<string, unknown>): Promise<void>;
      delete(): Promise<void>;
    };
    onSnapshot(
      next: (s: { docs: { id: string; data(): Record<string, unknown> | undefined }[]; metadata: { fromCache: boolean } }) => void,
      error?: (e: { code: string }) => void,
    ): () => void;
  };
};

const REGION_W = 2048;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function setupReview(host: ReviewHost) {
  const panel = $("review"),
    noteCard = $("note-card"),
    placesBox = $("places"),
    notesBox = $("notes"),
    notesState = $("notes-state"),
    placesState = $("places-state");
  let db: Db | null = null;
  let places: Place[] = [],
    notes: Note[] = [];

  const open = (card: HTMLElement, show: boolean) => {
    card.hidden = !show;
  };
  $("goto").onclick = () => {
    open(noteCard, false);
    open(panel, panel.hidden);
    $<HTMLButtonElement>("goto").setAttribute("aria-pressed", String(!panel.hidden));
  };
  $("review-close").onclick = () => {
    open(panel, false);
    $("goto").setAttribute("aria-pressed", "false");
  };

  // Jump to a seed and region.
  $<HTMLFormElement>("jump").addEventListener("submit", (e) => {
    e.preventDefault();
    const seed = Number($<HTMLInputElement>("jump-seed").value),
      region = Number($<HTMLInputElement>("jump-region").value);
    if (!Number.isFinite(seed) || !Number.isFinite(region)) return;
    host.go(Math.floor(seed), (region + 0.5) * REGION_W);
  });
  const syncJump = () => {
    const h = host.here();
    $<HTMLInputElement>("jump-seed").value = String(h.seed);
    $<HTMLInputElement>("jump-region").value = String(Math.floor(h.x / REGION_W));
  };

  // Note here.
  $("note-here").onclick = () => {
    open(panel, false);
    $("goto").setAttribute("aria-pressed", "false");
    const h = host.here();
    $("note-where").textContent = `${h.place} · seed ${h.seed} · region ${Math.floor(h.x / REGION_W)} · x ${Math.round(h.x).toLocaleString()} · y ${Math.round(h.y).toLocaleString()} · zoom ${h.scale}`;
    $("note-error").textContent = "";
    noteCard.dataset.at = JSON.stringify(h);
    open(noteCard, true);
    $<HTMLTextAreaElement>("note-text").focus();
  };
  $("note-cancel").onclick = () => open(noteCard, false);
  $<HTMLFormElement>("note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $<HTMLTextAreaElement>("note-text").value.trim();
    if (!text || !db) return;
    const h = JSON.parse(noteCard.dataset.at ?? "{}") as ReturnType<ReviewHost["here"]>,
      save = $<HTMLButtonElement>("note-save");
    save.disabled = true;
    try {
      await db.collection("notes").doc().set({
        text: text.slice(0, 4000),
        seed: h.seed,
        x: Math.round(h.x),
        y: Math.round(h.y),
        scale: h.scale,
        region: Math.floor(h.x / REGION_W),
        place: h.place,
        at: new Date().toISOString(),
        build: host.build,
      });
      $<HTMLTextAreaElement>("note-text").value = "";
      open(noteCard, false);
    } catch (err) {
      const code = (err as { code?: string }).code;
      $("note-error").textContent =
        code === "quota_exceeded"
          ? "The notes store is full: delete a few old notes first."
          : "Couldn't save the note. Try again in a moment.";
    } finally {
      save.disabled = false;
    }
  });

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  function renderPlaces() {
    placesBox.replaceChildren();
    for (const p of places) {
      const b = document.createElement("button"),
        t = document.createElement("span"),
        w = document.createElement("small");
      b.type = "button";
      b.className = "place";
      t.textContent = p.title;
      w.textContent = `seed ${p.seed} · region ${Math.floor(p.x / REGION_W)}${p.why ? " · " + p.why : ""}`;
      b.append(t, w);
      b.onclick = () => host.go(p.seed, p.x, p.y, p.scale);
      placesBox.append(b);
    }
    placesState.textContent = db ? (places.length ? "" : "No places listed yet.") : "Places need the shared store, which this view doesn't have.";
  }
  function renderNotes() {
    notesBox.replaceChildren();
    for (const n of notes) {
      const row = document.createElement("div"),
        b = document.createElement("button"),
        t = document.createElement("span"),
        w = document.createElement("small"),
        del = document.createElement("button");
      row.className = "note-row";
      b.type = "button";
      b.className = "place";
      t.textContent = n.text;
      w.textContent = `${n.place} · seed ${n.seed} · region ${n.region} · ${fmtTime(n.at)}`;
      b.append(t, w);
      b.onclick = () => host.go(n.seed, n.x, n.y, n.scale);
      del.type = "button";
      del.className = "del";
      del.textContent = "×";
      del.setAttribute("aria-label", "Delete this note");
      del.onclick = async () => {
        if (!db) return;
        del.disabled = true;
        try {
          await db.collection("notes").doc(n.id).delete();
        } catch {
          del.disabled = false;
        }
      };
      row.append(b, del);
      notesBox.append(row);
    }
    if (!db) notesState.textContent = "Notes need the shared store, which this view doesn't have.";
    else if (!notes.length && !notesState.textContent) notesState.textContent = "No notes yet: use Note here (or C) to leave one where you are.";
    else if (notes.length) notesState.textContent = "";
  }

  // Keys: J opens Go to, C leaves a note.
  addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") open(noteCard, false);
      return;
    }
    if (e.key === "j" || e.key === "J") $("goto").click();
    else if ((e.key === "c" || e.key === "C") && db) $("note-here").click();
    else if (e.key === "Escape") {
      open(noteCard, false);
      open(panel, false);
      $("goto").setAttribute("aria-pressed", "false");
    }
  });
  $("goto").addEventListener("click", syncJump);

  renderPlaces();
  renderNotes();
  $("note-here").hidden = true;

  // The shared store, when this view has it.
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) return;
  claude
    .use("db")
    .then((got) => {
      if (!got) return;
      db = got as Db;
      $("note-here").hidden = false;
      let heard = false;
      notesState.textContent = "Loading notes…";
      const timer = setTimeout(() => {
        if (!heard) notesState.textContent = "Notes can't be reached yet.";
      }, 10000);
      db.collection("places").onSnapshot(
        (s) => {
          places = s.docs
            .map((d) => {
              const v = d.data() ?? {};
              return {
                id: d.id,
                title: str(v.title, "A place"),
                seed: num(v.seed),
                x: num(v.x),
                y: typeof v.y === "number" ? v.y : undefined,
                scale: typeof v.scale === "number" ? v.scale : undefined,
                why: str(v.why),
                order: num(v.order, 999),
              };
            })
            .sort((a, b) => a.order - b.order);
          renderPlaces();
        },
        () => {
          placesState.textContent = "Places can't be reached right now.";
        },
      );
      db.collection("notes").onSnapshot(
        (s) => {
          if (!s.metadata.fromCache) {
            heard = true;
            clearTimeout(timer);
          }
          notes = s.docs
            .map((d) => {
              const v = d.data() ?? {};
              return {
                id: d.id,
                text: str(v.text),
                seed: num(v.seed),
                x: num(v.x),
                y: num(v.y),
                scale: num(v.scale, 4),
                region: num(v.region),
                place: str(v.place),
                at: str(v.at),
              };
            })
            .sort((a, b) => (a.at < b.at ? 1 : -1));
          if (heard) notesState.textContent = "";
          renderNotes();
        },
        () => {
          clearTimeout(timer);
          notesState.textContent = "Notes can't be reached right now.";
        },
      );
      renderPlaces();
    })
    .catch(() => {});
}
