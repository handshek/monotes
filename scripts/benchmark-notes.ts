import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

const output = process.env.MONOTES_PERF_DIR ?? ".audit/overnight/latest/perf-review";
const baselineURL = process.env.MONOTES_PERF_BASELINE ?? "http://127.0.0.1:3109";
const currentURL = process.env.MONOTES_PERF_CURRENT ?? "http://127.0.0.1:3110";
const baselineSha = process.env.MONOTES_PERF_BASELINE_SHA ?? "b6f605126121cf118f2707988c3178e11bf5599b";
const currentSha = process.env.MONOTES_PERF_CURRENT_SHA ?? "d3308196207778ebc13ab2b05efa4413837b0292";
const baselineLabel = process.env.MONOTES_PERF_BASELINE_LABEL ?? "original baseline";
const currentLabel = process.env.MONOTES_PERF_CURRENT_LABEL ?? "reviewed persistence implementation";
const claim = process.env.MONOTES_PERF_CLAIM ?? "In an isolated desktop Chromium production session with 200 notes of 20 KiB each and two loaded tabs, immediate persistence introduces a repeatable user-visible typing latency regression versus baseline.";
const diagnostic = process.env.MONOTES_PERF_DIAGNOSTIC === "1";
const runs = Number(process.env.MONOTES_PERF_RUNS ?? "5");
const chars = "A steady note typing exercise checks editing while another notes tab remains open. Every keystroke must remain correct. ";
const noteCount = 200;
const noteBytes = 20_480;
const delayMs = 80;
const noteId = "Perf000000";
const baseBody = "# Working notebook\n\nA paragraph of ordinary markdown with words for the sidebar title. Notes contain plans and ideas.\n\n";
const content = baseBody.repeat(Math.ceil(noteBytes / baseBody.length)).slice(0, noteBytes);
const editor = (page: Page) => page.locator('.cm-content[contenteditable="true"]');

type Samples = {
  active: boolean;
  inputs: number;
  keydowns: number;
  inputToFrame: number[];
  keydownToFrame: number[];
  frames: number[];
  longTasks: number[];
  previousFrame: number;
  scans: number;
  scannedCharacters: number;
  scanMilliseconds: number;
  boundedPreviewSplits: number;
  splitMilliseconds: number;
  puts: number;
  cursorSteps: number;
  indexQueries: number;
};
declare global { interface Window { monotesPerf: Samples } }

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
};
const summary = (values: number[]) => ({ count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : null });

async function instrumentation(page: Page) {
  await page.addInitScript((profile) => {
    const data: Samples = window.monotesPerf = {
      active: false, inputs: 0, keydowns: 0, inputToFrame: [], keydownToFrame: [], frames: [], longTasks: [], previousFrame: 0,
      scans: 0, scannedCharacters: 0, scanMilliseconds: 0, boundedPreviewSplits: 0, splitMilliseconds: 0, puts: 0, cursorSteps: 0, indexQueries: 0,
    };
    const frame = (now: number) => {
      if (data.active && data.previousFrame) data.frames.push(now - data.previousFrame);
      data.previousFrame = data.active ? now : 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.addEventListener("input", (event) => {
      if (!data.active || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
      data.inputs++;
      const start = event.timeStamp;
      requestAnimationFrame(() => data.inputToFrame.push(performance.now() - start));
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!data.active || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
      data.keydowns++;
      const start = event.timeStamp;
      requestAnimationFrame(() => data.keydownToFrame.push(performance.now() - start));
    }, true);
    new PerformanceObserver((entries) => {
      if (data.active) data.longTasks.push(...entries.getEntries().map((entry) => entry.duration));
    }).observe({ type: "longtask", buffered: false });
    if (profile) {
      const originalMatch = String.prototype.match;
      String.prototype.match = function (expression: RegExp) {
        const counted = data.active && expression instanceof RegExp && expression.source === "[^\\s\\n]+" && this.length >= 19_000;
        const start = counted ? performance.now() : 0;
        const result = originalMatch.call(this, expression);
        if (counted) {
          data.scans++;
          data.scannedCharacters += this.length;
          data.scanMilliseconds += performance.now() - start;
        }
        return result;
      };
      const originalSplit = String.prototype.split;
      String.prototype.split = function (separator: string | RegExp | { [Symbol.split](value: string, limit?: number): string[] }, limit?: number) {
        const counted = data.active && separator instanceof RegExp && separator.source === "\\s+" && limit === 20 && this.length >= 19_000;
        const start = counted ? performance.now() : 0;
        const result = Reflect.apply(originalSplit, this, [separator, limit]) as string[];
        if (counted) {
          data.boundedPreviewSplits++;
          data.splitMilliseconds += performance.now() - start;
        }
        return result;
      };
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
        if (data.active && this.name === "notes") data.puts++;
        return originalPut.apply(this, args);
      };
      const originalContinue = IDBCursor.prototype.continue;
      IDBCursor.prototype.continue = function (...args: Parameters<typeof originalContinue>) {
        if (data.active) data.cursorSteps++;
        return originalContinue.apply(this, args);
      };
      const originalOpen = IDBIndex.prototype.openCursor;
      IDBIndex.prototype.openCursor = function (...args: Parameters<typeof originalOpen>) {
        if (data.active) data.indexQueries++;
        return originalOpen.apply(this, args);
      };
    }
    localStorage.setItem("monotes-welcome-dismissed", "true");
  }, diagnostic);
}

async function stored(page: Page) {
  return page.evaluate(async (id) => new Promise<{ content: string; count: number }>((resolve, reject) => {
    const request = indexedDB.open("monotes-db");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("notes", "readonly");
      const store = tx.objectStore("notes");
      const get = store.get(id);
      const count = store.count();
      tx.oncomplete = () => { resolve({ content: get.result?.content ?? "", count: count.result }); db.close(); };
      tx.onerror = () => reject(tx.error);
    };
  }), noteId);
}

