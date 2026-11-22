// Runs the CPU sand simulation in a Web Worker, as the artwork would, and times each step there.
import { makeWorld } from "./world.js";
import { SandSim } from "./sand-cpu.js";

let sim = null;

self.onmessage = (e) => {
  const q = e.data;
  if (q.cmd === "init") {
    const world = makeWorld(q.kind, q.w, q.h, q.seed);
    sim = new SandSim(world, { chunking: q.chunking });
    self.postMessage({ ok: true });
  } else if (q.cmd === "run") {
    for (let i = 0; i < q.warmup; i++) sim.step();
    const stepMs = [], activeChunks = [], visited = [], moves = [];
    for (let i = 0; i < q.steps; i++) {
      const t0 = performance.now();
      sim.step();
      stepMs.push(performance.now() - t0);
      activeChunks.push(sim.stats.activeChunks); visited.push(sim.stats.visited); moves.push(sim.stats.moves);
    }
    // Cost of handing the frame to the main thread: copy the material grid into a transferable buffer.
    let copyMs = 0;
    const reps = 20;
    const t1 = performance.now();
    let buf;
    for (let i = 0; i < reps; i++) buf = sim.mat.slice();
    copyMs = (performance.now() - t1) / reps;
    self.postMessage({ stepMs, activeChunks, visited, moves, copyMs, checksum: sim.checksum(), stepNo: sim.stepNo, mat: buf }, [buf.buffer]);
  }
};
