import * as THREE from "three";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { scene, camera, render, onFrame, GRID, TILE } from "./world.js";
import { createDot } from "./dot.js";
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

window.addEventListener("keydown", (event) => {
  if (!(event.key in KEY_AXES)) return;
  event.preventDefault();
  pressed.add(event.key);
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
  const remote = { dot, target: new THREE.Vector3(), yaw: 0, placed: false };
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

function removeRemote(id) {
  const remote = remotes.get(id);
  if (!remote) return;
  remote.dot.removeFromParent();
  remote.dot.userData.dispose();
  remotes.delete(id);
}

function moveRemotes(delta) {
  const ease = 1 - Math.exp(-REMOTE_EASE * delta);
  for (const { dot, target, yaw, placed } of remotes.values()) {
    if (!placed) continue;
    dot.position.lerp(target, ease);
    dot.rotation.y = turnTowards(dot.rotation.y, yaw, REMOTE_EASE * delta);
  }
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------
let room;

function frame() {
  const round = (n) => Math.round(n * 1000) / 1000;
  return { t: "frame", p: [round(position.x), round(position.z), round(yaw)] };
}

function onMessage(message) {
  switch (message.t) {
    case "hello": {
      // Also arrives after a reconnect, when the room has forgotten us and we
      // have a new id, so start from nothing.
      for (const id of [...remotes.keys()]) removeRemote(id);
      if (me) {
        me.removeFromParent();
        me.userData.dispose();
      }
      me = createDot({ id: message.you, name, you: true });
      scene.add(me);
      for (const peer of message.peers) addRemote(peer);
      // Tell everyone where we are standing, even if we never move.
      room.send(frame());
      break;
    }
    case "joined":
      addRemote(message);
      break;
    case "frame": {
      const remote = remotes.get(message.id);
      if (remote) place(remote, message.p);
      break;
    }
    case "left":
      removeRemote(message.id);
      break;
  }
  showStatus();
}

// `p` goes every tick while moving, and once more when movement stops, so a
// receiver never has to guess whether silence means stopped or late.
let wasMoving = false;

setInterval(() => {
  if (!room) return;
  const moving = pressed.size > 0 || velocity.lengthSq() > 1e-4;
  if (moving || wasMoving) room.send(frame());
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
  moveRemotes(delta);
  render();
});

start().catch((err) => {
  console.error(err);
  connection = `failed: ${err.message ?? err}`;
  showStatus();
});
