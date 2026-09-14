# Tests

The scripts that verified the spike. Each is a plain Node script, not a test
framework: it prints `PASS` and `FAIL` lines and exits non-zero on a failure.
Every test makes its own randomly named room, so tests never meet each other or
anyone using the app.

## Room: the protocol over raw WebSockets

Fast, and no browser. Point them at `npm run dev`, the deployed Worker, or
Discord's proxy, which accepts a script's connection without the iframe.

| Script | Checks |
| --- | --- |
| `room/presence.mjs` | `hello` with who is here and where, `joined`, `left`, frame relay stamped with the sender's id and never echoed, malformed frames dropped, clean closes. |
| `room/speech.mjs` | Characters and gaps relayed exactly, speech-only frames, position and speech together, malformed parts dropped one at a time. |
| `room/lamp.mjs` | Everyone hears a change, the asker included; late arrivals are told; simultaneous requests agree everywhere; two "on"s leave it on; it survives an empty room. |
| `room/send-times.mjs` | `ts` is relayed only beside `p`, dropped when malformed, and never stored. |

```sh
npm run test:room
WS_URL=wss://blobspace-spike-01.alex-hortfrancis.workers.dev/ws npm run test:room
WS_URL=wss://<application id>.discordsays.com/.proxy/ws npm run test:room
```

## Browser: real tabs in headless Chromium

| Script | Checks |
| --- | --- |
| `browser/presence.mjs` | Two tabs see each other, with "(you)" on their own figure; closing one removes it from the other. |
| `browser/speech-timing.mjs` | One tab types "hello world" with hesitations; the other records when each glyph appears, and the gaps are compared. |
| `browser/lamp.mjs` | Steers a tab to the lamp by watching its positions in the room, switches it on and off, checks nobody out of reach is offered it. |
| `browser/walk.mjs` | Reads, every frame, where a second tab draws a walker and compares it with where her positions put her on her own clock; also checks her speed stays even. |

```sh
npm run test:browser
APP_URL=https://blobspace-spike-01.alex-hortfrancis.workers.dev/ npm run test:browser
```

They need a Chromium that `playwright-core` can drive: install the one it
expects with `npx playwright-core install chromium --only-shell`, or point
`CHROMIUM_PATH` at another Chromium binary.
Screenshots land in `tests/out/`, which git ignores.

**Reading the results.** Headless Chromium renders the scene in software, so
frames come 20 to 200 ms apart depending on how busy the machine is, including
anything running on the host. Timing checks are only as fine as those frames.
Run browser tests one at a time, and treat a failure in `walk.mjs`'s evenness
check with suspicion if the output shows the sender's own steps stalling. Its
fidelity check, where bob draws alice, holds regardless.

## Older

- `step-one/echo.mjs`, `step-one/idle.mjs`: step one's echo room, which no longer
  exists. `idle.mjs` left sockets silent for up to ten minutes through both hosts.
- `tools/label-probe.mjs`: prints one tab's frame gaps and label transforms,
  which is how the walk test learned to read positions off the page.
