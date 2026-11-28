// Shared game content for Chipfall: Veyra Rift.
// Every name, faction, item and place here is original to this project.

export type FactionId = 'aurex' | 'vessari' | 'kreth';
export type RoleId = 'assault' | 'guardian' | 'engineer';
export type Rarity = 'common' | 'rare' | 'epic';
export type ItemKind = 'weapon' | 'armor' | 'ore' | 'material';
export type IdleActivity = 'hunt' | 'mine' | 'train';

export const GAME_TITLE = 'Chipfall';
export const GAME_SUBTITLE = 'Veyra Rift';

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  color: string;
  accent: string;
  dark: string;
  motto: string;
  lore: string;
  baseName: string;
  chipName: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  aurex: {
    id: 'aurex',
    name: 'Aurex Concord',
    short: 'Aurex',
    color: '#F4B740',
    accent: '#FFE2A0',
    dark: '#3A2A08',
    motto: 'Light the deep.',
    lore: 'Hardlight engineers who arrived first and built Veyra’s orbital lattice. They trade in brilliance and keep their records in sunglass vaults.',
    baseName: 'Halcyon Spire',
    chipName: 'Sunwell Chip',
  },
  vessari: {
    id: 'vessari',
    name: 'Vessari Covenant',
    short: 'Vessari',
    color: '#A77BFF',
    accent: '#DCCBFF',
    dark: '#221245',
    motto: 'The shard remembers.',
    lore: 'A psionic choir grown from Veyra’s violet crystal seams. They believe every chip holds a fragment of the planet’s first song.',
    baseName: 'Choir Hollow',
    chipName: 'Resonant Chip',
  },
  kreth: {
    id: 'kreth',
    name: 'Kreth Ironhold',
    short: 'Kreth',
    color: '#3FD0E0',
    accent: '#B5F3FA',
    dark: '#06303A',
    motto: 'Hold. Grind. Endure.',
    lore: 'Cybernetic clans of cold-steel miners who dug the first shafts. Their frames are patched with every war they survived.',
    baseName: 'Anvil Deep',
    chipName: 'Coldforge Chip',
  },
};

export const FACTION_IDS: FactionId[] = ['aurex', 'vessari', 'kreth'];

export interface AbilityDef {
  id: string;
  name: string;
  desc: string;
  warCooldownSec: number;
  dungeonCooldownTicks: number;
}

export interface RoleDef {
  id: RoleId;
  name: string;
  tagline: string;
  base: { hp: number; atk: number; def: number };
  perLevel: { hp: number; atk: number; def: number };
  ability: AbilityDef;
}

export const ROLES: Record<RoleId, RoleDef> = {
  assault: {
    id: 'assault',
    name: 'Assault',
    tagline: 'Damage dealer. Pressures enemy chips.',
    base: { hp: 130, atk: 19, def: 6 },
    perLevel: { hp: 15, atk: 3.4, def: 1 },
    ability: {
      id: 'overcharge',
      name: 'Overcharge Strike',
      desc: 'Your next hit deals 3× damage, against pilots or chips.',
      warCooldownSec: 10,
      dungeonCooldownTicks: 6,
    },
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    tagline: 'Protects teammates and the faction chip.',
    base: { hp: 180, atk: 15, def: 10 },
    perLevel: { hp: 21, atk: 2.7, def: 1.8 },
    ability: {
      id: 'bulwark',
      name: 'Bulwark',
      desc: 'For 5s, allies here (and your chip, at home) take 50% less damage. Reflects 30% in dungeons.',
      warCooldownSec: 15,
      dungeonCooldownTicks: 9,
    },
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    tagline: 'Heals allies and keeps a squad alive.',
    base: { hp: 145, atk: 16, def: 7 },
    perLevel: { hp: 17, atk: 2.9, def: 1.2 },
    ability: {
      id: 'nanite',
      name: 'Nanite Surge',
      desc: 'Restore 30% HP to every ally here (35% to yourself in dungeons).',
      warCooldownSec: 12,
      dungeonCooldownTicks: 7,
    },
  },
};

export const ROLE_IDS: RoleId[] = ['assault', 'guardian', 'engineer'];

