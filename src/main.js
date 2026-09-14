import * as THREE from "three";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { scene, camera, render, onFrame, GRID, TILE } from "./world.js";
import { createFigure } from "./figure.js";
import { createSpeaker } from "./speech.js";
import { lamp } from "./lamp.js";
import { joinRoom } from "./room.js";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

// Discord launches the Activity with frame_id in the query string. Without it
// this is a plain browser tab, and every plain tab shares the room "local".
const params = new URLSearchParams(location.search);
const inDiscord = params.has("frame_id");

// Until Discord identity is wired in, everyone is a guest.
const name = params.get("name") ?? `guest-${Math.random().toString(16).slice(2, 6)}`;

const TICK_MS = 1000 / 15;
const SPEED = 3.5;
const RESPONSIVENESS = 12;
const TURN_RATE = 10;
const LIMIT = (GRID * TILE) / 2 - 0.3;

// Everyone else is shown this far in the past. Positions arrive fifteen times
// a second and are drawn between the two either side of that moment, so other
// people walk rather than hop; speech is replayed on the same delay, which
// spreads each batch of characters back out and keeps the words coming from
// where the figure is drawn.
const REMOTE_DELAY_MS = 150;

// How far the estimate of the network's best delay may relax with each
// position: enough to follow a route that gets slower within seconds, too
// little for one late position to drag the whole walk later.
const OFFSET_CREEP_MS = 0.2;

const statusEl = document.getElementById("status");
let connection = "booting";
let roomName = "";

function showStatus() {
  statusEl.textContent = `${roomName} · ${name} · ${remotes.size + 1} here · ${connection}`;
}

// ---------------------------------------------------------------------------
// The local player. Movement is 05's: camera-relative arrows, eased velocity.
// ---------------------------------------------------------------------------
const position = new THREE.Vector3(
  THREE.MathUtils.randFloatSpread(LIMIT),
  0,
  THREE.MathUtils.randFloatSpread(LIMIT),
);
const velocity = new THREE.Vector3();
const desired = new THREE.Vector3();
let yaw = 0;
let me = null;
let mySpeaker = null;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
forward.y = 0;
forward.normalize();
const right = new THREE.Vector3().crossVectors(forward, WORLD_UP);

const KEY_AXES = {
  ArrowUp: { forward: 1, right: 0 },
  ArrowDown: { forward: -1, right: 0 },
  ArrowLeft: { forward: 0, right: -1 },
  ArrowRight: { forward: 0, right: 1 },
};

const pressed = new Set();

// Characters typed since the last frame went out, each with the milliseconds
// since the character before it. The gap is counted across frames, not within
// one, so a hesitation that falls between two frames survives.
let unsent = [];
let lastTypedAt = null;

window.addEventListener("keydown", (event) => {
  if (event.key in KEY_AXES) {
    event.preventDefault();
    pressed.add(event.key);
    return;
  }

  // Leave browser, OS and Discord shortcuts alone.
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  // Enter uses the lamp, when it is in reach.
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat && lamp.inReach(position)) {
      // Change it here at once, so it feels immediate, then ask the room. The
      // room's answer comes back to us too and has the final say.
      lamp.set(!lamp.on);
      room?.send({ t: "lamp", on: lamp.on });
    }
    return;
  }

  // You cannot unsay a word, and Backspace would otherwise navigate back.
  if (event.key === "Backspace") {
    event.preventDefault();
    return;
  }

  // Named keys like Shift or F5 are longer than one character.
  if (event.key.length !== 1) return;
  event.preventDefault();

  mySpeaker?.say(event.key);
  me?.chatter();
  // timeStamp is when the key went down, not when this handler got round to it.
  const dt = lastTypedAt === null ? null : Math.round(event.timeStamp - lastTypedAt);
  unsent.push({ c: event.key, dt });
  lastTypedAt = event.timeStamp;
});
window.addEventListener("keyup", (event) => pressed.delete(event.key));
window.addEventListener("blur", () => pressed.clear());

// When the position last moved on, which is once per drawn frame.
let movedAt = performance.now();

function moveLocal(delta, elapsed) {
  movedAt = performance.now();
  desired.set(0, 0, 0);
  for (const key of pressed) {
    desired.addScaledVector(forward, KEY_AXES[key].forward);
    desired.addScaledVector(right, KEY_AXES[key].right);
  }
  if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(SPEED);

  velocity.lerp(desired, 1 - Math.exp(-RESPONSIVENESS * delta));
  position.addScaledVector(velocity, delta);
  position.x = THREE.MathUtils.clamp(position.x, -LIMIT, LIMIT);
  position.z = THREE.MathUtils.clamp(position.z, -LIMIT, LIMIT);
  // Move first, then push back out of the lamp, so walking into it slides.
  lamp.pushOut(position);

  if (velocity.length() > 0.05) {
    yaw = turnTowards(yaw, Math.atan2(velocity.x, velocity.z), TURN_RATE * delta);
  }

  if (me) {
    me.place(position.x, position.z, yaw);
    me.animate(velocity.length(), delta, elapsed);
  }
}

