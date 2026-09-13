import { DurableObject } from "cloudflare:workers";

// Step one: a room that does nothing but echo. It answers whether a socket can
// be held open through Discord's proxy, and how many sockets share an instance.
export class Room extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    // The Hibernation API: the runtime holds the socket while the object sleeps.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    ws.send(
      JSON.stringify({
        t: "echo",
        of: String(message),
        sockets: this.ctx.getWebSockets().length,
      }),
    );
  }
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
