import * as THREE from "three";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { scene, camera, render, onFrame, GRID, TILE } from "./world.js";
import { createDot } from "./dot.js";
import { createSpeaker } from "./speech.js";
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

// Remote dots ease towards the last position they were sent. Proper buffered
// interpolation, rendering 100 to 150 ms behind, is step three.
const REMOTE_EASE = 18;

// Remote speech is replayed this far behind real time. Characters arrive in
// batches, one per tick; the delay is the room needed to spread each batch
// back out at the gaps it was typed with.
const SPEECH_DELAY_MS = 150;

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

  // You cannot unsay a word, and Backspace would otherwise navigate back.
  if (event.key === "Backspace") {
    event.preventDefault();
    return;
  }

  // Named keys like Shift or F5 are longer than one character.
  if (event.key.length !== 1) return;
  event.preventDefault();

  mySpeaker?.say(event.key);
  // timeStamp is when the key went down, not when this handler got round to it.
  const dt = lastTypedAt === null ? null : Math.round(event.timeStamp - lastTypedAt);
  unsent.push({ c: event.key, dt });
  lastTypedAt = event.timeStamp;
});
window.addEventListener("keyup", (event) => pressed.delete(event.key));
window.addEventListener("blur", () => pressed.clear());

function moveLocal(delta) {
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

  if (velocity.length() > 0.05) {
    yaw = turnTowards(yaw, Math.atan2(velocity.x, velocity.z), TURN_RATE * delta);
  }

  if (me) {
    me.position.copy(position);
    me.rotation.y = yaw;
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
  const dot = createDot({ id, name, you: false });
  const remote = {
    dot,
    target: new THREE.Vector3(),
    yaw: 0,
    placed: false,
    speaker: createSpeaker(dot),
    // Characters waiting to be spoken, each with the time it is due.
    heard: [],
    lastDueAt: null,
  };
  remotes.set(id, remote);
  scene.add(dot);
  // Someone who has not sent a position yet stays hidden, rather than
  // appearing in the middle of the floor and then jumping.
  dot.visible = false;
  if (p) place(remote, p);
}

function place(remote, [x, z, yaw]) {
  remote.target.set(x, 0, z);
  remote.yaw = yaw;
  if (!remote.placed) {
    remote.dot.position.copy(remote.target);
    remote.dot.rotation.y = yaw;
    remote.dot.visible = true;
    remote.placed = true;
  }
}

// Each character is due its typed gap after the one before it. Nothing is due
// sooner than the replay delay from now, which absorbs a batch arriving at
// once, and a long pause collapses back to the delay rather than accumulating.
function hear(remote, speech) {
  const earliest = performance.now() + SPEECH_DELAY_MS;
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
  remote.dot.removeFromParent();
  remote.dot.userData.dispose();
  remotes.delete(id);
}

function updateRemotes(delta, now) {
  const ease = 1 - Math.exp(-REMOTE_EASE * delta);
  for (const remote of remotes.values()) {
    if (!remote.placed) continue;
    remote.dot.position.lerp(remote.target, ease);
    remote.dot.rotation.y = turnTowards(remote.dot.rotation.y, remote.yaw, REMOTE_EASE * delta);

    while (remote.heard.length > 0 && remote.heard[0].due <= now) {
      remote.speaker.say(remote.heard.shift().c);
    }
    remote.speaker.update(delta);
  }
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------
let room;

function currentPosition() {
  const round = (n) => Math.round(n * 1000) / 1000;
  return [round(position.x), round(position.z), round(yaw)];
}

function onMessage(message) {
  switch (message.t) {
    case "hello": {
      // Also arrives after a reconnect, when the room has forgotten us and we
      // have a new id, so start from nothing.
      for (const id of [...remotes.keys()]) removeRemote(id);
      if (me) {
        mySpeaker.dispose();
        me.removeFromParent();
        me.userData.dispose();
      }
      me = createDot({ id: message.you, name, you: true });
      mySpeaker = createSpeaker(me);
      scene.add(me);
      for (const peer of message.peers) addRemote(peer);
      // Tell everyone where we are standing, even if we never move.
      room.send({ t: "frame", p: currentPosition() });
      break;
    }
    case "joined":
      addRemote(message);
      break;
    case "frame": {
      const remote = remotes.get(message.id);
      if (!remote) break;
      if (message.p) place(remote, message.p);
      if (message.s) hear(remote, message.s);
      break;
    }
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
  if (moving || wasMoving) message.p = currentPosition();
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
  moveLocal(delta);
  mySpeaker?.update(delta);
  updateRemotes(delta, performance.now());
  render();
});

start().catch((err) => {
  console.error(err);
  connection = `failed: ${err.message ?? err}`;
  showStatus();
});
