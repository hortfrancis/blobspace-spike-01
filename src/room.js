// The socket to the room, reconnecting when it drops. A deploy drops every
// socket, so without this each deploy means reloading every tab.

export function joinRoom({ room, name, inDiscord, onMessage, onStatus }) {
  // Inside Discord every request goes through its proxy under /.proxy/.
  const path = inDiscord ? "/.proxy/ws" : "/ws";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ room, name });
  const url = `${scheme}://${location.host}${path}?${query}`;

  let socket;
  let retryMs = 1000;

  function open() {
    onStatus("connecting");
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      retryMs = 1000;
      onStatus("connected");
    });

    socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));

    socket.addEventListener("close", (event) => {
      onStatus(`disconnected (${event.code}), retrying in ${retryMs / 1000} s`);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    });
  }

  open();

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
}
