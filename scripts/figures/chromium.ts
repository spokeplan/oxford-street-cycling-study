// Headless Chromium for render.ts. Playwright provides the browser
// (`bunx playwright install chromium`, path from chromium.executablePath()), but
// its driver hangs under Bun on Windows: chromium.launch() talks over extra stdio
// pipes and connectOverCDP() over its own WebSocket client, and neither connects.
// So the browser is started here with a DevTools port and driven over the
// Chrome DevTools Protocol with Bun's native WebSocket: one tab, fixed viewport
// and device scale factor, navigate, evaluate, screenshot.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/\S+)/;
/** Longest wait for the browser to print its DevTools endpoint, milliseconds. */
const STARTUP_TIMEOUT_MS = 30_000;
/** Interval between checks of a page-side condition, milliseconds. */
const POLL_MS = 250;
const BASE_ARGS = ["--headless", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio"];

type Params = Record<string, unknown>;
interface CdpMessage { id?: number; method?: string; params?: Params; result?: Params; error?: { message: string }; sessionId?: string }

export interface Viewport { width: number; height: number; deviceScaleFactor: number }

/** One browser tab over CDP. */
export class Tab {
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Params) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, ((p: Params) => void)[]>();

  constructor(private ws: WebSocket, private sessionId?: string) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result ?? {});
      } else if (msg.method && msg.sessionId === this.sessionId) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {});
      }
    });
  }

  withSession(sessionId: string): Tab { return new Tab(this.ws, sessionId); }

  send<T = Params>(method: string, params: Params = {}): Promise<T> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (r: Params) => void, reject }));
  }

  on(method: string, fn: (p: Params) => void): () => void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
    return () => this.listeners.set(method, (this.listeners.get(method) ?? []).filter((f) => f !== fn));
  }

  /** Value of a page expression (awaited if it is a promise); throws on a page-side exception. */
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  /** Resolves once the expression is truthy, polling every POLL_MS. */
  async waitFor(expression: string, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!(await this.evaluate<boolean>(`Boolean(${expression})`))) {
      if (performance.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${expression}`);
      await Bun.sleep(POLL_MS);
    }
  }

  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => { const off = this.on("Page.loadEventFired", () => { off(); resolve(); }); });
    const r = await this.send<{ errorText?: string }>("Page.navigate", { url });
    if (r.errorText) throw new Error(`Navigation to ${url} failed: ${r.errorText}`);
    await loaded;
  }

  /** Emulates the viewport (CSS pixels) and device scale factor; a loaded page is not re-rendered, navigate again after changing the scale. */
  async setViewport(viewport: Viewport): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false });
  }

  /** Screenshot of the viewport, or of its top-left `clip` (CSS pixels), at the emulated device scale factor. */
  async screenshot(format: "png" | "webp" | "jpeg", quality?: number, clip?: { width: number; height: number }): Promise<Buffer> {
    const r = await this.send<{ data: string }>("Page.captureScreenshot", {
      format, ...(quality === undefined ? {} : { quality }), ...(clip ? { clip: { x: 0, y: 0, ...clip, scale: 1 } } : {}),
    });
    return Buffer.from(r.data, "base64");
  }
}

export interface Chromium { tab: Tab; close(): Promise<void> }

/** Starts headless Chromium and opens one tab with the given viewport. */
export async function startChromium(extraArgs: readonly string[], viewport: Viewport): Promise<Chromium> {
  const profile = await mkdtemp(join(tmpdir(), "figures-chromium-"));
  const proc = Bun.spawn([chromium.executablePath(), ...BASE_ARGS, ...extraArgs, `--user-data-dir=${profile}`, "about:blank"], {
    stdout: "ignore", stderr: "pipe",
  });
  const close = async () => {
    proc.kill();
    await proc.exited;
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  };
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chromium did not report a DevTools endpoint")), STARTUP_TIMEOUT_MS);
      (async () => {
        let text = "";
        const decoder = new TextDecoder();
        for await (const chunk of proc.stderr) {
          text += decoder.decode(chunk, { stream: true });
          const m = text.match(DEVTOOLS_LINE);
          if (m) { clearTimeout(timer); resolve(m[1]); return; }
        }
        reject(new Error(`Chromium exited before reporting a DevTools endpoint:\n${text}`));
      })();
    });
    const ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`WebSocket to ${endpoint} failed`)); });
    const browser = new Tab(ws);
    const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const tab = browser.withSession(sessionId);
    for (const domain of ["Page", "Runtime", "Network"]) await tab.send(`${domain}.enable`);
    await tab.setViewport(viewport);
    return { tab, close: async () => { ws.close(); await close(); } };
  } catch (e) {
    await close();
    throw e;
  }
}