await mkdir(output, { recursive: true });
const report = {
  claimUnderTest: claim,
  methodology: `${runs} interleaved A/B pairs in fresh contexts, real keyboard input at 80 ms per character; browser event-to-next-animation-frame is a responsiveness proxy, not a direct paint measurement. Exact stored result is checked. Separate diagnostic runs instrument regex/IndexedDB and collect CPU profiles; their times are excluded.`,
  baseline: baselineSha,
  current: currentSha,
  labels: { baseline: baselineLabel, current: currentLabel },
  runsPerSide: runs,
  diagnosticVersion: 2,
  build: "Both isolated snapshots use next build --webpack with identical installed dependencies, then next start.",
  noteCount, noteBytes, totalSeedBytes: noteCount * noteBytes, tabs: 2, delayMs, typedCharacters: chars.length, diagnostic,
  machine: { cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model, platform: os.platform(), architecture: os.arch(), loadStart: os.loadavg() },
  results: [] as unknown[],
};
const browser = await chromium.launch();
try {
  for (let run = 1; run <= runs; run++) {
    for (const [side, baseURL] of [["baseline", baselineURL], ["current", currentURL]] as const) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      try {
        const active = await context.newPage();
        await instrumentation(active);
        active.on("pageerror", (error) => errors.push(error.message));
        await active.goto("/");
        await expect(active.getByRole("button", { name: "Create new note", exact: true })).toBeVisible();
        await active.evaluate(async ({ count, body }) => new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("monotes-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("notes", "readwrite");
            const store = tx.objectStore("notes");
            store.clear();
            for (let i = 0; i < count; i++) store.put({ id: `Perf${String(i).padStart(6, "0")}`, content: body, updatedAt: 1_700_000_000_000 - i, cloudStatus: "local" });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        }), { count: noteCount, body: content });
        await active.goto(`/${noteId}`);
        await expect(editor(active)).toBeVisible();
        const idle = await context.newPage();
        await instrumentation(idle);
        idle.on("pageerror", (error) => errors.push(error.message));
        await idle.goto("/Perf000001");
        await expect(editor(idle)).toBeVisible();
        await active.bringToFront();
        await editor(active).press("i");
        await editor(active).press("ControlOrMeta+End");
        await active.keyboard.type(" warmup", { delay: delayMs });
        await expect.poll(async () => (await stored(active)).content).toBe(content + " warmup");
        await active.waitForTimeout(1000);
        const sessions = diagnostic ? await Promise.all([context.newCDPSession(active), context.newCDPSession(idle)]) : [];
        for (const session of sessions) { await session.send("Profiler.enable"); await session.send("Profiler.start"); }
        for (const page of [active, idle]) await page.evaluate(() => { window.monotesPerf.active = true; });
        const start = performance.now();
        await active.keyboard.type(chars, { delay: delayMs });
        const typingMs = performance.now() - start;
        await expect.poll(async () => (await stored(active)).content, { timeout: 15000 }).toBe(content + " warmup" + chars);
        const savedMs = performance.now() - start;
        await active.waitForTimeout(1000);
        const samples = await Promise.all([active, idle].map((page) => page.evaluate(() => { window.monotesPerf.active = false; return window.monotesPerf; })));
        for (let i = 0; i < sessions.length; i++) {
          const { profile } = await sessions[i].send("Profiler.stop");
          await writeFile(`${output}/${side}-${run}-${i === 0 ? "active" : "idle"}.cpuprofile`, JSON.stringify(profile));
        }
        await expect(editor(active)).toContainText(chars.trim());
        const result = await stored(active);
        expect(result.count).toBe(noteCount);
        expect(result.content).toBe(content + " warmup" + chars);
        expect(samples[0].inputs).toBe(chars.length);
        expect(samples[0].keydowns).toBe(chars.length);
        expect(errors).toEqual([]);
        const entry = {
          side, run, typingMs, savedMs, verifiedContentLength: result.content.length, verifiedNoteCount: result.count, errors,
          load: os.loadavg(),
          active: { ...samples[0], inputToFrame: summary(samples[0].inputToFrame), keydownToFrame: summary(samples[0].keydownToFrame), frames: summary(samples[0].frames), longTasks: summary(samples[0].longTasks) },
          idle: { ...samples[1], inputToFrame: summary(samples[1].inputToFrame), keydownToFrame: summary(samples[1].keydownToFrame), frames: summary(samples[1].frames), longTasks: summary(samples[1].longTasks) },
        };
        report.results.push(entry);
        console.log(JSON.stringify(entry));
      } catch (error) {
        report.results.push({ side, run, failed: true, error: error instanceof Error ? error.message : String(error), errors });
        throw error;
      } finally {
        await context.close();
        await writeFile(`${output}/${diagnostic ? "diagnostic" : "timing"}.json`, JSON.stringify(report, null, 2) + "\n");
      }
    }
  }
} finally { await browser.close(); }
