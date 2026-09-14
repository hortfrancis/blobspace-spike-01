// Step three, measured: alice walks steadily in one tab while bob's tab
// records, on every frame, where it drew her.
//
// Two checks. Fidelity: bob should draw alice exactly where the positions he
// received put her, blended to 150 ms in the past; that tests the
// interpolation itself, whatever the frame rate. Evenness: her on-screen speed
// should not stall or leap from frame to frame.
//
// It also records when alice's tab sends each position and when bob's tab
// receives it, to tell an uneven sender or network from a drawing fault.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Usage: node tests/browser/walk.mjs [app URL]
//   Defaults to $APP_URL, then http://127.0.0.1:8787/ (npm run dev).
//   CHROMIUM_PATH picks a Chromium binary; otherwise Playwright's own is used.
//   Screenshots go to $OUT_DIR, default tests/out/. Run browser tests one at a
//   time: they render in software and skew each other's timings.
const base = process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:8787/";
const executablePath = process.env.CHROMIUM_PATH;
const outDir = process.env.OUT_DIR ?? fileURLToPath(new URL("../out/", import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const room = `walk-probe-${Math.random().toString(16).slice(2, 8)}`;
// Small, so software rendering keeps frames coming.
const [width, height] = (process.env.SIZE ?? "360x240").split("x").map(Number);

const REMOTE_DELAY_MS = 150; // from main.js
const LIMIT = 4.7; // from main.js: half the floor, less a margin
const VIEW_SIZE = 8; // from world.js

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

// Where a point on the floor lands on bob's screen. The camera is orthographic
// at (20, 20, 20) looking at the origin, so its right is (1, 0, -1)/√2 and its
// up is (-1, 2, -1)/√6, and the view is VIEW_SIZE units tall.
function toScreen(x, z) {
  const halfHeight = VIEW_SIZE / 2;
  const halfWidth = halfHeight * (width / height);
  const right = (x - z) / Math.SQRT2;
  const up = (-x - z) / Math.sqrt(6);
  return {
    x: (right / halfWidth) * (width / 2) + width / 2,
    y: -(up / halfHeight) * (height / 2) + height / 2,
  };
}

const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

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

// Alice records every position she sends, on her own clock.
const alice = await open("alice", () => {
  window.__sent = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      const m = JSON.parse(data);
      if (m.t === "frame" && m.p) window.__sent.push({ t: performance.now(), p: m.p });
    } catch {}
    return send.call(this, data);
  };
});

// Bob records every position of alice's he receives, stamped as the page
// stamps it. And each frame, he notes the time just before the page's own
// frame code runs, which is within a millisecond of the time it draws remote
// players against, then reads where CSS2DRenderer put alice's label. The
// label's transform looks like
// "translate(-50%, 0%) translate(299.1px, 152.5px) rotate(0rad)".
const bob = await open("bob", () => {
  window.__track = [];
  window.__arrived = [];

  const listen = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, handler, options) {
    if (type !== "message") return listen.call(this, type, handler, options);
    return listen.call(this, type, (event) => {
      try {
        const m = JSON.parse(event.data);
        if (m.t === "frame" && m.p) window.__arrived.push({ t: performance.now(), p: m.p, ts: m.ts });
        // Bob joins after alice, so her first position comes in the hello's
        // list of who is already here, not in a frame: she only sends frames
        // once she moves.
        if (m.t === "hello") {
          const peer = m.peers.find((p) => p.name === "alice" && p.p);
          if (peer) window.__arrived.push({ t: performance.now(), p: peer.p });
        }
      } catch {}
      handler(event);
    }, options);
  };

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const t = performance.now();
      callback(time);
      for (const el of document.querySelectorAll(".name")) {
        if (el.textContent !== "alice") continue;
        const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(el.style.transform);
        if (m) window.__track.push({ t, x: Number(m[1]), y: Number(m[2]) });
      }
    });
});

for (const page of [alice, bob]) {
  await page.waitForFunction(() => /2 here/.test(document.getElementById("status").textContent), null, { timeout: 10000 });
}
await bob.waitForTimeout(800);

// Walk in whichever direction has the most floor ahead, so she cannot reach
// the edge and stop mid-measurement.
const [ax, az] = (await bob.evaluate(() => window.__arrived.at(-1))).p;
const directions = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowRight: [1, -1], ArrowLeft: [-1, 1] };
const roomAhead = ([dx, dz]) =>
  Math.SQRT2 * Math.min(dx > 0 ? LIMIT - ax : LIMIT + ax, dz > 0 ? LIMIT - az : LIMIT + az);
const key = Object.keys(directions).sort((a, b) => roomAhead(directions[b]) - roomAhead(directions[a]))[0];

const aliceStart = await alice.evaluate(() => performance.now());
const bobStart = await bob.evaluate(() => performance.now());
await alice.keyboard.down(key);
await alice.waitForTimeout(1400);
await bob.screenshot({ path: `${outDir}/walk-bob-mid.png` });
await alice.keyboard.up(key);
await alice.waitForTimeout(800);