function turnTowards(from, to, rate) {
  const shortest = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + shortest * (1 - Math.exp(-rate));
}

// ---------------------------------------------------------------------------
// Everyone else.
// ---------------------------------------------------------------------------
const remotes = new Map();

function addRemote({ id, name, p }) {
  if (remotes.has(id)) return;
  const figure = createFigure({ id, name, you: false });
  const remote = {
    figure,
    speaker: createSpeaker(figure.head),
    // Positions, oldest first, each stamped with when it was true on the
    // sender's clock.
    snapshots: [],
    // This tab's clock minus the sender's, from the quickest position so far.
    offset: null,
    // Where they were last drawn, and how fast that makes them walk.
    lastX: 0,
    lastZ: 0,
    speed: 0,
    // Characters waiting to be spoken, each with the time it is due.
    heard: [],
    lastDueAt: null,
  };
  remotes.set(id, remote);
  scene.add(figure.root);

  if (p) {
    // Where the room last saw them stand. It carries no send time, so it holds
    // until their first timed position arrives.
    showAt(remote, p);
    remote.snapshots.push({ t: null, x: p[0], z: p[1], yaw: p[2] });
  } else {
    // Someone who has not sent a position yet stays hidden, rather than
    // appearing in the middle of the floor and then jumping.
    figure.root.visible = false;
  }
}

function showAt(remote, [x, z, yaw]) {
  remote.figure.place(x, z, yaw);
  remote.figure.root.visible = true;
  remote.lastX = x;
  remote.lastZ = z;
}

// Positions are sent evenly but arrive unevenly, because the network holds
// some up longer than others. Spacing the walk by arrival bakes that in, like
// a game with bad ping, so each position is placed at the moment it was sent,
// on the sender's clock.
//
// The two clocks are related by the quickest any position has taken to
// arrive: that is the network at its best, and anything slower was held up on
// the way. The remote delay then absorbs the holding up.
function place(remote, p, sentAt) {
  const delay = performance.now() - sentAt;
  remote.offset = remote.offset === null ? delay : Math.min(remote.offset + OFFSET_CREEP_MS, delay);

  const { snapshots } = remote;
  const last = snapshots.at(-1);
  const [x, z, yaw] = p;

  if (!last) {
    showAt(remote, p);
  } else if (last.t === null || sentAt - last.t > TICK_MS * 2) {
    // Standing still sends nothing, so the position before this one can be
    // seconds old, or carry no time at all. Treat it as one tick old, or the
    // first step would be spread across the whole silence and drawn too early.
    if (last.t === null) last.t = sentAt - TICK_MS;
    else snapshots.push({ ...last, t: sentAt - TICK_MS });
  }

  snapshots.push({ t: sentAt, x, z, yaw });
  // A hidden tab draws nothing and so prunes nothing.
  if (snapshots.length > 64) snapshots.splice(0, snapshots.length - 64);
}

// Where a remote player was at a moment in the past: between the snapshots
// either side of it, or the newest if the moment is past all of them. Older
// snapshots are dropped as the moment moves on.
const sampled = { x: 0, z: 0, yaw: 0 };

function sample(snapshots, at) {
  while (snapshots.length > 2 && snapshots[1].t <= at) snapshots.shift();
  const [a, b] = snapshots;
  if (!b || at <= a.t) return Object.assign(sampled, a);
  if (at >= b.t) return Object.assign(sampled, b);

  const alpha = (at - a.t) / (b.t - a.t);
  sampled.x = a.x + (b.x - a.x) * alpha;
  sampled.z = a.z + (b.z - a.z) * alpha;
  sampled.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * alpha;
  return sampled;
}

// Each character is due its typed gap after the one before it. Nothing is due
// sooner than the remote delay from now, which absorbs a batch arriving at
// once, and a long pause collapses back to the delay rather than accumulating.
function hear(remote, speech) {
  const earliest = performance.now() + REMOTE_DELAY_MS;
  for (const { c, dt } of speech) {
    const due =
      dt === null || remote.lastDueAt === null ? earliest : Math.max(earliest, remote.lastDueAt + dt);
    remote.heard.push({ c, due });
    remote.lastDueAt = due;
  }
}

function removeRemote(id) {
  const remote = remotes.get(id);
  if (!remote) return;
  remote.speaker.dispose();
  remote.figure.root.removeFromParent();
  remote.figure.dispose();
  remotes.delete(id);
}

