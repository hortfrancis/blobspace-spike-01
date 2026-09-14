import { DurableObject } from "cloudflare:workers";

// One room per Discord Activity instance. For people it is a relay, not a
// simulation: it remembers who is here and where they last stood, so a late
// arrival can be told, and forwards everything else. Speech is never stored.
//
// For the world it is the authority. Two people can reach for the lamp at
// once, so the room decides what state it is in and tells everyone, and keeps
// that state in storage, since hibernation would otherwise forget it.
export class Room extends DurableObject {
  async fetch(request) {
    const name = (new URL(request.url).searchParams.get("name") ?? "").trim().slice(0, 32) || "guest";
    const [client, server] = Object.values(new WebSocketPair());

    // The Hibernation API: the runtime holds the socket while the object sleeps.
    this.ctx.acceptWebSocket(server);

    // Hibernation empties memory, so each player's details live on their own
    // socket and the roster is rebuilt from getWebSockets() whenever needed.
    // Until Discord identity arrives, the room assigns the id itself.
    const me = { id: crypto.randomUUID(), name, p: null };
    server.serializeAttachment(me);

    const peers = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean);

    const world = { lamp: (await this.ctx.storage.get("lamp")) ?? false };

    server.send(JSON.stringify({ t: "hello", you: me.id, peers, world }));
    this.broadcast({ t: "joined", id: me.id, name: me.name }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const me = ws.deserializeAttachment();

    // A request for the lamp to be on or off. Asking for a state rather than a
    // flip means two people pressing at once to turn it on leaves it on. Sent
    // back to the asker as well, so every tab ends on the room's answer.
    if (parsed?.t === "lamp") {
      if (typeof parsed.on !== "boolean") return;
      await this.ctx.storage.put("lamp", parsed.on);
      this.broadcast({ t: "lamp", on: parsed.on, by: me.id });
      return;
    }

    if (parsed?.t !== "frame") return;

    // A frame carries a position while moving, speech while talking, or both.
    // Whichever part is malformed is dropped on its own.
    const p = isPosition(parsed.p) ? parsed.p : undefined;
    const s = isSpeech(parsed.s) ? parsed.s : undefined;
    if (!p && !s) return;
    // When the sender says the position was true, on its own clock. It only
    // means anything beside a position, and listeners use it for nothing but
    // spacing that player's walk.
    const ts = p && Number.isFinite(parsed.ts) && parsed.ts >= 0 ? parsed.ts : undefined;

    // A player standing still sends nothing, so the last position has to be
    // kept for anyone who joins while they stand there.
    if (p) {
      me.p = p;
      ws.serializeAttachment(me);
    }

    this.broadcast({ t: "frame", id: me.id, p, ts, s }, ws);
  }

  // Deployed with compatibility date 2026-09-11, a hibernated socket got no
  // reply to its Close frame: clients waited, and Discord's proxy gave up with
  // 1006. web_socket_auto_reply_to_close did not cover it, so reply by hand.
  // 1005, 1006 and 1015 describe a close but may not be sent in one, and a
  // bare socket.close() in the browser arrives here as 1005.
  async webSocketClose(ws, code, reason) {
    ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
    this.leave(ws);
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  // Can run twice for one socket, after an error and then a close. Clients
  // ignore a `left` for someone they have already removed.
  leave(ws) {
    const me = ws.deserializeAttachment();
    if (me) this.broadcast({ t: "left", id: me.id }, ws);
  }

  broadcast(message, except) {
    const json = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(json);
      } catch {
        // Already closing. Its own close event will tidy it up.
      }
    }
  }
}

function isPosition(p) {
  return Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
}

// Characters with the milliseconds since the one before. The first character
// of a session has nothing to measure from, so its gap is null. A frame covers
// a fifteenth of a second, so 64 characters is far more than anyone can type.
function isSpeech(s) {
  return (
    Array.isArray(s) &&
    s.length > 0 &&
    s.length <= 64 &&
    s.every(
      (item) =>
        typeof item?.c === "string" &&
        item.c.length > 0 &&
        item.c.length <= 2 &&
        (item.dt === null || (Number.isFinite(item.dt) && item.dt >= 0)),
    )
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade") === "websocket";

    if (url.pathname === "/ws") {
      if (!upgrade) {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const room = url.searchParams.get("room");
      if (!room || room.length > 128) {
        return new Response("Expected ?room=<instanceId>", { status: 400 });
      }
      return env.ROOMS.getByName(room).fetch(request);
    }

    // If Discord's proxy forwards the socket somewhere other than /ws, say so
    // in `wrangler tail` rather than failing silently as a 404.
    if (upgrade) console.warn("WebSocket upgrade on unexpected path", url.pathname);

    return env.ASSETS.fetch(request);
  },
};
