export type TransportMode = 'road' | 'rail';

export type LineCategory = 'highway' | 'arterial' | 'metro' | 'highspeed_rail';

export interface StartingCity {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  zoom: number;
  description: string;
  isCustom?: boolean;
}

export interface MapNode {
  id: string;
  name: string;
  cityId: string;
  lat: number;
  lng: number;
  connected: boolean;
  isHub?: boolean;
  level: number;
}

export interface PredefinedSegment {
  id: string;
  lineId: string;
  name: string;
  mode: TransportMode;
  fromNodeId: string;
  toNodeId: string;
  distanceKm: number;
  feederNetworkKm: number;
  coordinates: [number, number][];
  buildCost: number;
  baseIncomePerSec: number;
  built: boolean;
  level: number;
}

export interface TransportLine {
  id: string;
  name: string;
  lineCode: string;
  cityId: string;
  mode: TransportMode;
  category: LineCategory;
  color: string;
  description: string;
  segmentIds: string[];
  completionBonus: {
    incomeMultiplierPct: number;
    instantCash: number;
    skillPoints: number;
    label: string;
  };
  completed: boolean;
}

// Live OpenStreetMap Atomic Nodes & Edges (iD-editor style node-by-node linking)
export interface OsmNode {
  id: string;
  lat: number;
  lng: number;
  connected: boolean;
  mode?: TransportMode | 'mixed';
  label?: string;
  regionId?: string;
}

export interface OsmEdge {
  id: string;
  wayName: string;
  highwayType: string; // motorway, primary, secondary, residential, rail
  mode: TransportMode;
  fromNodeId: string;
  toNodeId: string;
  coordinates: [[number, number], [number, number]];
  distanceKm: number;
  buildCost: number;
  baseIncomePerSec: number;
  built: boolean;
  regionId?: string;
}

export interface GeoJsonBoundary {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface ProvincialRegion {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number]; // [minLat, minLng, maxLat, maxLng]
  boundaryGeoJson?: GeoJsonBoundary;
  centerLat: number;
  centerLng: number;
  unlocked: boolean;
  isStartingRegion?: boolean;
  isIsolated: boolean; // true = island or non-adjacent region requiring manual seed pick
  isKnownIsland?: boolean;
  totalNodeCount?: number;
}

export type UpgradeCategory = 'road_node' | 'rail_speed' | 'editor_click' | 'automation' | 'megascale';

export interface UpgradeItem {
  id: string;
  category: UpgradeCategory;
  name: string;
  description: string;
  effectPerLevelText: string;
  baseCost: number;
  costGrowth: number;
  level: number;
  maxLevel: number;
  unlockRequirement?: {
    upgradeId: string;
    minLevel: number;
  };
}

export type SkillBranch = 'core' | 'infra' | 'speed' | 'realestate' | 'automation';
export type TreeRole = 'root' | 'trunk' | 'branch' | 'canopy';

export interface SkillNode {
  id: string;
  code?: string; // Antimatter Dimensions style study code e.g. '11', '61', '111'
  branch: SkillBranch;
  role: TreeRole;
  name: string;
  description: string;
  effectText: string;
  costSP: number; // Legacy field kept as 0; studies unlock with Money ($) only
  costMoney: number;
  costGrowth?: number;
  level: number;
  maxLevel: number;
  requires: string[];
  exclusiveGroup?: string; // Mutually exclusive path split until multi-path study is unlocked
  tier: number;
  x: number; // Canvas coordinate (0..1600)
  y: number; // Canvas coordinate (0..2200)
}

export type AchievementCategory = 'scale' | 'osm';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  targetType: 'total_km' | 'osm_nodes';
  targetId?: string;
  targetValue?: number;
  unlocked: boolean;
  rewardText: string;
  bonusIncomePct: number;
  bonusSkillPoints: number;
  bonusCash: number;
}

export interface MovingUnit {
  id: string;
  segmentId: string;
  mode: TransportMode;
  color: string;
  progress: number;
  direction: 1 | -1;
}

export interface GameStats {
  totalSegmentsBuilt: number;
  totalOsmEdgesBuilt: number;
  connectedOsmNodes: number;
  totalScaledNodes: number;
  totalLinesCompleted: number;
  totalTownsCompleted: number;
  totalClicks: number;
  mapped1to1Km: number;
  totalNetworkKm: number;
  prestigeCount: number;
}

export interface GameSettings {
  soundEnabled: boolean;
  mapTileLayer: 'dark' | 'osm' | 'satellite';
}