export interface ItemTemplate {
  id: string;
  name: string;
  kind: ItemKind;
  stack: boolean;
  rarity: Rarity;
  role?: RoleId; // weapons are role-specific
  atk?: number;
  def?: number;
  hp?: number;
  value: number; // suggested market price in Gold Coins
  desc: string;
}

const T = (t: ItemTemplate) => t;

export const ITEMS: Record<string, ItemTemplate> = Object.fromEntries(
  [
    // Assault weapons
    T({ id: 'w_ion_carbine', name: 'Ion Carbine', kind: 'weapon', stack: false, rarity: 'common', role: 'assault', atk: 6, value: 40, desc: 'Standard-issue rifle. Reliable, loud, cheap.' }),
    T({ id: 'w_shardsplitter', name: 'Shardsplitter Rifle', kind: 'weapon', stack: false, rarity: 'rare', role: 'assault', atk: 13, value: 260, desc: 'Fires a crystal round that splinters on impact.' }),
    T({ id: 'w_sunlance', name: 'Sunlance Railgun', kind: 'weapon', stack: false, rarity: 'epic', role: 'assault', atk: 21, value: 900, desc: 'A rail of folded hardlight. Pierces chip plating.' }),
    // Guardian weapons
    T({ id: 'w_bastion_maul', name: 'Bastion Maul', kind: 'weapon', stack: false, rarity: 'common', role: 'guardian', atk: 5, def: 2, value: 40, desc: 'A breaching hammer with a shield lip.' }),
    T({ id: 'w_pylon_hammer', name: 'Pylon Hammer', kind: 'weapon', stack: false, rarity: 'rare', role: 'guardian', atk: 10, def: 5, value: 260, desc: 'Anchors a shield field with every swing.' }),
    T({ id: 'w_monolith_breaker', name: 'Monolith Breaker', kind: 'weapon', stack: false, rarity: 'epic', role: 'guardian', atk: 16, def: 8, value: 900, desc: 'Forged from a decommissioned gate pylon.' }),
    // Engineer weapons
    T({ id: 'w_mender_rod', name: 'Mender Rod', kind: 'weapon', stack: false, rarity: 'common', role: 'engineer', atk: 5, hp: 12, value: 40, desc: 'Field-repair rod that doubles as a stun baton.' }),
    T({ id: 'w_nanite_emitter', name: 'Nanite Emitter', kind: 'weapon', stack: false, rarity: 'rare', role: 'engineer', atk: 10, hp: 28, value: 260, desc: 'Sprays repair swarms or cutting swarms.' }),
    T({ id: 'w_lattice_conductor', name: 'Lattice Conductor', kind: 'weapon', stack: false, rarity: 'epic', role: 'engineer', atk: 16, hp: 48, value: 900, desc: 'Threads a healing lattice through a whole squad.' }),
    // Armor (any role)
    T({ id: 'a_scrapweave_vest', name: 'Scrapweave Vest', kind: 'armor', stack: false, rarity: 'common', def: 4, hp: 20, value: 30, desc: 'Woven from salvage. Better than nothing.' }),
    T({ id: 'a_field_rig', name: 'Plated Field Rig', kind: 'armor', stack: false, rarity: 'common', def: 6, hp: 32, value: 70, desc: 'Prospector plating with a decent seal.' }),
    T({ id: 'a_vault_carapace', name: 'Vault Carapace', kind: 'armor', stack: false, rarity: 'rare', def: 10, hp: 62, value: 280, desc: 'Lifted from a vault guardian’s chassis.' }),
    T({ id: 'a_halcyon_shell', name: 'Halcyon Aegis Shell', kind: 'armor', stack: false, rarity: 'epic', def: 16, hp: 105, value: 950, desc: 'Layered hardlight plates that hum when struck.' }),
    // Ore
    T({ id: 'o_lumen', name: 'Lumen Ore', kind: 'ore', stack: true, rarity: 'common', value: 4, desc: 'Glowing ore used in upgrades from +2.' }),
    T({ id: 'o_cobaltine', name: 'Cobaltine Ore', kind: 'ore', stack: true, rarity: 'rare', value: 14, desc: 'Dense blue ore used for high upgrades.' }),
    T({ id: 'o_prism', name: 'Prism Crystal', kind: 'ore', stack: true, rarity: 'epic', value: 60, desc: 'Only found in Victor’s Lode. Needed for +7 and above.' }),
    // Materials
    T({ id: 'm_scrap', name: 'Alloy Scrap', kind: 'material', stack: true, rarity: 'common', value: 6, desc: 'Every upgrade needs it.' }),
    T({ id: 'm_circuit', name: 'Circuit Shard', kind: 'material', stack: true, rarity: 'rare', value: 18, desc: 'Needed from +4.' }),
    T({ id: 'm_forge_core', name: 'Forge Core', kind: 'material', stack: true, rarity: 'epic', value: 75, desc: 'Dungeon salvage. Needed from +6.' }),
  ].map((t) => [t.id, t]),
);

