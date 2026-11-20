# Cobalt Hush: Live — Design

*2026-11-19 · approved*

## Intent
Turn the still Cobalt Hush illustration into a living collectible you play with. It's mainly for you, and maybe for friends if you love it. It should feel like a real, slightly shy little creature that becomes yours over time. It should be endearing because of how it behaves, not because it looks like a cartoon. The finish should be premium, like a polished product, not a toy.

## Goals
- The spider reacts believably to the cursor or a finger: alert, twitch, startle, flee, hide, come back.
- A misty, glowing, glassy look you can change: **Solid → Translucent → Ghost** (nearly transparent).
- **Lights on / off.** Day is a bright white deck with soft shadows. At night the spider is the main light source.
- **Feed it.** Food gets dropped, stalked and eaten.
- **A plain white deck** with spots spiders love to hide in.
- **Trust that grows**, **Silk & vibration**, and **Moulting keepsakes** (your three picks).
- Feels smooth on a laptop and a decent phone. Works with touch.

## Non-goals (v1)
- Sound. It could come later.
- Several spiders, or friends playing together live.
- Camera or hand tracking.

## Anti-goals (a failure even if it "works")
- A cartoon look: big eyes, smiles, bouncy squash-and-stretch.
- Creepy jump-scares: lunging at the cursor, fast swarming movement.
- A cluttered deck, or a screen full of UI.
- Choppy movement on phones.

## Approaches considered
1. **Real 3D scene seen from above (three.js)**: real bloom, mist, glass materials and shadows. More work. **← Your pick.**
2. Flat 2D canvas with layered glow: lighter, but mist and translucency look painted on, and the night mode is weak.
3. Rebuild inside the existing design board: dropped. That tool makes still layouts, not real-time creatures.

## What you'll see
```
┌──────────────────────────────────────────────┐
│                                      ◌ trust │
│    ▢ bark curl          ·  ·                 │
│                    ╲ ╱  ·      ◯ stone       │
│        ≈ moss    ──(◆)──   ·                 │
│                    ╱ ╲        silk ~~~       │
│   ⌒ leaf litter          ◇ old moult         │
│                 ○ hollow twig                │
│                                              │
│ [☀ Lights] [◉ Feed] [◐ Solid] [⇄ Lure|Steer] [◇ 3] │
└──────────────────────────────────────────────┘
```
- The camera looks down at about 55°, like peering into a terrarium. It shows the whole deck, with gentle depth.
- One slim glass toolbar at the bottom, with five controls: Lights, Feed, Material, Lure/Steer, and Moult collection (with a count). A faint trust ring sits in the top corner.
- The title "COBALT HUSH" in Orbitron appears briefly on load, then fades away. The UI uses a clean sans-serif font.

## The spider
- **Built in code, not a 3D model file.** It keeps your original's look: a cobalt cephalothorax (front body section) and abdomen, amber-banded legs, cyan-glowing joints, and the hexagonal gem window with slowly turning gears inside.
- **It walks properly.** Each leg finds its own footing (2-bone IK), and it uses a real spider gait: alternating sets of four legs. The pedipalps (small front feelers) tap the ground as it explores.
- **Materials:** physical glass-like material with transmission, clearcoat and fresnel edge light. Joints and the gem glow. A soft mist of particles drifts around the body and thickens at night.
- **Material control:** Solid, then Translucent (glassy, gears visible through the body), then Ghost (mostly mist and glow).

## Behaviour (reactions)
| You do | It does |
|---|---|
| Cursor approaches slowly | Pauses, raises its front legs, turns to "look" |
| Cursor approaches fast | Startles and flees to the nearest hiding spot. How far it runs depends on trust |
| Touch or poke it | A sharp twitch, sometimes a small hop back. Repeated pokes make it hide and cost trust |
| Leave it alone | It wanders, grooms its legs, lays silk, explores hiding spots |
| Hold still near it (high trust) | It approaches, taps your cursor with its pedipalps, and may climb on and ride along |

Its movement is quick but never lunging. Timing is based on real tarantulas: still, still, then a short burst.

