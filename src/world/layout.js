// Hand-authored world layout. Procedural noise fills in detail; this file decides *where things are*.
// Coordinates: metres. x = east, z = south (three.js -z is north). Sea level y = 0.

export const WORLD = {
  seed: 7331,
  size: 4096,
  half: 2048,
  res: 2049, // heightmap samples per side (2 m spacing)
  biomeRes: 1025, // biome texture samples per side (4 m spacing)
  boundary: 1900, // soft swim boundary radius
};
WORLD.cell = WORLD.size / (WORLD.res - 1);

export const ISLANDS = [
  { id: 'haven', name: 'Haven Isle', x: 150, z: 150, r: 240, peak: 58, type: 'tropical' },
  { id: 'crescent', name: 'Crescent Atoll', x: -980, z: 430, r: 250, peak: 8, type: 'atoll', gap: 0.9 },
  { id: 'spire', name: 'Spire Isle', x: 920, z: -640, r: 150, peak: 118, type: 'spire' },
  { id: 'ember', name: 'Ember Isle', x: -520, z: -1120, r: 210, peak: 78, type: 'volcanic' },
  { id: 'islet-kelp', name: 'Gull Rock', x: -260, z: -430, r: 34, peak: 14, type: 'rock' },
  { id: 'islet-east', name: 'The Teeth', x: 640, z: 640, r: 46, peak: 16, type: 'rock' },
  { id: 'islet-far', name: 'Lonely Skerry', x: 1350, z: 120, r: 40, peak: 11, type: 'rock' },
  { id: 'islet-west', name: 'Marrow Key', x: -1450, z: -260, r: 52, peak: 13, type: 'rock' },
];

// The Hollow Rift: a deep trench winding along the south of the world.
export const RIFT = {
  points: [
    [-1900, 1260], [-1300, 1180], [-900, 1060], [-450, 1110], [-150, 1170],
    [250, 1080], [650, 1050], [1100, 1180], [1500, 1120], [1950, 1230],
  ],
  width: 230,
  floor: -255,
};

// Soft biome regions (noise-warped circles)
export const REGIONS = {
  kelp: { name: 'Ribbonweed Forest', x: -470, z: -220, r: 330 },
  dunes: { name: 'The Glass Dunes', x: 1180, z: 420, r: 470 },
  choir: { name: 'The Stone Choir', x: 360, z: -820, r: 260 },
  station: { name: 'Meridian Plateau', x: -320, z: 720, r: 95, h: -52 },
  ruins: { name: 'The Drowned Concord', x: -1250, z: -430, r: 210, h: -38 },
};

// Cave systems / rock massifs carved with signed distance functions (meshed with surface nets).
// blobs: ellipsoids [x, y, z, rx, ry, rz]; tunnels: polylines of [x, y, z, radius]; chambers: [x, y, z, r]
export const CAVES = [
  {
    id: 'grotto',
    name: 'Whispering Grotto',
    dark: 0.85,
    voxel: 1.0,
    min: [366, -46, -182],
    max: [514, 22, -38],
    blobs: [
      [440, -8, -110, 54, 24, 46],
      [474, -4, -78, 30, 22, 30],
      [412, -10, -138, 26, 16, 24],
    ],
    tunnels: [
      [[366, -3, -104, 4.2], [398, -6, -108, 4], [424, -9, -110, 3.6], [446, -10, -106, 4]],
      [[452, -11, -112, 4], [458, -12, -132, 3.2], [462, -10, -152, 3.6], [468, -8, -176, 4.5]],
      [[452, -12, -100, 3.2], [470, -13, -86, 3.0], [486, -11, -72, 3.4], [506, -9, -60, 4.2]],
      [[449, 2, -104, 2.6], [450, 12, -101, 3.0], [451, 26, -99, 3.4]], // skylight chimney
    ],
    chambers: [[450, -9, -106, 11], [470, -12, -86, 6]],
  },
  {
    // A colossal hollow spire rising from the floor of the Hollow Rift
    id: 'labyrinth',
    name: 'The Abyssal Labyrinth',
    dark: 0.95,
    voxel: 1.5,
    min: [-724, -268, 888],
    max: [-554, -100, 1056],
    blobs: [
      [-640, -180, 970, 52, 66, 48],
      [-608, -168, 1004, 32, 52, 32],
      [-672, -200, 938, 36, 40, 36],
    ],
    tunnels: [
      [[-724, -170, 958, 5], [-690, -174, 963, 4.5], [-662, -180, 968, 4.2], [-648, -184, 970, 5]],
      [[-632, -190, 984, 4.5], [-620, -196, 998, 4], [-604, -200, 1018, 4.2], [-584, -202, 1050, 5.5]],
      [[-636, -172, 962, 3.6], [-630, -156, 954, 3.4], [-624, -138, 948, 3.6], [-620, -110, 944, 4.5]],
      [[-650, -192, 954, 3.4], [-664, -202, 936, 3.2], [-680, -208, 918, 3.6], [-700, -212, 892, 5]],
    ],
    chambers: [[-640, -184, 970, 15], [-612, -197, 1006, 8]],
  },
  {
    id: 'arch',
    name: 'The Sunken Arch',
    dark: 0,
    voxel: 1.0,
    min: [656, -56, -546],
    max: [788, 4, -440],
    blobs: [
      [722, -24, -494, 58, 14, 18],
      [690, -22, -488, 22, 20, 22],
      [756, -22, -500, 22, 18, 22],
    ],
    tunnels: [[[722, -27, -540, 9], [722, -27, -494, 10], [722, -27, -446, 9]]],
    chambers: [],
  },
];

// Points of interest. y is resolved against the terrain at runtime unless given.
// Haven's carved landforms (world coords). worldgen carves them, Structures dresses them.
// valley: mouth on the south beach -> head, where a waterfall drops into a freshwater pool.
export const HAVEN = { valley: [[108, 376], [132, 262]], pool: { x: 131, z: 268, r: 8 }, cliffAng: 5.4 };

export const POIS = {
  station: { x: -320, z: 720, rot: 0.5 },
  wreck: { x: 640, z: 160, rot: 0.75 },
  boat: { x: -1010, z: 470, rot: 2.2 },
  ruins: { x: -1250, z: -430 },
  gate: { x: -150, z: 1170 },
  vents: { x: 520, z: 1060 },
  bones: { x: 1210, z: 470, rot: 0.4 },
  choir: { x: 360, z: -820 },
  stones: { island: 'haven' }, // summit
  lighthouse: { island: 'spire' }, // summit
  camp: { x: -980, z: 205 }, // on the atoll ring
  ember: { island: 'ember' },
};

export const SPAWN = { x: 72, z: 376, yaw: 3.15 }; // Haven's south beach, looking along the shore out to sea
