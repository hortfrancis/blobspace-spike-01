# Blobspace

A Discord Activity that turns a small part of a Discord server into a place you
can walk around in.

You launch it from Discord, appear as a character in an isometric room, and find
the server's text channels standing there as labelled doors. In the corner is a
machine with a lever. Pull it, type a name, and the machine makes a new door
while Discord's sidebar gains the channel at the same moment.

That is the whole idea: Discord configuration stops being a settings screen and
becomes a thing in a room that more than one person is standing in.

## The one loop to build

```
Alex launches the Activity
        ↓
walks to the channel machine
        ↓
pulls the lever, types "frog-discussion"
        ↓
the machine animates, a door appears
        ↓
Discord's sidebar gains #frog-discussion
        ↓
Maya, standing in the same room, sees the door appear too
```

Everything else is later. If this loop works, the concept is proved.

## What it is built from

Two sibling repos, combined rather than rewritten:

- `../threejs-experiments-01/05-drifting-speech` — isometric camera, the figure,
  movement, and speech as single characters that drift and decay. Speech stays
  spatial. It is not a chat panel and it does not become a Discord message.
- `../threejs-experiments-01/06-interaction` — the interactable registry, where a
  thing declares a reach, a label and an `onInteract`, plus proximity prompts,
  panels and box collision. A channel door is a new entry in that registry.
- `../discord-app-experiments-01` — the Embedded App SDK handshake, the OAuth
  token exchange, and a Cloudflare Worker that serves the client and the API
  from one origin.

The scene setup, the figure and the movement loop have now been copied through
four experiments, so they move into `src/` here rather than being pasted again.

## Architecture

```
Browser (Discord iframe)
  Three.js world, speech, interaction
  Embedded App SDK for identity and context
        │
        │ HTTP for mutations, WebSocket for the room
        ▼
Cloudflare Worker + a Durable Object per Activity instance
  OAuth token exchange
  channel read and create, via the bot
  presence, positions and world events
        │
        ▼
Discord HTTP API
```

The client secret and the bot token live only in Worker secrets.

The Durable Object is in the first build, not deferred. Without it the room is
not shared: other people stand still at made-up positions, and a door one person
creates is invisible to everyone else until they reload. A shared room is the
entire claim.

## Authorization

Two separate questions. Discord OAuth says who the user is. The bot's own
permissions say what the app is able to change. Neither answers whether *this*
user should be allowed to pull the lever.

The Worker decides that itself, on every mutating request, by checking the
calling member's guild permissions through the bot. It never trusts a permission
claim sent from the browser. For now the rule is simply: you need Manage
Channels to use a control that changes the server.

Note that creating a channel is a guild-level permission, so the SDK's
channel-scoped permission call is the wrong check even on the client.

## Done when

1. The world loads as a Discord Activity, and the authenticated user is in it.
2. Existing text channels appear as labelled doors.
3. Two people in the same instance see each other move.
4. Typing produces drifting spatial speech.
5. The lever creates a real Discord channel, and a door appears for everyone in
   the room without a reload.
6. A user without Manage Channels is refused by the Worker, and the machine says
   so in the world rather than failing silently.
7. No secret reaches the browser.

## Not now

Rename and permission levers, roles, categories, voice channels, threads, an LLM
host, persistent custom layouts, physics, inventory, posting speech to Discord as
real messages.

Rename in particular is worth avoiding early: Discord allows a channel two name
changes per ten minutes, and a lever that quietly stops working is a bad
demonstration.

## Known hazards

- **The proxy prefix.** Discord's iframe proxy generally expects app requests to
  be prefixed with `/.proxy/`. Confirm what actually works before building four
  routes on the assumption.
- **Keyboard modes.** The speech handler swallows every printable key. Naming a
  channel needs an explicit input mode or the name sprays into the air.
- **The bot may not be there.** Activity availability and bot membership are
  separate installs. The machine needs a sane state for "here but not wired up".
- **Failure is physical.** Latency, rate limits and refusals all need a visible
  form. The machine jams, and the panel on it says why.

## Design rule

If every object opens a conventional form, this is Discord settings with extra
walking. Some plain UI is fine for typing a name. Everything else should be:
walk up, select, operate, watch something happen.