## Lights
- **On:** a white matte deck with soft daylight and gentle contact shadows. The glow is subtle.
- **Off:** the deck goes deep blue-black. The spider's glow lights the deck around it, and silk threads and old moults catch its light. Bloom is stronger.
- The change fades over about 1.5 seconds. The spider also reacts: it pauses briefly when the lights change.

## Moving it around: a toggle between Lure and Steer (your pick)
A **Lure / Steer** switch sits in the toolbar. It starts on Lure and remembers your choice.

**Lure (gentle)**
- Press and hold an empty spot on the deck. A small soft light blooms there and stays while you hold.
- How it responds depends on trust. **Shy:** it hesitates, then takes a careful route from cover to cover. **Settled:** it walks straight over. **Bonded:** it goes there readily and waits by the light.
- A quick tap on the deck is not a lure (it's used for food and silk), so you won't call it by accident.

**Steer (direct)**
- Drag anywhere on the deck and it walks toward your finger or cursor. On desktop, WASD or the arrow keys also work.
- Startle and flee reactions are muted while you steer, so it doesn't run from the thing steering it. Poking it still makes it twitch.
- Trust still shows: a shy spider follows slowly with small pauses, and a bonded one moves fluidly.
- It walks around hiding spots and climbs over silk. It can step into a hiding spot if you steer it there.

## Feeding
- Tap **Feed**, then tap the deck to drop food: a small glowing moth-like mote that flutters weakly. It's abstract and elegant, not a realistic bug.
- The spider senses the food, stalks it, pauses, pounces, then eats (its abdomen pulses gently and the gem brightens).
- Feeding is the biggest trust boost. Overfeeding is gently capped: it ignores food when full.

## Hiding spots (the deck)
- The deck stays plain white. Hiding spots are made as **matte white ceramic shapes**: a bark curl, a smooth stone with an overhang, a leaf-litter pile, a moss tuft, and a hollow twig or tube. Together they look like a sculpture set, not a busy terrarium.
- When scared, the spider runs into the nearest one and only its legs stay visible. It peeks out after a few seconds; the higher the trust, the sooner.
- 5 spots, laid out the same way every time so the deck feels like its home.

## Trust that grows
- Trust runs from 0 to 100. Feeding, slow gentle movement, and time spent near it raise it. Fast swipes and repeated pokes lower it, but it never drops to zero after being earned. It has a floor.
- What changes as trust grows: it runs less far, comes back sooner, approaches you, and finally climbs onto your cursor.
- Shown only as the faint ring in the top corner, plus how it acts.

## Silk & vibration
- As it walks, it leaves a faint dragline (a single trailing thread), which fades over time.
- If left alone near a hiding spot, it slowly builds a **silk mat with tripwire threads** around it. This is true to tarantulas, which lay silk mats rather than orb webs. The silk stays.
- Tap a thread and a ripple runs along it. The spider senses the vibration and comes to check, the way it would hunt.

## Moulting keepsakes
- About every 12–15 minutes of active play (my estimate, to be tuned), it moults. It goes still, rolls onto its back (as real tarantulas do), and slowly slips out of its old skin.
- The **old exoskeleton stays on the deck** as a translucent ghost shell. The new skin comes out a slightly different shade within the cobalt family (sapphire, indigo, ice-blue, violet-cobalt…).
- The ◇ collection lists each moult with its shade and date. At most 6 shells sit on the deck; older ones stay in the collection.

## Saving and sharing
- Saved per person: trust, silk, moults, the current shade and settings. If a friend opens your link, they get **their own** spider starting from shy, and yours stays yours.
- If saving isn't available (some viewers), it still works fully, just without memory.

## Build & delivery
- three.js, loaded from an allowed CDN, with bloom post-processing and soft shadows.
- Published as a **new private artifact**, "Cobalt Hush — Live". Your original design board stays untouched.
- **Phones:** quality drops automatically (bloom resolution, fewer mist particles, simpler shadows) when frame time slips. It respects "reduce motion".

## Left to the builder
Exact tuning: speeds, distances, trust rates, glow strengths, moult timing, and the precise hiding-spot shapes.
