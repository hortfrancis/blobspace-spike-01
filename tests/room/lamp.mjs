// Usage: node tests/room/lamp.mjs [WebSocket URL]
//   Defaults to $WS_URL, then ws://127.0.0.1:8787/ws (npm run dev). Through
//   Discord's proxy it is wss://<application id>.discordsays.com/.proxy/ws.
// The room as the lamp's authority: everyone hears a change, the asker
// included; late arrivals are told; bad requests are dropped; simultaneous
// requests leave everyone agreeing; and the state outlives an empty room.
const base = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787/ws";
const room = `lamp-${Math.random().toString(16).slice(2, 8)}`;

const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(`${base}?room=${room}&name=${name}`);
  const inbox = [];
  const waiters = [];
  const lampLog = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.t === "lamp") lampLog.push(message.on);
    const i = waiters.findIndex((w) => w.match(message));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const closed = new Promise((resolve) => ws.addEventListener("close", resolve));
  return {
    ws,
    closed,
    lampLog,
    next(match, timeoutMs = 3000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) { waiters.splice(j, 1); resolve(null); }
        }, timeoutMs);
      });
    },
    async quiet(match, windowMs = 700) {
      return (await this.next(match, windowMs)) === null;
    },
    send(message) { ws.send(JSON.stringify(message)); },
  };
}

const isLamp = (m) => m.t === "lamp";

const alice = client("alice");
const aliceHello = await alice.next((m) => m.t === "hello");
check(aliceHello?.world?.lamp === false, "a new room's lamp starts off");
const bob = client("bob");
await bob.next((m) => m.t === "hello");

alice.send({ t: "lamp", on: true });
const toAlice = await alice.next(isLamp);
const toBob = await bob.next(isLamp);
check(toAlice?.on === true && toAlice.by === aliceHello.you, "the asker hears the room's answer, stamped with who asked");
check(toBob?.on === true && toBob.by === aliceHello.you, "everyone else hears it too");

alice.send({ t: "lamp", on: "yes" });
alice.send({ t: "lamp" });
alice.send({ t: "lamp", on: 1 });
check(await bob.quiet(isLamp), "requests without a true or false are dropped");

const carol = client("carol");
const carolHello = await carol.next((m) => m.t === "hello");
check(carolHello?.world?.lamp === true, "a late arrival is told the lamp is on");

// Clear what has been seen so far, then have two people ask at the same moment.
for (const c of [alice, bob, carol]) c.lampLog.length = 0;
alice.send({ t: "lamp", on: false });
bob.send({ t: "lamp", on: true });
await sleep(1200);
const logs = [alice, bob, carol].map((c) => JSON.stringify(c.lampLog));
check(
  logs.every((l) => l === logs[0]) && JSON.parse(logs[0]).length === 2,
  `simultaneous requests: everyone saw the same two answers in the same order (${logs.join(" / ")})`,
);
const settled = JSON.parse(logs[0]).at(-1);

// Both asking for on at once leaves it on, which a flip would not.
for (const c of [alice, bob, carol]) c.lampLog.length = 0;
alice.send({ t: "lamp", on: true });
bob.send({ t: "lamp", on: true });
await sleep(1200);
check(carol.lampLog.length === 2 && carol.lampLog.every((on) => on === true), "two people turning it on at once leaves it on");

for (const c of [alice, bob, carol]) c.ws.close(1000);
await Promise.all([alice.closed, bob.closed, carol.closed]);
await sleep(1000);

const dave = client("dave");
const daveHello = await dave.next((m) => m.t === "hello");
check(daveHello?.world?.lamp === true, `the lamp's state outlives an empty room (got ${daveHello?.world?.lamp}; settled on ${settled} before the last request)`);
dave.ws.close(1000);
await dave.closed;
process.exit();
