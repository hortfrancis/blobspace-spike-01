import { DiscordSDK } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const HEARTBEAT_MS = 5000;

// Discord launches the Activity with frame_id in the query string. Without it
// this is a plain browser tab, which is enough to test the Worker locally.
const inDiscord = new URLSearchParams(location.search).has("frame_id");

const $ = (id) => document.getElementById(id);
const bootedAt = performance.now();

function log(line) {
  const seconds = ((performance.now() - bootedAt) / 1000).toFixed(1).padStart(7);
  console.log(`[echo] ${line}`);
  $("log").textContent = `${seconds}s  ${line}\n${$("log").textContent}`.slice(0, 20000);
}

function setStatus(text, state) {
  $("status").textContent = text;
  $("status").className = state ?? "";
}

let socket;
let openedAt;
let sent = 0;
let echoes = 0;

function connect(room) {
  // The thing to falsify: a long-lived wss:// through /.proxy/.
  const path = inDiscord ? "/.proxy/ws" : "/ws";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}${path}?room=${encodeURIComponent(room)}`;
  $("url").textContent = url;
  $("reconnect").hidden = true;
  setStatus("connecting");
  log(`connecting to ${url}`);

  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    openedAt = performance.now();
    setStatus("open", "open");
    log("open");
  });

  socket.addEventListener("message", (event) => {
    const { of, sockets } = JSON.parse(event.data);
    const message = JSON.parse(of);
    echoes += 1;
    $("echoes").textContent = String(echoes);
    $("rtt").textContent = `${Math.round(performance.now() - message.at)} ms`;
    $("sockets").textContent = String(sockets);
    if (message.text !== undefined) log(`echoed "${message.text}"`);
  });

  socket.addEventListener("error", () => log("error (the close event carries the detail)"));

  socket.addEventListener("close", (event) => {
    const lasted = openedAt ? `${((performance.now() - openedAt) / 1000).toFixed(1)}s` : "never opened";
    setStatus(`closed ${event.code}`, "closed");
    log(`closed: code ${event.code}, reason "${event.reason}", clean ${event.wasClean}, lasted ${lasted}`);
    openedAt = undefined;
    $("reconnect").hidden = false;
  });
}

function send(fields) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  sent += 1;
  socket.send(JSON.stringify({ n: sent, at: performance.now(), ...fields }));
  return true;
}

setInterval(() => {
  if ($("heartbeat").checked) send({});
}, HEARTBEAT_MS);

setInterval(() => {
  $("uptime").textContent = openedAt ? `${Math.floor((performance.now() - openedAt) / 1000)} s` : "—";
}, 1000);

// The same key handling as 05: every printable key and Backspace is claimed by
// the page. The unknown is whether Discord's client lets them through, and
// whether it minds losing them.
let typed = "";
window.addEventListener("keydown", (event) => {
  const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  const claimed = printable || event.key === "Backspace";
  if (claimed && $("swallow").checked) event.preventDefault();

  if (printable) typed += event.key;
  else if (event.key === "Backspace") typed = typed.slice(0, -1);
  else if (event.key === "Enter" && typed) {
    log(send({ text: typed }) ? `sent "${typed}"` : `not sent, socket is not open`);
    typed = "";
  } else log(`key ${event.key} (not claimed)`);
  $("typed").textContent = typed;
});

async function start() {
  let room = "local";
  if (inDiscord) {
    if (!CLIENT_ID) throw new Error("VITE_DISCORD_CLIENT_ID was not set at build time");
    const discordSdk = new DiscordSDK(CLIENT_ID);
    setStatus("waiting for Discord");
    await discordSdk.ready();
    room = discordSdk.instanceId;
    log(`Discord ready: platform ${discordSdk.platform}, channel ${discordSdk.channelId}`);
  }
  $("room").textContent = room;
  $("reconnect").addEventListener("click", () => connect(room));
  connect(room);
}

start().catch((err) => {
  console.error(err);
  setStatus(err.message ?? String(err), "closed");
  log(`failed: ${err.message ?? err}`);
});
