// Prints one tab's frame gaps and the transforms CSS2DRenderer gives its name
// labels. Usage: node tests/tools/label-probe.mjs [app URL]; CHROMIUM_PATH as
// for the browser tests.
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
await page.goto(`${process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:8787/"}?room=label-probe&name=solo`);
await page.waitForFunction(() => /connected/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
await page.waitForTimeout(800);
const info = await page.evaluate(
  () => new Promise((resolve) => {
    const times = [];
    const tick = (t) => { times.push(t); if (times.length < 31) requestAnimationFrame(tick); else done(); };
    const done = () => {
      const gaps = times.slice(1).map((t, i) => Math.round(t - times[i]));
      const labels = [...document.querySelectorAll(".name")].map((el) => ({
        text: el.textContent,
        transform: el.style.transform,
        display: el.style.display,
        parent: el.parentElement?.id || el.parentElement?.tagName,
      }));
      resolve({ gaps, labels });
    };
    requestAnimationFrame(tick);
  }),
);
console.log("frame gaps (ms):", info.gaps.join(" "));
console.log("labels:", JSON.stringify(info.labels, null, 2));
await browser.close();
