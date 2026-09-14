// Walks alice to the lamp in a real tab and presses Enter. A plain socket in
// the room watches where she is, to steer her, and hears the room's answer;
// screenshots show whether bob and a late arrival see the lamp lit.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Usage: node tests/browser/lamp.mjs [app URL]
//   Defaults to $APP_URL, then http://127.0.0.1:8787/ (npm run dev).
//   CHROMIUM_PATH picks a Chromium binary; otherwise Playwright's own is used.
//   Screenshots go to $OUT_DIR, default tests/out/. Run browser tests one at a
//   time: they render in software and skew each other's timings.
const base = process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:8787/";
const executablePath = process.env.CHROMIUM_PATH;
const outDir = process.env.OUT_DIR ?? fileURLToPath(new URL("../out/", import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const wsUrl = `${base.replace(/^http/, "ws")}ws`;
const room = `lamp-probe-${Math.random().toString(16).slice(2, 8)}`;

// Where the lamp is, and a spot beside it: inside its reach of 1.2, outside
// its collision box of 0.48.
const LAMP = { x: -2.6, z: -1.4 };
const STAND = { x: LAMP.x + 0.75, z: LAMP.z + 0.75 };
// The locked camera looks from (20, 20, 20), so up the screen is -x -z and
// right is +x -z, and walking speed is 3.5 units a second.
const FORWARD = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
const RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const SPEED = 3.5;

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

// The watcher.
const names = new Map();
const where = new Map();
const lampHeard = [];
const watcher = new WebSocket(`${wsUrl}?room=${room}&name=watcher`);
watcher.addEventListener("message", (event) => {
  const m = JSON.parse(event.data);
  if (m.t === "joined") names.set(m.name, m.id);
  if (m.t === "frame" && m.p) where.set(m.id, m.p);
  if (m.t === "lamp") lampHeard.push(m.on);
});
await new Promise((resolve) => watcher.addEventListener("open", resolve));

const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function open(name) {
  const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${name} ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${name} page error: ${e.message}`));
  await page.goto(`${base}?room=${room}&name=${name}`);
  await page.waitForFunction(() => /connected/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  return page;
}

// The renderer only adds the prompt to the page once it is first shown, so a
// missing element means not offered, the same as a hidden one.
const prompt = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".prompt");
    return !el || el.style.display === "none" ? null : el.textContent.replace("⏎", "");
  });

const alice = await open("alice");
const bob = await open("bob");

const until = async (test, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};
check(await until(() => names.has("alice") && where.has(names.get("alice"))), "the watcher knows where alice is standing");

async function hold(key, ms) {
  if (ms < 20) return;
  await alice.keyboard.down(key);
  await alice.waitForTimeout(ms);
  await alice.keyboard.up(key);
}

let steps = 0;
for (; steps < 12 && !(await prompt(alice)); steps++) {
  const [x, z] = where.get(names.get("alice"));
  const dx = STAND.x - x;
  const dz = STAND.z - z;
  const f = dx * FORWARD.x + dz * FORWARD.z;
  const r = dx * RIGHT.x + dz * RIGHT.z;
  await hold(f >= 0 ? "ArrowUp" : "ArrowDown", (Math.abs(f) / SPEED) * 1000);
  await hold(r >= 0 ? "ArrowRight" : "ArrowLeft", (Math.abs(r) / SPEED) * 1000);
  // Let her settle and the stop frame arrive before looking again.
  await alice.waitForTimeout(700);
}
const before = await prompt(alice);
check(before === "Turn the lamp on", `alice reached the lamp in ${steps} steps and is offered "${before}"`);
// Everyone starts somewhere random, which can be beside the lamp, so bob's
// prompt is checked against his own distance from it.
const [bx, bz] = where.get(names.get("bob"));
const bobDistance = Math.hypot(bx - LAMP.x, bz - LAMP.z);
const bobPrompt = await prompt(bob);
check(
  bobDistance < 1.2 ? bobPrompt !== null : bobPrompt === null,
  `bob, ${bobDistance.toFixed(2)} from the lamp, is ${bobPrompt === null ? "not " : ""}offered it (reach is 1.2)`,
);

await alice.keyboard.press("Enter");
check(await until(() => lampHeard.includes(true), 3000), "the room announced the lamp on");
await alice.waitForTimeout(400);
check((await prompt(alice)) === "Turn the lamp off", "alice's prompt now offers to turn it off");

await bob.waitForTimeout(300);
await bob.screenshot({ path: `${outDir}/lamp-bob.png` });
const carol = await open("carol");
await carol.waitForTimeout(800);
await carol.screenshot({ path: `${outDir}/lamp-carol-late.png` });

await alice.keyboard.press("Enter");
check(await until(() => lampHeard.at(-1) === false, 3000), "pressing again, the room announced the lamp off");
await carol.waitForTimeout(500);
await carol.screenshot({ path: `${outDir}/lamp-carol-off.png` });

console.log(problems.length ? `\nproblems:\n  ${problems.join("\n  ")}` : "\nno console errors, warnings or page errors");
watcher.close(1000);
await browser.close();
process.exit();
