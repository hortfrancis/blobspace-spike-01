// Obsolete: step one's room echoed every message, and the room no longer does. Kept as a record of step one.
const base = "127.0.0.1:8799";
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) process.exitCode = 1; };

const page = await fetch(`http://${base}/`);
check(page.status === 200 && (await page.text()).includes("step one"), "GET / serves the page");
check((await fetch(`http://${base}/ws?room=a`)).status === 426, "GET /ws without upgrade is 426");

function open(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws?room=${room}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}
const next = (ws) => new Promise((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true }));

const a1 = await open("a");
const a2 = await open("a");
const b1 = await open("b");

const sent = JSON.stringify({ n: 1, text: "héllo" });
let reply = next(a1); a1.send(sent); reply = await reply;
check(reply.t === "echo" && reply.of === sent, "echo returns the exact message");
check(reply.sockets === 2, `room a holds 2 sockets (got ${reply.sockets})`);

reply = next(b1); b1.send("{}"); reply = await reply;
check(reply.sockets === 1, `room b holds 1 socket (got ${reply.sockets})`);

let leaked = false;
a2.addEventListener("message", () => { leaked = true; });
reply = next(a1); a1.send("{}"); await reply;
check(!leaked, "echo goes only to the sender");

for (const ws of [a1, a2, b1]) ws.close();
