import { haversineKm } from './osmService';
import {
  Achievement,
  GameState,
  GeoJsonBoundary,
  MapNode,
  MinigameMilestoneDef,
  MovingUnit,
  OsmEdge,
  OsmNode,
  PredefinedSegment,
  ProvincialRegion,
  SkillNode,
  StartingCity,
  TransportLine,
  UpgradeItem,
} from './types';
import {
  buildAchievements,
  CURATED_LINES,
  CURATED_NODES,
  CURATED_PROVINCIAL_REGIONS,
  CURATED_SEGMENTS,
  INITIAL_SKILLS,
  INITIAL_UPGRADES,
  PRESET_CITIES,
} from './worldCatalog';
import {
  advanceMinigamesTick,
  backfillMinigamesState,
  createInitialMinigamesState,
  getMinigameIncomeBoost,
  MINIGAME_MILESTONES,
} from './minigames';

export const GLOBAL_OSM_NODE_TARGET = 450_000_000;
export const MAX_OSM_FRONTIER_DISTANCE = 5;
export const ISOLATED_ROUTE_BRIDGE_MAX_KM = 0.4; // 400m search radius to locate the single nearest bridgeable node from an isolated/dead-end route
export const ISOLATED_ROUTE_BRIDGE_FRONTIER_CAP = 3; // Frontier horizon cap (d <= 3 around the single nearest bridge target)
export const CROSS_BORDER_BRIDGE_MAX_KM = 0.45; // 450m radius across unlocked adjacent city borders

export interface ActiveMultipliers {
  buildCostMult: number;
  nodeBuildCostScaleMult: number;
  networkKmMult: number;
  nodeScaleMult: number;
  globalIncomeMult: number;
  roadIncomeMult: number;
  railIncomeMult: number;
  osmNodeIncomeMult: number;
  junctionFlatPerNode: number;
  clickBonusMult: number;
  clickDpsSeconds: number;
  edgeCashbackFlat: number;
  offlineEfficiencyMult: number;
  prestigeBonusMult: number;
  minigameBoostPct: number;
  minigameIncomeMult: number;
}

export interface NodeTierRankInfo {
  tier: string;
  division: string;
  label: string;
  minNodes: number;
  nextTargetNodes: number | null;
  progressPct: number;
  color: string;
}

const NODE_TIER_STEPS: Array<{
  tier: string;
  division: string;
  minNodes: number;
  color: string;
}> = [
  // Bronze I -> V
  { tier: 'Bronze', division: 'I', minNodes: 0, color: '#cd7f32' },
  { tier: 'Bronze', division: 'II', minNodes: 10, color: '#d48c46' },
  { tier: 'Bronze', division: 'III', minNodes: 25, color: '#dc9959' },
  { tier: 'Bronze', division: 'IV', minNodes: 55, color: '#e3a66d' },
  { tier: 'Bronze', division: 'V', minNodes: 100, color: '#ebb885' },

  // Silver I -> V
  { tier: 'Silver', division: 'I', minNodes: 170, color: '#94a3b8' },
  { tier: 'Silver', division: 'II', minNodes: 280, color: '#a3b3c6' },
  { tier: 'Silver', division: 'III', minNodes: 450, color: '#b4c2d4' },
  { tier: 'Silver', division: 'IV', minNodes: 700, color: '#cbd5e1' },
  { tier: 'Silver', division: 'V', minNodes: 1050, color: '#e2e8f0' },

  // Gold I -> V
  { tier: 'Gold', division: 'I', minNodes: 1550, color: '#d97706' },
  { tier: 'Gold', division: 'II', minNodes: 2300, color: '#e68a0e' },
  { tier: 'Gold', division: 'III', minNodes: 3400, color: '#f59e0b' },
  { tier: 'Gold', division: 'IV', minNodes: 5000, color: '#fbbf24' },
  { tier: 'Gold', division: 'V', minNodes: 7400, color: '#fcd34d' },

  // Platinum I -> V
  { tier: 'Platinum', division: 'I', minNodes: 11000, color: '#0d9488' },
  { tier: 'Platinum', division: 'II', minNodes: 16500, color: '#14b8a6' },
  { tier: 'Platinum', division: 'III', minNodes: 24500, color: '#2dd4bf' },
  { tier: 'Platinum', division: 'IV', minNodes: 36000, color: '#5eead4' },
  { tier: 'Platinum', division: 'V', minNodes: 52000, color: '#99f6e4' },

  // Diamond I -> V
  { tier: 'Diamond', division: 'I', minNodes: 75000, color: '#0284c7' },
  { tier: 'Diamond', division: 'II', minNodes: 110000, color: '#0ea5e9' },
  { tier: 'Diamond', division: 'III', minNodes: 160000, color: '#38bdf8' },
  { tier: 'Diamond', division: 'IV', minNodes: 230000, color: '#7dd3fc' },
  { tier: 'Diamond', division: 'V', minNodes: 330000, color: '#bae6fd' },

  // Master I -> V
  { tier: 'Master', division: 'I', minNodes: 480000, color: '#9333ea' },
  { tier: 'Master', division: 'II', minNodes: 700000, color: '#a855f7' },
  { tier: 'Master', division: 'III', minNodes: 1000000, color: '#b76ef8' },
  { tier: 'Master', division: 'IV', minNodes: 1450000, color: '#c084fc' },
  { tier: 'Master', division: 'V', minNodes: 2050000, color: '#d8b4fe' },

  // Grandmaster I -> V
  { tier: 'Grandmaster', division: 'I', minNodes: 2850000, color: '#e11d48' },
  { tier: 'Grandmaster', division: 'II', minNodes: 3900000, color: '#f43f5e' },
  { tier: 'Grandmaster', division: 'III', minNodes: 5200000, color: '#fb7185' },
  { tier: 'Grandmaster', division: 'IV', minNodes: 6800000, color: '#fda4af' },
  { tier: 'Grandmaster', division: 'V', minNodes: 8600000, color: '#ffe4e6' },

  // Terra Challenger (1천만 노드 도달)
  { tier: 'Terra Challenger', division: '', minNodes: 10000000, color: '#facc15' },
];

export function getNodeTierRank(connectedNodes: number): NodeTierRankInfo {
  const safeNodes = Math.max(0, Math.floor(connectedNodes));
  let idx = 0;
  for (let i = 0; i < NODE_TIER_STEPS.length; i++) {
    if (safeNodes >= NODE_TIER_STEPS[i].minNodes) {
      idx = i;
    } else {
      break;
    }
  }
  const current = NODE_TIER_STEPS[idx];
  const next = NODE_TIER_STEPS[idx + 1] || null;
  const label = current.division ? `${current.tier} ${current.division}` : current.tier;

  if (!next) {
    return {
      tier: current.tier,
      division: current.division,
      label,
      minNodes: current.minNodes,
      nextTargetNodes: null,
      progressPct: 100,
      color: current.color,
    };
  }

  const span = Math.max(1, next.minNodes - current.minNodes);
  const progressPct = Math.min(
    100,
    Math.max(0, ((safeNodes - current.minNodes) / span) * 100)
  );
  return {
    tier: current.tier,
    division: current.division,
    label,
    minNodes: current.minNodes,
    nextTargetNodes: next.minNodes,
    progressPct,
    color: current.color,
  };
}

function computeComponentSizes(edges: OsmEdge[], modeFilter?: 'road' | 'rail'): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (modeFilter && e.mode !== modeFilter) continue;
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
    adj.get(e.toNodeId)!.push(e.fromNodeId);
  }
  const compSize = new Map<string, number>();
  for (const startId of adj.keys()) {
    if (compSize.has(startId)) continue;
    const comp: string[] = [startId];
    compSize.set(startId, 1);
    let head = 0;
    while (head < comp.length) {
      const curr = comp[head++];
      for (const nxt of adj.get(curr) || []) {
        if (!compSize.has(nxt)) {
          compSize.set(nxt, 1);
          comp.push(nxt);
        }
      }
    }
    const sz = comp.length;
    for (const id of comp) {
      compSize.set(id, sz);
    }
  }
  return compSize;
}

export function ensureSeedConnectedOsmNodes(
  nodes: OsmNode[],
  edges: OsmEdge[],
  startingCity: StartingCity
): OsmNode[] {
  if (nodes.length === 0) {
    return nodes;
  }

  const edgeNodeIds = new Set<string>();
  const railEdgeNodeIds = new Set<string>();
  const roadEdgeNodeIds = new Set<string>();
  for (const e of edges) {
    edgeNodeIds.add(e.fromNodeId);
    edgeNodeIds.add(e.toNodeId);
    if (e.mode === 'rail') {
      railEdgeNodeIds.add(e.fromNodeId);
      railEdgeNodeIds.add(e.toNodeId);
    } else {
      roadEdgeNodeIds.add(e.fromNodeId);
      roadEdgeNodeIds.add(e.toNodeId);
    }
  }

  const hasConnectedRoad = nodes.some(
    (n) => n.connected && (n.mode === 'road' || n.mode === 'mixed' || !n.mode)
  );
  const hasConnectedRail = nodes.some(
    (n) => n.connected && (n.mode === 'rail' || n.mode === 'mixed')
  );

  // If road is connected and rail is either connected or has no edges in the network, nothing to seed
  if (hasConnectedRoad && (hasConnectedRail || railEdgeNodeIds.size === 0)) {
    return nodes;
  }
  // If rail is connected and road has no edges in the network, nothing to seed
  if (hasConnectedRail && roadEdgeNodeIds.size === 0) {
    return nodes;
  }

  const roadCompSizes = computeComponentSizes(edges, 'road');
  const railCompSizes = computeComponentSizes(edges, 'rail');

  const findClosest = (candidates: OsmNode[]) => {
    let best: OsmNode | null = null;
    let bestDist = Infinity;
    for (const n of candidates) {
      const d = haversineKm(startingCity.lat, startingCity.lng, n.lat, n.lng);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best ? { node: best, distKm: bestDist } : null;
  };

  const seedIds = new Set<string>();

  // Seed road if missing and road edges exist
  if (!hasConnectedRoad && roadEdgeNodeIds.size > 0) {
    const baseRoadPool = nodes.filter(
      (n) => n.mode !== 'rail' && roadEdgeNodeIds.has(n.id)
    );
    const rawPool = baseRoadPool.length > 0 ? baseRoadPool : nodes.filter((n) => n.mode !== 'rail');

    let maxRoadComp = 0;
    for (const n of rawPool) {
      const sz = roadCompSizes.get(n.id) || 0;
      if (sz > maxRoadComp) maxRoadComp = sz;
    }
    const minHealthyRoad = Math.min(8, maxRoadComp);
    const healthyRoadPool =
      maxRoadComp > 0
        ? rawPool.filter((n) => (roadCompSizes.get(n.id) || 0) >= minHealthyRoad)
        : rawPool;

    const primaryPick = findClosest(healthyRoadPool.length > 0 ? healthyRoadPool : rawPool);
    if (primaryPick) {
      seedIds.add(primaryPick.node.id);
    }
  }

  // Seed rail if missing and rail edges exist
  if (!hasConnectedRail && railEdgeNodeIds.size > 0) {
    const baseRailPool = nodes.filter((n) => railEdgeNodeIds.has(n.id));
    let maxRailComp = 0;
    for (const n of baseRailPool) {
      const sz = railCompSizes.get(n.id) || 0;
      if (sz > maxRailComp) maxRailComp = sz;
    }
    const minHealthyRail = Math.min(6, maxRailComp);
    const healthyRailPool =
      maxRailComp > 0
        ? baseRailPool.filter((n) => (railCompSizes.get(n.id) || 0) >= minHealthyRail)
        : baseRailPool;

    const railPick = findClosest(healthyRailPool.length > 0 ? healthyRailPool : baseRailPool);
    if (railPick && railPick.distKm <= 3.5) {
      seedIds.add(railPick.node.id);
    }
  }

  if (seedIds.size === 0) return nodes;
  return nodes.map((n) => (seedIds.has(n.id) ? { ...n, connected: true } : n));
}

export function getRegionalClusterKey(
  regionId: string,
  lat: number,
  lng: number
): 'KR' | 'JP' | 'US' | 'UK' | 'FR' | null {
  if (regionId.startsWith('curated_kr_')) return 'KR';
  if (regionId.startsWith('curated_jp_')) return 'JP';
  if (regionId.startsWith('curated_us_')) return 'US';
  if (regionId.startsWith('curated_uk_')) return 'UK';
  if (regionId.startsWith('curated_fr_')) return 'FR';

  if (lat >= 33.0 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9) return 'KR';
  if (
    (lat >= 30.0 && lat <= 45.6 && lng >= 129.5 && lng <= 146.0) ||
    (lat >= 24.0 && lat <= 28.5 && lng >= 122.5 && lng <= 132.0)
  ) {
    return 'JP';
  }
  if (lat >= 49.8 && lat <= 59.0 && lng >= -8.5 && lng <= 2.0) return 'UK';
  if (lat >= 41.3 && lat <= 51.2 && lng >= -5.2 && lng <= 9.6) return 'FR';
  if (lat >= 24.5 && lat <= 49.5 && lng >= -125.0 && lng <= -66.9) return 'US';
  return null;
}

function isPointInBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
  padDeg = 0
): boolean {
  return (
    lat >= bbox[0] - padDeg &&
    lat <= bbox[2] + padDeg &&
    lng >= bbox[1] - padDeg &&
    lng <= bbox[3] + padDeg
  );
}

