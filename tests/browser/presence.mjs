// Two real browser tabs in the local room: does each see the other, does a
// walk in one show up in the other, and does leaving remove the dot?
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Usage: node tests/browser/presence.mjs [app URL]
//   Defaults to $APP_URL, then http://127.0.0.1:8787/ (npm run dev).
//   CHROMIUM_PATH picks a Chromium binary; otherwise Playwright's own is used.
//   Screenshots go to $OUT_DIR, default tests/out/. Run browser tests one at a
//   time: they render in software and skew each other's timings.
const base = process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:8787/";
const executablePath = process.env.CHROMIUM_PATH;
const outDir = process.env.OUT_DIR ?? fileURLToPath(new URL("../out/", import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const room = `presence-probe-${Math.random().toString(16).slice(2, 8)}`;

const browser = await chromium.launch({
  executablePath,
  // Headless has no GPU; SwiftShader renders WebGL in software.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};
const status = (page) => page.textContent("#status");
const labels = (page) => page.$$eval(".name", (els) => els.map((e) => e.textContent).sort());

async function open(name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${name} ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${name} page error: ${e.message}`));
  await page.goto(`${base}?room=${room}&name=${name}`);
  return page;
}

const alice = await open("alice");
const bob = await open("bob");

for (const page of [alice, bob]) {
  await page.waitForFunction(
    () => /2 here · connected/.test(document.getElementById("status").textContent),
    null,
    { timeout: 20000 },
  );
}
check(
  /2 here · connected/.test(await status(alice)) && /2 here · connected/.test(await status(bob)),
  "both tabs count two people, connected",
);
const aliceSees = await labels(alice);
const bobSees = await labels(bob);
check(JSON.stringify(aliceSees) === '["alice (you)","bob"]', `alice sees herself and bob (${JSON.stringify(aliceSees)})`);
check(JSON.stringify(bobSees) === '["alice","bob (you)"]', `bob sees alice and himself (${JSON.stringify(bobSees)})`);

await bob.waitForTimeout(500);
await bob.screenshot({ path: `${outDir}/bob-before.png` });

// Walk alice screen-right for a second.
await alice.keyboard.down("ArrowRight");
await alice.waitForTimeout(1000);
await alice.keyboard.up("ArrowRight");
await alice.waitForTimeout(800);

await bob.screenshot({ path: `${outDir}/bob-after.png` });
await alice.screenshot({ path: `${outDir}/alice-after.png` });

await alice.close();
await bob.waitForFunction(
  () => /1 here/.test(document.getElementById("status").textContent),
  null,
  { timeout: 5000 },
).catch(() => problems.push("bob never saw alice leave"));
check(/1 here/.test(await status(bob)), "after alice closes her tab, bob counts one");
const bobSeesAfter = await labels(bob);
check(JSON.stringify(bobSeesAfter) === '["bob (you)"]', `…and her figure is gone (${JSON.stringify(bobSeesAfter)})`);

console.log(problems.length ? `\nproblems:\n  ${problems.join("\n  ")}` : "\nno console errors, warnings or page errors");
if (problems.length) process.exitCode = 1;
await browser.close();