export const STARTER_WEAPON: Record<RoleId, string> = {
  assault: 'w_ion_carbine',
  guardian: 'w_bastion_maul',
  engineer: 'w_mender_rod',
};
export const STARTER_ARMOR = 'a_scrapweave_vest';
export const STARTING_GOLD = 80;
export const STARTING_ITEMS: Array<[string, number]> = [['m_scrap', 1]];

export const ROLE_WEAPONS: Record<RoleId, { rare: string; epic: string; common: string }> = {
  assault: { common: 'w_ion_carbine', rare: 'w_shardsplitter', epic: 'w_sunlance' },
  guardian: { common: 'w_bastion_maul', rare: 'w_pylon_hammer', epic: 'w_monolith_breaker' },
  engineer: { common: 'w_mender_rod', rare: 'w_nanite_emitter', epic: 'w_lattice_conductor' },
};
export const ARMORS = { common: 'a_field_rig', rare: 'a_vault_carapace', epic: 'a_halcyon_shell' };

// ---------------------------------------------------------------------------
// Progression formulas
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 40;
export function expToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}
export function trainXpToNext(trainLevel: number): number {
  return 60 * (trainLevel + 1);
}

export const UPGRADE_MAX = 10;
export const UPGRADE_STAT_BONUS = 0.12; // +12% of the item's base stats per level

export interface UpgradeCost {
  gold: number;
  materials: Array<[string, number]>;
}
/** Cost to go from `level` to `level + 1`. The first upgrade (+0→+1) is 60 Gold + 3 Alloy Scrap. */
export function upgradeCost(level: number): UpgradeCost {
  const n = level;
  const gold = Math.round(60 * Math.pow(n + 1, 1.6));
  const materials: Array<[string, number]> = [['m_scrap', 3 + 2 * n]];
  if (n >= 1) materials.push(['o_lumen', 4 * n]);
  if (n >= 3) materials.push(['m_circuit', n - 2]);
  if (n >= 4) materials.push(['o_cobaltine', 2 * (n - 3)]);
  if (n >= 5) materials.push(['m_forge_core', n - 4]);
  if (n >= 6) materials.push(['o_prism', n - 5]);
  return { gold, materials };
}

export interface GearStats {
  atk: number;
  def: number;
  hp: number;
}
export function itemStats(templateId: string, upgrade: number): GearStats {
  const t = ITEMS[templateId];
  if (!t) return { atk: 0, def: 0, hp: 0 };
  const m = 1 + UPGRADE_STAT_BONUS * upgrade;
  return {
    atk: Math.round((t.atk ?? 0) * m),
    def: Math.round((t.def ?? 0) * m),
    hp: Math.round((t.hp ?? 0) * m),
  };
}

export interface CombatStats {
  hp: number;
  atk: number;
  def: number;
  power: number;
}
export function characterStats(
  role: RoleId,
  level: number,
  trainLevel: number,
  weapon?: { templateId: string; upgrade: number } | null,
  armor?: { templateId: string; upgrade: number } | null,
): CombatStats {
  const r = ROLES[role];
  const L = level - 1;
  const w = weapon ? itemStats(weapon.templateId, weapon.upgrade) : { atk: 0, def: 0, hp: 0 };
  const a = armor ? itemStats(armor.templateId, armor.upgrade) : { atk: 0, def: 0, hp: 0 };
  const train = 1 + 0.03 * trainLevel;
  const hp = Math.round((r.base.hp + r.perLevel.hp * L + w.hp + a.hp) * train);
  const atk = Math.round((r.base.atk + r.perLevel.atk * L + w.atk + a.atk) * train);
  const def = Math.round(r.base.def + r.perLevel.def * L + w.def + a.def);
  const power = Math.round(atk * 4 + def * 3 + hp * 0.5);
  return { hp, atk, def, power };
}