const track = await bob.evaluate(() => window.__track);
const arrived = await bob.evaluate(() => window.__arrived);
const sent = await alice.evaluate(() => window.__sent);

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const gapsOf = (xs) => xs.slice(1).map((x, i) => x.t - xs[i].t);
const summary = (xs) => `median ${median(xs).toFixed(0)}, min ${Math.min(...xs).toFixed(0)}, max ${Math.max(...xs).toFixed(0)}`;

// Steady walking only: skip her acceleration, and on bob's side the remote
// delay too, and stop before the screenshot, which stalls the page.
const sentSteady = sent.filter((s) => s.t > aliceStart + 350 && s.t < aliceStart + 1200);
const arrivedSteady = arrived.filter((s) => s.t > bobStart + 350 && s.t < bobStart + 1200);
const steady = track.filter((s) => s.t > bobStart + 500 && s.t < bobStart + 1300);

const sentGaps = gapsOf(sentSteady);
const sentSteps = sentSteady.slice(1).map((s, i) => Math.hypot(s.p[0] - sentSteady[i].p[0], s.p[1] - sentSteady[i].p[1]));
const arrivedGaps = gapsOf(arrivedSteady);

console.log(`alice walked with ${key} (${roomAhead(directions[key]).toFixed(1)} units of floor ahead)`);
console.log(`  alice sent ${sentSteady.length} positions while steady; gaps ms: ${summary(sentGaps)}; the tick is 67`);
console.log(`  world units walked between sends: ${sentSteps.map((d) => d.toFixed(2)).join(" ")} (3.5 u/s × 66 ms is 0.23)`);
console.log(`  bob received ${arrivedSteady.length}; gaps ms: ${summary(arrivedGaps)}`);
console.log(`  bob drew ${steady.length} steady frames; gaps ms: ${gapsOf(steady).map((g) => g.toFixed(0)).join(" ")}\n`);

// Fidelity. Bob draws alice on her own clock. The quickest any of her
// positions has reached him relates the two clocks, relaxing by 0.2 ms with
// each position as main.js does, and he draws her 150 ms behind that. So
// replay that estimate up to each frame, find where her positions put her at
// that moment on her clock, project it onto bob's screen, and compare with
// where he drew her. The label sits at her feet, which bob and breathing lift
// by at most 0.06 units, a couple of pixels.
const timed = arrived.filter((a) => typeof a.ts === "number");
function offsetAt(t) {
  let offset = null;
  for (const a of timed) {
    if (a.t > t) break;
    offset = offset === null ? a.t - a.ts : Math.min(offset + 0.2, a.t - a.ts);
  }
  return offset;
}
function onHerClock(ts) {
  if (ts <= timed[0].ts) return timed[0].p;
  for (let i = 1; i < timed.length; i++) {
    const a = timed[i - 1];
    const b = timed[i];
    if (ts < b.ts) {
      const alpha = (ts - a.ts) / (b.ts - a.ts);
      return [a.p[0] + (b.p[0] - a.p[0]) * alpha, a.p[1] + (b.p[1] - a.p[1]) * alpha];
    }
  }
  return timed.at(-1).p;
}
const errors = steady.map((s) => {
  const [x, z] = onHerClock(s.t - offsetAt(s.t) - REMOTE_DELAY_MS);
  const expected = toScreen(x, z);
  return Math.hypot(expected.x - s.x, expected.y - s.y);
});
const lateness = timed
  .filter((a) => a.t > bobStart + 350 && a.t < bobStart + 1200)
  .map((a) => a.t - a.ts - offsetAt(a.t));
console.log(`  how much later than the quickest each position arrived, ms: ${lateness.map((l) => l.toFixed(0)).join(" ")}`);
console.log(`  distance between where bob drew her and where she should be, px: ${errors.map((e) => e.toFixed(1)).join(" ")}`);

// Evenness.
const speeds = [];
for (let i = 1; i < steady.length; i++) {
  speeds.push(Math.hypot(steady[i].x - steady[i - 1].x, steady[i].y - steady[i - 1].y) / ((steady[i].t - steady[i - 1].t) / 1000));
}
const med = median(speeds);
const worstStray = Math.max(...speeds.map((v) => Math.abs(v / med - 1)));
console.log(`  alice's on-screen speed per frame, px/s: ${speeds.map((v) => v.toFixed(0)).join(" ")} (${summary(speeds)}; strays at most ${(worstStray * 100).toFixed(0)}% from the median)\n`);

check(steady.length >= 6, `enough frames to judge (${steady.length})`);
check(Math.max(...errors) <= 4, `bob draws alice where her positions put her 150 ms ago, within 4 px (worst ${Math.max(...errors).toFixed(1)})`);
check(speeds.every((v) => v >= med * 0.6 && v <= med * 1.4), "her on-screen speed stays within 40% of its median on every frame");

// And talking, with the figures still.
for (const c of "hi bob") await alice.keyboard.press(c === " " ? "Space" : c);
await bob.waitForTimeout(700);
await bob.screenshot({ path: `${outDir}/walk-bob-talk.png` });

console.log(problems.length ? `\nproblems:\n  ${problems.join("\n  ")}` : "\nno console errors, warnings or page errors");
await browser.close();
