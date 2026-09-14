# Progress

Each step is a question. Record the verdict, not the work. Stop at any **no**.

| # | Step | Question | Verdict |
| --- | --- | --- | --- |
| 1 | Echo socket in Discord | Does `wss://` survive the proxy? | yes |
| 2 | Presence | Two dots, moving, feels shared? | yes |
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

### 2026-09-14 · step two

- Built on 05's floor and locked camera rather than a flat plane, so the dots
  are spheres with a nose and a name label. Four tabs blobbing about reads as a
  shared room. Remote dots ease towards their last position; the buffered
  interpolation is still step three's.
- An Activity inside Discord and a plain Chrome tab given `?room=<instanceId>`
  land in the same room and see each other. That is the cheap way to have
  company in Discord until there is a second account to test with.
- `instanceId` is new on each launch of the Activity, so the room is too.
- A player standing still sends nothing, so the spec's "positions need no such
  care" was wrong for late arrivals. Each socket's attachment now carries its
  last `p` as well as its name, and `hello` hands those out.
- No identity yet: the room assigns ids and everyone is a guest. The OAuth
  ticket has to land before real people test inside Discord.
- Step three is deferred. The spheres are pleasant enough to talk over, and
  speech with timing is the more interesting question, so step four goes next
  on dots.

### 2026-09-14 · step one

- `wss://<app id>.discordsays.com/.proxy/ws` works as written. No `patchUrlMappings`,
  and the Worker sees the path as plain `/ws`.
- Held open for 130 s in Discord on the web, in Chrome, round trip around 44 ms.
  The SDK still reports `platform: desktop` there, so it cannot tell web from
  the desktop app, and the app itself is untested.
- Idle sockets survive. A script left sockets completely silent for 1, 2, 4, 8
  and 10 minutes, through both `discordsays.com/.proxy/ws` and `workers.dev`, and
  every one still echoed afterwards. A player standing still needs no keepalive.
  The proxy accepts a script's connection without the iframe, which is what made
  this testable from outside Discord.
- Hibernated sockets did not answer a Close frame, despite the compatibility date
  being past `web_socket_auto_reply_to_close`. Clients hung, and the proxy turned
  it into `1006`. `webSocketClose` now replies by hand, mapping 1005 to 1000,
  since a bare `socket.close()` arrives as 1005 and is not a legal code to send.
  Closes are clean through both hosts. Step two's `left` goes in that handler.
- `instanceId` looks like `i-<instance>-gc-<guild>-<channel>`. Only one account
  so far, so two people sharing it is unconfirmed.
- Typing with `preventDefault()` on printable keys and Backspace reaches the
  page. Whether Discord's own shortcuts still work while it has focus is
  unchecked.