function isPointInPolygonRing(lat: number, lng: number, ring: number[][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + (yj === yi ? 1e-12 : 0)) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygonCoords(lat: number, lng: number, rings: number[][][]): boolean {
  if (!rings || rings.length === 0) return false;
  if (!isPointInPolygonRing(lat, lng, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (isPointInPolygonRing(lat, lng, rings[i])) return false;
  }
  return true;
}

export function isPointInGeoJson(lat: number, lng: number, boundary: GeoJsonBoundary): boolean {
  if (boundary.type === 'Polygon') {
    return isPointInPolygonCoords(lat, lng, boundary.coordinates as number[][][]);
  }
  if (boundary.type === 'MultiPolygon') {
    const polys = boundary.coordinates as number[][][][];
    return polys.some((poly) => isPointInPolygonCoords(lat, lng, poly));
  }
  return false;
}

export function isPointInRegionBoundary(
  lat: number,
  lng: number,
  region: ProvincialRegion,
  padDeg = 0.002
): boolean {
  if (!isPointInBbox(lat, lng, region.bbox, padDeg)) {
    return false;
  }
  if (!region.boundaryGeoJson) {
    return true;
  }
  if (isPointInGeoJson(lat, lng, region.boundaryGeoJson)) {
    return true;
  }
  if (padDeg > 0) {
    const probeOffsets: Array<[number, number]> = [
      [padDeg, 0],
      [-padDeg, 0],
      [0, padDeg],
      [0, -padDeg],
    ];
    for (const [dLat, dLng] of probeOffsets) {
      if (isPointInGeoJson(lat + dLat, lng + dLng, region.boundaryGeoJson)) {
        return true;
      }
    }
  }
  return false;
}

function doBboxesTouchOrOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  padDeg = 0.045
): boolean {
  return (
    a[0] - padDeg <= b[2] &&
    a[2] + padDeg >= b[0] &&
    a[1] - padDeg <= b[3] &&
    a[3] + padDeg >= b[1]
  );
}

function bboxAreaDegSq(bbox: [number, number, number, number]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function isClusterCompatible(
  regionIdA: string,
  latA: number,
  lngA: number,
  regionIdB: string,
  latB: number,
  lngB: number
): boolean {
  const cA = getRegionalClusterKey(regionIdA, latA, lngA);
  const cB = getRegionalClusterKey(regionIdB, latB, lngB);
  if (cA && cB && cA !== cB) return false;
  return true;
}

export function isRegionExpandableFromUnlocked(
  region: ProvincialRegion,
  unlockedRegions: ProvincialRegion[]
): boolean {
  if (region.unlocked) return false;
  if (unlockedRegions.length === 0) return true;

  const rCluster = getRegionalClusterKey(region.regionId, region.centerLat, region.centerLng);
  for (const ur of unlockedRegions) {
    if (
      !isClusterCompatible(
        region.regionId,
        region.centerLat,
        region.centerLng,
        ur.regionId,
        ur.centerLat,
        ur.centerLng
      )
    ) {
      continue;
    }

    const distKm = haversineKm(region.centerLat, region.centerLng, ur.centerLat, ur.centerLng);
    if (ur.isKnownIsland || region.isKnownIsland) {
      // Island cities (e.g. Jejucity/Seogwipo) connect within Jeju or south-coast cities (Mokpo/Suncheon/Yeosu/Busan) <= 265km
      if (distKm <= 265) return true;
      continue;
    }

    if (doBboxesTouchOrOverlap(region.bbox, ur.bbox, 0.055)) {
      return true;
    }

    if (!rCluster && distKm <= 120) {
      return true;
    }
  }

  return false;
}

export function getExpandableProvincialRegions(state: GameState): ProvincialRegion[] {
  const regions = state.provincialRegions || [];
  const unlocked = regions.filter((r) => r.unlocked);
  return regions.filter((r) => !r.unlocked && isRegionExpandableFromUnlocked(r, unlocked));
}

export function computeRegionIsolation(
  bbox: [number, number, number, number],
  centerLat: number,
  centerLng: number,
  unlockedRegions: ProvincialRegion[],
  isKnownIsland?: boolean
): boolean {
  if (isKnownIsland) {
    // Adjacent cities on the SAME island (e.g. Jejucity <-> Seogwipo) bridge cleanly via coastal roads!
    const hasTouchingSameIsland = unlockedRegions.some(
      (ur) => ur.isKnownIsland && doBboxesTouchOrOverlap(bbox, ur.bbox, 0.055)
    );
    return !hasTouchingSameIsland;
  }
  if (unlockedRegions.length === 0) return false;
  for (const ur of unlockedRegions) {
    if (ur.isKnownIsland) continue;
    if (doBboxesTouchOrOverlap(bbox, ur.bbox, 0.045)) {
      return false;
    }
    if (haversineKm(centerLat, centerLng, ur.centerLat, ur.centerLng) <= 45) {
      return false;
    }
  }
  return true;
}

export function getRegionUnlockCost(state: GameState, region: ProvincialRegion): number {
  if (region.unlocked) return 0;
  const regions = state.provincialRegions || [];
  const unlocked = regions.filter((r) => r.unlocked);
  const unlockedCount = Math.max(1, unlocked.length);
  const isolated = computeRegionIsolation(
    region.bbox,
    region.centerLat,
    region.centerLng,
    unlocked,
    region.isKnownIsland
  );

  let minDistKm = 0;
  if (unlocked.length > 0) {
    minDistKm = Math.min(
      ...unlocked.map((ur) =>
        haversineKm(region.centerLat, region.centerLng, ur.centerLat, ur.centerLng)
      )
    );
  } else {
    minDistKm = haversineKm(
      region.centerLat,
      region.centerLng,
      state.startingCity.lat,
      state.startingCity.lng
    );
  }

  // Province/State-scale exponential curve (1.85^(unlocked-1)) scaled for 도/주 광역 행정구역
  const expFactor = Math.pow(1.85, unlockedCount - 1);
  const base = isolated ? 60000 * (1 + Math.min(4.0, minDistKm / 150)) : 18000;
  return Math.max(5000, Math.round((base * expFactor) / 100) * 100);
}

export function getRegionProgressStats(
  state: GameState,
  regionId: string
): {
  connectedCount: number;
  loadedCount: number;
  totalNodes: number;
  pct: number;
} {
  const region = (state.provincialRegions || []).find((r) => r.regionId === regionId);
  let loadedCount = 0;
  let connectedCount = 0;

  for (const n of state.osmNodes || []) {
    const matchesRegion =
      n.regionId === regionId ||
      (!n.regionId && region && isPointInRegionBoundary(n.lat, n.lng, region, 0.002));
    if (matchesRegion) {
      loadedCount += 1;
      if (n.connected) {
        connectedCount += 1;
      }
    }
  }

  const totalNodes = Math.max(region?.totalNodeCount || 0, loadedCount, connectedCount);
  const pct =
    totalNodes > 0 ? Math.min(100, Math.round((connectedCount / totalNodes) * 10000) / 100) : 0;

  return { connectedCount, loadedCount, totalNodes, pct };
}

interface RegionAccessIndex {
  regionsById: Map<string, ProvincialRegion>;
  unlocked: ProvincialRegion[];
  nodeUnlockedById: Map<string, { regionId?: string; lat: number; lng: number; val: boolean }>;
}

const regionAccessIndexCache = new WeakMap<ProvincialRegion[], RegionAccessIndex>();

function getRegionAccessIndex(regions: ProvincialRegion[]): RegionAccessIndex {
  let cached = regionAccessIndexCache.get(regions);
  if (cached) return cached;
  const regionsById = new Map<string, ProvincialRegion>();
  const unlocked: ProvincialRegion[] = [];
  for (const r of regions) {
    regionsById.set(r.regionId, r);
    if (r.unlocked) unlocked.push(r);
  }
  cached = {
    regionsById,
    unlocked,
    nodeUnlockedById: new Map(),
  };
  regionAccessIndexCache.set(regions, cached);
  return cached;
}

export function isNodeInUnlockedRegion(state: GameState, node: OsmNode): boolean {
  const regions = state.provincialRegions || [];
  const idx = getRegionAccessIndex(regions);
  if (idx.unlocked.length === 0) return true;

  if (node.regionId === '__locked_outside__') {
    return false;
  }

  const cached = idx.nodeUnlockedById.get(node.id);
  if (
    cached &&
    cached.regionId === node.regionId &&
    cached.lat === node.lat &&
    cached.lng === node.lng
  ) {
    return cached.val;
  }

  let val = false;
  if (node.regionId) {
    const known = idx.regionsById.get(node.regionId);
    if (known) {
      val = known.unlocked ? isPointInRegionBoundary(node.lat, node.lng, known, 0.002) : false;
      idx.nodeUnlockedById.set(node.id, {
        regionId: node.regionId,
        lat: node.lat,
        lng: node.lng,
        val,
      });
      return val;
    }
  }

  val = idx.unlocked.some((ur) => isPointInRegionBoundary(node.lat, node.lng, ur, 0.002));
  idx.nodeUnlockedById.set(node.id, {
    regionId: node.regionId,
    lat: node.lat,
    lng: node.lng,
    val,
  });
  return val;
}

function hasHangulText(value: string): boolean {
  return /[\uac00-\ud7af]/.test(value);
}

function normalizeAdminRegionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/특별자치도|특별자치시|특별시|광역시|자치도|자치시/g, '')
    .replace(/\b(province|state|prefecture|region|metropolitan city|special city|special self-governing province|special self-governing city|do|si)\b/g, '')
    .replace(/[-_.,·]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function getCanonicalAdminRegionKey(name: string, lat: number, lng: number): string | null {
  const norm = normalizeAdminRegionName(name);
  if (!norm) return null;

  const isKorea = lat >= 33.0 && lat <= 38.9 && lng >= 124.4 && lng <= 132.0;
  if (isKorea) {
    if (norm === '서울' || norm === 'seoul') return 'kr_seoul';
    if (norm === '경기' || norm === '경기도' || norm === 'gyeonggi' || norm === 'gyeonggido') return 'kr_gyeonggi';
    if (norm === '인천' || norm === 'incheon') return 'kr_incheon';
    if (norm === '강원' || norm === '강원도' || norm === 'gangwon' || norm === 'gangwondo') return 'kr_gangwon';
    if (norm === '충북' || norm === '충청북' || norm === '충청북도' || norm === 'chungbuk' || norm === 'chungcheongbuk' || norm === 'chungcheongbukdo' || norm === 'northchungcheong') return 'kr_chungbuk';
    if (norm === '충남' || norm === '충청남' || norm === '충청남도' || norm === 'chungnam' || norm === 'chungcheongnam' || norm === 'chungcheongnamdo' || norm === 'southchungcheong') return 'kr_chungnam';
    if (norm === '대전' || norm === 'daejeon') return 'kr_daejeon';
    if (norm === '세종' || norm === 'sejong') return 'kr_sejong';
    if (norm === '전북' || norm === '전라북' || norm === '전라북도' || norm === 'jeonbuk' || norm === 'jeollabuk' || norm === 'jeollabukdo' || norm === 'northjeolla') return 'kr_jeonbuk';
    if (norm === '전남' || norm === '전라남' || norm === '전라남도' || norm === 'jeonnam' || norm === 'jeollanam' || norm === 'jeollanamdo' || norm === 'southjeolla') return 'kr_jeonnam';
    if (norm === '광주' || norm === 'gwangju') return 'kr_gwangju';
    if (norm === '경북' || norm === '경상북' || norm === '경상북도' || norm === 'gyeongbuk' || norm === 'gyeongsangbuk' || norm === 'gyeongsangbukdo' || norm === 'northgyeongsang') return 'kr_gyeongbuk';
    if (norm === '경남' || norm === '경상남' || norm === '경상남도' || norm === 'gyeongnam' || norm === 'gyeongsangnam' || norm === 'gyeongsangnamdo' || norm === 'southgyeongsang') return 'kr_gyeongnam';
    if (norm === '대구' || norm === 'daegu') return 'kr_daegu';
    if (norm === '울산' || norm === 'ulsan') return 'kr_ulsan';
    if (norm === '부산' || norm === 'busan') return 'kr_busan';
    if (norm === '제주' || norm === '제주도' || norm === 'jeju' || norm === 'jejudo') return 'kr_jeju';
  }

  // Known non-KR curated names
  if (norm.includes('tokyo') || norm.includes('東京都')) return 'jp_tokyo';
  if (norm.includes('kanagawa') || norm.includes('神奈川')) return 'jp_kanagawa';
  if (norm.includes('chiba') || norm.includes('千葉')) return 'jp_chiba';
  if (norm.includes('saitama') || norm.includes('埼玉')) return 'jp_saitama';
  if (norm.includes('osaka') || norm.includes('大阪')) return 'jp_osaka';
  if (norm.includes('kyoto') || norm.includes('京都')) return 'jp_kyoto';
  if (norm.includes('hyogo') || norm.includes('兵庫')) return 'jp_hyogo';
  if (norm.includes('aichi') || norm.includes('愛知')) return 'jp_aichi';
  if (norm.includes('fukuoka') || norm.includes('福岡')) return 'jp_fukuoka';
  if (norm.includes('hokkaido') || norm.includes('北海道')) return 'jp_hokkaido';
  if (norm.includes('okinawa') || norm.includes('沖縄')) return 'jp_okinawa';
  if (norm === 'newyork' && lat > 40) return 'us_ny';
  if (norm === 'newjersey') return 'us_nj';
  if (norm === 'california') return 'us_ca';
  if (norm === 'washington' && lng < -100) return 'us_wa';
  if (norm === 'texas') return 'us_tx';
  if (norm === 'illinois') return 'us_il';
  if (norm === 'massachusetts') return 'us_ma';
  if (norm === 'greaterlondon' || norm === 'london') return 'uk_london';
  if (norm === 'southeastengland') return 'uk_southeast';
  if (norm === 'scotland') return 'uk_scotland';
  if (norm === 'iledefrance' || norm === 'îledefrance') return 'fr_idf';
  if (norm === 'auvergnerhonealpes' || norm === 'auvergnerhônealpes') return 'fr_ara';

  return null;
}

function computeBboxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interMinLat = Math.max(a[0], b[0]);
  const interMinLng = Math.max(a[1], b[1]);
  const interMaxLat = Math.min(a[2], b[2]);
  const interMaxLng = Math.min(a[3], b[3]);
  if (interMaxLat <= interMinLat || interMaxLng <= interMinLng) return 0;
  const interArea = (interMaxLat - interMinLat) * (interMaxLng - interMinLng);
  const unionArea = bboxAreaDegSq(a) + bboxAreaDegSq(b) - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function isRealOsmBoundaryMeta(meta: {
  regionId: string;
  boundaryGeoJson?: GeoJsonBoundary;
  hasRealOsmBoundary?: boolean;
}): boolean {
  if (meta.hasRealOsmBoundary) return true;
  return (
    !meta.regionId.startsWith('curated_') &&
    !meta.regionId.startsWith('osm_prov_') &&
    Boolean(meta.boundaryGeoJson)
  );
}

function areSameProvincialRegion(
  a: Pick<ProvincialRegion, 'regionId' | 'regionName' | 'bbox' | 'centerLat' | 'centerLng'>,
  b: Pick<ProvincialRegion, 'regionId' | 'regionName' | 'bbox' | 'centerLat' | 'centerLng'>
): boolean {
  if (a.regionId === b.regionId) return true;

  const keyA = getCanonicalAdminRegionKey(a.regionName, a.centerLat, a.centerLng);
  const keyB = getCanonicalAdminRegionKey(b.regionName, b.centerLat, b.centerLng);
  if (keyA && keyB && keyA === keyB) return true;

  const distKm = haversineKm(a.centerLat, a.centerLng, b.centerLat, b.centerLng);
  const normA = normalizeAdminRegionName(a.regionName);
  const normB = normalizeAdminRegionName(b.regionName);
  if (normA && normB && (normA === normB || normA.includes(normB) || normB.includes(normA)) && distKm <= 150) {
    return true;
  }

  // Enclave cities (e.g. Seoul inside Gyeonggi) have small bbox overlap IoU; require high IoU (>= 0.45) to merge by geometry
  const iou = computeBboxIoU(a.bbox, b.bbox);
  if (iou >= 0.45 && distKm <= 55) {
    return true;
  }

  return false;
}

function mergeTwoProvincialRegions(
  existing: ProvincialRegion,
  incoming: ProvincialRegion
): ProvincialRegion {
  const preferIncomingId = !existing.regionId.startsWith('curated_') && incoming.regionId.startsWith('curated_');
  const chosenId = preferIncomingId ? incoming.regionId : existing.regionId;

  const chosenName =
    existing.regionId.startsWith('curated_') && hasHangulText(existing.regionName)
      ? existing.regionName
      : incoming.regionId.startsWith('curated_') && hasHangulText(incoming.regionName)
      ? incoming.regionName
      : hasHangulText(existing.regionName)
      ? existing.regionName
      : hasHangulText(incoming.regionName)
      ? incoming.regionName
      : existing.regionName;

  const existingReal = isRealOsmBoundaryMeta(existing);
  const incomingReal = isRealOsmBoundaryMeta(incoming);
  const useIncomingGeom =
    (incomingReal && !existingReal) ||
    (incomingReal && existingReal && Boolean(incoming.boundaryGeoJson)) ||
    (!existing.boundaryGeoJson && Boolean(incoming.boundaryGeoJson));

  return {
    regionId: chosenId,
    regionName: chosenName,
    adminLevel: useIncomingGeom ? incoming.adminLevel : existing.adminLevel || incoming.adminLevel,
    bbox: useIncomingGeom ? incoming.bbox : existing.bbox,
    boundaryGeoJson: useIncomingGeom
      ? incoming.boundaryGeoJson || existing.boundaryGeoJson
      : existing.boundaryGeoJson || incoming.boundaryGeoJson,
    hasRealOsmBoundary: existingReal || incomingReal,
    centerLat: useIncomingGeom ? incoming.centerLat : existing.centerLat,
    centerLng: useIncomingGeom ? incoming.centerLng : existing.centerLng,
    unlocked: existing.unlocked || incoming.unlocked,
    isStartingRegion: Boolean(existing.isStartingRegion || incoming.isStartingRegion),
    isIsolated: existing.unlocked || incoming.unlocked ? false : existing.isIsolated && incoming.isIsolated,
    isKnownIsland: Boolean(existing.isKnownIsland || incoming.isKnownIsland),
    totalNodeCount: Math.max(existing.totalNodeCount || 0, incoming.totalNodeCount || 0) || undefined,
  };
}

export function deduplicateProvincialRegions(regions: ProvincialRegion[]): ProvincialRegion[] {
  const result: ProvincialRegion[] = [];
  for (const reg of regions) {
    const idx = result.findIndex((r) => areSameProvincialRegion(r, reg));
    if (idx < 0) {
      result.push(reg);
    } else {
      result[idx] = mergeTwoProvincialRegions(result[idx], reg);
    }
  }
  return result;
}

export function registerStartingProvincialRegion(
  state: GameState,
  meta: {
    regionId: string;
    regionName: string;
    adminLevel: string;
    bbox: [number, number, number, number];
    boundaryGeoJson?: GeoJsonBoundary;
    centerLat: number;
    centerLng: number;
    totalNodeCount?: number;
  }
): GameState {
  const regions = state.provincialRegions || [];
  const existingStart = regions.find((r) => r.isStartingRegion);
  const canonicalMatch = regions.find(
    (r) =>
      r.regionId === meta.regionId ||
      areSameProvincialRegion(r, {
        regionId: meta.regionId,
        regionName: meta.regionName,
        bbox: meta.bbox,
        centerLat: meta.centerLat,
        centerLng: meta.centerLng,
      })
  );
  const oldStartId = existingStart?.regionId;
  const resolvedStartId =
    canonicalMatch?.regionId.startsWith('curated_')
      ? canonicalMatch.regionId
      : existingStart?.regionId.startsWith('curated_')
      ? existingStart.regionId
      : meta.regionId;
  const resolvedStartName =
    hasHangulText(canonicalMatch?.regionName || '')
      ? canonicalMatch!.regionName
      : hasHangulText(existingStart?.regionName || '')
      ? existingStart!.regionName
      : meta.regionName;

  const filtered = regions.filter((r) => {
    if (r.isStartingRegion) return false;
    if (canonicalMatch && r.regionId === canonicalMatch.regionId) return false;
    if (
      r.regionId.startsWith('curated_') &&
      (r.regionId === meta.regionId ||
        areSameProvincialRegion(r, {
          regionId: meta.regionId,
          regionName: meta.regionName,
          bbox: meta.bbox,
          centerLat: meta.centerLat,
          centerLng: meta.centerLng,
        }))
    ) {
      return false;
    }
    return true;
  });

  const unlockedStart: ProvincialRegion = {
    regionId: resolvedStartId,
    regionName: resolvedStartName,
    adminLevel: meta.adminLevel,
    bbox: meta.bbox,
    boundaryGeoJson: meta.boundaryGeoJson || canonicalMatch?.boundaryGeoJson || existingStart?.boundaryGeoJson,
    hasRealOsmBoundary: isRealOsmBoundaryMeta(meta) || existingStart?.hasRealOsmBoundary || canonicalMatch?.hasRealOsmBoundary,
    centerLat: meta.centerLat,
    centerLng: meta.centerLng,
    unlocked: true,
    isStartingRegion: true,
    isIsolated: false,
    isKnownIsland: existingStart?.isKnownIsland || canonicalMatch?.isKnownIsland,
    totalNodeCount:
      Math.max(meta.totalNodeCount || 0, existingStart?.totalNodeCount || 0, canonicalMatch?.totalNodeCount || 0) ||
      undefined,
  };

  const retaggedNodes = (state.osmNodes || []).map((n) => {
    if (!n.regionId || (oldStartId && n.regionId === oldStartId)) {
      return isPointInRegionBoundary(n.lat, n.lng, unlockedStart, 0.002)
        ? { ...n, regionId: resolvedStartId }
        : { ...n, regionId: '__locked_outside__' };
    }
    return n;
  });
  const retaggedEdges = (state.osmEdges || []).map((e) =>
    !e.regionId || (oldStartId && e.regionId === oldStartId)
      ? { ...e, regionId: resolvedStartId }
      : e
  );

  const mergedRegions = deduplicateProvincialRegions([unlockedStart, ...filtered]);
  const unlockedList = mergedRegions.filter((u) => u.unlocked);
  const updatedRegions = mergedRegions.map((r) =>
    r.unlocked
      ? r
      : {
          ...r,
          isIsolated: computeRegionIsolation(
            r.bbox,
            r.centerLat,
            r.centerLng,
            unlockedList,
            r.isKnownIsland
          ),
        }
  );

  return {
    ...state,
    provincialRegions: updatedRegions,
    osmNodes: retaggedNodes,
    osmEdges: retaggedEdges,
  };
}

export function registerDiscoveredProvincialRegion(
  state: GameState,
  meta: {
    regionId: string;
    regionName: string;
    adminLevel: string;
    bbox: [number, number, number, number];
    boundaryGeoJson?: GeoJsonBoundary;
    centerLat: number;
    centerLng: number;
    isKnownIsland?: boolean;
    totalNodeCount?: number;
  }
): GameState {
  const regions = state.provincialRegions || [];
  const isIncomingRealOsm = isRealOsmBoundaryMeta(meta);
  const unlocked = regions.filter((r) => r.unlocked);

  const canonicalMatch = regions.find(
    (r) =>
      r.regionId === meta.regionId ||
      areSameProvincialRegion(r, {
        regionId: meta.regionId,
        regionName: meta.regionName,
        bbox: meta.bbox,
        centerLat: meta.centerLat,
        centerLng: meta.centerLng,
      })
  );

  if (canonicalMatch) {
    const shouldUpgradeBoundary =
      (isIncomingRealOsm && !canonicalMatch.hasRealOsmBoundary) ||
      (Boolean(meta.boundaryGeoJson) && !canonicalMatch.boundaryGeoJson) ||
      (meta.totalNodeCount || 0) > (canonicalMatch.totalNodeCount || 0);
    if (!shouldUpgradeBoundary) {
      return state;
    }

    const updated = regions.map((r) => {
      if (r.regionId !== canonicalMatch.regionId) return r;
      const keepCuratedName = r.regionId.startsWith('curated_') && hasHangulText(r.regionName);
      const nextName = keepCuratedName
        ? r.regionName
        : hasHangulText(r.regionName)
        ? r.regionName
        : hasHangulText(meta.regionName)
        ? meta.regionName
        : r.regionName;
      const upgradeGeom = isIncomingRealOsm || !r.boundaryGeoJson;
      const nextBbox = upgradeGeom ? meta.bbox : r.bbox;
      const nextCenterLat = upgradeGeom ? meta.centerLat : r.centerLat;
      const nextCenterLng = upgradeGeom ? meta.centerLng : r.centerLng;
      return {
        ...r,
        regionName: nextName,
        adminLevel: upgradeGeom ? meta.adminLevel : r.adminLevel,
        bbox: nextBbox,
        boundaryGeoJson: upgradeGeom
          ? meta.boundaryGeoJson || r.boundaryGeoJson
          : r.boundaryGeoJson || meta.boundaryGeoJson,
        hasRealOsmBoundary: r.hasRealOsmBoundary || isIncomingRealOsm,
        centerLat: nextCenterLat,
        centerLng: nextCenterLng,
        totalNodeCount: Math.max(r.totalNodeCount || 0, meta.totalNodeCount || 0) || undefined,
        isIsolated: r.unlocked
          ? r.isIsolated
          : computeRegionIsolation(
              nextBbox,
              nextCenterLat,
              nextCenterLng,
              unlocked,
              r.isKnownIsland || meta.isKnownIsland
            ),
      };
    });
    return { ...state, provincialRegions: deduplicateProvincialRegions(updated) };
  }

  const anchor = unlocked.find((r) => r.isStartingRegion) || unlocked[0];
  if (anchor) {
    if (
      !isClusterCompatible(
        meta.regionId,
        meta.centerLat,
        meta.centerLng,
        anchor.regionId,
        anchor.centerLat,
        anchor.centerLng
      )
    ) {
      return state;
    }
    const minDistToKnown = Math.min(
      ...regions.map((r) => haversineKm(meta.centerLat, meta.centerLng, r.centerLat, r.centerLng))
    );
    if (minDistToKnown > 280) {
      return state;
    }
  }

  const newRegion: ProvincialRegion = {
    regionId: meta.regionId,
    regionName: meta.regionName,
    adminLevel: meta.adminLevel,
    bbox: meta.bbox,
    boundaryGeoJson: meta.boundaryGeoJson,
    hasRealOsmBoundary: isIncomingRealOsm,
    centerLat: meta.centerLat,
    centerLng: meta.centerLng,
    unlocked: false,
    isKnownIsland: meta.isKnownIsland,
    totalNodeCount: meta.totalNodeCount,
    isIsolated: computeRegionIsolation(
      meta.bbox,
      meta.centerLat,
      meta.centerLng,
      unlocked,
      meta.isKnownIsland
    ),
  };

  return {
    ...state,
    provincialRegions: deduplicateProvincialRegions([...regions, newRegion]),
  };
}

export function buildInitialProvincialRegions(startingCity: StartingCity): ProvincialRegion[] {
  const isJejuStart =
    startingCity.lat >= 33.15 &&
    startingCity.lat <= 33.6 &&
    startingCity.lng >= 126.1 &&
    startingCity.lng <= 127.0;

  const curatedMatches = CURATED_PROVINCIAL_REGIONS.filter((c) =>
    isPointInRegionBoundary(startingCity.lat, startingCity.lng, {
      ...c,
      unlocked: false,
      isIsolated: false,
    }, 0)
  ).sort((a, b) => bboxAreaDegSq(a.bbox) - bboxAreaDegSq(b.bbox));

  const curatedStartMatch =
    curatedMatches[0] ||
    CURATED_PROVINCIAL_REGIONS.find(
      (c) => haversineKm(startingCity.lat, startingCity.lng, c.centerLat, c.centerLng) < 15
    );

  const fallbackBbox: [number, number, number, number] = [
    startingCity.lat - 0.08,
    startingCity.lng - 0.1,
    startingCity.lat + 0.08,
    startingCity.lng + 0.1,
  ];

  const startingRegion: ProvincialRegion = curatedStartMatch
    ? {
        ...curatedStartMatch,
        unlocked: true,
        isStartingRegion: true,
        isIsolated: false,
        isKnownIsland: isJejuStart || curatedStartMatch.isKnownIsland,
      }
    : {
        regionId: `start_${startingCity.id}`,
        regionName: startingCity.name.split(' ')[0],
        adminLevel: '4',
        bbox: fallbackBbox,
        centerLat: startingCity.lat,
        centerLng: startingCity.lng,
        unlocked: true,
        isStartingRegion: true,
        isIsolated: false,
        isKnownIsland: isJejuStart,
      };

  const startCluster = getRegionalClusterKey(
    startingRegion.regionId,
    startingRegion.centerLat,
    startingRegion.centerLng
  );

  const others: ProvincialRegion[] =
    startCluster === null
      ? []
      : CURATED_PROVINCIAL_REGIONS.filter(
          (c) =>
            c.regionId !== startingRegion.regionId &&
            getRegionalClusterKey(c.regionId, c.centerLat, c.centerLng) === startCluster
        ).map((c) => ({
          ...c,
          unlocked: false,
          isIsolated: computeRegionIsolation(
            c.bbox,
            c.centerLat,
            c.centerLng,
            [startingRegion],
            c.isKnownIsland
          ),
        }));

  return [startingRegion, ...others];
}

export function scopeGameStateToStartingCity(state: GameState): GameState {
  const cityId = state.startingCity.id;
  const nodes = (state.nodes || []).filter((n) => n.cityId === cityId);

  // Strip removed milestone lines/towns & legacy landmark achievements
  const baselineAchs = buildAchievements([], state.startingCity);
  const savedAchMap = new Map((state.achievements || []).map((a) => [a.id, a]));
  const achievements: Achievement[] = baselineAchs.map((baseAch) => {
    const prev = savedAchMap.get(baseAch.id);
    return prev?.unlocked ? { ...baseAch, unlocked: true } : baseAch;
  });

  // Migrate Skills cleanly to the expanded 64-node Antimatter Dimensions tree
  const savedSkillMap = new Map((state.skills || []).map((s) => [s.id, s]));
  const skills: SkillNode[] = INITIAL_SKILLS.map((def) => {
    const prev = savedSkillMap.get(def.id);
    const preservedLevel = prev ? Math.min(def.maxLevel, Math.max(0, prev.level || 0)) : 0;
    return {
      ...def,
      requires: [...def.requires],
      level: preservedLevel,
    };
  });

  const seededBaselineRegions = buildInitialProvincialRegions(state.startingCity);
  const startAnchor = seededBaselineRegions[0];
  const startCluster = getRegionalClusterKey(
    startAnchor.regionId,
    startAnchor.centerLat,
    startAnchor.centerLng
  );
  const curatedById = new Map(CURATED_PROVINCIAL_REGIONS.map((c) => [c.regionId, c]));

  let provincialRegions: ProvincialRegion[];
  if (Array.isArray(state.provincialRegions) && state.provincialRegions.length > 0) {
    const cleaned = state.provincialRegions
      .filter((r) => {
        if (r.unlocked) return true;
        if (startCluster) {
          const rc = getRegionalClusterKey(r.regionId, r.centerLat, r.centerLng);
          if (rc && rc !== startCluster) return false;
        }
        return true;
      })
      .map((r) => {
        const curated = curatedById.get(r.regionId);
        if (curated && !r.hasRealOsmBoundary) {
          return {
            ...r,
            regionName: curated.regionName,
            adminLevel: curated.adminLevel,
            bbox: curated.bbox,
            boundaryGeoJson: curated.boundaryGeoJson,
            centerLat: curated.centerLat,
            centerLng: curated.centerLng,
            isKnownIsland: r.isKnownIsland || curated.isKnownIsland,
          };
        }
        return curated && !r.boundaryGeoJson
          ? { ...r, boundaryGeoJson: curated.boundaryGeoJson, adminLevel: curated.adminLevel }
          : r;
      });
    const dedupedCleaned = deduplicateProvincialRegions(cleaned);
    const missingFromBaseline = seededBaselineRegions.filter(
      (b) => !b.unlocked && !dedupedCleaned.some((r) => areSameProvincialRegion(r, b))
    );
    const combined = deduplicateProvincialRegions([...dedupedCleaned, ...missingFromBaseline]);
    const unlockedCombined = combined.filter((r) => r.unlocked);
    provincialRegions = combined.map((r) =>
      r.unlocked
        ? r
        : {
            ...r,
            isIsolated: computeRegionIsolation(
              r.bbox,
              r.centerLat,
              r.centerLng,
              unlockedCombined,
              r.isKnownIsland
            ),
          }
    );
  } else {
    provincialRegions = seededBaselineRegions;
  }

  const pendingSeedRegionIds = Array.isArray(state.pendingSeedRegionIds)
    ? state.pendingSeedRegionIds
    : [];

  const unlockedRegions = provincialRegions.filter((r) => r.unlocked);
  const startRegion =
    unlockedRegions.find((r) => r.isStartingRegion) || unlockedRegions[0];

  const taggedNodes = (state.osmNodes || []).map((n) => {
    if (n.regionId) return n;
    if (!startRegion) return n;
    const match = unlockedRegions.find((ur) => isPointInRegionBoundary(n.lat, n.lng, ur, 0.002));
    return { ...n, regionId: match ? match.regionId : '__locked_outside__' };
  });
  const taggedEdges = (state.osmEdges || []).map((e) =>
    e.regionId || !startRegion ? e : { ...e, regionId: startRegion.regionId }
  );

  const hasConnectedNodes = taggedNodes.some((n) => n.connected);
  const startPendingManualSeed =
    !hasConnectedNodes &&
    Boolean(startRegion && pendingSeedRegionIds.includes(startRegion.regionId));

  let seededOsmNodes = taggedNodes;
  if (!startPendingManualSeed) {
    const unlockedPoolForSeed = taggedNodes.filter((n) => {
      const rid = n.regionId;
      if (rid === '__locked_outside__') return false;
      if (rid) {
        const known = provincialRegions.find((r) => r.regionId === rid);
        if (known) return known.unlocked && isPointInRegionBoundary(n.lat, n.lng, known, 0.002);
      }
      return unlockedRegions.some((ur) => isPointInRegionBoundary(n.lat, n.lng, ur, 0.002));
    });
    const seededUnlockedIds = new Set(
      ensureSeedConnectedOsmNodes(
        unlockedPoolForSeed,
        taggedEdges,
        state.startingCity
      )
        .filter((n) => n.connected)
        .map((n) => n.id)
    );
    seededOsmNodes = taggedNodes.map((n) =>
      seededUnlockedIds.has(n.id) ? { ...n, connected: true } : n
    );
  }

  const nextState: GameState = {
    ...state,
    skillPoints: 0,
    prestigeMultiplier: 1,
    nodes,
    lines: [],
    segments: [],
    upgrades: [],
    skills,
    osmNodes: seededOsmNodes,
    osmEdges: taggedEdges,
    loadedOsmRegions: Array.isArray(state.loadedOsmRegions) ? state.loadedOsmRegions : [],
    provincialRegions,
    pendingSeedRegionIds,
    achievements,
    minigames: backfillMinigamesState(state.minigames),
    stats: {
      ...state.stats,
      connectedOsmNodes: seededOsmNodes.filter((n) => n.connected).length,
      totalLinesCompleted: 0,
      totalTownsCompleted: 0,
      prestigeCount: 0,
    },
  };
  const metrics = recomputeNetworkMetrics(nextState);
  return {
    ...nextState,
    stats: {
      ...nextState.stats,
      mapped1to1Km: metrics.mapped1to1Km,
      totalNetworkKm: metrics.totalNetworkKm,
      connectedOsmNodes: metrics.connectedOsmNodes,
      totalScaledNodes: metrics.totalScaledNodes,
    },
  };
}

export function createInitialGameState(
  startingCity: StartingCity,
  customNetwork?: {
    nodes: MapNode[];
    lines: TransportLine[];
    segments: PredefinedSegment[];
  },
  _carryOverPrestige?: { prestigeCount: number; prestigeMultiplier: number }
): GameState {
  const cityId = startingCity.id;

  const nodes: MapNode[] = [
    ...CURATED_NODES.filter((n) => n.cityId === cityId).map((n) => ({ ...n })),
    ...(customNetwork?.nodes.map((n) => ({ ...n })) || []),
  ];

  const primaryHub =
    nodes.find((n) => n.cityId === startingCity.id && n.isHub) ||
    nodes.find((n) => n.cityId === startingCity.id);
  if (primaryHub) {
    primaryHub.connected = true;
  }

  const skills: SkillNode[] = INITIAL_SKILLS.map((sk) => ({
    ...sk,
    requires: [...sk.requires],
  }));

  const upgrades: UpgradeItem[] = INITIAL_UPGRADES.map((u) => ({
    ...u,
    unlockRequirement: u.unlockRequirement ? { ...u.unlockRequirement } : undefined,
  }));

  const achievements = buildAchievements([], startingCity);
  const provincialRegions = buildInitialProvincialRegions(startingCity);

  return {
    startingCity,
    capital: 1200,
    totalLifetimeEarnings: 0,
    skillPoints: 0,
    prestigeMultiplier: 1,
    nodes,
    segments: [],
    lines: [],
    osmNodes: [],
    osmEdges: [],
    loadedOsmChunks: [],
    loadedOsmRegions: [],
    provincialRegions,
    pendingSeedRegionIds: [],
    completedOsmWays: [],
    upgrades,
    skills,
    achievements,
    units: [],
    stats: {
      totalSegmentsBuilt: 0,
      totalOsmEdgesBuilt: 0,
      connectedOsmNodes: 0,
      totalScaledNodes: 0,
      totalLinesCompleted: 0,
      totalTownsCompleted: 0,
      totalClicks: 0,
      mapped1to1Km: 0,
      totalNetworkKm: 0,
      prestigeCount: 0,
    },
    settings: {
      soundEnabled: true,
      mapTileLayer: 'dark',
    },
    lastTickTimestamp: Date.now(),
    minigames: createInitialMinigamesState(),
  };
}

export function getNodeBuildCostScaleMult(connectedNodeCount: number): number {
  const nAbove = Math.max(0, connectedNodeCount - 1);
  return Number((1 + nAbove * 0.015 + Math.pow(nAbove / 35, 1.3)).toFixed(4));
}

export function calculateMultipliers(state: GameState): ActiveMultipliers {
  const skillLevels = new Map<string, number>();
  for (const s of state.skills) {
    if (s.level > 0) skillLevels.set(s.id, s.level);
  }
  const sk = (id: string) => skillLevels.get(id) || 0;

  // Build cost reduction from studies ([21], [41], [53], [74], [83], [143]) - capped so total costs never collapse
  const costFactor =
    Math.pow(0.95, sk('sk_root_l')) *
    Math.pow(0.94, sk('sk_infra_1')) *
    Math.pow(0.95, sk('sk_re_2')) *
    Math.pow(0.94, sk('sk_infra_cost2')) *
    Math.pow(0.94, sk('sk_commerce_3')) *
    Math.pow(0.93, sk('sk_quantum_dispatch'));
  const buildCostMult = Math.max(0.15, costFactor);

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const actualConnectedNodes = Math.max(
    state.stats?.connectedOsmNodes || 0,
    graphIdx.connectedCount
  );
  const nodeBuildCostScaleMult = getNodeBuildCostScaleMult(actualConnectedNodes);

  // Strictly 1:1 km & node counts (never inflated)
  const networkKmMult = 1;
  const nodeScaleMult = 1;

  // Achievement % bonus amplified by [75] sk_ach_amp (heavily nerfed from 0.25 -> 0.06)
  let achievementIncomePct = 0;
  for (const ach of state.achievements) {
    if (ach.unlocked) achievementIncomePct += ach.bonusIncomePct;
  }
  const achAmp = 1 + sk('sk_ach_amp') * 0.12;
  const achMult = 1 + (achievementIncomePct * achAmp) / 100;

  const connectedNodes = Math.max(0, state.stats.connectedOsmNodes || 0);
  const builtEdges = Math.max(0, state.stats.totalOsmEdgesBuilt || 0);
  const mappedKm = Math.max(0, state.stats.mapped1to1Km || 0);
  const unlockedCitiesCount = Math.max(
    1,
    (state.provincialRegions || []).filter((r) => r.unlocked).length
  );

  // Sublinear, capped scale-sensitive multipliers (prevent late-game exponential runaway)
  const edgeSynergyMult = 1 + sk('sk_infra_regional') * Math.min(2.5, Math.sqrt(builtEdges) * 0.04);
  const nodeGeoMult = 1 + sk('sk_scale_nodes') * Math.min(3.0, Math.sqrt(connectedNodes) * 0.03);
  const citySynergyMult = 1 + sk('sk_city_synergy') * (unlockedCitiesCount - 1) * 0.08;
  const kmExpMult = 1 + sk('sk_km_exponential') * 0.15 * Math.log10(1 + mappedKm);

  // Rebalanced Study Tree multipliers (Tier 1 -> Tier 16) - Balanced Moderate Buff
  const treeGlobalMult =
    Math.pow(1.10, sk('sk_root_0')) *
    Math.pow(1.09, sk('sk_trunk_1')) *
    Math.pow(1.10, sk('sk_trunk_2')) *
    Math.pow(1.10, sk('sk_speed_1')) *
    Math.pow(1.09, sk('sk_re_2')) *
    Math.pow(1.12, sk('sk_infra_5')) *
    Math.pow(1.18, sk('sk_infra_6')) *
    Math.pow(1.12, sk('sk_speed_3')) *
    Math.pow(1.11, sk('sk_freight_dispatch')) *
    Math.pow(1.14, sk('sk_speed_4')) *
    Math.pow(1.18, sk('sk_speed_5')) *
    Math.pow(1.12, sk('sk_commerce_2')) *
    Math.pow(1.11, sk('sk_commerce_3')) *
    Math.pow(1.12, sk('sk_re_4')) *
    Math.pow(1.15, sk('sk_re_5')) *
    Math.pow(1.20, sk('sk_commerce_apex')) *
    (sk('sk_multi_path') > 0 ? 2.0 : 1) *
    Math.pow(1.18, sk('sk_crown_1')) *
    Math.pow(1.20, sk('sk_subsea_tunnel')) *
    Math.pow(1.24, sk('sk_crown_2')) *
    Math.pow(1.16, sk('sk_commerce_mega')) *
    Math.pow(1.28, sk('sk_quantum_dispatch')) *
    Math.pow(1.32, sk('sk_dyson_grid')) *
    Math.pow(1.30, sk('sk_terra_logistics')) *
    Math.pow(1.38, sk('sk_crown_3')) *
    edgeSynergyMult *
    nodeGeoMult *
    citySynergyMult *
    kmExpMult;

  const rawMg = getMinigameIncomeBoost(state.minigames);
  const mgSynergyMult = 1 + sk('sk_mg_synergy') * 0.12;
  const effectiveMgBoostPct = rawMg.boostPct * mgSynergyMult;
  const effectiveMgMult = 1 + effectiveMgBoostPct / 100;

  const globalIncomeMult = treeGlobalMult * achMult * effectiveMgMult;

  const roadIncomeMult = Math.pow(1.12, sk('sk_infra_3'));
  const railIncomeMult = Math.pow(1.15, sk('sk_double_track')) * Math.pow(1.10, sk('sk_speed_3'));

  const osmNodeIncomeMult =
    (1 +
      sk('sk_trunk_1') * 0.18 +
      sk('sk_node_yield') * 0.15 +
      sk('sk_re_1') * 0.2) *
    Math.pow(1.10, sk('sk_infra_2')) *
    Math.pow(1.12, sk('sk_infra_4')) *
    Math.pow(1.12, sk('sk_interchange_grid')) *
    Math.pow(1.15, sk('sk_commerce_1')) *
    Math.pow(1.18, sk('sk_re_3')) *
    Math.pow(1.20, sk('sk_commerce_mega')) *
    Math.pow(1.25, sk('sk_planetary_nodes')) *
    Math.pow(1.22, sk('sk_crown_3')) *
    globalIncomeMult;

  const junctionFlatPerNode =
    (sk('sk_node_yield') * 1.0 + sk('sk_interchange_grid') * 4.0) * globalIncomeMult;

  const clickBonusMult =
    (1 + sk('sk_root_r') * 0.25) *
    Math.pow(1.12, sk('sk_snap_tool')) *
    Math.pow(1.2, sk('sk_speed_2')) *
    Math.pow(1.22, sk('sk_speed_4')) *
    Math.pow(1.12, sk('sk_subsea_tunnel')) *
    Math.pow(1.25, sk('sk_terra_logistics'));
  const clickDpsSeconds = 1.6 + sk('sk_speed_2') * 0.2;
  const edgeCashbackFlat =
    sk('sk_snap_tool') * 8 +
    sk('sk_commerce_2') * 25 +
    sk('sk_commerce_apex') * 60;

  const offlineEfficiencyMult = 1 + sk('sk_re_4') * 0.1;
  const prestigeBonusMult = 1;

  return {
    buildCostMult,
    nodeBuildCostScaleMult,
    networkKmMult,
    nodeScaleMult,
    globalIncomeMult,
    roadIncomeMult,
    railIncomeMult,
    osmNodeIncomeMult,
    junctionFlatPerNode,
    clickBonusMult,
    clickDpsSeconds,
    edgeCashbackFlat,
    offlineEfficiencyMult,
    prestigeBonusMult,
    minigameBoostPct: effectiveMgBoostPct,
    minigameIncomeMult: effectiveMgMult,
  };
}

export function getSegmentBuildCost(
  segment: PredefinedSegment,
  mults: ActiveMultipliers
): number {
  return Math.max(40, Math.round(segment.buildCost * mults.buildCostMult));
}

export function getSegmentUpgradeCost(
  segment: PredefinedSegment,
  mults: ActiveMultipliers
): number {
  return Math.round(
    segment.buildCost * Math.pow(1.75, segment.level) * mults.buildCostMult
  );
}

export function getOsmEdgeBuildCost(
  edge: OsmEdge,
  mults: ActiveMultipliers
): number {
  return Math.max(
    5,
    Math.round(edge.buildCost * 0.45 * mults.buildCostMult * mults.nodeBuildCostScaleMult)
  );
}

export function getDirectOsmBridgeCost(
  distKm: number,
  mults: ActiveMultipliers
): number {
  const baseCost = Math.max(10, Math.round(20 * (1 + distKm * 4)));
  return Math.max(
    5,
    Math.round(baseCost * 0.45 * mults.buildCostMult * mults.nodeBuildCostScaleMult)
  );
}

export function getUpgradeCost(upg: UpgradeItem, levelOffset = 0): number {
  return Math.round(upg.baseCost * Math.pow(upg.costGrowth, upg.level + levelOffset));
}

export function getBulkUpgradeCost(
  upg: UpgradeItem,
  requestedCount: number | 'max',
  capital: number
): { count: number; totalCost: number } {
  const remaining = upg.maxLevel - upg.level;
  if (remaining <= 0) return { count: 0, totalCost: 0 };

  if (requestedCount === 'max') {
    let totalCost = 0;
    let count = 0;
    while (count < remaining) {
      const next = getUpgradeCost(upg, count);
      if (totalCost + next > capital) break;
      totalCost += next;
      count++;
    }
    if (count === 0) {
      return { count: 1, totalCost: getUpgradeCost(upg, 0) };
    }
    return { count, totalCost };
  }

  const target = Math.min(requestedCount, remaining);
  let totalCost = 0;
  for (let i = 0; i < target; i++) {
    totalCost += getUpgradeCost(upg, i);
  }
  return { count: target, totalCost };
}

export function canUnlockUpgrade(_state: GameState, _upg: UpgradeItem): boolean {
  return false;
}

export function buyUpgrade(
  state: GameState,
  _upgradeId: string,
  _count: 1 | 10 | 'max' = 1
): { success: boolean; newState: GameState; levelsBought: number } {
  return { success: false, newState: state, levelsBought: 0 };
}

export function calculateTotalIncomePerSec(state: GameState): number {
  const mults = calculateMultipliers(state);
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);

  const osmEdgeIncome =
    graphIdx.builtRoadIncomeBase * mults.roadIncomeMult * mults.osmNodeIncomeMult +
    graphIdx.builtRailIncomeBase * mults.railIncomeMult * mults.osmNodeIncomeMult;

  const junctionBonus = graphIdx.connectedCount * mults.junctionFlatPerNode;

  return Math.round((osmEdgeIncome + junctionBonus) * 10) / 10;
}

export function calculateClickReward(state: GameState): number {
  const mults = calculateMultipliers(state);
  const incomePerSec = calculateTotalIncomePerSec(state);
  return Math.round((28 + incomePerSec * mults.clickDpsSeconds) * mults.clickBonusMult);
}

export function recomputeNetworkMetrics(state: GameState): {
  mapped1to1Km: number;
  totalNetworkKm: number;
  connectedOsmNodes: number;
  totalScaledNodes: number;
} {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const mapped1to1Km = Math.round(graphIdx.builtKm * 10) / 10;
  const connectedOsmNodes = graphIdx.connectedCount;

  return {
    mapped1to1Km,
    totalNetworkKm: mapped1to1Km,
    connectedOsmNodes,
    totalScaledNodes: connectedOsmNodes,
  };
}

export interface CompletedOsmWayEvent {
  key: string;
  wayName: string;
  mode: 'road' | 'rail';
  edgeCount: number;
  bonusCash: number;
}

export const CUSTOM_BRIDGE_WAY_NAMES = new Set([
  '교차로 연결 링크',
  '철도 연결 링크',
  '복합 환승 직결',
]);

interface IsolatedBridgeCacheEntry {
  allowedTargetsByComp: Map<number, Set<string>>;
  allowedTargetsByOrigin: Map<string, Set<string>>;
}

interface UnlockedOsmTopology {
  compIdByNode: Map<string, number>;
  deadEndOrigins: Set<string>;
  frontierCache: Map<string, Map<string, number>>;
  isolatedBridgeCache: Map<string, IsolatedBridgeCacheEntry>;
}

interface OsmGraphIndex {
  nodeById: Map<string, OsmNode>;
  edgeById: Map<string, OsmEdge>;
  builtEdges: OsmEdge[];
  connectedNodes: OsmNode[];
  connectedCount: number;
  hasAnyConnected: boolean;
  builtRoadIncomeBase: number;
  builtRailIncomeBase: number;
  builtKm: number;
  nodeModeMap: Map<string, 'road' | 'rail' | 'mixed'>;
  hasEdgesSet: Set<string>;
  adjRoad: Map<string, Array<{ nextId: string; edge: OsmEdge }>>;
  adjRail: Map<string, Array<{ nextId: string; edge: OsmEdge }>>;
  adjEdgesAll: Map<string, OsmEdge[]>;
  wayStats: Map<string, { wayName: string; mode: 'road' | 'rail'; total: number; built: number }>;
  unlockedCache: WeakMap<ProvincialRegion[], UnlockedOsmTopology>;
}

const osmGraphIndexCache = new WeakMap<OsmNode[], WeakMap<OsmEdge[], OsmGraphIndex>>();

function getOsmGraphIndex(osmNodes: OsmNode[], osmEdges: OsmEdge[]): OsmGraphIndex {
  let edgeMapCache = osmGraphIndexCache.get(osmNodes);
  if (!edgeMapCache) {
    edgeMapCache = new WeakMap<OsmEdge[], OsmGraphIndex>();
    osmGraphIndexCache.set(osmNodes, edgeMapCache);
  }
  const existing = edgeMapCache.get(osmEdges);
  if (existing) return existing;

  const nodeById = new Map<string, OsmNode>();
  const connectedNodes: OsmNode[] = [];
  const nodeModeMap = new Map<string, 'road' | 'rail' | 'mixed'>();

  for (const n of osmNodes) {
    nodeById.set(n.id, n);
    if (n.connected) connectedNodes.push(n);
    if (n.mode) nodeModeMap.set(n.id, n.mode);
  }

  const edgeById = new Map<string, OsmEdge>();
  const builtEdges: OsmEdge[] = [];
  let builtRoadIncomeBase = 0;
  let builtRailIncomeBase = 0;
  let builtKm = 0;
  const hasEdgesSet = new Set<string>();
  const adjRoad = new Map<string, Array<{ nextId: string; edge: OsmEdge }>>();
  const adjRail = new Map<string, Array<{ nextId: string; edge: OsmEdge }>>();
  const adjEdgesAll = new Map<string, OsmEdge[]>();
  const wayStats = new Map<
    string,
    { wayName: string; mode: 'road' | 'rail'; total: number; built: number }
  >();

  for (const e of osmEdges) {
    edgeById.set(e.id, e);
    if (e.built) {
      builtEdges.push(e);
      builtKm += e.distanceKm;
      if (e.mode === 'rail') builtRailIncomeBase += e.baseIncomePerSec;
      else builtRoadIncomeBase += e.baseIncomePerSec;
    }

    hasEdgesSet.add(e.fromNodeId);
    hasEdgesSet.add(e.toNodeId);

    for (const nid of [e.fromNodeId, e.toNodeId]) {
      const prev = nodeModeMap.get(nid);
      if (!prev) nodeModeMap.set(nid, e.mode);
      else if (prev !== e.mode) nodeModeMap.set(nid, 'mixed');

      let allList = adjEdgesAll.get(nid);
      if (!allList) {
        allList = [];
        adjEdgesAll.set(nid, allList);
      }
      allList.push(e);
    }

    const modeAdj = e.mode === 'rail' ? adjRail : adjRoad;
    let fromList = modeAdj.get(e.fromNodeId);
    if (!fromList) {
      fromList = [];
      modeAdj.set(e.fromNodeId, fromList);
    }
    fromList.push({ nextId: e.toNodeId, edge: e });
    let toList = modeAdj.get(e.toNodeId);
    if (!toList) {
      toList = [];
      modeAdj.set(e.toNodeId, toList);
    }
    toList.push({ nextId: e.fromNodeId, edge: e });

    if (e.wayName && !CUSTOM_BRIDGE_WAY_NAMES.has(e.wayName)) {
      const key = `${e.mode}::${e.wayName}`;
      let grp = wayStats.get(key);
      if (!grp) {
        grp = { wayName: e.wayName, mode: e.mode, total: 0, built: 0 };
        wayStats.set(key, grp);
      }
      grp.total += 1;
      if (e.built) grp.built += 1;
    }
  }

  const created: OsmGraphIndex = {
    nodeById,
    edgeById,
    builtEdges,
    connectedNodes,
    connectedCount: connectedNodes.length,
    hasAnyConnected: connectedNodes.length > 0,
    builtRoadIncomeBase,
    builtRailIncomeBase,
    builtKm,
    nodeModeMap,
    hasEdgesSet,
    adjRoad,
    adjRail,
    adjEdgesAll,
    wayStats,
    unlockedCache: new WeakMap(),
  };
  edgeMapCache.set(osmEdges, created);
  return created;
}

export function getBuiltOsmEdgesForState(state: GameState): OsmEdge[] {
  return getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []).builtEdges;
}

