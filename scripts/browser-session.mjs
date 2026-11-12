import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function openBrowser({
  port = 4176,
  debugPort = 9225,
  directory,
} = {}) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "babel-evolution-"));
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      ...(directory ? ["preview", "--outDir", directory] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: "ignore" },
  );
  const browser = spawn(
    process.env.CHROME_BIN || "chromium",
    [
      "--remote-debugging-address=127.0.0.1",
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let browserLog = "";
  browser.stderr?.on("data", (chunk) => {
    browserLog = (browserLog + chunk.toString()).slice(-4000);
  });
  let socket, startError;
  server.on("error", (e) => (startError = e));
  browser.on("error", (e) => (startError = e));
  const close = async () => {
    socket?.close();
    browser.kill();
    server.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true });
  };
  try {
    let tab;
    for (let i = 0; i < 300; i++) {
      if (startError) throw startError;
      try {
        await fetch(`http://127.0.0.1:${port}`);
        tab = (
          await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
        ).find((t) => t.type === "page");
        if (tab) break;
      } catch {}
      await sleep(100);
    }
    if (!tab) throw new Error("Local browser failed to start: " + browserLog);
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) =>
      socket.addEventListener("open", r, { once: true }),
    );
    let serial = 0;
    const pending = new Map(),
      errors = [];
    socket.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timeout);
        m.error
          ? p.reject(new Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
      if (m.method === "Runtime.exceptionThrown")
        errors.push(m.params.exceptionDetails);
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial,
          timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(method + " timed out"));
          }, 120000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Page.enable");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.navigate", { url: `http://127.0.0.1:${port}` });
    for (let i = 0; i < 100 && !(await evaluate("!!window.babelDebug")); i++)
      await sleep(100);
    if (!(await evaluate("!!window.babelDebug")))
      throw new Error("Test instrumentation not available");
    return { call, evaluate, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
