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
- `npx tsx tools/fuzz.ts 3000 1`: random tomes, fusions and curios, checking for crashes and runaway duels
- `/gallery.html?set=units|staves|trinkets` in dev: every 3D model laid out for inspection

## How a run goes

A run is a series of rounds and ends at 10 wins or 4 losses. You start with a single Firebolt and a four-line tome; the tome gains a line at rounds 2, 4, 6, 8 and 10, and ward lines (a spell that fires on a condition) open at rounds 3, 6 and 9. Each round:

1. **The Library** (first person). Spine colour tells the school; thickness hints at rarity; chained books are forbidden (2 Hex at your next duel); glowing books hold a Codex hint. Spend candles to peek, borrow three books. Thick and chained books can hold reagents. Borrowing a spell you own upgrades it to Silver, then Gold.
2. **Curios & Oddments**, through the lit door in the east wall. Madame Verdigris sells one staff and four trinkets each round, plus two reagents. You hold one staff and 2–4 trinkets (more slots at rounds 3 and 6), with a small stash. Sell for half price, reroll the counter for a fee.
3. **The Binding Desk.** One screen: your tome on the left, the binding altar in the middle, the satchel on the right. Drag a spell onto Base (what it *is*) and another onto Infusion (what it's *made of*); the infusion is used up. With only one slot filled, the altar lists what every spell you own would make (undiscovered compounds and legendaries show as ???). Two bindings a round (three from round 6). Reagents apply to the base. Drag works with mouse and touch; tapping a spell and then a slot works too.
4. **The Duel.** Walk through the glowing arch in the library's west wall (or use the Duelling Ring button, or the desk's duel button). A deterministic simulation plays out on a top-down board: projectiles, summons, fields, curse sigils, reactions and legendary callouts. Pause, ½×, 1×, 2×, 4× or skip. The result sheet breaks down damage dealt, damage taken and healing by source (spell, summon, status, curse, field, reaction or curio), for you and for your opponent.

Controls in the library: drag to look, WASD or arrows to walk (a virtual stick on touch), click a book to open it. Walk into the lit doorway in the east wall to enter the shop, or through the arch in the west wall to duel. Space pauses a duel.

## Spells and combos

There are 86 spells across eight schools and nine forms (bolt, burst, summon, field, curse, aura, blessing, hex, ward). When you bind two spells, three layers of combination can apply:

- **Reactions** (11) happen on the board when statuses meet, whoever applied them. Examples: Wet + Chill freezes, Oil + Burning blazes, fire on a frozen target cracks the ice (Thermal Shock), and 10 Charge overloads.
- **Compounds** (28) happen when a spell carries two essences. Examples: Magma (fire + stone) hits heavy and scorches every summon; Obsidian (stone + shadow) strikes again 2 s later; Void (shadow + arcane) strips a ward or aura; Prism (holy + arcane) splits the hit across every other enemy.
- **Legendaries** (18) are exact four-part recipes, such as Supernova, Absolute Zero, Black Death, Thor's Anvil, the Endless Library, Hydra, Total Eclipse and the Phoenix Lord.

Some two-spell bindings have their own behaviour: Imp + Imp is an Imp Gang, Counterspell + Plagiarize steals the enemy's spell, Sanctuary + Mirror is a Hall of Mirrors, Deep Freeze + Stone shatters, Polymorph + Plague Rat turns the enemy into a rat, and Doom + Echo falls twice.

A few of the stranger spells:

| Spell | Form | Effect |
|---|---|---|
| Phoenix Egg | Summon | Hatches after 6 s; the Phoenix falls back into an egg once |
| Leech | Summon | Latches onto the enemy mage and drains them until killed |
| Tesla Coil | Summon | Zaps whichever enemy carries the most Charge |
| Shadow Clone | Summon | Recasts every endless spell you cast at 40% |
| Wildfire | Field | Burning spreads from enemy to enemy |
| Curse of Echoes | Curse | A third of the damage their spells deal comes back to them |
| Time Warp | Hex | Their current line starts over |
| Martyrdom | Blessing | Lose 10 health; your next spell hits twice as hard |
| Wild Magic | Blessing | Casts a random spell from the library |
| Duplicate | Aura | Your next four bolts are cast twice |

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