export function getOsmNodeHasEdges(state: GameState, nodeId: string): boolean {
  return getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []).hasEdgesSet.has(nodeId);
}

export function getOsmNodeConnectionFlags(
  state: GameState,
  nodeId: string,
  frontierDistances: Map<string, number>,
  hasAnyConnected: boolean
): { hasBuiltEdge: boolean; hasUnbuiltEdge: boolean } {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const edges = graphIdx.adjEdgesAll.get(nodeId);
  if (!edges || edges.length === 0) {
    return { hasBuiltEdge: false, hasUnbuiltEdge: false };
  }
  let hasBuiltEdge = false;
  let hasUnbuiltEdge = false;
  for (const e of edges) {
    if (e.built) {
      hasBuiltEdge = true;
    } else if (
      !hasAnyConnected ||
      (frontierDistances.has(e.fromNodeId) && frontierDistances.has(e.toNodeId))
    ) {
      hasUnbuiltEdge = true;
    }
    if (hasBuiltEdge && hasUnbuiltEdge) break;
  }
  return { hasBuiltEdge, hasUnbuiltEdge };
}

export function getFrontierOsmEdgesForState(
  state: GameState,
  frontierDistances: Map<string, number>
): OsmEdge[] {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const seen = new Set<string>();
  const result: OsmEdge[] = [];
  for (const nodeId of frontierDistances.keys()) {
    const incident = graphIdx.adjEdgesAll.get(nodeId);
    if (!incident) continue;
    for (const e of incident) {
      if (e.built || seen.has(e.id)) continue;
      if (!frontierDistances.has(e.fromNodeId) || !frontierDistances.has(e.toNodeId)) continue;
      const nFrom = graphIdx.nodeById.get(e.fromNodeId);
      const nTo = graphIdx.nodeById.get(e.toNodeId);
      if (!nFrom || !nTo || !isNodeInUnlockedRegion(state, nFrom) || !isNodeInUnlockedRegion(state, nTo)) {
        continue;
      }
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}

export function getOsmNodeMode(
  state: GameState,
  nodeId: string
): 'road' | 'rail' | 'mixed' {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  return graphIdx.nodeModeMap.get(nodeId) || 'road';
}

export function resolveCompatibleOsmMode(
  state: GameState,
  fromNodeId: string,
  toNodeId: string
): 'road' | 'rail' | 'both' | 'transfer' | null {
  if (fromNodeId === toNodeId) return null;

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const incident = graphIdx.adjEdgesAll.get(fromNodeId);
  if (incident) {
    for (const e of incident) {
      if (
        (e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) ||
        (e.fromNodeId === toNodeId && e.toNodeId === fromNodeId)
      ) {
        return e.mode;
      }
    }
  }

  const modeA = graphIdx.nodeModeMap.get(fromNodeId) || 'road';
  const modeB = graphIdx.nodeModeMap.get(toNodeId) || 'road';

  if (modeA === 'mixed' && modeB === 'mixed') return 'both';
  if (
    (modeA === 'road' && modeB === 'road') ||
    (modeA === 'road' && modeB === 'mixed') ||
    (modeA === 'mixed' && modeB === 'road')
  ) {
    return 'road';
  }
  if (
    (modeA === 'rail' && modeB === 'rail') ||
    (modeA === 'rail' && modeB === 'mixed') ||
    (modeA === 'mixed' && modeB === 'rail')
  ) {
    return 'rail';
  }

  const transferSkillLevel =
    state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0;
  if (transferSkillLevel > 0) {
    const nA = graphIdx.nodeById.get(fromNodeId);
    const nB = graphIdx.nodeById.get(toNodeId);
    if (nA && nB && haversineKm(nA.lat, nA.lng, nB.lat, nB.lng) <= 0.035) {
      return 'transfer';
    }
  }

  return null;
}

export function getLineNodeProgress(
  _state: GameState,
  _line: TransportLine
): { current: number; target: number } {
  return { current: 0, target: 1 };
}

export function evaluateLinesAndAchievements(state: GameState): {
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
} {
  // Track completed real OSM road/rail ways for passive cash bonuses & Lines tab status
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const wayGroups = graphIdx.wayStats;

  const completedWaySet = new Set(state.completedOsmWays || []);
  const newlyCompletedOsmWays: CompletedOsmWayEvent[] = [];
  let wayBonusCash = 0;

  for (const [key, grp] of wayGroups.entries()) {
    if (grp.total >= 2 && grp.built === grp.total && !completedWaySet.has(key)) {
      completedWaySet.add(key);
      const bonus = Math.min(5000, grp.total * 120);
      wayBonusCash += bonus;
      newlyCompletedOsmWays.push({
        key,
        wayName: grp.wayName,
        mode: grp.mode,
        edgeCount: grp.total,
        bonusCash: bonus,
      });
    }
  }

  const metrics = recomputeNetworkMetrics(state);

  let bonusCash = wayBonusCash;
  const newlyUnlockedAchievements: Achievement[] = [];

  const updatedAchievements = state.achievements.map((ach) => {
    if (ach.unlocked) return ach;

    let met = false;
    if (ach.targetType === 'total_km' && ach.targetValue !== undefined) {
      met = metrics.mapped1to1Km >= ach.targetValue;
    } else if (ach.targetType === 'osm_nodes' && ach.targetValue !== undefined) {
      met = metrics.connectedOsmNodes >= ach.targetValue;
    }

    if (met) {
      bonusCash += ach.bonusCash;
      const unlockedAch = { ...ach, unlocked: true };
      newlyUnlockedAchievements.push(unlockedAch);
      return unlockedAch;
    }
    return ach;
  });

  const newState: GameState = {
    ...state,
    capital: state.capital + bonusCash,
    totalLifetimeEarnings: state.totalLifetimeEarnings + bonusCash,
    skillPoints: 0,
    completedOsmWays: Array.from(completedWaySet),
    achievements: updatedAchievements,
    stats: {
      ...state.stats,
      totalLinesCompleted: 0,
      totalTownsCompleted: 0,
      mapped1to1Km: metrics.mapped1to1Km,
      totalNetworkKm: metrics.totalNetworkKm,
      connectedOsmNodes: metrics.connectedOsmNodes,
      totalScaledNodes: metrics.totalScaledNodes,
    },
  };

  return {
    newState,
    newlyCompletedLines: [],
    newlyUnlockedAchievements,
    newlyCompletedOsmWays,
  };
}

function analyzeRouteComponentsAndDeadEnds(
  osmNodes: OsmNode[],
  osmEdges: OsmEdge[],
  isUnlockedFn: (node: OsmNode) => boolean
) {
  const nativeAdj = new Map<string, string[]>();
  const unbuiltDegree = new Map<string, number>();
  const totalDegree = new Map<string, number>();

  for (const e of osmEdges) {
    if (!nativeAdj.has(e.fromNodeId)) nativeAdj.set(e.fromNodeId, []);
    if (!nativeAdj.has(e.toNodeId)) nativeAdj.set(e.toNodeId, []);
    nativeAdj.get(e.fromNodeId)!.push(e.toNodeId);
    nativeAdj.get(e.toNodeId)!.push(e.fromNodeId);

    totalDegree.set(e.fromNodeId, (totalDegree.get(e.fromNodeId) || 0) + 1);
    totalDegree.set(e.toNodeId, (totalDegree.get(e.toNodeId) || 0) + 1);

    if (!e.built) {
      unbuiltDegree.set(e.fromNodeId, (unbuiltDegree.get(e.fromNodeId) || 0) + 1);
      unbuiltDegree.set(e.toNodeId, (unbuiltDegree.get(e.toNodeId) || 0) + 1);
    }
  }

  const compIdByNode = new Map<string, number>();
  const compHasUnbuilt = new Map<number, boolean>();
  const nodeMap = new Map(osmNodes.map((n) => [n.id, n]));
  let nextCompId = 1;

  for (const n of osmNodes) {
    if (compIdByNode.has(n.id)) continue;
    const cid = nextCompId++;
    const queue = [n.id];
    compIdByNode.set(n.id, cid);
    let hasUnbuilt = false;
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      if ((unbuiltDegree.get(curr) || 0) > 0) {
        const currNode = nodeMap.get(curr);
        if (currNode && isUnlockedFn(currNode)) {
          hasUnbuilt = true;
        }
      }
      for (const nxt of nativeAdj.get(curr) || []) {
        if (!compIdByNode.has(nxt)) {
          compIdByNode.set(nxt, cid);
          queue.push(nxt);
        }
      }
    }
    compHasUnbuilt.set(cid, hasUnbuilt);
  }

  const deadEndOrigins = new Set<string>();
  for (const n of osmNodes) {
    if (!n.connected || !isUnlockedFn(n)) continue;
    const unb = unbuiltDegree.get(n.id) || 0;
    if (unb > 0) continue;

    const tot = totalDegree.get(n.id) || 0;
    const cid = compIdByNode.get(n.id) || 0;
    const entireCompExhausted = !compHasUnbuilt.get(cid);

    if (entireCompExhausted || tot <= 1) {
      deadEndOrigins.add(n.id);
    }
  }

  return { compIdByNode, deadEndOrigins };
}

function areModesBridgeCompatible(
  modeA: 'road' | 'rail' | 'mixed',
  modeB: 'road' | 'rail' | 'mixed',
  distKm: number,
  transferDistanceKm: number
): boolean {
  if (modeA === 'mixed' || modeB === 'mixed') return true;
  if (modeA === modeB) return true;
  return transferDistanceKm > 0 && distKm <= transferDistanceKm;
}

interface IsolatedBridgePair {
  originId: string;
  targetId: string;
  distKm: number;
}

function findIsolatedBridgePairs(
  osmNodes: OsmNode[],
  osmEdges: OsmEdge[],
  deadEndOrigins: Set<string>,
  compIdByNode: Map<string, number>,
  deriveMode: (node: OsmNode) => 'road' | 'rail' | 'mixed',
  transferDistanceKm: number,
  excludeTargetIds: Set<string>,
  isUnlockedFn: (node: OsmNode) => boolean
): IsolatedBridgePair[] {
  if (deadEndOrigins.size === 0) return [];

  const nodeMap = new Map(osmNodes.map((n) => [n.id, n]));
  const unlockedUnconnected = osmNodes.filter(
    (n) => !n.connected && !excludeTargetIds.has(n.id) && isUnlockedFn(n)
  );
  if (unlockedUnconnected.length === 0) return [];

  const CELL_DEG = 0.005;
  const grid = new Map<string, OsmNode[]>();
  for (const u of unlockedUnconnected) {
    const gx = Math.floor(u.lat / CELL_DEG);
    const gy = Math.floor(u.lng / CELL_DEG);
    const k = `${gx}_${gy}`;
    let list = grid.get(k);
    if (!list) {
      list = [];
      grid.set(k, list);
    }
    list.push(u);
  }

  // Group dead-end nodes by their native component so each isolated route bridges only to its single nearest target node
  const compHasUnbuilt = new Set<number>();
  for (const e of osmEdges) {
    if (e.built) continue;
    const u = nodeMap.get(e.fromNodeId);
    const v = nodeMap.get(e.toNodeId);
    if (u && v && isUnlockedFn(u) && isUnlockedFn(v)) {
      const c = compIdByNode.get(u.id);
      if (c !== undefined) compHasUnbuilt.add(c);
    }
  }

  const originGroups = new Map<string, { comp: number; nodes: OsmNode[] }>();
  for (const oid of deadEndOrigins) {
    const cn = nodeMap.get(oid);
    if (!cn) continue;
    const comp = compIdByNode.get(oid) ?? -1;
    const groupKey = !compHasUnbuilt.has(comp) ? `comp_${comp}` : `tip_${oid}`;
    let grp = originGroups.get(groupKey);
    if (!grp) {
      grp = { comp, nodes: [] };
      originGroups.set(groupKey, grp);
    }
    grp.nodes.push(cn);
  }

  const pairs: IsolatedBridgePair[] = [];
  const cellSpan = Math.max(1, Math.ceil(ISOLATED_ROUTE_BRIDGE_MAX_KM / 111 / CELL_DEG) + 1);

  for (const { comp, nodes } of originGroups.values()) {
    let bestOriginId: string | null = null;
    let bestTargetId: string | null = null;
    let bestDistKm = Infinity;

    for (const cn of nodes) {
      const cnMode = deriveMode(cn);
      const gx = Math.floor(cn.lat / CELL_DEG);
      const gy = Math.floor(cn.lng / CELL_DEG);

      for (let dx = -cellSpan; dx <= cellSpan; dx++) {
        for (let dy = -cellSpan; dy <= cellSpan; dy++) {
          const bucket = grid.get(`${gx + dx}_${gy + dy}`);
          if (!bucket) continue;
          for (const n of bucket) {
            if (compIdByNode.get(n.id) === comp) continue;
            const distKm = haversineKm(cn.lat, cn.lng, n.lat, n.lng);
            if (distKm > ISOLATED_ROUTE_BRIDGE_MAX_KM) continue;
            if (!areModesBridgeCompatible(cnMode, deriveMode(n), distKm, transferDistanceKm)) continue;
            if (distKm < bestDistKm) {
              bestDistKm = distKm;
              bestOriginId = cn.id;
              bestTargetId = n.id;
            }
          }
        }
      }
    }

    if (bestOriginId && bestTargetId) {
      pairs.push({ originId: bestOriginId, targetId: bestTargetId, distKm: bestDistKm });
    }
  }

  return pairs;
}

function getUnlockedOsmTopology(state: GameState): UnlockedOsmTopology {
  const osmNodes = state.osmNodes || [];
  const osmEdges = state.osmEdges || [];
  const regions = state.provincialRegions || [];
  const graphIdx = getOsmGraphIndex(osmNodes, osmEdges);

  let topo = graphIdx.unlockedCache.get(regions);
  if (topo) return topo;

  const { compIdByNode, deadEndOrigins } = analyzeRouteComponentsAndDeadEnds(
    osmNodes,
    osmEdges,
    (n) => isNodeInUnlockedRegion(state, n)
  );
  topo = {
    compIdByNode,
    deadEndOrigins,
    frontierCache: new Map(),
    isolatedBridgeCache: new Map(),
  };
  graphIdx.unlockedCache.set(regions, topo);
  return topo;
}

function getIsolatedBridgeCacheEntry(
  state: GameState,
  transferDistanceKm: number
): IsolatedBridgeCacheEntry {
  const osmNodes = state.osmNodes || [];
  const osmEdges = state.osmEdges || [];
  const graphIdx = getOsmGraphIndex(osmNodes, osmEdges);
  const topo = getUnlockedOsmTopology(state);
  const key = String(transferDistanceKm);
  const cached = topo.isolatedBridgeCache.get(key);
  if (cached) return cached;

  const allowedTargetsByComp = new Map<number, Set<string>>();
  const allowedTargetsByOrigin = new Map<string, Set<string>>();

  if (topo.deadEndOrigins.size > 0 && graphIdx.hasAnyConnected) {
    const isUnlockedFn = (n: OsmNode) => isNodeInUnlockedRegion(state, n);
    const normalReached = new Set<string>();
    const nQueue: Array<[string, number]> = [];
    for (const cn of graphIdx.connectedNodes) {
      if (isUnlockedFn(cn)) {
        normalReached.add(cn.id);
        nQueue.push([cn.id, 0]);
      }
    }
    let nh = 0;
    while (nh < nQueue.length) {
      const [cid, cd] = nQueue[nh++];
      if (cd >= MAX_OSM_FRONTIER_DISTANCE) continue;
      for (const e of graphIdx.adjEdgesAll.get(cid) || []) {
        const nid = e.fromNodeId === cid ? e.toNodeId : e.fromNodeId;
        if (normalReached.has(nid)) continue;
        const nNode = graphIdx.nodeById.get(nid);
        if (nNode && isUnlockedFn(nNode)) {
          normalReached.add(nid);
          nQueue.push([nid, cd + 1]);
        }
      }
    }

    const pairs = findIsolatedBridgePairs(
      osmNodes,
      osmEdges,
      topo.deadEndOrigins,
      topo.compIdByNode,
      (node) => graphIdx.nodeModeMap.get(node.id) || node.mode || 'road',
      transferDistanceKm,
      normalReached,
      isUnlockedFn
    );

    for (const p of pairs) {
      let byOrigin = allowedTargetsByOrigin.get(p.originId);
      if (!byOrigin) {
        byOrigin = new Set();
        allowedTargetsByOrigin.set(p.originId, byOrigin);
      }
      byOrigin.add(p.targetId);

      const comp = topo.compIdByNode.get(p.originId);
      if (comp !== undefined) {
        let byComp = allowedTargetsByComp.get(comp);
        if (!byComp) {
          byComp = new Set();
          allowedTargetsByComp.set(comp, byComp);
        }
        byComp.add(p.targetId);
      }
    }
  }

  const entry: IsolatedBridgeCacheEntry = {
    allowedTargetsByComp,
    allowedTargetsByOrigin,
  };
  topo.isolatedBridgeCache.set(key, entry);
  return entry;
}

export function computeOsmFrontierDistances(
  osmNodes: OsmNode[],
  osmEdges: OsmEdge[],
  maxDist = MAX_OSM_FRONTIER_DISTANCE,
  transferDistanceKm = 0,
  isUnlockedFn: (node: OsmNode) => boolean = () => true,
  precomputedTopo?: {
    compIdByNode: Map<string, number>;
    deadEndOrigins: Set<string>;
  }
): Map<string, number> {
  const distances = new Map<string, number>();
  if (osmNodes.length === 0) return distances;

  const graphIdx = getOsmGraphIndex(osmNodes, osmEdges);
  const nodeMap = graphIdx.nodeById;

  const queue: string[] = [];
  const connectedNodes: OsmNode[] = [];
  const unlockedCandidates: OsmNode[] = [];
  for (const n of osmNodes) {
    if (!isUnlockedFn(n)) continue;
    if (n.connected) {
      distances.set(n.id, 0);
      queue.push(n.id);
      connectedNodes.push(n);
    } else {
      unlockedCandidates.push(n);
    }
  }

  const { compIdByNode, deadEndOrigins } =
    precomputedTopo || analyzeRouteComponentsAndDeadEnds(osmNodes, osmEdges, isUnlockedFn);

  const deriveMode = (node: OsmNode): 'road' | 'rail' | 'mixed' =>
    graphIdx.nodeModeMap.get(node.id) || node.mode || 'road';

  // Seed transfer and cross-border d=1 bridges first
  if (connectedNodes.length > 0 && unlockedCandidates.length > 0 && maxDist >= 1) {
    const CELL_DEG = 0.005;
    const grid = new Map<string, OsmNode[]>();
    for (const u of unlockedCandidates) {
      const gx = Math.floor(u.lat / CELL_DEG);
      const gy = Math.floor(u.lng / CELL_DEG);
      const k = `${gx}_${gy}`;
      let list = grid.get(k);
      if (!list) {
        list = [];
        grid.set(k, list);
      }
      list.push(u);
    }

    for (const cn of connectedNodes) {
      const cnMode = deriveMode(cn);
      const gx = Math.floor(cn.lat / CELL_DEG);
      const gy = Math.floor(cn.lng / CELL_DEG);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx}_${gy + dy}`);
          if (!bucket) continue;
          for (const n of bucket) {
            if (distances.has(n.id)) continue;
            if (Math.abs(n.lat - cn.lat) > 0.005 || Math.abs(n.lng - cn.lng) > 0.0065) continue;

            const distKm = haversineKm(cn.lat, cn.lng, n.lat, n.lng);
            const nMode = deriveMode(n);

            if (transferDistanceKm > 0 && distKm <= transferDistanceKm) {
              distances.set(n.id, 1);
              queue.push(n.id);
              continue;
            }

            const isCrossBorder =
              Boolean(cn.regionId && n.regionId && cn.regionId !== n.regionId) &&
              distKm <= CROSS_BORDER_BRIDGE_MAX_KM &&
              areModesBridgeCompatible(cnMode, nMode, distKm, transferDistanceKm);

            if (isCrossBorder) {
              distances.set(n.id, 1);
              queue.push(n.id);
            }
          }
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const dCurr = distances.get(curr) ?? 0;
    if (dCurr >= maxDist) continue;
    for (const e of graphIdx.adjEdgesAll.get(curr) || []) {
      const nextId = e.fromNodeId === curr ? e.toNodeId : e.fromNodeId;
      if (distances.has(nextId)) continue;
      const nextNode = nodeMap.get(nextId);
      if (nextNode && isUnlockedFn(nextNode)) {
        distances.set(nextId, dCurr + 1);
        queue.push(nextId);
      }
    }
  }

  // Isolated/dead-end routes: bridge ONLY to the single nearest compatible node and show d <= 3 (2~3 hop horizon) around it
  const isolatedCap = Math.min(maxDist, ISOLATED_ROUTE_BRIDGE_FRONTIER_CAP);
  if (isolatedCap >= 1 && deadEndOrigins.size > 0) {
    const alreadyReached = new Set(distances.keys());
    const pairs = findIsolatedBridgePairs(
      osmNodes,
      osmEdges,
      deadEndOrigins,
      compIdByNode,
      deriveMode,
      transferDistanceKm,
      alreadyReached,
      isUnlockedFn
    );

    const localQueue: string[] = [];
    for (const p of pairs) {
      if (!distances.has(p.targetId)) {
        distances.set(p.targetId, 1);
        localQueue.push(p.targetId);
      }
    }

    let localHead = 0;
    while (localHead < localQueue.length) {
      const curr = localQueue[localHead++];
      const dCurr = distances.get(curr) ?? 1;
      if (dCurr >= isolatedCap) continue;
      for (const e of graphIdx.adjEdgesAll.get(curr) || []) {
        const nextId = e.fromNodeId === curr ? e.toNodeId : e.fromNodeId;
        const nextNode = nodeMap.get(nextId);
        if (!nextNode || !isUnlockedFn(nextNode)) continue;
        const existing = distances.get(nextId);
        if (existing === undefined || existing > dCurr + 1) {
          distances.set(nextId, dCurr + 1);
          localQueue.push(nextId);
        }
      }
    }
  }

  return distances;
}

export function isNodeInUnseededModeInUnlockedRegion(
  state: GameState,
  node: OsmNode
): boolean {
  if (node.connected) return false;
  if (!isNodeInUnlockedRegion(state, node)) return false;

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const incident = graphIdx.adjEdgesAll.get(node.id);
  if (!incident || incident.length === 0) return false;

  const nodeMode = graphIdx.nodeModeMap.get(node.id) || node.mode || 'road';

  const regions = state.provincialRegions || [];
  const unlocked = regions.filter((r) => r.unlocked);
  const nodeRegion =
    (node.regionId ? regions.find((r) => r.regionId === node.regionId) : undefined) ||
    unlocked.find((ur) => isPointInRegionBoundary(node.lat, node.lng, ur, 0.002));
  if (!nodeRegion || !nodeRegion.unlocked) return false;

  let hasConnectedSameMode = false;
  for (const cn of graphIdx.connectedNodes) {
    const cnRegionId =
      cn.regionId ||
      unlocked.find((ur) => isPointInRegionBoundary(cn.lat, cn.lng, ur, 0.002))?.regionId;
    if (cnRegionId === nodeRegion.regionId) {
      const cnMode = graphIdx.nodeModeMap.get(cn.id) || cn.mode || 'road';
      if (nodeMode === 'mixed' || cnMode === 'mixed' || cnMode === nodeMode) {
        hasConnectedSameMode = true;
        break;
      }
    }
  }

  return !hasConnectedSameMode;
}

export function computeOsmFrontierDistancesForState(
  state: GameState,
  maxDist = MAX_OSM_FRONTIER_DISTANCE
): Map<string, number> {
  const transferUnlocked = (state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0) > 0;
  const transferDistanceKm = transferUnlocked ? 0.035 : 0;
  const topo = getUnlockedOsmTopology(state);
  const cacheKey = `${maxDist}:${transferDistanceKm}`;
  const cached = topo.frontierCache.get(cacheKey);
  if (cached) return cached;

  const computed = computeOsmFrontierDistances(
    state.osmNodes || [],
    state.osmEdges || [],
    maxDist,
    transferDistanceKm,
    (node) => isNodeInUnlockedRegion(state, node),
    topo
  );

  // If there are unseeded modes in any unlocked region (e.g. connected roads but 0 connected rails in a region),
  // include candidate seed nodes for the unseeded mode with d=1 so they are visible and pioneerable!
  const unseededNodes = (state.osmNodes || []).filter(
    (n) => !n.connected && !computed.has(n.id) && isNodeInUnseededModeInUnlockedRegion(state, n)
  );
  if (unseededNodes.length > 0) {
    for (const un of unseededNodes) {
      computed.set(un.id, 1);
    }
  }

  topo.frontierCache.set(cacheKey, computed);
  return computed;
}

export function getProximityAdjacentChunksToLoad(
  state: GameState,
  maxChunks = 5
): Array<{ key: string; lat: number; lng: number; minDistKm: number }> {
  if (!state || !state.osmNodes || state.osmNodes.length === 0) return [];
  const loadedSet = new Set(state.loadedOsmChunks || []);
  const unlockedRegions = (state.provincialRegions || []).filter((r) => r.unlocked);
  if (unlockedRegions.length === 0) return [];

  const frontierMap = computeOsmFrontierDistancesForState(state);
  const activeNodes: OsmNode[] = [];

  for (const n of state.osmNodes) {
    if (n.connected) {
      activeNodes.push(n);
    } else {
      const d = frontierMap.get(n.id);
      if (d !== undefined && d <= 3) {
        activeNodes.push(n);
      }
    }
  }

  // Also include center of any unlocked region that has few nodes loaded so far (< 30)
  for (const ur of unlockedRegions) {
    const regionNodeCount = state.osmNodes.filter((n) => n.regionId === ur.regionId).length;
    if (regionNodeCount < 30) {
      activeNodes.push({
        id: `reg_center_${ur.regionId}`,
        lat: ur.centerLat,
        lng: ur.centerLng,
        connected: true,
        mode: 'road',
        label: ur.regionName,
      });
    }
  }

  if (activeNodes.length === 0) return [];

  const STEP = 1 / 300; // ~0.00333333 deg
  const candidateChunks = new Map<string, { key: string; lat: number; lng: number; minDistKm: number }>();

  for (const n of activeNodes) {
    const qLat = Math.round(n.lat * 300) / 300;
    const qLng = Math.round(n.lng * 300) / 300;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cLat = qLat + dy * STEP;
        const cLng = qLng + dx * STEP;
        const key = `${(Math.round(cLat * 300) / 300).toFixed(4)}_${(Math.round(cLng * 300) / 300).toFixed(4)}`;

        if (loadedSet.has(key)) continue;

        const distKm = haversineKm(n.lat, n.lng, cLat, cLng);
        // Self chunk: <= 0.35km, Adjacent chunks: <= 0.45km
        const thresholdKm = dy === 0 && dx === 0 ? 0.35 : 0.45;
        if (distKm > thresholdKm) continue;

        // Verify chunk is within an unlocked region boundary (with 0.005 deg padding)
        const inUnlocked = unlockedRegions.some((ur) =>
          isPointInRegionBoundary(cLat, cLng, ur, 0.005)
        );
        if (!inUnlocked) continue;

        const existing = candidateChunks.get(key);
        if (!existing || distKm < existing.minDistKm) {
          candidateChunks.set(key, { key, lat: cLat, lng: cLng, minDistKm: distKm });
        }
      }
    }
  }

  return Array.from(candidateChunks.values())
    .sort((a, b) => a.minDistKm - b.minDistKm)
    .slice(0, maxChunks);
}

const FRONTIER_BRIGHTNESS_BY_DIST = [1, 1.0, 0.76, 0.54, 0.36, 0.20];
const FRONTIER_OPACITY_BY_DIST = [1, 0.96, 0.78, 0.60, 0.42, 0.26];
const FRONTIER_RADIUS_SCALE_BY_DIST = [1, 1.06, 0.97, 0.89, 0.81, 0.73];
const FRONTIER_EDGE_OPACITY_BY_DIST = [0.95, 0.76, 0.58, 0.40, 0.26, 0.14];

function dimHexColor(hex: string, brightness: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const bgR = 12;
  const bgG = 18;
  const bgB = 30;
  const nr = Math.round(bgR + (r - bgR) * brightness);
  const ng = Math.round(bgG + (g - bgG) * brightness);
  const nb = Math.round(bgB + (b - bgB) * brightness);
  const toHex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

export interface FrontierVisualStyle {
  brightness: number;
  radiusScale: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  haloColor: string;
  haloOpacity: number;
}

export function getFrontierVisualStyle(
  frontierDist: number,
  mode: 'road' | 'rail' | 'mixed',
  options?: {
    isSelected?: boolean;
    isHovered?: boolean;
    dimForSelection?: boolean;
    hideDot?: boolean;
  }
): FrontierVisualStyle {
  const d = Math.max(0, Math.min(MAX_OSM_FRONTIER_DISTANCE, Math.round(frontierDist)));
  const isSelected = Boolean(options?.isSelected);
  const isHovered = Boolean(options?.isHovered);
  const dimForSelection = Boolean(options?.dimForSelection);
  const hideDot = Boolean(options?.hideDot);

  const baseFill =
    isSelected
      ? '#10b981'
      : isHovered
      ? '#059669'
      : mode === 'mixed'
      ? '#9333ea'
      : mode === 'rail'
      ? '#0e7490'
      : '#d97706';

  const baseStroke =
    isSelected
      ? '#ffffff'
      : isHovered
      ? '#34d399'
      : mode === 'mixed'
      ? '#e9d5ff'
      : mode === 'rail'
      ? '#38bdf8'
      : '#fbbf24';

  const baseHalo =
    isSelected
      ? '#ffffff'
      : isHovered
      ? '#34d399'
      : mode === 'mixed'
      ? '#c084fc'
      : '#22d3ee';

  const brightness = isSelected || isHovered ? 1 : FRONTIER_BRIGHTNESS_BY_DIST[d] ?? 0.2;
  const distOpacity = isSelected || isHovered ? 1 : FRONTIER_OPACITY_BY_DIST[d] ?? 0.26;
  const radiusScale = isSelected || isHovered ? 1 : FRONTIER_RADIUS_SCALE_BY_DIST[d] ?? 0.73;

  const selectionFactor = dimForSelection ? 0.35 : 1;
  const fillOpacity = hideDot ? 0 : Number((distOpacity * selectionFactor).toFixed(3));
  const strokeOpacity = hideDot ? 0 : Number((distOpacity * selectionFactor).toFixed(3));
  const haloOpacity = hideDot ? 0 : Number((distOpacity * 0.92 * selectionFactor).toFixed(3));

  return {
    brightness,
    radiusScale,
    fillColor: dimHexColor(baseFill, brightness),
    fillOpacity,
    strokeColor: dimHexColor(baseStroke, brightness),
    strokeOpacity,
    haloColor: dimHexColor(baseHalo, brightness),
    haloOpacity,
  };
}

export function getFrontierEdgeOpacity(maxEndpointDist: number, canAfford: boolean): number {
  const d = Math.max(1, Math.min(MAX_OSM_FRONTIER_DISTANCE, Math.round(maxEndpointDist)));
  const base = FRONTIER_EDGE_OPACITY_BY_DIST[d] ?? 0.14;
  return Number((canAfford ? base : base * 0.58).toFixed(3));
}

export function mergeOsmChunk(
  state: GameState,
  chunkKey: string,
  incomingNodes: OsmNode[],
  incomingEdges: OsmEdge[],
  regionId?: string,
  options?: {
    skipAutoSeed?: boolean;
    boundaryGeoJson?: GeoJsonBoundary;
    totalNodeCount?: number;
  }
): GameState {
  const regions = state.provincialRegions || [];
  const regionMap = new Map(regions.map((r) => [r.regionId, r]));
  const unlockedRegions = [...regions]
    .filter((r) => r.unlocked)
    .sort((a, b) => bboxAreaDegSq(a.bbox) - bboxAreaDegSq(b.bbox));
  const lockedRegions = [...regions]
    .filter((r) => !r.unlocked)
    .sort((a, b) => bboxAreaDegSq(a.bbox) - bboxAreaDegSq(b.bbox));

  const defaultUnlocked =
    (regionId && regionMap.get(regionId)?.unlocked ? regionMap.get(regionId) : undefined) ||
    unlockedRegions.find((r) => r.isStartingRegion) ||
    unlockedRegions[0];

  const resolveIncomingNodeRegionId = (n: OsmNode): string | undefined => {
    if (n.regionId) {
      if (n.regionId === '__locked_outside__') return '__locked_outside__';
      const explicitRegion = regionMap.get(n.regionId);
      if (explicitRegion) {
        if (!explicitRegion.unlocked) return explicitRegion.regionId;
        if (isPointInRegionBoundary(n.lat, n.lng, explicitRegion, 0.002)) {
          return explicitRegion.regionId;
        }
      }
    }

    if (unlockedRegions.length === 0) {
      return n.regionId || regionId;
    }

    if (defaultUnlocked && isPointInRegionBoundary(n.lat, n.lng, defaultUnlocked, 0.002)) {
      return defaultUnlocked.regionId;
    }
    const matchingUnlocked = unlockedRegions.find((ur) =>
      isPointInRegionBoundary(n.lat, n.lng, ur, 0.002)
    );
    if (matchingUnlocked) {
      return matchingUnlocked.regionId;
    }

    const matchingLocked = lockedRegions.find((lr) =>
      isPointInRegionBoundary(n.lat, n.lng, lr, 0.002)
    );
    return matchingLocked ? matchingLocked.regionId : '__locked_outside__';
  };

  const existingNodeMap = new Map((state.osmNodes || []).map((n) => [n.id, n]));
  incomingNodes.forEach((n) => {
    const prev = existingNodeMap.get(n.id);
    const resolvedRegionId = resolveIncomingNodeRegionId(n);
    if (!prev) {
      existingNodeMap.set(n.id, { ...n, regionId: resolvedRegionId });
    } else if (n.mode && prev.mode && prev.mode !== n.mode) {
      existingNodeMap.set(n.id, {
        ...prev,
        mode: 'mixed',
        regionId: prev.regionId || resolvedRegionId,
      });
    } else if (n.mode && !prev.mode) {
      existingNodeMap.set(n.id, {
        ...prev,
        mode: n.mode,
        regionId: prev.regionId || resolvedRegionId,
      });
    }
  });

  const existingEdgeMap = new Map((state.osmEdges || []).map((e) => [e.id, e]));
  incomingEdges.forEach((e) => {
    if (!existingEdgeMap.has(e.id)) {
      const nFrom = existingNodeMap.get(e.fromNodeId);
      const nTo = existingNodeMap.get(e.toNodeId);
      const resolvedEdgeRegionId =
        e.regionId || nFrom?.regionId || nTo?.regionId || regionId || defaultUnlocked?.regionId;
      existingEdgeMap.set(e.id, { ...e, regionId: resolvedEdgeRegionId });
    }
  });

  const allNodes = Array.from(existingNodeMap.values());
  const allEdges = Array.from(existingEdgeMap.values());
  const targetRegionIdForSeed = regionId || defaultUnlocked?.regionId;
  const hasPendingStartSeed =
    (Boolean(targetRegionIdForSeed) &&
      (state.pendingSeedRegionIds || []).includes(targetRegionIdForSeed)) ||
    (!allNodes.some((n) => n.connected) &&
      Boolean(
        defaultUnlocked && (state.pendingSeedRegionIds || []).includes(defaultUnlocked.regionId)
      ));

  let seededNodes = allNodes;
  if (!options?.skipAutoSeed && !hasPendingStartSeed) {
    const unlockedPool = allNodes.filter((n) => isNodeInUnlockedRegion(state, n));
    const seededUnlocked = ensureSeedConnectedOsmNodes(
      unlockedPool,
      allEdges,
      state.startingCity
    );
    const connectedIds = new Set(
      seededUnlocked.filter((n) => n.connected).map((n) => n.id)
    );
    seededNodes = allNodes.map((n) =>
      connectedIds.has(n.id) ? { ...n, connected: true } : n
    );
  }

  const hasIncomingData = incomingNodes.length > 0 || incomingEdges.length > 0;
  const loadedChunks =
    !hasIncomingData || state.loadedOsmChunks.includes(chunkKey)
      ? state.loadedOsmChunks
      : [...state.loadedOsmChunks, chunkKey];

  const prevRegions = state.loadedOsmRegions || [];
  const loadedRegions =
    regionId && !prevRegions.includes(regionId) ? [...prevRegions, regionId] : prevRegions;

  // Update totalNodeCount & boundaryGeoJson on target region if present
  let nextRegions = regions;
  if (regionId && (options?.boundaryGeoJson || options?.totalNodeCount || incomingNodes.length > 0)) {
    const countedInRegion = seededNodes.filter((n) => n.regionId === regionId).length;
    nextRegions = regions.map((r) => {
      if (r.regionId !== regionId) return r;
      const nextTotal = Math.max(
        r.totalNodeCount || 0,
        options?.totalNodeCount || 0,
        countedInRegion
      );
      return {
        ...r,
        boundaryGeoJson: options?.boundaryGeoJson || r.boundaryGeoJson,
        totalNodeCount: nextTotal > 0 ? nextTotal : r.totalNodeCount,
      };
    });
  }

  const mergedState: GameState = {
    ...state,
    provincialRegions: nextRegions,
    osmNodes: seededNodes,
    osmEdges: allEdges,
    loadedOsmChunks: loadedChunks,
    loadedOsmRegions: loadedRegions,
  };

  return evaluateLinesAndAchievements(mergedState).newState;
}

export function unlockProvincialRegion(
  state: GameState,
  regionId: string,
  payload?: {
    chunkKey: string;
    osmNodes: OsmNode[];
    osmEdges: OsmEdge[];
    bbox?: [number, number, number, number];
    boundaryGeoJson?: GeoJsonBoundary;
    totalNodeCount?: number;
    regionName?: string;
  }
): {
  success: boolean;
  newState: GameState;
  cost: number;
  isIsolated: boolean;
  reason?: string;
} {
  const regions = state.provincialRegions || [];
  const target = regions.find((r) => r.regionId === regionId);
  if (!target) {
    return {
      success: false,
      newState: state,
      cost: 0,
      isIsolated: false,
      reason: '지역 정보를 찾을 수 없습니다.',
    };
  }
  if (target.unlocked) {
    return {
      success: false,
      newState: state,
      cost: 0,
      isIsolated: target.isIsolated,
      reason: '이미 잠금 해제된 지역입니다.',
    };
  }

  const unlockedBefore = regions.filter((r) => r.unlocked);
  if (!isRegionExpandableFromUnlocked(target, unlockedBefore)) {
    return {
      success: false,
      newState: state,
      cost: 0,
      isIsolated: target.isIsolated,
      reason: '현재 개척된 지역과 인접한 지역만 먼저 개척할 수 있습니다.',
    };
  }

  const cost = getRegionUnlockCost(state, target);
  if (state.capital < cost) {
    return {
      success: false,
      newState: state,
      cost,
      isIsolated: target.isIsolated,
      reason: `자금이 부족합니다 (필요 자금 $${cost.toLocaleString()}).`,
    };
  }

  const resolvedBbox = payload?.bbox || target.bbox;
  const isIsolated = computeRegionIsolation(
    resolvedBbox,
    target.centerLat,
    target.centerLng,
    unlockedBefore,
    target.isKnownIsland
  );

  const updatedRegions = regions.map((r) => {
    if (r.regionId === regionId) {
      return {
        ...r,
        regionName: payload?.regionName || r.regionName,
        bbox: resolvedBbox,
        boundaryGeoJson: payload?.boundaryGeoJson || r.boundaryGeoJson,
        hasRealOsmBoundary: r.hasRealOsmBoundary || Boolean(payload?.boundaryGeoJson),
        totalNodeCount:
          Math.max(r.totalNodeCount || 0, payload?.totalNodeCount || 0) || undefined,
        unlocked: true,
        isIsolated,
      };
    }
    return r;
  });

  const unlockedAfter = updatedRegions.filter((r) => r.unlocked);
  const refreshedRegions = updatedRegions.map((r) =>
    r.unlocked
      ? r
      : {
          ...r,
          isIsolated: computeRegionIsolation(
            r.bbox,
            r.centerLat,
            r.centerLng,
            unlockedAfter,
            r.isKnownIsland
          ),
        }
  );

  let nextState: GameState = {
    ...state,
    capital: state.capital - cost,
    provincialRegions: refreshedRegions,
    pendingSeedRegionIds: isIsolated
      ? Array.from(new Set([...(state.pendingSeedRegionIds || []), regionId]))
      : state.pendingSeedRegionIds || [],
  };

  if (payload && (payload.osmNodes.length > 0 || payload.osmEdges.length > 0)) {
    nextState = mergeOsmChunk(
      nextState,
      payload.chunkKey,
      payload.osmNodes,
      payload.osmEdges,
      regionId,
      {
        skipAutoSeed: true,
        boundaryGeoJson: payload.boundaryGeoJson,
        totalNodeCount: payload.totalNodeCount ?? payload.osmNodes.length,
      }
    );
  } else {
    nextState = evaluateLinesAndAchievements(nextState).newState;
  }

  return {
    success: true,
    newState: nextState,
    cost,
    isIsolated,
  };
}

export function selectIsolatedRegionSeed(
  state: GameState,
  nodeId: string
): {
  success: boolean;
  newState: GameState;
  resolvedRegionId?: string;
  reason?: string;
} {
  const node = (state.osmNodes || []).find((n) => n.id === nodeId);
  if (!node) {
    return { success: false, newState: state, reason: '선택한 노드를 찾을 수 없습니다.' };
  }
  if (!isNodeInUnlockedRegion(state, node)) {
    return { success: false, newState: state, reason: '아직 잠금 해제되지 않은 지역의 노드입니다.' };
  }

  const pendingIds = state.pendingSeedRegionIds || [];
  const matchingRegionId =
    (node.regionId && pendingIds.includes(node.regionId) ? node.regionId : undefined) ||
    pendingIds.find((rid) => {
      const reg = (state.provincialRegions || []).find((r) => r.regionId === rid);
      return reg ? isPointInRegionBoundary(node.lat, node.lng, reg, 0.002) : false;
    }) ||
    (pendingIds.length === 1 ? pendingIds[0] : undefined) ||
    node.regionId;

  const isUnseededMode = isNodeInUnseededModeInUnlockedRegion(state, node);
  if (!matchingRegionId && pendingIds.length === 0 && !isUnseededMode) {
    return { success: false, newState: state, reason: '시작 노드를 기다리는 고립 지역이 없습니다.' };
  }

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const clickedMode = graphIdx.nodeModeMap.get(node.id) || node.mode || 'road';
  const seedIds = new Set<string>([nodeId]);

  // When seeding a region or starting fresh, if clicked mode is single-modal (road or rail),
  // automatically seed the closest complementary mode node in the region if available
  // so neither mode is blocked!
  if (clickedMode !== 'mixed') {
    const counterpartMode = clickedMode === 'rail' ? 'road' : 'rail';
    const compSizes = computeComponentSizes(state.osmEdges, counterpartMode);

    const counterpartCandidates = (state.osmNodes || []).filter((n) => {
      if (n.id === nodeId || n.connected) return false;
      const m = graphIdx.nodeModeMap.get(n.id) || n.mode;
      if (m !== counterpartMode && m !== 'mixed') return false;
      if (matchingRegionId && n.regionId && n.regionId !== matchingRegionId) return false;
      const sz = compSizes.get(n.id) || 0;
      return sz >= 1;
    });

    if (counterpartCandidates.length > 0) {
      let maxComp = 0;
      for (const n of counterpartCandidates) {
        const sz = compSizes.get(n.id) || 0;
        if (sz > maxComp) maxComp = sz;
      }
      const minHealthy = Math.min(4, maxComp);
      const healthyPool = counterpartCandidates.filter((n) => (compSizes.get(n.id) || 0) >= minHealthy);
      const poolToSearch = healthyPool.length > 0 ? healthyPool : counterpartCandidates;

      let bestCounterpart: OsmNode | null = null;
      let bestDist = Infinity;
      for (const cand of poolToSearch) {
        const d = haversineKm(node.lat, node.lng, cand.lat, cand.lng);
        if (d < bestDist) {
          bestDist = d;
          bestCounterpart = cand;
        }
      }

      if (bestCounterpart && bestDist <= 4.5) {
        seedIds.add(bestCounterpart.id);
      }
    }
  }

  const updatedNodes = (state.osmNodes || []).map((n) =>
    seedIds.has(n.id) ? { ...n, connected: true } : n
  );
  const nextPending = matchingRegionId && pendingIds.includes(matchingRegionId)
    ? pendingIds.filter((id) => id !== matchingRegionId)
    : pendingIds;

  const evalRes = evaluateLinesAndAchievements({
    ...state,
    osmNodes: updatedNodes,
    pendingSeedRegionIds: nextPending,
  });

  return {
    success: true,
    newState: evalRes.newState,
    resolvedRegionId: matchingRegionId,
  };
}

export function connectOsmEdge(
  state: GameState,
  edgeId: string
): {
  success: boolean;
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
} {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const edge = graphIdx.edgeById.get(edgeId);
  if (!edge || edge.built) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  const nodeA = graphIdx.nodeById.get(edge.fromNodeId);
  const nodeB = graphIdx.nodeById.get(edge.toNodeId);
  if (
    !nodeA ||
    !nodeB ||
    !isNodeInUnlockedRegion(state, nodeA) ||
    !isNodeInUnlockedRegion(state, nodeB)
  ) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  const hasAnyConnected = graphIdx.hasAnyConnected;
  if (!hasAnyConnected && (state.pendingSeedRegionIds || []).length > 0) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }
  if (hasAnyConnected) {
    const frontierDist = computeOsmFrontierDistancesForState(state);
    if (!frontierDist.has(edge.fromNodeId) || !frontierDist.has(edge.toNodeId)) {
      return {
        success: false,
        newState: state,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
      };
    }
  }

  const mults = calculateMultipliers(state);
  const cost = getOsmEdgeBuildCost(edge, mults);
  if (state.capital < cost) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  const updatedEdges = state.osmEdges.map((e) =>
    e.id === edgeId ? { ...e, built: true } : e
  );
  const updatedNodes = state.osmNodes.map((n) =>
    n.id === edge.fromNodeId || n.id === edge.toNodeId ? { ...n, connected: true } : n
  );

  const effectiveCashback = Math.min(mults.edgeCashbackFlat, Math.floor(cost * 0.45));

  const midState: GameState = {
    ...state,
    capital: state.capital - cost + effectiveCashback,
    totalLifetimeEarnings: state.totalLifetimeEarnings + effectiveCashback,
    osmNodes: updatedNodes,
    osmEdges: updatedEdges,
    units: [],
    stats: {
      ...state.stats,
      totalOsmEdgesBuilt: state.stats.totalOsmEdgesBuilt + 1,
    },
  };

  const evalRes = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    newState: evalRes.newState,
    newlyCompletedLines: [],
    newlyUnlockedAchievements: evalRes.newlyUnlockedAchievements,
    newlyCompletedOsmWays: evalRes.newlyCompletedOsmWays,
  };
}

function runModeSpecificDijkstra(
  adj: Map<string, Array<{ nextId: string; edge: OsmEdge }>>,
  fromNodeId: string,
  toNodeId: string,
  maxHops: number,
  isNodeAllowed: (nodeId: string) => boolean
): { edgeIds: string[]; totalDistanceKm: number } | null {
  if (!adj.has(fromNodeId) || !adj.has(toNodeId)) return null;

  const dist = new Map<string, number>();
  const hops = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edge: OsmEdge }>();
  const visited = new Set<string>();

  dist.set(fromNodeId, 0);
  hops.set(fromNodeId, 0);

  // Binary min-heap of [dist, nodeId]
  const heap: Array<[number, string]> = [[0, fromNodeId]];
  const heapPush = (item: [number, string]) => {
    heap.push(item);
    let idx = heap.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (heap[parent][0] <= heap[idx][0]) break;
      const tmp = heap[parent];
      heap[parent] = heap[idx];
      heap[idx] = tmp;
      idx = parent;
    }
  };
  const heapPop = (): [number, string] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let idx = 0;
      const len = heap.length;
      while (true) {
        const left = idx * 2 + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < len && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < len && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === idx) break;
        const tmp = heap[idx];
        heap[idx] = heap[smallest];
        heap[smallest] = tmp;
        idx = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const popped = heapPop();
    if (!popped) break;
    const [bestD, curr] = popped;
    if (visited.has(curr)) continue;
    visited.add(curr);

    if (curr === toNodeId) break;
    const currHops = hops.get(curr) || 0;
    if (currHops >= maxHops) continue;

    for (const neighbor of adj.get(curr) || []) {
      if (visited.has(neighbor.nextId) || !isNodeAllowed(neighbor.nextId)) continue;
      const alt = bestD + Math.max(0.002, neighbor.edge.distanceKm);
      if (alt < (dist.get(neighbor.nextId) ?? Infinity)) {
        dist.set(neighbor.nextId, alt);
        hops.set(neighbor.nextId, currHops + 1);
        prev.set(neighbor.nextId, { nodeId: curr, edge: neighbor.edge });
        heapPush([alt, neighbor.nextId]);
      }
    }
  }

  if (!prev.has(toNodeId)) return null;

  const edgeIds: string[] = [];
  let totalDistanceKm = 0;
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const step = prev.get(cursor);
    if (!step) return null;
    edgeIds.push(step.edge.id);
    totalDistanceKm += step.edge.distanceKm;
    cursor = step.nodeId;
  }
  edgeIds.reverse();
  return { edgeIds, totalDistanceKm };
}

export function findOsmRoadPath(
  state: GameState,
  fromNodeId: string,
  toNodeId: string,
  maxHops = 140
): {
  edgeIds: string[];
  unbuiltEdgeIds: string[];
  totalDistanceKm: number;
  totalUnbuiltCost: number;
} | null {
  if (fromNodeId === toNodeId) return null;
  const rawEdges = state.osmEdges || [];
  if (rawEdges.length === 0) return null;

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], rawEdges);
  const nFrom = graphIdx.nodeById.get(fromNodeId);
  const nTo = graphIdx.nodeById.get(toNodeId);
  if (!nFrom || !nTo || !isNodeInUnlockedRegion(state, nFrom) || !isNodeInUnlockedRegion(state, nTo)) {
    return null;
  }

  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  if (!compat || compat === 'transfer') return null;

  const isNodeAllowed = (nid: string) => {
    const node = graphIdx.nodeById.get(nid);
    return Boolean(node && isNodeInUnlockedRegion(state, node));
  };

  let chosen: { edgeIds: string[]; totalDistanceKm: number } | null = null;
  if (compat === 'road') {
    chosen = runModeSpecificDijkstra(graphIdx.adjRoad, fromNodeId, toNodeId, maxHops, isNodeAllowed);
  } else if (compat === 'rail') {
    chosen = runModeSpecificDijkstra(graphIdx.adjRail, fromNodeId, toNodeId, maxHops, isNodeAllowed);
  } else {
    const roadPath = runModeSpecificDijkstra(graphIdx.adjRoad, fromNodeId, toNodeId, maxHops, isNodeAllowed);
    const railPath = runModeSpecificDijkstra(graphIdx.adjRail, fromNodeId, toNodeId, maxHops, isNodeAllowed);
    if (roadPath && railPath) {
      chosen = roadPath.totalDistanceKm <= railPath.totalDistanceKm ? roadPath : railPath;
    } else {
      chosen = roadPath || railPath;
    }
  }

  if (!chosen) return null;

  const mults = calculateMultipliers(state);
  const unbuiltEdgeIds: string[] = [];
  let totalUnbuiltCost = 0;

  const tempConnected = new Set<string>();
  let simConnectedCount = Math.max(state.stats?.connectedOsmNodes || 0, graphIdx.connectedCount);

  for (const eid of chosen.edgeIds) {
    const e = graphIdx.edgeById.get(eid);
    if (!e || e.built) continue;
    unbuiltEdgeIds.push(eid);
    const simMults: ActiveMultipliers = {
      ...mults,
      nodeBuildCostScaleMult: getNodeBuildCostScaleMult(simConnectedCount),
    };
    totalUnbuiltCost += getOsmEdgeBuildCost(e, simMults);

    const nA = graphIdx.nodeById.get(e.fromNodeId);
    if (nA && !nA.connected && !tempConnected.has(e.fromNodeId)) {
      tempConnected.add(e.fromNodeId);
      simConnectedCount++;
    }
    const nB = graphIdx.nodeById.get(e.toNodeId);
    if (nB && !nB.connected && !tempConnected.has(e.toNodeId)) {
      tempConnected.add(e.toNodeId);
      simConnectedCount++;
    }
  }

  return {
    edgeIds: chosen.edgeIds,
    unbuiltEdgeIds,
    totalDistanceKm: Math.round(chosen.totalDistanceKm * 1000) / 1000,
    totalUnbuiltCost,
  };
}

function bfsReachableByMode(
  adj: Map<string, Array<{ nextId: string; edge: OsmEdge }>>,
  startNodeId: string,
  maxHops: number,
  isNodeAllowed: (nodeId: string) => boolean
): Set<string> {
  const reached = new Set<string>();
  if (!adj.has(startNodeId)) return reached;

  const hops = new Map<string, number>([[startNodeId, 0]]);
  const queue: string[] = [startNodeId];
  reached.add(startNodeId);

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const currHops = hops.get(curr) || 0;
    if (currHops >= maxHops) continue;
    for (const neighbor of adj.get(curr) || []) {
      const nextId = neighbor.nextId;
      if (reached.has(nextId) || !isNodeAllowed(nextId)) continue;
      reached.add(nextId);
      hops.set(nextId, currHops + 1);
      queue.push(nextId);
    }
  }
  return reached;
}

export function resolveProximityBridgeInfo(
  state: GameState,
  fromNodeId: string,
  toNodeId: string
): { kind: 'cross_border' | 'isolated_route'; maxKm: number; distKm: number } | null {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const nA = graphIdx.nodeById.get(fromNodeId);
  const nB = graphIdx.nodeById.get(toNodeId);
  if (!nA || !nB) return null;
  if (!isNodeInUnlockedRegion(state, nA) || !isNodeInUnlockedRegion(state, nB)) return null;

  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  if (!compat) return null;

  const distKm = haversineKm(nA.lat, nA.lng, nB.lat, nB.lng);

  if (
    nA.regionId &&
    nB.regionId &&
    nA.regionId !== nB.regionId &&
    (nA.connected || nB.connected) &&
    distKm <= CROSS_BORDER_BRIDGE_MAX_KM
  ) {
    return { kind: 'cross_border', maxKm: CROSS_BORDER_BRIDGE_MAX_KM, distKm };
  }

  if ((nA.connected || nB.connected) && nA.connected !== nB.connected && distKm <= ISOLATED_ROUTE_BRIDGE_MAX_KM) {
    const topo = getUnlockedOsmTopology(state);
    const originNode = nA.connected ? nA : nB;
    const targetNode = nA.connected ? nB : nA;

    if (
      topo.deadEndOrigins.has(originNode.id) &&
      topo.compIdByNode.get(originNode.id) !== topo.compIdByNode.get(targetNode.id)
    ) {
      const transferUnlocked = (state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0) > 0;
      const transferDistanceKm = transferUnlocked ? 0.035 : 0;
      const cache = getIsolatedBridgeCacheEntry(state, transferDistanceKm);
      const originComp = topo.compIdByNode.get(originNode.id);
      const matchesOrigin = cache.allowedTargetsByOrigin.get(originNode.id)?.has(targetNode.id);
      const matchesComp =
        originComp !== undefined && cache.allowedTargetsByComp.get(originComp)?.has(targetNode.id);
      if (matchesOrigin || matchesComp) {
        return { kind: 'isolated_route', maxKm: ISOLATED_ROUTE_BRIDGE_MAX_KM, distKm };
      }
    }
  }

  return null;
}

export function getReachableOsmNodeSet(
  state: GameState,
  fromNodeId: string,
  maxHops = 140
): Set<string> {
  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const fromNode = graphIdx.nodeById.get(fromNodeId);
  if (!fromNode || !isNodeInUnlockedRegion(state, fromNode)) {
    return new Set();
  }

  const isNodeAllowed = (nid: string) => {
    const node = graphIdx.nodeById.get(nid);
    return Boolean(node && isNodeInUnlockedRegion(state, node));
  };

  const modeA = graphIdx.nodeModeMap.get(fromNodeId) || 'road';
  const result = new Set<string>([fromNodeId]);

  if (modeA === 'road' || modeA === 'mixed') {
    const roadReached = bfsReachableByMode(graphIdx.adjRoad, fromNodeId, maxHops, isNodeAllowed);
    for (const id of roadReached) {
      const m = graphIdx.nodeModeMap.get(id) || 'road';
      if (m === 'road' || m === 'mixed') result.add(id);
    }
  }
  if (modeA === 'rail' || modeA === 'mixed') {
    const railReached = bfsReachableByMode(graphIdx.adjRail, fromNodeId, maxHops, isNodeAllowed);
    for (const id of railReached) {
      const m = graphIdx.nodeModeMap.get(id) || 'road';
      if (m === 'rail' || m === 'mixed') result.add(id);
    }
  }

  const transferSkillLevel =
    state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0;

  if (graphIdx.hasAnyConnected) {
    const frontierDist = computeOsmFrontierDistancesForState(state);
    for (const nid of Array.from(result)) {
      if (!frontierDist.has(nid)) {
        result.delete(nid);
      }
    }

    for (const nId of frontierDist.keys()) {
      if (nId === fromNodeId || result.has(nId)) continue;
      const nB = graphIdx.nodeById.get(nId);
      if (!nB) continue;
      if (Math.abs(fromNode.lat - nB.lat) > 0.005 || Math.abs(fromNode.lng - nB.lng) > 0.0065) {
        continue;
      }
      if (transferSkillLevel > 0 && haversineKm(fromNode.lat, fromNode.lng, nB.lat, nB.lng) <= 0.035) {
        result.add(nId);
        continue;
      }
      if (resolveProximityBridgeInfo(state, fromNodeId, nId)) {
        result.add(nId);
      }
    }
  } else if (transferSkillLevel > 0) {
    for (const nB of state.osmNodes || []) {
      if (nB.id === fromNodeId || result.has(nB.id)) continue;
      if (Math.abs(fromNode.lat - nB.lat) > 0.005 || Math.abs(fromNode.lng - nB.lng) > 0.0065) {
        continue;
      }
      if (isNodeInUnlockedRegion(state, nB) && haversineKm(fromNode.lat, fromNode.lng, nB.lat, nB.lng) <= 0.035) {
        result.add(nB.id);
      }
    }
  }

  return result;
}

export function connectOsmPath(
  state: GameState,
  fromNodeId: string,
  toNodeId: string
): {
  success: boolean;
  newState: GameState;
  builtCount: number;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
  reason?: string;
} {
  if (fromNodeId === toNodeId) {
    return {
      success: false,
      newState: state,
      builtCount: 0,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const nodeA = graphIdx.nodeById.get(fromNodeId);
  const nodeB = graphIdx.nodeById.get(toNodeId);
  if (!nodeA || !nodeB || !isNodeInUnlockedRegion(state, nodeA) || !isNodeInUnlockedRegion(state, nodeB)) {
    return {
      success: false,
      newState: state,
      builtCount: 0,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: '미개척 지역에는 노드를 연결할 수 없습니다. 먼저 해당 지역을 잠금 해제(개척)하세요.',
    };
  }

  const hasAnyConnected = graphIdx.hasAnyConnected;
  if (!hasAnyConnected && (state.pendingSeedRegionIds || []).length > 0) {
    return {
      success: false,
      newState: state,
      builtCount: 0,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: '먼저 지도에서 첫 시작 노드를 선택해주세요.',
    };
  }
  const initialFrontier = hasAnyConnected ? computeOsmFrontierDistancesForState(state) : null;
  if (initialFrontier && (!initialFrontier.has(fromNodeId) || !initialFrontier.has(toNodeId))) {
    return {
      success: false,
      newState: state,
      builtCount: 0,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: `개척된 노드 끝단에서 거리 ${MAX_OSM_FRONTIER_DISTANCE} 이내의 노드만 개척할 수 있습니다.`,
    };
  }

  const path = findOsmRoadPath(state, fromNodeId, toNodeId);
  if (path) {
    if (path.unbuiltEdgeIds.length === 0) {
      return {
        success: false,
        newState: state,
        builtCount: 0,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason: '선택한 노선 경로가 이미 모두 연결되어 있습니다.',
      };
    }

    if (hasAnyConnected) {
      const isNodeConnected = (id: string) => Boolean(graphIdx.nodeById.get(id)?.connected);
      const pathTouchesConnected =
        isNodeConnected(fromNodeId) ||
        isNodeConnected(toNodeId) ||
        path.edgeIds.some((eid) => {
          const edge = graphIdx.edgeById.get(eid);
          return Boolean(edge && (isNodeConnected(edge.fromNodeId) || isNodeConnected(edge.toNodeId)));
        });
      if (!pathTouchesConnected) {
        return {
          success: false,
          newState: state,
          builtCount: 0,
          newlyCompletedLines: [],
          newlyUnlockedAchievements: [],
          newlyCompletedOsmWays: [],
          reason: '이미 연결된 노선에서부터 이어서 연결하세요.',
        };
      }
    }

    if (initialFrontier) {
      const exceedsFrontier = path.unbuiltEdgeIds.some((eid) => {
        const edge = graphIdx.edgeById.get(eid);
        return !edge || !initialFrontier.has(edge.fromNodeId) || !initialFrontier.has(edge.toNodeId);
      });
      if (exceedsFrontier) {
        return {
          success: false,
          newState: state,
          builtCount: 0,
          newlyCompletedLines: [],
          newlyUnlockedAchievements: [],
          newlyCompletedOsmWays: [],
          reason: `개척된 노드 끝단에서 거리 ${MAX_OSM_FRONTIER_DISTANCE}을 초과하는 구간은 아직 개척할 수 없습니다.`,
        };
      }
    }

    // Batched O(K) sequential build across path edges (preserves progressive cost, cashback, way-bonuses & achievement bonuses)
    const baseMults = calculateMultipliers(state);
    let simCapital = state.capital;
    let simLifetime = state.totalLifetimeEarnings;
    let simConnectedCount = Math.max(state.stats?.connectedOsmNodes || 0, graphIdx.connectedCount);
    let simMappedKmRaw = graphIdx.builtKm;

    const builtEdgeIdSet = new Set<string>();
    const newlyConnectedNodeIds = new Set<string>();
    const completedWaySet = new Set(state.completedOsmWays || []);
    const localWayBuiltDelta = new Map<string, number>();
    const pendingAchievements = state.achievements.filter((a) => !a.unlocked);
    const unlockedAchIds = new Set<string>();
    const allAchs: Achievement[] = [];
    const allWays: CompletedOsmWayEvent[] = [];
    let builtCount = 0;

    for (const eid of path.unbuiltEdgeIds) {
      const edge = graphIdx.edgeById.get(eid);
      if (!edge || edge.built || builtEdgeIdSet.has(eid)) continue;

      const simMults: ActiveMultipliers = {
        ...baseMults,
        nodeBuildCostScaleMult: getNodeBuildCostScaleMult(simConnectedCount),
      };
      const cost = getOsmEdgeBuildCost(edge, simMults);
      if (simCapital < cost) break;

      const effectiveCashback = Math.min(baseMults.edgeCashbackFlat, Math.floor(cost * 0.45));
      simCapital = simCapital - cost + effectiveCashback;
      simLifetime += effectiveCashback;
      builtEdgeIdSet.add(eid);
      builtCount++;
      simMappedKmRaw += edge.distanceKm;

      const nFrom = graphIdx.nodeById.get(edge.fromNodeId);
      if (nFrom && !nFrom.connected && !newlyConnectedNodeIds.has(edge.fromNodeId)) {
        newlyConnectedNodeIds.add(edge.fromNodeId);
        simConnectedCount++;
      }
      const nTo = graphIdx.nodeById.get(edge.toNodeId);
      if (nTo && !nTo.connected && !newlyConnectedNodeIds.has(edge.toNodeId)) {
        newlyConnectedNodeIds.add(edge.toNodeId);
        simConnectedCount++;
      }

      if (edge.wayName && !CUSTOM_BRIDGE_WAY_NAMES.has(edge.wayName)) {
        const wKey = `${edge.mode}::${edge.wayName}`;
        const grp = graphIdx.wayStats.get(wKey);
        if (grp) {
          const nextDelta = (localWayBuiltDelta.get(wKey) || 0) + 1;
          localWayBuiltDelta.set(wKey, nextDelta);
          if (grp.total >= 2 && grp.built + nextDelta === grp.total && !completedWaySet.has(wKey)) {
            completedWaySet.add(wKey);
            const bonus = Math.min(5000, grp.total * 120);
            simCapital += bonus;
            simLifetime += bonus;
            allWays.push({
              key: wKey,
              wayName: grp.wayName,
              mode: grp.mode,
              edgeCount: grp.total,
              bonusCash: bonus,
            });
          }
        }
      }

      const roundedKm = Math.round(simMappedKmRaw * 10) / 10;
      for (const ach of pendingAchievements) {
        if (unlockedAchIds.has(ach.id)) continue;
        let met = false;
        if (ach.targetType === 'total_km' && ach.targetValue !== undefined) {
          met = roundedKm >= ach.targetValue;
        } else if (ach.targetType === 'osm_nodes' && ach.targetValue !== undefined) {
          met = simConnectedCount >= ach.targetValue;
        }
        if (met) {
          unlockedAchIds.add(ach.id);
          simCapital += ach.bonusCash;
          simLifetime += ach.bonusCash;
          allAchs.push({ ...ach, unlocked: true });
        }
      }
    }

    if (builtCount === 0) {
      return {
        success: false,
        newState: state,
        builtCount: 0,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason: '자금이 부족합니다 (다음 구간 최소 건설비 확인).',
      };
    }

    const finalMappedKm = Math.round(simMappedKmRaw * 10) / 10;
    const updatedEdges = state.osmEdges.map((e) =>
      builtEdgeIdSet.has(e.id) ? { ...e, built: true } : e
    );
    const updatedNodes =
      newlyConnectedNodeIds.size > 0
        ? state.osmNodes.map((n) =>
            newlyConnectedNodeIds.has(n.id) ? { ...n, connected: true } : n
          )
        : state.osmNodes;
    const updatedAchievements =
      unlockedAchIds.size > 0
        ? state.achievements.map((a) => (unlockedAchIds.has(a.id) ? { ...a, unlocked: true } : a))
        : state.achievements;

    const nextState: GameState = {
      ...state,
      capital: simCapital,
      totalLifetimeEarnings: simLifetime,
      skillPoints: 0,
      osmNodes: updatedNodes,
      osmEdges: updatedEdges,
      completedOsmWays: Array.from(completedWaySet),
      achievements: updatedAchievements,
      units: [],
      stats: {
        ...state.stats,
        totalOsmEdgesBuilt: state.stats.totalOsmEdgesBuilt + builtCount,
        totalLinesCompleted: 0,
        totalTownsCompleted: 0,
        mapped1to1Km: finalMappedKm,
        totalNetworkKm: finalMappedKm,
        connectedOsmNodes: simConnectedCount,
        totalScaledNodes: simConnectedCount,
      },
    };

    return {
      success: true,
      newState: nextState,
      builtCount,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: allAchs,
      newlyCompletedOsmWays: allWays,
    };
  }

  const bridgeInfo = resolveProximityBridgeInfo(state, fromNodeId, toNodeId);
  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  const fromHasEdges = graphIdx.hasEdgesSet.has(fromNodeId);
  const toHasEdges = graphIdx.hasEdgesSet.has(toNodeId);

  if (compat && compat !== 'transfer' && !bridgeInfo && fromHasEdges && toHasEdges) {
    return {
      success: false,
      newState: state,
      builtCount: 0,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason:
        compat === 'rail'
          ? '복선 철도 등 분리된 선로 레인 간에는 직접 연결할 수 없습니다. 실제 선로 분기점을 따라 연결하세요.'
          : '분리된 반대편 차선(2-lane) 노드는 직접 교차 연결할 수 없습니다. 실제 교차로나 연결 도로를 따라 이어가세요.',
    };
  }

  const maxDirectKm = bridgeInfo ? bridgeInfo.maxKm : 0.15;
  const direct = connectOsmNodesDirect(state, fromNodeId, toNodeId, maxDirectKm);
  return {
    success: direct.success,
    newState: direct.newState,
    builtCount: direct.success ? 1 : 0,
    newlyCompletedLines: [],
    newlyUnlockedAchievements: direct.newlyUnlockedAchievements,
    newlyCompletedOsmWays: direct.newlyCompletedOsmWays,
    reason: direct.reason,
  };
}

export function connectOsmNodesDirect(
  state: GameState,
  fromNodeId: string,
  toNodeId: string,
  maxBridgeKm = 0.5
): {
  success: boolean;
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
  reason?: string;
} {
  if (fromNodeId === toNodeId) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: '같은 노드입니다.',
    };
  }

  const graphIdx = getOsmGraphIndex(state.osmNodes || [], state.osmEdges || []);
  const preCheckA = graphIdx.nodeById.get(fromNodeId);
  const preCheckB = graphIdx.nodeById.get(toNodeId);
  if (graphIdx.hasAnyConnected) {
    if (preCheckA && preCheckB && !preCheckA.connected && !preCheckB.connected) {
      return {
        success: false,
        newState: state,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason: '이미 연결된 노선에서부터 이어서 연결하세요.',
      };
    }
    const frontierDist = computeOsmFrontierDistancesForState(state);
    if (!frontierDist.has(fromNodeId) || !frontierDist.has(toNodeId)) {
      return {
        success: false,
        newState: state,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason: `개척된 노드 끝단에서 거리 ${MAX_OSM_FRONTIER_DISTANCE} 이내의 노드만 개척할 수 있습니다.`,
      };
    }
  }

  let existing: OsmEdge | undefined;
  for (const e of graphIdx.adjEdgesAll.get(fromNodeId) || []) {
    if (
      (e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) ||
      (e.fromNodeId === toNodeId && e.toNodeId === fromNodeId)
    ) {
      existing = e;
      break;
    }
  }
  if (existing) {
    if (existing.built) {
      return {
        success: false,
        newState: state,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason: '이미 연결된 구간입니다.',
      };
    }
    return connectOsmEdge(state, existing.id);
  }

  const nA = preCheckA;
  const nB = preCheckB;
  if (!nA || !nB) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  if (!isNodeInUnlockedRegion(state, nA) || !isNodeInUnlockedRegion(state, nB)) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: '잠긴 지역의 노드는 먼저 지역을 잠금 해제한 뒤 연결할 수 있습니다.',
    };
  }

  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  if (!compat) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason:
        '도로 노드와 철도 노드는 직접 연결할 수 없습니다. 같은 유형의 노드를 선택하거나 [71] 복합 환승 링크 해금 후 35m 이내에서만 연결하세요.',
    };
  }

  const bridgeInfo = resolveProximityBridgeInfo(state, fromNodeId, toNodeId);
  if (compat !== 'transfer' && !bridgeInfo) {
    const fromHasEdges = graphIdx.hasEdgesSet.has(fromNodeId);
    const toHasEdges = graphIdx.hasEdgesSet.has(toNodeId);
    if (fromHasEdges && toHasEdges) {
      return {
        success: false,
        newState: state,
        newlyCompletedLines: [],
        newlyUnlockedAchievements: [],
        newlyCompletedOsmWays: [],
        reason:
          compat === 'rail'
            ? '별도의 선로 레인(2-lane)은 직접 건너뛰어 연결할 수 없습니다.'
            : '분리된 반대편 도로 차선(2-lane)은 직접 건너뛰어 연결할 수 없습니다.',
      };
    }
  }

  const dist = Math.max(0.005, haversineKm(nA.lat, nA.lng, nB.lat, nB.lng));
  const effectiveMaxKm =
    compat === 'transfer' ? 0.035 : bridgeInfo ? Math.max(maxBridgeKm, bridgeInfo.maxKm) : maxBridgeKm;
  if (dist > effectiveMaxKm) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
      reason: `실제 도로·철도 노선을 따라 연결하거나 ${Math.round(effectiveMaxKm * 1000)}m 이내 인접 노드를 선택해주세요.`,
    };
  }

  const edgeMode: 'road' | 'rail' = compat === 'rail' ? 'rail' : 'road';
  const wayName =
    compat === 'transfer'
      ? '복합 환승 직결'
      : bridgeInfo?.kind === 'cross_border'
      ? '인접 시 경계 직결 링크'
      : bridgeInfo?.kind === 'isolated_route'
      ? '인접 노선 연결'
      : edgeMode === 'rail'
      ? '철도 연결 링크'
      : '교차로 연결 링크';

  const customEdge: OsmEdge = {
    id: `oe_custom_${fromNodeId}_${toNodeId}`,
    wayName,
    highwayType: edgeMode === 'rail' ? 'rail' : 'unclassified',
    mode: edgeMode,
    fromNodeId,
    toNodeId,
    coordinates: [
      [nA.lat, nA.lng],
      [nB.lat, nB.lng],
    ],
    distanceKm: dist,
    buildCost: Math.max(20, Math.round(35 * (1 + dist * 6))),
    baseIncomePerSec: Math.round(1.8 * (1 + dist * 4) * 10) / 10,
    built: false,
    regionId: nA.regionId || nB.regionId,
  };

  const withEdge: GameState = {
    ...state,
    osmEdges: [...state.osmEdges, customEdge],
  };

  return connectOsmEdge(withEdge, customEdge.id);
}

export function buildSegment(
  state: GameState,
  _segmentId: string
): {
  success: boolean;
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
} {
  return {
    success: false,
    newState: state,
    newlyCompletedLines: [],
    newlyUnlockedAchievements: [],
  };
}

export function upgradeSegment(
  state: GameState,
  _segmentId: string
): { success: boolean; newState: GameState } {
  return { success: false, newState: state };
}

// ============================================================================
// ANTIMATTER DIMENSIONS STUDY TREE LOGIC (MONEY ONLY, NO SP)
// ============================================================================

export function getExclusivePathTag(_skill: SkillNode): 'A' | 'B' | 'C' | null {
  return null;
}

export function isSkillBlockedByExclusivePath(_state: GameState, _skill: SkillNode): boolean {
  return false;
}

export function areSkillRequirementsMet(state: GameState, skill: SkillNode): boolean {
  if (skill.requires.length === 0) return true;
  // Convergence study [111] unlocks when ANY of the 3 specialization path apex studies is bought
  if (skill.id === 'sk_multi_path') {
    return skill.requires.some((reqId) => {
      const reqSkill = state.skills.find((s) => s.id === reqId);
      return Boolean(reqSkill && reqSkill.level > 0);
    });
  }
  return skill.requires.every((reqId) => {
    const reqSkill = state.skills.find((s) => s.id === reqId);
    return Boolean(reqSkill && reqSkill.level > 0);
  });
}

export function getSkillMoneyCost(skill: SkillNode, levelOverride?: number): number {
  const growth = skill.costGrowth ?? 1.9;
  const lvl = levelOverride ?? skill.level;
  return Math.round(skill.costMoney * Math.pow(growth, lvl));
}

export function getSkillTotalInvestedCost(skill: SkillNode): number {
  let total = 0;
  for (let lvl = 0; lvl < skill.level; lvl++) {
    total += getSkillMoneyCost(skill, lvl);
  }
  return total;
}

export function canUnlockSkill(state: GameState, skill: SkillNode): boolean {
  if (skill.level >= skill.maxLevel) return false;
  if (!areSkillRequirementsMet(state, skill)) return false;
  if (isSkillBlockedByExclusivePath(state, skill)) return false;
  return state.capital >= getSkillMoneyCost(skill);
}

export function getSkillMaxAffordable(
  state: GameState,
  skill: SkillNode
): { count: number; totalCost: number } {
  if (
    skill.level >= skill.maxLevel ||
    !areSkillRequirementsMet(state, skill) ||
    isSkillBlockedByExclusivePath(state, skill)
  ) {
    return { count: 0, totalCost: 0 };
  }
  const remaining = skill.maxLevel - skill.level;
  let totalCost = 0;
  let count = 0;
  while (count < remaining) {
    const next = getSkillMoneyCost(skill, skill.level + count);
    if (totalCost + next > state.capital) break;
    totalCost += next;
    count++;
  }
  return { count, totalCost };
}

export function unlockSkill(
  state: GameState,
  skillId: string
): { success: boolean; newState: GameState; newlyUnlockedAchievements: Achievement[] } {
  const skill = state.skills.find((s) => s.id === skillId);
  if (!skill || !canUnlockSkill(state, skill)) {
    return { success: false, newState: state, newlyUnlockedAchievements: [] };
  }

  const moneyCost = getSkillMoneyCost(skill);
  const updatedSkills = state.skills.map((s) =>
    s.id === skillId ? { ...s, level: s.level + 1 } : s
  );

  const midState: GameState = {
    ...state,
    capital: state.capital - moneyCost,
    skillPoints: 0,
    skills: updatedSkills,
  };

  const evalResult = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    newState: evalResult.newState,
    newlyUnlockedAchievements: evalResult.newlyUnlockedAchievements,
  };
}

export function buyMaxSkill(
  state: GameState,
  skillId: string
): {
  success: boolean;
  newState: GameState;
  levelsBought: number;
  newlyUnlockedAchievements: Achievement[];
} {
  const skill = state.skills.find((s) => s.id === skillId);
  if (!skill) {
    return {
      success: false,
      newState: state,
      levelsBought: 0,
      newlyUnlockedAchievements: [],
    };
  }
  const bulk = getSkillMaxAffordable(state, skill);
  if (bulk.count <= 0 || state.capital < bulk.totalCost) {
    return {
      success: false,
      newState: state,
      levelsBought: 0,
      newlyUnlockedAchievements: [],
    };
  }

  const updatedSkills = state.skills.map((s) =>
    s.id === skillId ? { ...s, level: s.level + bulk.count } : s
  );
  const midState: GameState = {
    ...state,
    capital: state.capital - bulk.totalCost,
    skillPoints: 0,
    skills: updatedSkills,
  };
  const evalResult = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    newState: evalResult.newState,
    levelsBought: bulk.count,
    newlyUnlockedAchievements: evalResult.newlyUnlockedAchievements,
  };
}

export function buyAllAffordableSkills(state: GameState): {
  success: boolean;
  newState: GameState;
  levelsBought: number;
  newlyUnlockedAchievements: Achievement[];
} {
  let curState = state;
  let totalBought = 0;
  let allAchs: Achievement[] = [];

  // Iterate in ascending cost passes across all unlocked study branches
  for (let pass = 0; pass < 30; pass++) {
    const candidates = curState.skills
      .filter((sk) => canUnlockSkill(curState, sk))
      .sort((a, b) => getSkillMoneyCost(a) - getSkillMoneyCost(b));

    if (candidates.length === 0) break;

    let boughtInPass = 0;
    for (const cand of candidates) {
      const res = buyMaxSkill(curState, cand.id);
      if (res.success) {
        curState = res.newState;
        totalBought += res.levelsBought;
        boughtInPass += res.levelsBought;
        if (res.newlyUnlockedAchievements.length > 0) {
          allAchs = [...allAchs, ...res.newlyUnlockedAchievements];
        }
      }
    }
    if (boughtInPass === 0) break;
  }

  return {
    success: totalBought > 0,
    newState: curState,
    levelsBought: totalBought,
    newlyUnlockedAchievements: allAchs,
  };
}

export function resetSkillTree(state: GameState): {
  success: boolean;
  newState: GameState;
  refundedMoney: number;
} {
  let refundedMoney = 0;
  for (const sk of state.skills) {
    if (sk.level > 0) {
      refundedMoney += getSkillTotalInvestedCost(sk);
    }
  }
  if (refundedMoney <= 0 && !state.skills.some((s) => s.level > 0)) {
    return { success: false, newState: state, refundedMoney: 0 };
  }

  const resetSkills = state.skills.map((s) => ({ ...s, level: 0 }));
  const nextState = evaluateLinesAndAchievements({
    ...state,
    capital: state.capital + refundedMoney,
    skillPoints: 0,
    skills: resetSkills,
  }).newState;

  return {
    success: true,
    newState: nextState,
    refundedMoney,
  };
}

export function dispatchClickBonus(state: GameState): {
  newState: GameState;
  earned: number;
} {
  const earned = calculateClickReward(state);
  return {
    earned,
    newState: {
      ...state,
      capital: state.capital + earned,
      totalLifetimeEarnings: state.totalLifetimeEarnings + earned,
      stats: {
        ...state.stats,
        totalClicks: state.stats.totalClicks + 1,
      },
    },
  };
}

export function advanceTick(
  state: GameState,
  deltaSeconds: number
): {
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
  newlyUnlockedMilestones: MinigameMilestoneDef[];
} {
  const dt = Math.min(deltaSeconds, 0.25);
  const incomePerSec = calculateTotalIncomePerSec(state);
  const earned = incomePerSec * dt;

  const prevMg = backfillMinigamesState(state.minigames);
  const prevMilestoneSet = new Set(prevMg.unlockedMilestoneIds || []);
  const nextMinigames = advanceMinigamesTick(prevMg, dt);
  const newlyUnlockedMilestones = MINIGAME_MILESTONES.filter(
    (ms) => !prevMilestoneSet.has(ms.id) && nextMinigames.unlockedMilestoneIds.includes(ms.id)
  );

  const nextState: GameState = {
    ...state,
    capital: state.capital + earned,
    totalLifetimeEarnings: state.totalLifetimeEarnings + earned,
    units: [],
    lastTickTimestamp: Date.now(),
    minigames: nextMinigames,
  };

  return {
    newState: nextState,
    newlyCompletedLines: [],
    newlyUnlockedAchievements: [],
    newlyCompletedOsmWays: [],
    newlyUnlockedMilestones,
  };
}

export function calculatePrestigeGain(
  _totalLifetimeEarnings: number,
  _prestigeBonusMult = 1
): number {
  return 0;
}