/** Damage after mitigation. `roll` is in [0,1). */
export function mitigate(atk: number, def: number, roll: number): number {
  const variance = 0.9 + roll * 0.2;
  return Math.max(1, Math.round(atk * variance * (50 / (50 + def))));
}

// ---------------------------------------------------------------------------
// Idle activities (rates per minute, computed server-side from timestamps)
// ---------------------------------------------------------------------------

export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;

export interface MiningZone {
  id: string;
  name: string;
  desc: string;
  bonus: boolean;
}
export const MINING_ZONES: Record<string, MiningZone> = {
  quarry: { id: 'quarry', name: 'Glassfall Quarry', desc: 'Open-pit Lumen seams on the Rift floor.', bonus: false },
  victors_lode: {
    id: 'victors_lode',
    name: 'Victor’s Lode',
    desc: 'A sealed vein opened only for the last Chip War’s winners. Double ore and Prism Crystal.',
    bonus: true,
  },
};
export const BONUS_ZONE_ID = 'victors_lode';
export const BONUS_ZONE_HOURS = 2;

export interface IdleRates {
  exp: number;
  gold: number;
  trainXp: number;
  items: Record<string, number>; // template -> per minute
  gearDrop: number; // chance-units per minute (1 unit = one common gear drop)
}

export function idleRates(activity: IdleActivity, level: number, zone: string): IdleRates {
  if (activity === 'hunt') {
    return {
      exp: 20 + 6 * level,
      gold: 3 + 0.5 * level,
      trainXp: 0,
      items: { m_scrap: 1.5, m_circuit: 0.15 },
      gearDrop: 1 / 25,
    };
  }
  if (activity === 'mine') {
    const bonus = zone === BONUS_ZONE_ID;
    const m = bonus ? 2 : 1;
    const items: Record<string, number> = {
      o_lumen: (4 + 0.25 * level) * m,
      o_cobaltine: (0.6 + 0.05 * level) * m,
      m_scrap: 0.4,
    };
    if (bonus) items.o_prism = 0.3;
    return { exp: 4 + level, gold: 2, trainXp: 0, items, gearDrop: 0 };
  }
  return { exp: 2, gold: 0, trainXp: 25 + 2 * level, items: {}, gearDrop: 0 };
}

export const ACTIVITY_INFO: Record<IdleActivity, { name: string; desc: string }> = {
  hunt: { name: 'Hunting', desc: 'Clear Rift fauna for EXP, Gold Coins, Alloy Scrap and the odd gear drop.' },
  mine: { name: 'Mining', desc: 'Dig ore and materials you can sell to other players.' },
  train: { name: 'Training', desc: 'Drill combat skills. Each training level adds +3% ATK and HP.' },
};

// ---------------------------------------------------------------------------
// Dungeons
// ---------------------------------------------------------------------------

export type DungeonId = 'training' | 'foundry' | 'vault' | 'goldmine';

export interface EnemyDef {
  name: string;
  hp: number;
  atk: number;
  def: number;
  boss?: boolean;
}

export interface DungeonDef {
  id: DungeonId;
  name: string;
  tagline: string;
  primary: string;
  recLevel: number;
  unlockLevel: number;
  expectedSec: [number, number];
  maxTicks: number;
  waves: EnemyDef[][];
  possibleDrops: string[];
  bossName: string;
}

