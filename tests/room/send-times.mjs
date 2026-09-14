// Usage: node tests/room/send-times.mjs [WebSocket URL]
//   Defaults to $WS_URL, then ws://127.0.0.1:8787/ws (npm run dev). Through
//   Discord's proxy it is wss://<application id>.discordsays.com/.proxy/ws.
// The room's handling of send times: relayed beside a position, dropped when
// malformed or alone, and never costing the position or speech beside it.
const base = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787/ws";
const room = `ts-${Math.random().toString(16).slice(2, 8)}`;

const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

function client(name) {
  const ws = new WebSocket(`${base}?room=${room}&name=${name}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const i = waiters.findIndex((w) => w.match(message));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const closed = new Promise((resolve) => ws.addEventListener("close", resolve));
  return {
    ws,
    closed,
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

const isFrame = (m) => m.t === "frame";

const alice = client("alice");
await alice.next((m) => m.t === "hello");
const bob = client("bob");
const bobHello = await bob.next((m) => m.t === "hello");
await alice.next((m) => m.t === "joined");

bob.send({ t: "frame", p: [1, 1, 0], ts: 12345.5 });
let got = await alice.next(isFrame);
check(got?.id === bobHello.you && got.ts === 12345.5 && JSON.stringify(got.p) === "[1,1,0]", "a send time beside a position is relayed with it");

bob.send({ t: "frame", p: [2, 2, 0] });
got = await alice.next(isFrame);
check(got && JSON.stringify(got.p) === "[2,2,0]" && !("ts" in got), "a position without a send time still goes, without one");

for (const ts of ["soon", -1, null, Infinity]) {
  bob.send({ t: "frame", p: [3, 3, 0], ts });
  got = await alice.next(isFrame);
  check(got && JSON.stringify(got.p) === "[3,3,0]" && !("ts" in got), `a malformed send time (${JSON.stringify(ts)}) is dropped and the position still goes`);
}

bob.send({ t: "frame", ts: 500 });
check(await alice.quiet(isFrame), "a send time on its own is not a frame");

bob.send({ t: "frame", s: [{ c: "a", dt: null }], ts: 600 });
got = await alice.next(isFrame);
check(got?.s?.[0]?.c === "a" && !("ts" in got) && !("p" in got), "a send time beside speech alone is dropped; the speech still goes");

const carol = client("carol");
const carolHello = await carol.next((m) => m.t === "hello");
const bobSeen = carolHello?.peers.find((p) => p.id === bobHello.you);
check(bobSeen && JSON.stringify(bobSeen.p) === "[3,3,0]" && !("ts" in bobSeen), "the room stores the position, not the send time");

for (const c of [alice, bob, carol]) c.ws.close(1000);
await Promise.all([alice.closed, bob.closed, carol.closed]);
process.exit();