export type MinigameId =
  | 'mine'
  | 'reactor'
  | 'shipyard'
  | 'quantum'
  | 'solar'
  | 'bio'
  | 'collider';

export type ReactorCellType = 'empty' | 'fuel' | 'generator' | 'coolant' | 'turbine';

export interface MineGameState {
  ore: number;
  totalOreEarned: number;
  depth: number;
  layersCleared: number;
  layerHp: number;
  layerMaxHp: number;
  isGemVein: boolean;
  drillLevel: number;
  autoDrillerLevel: number;
  laserLevel: number;
  blastLevel: number;
  excavatorLevel: number;
  seismicLevel: number;
  seismicCharge: number; // 0..100 active mega-blast meter
}

export interface ReactorGameState {
  plasma: number;
  totalPlasmaEarned: number;
  totalEnergyMWh: number;
  heat: number;
  overheated: boolean;
  grid: ReactorCellType[]; // 16 cells (4x4)
  coreEfficiencyLevel: number;
  coolantTechLevel: number;
  autoVentUnlocked: boolean;
  turbineTechLevel: number;
  overclockShieldLevel: number;
}

export interface ShipyardGameState {
  darkmatter: number;
  totalDarkmatterEarned: number;
  totalCargoShipped: number;
  alloyParts: number;
  antimatter: number;
  droneCount: number;
  refineryCount: number;
  freighterCount: number;
  orbitalHubCount: number;
  warpDriveLevel: number;
  fleetPrestigeLevel: number;
  fleetMultiplier: number;
}

export interface QuantumGameState {
  qubits: number;
  totalQubitsEarned: number;
  researchPoints: number;
  experimentProgress: number;
  experimentsCompleted: number;
  targetWave: [number, number, number];
  tunedWave: [number, number, number];
  acceleratorLevel: number;
  amplifierLevel: number;
  entanglementLevel: number;
  cryoLevel: number;
  autoTunerUnlocked: boolean;
  leapCount: number;
  leapMultiplier: number;
}

export interface SolarGameState {
  photons: number;
  totalPhotonsEarned: number;
  totalPowerGW: number;
  orbitalAngle: number; // 1..10
  optimalAngle: number; // 1..10
  pulseCharge: number; // 0..100
  mirrorCount: number;
  collectorCount: number;
  trackerLevel: number;
  solarFlareLevel: number;
  concentratorLevel: number;
  autoTrackerUnlocked: boolean;
}

export interface BioGameState {
  spores: number;
  totalSporesEarned: number;
  totalBiomass: number;
  humidity: number; // 0..100 (optimal 45..75)
  algaeCount: number;
  forestCount: number;
  biosphereCount: number;
  enzymeLevel: number;
  climateRegLevel: number;
  evolutionLevel: number;
  evolutionMultiplier: number;
}

export interface ColliderGameState {
  beamCurrency: number;
  totalBeamEarned: number;
  totalCollisions: number;
  luminosity: number; // 0..100 charge
  exoticParticles: number;
  magnetLevel: number;
  vacuumLevel: number;
  detectorLevel: number;
  superCoilLevel: number;
  injectorLevel: number;
  resonanceBurstLevel: number;
}

export interface MinigameMilestoneDef {
  id: string;
  gameId: MinigameId;
  tier: number;
  title: string;
  description: string;
  targetValue: number;
  unitLabel: string;
  incomeBoostPct: number;
}

export interface MinigamesState {
  totalMoneyInvested: number;
  unlockedMilestoneIds: string[];
  unlockedGameIds: MinigameId[];
  mine: MineGameState;
  reactor: ReactorGameState;
  shipyard: ShipyardGameState;
  quantum: QuantumGameState;
  solar: SolarGameState;
  bio: BioGameState;
  collider: ColliderGameState;
}

export interface GameState {
  startingCity: StartingCity;
  capital: number;
  totalLifetimeEarnings: number;
  skillPoints: number;
  prestigeMultiplier: number;
  nodes: MapNode[];
  segments: PredefinedSegment[];
  lines: TransportLine[];
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  loadedOsmChunks: string[];
  loadedOsmRegions?: string[];
  provincialRegions: ProvincialRegion[];
  pendingSeedRegionIds: string[];
  completedOsmWays?: string[];
  upgrades: UpgradeItem[];
  skills: SkillNode[];
  achievements: Achievement[];
  units: MovingUnit[];
  stats: GameStats;
  settings: GameSettings;
  autoBuilderProgress: number;
  lastTickTimestamp: number;
  minigames: MinigamesState;
}
