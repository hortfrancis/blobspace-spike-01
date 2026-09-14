// Usage: node tests/room/presence.mjs [WebSocket URL]
//   Defaults to $WS_URL, then ws://127.0.0.1:8787/ws (npm run dev). Through
//   Discord's proxy it is wss://<application id>.discordsays.com/.proxy/ws.
// Drives the room's presence protocol with plain sockets: hello, joined,
// frame relay, validation, left, and clean closes.
const base = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787/ws";
const room = `presence-${Math.random().toString(16).slice(2, 8)}`;

const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

// Buffers every message from the moment the socket exists, so nothing that
// arrives before a test starts waiting is lost.
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
    // Resolves true if nothing matching arrives within the window.
    async quiet(match, windowMs = 700) {
      return (await this.next(match, windowMs)) === null;
    },
    send(message) { ws.send(typeof message === "string" ? message : JSON.stringify(message)); },
  };
}

const alice = client("alice");
const aliceHello = await alice.next((m) => m.t === "hello");
check(aliceHello && aliceHello.peers.length === 0, "first arrival is told the room is empty");
alice.send({ t: "frame", p: [1, 2, 0.5] });

// Give the room a moment to store alice's position before bob arrives.
await new Promise((r) => setTimeout(r, 300));

const bob = client("bob");
const bobHello = await bob.next((m) => m.t === "hello");
const seenAlice = bobHello?.peers.find((p) => p.id === aliceHello.you);
check(bobHello?.peers.length === 1 && seenAlice?.name === "alice", "late arrival is told alice is here");
check(JSON.stringify(seenAlice?.p) === "[1,2,0.5]", `…and where she is standing (got ${JSON.stringify(seenAlice?.p)})`);
check(typeof bobHello?.you === "string" && bobHello.you !== aliceHello.you, "each socket gets its own id");

const joined = await alice.next((m) => m.t === "joined");
check(joined?.id === bobHello.you && joined?.name === "bob", "alice hears bob join, with his name");

bob.send({ t: "frame", p: [-1, -1, 3.1] });
const relayed = await alice.next((m) => m.t === "frame");
check(relayed?.id === bobHello.you && JSON.stringify(relayed.p) === "[-1,-1,3.1]", "bob's frame reaches alice, stamped with his id");
check(await bob.quiet((m) => m.t === "frame"), "bob does not get his own frame back");

bob.send({ t: "frame", p: [1, 2] });
bob.send({ t: "frame", p: [1, "x", 0] });
bob.send("not json");
check(await alice.quiet((m) => m.t === "frame"), "malformed frames are dropped");

bob.ws.close();
const left = await alice.next((m) => m.t === "left");
check(left?.id === bobHello.you, "alice hears bob leave");
const bobClose = await Promise.race([bob.closed, new Promise((r) => setTimeout(() => r(null), 3000))]);
check(bobClose?.code === 1000, `bob's bare close() ends cleanly (got ${bobClose?.code ?? "no close event"})`);

const carol = client("carol");
const carolHello = await carol.next((m) => m.t === "hello");
check(
  carolHello?.peers.length === 1 && carolHello.peers[0].name === "alice",
  `the roster no longer includes bob (got ${carolHello?.peers.map((p) => p.name).join(", ")})`,
);

alice.ws.close(1000);
carol.ws.close(1000);
await Promise.all([alice.closed, carol.closed]);
process.exit();
