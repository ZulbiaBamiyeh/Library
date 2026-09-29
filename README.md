# Inkbound

An async PvP autobattler where your build is a spellbook. Borrow spells from a candlelit library, bind them into stranger spells at the Binding Desk, spend your winnings on odd curios in the shop next door, and watch your mage read your tome aloud against another mage's ghost on a top-down duel board.

This is the v2 prototype described in the *Inkbound Design Manuscript*: fusion replaces the old modifier grammar, the duel moves to a top-down board, and the new **Curios & Oddments** shop sells staves, trinkets and reagents.

Play it in the browser: https://zulbiabamiyeh.github.io/Library/ (built by `.github/workflows/pages.yml` on every push and served from the `gh-pages` branch).

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

1. **The Library** (first person). Spine colour tells the school; thickness hints at rarity; chained books are forbidden (2 Hex at your next duel); glowing books hold a Codex hint. Each round you have **one candle**, to peek inside one book before choosing a spell from it, and **two books** to borrow; any other book you can still borrow blind (one of its spells at random). The Everlasting Candle Stub, sold in the Curio Shop, gives a second candle. Thick and chained books can hold reagents. Borrowing a spell you own upgrades it to Silver, then Gold. Every book you borrow ends up on your own bookcase in your study.

   **The Reading Room** is a tall hall with rows of bookcases down the middle and two galleries above, cased in books floor to ceiling, with armchairs in the corners, banners on the rails and chandeliers in the open middle. A stair up each side wall reaches the first gallery, and a flight along the south side climbs to the second. The Curio Shop's door and the Duelling Ring's arch are on the south wall, either side of the Binding Desk; a great arch in the north wall leads to the stair tower.

   **The depths.** The library is one building. The stair tower, through the Reading Room's north arch, drops through seven floors below it. Walk down the broad spiral stair, one turn per floor, with a bookcase winding down its outer edge; or step off its inner edge (or jump the rail) and fall through as many floors as you like. Out in the wings, smaller spiral stairs wind round stone columns from one floor down to the next, so there is more than one way down (and back up). Each floor below is a warren grown out from the stair hall: wings, low winding corridors, tall galleries, dead ends and cramped alcoves, bigger the deeper you go (the bottom floor is about 150 units across). Some wings are only reached through a crawlspace: walk into the low opening and you duck into it, and it leads to a hidden room piled with loose heaps of books. The further a wing is from the stair, the stranger it gets: rows stop keeping straight, books drift off their shelves, and the spine colours go wrong. Tall rooms have balconies along a wall, reached by a stair, with more books above and an armchair at the end; other rooms have a raised reading platform in the middle. The plans are fixed, so a reader can learn them. Nothing is captioned: each wing keeps to one school of magic, deeper floors let rarer strays onto the shelves, and the fourteen **ancient spells** hide mostly in far-off wings, little alcoves and the heaps in hidden rooms. Five **shopkeepers** hide in the depths, one each on five of the floors, always in the furthest hidden room that floor has, usually behind a crawlspace: a little red imp among rubies and braziers in the Lower Stacks, a skeleton under a ribcage arch in the Ossuary, a frost lich among ice crystals in the Drowned Archive, a book mimic ringed by flying books in the Inverse Stacks, and the Author at a desk drowned in paper in the Unwritten. Each sells two **oddities** nobody else sells (see below) and one curio of its own schools, restocked every round; the imp's wares are all red. Only the floor you are on is drawn, plus its neighbours when you are near the stairwell, and only the blocks of shelves near you; fog swallows the rest. Going to the desk and back brings you up to the Reading Room.

   | Ancient spell | Found from | Effect |
   |---|---|---|
   | Erratum | Lower Stacks | Their next spell is misprinted: a random spell is cast in its place, as theirs |
   | Candle That Burns Backwards | Lower Stacks | Burning on you heals you instead |
   | Book Mimic | Lower Stacks | A biting book that swallows spells aimed at you and bites the caster back |
   | Palimpsest | Ossuary Shelves | Scrape their next line off their page and cast it as yours |
   | The Hungry Margin | Ossuary Shelves | They read slower and pay extra ink, which you drink |
   | Tongue of the Drowned King | Drowned Archive | Every fifth line they read, they drown for 25 |
   | Bookworm | Root Cellar | Eats uses out of their tome |
   | Reverse Grammar | Drowned Archive | For 8 s their damage heals you and their healing hurts them |
   | Anagram | Inverse Stacks | Shuffles their whole tome and makes them start again |
   | Sigil of Unmaking | Inverse Stacks | After 14 s, erases their costliest endless line for the rest of the duel |
   | The Author | Inverse Stacks | A scribe that casts a random spell for you every 5 s |
   | Final Chapter | The Unwritten | Damage every second, growing without limit until cleansed |
   | Thing Between the Shelves | The Unwritten | Swallows enemy summons whole |
   | Ouroboros Verse | Stopped Clocks | Every spent line in your tome gets a use back |
