# Cobalt Hush: Live

An interactive collectible: a glassy cobalt tarantula on a white ceramic deck that reacts to your cursor or touch. You can feed it, lure or steer it, switch the lights, and over time it builds trust, lays silk and moults into new shades of cobalt.

Built with three.js (bundled under `vendor/three/`, so the page loads nothing from outside except Google Fonts).

## Play

- **Published (private) page:** https://claude.ai/artifact/5tfZp9EogZvQW1EEhmp15p
- **Locally:** run `node tools/serve.mjs`, then open http://localhost:4173

## Controls

| Action | What happens |
|---|---|
| Move near it slowly | It pauses, raises its front legs, watches you |
| Move fast near it | It startles and flees (how far depends on trust) |
| Tap it | A twitch; three pokes in a row and it hides |
| **Lights** | Day (white deck, no glow) ↔ night (it glows) |
| **Feed**, then tap the deck | Drops a moth; it stalks, pounces and eats |
| **Lure**: press and hold the deck | A soft light it walks to when it trusts you |
| **Steer**: drag, or WASD / arrow keys | Walk it anywhere, including into a hiding spot |
| **Solid / Translucent / Ghost** | Changes the material |
| **Moults** | Your collection of shed shells |

## Develop

```bash
npm install          # three.js for the vendor step and tests
npm test             # 136 unit tests (node --test)
npm run e2e          # browser smoke test (Playwright + Chromium)
```

- Design: `docs/superpowers/specs/2026-11-19-cobalt-hush-live-design.md`
- Plan: `docs/superpowers/plans/2026-11-19-cobalt-hush-live.md`
- Every build decision: `docs/superpowers/plans/build-ledger.md`
