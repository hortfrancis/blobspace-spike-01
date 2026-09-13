# Progress

Each step is a question. Record the verdict, not the work. Stop at any **no**.

| # | Step | Question | Verdict |
| --- | --- | --- | --- |
| 1 | Echo socket in Discord | Does `wss://` survive the proxy? | yes |
| 2 | Presence | Two dots, moving, feels shared? | — |
| 3 | The real world | Figure + interpolation, reads as a room? | — |
| 4 | Speech with timing | Do the gaps survive the network? | — |
| 5 | Shared lamp (optional) | Does world state sync like people do? | — |

Verdicts: `—` not started · `yes` · `no` · `partly, see log`

## Amended in the spec after review

`dt` counts across frames · `p` every tick while moving, plus a stop frame ·
roster rebuilt from `serializeAttachment` · glyph spacing varies per viewer,
accepted · `06` is pushed and has the lamp, so step five is cheap.

## Log

Surprises, dead ends, anything the spec got wrong. Newest first.

### 2026-09-14 · step one

- `wss://<app id>.discordsays.com/.proxy/ws` works as written. No `patchUrlMappings`,
  and the Worker sees the path as plain `/ws`.
- Held open for 130 s in Discord on the web, in Chrome, round trip around 44 ms.
  The SDK still reports `platform: desktop` there, so it cannot tell web from
  the desktop app, and the app itself is untested. The heartbeat
  was meant to be every 5 s but a bug sent one every second, so the socket was
  never idle. Whether an idle socket survives is still open, and it matters: a
  player standing still and silent sends nothing.
- `instanceId` looks like `i-<instance>-gc-<guild>-<channel>`. Only one account
  so far, so two people sharing it is unconfirmed.
- Typing with `preventDefault()` on printable keys and Backspace reaches the
  page. Whether Discord's own shortcuts still work while it has focus is
  unchecked.