function updateRemotes(delta, now, elapsed) {
  for (const remote of remotes.values()) {
    if (remote.snapshots.length === 0) continue;

    // The moment to draw them at, on their own clock.
    const at = now - (remote.offset ?? 0) - REMOTE_DELAY_MS;
    const { x, z, yaw } = sample(remote.snapshots, at);
    // Their legs follow how fast they are drawn moving, smoothed so a frame
    // that happens to land between two ticks does not twitch the stride.
    const moved = Math.hypot(x - remote.lastX, z - remote.lastZ);
    remote.speed += (moved / Math.max(delta, 1e-3) - remote.speed) * (1 - Math.exp(-12 * delta));
    remote.lastX = x;
    remote.lastZ = z;

    remote.figure.place(x, z, yaw);
    remote.figure.animate(remote.speed, delta, elapsed);

    while (remote.heard.length > 0 && remote.heard[0].due <= now) {
      remote.speaker.say(remote.heard.shift().c);
      remote.figure.chatter();
    }
    remote.speaker.update(delta);
  }
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------
let room;

// The position moves on once per drawn frame, but frames and ticks do not line
// up. A slow tab would send the same position twice and then a double step,
// and everyone else would faithfully draw the stall and the leap. Carrying it
// forward to the moment of sending makes evenly spaced ticks carry evenly
// spaced positions.
function currentPosition() {
  const round = (n) => Math.round(n * 1000) / 1000;
  const ahead = Math.min((performance.now() - movedAt) / 1000, 0.1);
  const x = THREE.MathUtils.clamp(position.x + velocity.x * ahead, -LIMIT, LIMIT);
  const z = THREE.MathUtils.clamp(position.z + velocity.z * ahead, -LIMIT, LIMIT);
  return [round(x), round(z), round(yaw)];
}

function onMessage(message) {
  switch (message.t) {
    case "hello": {
      // Also arrives after a reconnect, when the room has forgotten us and we
      // have a new id, so start from nothing.
      for (const id of [...remotes.keys()]) removeRemote(id);
      if (me) {
        mySpeaker.dispose();
        me.root.removeFromParent();
        me.dispose();
      }
      me = createFigure({ id: message.you, name, you: true });
      mySpeaker = createSpeaker(me.head);
      scene.add(me.root);
      for (const peer of message.peers) addRemote(peer);
      lamp.set(message.world.lamp);
      // Tell everyone where we are standing, even if we never move.
      room.send({ t: "frame", p: currentPosition(), ts: Math.round(performance.now()) });
      break;
    }
    case "joined":
      addRemote(message);
      break;
    case "frame": {
      const remote = remotes.get(message.id);
      if (!remote) break;
      // A frame without a send time falls back to its arrival, expressed on
      // the sender's clock.
      if (message.p) place(remote, message.p, message.ts ?? performance.now() - (remote.offset ?? 0));
      if (message.s) hear(remote, message.s);
      break;
    }
    case "lamp":
      lamp.set(message.on);
      break;
    case "left":
      removeRemote(message.id);
      break;
  }
  showStatus();
}

// `p` goes every tick while moving, and once more when movement stops, so a
// receiver never has to guess whether silence means stopped or late. Speech
// goes whenever there is some, moving or not.
let wasMoving = false;

setInterval(() => {
  if (!room) return;
  const moving = pressed.size > 0 || velocity.lengthSq() > 1e-4;
  const message = { t: "frame" };
  if (moving || wasMoving) {
    message.p = currentPosition();
    // When that position was true, on this tab's clock, so everyone else can
    // space the walk by when it happened rather than when it reached them.
    message.ts = Math.round(performance.now());
  }
  if (unsent.length > 0) message.s = unsent.splice(0);
  if (message.p || message.s) room.send(message);
  wasMoving = moving;
}, TICK_MS);

// ---------------------------------------------------------------------------
// Start.
// ---------------------------------------------------------------------------
async function start() {
  roomName = params.get("room") ?? "local";
  if (inDiscord) {
    if (!CLIENT_ID) throw new Error("VITE_DISCORD_CLIENT_ID was not set at build time");
    const discordSdk = new DiscordSDK(CLIENT_ID);
    connection = "waiting for Discord";
    showStatus();
    await discordSdk.ready();
    roomName = discordSdk.instanceId;
  }

  room = joinRoom({
    room: roomName,
    name,
    inDiscord,
    onMessage,
    onStatus(text) {
      connection = text;
      showStatus();
    },
  });
}

const timer = new THREE.Timer();
timer.connect(document);
onFrame((time) => {
  timer.update(time);
  const delta = Math.min(timer.getDelta(), 0.1);
  const elapsed = timer.getElapsed();
  moveLocal(delta, elapsed);
  lamp.update(position, delta);
  mySpeaker?.update(delta);
  updateRemotes(delta, performance.now(), elapsed);
  render();
});

start().catch((err) => {
  console.error(err);
  connection = `failed: ${err.message ?? err}`;
  showStatus();
});