export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  training: {
    id: 'training',
    name: 'Training Grounds',
    tagline: 'Fight drill waves and beat the Training Commander.',
    primary: 'Bonus character EXP',
    recLevel: 1,
    unlockLevel: 1,
    expectedSec: [15, 30],
    maxTicks: 150,
    bossName: 'Commander Rusk-9',
    waves: [
      [
        { name: 'Drill Drone', hp: 46, atk: 7, def: 1 },
        { name: 'Drill Drone', hp: 46, atk: 7, def: 1 },
      ],
      [
        { name: 'Target Sentry', hp: 64, atk: 8, def: 3 },
        { name: 'Target Sentry', hp: 64, atk: 8, def: 3 },
      ],
      [{ name: 'Commander Rusk-9', hp: 210, atk: 11, def: 5, boss: true }],
    ],
    possibleDrops: ['EXP (guaranteed)', 'Alloy Scrap', 'Circuit Shard'],
  },
  foundry: {
    id: 'foundry',
    name: 'Weapon Foundry',
    tagline: 'Shut down the Slagwright before it melts you down.',
    primary: 'Role weapon (Rare or Epic)',
    recLevel: 3,
    unlockLevel: 2,
    expectedSec: [25, 40],
    maxTicks: 180,
    bossName: 'The Slagwright',
    waves: [
      [
        { name: 'Slag Hound', hp: 80, atk: 11, def: 3 },
        { name: 'Slag Hound', hp: 80, atk: 11, def: 3 },
      ],
      [
        { name: 'Crucible Drone', hp: 105, atk: 12, def: 5 },
        { name: 'Crucible Drone', hp: 105, atk: 12, def: 5 },
      ],
      [{ name: 'The Slagwright', hp: 420, atk: 15, def: 8, boss: true }],
    ],
    possibleDrops: ['Role weapon (guaranteed): Rare 70%, Epic 30%', 'Forge Core', 'Alloy Scrap'],
  },
  vault: {
    id: 'vault',
    name: 'Armored Vault',
    tagline: 'Crack the vault and outlast its guardian.',
    primary: 'Armor piece (Rare or Epic)',
    recLevel: 4,
    unlockLevel: 2,
    expectedSec: [28, 42],
    maxTicks: 180,
    bossName: 'Vault Warden Thessaly',
    waves: [
      [
        { name: 'Lockbot', hp: 95, atk: 11, def: 6 },
        { name: 'Lockbot', hp: 95, atk: 11, def: 6 },
      ],
      [
        { name: 'Laser Grid Node', hp: 115, atk: 13, def: 6 },
        { name: 'Laser Grid Node', hp: 115, atk: 13, def: 6 },
      ],
      [{ name: 'Vault Warden Thessaly', hp: 480, atk: 16, def: 10, boss: true }],
    ],
    possibleDrops: ['Armor piece (guaranteed): Rare 70%, Epic 30%', 'Circuit Shard', 'Alloy Scrap'],
  },
  goldmine: {
    id: 'goldmine',
    name: 'Gold Mine',
    tagline: 'Topple the runaway mining mech guarding the payroll.',
    primary: 'Gold Coins (payout shown before entry)',
    recLevel: 5,
    unlockLevel: 3,
    expectedSec: [30, 45],
    maxTicks: 180,
    bossName: 'Excavator MK-IV',
    waves: [
      [
        { name: 'Rockgrinder', hp: 110, atk: 13, def: 6 },
        { name: 'Rockgrinder', hp: 110, atk: 13, def: 6 },
      ],
      [
        { name: 'Blast Charger', hp: 122, atk: 14, def: 7 },
        { name: 'Blast Charger', hp: 122, atk: 14, def: 7 },
      ],
      [{ name: 'Excavator MK-IV', hp: 560, atk: 18, def: 11, boss: true }],
    ],
    possibleDrops: ['Gold Coins (guaranteed)', 'Lumen Ore', 'Cobaltine Ore'],
  },
};
export const DUNGEON_IDS: DungeonId[] = ['training', 'foundry', 'vault', 'goldmine'];

export function goldMinePayout(level: number): number {
  return 250 + 50 * level;
}
export function trainingExpReward(level: number): number {
  return 350 + 120 * (level - 1);
}

// ---------------------------------------------------------------------------
// Chip Wars
// ---------------------------------------------------------------------------

export const WAR = {
  tickMs: 1000,
  travelTicks: 10,
  respawnTicks: 8,
  hpMultiplier: 3, // war HP pool is 3× character HP so fights last a few seconds
  chipHpScheduled: 36000,
  chipHpTest: 7000,
  assistWindowTicks: 10,
  engagedWindowTicks: 3,
  bonusZoneHours: BONUS_ZONE_HOURS,
};

export type OrderKind = 'defend' | 'attack' | 'support';
export interface WarOrder {
  kind: OrderKind;
  target?: string; // faction id for attack, combatant id for support
}

