// Obsolete: it relies on step one's echo, and its two hosts are hard-coded. Kept as a record of step one.
// Opens silent sockets through each host and, after a set idle time, sends one
// message to see whether the socket is still alive. Sockets that close early
// are logged with their code and how long they lasted.
const hosts = {
  discord: "wss://1548832871106613318.discordsays.com/.proxy/ws",
  workers: "wss://blobspace-spike-01.alex-hortfrancis.workers.dev/ws",
};
const probeAfterSeconds = [60, 120, 240, 480, 600];

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s`;
const say = (line) => console.log(`${stamp()}  ${line}`);

function run(hostName, url, idle) {
  return new Promise((resolve) => {
    const label = `${hostName.padEnd(7)} idle ${String(idle).padStart(3)}s`;
    const ws = new WebSocket(`${url}?room=idle-probe-${hostName}-${idle}`);
    let openedAt;
    let phase = "connecting";
    let done = false;
    const finish = (result) => { if (!done) { done = true; say(`${label}  ${result}`); resolve({ label, result }); } };

    ws.onopen = () => {
      openedAt = Date.now();
      phase = "first-echo";
      ws.send(JSON.stringify({ n: 0 }));
    };
    ws.onmessage = () => {
      if (phase === "first-echo") {
        phase = "idle";
        setTimeout(() => {
          phase = "probe";
          ws.send(JSON.stringify({ n: 1 }));
          setTimeout(() => finish("FAIL: no echo within 10s of the probe"), 10000);
        }, idle * 1000);
      } else if (phase === "probe") {
        phase = "closing";
        ws.close(1000, "done");
        setTimeout(() => finish("PASS: alive after idle; no close event within 10s of close()"), 10000);
      }
    };
    ws.onclose = (e) => {
      const lasted = openedAt ? `${((Date.now() - openedAt) / 1000).toFixed(1)}s` : "never opened";
      if (phase === "closing") finish(`PASS: alive after idle; our close() ended with code ${e.code} "${e.reason}"`);
      else finish(`FAIL: closed during ${phase}, code ${e.code} "${e.reason}", lasted ${lasted}`);
    };
    ws.onerror = () => {};
  });
}

say(`starting ${probeAfterSeconds.length * 2} sockets`);
const results = await Promise.all(
  Object.entries(hosts).flatMap(([name, url]) => probeAfterSeconds.map((idle) => run(name, url, idle))),
);
console.log("\nsummary");
for (const { label, result } of results) console.log(`  ${label}  ${result}`);
process.exit(0);
