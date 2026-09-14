// The step four question, measured: alice types with deliberate hesitations,
// and bob's tab records when each character appears. If the gaps bob sees
// match the gaps alice typed, timing survives the network.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Usage: node tests/browser/speech-timing.mjs [app URL]
//   Defaults to $APP_URL, then http://127.0.0.1:8787/ (npm run dev).
//   CHROMIUM_PATH picks a Chromium binary; otherwise Playwright's own is used.
//   Screenshots go to $OUT_DIR, default tests/out/. Run browser tests one at a
//   time: they render in software and skew each other's timings.
const base = process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:8787/";
const executablePath = process.env.CHROMIUM_PATH;
const outDir = process.env.OUT_DIR ?? fileURLToPath(new URL("../out/", import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const room = `speech-probe-${Math.random().toString(16).slice(2, 8)}`;

// Software rendering is slow, and a glyph can only appear on a frame, so a
// small window buys finer timing. SIZE=900x600 to override.
const [width, height] = (process.env.SIZE ?? "480x320").split("x").map(Number);

// [character, milliseconds to wait before typing it]
const script = [
  ["h", 0], ["e", 90], ["l", 85], ["l", 95], ["o", 80],
  [" ", 140],
  ["w", 650], // a hesitation longer than several ticks
  ["o", 90],
  ["r", 1400], // a long one, past the utterance restart
  ["l", 220], ["d", 30], // a slow letter, then a fast one inside one tick
];

const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const problems = [];

function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

async function open(name, initScript) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${name} ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${name} page error: ${e.message}`));
  if (initScript) await page.addInitScript(initScript);
  await page.goto(`${base}?room=${room}&name=${name}`);
  await page.waitForFunction(() => /connected/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  return page;
}

// Alice records when each key actually went down, on the page's own clock.
const alice = await open("alice", () => {
  window.__typed = [];
  addEventListener("keydown", (e) => { if (e.key.length === 1) window.__typed.push({ c: e.key, t: e.timeStamp }); }, true);
});

// Bob records when each of alice's glyphs enters the page. Init scripts run
// before <html> exists, so the observer watches the document itself. The
// renderer adds an element on the first frame after it is spoken, so this has
// frame-time resolution; frame intervals are measured to know how much.
const bob = await open("bob", () => {
  window.__heard = [];
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const glyph = node.matches(".glyph") ? node : node.querySelector(".glyph");
        if (glyph) window.__heard.push({ c: glyph.textContent, t: performance.now() });
      }
    }
  }).observe(document, { childList: true, subtree: true });
});

for (const page of [alice, bob]) {
  await page.waitForFunction(() => /2 here/.test(document.getElementById("status").textContent), null, { timeout: 10000 });
}
await bob.waitForTimeout(500);

for (const [c, wait] of script) {
  if (wait) await alice.waitForTimeout(wait);
  await alice.keyboard.press(c === " " ? "Space" : c);
}
await alice.waitForTimeout(1500);

const typed = await alice.evaluate(() => window.__typed);
const heard = await bob.evaluate(() => window.__heard);
const frameMs = await bob.evaluate(
  () => new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length < 61) requestAnimationFrame(tick);
      else resolve((times[60] - times[0]) / 60);
    };
    requestAnimationFrame(tick);
  }),
);

console.log(`window ${width}x${height}; typed ${typed.length} characters; bob saw ${heard.length}; bob's frames average ${frameMs.toFixed(1)} ms\n`);
const typedText = typed.map((t) => t.c).join("");
const heardText = heard.map((h) => h.c).join("");
check(heard.length > 1 && heardText === typedText, `bob saw the same characters in the same order (typed "${typedText}", saw "${heardText}")`);

const gaps = Math.min(typed.length, heard.length) - 1;
if (gaps > 0) {
  console.log("\n  char   typed gap   bob's gap   difference");
  let worst = 0;
  let total = 0;
  for (let i = 1; i <= gaps; i++) {
    const typedGap = typed[i].t - typed[i - 1].t;
    const heardGap = heard[i].t - heard[i - 1].t;
    const diff = heardGap - typedGap;
    worst = Math.max(worst, Math.abs(diff));
    total += Math.abs(diff);
    const show = (n) => `${n.toFixed(0).padStart(6)} ms`;
    console.log(`  ${JSON.stringify(typed[i].c).padEnd(5)}  ${show(typedGap)}   ${show(heardGap)}   ${(diff >= 0 ? "+" : "") + diff.toFixed(0)} ms`);
  }
  console.log(`\n  mean difference ${(total / gaps).toFixed(1)} ms, worst ${worst.toFixed(0)} ms`);
  // A glyph can land up to one frame late, and so can the one before it.
  const tolerance = frameMs + 25;
  check(worst <= tolerance, `every gap within ${tolerance.toFixed(0)} ms (one of bob's frames plus 25 ms) of how it was typed`);
} else {
  check(false, "there were gaps to compare");
}

if (process.env.SHOT !== "0") {
  // Type again and catch bob's view mid-sentence.
  for (const c of "can you see me") await alice.keyboard.press(c === " " ? "Space" : c);
  await bob.waitForTimeout(900);
  await bob.screenshot({ path: `${outDir}/speech-timing-bob.png` });
}

console.log(problems.length ? `\nproblems:\n  ${problems.join("\n  ")}` : "\nno console errors, warnings or page errors");
await browser.close();
