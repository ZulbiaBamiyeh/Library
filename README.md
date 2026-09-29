# Inkbound

An async PvP autobattler where your build is a spellbook. Borrow spells from a candlelit library, bind them into stranger spells at the Binding Desk, spend your winnings on odd curios in the shop next door, and watch your mage read your tome aloud against another mage's ghost on a top-down duel board.

This is the v2 prototype described in the *Inkbound Design Manuscript*: fusion replaces the old modifier grammar, the duel moves to a top-down board, and the new **Curios & Oddments** shop sells staves, trinkets and reagents.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run sim        # headless balance runner: every archetype vs every other
```

Other dev tools:

- `npx tsx tools/matrix.ts 6 4`: head-to-head win matrix for round 6, 4 seeds per matchup
- `npx tsx tools/trace.ts 5 1 2`: readable event log of one bot duel (round, archetype A, archetype B)
- `npx tsx tools/starter.ts`: how a fresh player tome fares against round-1 ghosts
- `/gallery.html?set=units|staves|trinkets` in dev: every 3D model laid out for inspection

## How a run goes

A run is a series of rounds and ends at 10 wins or 4 losses. You start with a single Firebolt and a four-line tome; the tome gains a line at rounds 2, 4, 6, 8 and 10, and ward lines (a spell that fires on a condition) open at rounds 3, 6 and 9. Each round:

1. **The Library** (first person). Spine colour tells the school; thickness hints at rarity; chained books are forbidden (2 Hex at your next duel); glowing books hold a Codex hint. Spend candles to peek, borrow three books. Thick and chained books can hold reagents. Borrowing a spell you own upgrades it to Silver, then Gold.
2. **Curios & Oddments**, through the lit door in the east wall. Madame Verdigris sells one staff and four trinkets each round, plus two reagents. You hold one staff and 2–4 trinkets (more slots at rounds 3 and 6), with a small stash. Sell for half price, reroll the counter for a fee.
3. **The Binding Desk.** One screen: your tome on the left, the binding altar in the middle, the satchel on the right. Drag a spell onto Base (what it *is*) and another onto Infusion (what it's *made of*); the infusion is used up. With only one slot filled, the altar lists what every spell you own would make (undiscovered compounds and legendaries show as ???). Two bindings a round (three from round 6). Reagents apply to the base. Drag works with mouse and touch; tapping a spell and then a slot works too.
4. **The Duel.** A deterministic simulation plays out on a top-down board: projectiles, summons, fields, curse sigils, reactions and legendary callouts. Pause, ½×, 1×, 2×, 4× or skip.

Controls in the library: drag to look, WASD or arrows to walk (a virtual stick on touch), click a book to open it. Walk into the lit doorway or use the button to enter the shop. Space pauses a duel.

## Curios

Around fifty artifacts across four rarities, each a small set of hooks into the simulation. A few examples:

| Curio | Rarity | Effect |
|---|---|---|
| Ruby Chip | Common | Fire spells deal 15% more damage |
| Cinder Chalice | Uncommon | Heal for 30% of the Burning damage your enemies take |
| Salamander Scale | Uncommon | You can't catch fire; Burning meant for you catches the enemy instead |
| Kindled Ruby | Rare | Fire spells cost 30% less ink and hit 25% harder, but each one singes you |
| Gambler's Die | Rare | 1-in-4 spells cast twice, 1-in-12 singe you |
| Heart of the Kiln | Mythic | Enemy Burning never fades below 1 and erupts every 5 s |
| Eye of the Librarian | Mythic | The first once spell the enemy reads is struck out |
| Bottled Eclipse | Mythic | At 30 s, swap every status and curse with the enemy |
| Moebius Staff | Mythic staff | Your first line is read twice |

Reagents (Everburning Ink, Quicksilver, Gilded Thread, Unbinding Knife) are sold in the shop and found in thick or chained books.

## Code layout

```
src/
  data/       spells, fusion rules, codex (statuses, reactions, compounds, legendaries), artifacts
  sim/        the duel simulation (plain TypeScript, no rendering), bots, RNG
  game/       run state, progression, codex persistence (localStorage)
  render/     Three.js: engine and post-processing, library, shop, duel board, models, particles, textures
  ui/         DOM screens: title, library, shop, desk, duel, codex
tools/        headless balance and trace runners
```

The hard rule from the manuscript holds: `src/sim` imports no Three.js. It takes two tomes and a seed and returns an event log plus state snapshots; the board only plays that log back. The same tomes and seed always produce the same fight, which is what makes ghosts, replays and the balance runner work. Every model and texture is procedural, so there are no binary assets.