/** Published War MVP formula. */
export const MVP_WEIGHTS = {
  competitiveKill: 10, // per human kill, with diminishing credit for repeat victims
  npcKill: 3,
  assist: 4,
  damagePer: 100, // 1 point per 100 damage dealt to pilots
  chipDamagePer: 40, // 1 point per 40 chip damage
  healingPer: 80, // 1 point per 80 HP actually restored
  defensePer: 80, // 1 point per 80 defense contribution
};
/** Credit for the n-th kill (1-based) of the same human opponent in one war. */
export function repeatKillCredit(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 0.5;
  if (n === 3) return 0.25;
  return 0.1;
}
export const MVP_FORMULA_TEXT = [
  'MVP = 10 × K* + 3 × NPC kills + 4 × assists',
  '    + damage ÷ 100 + chip damage ÷ 40',
  '    + healing ÷ 80 + defense ÷ 80',
  'K* = human kills, where repeat kills of the same opponent in one war count 1, ½, ¼, then 0.1 each.',
  'Damage counts only damage actually dealt. Healing counts only HP actually restored (overheal is ignored).',
  'Defense = damage you deal to enemies at your own base + damage your Bulwark prevents.',
];

export function warRewards(mvp: number, won: boolean): { gold: number; exp: number } {
  const m = won ? 1.5 : 1;
  return { gold: Math.round((60 + mvp * 2) * m), exp: Math.round((90 + mvp * 3) * m) };
}

export const NPC_CALLSIGNS = [
  'Vexa', 'Torin', 'Mako', 'Juno', 'Rook', 'Sable', 'Quill', 'Nyx', 'Bram', 'Ostra', 'Pell', 'Kiro',
  'Dace', 'Lyra', 'Fenn', 'Halo', 'Ivo', 'Zeph', 'Cass', 'Wren', 'Tavi', 'Orin', 'Sorrel', 'Ember',
];

export function rarityColor(r: Rarity): string {
  return r === 'epic' ? '#E58CFF' : r === 'rare' ? '#5DB8FF' : '#C9D2DC';
}

// ---------------------------------------------------------------------------
// Open world: monsters, ranges and movement
// ---------------------------------------------------------------------------

export interface MonsterDef {
  name: string;
  range: number;
  speed: number;
  aggro: number;
  elite?: boolean;
  desc: string;
}

export const MONSTERS: Record<'skitter' | 'stalker' | 'crawler' | 'wraith' | 'colossus', MonsterDef> = {
  skitter: { name: 'Rift Skitter', range: 1.3, speed: 2.4, aggro: 4, desc: 'Six-legged scavengers drawn to fresh ore dust.' },
  stalker: { name: 'Glass Stalker', range: 1.4, speed: 2.8, aggro: 4.5, desc: 'Crystal-backed hunters that ambush from the shard fields.' },
  crawler: { name: 'Ironback Crawler', range: 1.5, speed: 2.2, aggro: 4.5, desc: 'Armoured burrowers. Slow, heavy, hard to crack.' },
  wraith: { name: 'Prism Wraith', range: 3.5, speed: 2.6, aggro: 5, desc: 'Floating light-shards that fire refracted beams.' },
  colossus: { name: 'Rift Colossus', range: 2.2, speed: 2.0, aggro: 5, elite: true, desc: 'The plaza guardian. Bring a party.' },
};

export function monsterStats(type: keyof typeof MONSTERS, level: number) {
  const elite = !!MONSTERS[type].elite;
  return {
    hp: Math.round((60 + 30 * level) * (elite ? 8 : 1)),
    atk: Math.round((5 + 2.6 * level) * (elite ? 1.6 : 1)),
    def: Math.round(2 + 1.1 * level),
    exp: Math.round((14 + 7 * level) * (elite ? 6 : 1)),
    gold: Math.round((1 + level) * (elite ? 5 : 1)),
  };
}

export const WORLD = {
  walkSpeed: 4, // tiles per second
  attackMs: 1000,
  monsterAttackMs: 1200,
  respawnMs: 6000,
  monsterRespawnMs: 25000,
  eliteRespawnMs: 180000,
  leash: 12,
  viewRadius: 22,
  shareRadius: 20,
  partyMax: 4,
  oreMineMs: 3000,
  oreRespawnMs: 45000,
  abilityRadius: 4,
  hpMultiplier: 2,
  range: { assault: 4.5, engineer: 3.5, guardian: 1.6 } as Record<RoleId, number>,
};
