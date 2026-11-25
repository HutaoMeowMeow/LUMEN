// Journal entries. Places are keyed by Structures anchor ids, species by Creatures SPECIES ids, regions by layout ids.
// All story, names and text are original to LUMEN.

export const INTRO = `Three years ago Meridian Station stopped answering the radio. The last transmission was a single line from the station lead, Dr. Ilse Varga: "The light is coming up from the Rift, and it is singing back." You were her field diver.

Now you have come back alone, with a mask, a lamp and a small boat, to find out what they found.`;

export const PLACES = {
  'station-hub': { title: 'Meridian Station — Hub', text: 'The moonpool is still open and the hub has kept a pocket of stale air in its dome. Varga\'s duty board is wiped clean except for one word, circled twice: LISTEN.' },
  'station-tank': { title: 'Specimen Tank', text: 'Something is still alive in the tank, three years without feeding. It pulses in slow time with a rhythm you can almost hear through the glass. The label reads only "R-7, Rift sample".' },
  'station-lab': { title: 'Laboratory Log', text: 'Varga, day 212: "The glow is not chemistry alone. The colonies answer each other across kilometres, faster than the current could carry anything. The whales hear it. I think the old builders did too."' },
  'station-obs': { title: 'Observatory Bubble', text: 'A chair faces south toward the Rift. A recorder sits on the armrest with its tape run out. Scratched into the frame: "It is brighter on the nights the whales pass."' },
  'wreck-bridge': { title: 'Wreck of the Calder Rose', text: 'The supply ship broke her back on the reef in a storm the station logs call "unseasonable". The bridge chronometer stopped at 03:12, the same minute as the last radio call.' },
  'wreck-hold': { title: 'The Calder Rose — Hold', text: 'Crates of sample jars, all empty, all broken from the inside. The manifest lists them as "sealed, Rift sediment, do not expose to light".' },
  boat: { title: 'Abandoned Skiff', text: 'Station tender number two, run aground inside the atoll. The fuel tank is full. Whoever came here went the rest of the way on foot, or swam.' },
  'ruins-monolith': { title: 'The Concord Monolith', text: 'A tower of fitted stone, far older than any record of people on these islands. The glyph bands show figures swimming down toward a spiral of light, and the same spiral rising.' },
  'ruins-mask': { title: 'The Watcher', text: 'A great stone face, half drowned in sand, looking south. Its eyes are cut through the stone so that at a certain hour the light shines through them toward the Rift.' },
  gate: { title: 'The Rift Gate', text: 'Two pillars and a lintel on the lip of the trench, carved with the same spiral. Beyond it the floor drops away into black. The builders came this far and set a door with no wall around it.' },
  vents: { title: 'The Breathing Vents', text: 'Hot water roars out of the rift floor here, black with minerals. The glowing colonies are thickest around the vents. Life feeding on the planet\'s own heat, with no need of the sun.' },
  bones: { title: 'Leviathan Fall', text: 'The skeleton of a whale far larger than any living one, picked clean and lit by the creatures that feed on it. A whale fall can feed the deep for fifty years.' },
  choir: { title: 'The Stone Choir', text: 'A ring of hollow basalt columns. When the current runs through them they hum, low and steady. Varga\'s notes call this place "the tuning fork".' },
  stones: { title: 'Summit Stones of Haven', text: 'A circle of standing stones on Haven\'s peak. From here you can see every island. The builders lit fires here; the hearth stones are still black.' },
  lighthouse: { title: 'Spire Light', text: 'An automatic lighthouse, still turning after the station went dark. Its log shows a fault every night at 03:12, when the lamp dims as if something below is drawing on it.' },
  camp: { title: 'Atoll Camp', text: 'A tarp, a cold fire pit and a waterproof case holding Varga\'s personal diary. The last entry: "I am not lost. I am going to listen properly. Tell the next diver: follow the light down."' },
  ember: { title: 'Ember Crater', text: 'The young volcano still breathes. The station tracked tremors here every time the Rift brightened, as if the island and the deep were one animal.' },
};

export const SPECIES_TEXT = {
  glintfin: 'Small silver-blue schooling fish with gold fins. They turn together in flashing sheets and are the first thing you see on any reef.',
  emberdart: 'Bright orange reef darters with pale bands. Each little family claims one coral head and never strays more than a few metres from it.',
  bannerfish: 'Tall, flat reef fish banded yellow and black. They patrol their coral head in pairs, turning side-on to the diver like a warning flag.',
  regalfin: 'A deep-bodied blue and gold fish with fine pale lines. Slow and dignified, it circles the same bommie every day.',
  greyfin: 'Lean grey sharks that patrol the reef edge in ones and twos. Wary of divers; they keep their distance and circle wide.',
  gloamjaw: 'A dark deep-water hunter that dangles a glowing bait above its jaws. In the black water you only ever see the light.',
  skyray: 'Huge dark rays that fly through open water on slow wingbeats, white bellies flashing when they bank.',
  shellback: 'Old sea turtles that row slowly between the reefs, surfacing to breathe and drifting down again.',
  kelpperch: 'Olive-striped perch that drift in loose groups among the ribbonweed, nearly invisible until they move.',
  mirrorfin: 'Open-water schoolers that move in tight mirrored balls, turning faster than the eye can follow.',
  lanternet: 'Deep-water fish that carry rows of cyan light along their flanks. They flash in sequence, passing signals down the school.',
  veilbell: 'Violet jellies of the deep. Their bells pulse with a cold glow that ripples outward through the bloom.',
  sunbell: 'Warm-coloured surface jellies that drift with the current in loose swarms. Their sting is mild.',
  sandglider: 'Broad grey rays that skim the sandy floor, flying with slow beats of their wings.',
  hollowsong: 'A great whale and her calf, wandering between the islands and the Rift. Faint lines of light run along their sides. When they sing, the deep colonies brighten.',
  saltwing: 'Seabirds that ride the updrafts around the islands, always circling, always calling.',
};

export const REGION_TEXT = {
  kelp: 'A forest of ribbonweed rising toward the light, swaying in green twilight.',
  dunes: 'Wide plains of pale sand, rippled by the current like wind on a desert.',
  choir: 'Basalt columns rising from the seabed, humming in the current.',
  station: 'The flat-topped plateau where Meridian Station was anchored.',
  ruins: 'The drowned city of the builders the station called the Concord.',
  rift: 'The Hollow Rift: a trench hundreds of metres deep, glowing faintly from below.',
  reef: 'Shallow coral gardens around the islands, bright and crowded with life.',
};

export const ENDING = `You have seen every place Varga marked and met every creature in her notes. The colonies, the whales, the singing stones and the builders' gate are all one conversation, held in light, older than any people. Varga did not drown.

She went down to listen. Tonight, when the whales pass over the Rift, you hear it too.`;
