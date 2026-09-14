// Usage: node tests/room/speech.mjs [WebSocket URL]
//   Defaults to $WS_URL, then ws://127.0.0.1:8787/ws (npm run dev). Through
//   Discord's proxy it is wss://<application id>.discordsays.com/.proxy/ws.
// The room's handling of speech: relayed with the sender's id, never echoed,
// validated part by part, and never changing a stored position.
const base = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787/ws";
const room = `speech-${Math.random().toString(16).slice(2, 8)}`;

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

bob.send({ t: "frame", p: [2, 2, 0] });
await alice.next(isFrame);

const speech = [{ c: "h", dt: null }, { c: "i", dt: 340 }, { c: " ", dt: 95 }];
bob.send({ t: "frame", s: speech });
const spoken = await alice.next(isFrame);
check(spoken?.id === bobHello.you, "speech arrives stamped with the speaker's id");
check(JSON.stringify(spoken?.s) === JSON.stringify(speech), "characters and gaps arrive exactly as sent, null first gap included");
check(spoken && !("p" in spoken), "a speech-only frame carries no position");
check(await bob.quiet(isFrame), "the speaker does not get their own speech back");

bob.send({ t: "frame", p: [3, 3, 1], s: [{ c: "x", dt: 50 }] });
const both = await alice.next(isFrame);
check(JSON.stringify(both?.p) === "[3,3,1]" && both?.s?.[0]?.c === "x", "position and speech travel together in one frame");

bob.send({ t: "frame", s: [{ c: "toolong", dt: 10 }] });
bob.send({ t: "frame", s: [{ c: "a", dt: -5 }] });
bob.send({ t: "frame", s: [] });
bob.send({ t: "frame", s: Array.from({ length: 65 }, () => ({ c: "a", dt: 1 })) });
bob.send({ t: "frame", s: [{ c: "a" }] });
check(await alice.quiet(isFrame), "malformed speech on its own is dropped");

bob.send({ t: "frame", p: [4, 4, 2], s: [{ c: "a", dt: -5 }] });
const partial = await alice.next(isFrame);
check(JSON.stringify(partial?.p) === "[4,4,2]" && partial && !("s" in partial), "malformed speech beside a good position: the position still goes");

bob.send({ t: "frame", s: [{ c: "z", dt: 10 }] });
await alice.next(isFrame);
const carol = client("carol");
const carolHello = await carol.next((m) => m.t === "hello");
const bobSeen = carolHello?.peers.find((p) => p.id === bobHello.you);
check(JSON.stringify(bobSeen?.p) === "[4,4,2]", `speaking does not move the stored position (got ${JSON.stringify(bobSeen?.p)})`);

for (const c of [alice, bob, carol]) c.ws.close(1000);
await Promise.all([alice.closed, bob.closed, carol.closed]);
process.exit();
