# Blobspace

A shared isometric room you enter from Discord.

You are a small stick figure. Other people are small stick figures. You can see
them moving around. When someone types, their words appear above their head one
character at a time, drift away and fade out within a few seconds. Nothing is
saved. You cannot edit, delete or scroll back.

The constraint is the point. Speech that is slow to produce, impossible to
revise and gone in four seconds is a different medium to a chat log, and the
interesting question is what people invent to cope with it: abbreviations,
standing in a huddle so the trails overlap, walking away mid-sentence.

## What this document is

This is a spike, not a product. It exists to answer three questions before we
commit to anything:

1. Can character-by-character speech be synchronised between people in a way
   that preserves its timing? The rhythm is the content. If a hesitation does
   not survive the network, the medium is gone.
2. Can several people occupy one space, see each other move, and have it feel
   shared, the way multiplayer cursors do in Figma?
3. Does any of this survive being a Discord Activity, inside Discord's iframe
   and proxy?

The third question is the one that can kill the project outright, so it gets
answered first and with the least code possible.

## Built from

- `../threejs-experiments-01/05-drifting-speech` — the camera, the figure,
  movement, and speech as decaying single characters.
- `../threejs-experiments-01/06-interaction` — proximity, prompts, the
  interactable registry, box collision.
- `../discord-app-experiments-01` — the Embedded App SDK handshake, the OAuth
  token exchange, and a Worker that serves client and API from one origin.

Both Three.js experiments already contain the same scene setup, figure and
movement loop, copied verbatim. Here they move into `src/` and are shared.

## Architecture

```
Browser, inside the Discord iframe
  Three.js world
  local player: input, movement, speech
  remote players: interpolated from snapshots
  Embedded App SDK: identity, guild, channel, instanceId
        │
        │  1. POST /api/token          OAuth code exchange
        │  2. POST /api/ticket         prove identity, get a signed ticket
        │  3. WSS /ws?ticket=…         join the room
        ▼
Cloudflare Worker
  serves the built client
  exchanges the OAuth code, using the client secret
  verifies the access token against discord.com, mints a short-lived ticket
  routes /ws to the Durable Object named after the Activity instance
        │
        ▼
Durable Object: one per Discord Activity instance
  the roster of who is present
  last known position of each
  relays speech and movement to everyone else
```

One room per Discord Activity instance. `instanceId` from the SDK is the room
key, so everyone who launches the same Activity session lands in the same
Durable Object and nobody else does.

### The Durable Object is a relay, not a simulation

It does not own positions, does not validate movement, and runs no physics. It
keeps a roster so a late arrival learns who is already here, and it forwards
messages. Everything else is client-side.

This is the right call for a spike and it should be stated plainly, because the
alternative costs weeks. If people later cheat by teleporting, that is a problem
for a version that has something worth cheating at.

Speech is never stored. It decays in about four seconds, so there is no history
to replay and a joiner needs none. The roster lives in memory and may be lost on
eviction. Clients re-announce themselves, and that is the whole recovery story.

Use the WebSocket Hibernation API, so an idle room costs nothing while people
leave the tab open.

### Identity

The browser must not be able to claim to be someone else. The Embedded App SDK
gives the client an OAuth code. The Worker exchanges it for an access token, and
then calls Discord itself to find out who that token actually belongs to. Only
then does it mint a short-lived signed ticket naming the user and the instance.

The ticket goes in the WebSocket URL, because browsers cannot set headers on a
WebSocket handshake. The Durable Object trusts the ticket and nothing else the
client says about its own identity.

Known limit, acceptable for a spike: a determined person could ask for a ticket
to an instance they are not really in. The consequence is eavesdropping on
ephemeral chatter in a room whose id they had to guess.

## The wire

Two things travel: where you are, and what you are saying.

Clients do not send a message per keystroke. Each client sends one frame on a
fixed tick, around 15 per second, carrying its current position and any
characters typed since the last frame.

```js
// client → room, on a tick, and only when something changed
{
  t: "frame",
  p: [x, z, yaw],                      // omitted if unmoved
  s: [{ c: "h", dt: 0 }, { c: "i", dt: 120 }]   // omitted if silent
}

// room → everyone else, with the sender stamped on by the server
{ t: "frame", id: "<discord user id>", p: [...], s: [...] }

// room → one client, on join
{ t: "hello", you: "<id>", peers: [{ id, name, avatar, p: [...] }] }

// room → everyone
{ t: "joined", id, name, avatar }
{ t: "left", id }
```

`dt` is the milliseconds between one character and the last. That field is the
whole reason this design exists. Send a batched string and every character in it
arrives at once, the trail spawns as a solid block, and the hesitation that made
the sentence feel spoken is destroyed. Carrying the gaps lets the receiving
client replay the typing at its original rhythm.

Remote players are therefore rendered on a delay of about 100 to 150
milliseconds. That buffer does two jobs: it gives batched characters room to be
spread back out at their real spacing, and it lets positions be interpolated
between the last two snapshots instead of teleporting on each one. This is what
makes other people look like they are moving rather than updating.

## Two things in the existing code that break when shared

Both experiments enable `OrbitControls`, and drifting speech computes its
direction from the local camera. Two people at different camera angles would see
the same sentence laid out differently. Lock the camera for the spike.

The glyph cap is a single global limit of 400. It becomes a per-speaker limit.

## Order of work

Each step answers a question, and each is throwaway if the answer is no.

1. **A WebSocket, inside Discord, doing nothing but echoing.** No Three.js. This
   is the highest-risk unknown and roughly a day. If a socket cannot be held open
   through Discord's proxy, we find out now and not after building a world.
2. **Presence.** Two accounts, two dots on a plain floor, moving. The Figma
   question, answered as cheaply as possible.
3. **The real world.** Replace the dots with the figure from `05`, add
   interpolation, make it feel like a room.
4. **Speech, with timing.** Characters cross the network with their gaps intact.
   Two people can talk. This is the payoff.
5. **Optional: one shared object.** A lamp from `06` that anyone can press ENTER
   on, and that everyone sees turn on. It proves world state syncs as well as
   people do, and it is nearly free once the relay exists.

Stop after any step that answers its question badly.

## Out of scope

Discord server configuration of any kind, persistence, accounts outside Discord,
rooms that outlive an Activity instance, voice, an LLM character, physics,
collision between players, mobile, more than about eight people in a room.

## Unknowns to test rather than assume

- **WebSockets through the Discord proxy.** Requests from the iframe generally
  need a `/.proxy/` prefix and a URL mapping in the developer portal. Whether a
  long-lived `wss://` connection survives that path is step one.
- **Keyboard focus inside the iframe.** The speech mechanic needs every printable
  key and the arrow keys. Discord's client may want some of them.
- **Instance sharing.** Confirm that two people launching the Activity in the
  same voice channel really do report the same `instanceId`.
- **Testing at all.** Multiplayer needs a second Discord account or a willing
  friend, plus a tunnel. Worth arranging before step two, not during it.

## What success looks like

Two people, in a Discord voice channel, launch the Activity. They see each other
as figures in the same room. One walks across it. The other watches them walk,
not jump. One types a sentence and pauses in the middle of it. The other watches
the first half drift away and dissolve before the second half arrives.

If that happens, the idea is real and worth building properly.