2. **Curios & Oddments**, a room you walk into through the lit doorway in the east wall of the Reading Room. Madame Verdigris sells one staff and four trinkets each round, plus two reagents, laid out on her counter with their prices; click one to buy it. You hold one staff and 2–4 trinkets (more slots at rounds 3 and 6), with a small stash. Press I (or the Curios button) to equip and stash curios anywhere, and inside a shop to sell them for half price; in the Curio Shop you can also reroll the counter for a fee.
3. **The Binding Desk.** Click the desk in the Reading Room and you step sideways into **your study**, a small warm room folded away somewhere else, which you walk round like the library: a fire and a sleeping cat, an armchair and tea, candles floating under the beams, a round window onto the stars. Your staff stands by a glass cabinet that holds your trinkets and stash, your reagents sit in jars on the desk, and every book you have borrowed is on your bookcase by the door. Look at anything to see its name; click a curio to read it. Click the desk to sit down and bind; Esc or *Leave the desk* gets you up again, and the shimmering doorway takes you back to the library. At the desk: your tome on the left, the altar in the middle, the satchel on the right. Drag a spell onto Base (what it *is*) and another onto Infusion (what it's *made of*); the infusion is used up. With only one slot filled, the altar lists what every spell you own would make (undiscovered compounds and legendaries show as ???). Two bindings a round (three from round 6). Reagents apply to the base. Drag works with mouse and touch; tapping a spell and then a slot works too. Hover any spell (in the tome, satchel, altar, or the list of possible bindings) to read its full card; on touch, tap it and the card appears beside the satchel.
4. **The Duel.** Walk through the glowing arch in the library's west wall (or use the Duelling Ring button, or the desk's duel button). A deterministic simulation plays out on a top-down board: projectiles, summons, fields, curse sigils, reactions and legendary callouts. Pause, ½×, 1×, 2×, 4× or skip. The result sheet breaks down damage dealt, damage taken and healing by source (spell, summon, status, curse, field, reaction or curio), for you and for your opponent.

Controls in the library: on a computer, click once to capture the mouse and move it to look (Esc frees it); WASD or arrows to walk, Shift to run, Space to jump, C or Ctrl to crouch, I for your curios, click to open the book (or buy the curio) under the crosshair. On touch, drag to look, use the virtual stick to walk and the Crouch button to duck. The Graphics button at the bottom of the screen switches between auto, high, medium and low; auto starts high and steps down by itself if the frame rate stays low. Lower settings render at a lower resolution, drop anti-aliasing and bloom, use fewer candle lights, and draw less of the library before the fog. Walk through the shop door or the Ring's arch on the south wall of the Reading Room. Space pauses a duel.

## Spells and combos

There are 86 spells on the ordinary shelves (plus the 14 ancient ones in the depths) across eight schools and nine forms (bolt, burst, summon, field, curse, aura, blessing, hex, ward). When you bind two spells, three layers of combination can apply:

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

The hidden shopkeepers sell sixteen **oddities** that the Curio Shop never stocks (the imp has the fire ones; the skeleton the shadow and venom ones; the lich frost and storm; the mimic arcane and stone; the Author holy and arcane):

| Oddity | School | Effect |
|---|---|---|
| The Imp's Tinderbox | Fire | Every 6 s, the enemy catches 2 Burning |
| Brimstone Pipe | Fire | Whenever you give an enemy Burning, they also get 1 Oil |
| Snow Globe of a Small Town | Frost | A snowman builds itself beside you at the start of each duel |
| Icicle Dentures | Frost | Your spells give 1 Chill when they hit, at most once a second |
| Rat King's Crown | Venom | Three plague rats scurry out at the start of each duel |
| Suspicious Cheese | Venom | The enemy starts with 4 Poison; so do you, but only 1 |
| Kite and Key | Storm | Every 10 s, lightning strikes the enemy for 6 and 2 Charge |
| Static Sock | Storm | Your first three spells each give the enemy 2 Charge |
| Acorn of the Old Oak | Stone | At 15 s, a treant sprouts to fight for you |
| Hoard of Pebbles | Stone | Summons hit you for 2 less |
| Rattling Ribcage | Shadow | Start with two skeletons; another rises each time your tome loops |
| Chattering Jawbone | Shadow | When a spell hits you, 1-in-4 chance a skeleton rises for 8 s |
| Tarnished Halo | Holy | Each loop, heal 8 and shed 2 of every status on you |
| Choir in a Box | Holy | A cherub flutters out at the start of each duel |
| Ledger of Late Fees | Arcane | Each time the enemy casts, you gain 2 ink |
| Bottled Echo | Arcane | Every third spell you cast is read again at half strength |

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
