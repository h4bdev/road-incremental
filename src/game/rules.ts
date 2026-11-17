import { haversineKm } from './osmService';
import {
  Achievement,
  GameState,
  MapNode,
  MinigameMilestoneDef,
  MovingUnit,
  OsmEdge,
  OsmNode,
  PredefinedSegment,
  SkillNode,
  StartingCity,
  TransportLine,
  UpgradeItem,
} from './types';
import {
  buildAchievements,
  CURATED_LINES,
  CURATED_NODES,
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

export const GLOBAL_OSM_NODE_TARGET = 450_000_000; // 4억 5천만 개 지구 OSM 노드 스케일 목표
export const MAX_OSM_FRONTIER_DISTANCE = 5;

export interface ActiveMultipliers {
  buildCostMult: number;
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
  autoBuilderRatePerSec: number;
  parallelBuildCount: number;
  offlineEfficiencyMult: number;
  prestigeBonusMult: number;
  minigameBoostPct: number;
  minigameIncomeMult: number;
}

export function ensureSeedConnectedOsmNodes(
  nodes: OsmNode[],
  edges: OsmEdge[],
  startingCity: StartingCity
): OsmNode[] {
  if (nodes.length === 0 || nodes.some((n) => n.connected)) {
    return nodes;
  }

  const edgeNodeIds = new Set<string>();
  const railEdgeNodeIds = new Set<string>();
  for (const e of edges) {
    edgeNodeIds.add(e.fromNodeId);
    edgeNodeIds.add(e.toNodeId);
    if (e.mode === 'rail') {
      railEdgeNodeIds.add(e.fromNodeId);
      railEdgeNodeIds.add(e.toNodeId);
    }
  }

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

  const roadPool = nodes.filter(
    (n) => (n.mode !== 'rail') && (edgeNodeIds.size === 0 || edgeNodeIds.has(n.id))
  );
  const primaryPick = findClosest(roadPool.length > 0 ? roadPool : nodes);
  const seedIds = new Set<string>();
  if (primaryPick) {
    seedIds.add(primaryPick.node.id);
  }

  // Also seed closest railway node (that has rail track edges) within 2.5km if primary seed wasn't rail/mixed
  if (primaryPick?.node.mode !== 'rail' && primaryPick?.node.mode !== 'mixed' && railEdgeNodeIds.size > 0) {
    const railPool = nodes.filter((n) => railEdgeNodeIds.has(n.id));
    const railPick = findClosest(railPool);
    if (railPick && railPick.distKm <= 2.5) {
      seedIds.add(railPick.node.id);
    }
  }

  if (seedIds.size === 0) return nodes;
  return nodes.map((n) => (seedIds.has(n.id) ? { ...n, connected: true } : n));
}

export function scopeGameStateToStartingCity(state: GameState): GameState {
  const cityId = state.startingCity.id;
  const nodes = state.nodes.filter((n) => n.cityId === cityId);
  const lines = state.lines.filter((l) => l.cityId === cityId);
  const allowedLineIds = new Set(lines.map((l) => l.id));
  const segments = state.segments.filter((s) => allowedLineIds.has(s.lineId));

  const achievements = state.achievements.filter((ach) => {
    if ((ach.targetType as string) === 'landmark_count' || (ach.category as string) === 'landmark') {
      return false;
    }
    if (ach.targetType === 'line_complete') {
      return Boolean(ach.targetId && allowedLineIds.has(ach.targetId));
    }
    if (ach.targetType === 'town_complete') {
      return ach.targetId === cityId;
    }
    return true;
  });

  const seededOsmNodes = ensureSeedConnectedOsmNodes(
    state.osmNodes || [],
    state.osmEdges || [],
    state.startingCity
  );

  return {
    ...state,
    nodes,
    lines,
    segments,
    osmNodes: seededOsmNodes,
    loadedOsmRegions: Array.isArray(state.loadedOsmRegions) ? state.loadedOsmRegions : [],
    achievements,
    stats: {
      ...state.stats,
      connectedOsmNodes: seededOsmNodes.filter((n) => n.connected).length,
      totalLinesCompleted: lines.filter((l) => l.completed).length,
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
  carryOverPrestige?: { prestigeCount: number; prestigeMultiplier: number }
): GameState {
  const cityId = startingCity.id;

  const nodes: MapNode[] = [
    ...CURATED_NODES.filter((n) => n.cityId === cityId).map((n) => ({ ...n })),
    ...(customNetwork?.nodes.map((n) => ({ ...n })) || []),
  ];
  const lines: TransportLine[] = [
    ...CURATED_LINES.filter((l) => l.cityId === cityId).map((l) => ({
      ...l,
      segmentIds: [...l.segmentIds],
      completionBonus: { ...l.completionBonus },
    })),
    ...(customNetwork?.lines.map((l) => ({
      ...l,
      segmentIds: [...l.segmentIds],
      completionBonus: { ...l.completionBonus },
    })) || []),
  ];
  const allowedLineIds = new Set(lines.map((l) => l.id));
  const segments: PredefinedSegment[] = [
    ...CURATED_SEGMENTS.filter((s) => allowedLineIds.has(s.lineId)).map((s) => ({
      ...s,
      coordinates: s.coordinates.map((c) => [...c] as [number, number]),
    })),
    ...(customNetwork?.segments.map((s) => ({
      ...s,
      coordinates: s.coordinates.map((c) => [...c] as [number, number]),
    })) || []),
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

  const achievements = buildAchievements(lines, startingCity);

  return {
    startingCity,
    capital: 1200,
    totalLifetimeEarnings: 0,
    skillPoints: 2 + (carryOverPrestige?.prestigeCount || 0) * 2,
    prestigeMultiplier: carryOverPrestige?.prestigeMultiplier || 1,
    nodes,
    segments,
    lines,
    osmNodes: [],
    osmEdges: [],
    loadedOsmChunks: [],
    loadedOsmRegions: [],
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
      prestigeCount: carryOverPrestige?.prestigeCount || 0,
    },
    settings: {
      soundEnabled: true,
      mapTileLayer: 'dark',
    },
    autoBuilderProgress: 0,
    lastTickTimestamp: Date.now(),
    minigames: createInitialMinigamesState(),
  };
}

export function calculateMultipliers(state: GameState): ActiveMultipliers {
  const sk = (id: string) => state.skills.find((s) => s.id === id)?.level || 0;
  const up = (id: string) => state.upgrades?.find((u) => u.id === id)?.level || 0;

  // Cost reduction (up to 85% discount across tree + upgrades)
  const treeCostFactor =
    Math.max(0.4, 1 - sk('sk_root_l') * 0.08 - sk('sk_infra_1') * 0.1 - sk('sk_re_2') * 0.06);
  const upgCostFactor = Math.pow(0.985, up('upg_road_cost'));
  const buildCostMult = Math.max(0.15, treeCostFactor * upgCostFactor);

  // Network km & 450M+ node scaling
  const treeKmMult =
    (1 + sk('sk_trunk_2') * 0.5 + sk('sk_infra_2') * 0.8) * Math.pow(3, sk('sk_auto_2'));
  const upgKmMult = 1 + up('upg_interchange_grid') * 0.35;
  const networkKmMult = treeKmMult * upgKmMult;

  const nodeScaleMult =
    networkKmMult *
    Math.pow(2.0, sk('sk_infra_6')) *
    Math.pow(2.5, sk('sk_crown_2')) *
    Math.pow(5.0, sk('sk_crown_3')) *
    Math.pow(1.45, up('upg_planetary_nodes')) *
    Math.pow(1.6, up('upg_dyson_grid'));

  // Achievements % bonus amplified by upg_achievement_amp
  let achievementIncomePct = 0;
  for (const ach of state.achievements) {
    if (ach.unlocked) achievementIncomePct += ach.bonusIncomePct;
  }
  const achAmp = 1 + up('upg_achievement_amp') * 0.12;
  const achMult = 1 + (achievementIncomePct * achAmp) / 100;

  // Freight built-count bonus from upg_freight_dispatch
  const totalBuiltCorridors =
    state.stats.totalSegmentsBuilt + state.stats.totalOsmEdgesBuilt;
  const freightBonusMult =
    1 + totalBuiltCorridors * up('upg_freight_dispatch') * 0.005;

  // Tree global income multipliers
  const treeGlobalMult =
    (1 +
      sk('sk_root_0') * 0.25 +
      sk('sk_speed_1') * 0.28 +
      sk('sk_re_2') * 0.2 +
      sk('sk_re_4') * 0.35) *
    Math.pow(1.18, sk('sk_trunk_1')) *
    Math.pow(1.25, sk('sk_infra_5')) *
    Math.pow(1.35, sk('sk_speed_3')) *
    Math.pow(1.45, sk('sk_speed_5')) *
    Math.pow(1.3, sk('sk_auto_4')) *
    Math.pow(1.5, sk('sk_auto_5')) *
    Math.pow(1.6, sk('sk_re_5')) *
    Math.pow(1.4, sk('sk_crown_1')) *
    Math.pow(1.65, sk('sk_crown_2')) *
    Math.pow(2.5, sk('sk_crown_3'));

  // Upgrade global income multipliers
  const upgGlobalMult =
    (1 + up('upg_atcs_signal') * 0.15) *
    Math.pow(1.25, up('upg_subsea_tunnel')) *
    Math.pow(1.6, up('upg_dyson_grid'));

  const minigameBoost = getMinigameIncomeBoost(state.minigames);

  const globalIncomeMult =
    state.prestigeMultiplier *
    treeGlobalMult *
    upgGlobalMult *
    achMult *
    freightBonusMult *
    minigameBoost.incomeMult;

  const roadIncomeMult =
    (1 + sk('sk_infra_3') * 0.5) * Math.pow(1.14, up('upg_smart_asphalt'));
  const railIncomeMult =
    (1 + sk('sk_infra_3') * 0.5 + up('upg_double_track') * 0.25) *
    Math.pow(1.18, up('upg_maglev_tube'));

  const osmNodeIncomeMult =
    (1 +
      sk('sk_trunk_1') * 0.3 +
      sk('sk_infra_4') * 0.45 +
      sk('sk_re_1') * 0.45 +
      up('upg_node_yield') * 0.2) *
    Math.pow(1.45, sk('sk_re_3')) *
    Math.pow(1.16, up('upg_landmark_mgr')) *
    globalIncomeMult;

  const junctionFlatPerNode = up('upg_junction_synergy') * 0.8 * globalIncomeMult;

  const clickBonusMult =
    (1 + sk('sk_root_r') * 0.6 + sk('sk_speed_2') * 1.5 + up('upg_snap_tool') * 0.4) *
    Math.pow(1.6, sk('sk_speed_4')) *
    Math.pow(1.22, up('upg_night_shift'));
  const clickDpsSeconds = 1.4 + up('upg_gis_crawler') * 0.3;
  const edgeCashbackFlat = up('upg_chain_linker') * 45;

  const auto1 = sk('sk_auto_1');
  const auto5 = sk('sk_auto_5');
  const autoBuilderRatePerSec =
    auto1 > 0
      ? 0.2 *
        (1 + (auto1 - 1) * 0.45 + auto5 * 0.6) *
        (1 + up('upg_osm_bot_speed') * 0.18)
      : 0;
  const parallelBuildCount = 1 + sk('sk_auto_3') + up('upg_parallel_paver');

  const offlineEfficiencyMult = 1 + up('upg_satellite_sync') * 0.25;
  const prestigeBonusMult = 1 + up('upg_blueprint_vault') * 0.15;

  return {
    buildCostMult,
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
    autoBuilderRatePerSec,
    parallelBuildCount,
    offlineEfficiencyMult,
    prestigeBonusMult,
    minigameBoostPct: minigameBoost.boostPct,
    minigameIncomeMult: minigameBoost.incomeMult,
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
  return Math.max(20, Math.round(edge.buildCost * mults.buildCostMult));
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

export function canUnlockUpgrade(state: GameState, upg: UpgradeItem): boolean {
  if (upg.level >= upg.maxLevel) return false;
  if (upg.unlockRequirement) {
    const req = state.upgrades.find((u) => u.id === upg.unlockRequirement!.upgradeId);
    if (!req || req.level < upg.unlockRequirement.minLevel) return false;
  }
  return state.capital >= getUpgradeCost(upg, 0);
}

export function buyUpgrade(
  state: GameState,
  upgradeId: string,
  count: 1 | 10 | 'max' = 1
): { success: boolean; newState: GameState; levelsBought: number } {
  const upg = state.upgrades.find((u) => u.id === upgradeId);
  if (!upg || upg.level >= upg.maxLevel) {
    return { success: false, newState: state, levelsBought: 0 };
  }
  if (upg.unlockRequirement) {
    const req = state.upgrades.find((u) => u.id === upg.unlockRequirement!.upgradeId);
    if (!req || req.level < upg.unlockRequirement.minLevel) {
      return { success: false, newState: state, levelsBought: 0 };
    }
  }

  const bulk = getBulkUpgradeCost(upg, count, state.capital);
  if (bulk.count <= 0 || state.capital < bulk.totalCost) {
    return { success: false, newState: state, levelsBought: 0 };
  }

  const updatedUpgrades = state.upgrades.map((u) =>
    u.id === upgradeId ? { ...u, level: u.level + bulk.count } : u
  );

  const midState: GameState = {
    ...state,
    capital: state.capital - bulk.totalCost,
    upgrades: updatedUpgrades,
  };

  const evalRes = evaluateLinesAndAchievements(midState);
  return { success: true, newState: evalRes.newState, levelsBought: bulk.count };
}

export function calculateTotalIncomePerSec(state: GameState): number {
  const mults = calculateMultipliers(state);

  let segmentIncome = 0;
  for (const seg of state.segments) {
    if (!seg.built) continue;
    const levelMult = 1 + (seg.level - 1) * 0.65;
    const modeMult = seg.mode === 'rail' ? mults.railIncomeMult : mults.roadIncomeMult;
    segmentIncome += seg.baseIncomePerSec * levelMult * modeMult * mults.globalIncomeMult;
  }

  let osmEdgeIncome = 0;
  for (const edge of state.osmEdges || []) {
    if (!edge.built) continue;
    const modeMult = edge.mode === 'rail' ? mults.railIncomeMult : mults.roadIncomeMult;
    osmEdgeIncome += edge.baseIncomePerSec * modeMult * mults.osmNodeIncomeMult;
  }

  const connectedOsmNodesCount = (state.osmNodes || []).filter((n) => n.connected).length;
  const junctionBonus = connectedOsmNodesCount * mults.junctionFlatPerNode;

  return Math.round((segmentIncome + osmEdgeIncome + junctionBonus) * 10) / 10;
}

export function calculateClickReward(state: GameState): number {
  const mults = calculateMultipliers(state);
  const incomePerSec = calculateTotalIncomePerSec(state);
  return Math.round((25 + incomePerSec * mults.clickDpsSeconds) * mults.clickBonusMult);
}

export function recomputeNetworkMetrics(state: GameState): {
  mapped1to1Km: number;
  totalNetworkKm: number;
  connectedOsmNodes: number;
  totalScaledNodes: number;
} {
  const mults = calculateMultipliers(state);
  let mapped = 0;
  let feederTotal = 0;

  for (const seg of state.segments) {
    if (!seg.built) continue;
    const levelBonus = 1 + (seg.level - 1) * 0.5;
    mapped += seg.distanceKm;
    feederTotal += (seg.distanceKm + seg.feederNetworkKm * levelBonus) * mults.networkKmMult;
  }

  let builtEdges = 0;
  for (const edge of state.osmEdges || []) {
    if (!edge.built) continue;
    builtEdges++;
    mapped += edge.distanceKm;
    feederTotal += (edge.distanceKm + 1.5) * mults.networkKmMult;
  }

  const connectedOsmNodes = (state.osmNodes || []).filter((n) => n.connected).length;
  const rawNodesEquivalent =
    connectedOsmNodes + builtEdges + state.stats.totalSegmentsBuilt * 12;
  const totalScaledNodes = Math.round(rawNodesEquivalent * mults.nodeScaleMult);

  return {
    mapped1to1Km: Math.round(mapped * 10) / 10,
    totalNetworkKm: Math.round(feederTotal),
    connectedOsmNodes,
    totalScaledNodes,
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

export function getOsmNodeMode(
  state: GameState,
  nodeId: string
): 'road' | 'rail' | 'mixed' {
  const node = (state.osmNodes || []).find((n) => n.id === nodeId);
  let hasRoad = node?.mode === 'road' || node?.mode === 'mixed';
  let hasRail = node?.mode === 'rail' || node?.mode === 'mixed';

  for (const e of state.osmEdges || []) {
    if (e.fromNodeId === nodeId || e.toNodeId === nodeId) {
      if (e.mode === 'rail') hasRail = true;
      else hasRoad = true;
    }
  }

  if (hasRoad && hasRail) return 'mixed';
  if (hasRail) return 'rail';
  return 'road';
}

export function resolveCompatibleOsmMode(
  state: GameState,
  fromNodeId: string,
  toNodeId: string
): 'road' | 'rail' | 'both' | 'transfer' | null {
  if (fromNodeId === toNodeId) return null;

  const existingEdge = (state.osmEdges || []).find(
    (e) =>
      (e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) ||
      (e.fromNodeId === toNodeId && e.toNodeId === fromNodeId)
  );
  if (existingEdge) {
    return existingEdge.mode;
  }

  const modeA = getOsmNodeMode(state, fromNodeId);
  const modeB = getOsmNodeMode(state, toNodeId);

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

  // Special Case: Pure Road <-> Pure Rail transfer bridge is ONLY allowed if
  // 'sk_infra_4' (OSM 교차점 병렬 링크) is unlocked AND nodes are <= 35m apart.
  const transferSkillLevel =
    state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0;
  if (transferSkillLevel > 0) {
    const nA = (state.osmNodes || []).find((n) => n.id === fromNodeId);
    const nB = (state.osmNodes || []).find((n) => n.id === toNodeId);
    if (nA && nB && haversineKm(nA.lat, nA.lng, nB.lat, nB.lng) <= 0.035) {
      return 'transfer';
    }
  }

  return null;
}

export function getLineNodeProgress(
  state: GameState,
  line: TransportLine
): { current: number; target: number } {
  const lineSegs = state.segments.filter((s) => s.lineId === line.id);
  const anchorPoints: Array<[number, number]> = [];
  for (const seg of lineSegs) {
    for (const pt of seg.coordinates) {
      anchorPoints.push(pt);
    }
  }
  if (anchorPoints.length === 0) {
    const cityFallback =
      line.cityId === state.startingCity.id
        ? state.startingCity
        : PRESET_CITIES.find((c) => c.id === line.cityId);
    if (cityFallback) {
      anchorPoints.push([cityFallback.lat, cityFallback.lng]);
    }
  }

  const matchingNodeIds = new Set<string>();
  const matchedRegions = new Set<string>();

  for (const edge of state.osmEdges || []) {
    if (!edge.built) continue;
    // Strict mode matching: road lines only progress from road edges; rail lines only from rail edges
    if (edge.mode !== line.mode) continue;

    const midLat = (edge.coordinates[0][0] + edge.coordinates[1][0]) / 2;
    const midLng = (edge.coordinates[0][1] + edge.coordinates[1][1]) / 2;

    if (line.cityId === 'global') {
      matchingNodeIds.add(edge.fromNodeId);
      matchingNodeIds.add(edge.toNodeId);
      matchedRegions.add(`${Math.round(midLat / 2)}_${Math.round(midLng / 2)}`);
    } else if (anchorPoints.length > 0) {
      let inCorridor = false;
      for (const [aLat, aLng] of anchorPoints) {
        if (Math.abs(midLat - aLat) > 0.9 || Math.abs(midLng - aLng) > 1.2) continue;
        if (haversineKm(midLat, midLng, aLat, aLng) <= 80) {
          inCorridor = true;
          break;
        }
      }
      if (inCorridor) {
        matchingNodeIds.add(edge.fromNodeId);
        matchingNodeIds.add(edge.toNodeId);
      }
    }
  }

  const isLocal = line.cityId === state.startingCity.id;
  let target = 24;
  if (line.cityId === 'global') {
    target = 120;
  } else if (isLocal) {
    const localSameMode = state.lines.filter(
      (l) => l.cityId === state.startingCity.id && l.mode === line.mode
    );
    const idx = Math.max(0, localSameMode.findIndex((l) => l.id === line.id));
    const localTargets = line.category === 'highway' ? [30, 50, 75] : [12, 24, 40, 60];
    target = localTargets[idx] ?? 24 + idx * 20;
  } else {
    const globalTargets: Record<TransportLine['category'], number> = {
      metro: 24,
      arterial: 24,
      highway: 40,
      highspeed_rail: 45,
    };
    target = globalTargets[line.category] ?? 30;
  }

  // Global intercontinental corridor requires rail nodes across at least 2 distinct regions
  if (line.cityId === 'global' && matchedRegions.size < 2) {
    return { current: Math.min(matchingNodeIds.size, target - 1), target };
  }

  return { current: matchingNodeIds.size, target };
}

export function evaluateLinesAndAchievements(state: GameState): {
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
} {
  const newlyCompletedLines: TransportLine[] = [];

  const updatedLines = state.lines.map((line) => {
    const { current, target } = getLineNodeProgress(state, line);
    if (current >= target && !line.completed) {
      const completedLine = { ...line, completed: true };
      newlyCompletedLines.push(completedLine);
      return completedLine;
    }
    return line;
  });

  // Detect real OSM road/rail ways completed via node linking
  const wayGroups = new Map<
    string,
    { wayName: string; mode: 'road' | 'rail'; total: number; built: number }
  >();
  for (const edge of state.osmEdges || []) {
    if (!edge.wayName || CUSTOM_BRIDGE_WAY_NAMES.has(edge.wayName)) continue;
    const key = `${edge.mode}::${edge.wayName}`;
    const prev = wayGroups.get(key) || {
      wayName: edge.wayName,
      mode: edge.mode,
      total: 0,
      built: 0,
    };
    prev.total += 1;
    if (edge.built) prev.built += 1;
    wayGroups.set(key, prev);
  }

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

  const completedLineIds = new Set(
    updatedLines.filter((l) => l.completed).map((l) => l.id)
  );

  const startingCityLines = updatedLines.filter((l) => l.cityId === state.startingCity.id);
  const startingCityCompleted =
    startingCityLines.length > 0 && startingCityLines.every((l) => l.completed);

  const metrics = recomputeNetworkMetrics({ ...state, lines: updatedLines });

  let bonusCash = wayBonusCash;
  let bonusSP = 0;
  const newlyUnlockedAchievements: Achievement[] = [];

  const updatedAchievements = state.achievements.map((ach) => {
    if (ach.unlocked) return ach;

    let met = false;
    if (ach.targetType === 'line_complete' && ach.targetId) {
      met = completedLineIds.has(ach.targetId);
    } else if (ach.targetType === 'town_complete') {
      met = startingCityCompleted;
    } else if (ach.targetType === 'total_km' && ach.targetValue !== undefined) {
      met = metrics.totalNetworkKm >= ach.targetValue;
    } else if (ach.targetType === 'osm_nodes' && ach.targetValue !== undefined) {
      met =
        ach.targetValue <= 500
          ? metrics.connectedOsmNodes >= ach.targetValue
          : Math.max(metrics.connectedOsmNodes, metrics.totalScaledNodes) >= ach.targetValue;
    }

    if (met) {
      bonusCash += ach.bonusCash;
      bonusSP += ach.bonusSkillPoints;
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
    skillPoints: state.skillPoints + bonusSP,
    lines: updatedLines,
    completedOsmWays: Array.from(completedWaySet),
    achievements: updatedAchievements,
    stats: {
      ...state.stats,
      totalLinesCompleted: updatedLines.filter((l) => l.completed).length,
      totalTownsCompleted: startingCityCompleted ? 1 : 0,
      mapped1to1Km: metrics.mapped1to1Km,
      totalNetworkKm: metrics.totalNetworkKm,
      connectedOsmNodes: metrics.connectedOsmNodes,
      totalScaledNodes: metrics.totalScaledNodes,
    },
  };

  return { newState, newlyCompletedLines, newlyUnlockedAchievements, newlyCompletedOsmWays };
}

/**
 * Multi-source BFS computing hop distance `d` from explored (connected: true) OSM nodes.
 * - Explored nodes have `d = 0`.
 * - Unexplored frontier nodes have `1 <= d <= maxDist` (default 5).
 * - Unexplored nodes with `d > maxDist` or unreachable are omitted from the returned map.
 */
export function computeOsmFrontierDistances(
  osmNodes: OsmNode[],
  osmEdges: OsmEdge[],
  maxDist = MAX_OSM_FRONTIER_DISTANCE,
  transferDistanceKm = 0
): Map<string, number> {
  const distances = new Map<string, number>();
  if (osmNodes.length === 0) return distances;

  const adj = new Map<string, string[]>();
  for (const e of osmEdges) {
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
    adj.get(e.toNodeId)!.push(e.fromNodeId);
  }

  const queue: string[] = [];
  const connectedNodes: OsmNode[] = [];
  for (const n of osmNodes) {
    if (n.connected) {
      distances.set(n.id, 0);
      queue.push(n.id);
      connectedNodes.push(n);
    }
  }

  // If transfer skill (sk_infra_4) is unlocked, unexplored transfer targets <=35m from a connected node count as d=1
  if (transferDistanceKm > 0 && connectedNodes.length > 0 && maxDist >= 1) {
    for (const n of osmNodes) {
      if (n.connected || distances.has(n.id)) continue;
      for (const cn of connectedNodes) {
        if (Math.abs(n.lat - cn.lat) > 0.001 || Math.abs(n.lng - cn.lng) > 0.001) continue;
        if (haversineKm(cn.lat, cn.lng, n.lat, n.lng) <= transferDistanceKm) {
          distances.set(n.id, 1);
          queue.push(n.id);
          break;
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const dCurr = distances.get(curr) ?? 0;
    if (dCurr >= maxDist) continue;
    for (const nextId of adj.get(curr) || []) {
      if (!distances.has(nextId)) {
        distances.set(nextId, dCurr + 1);
        queue.push(nextId);
      }
    }
  }

  return distances;
}

export function computeOsmFrontierDistancesForState(
  state: GameState,
  maxDist = MAX_OSM_FRONTIER_DISTANCE
): Map<string, number> {
  const transferUnlocked = (state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0) > 0;
  return computeOsmFrontierDistances(
    state.osmNodes || [],
    state.osmEdges || [],
    maxDist,
    transferUnlocked ? 0.035 : 0
  );
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
  // Blend toward dark slate background rgb(12, 18, 30) as brightness drops
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
  regionId?: string
): GameState {
  const existingNodeMap = new Map((state.osmNodes || []).map((n) => [n.id, n]));
  incomingNodes.forEach((n) => {
    const prev = existingNodeMap.get(n.id);
    if (!prev) {
      existingNodeMap.set(n.id, { ...n });
    } else if (n.mode && prev.mode && prev.mode !== n.mode) {
      existingNodeMap.set(n.id, { ...prev, mode: 'mixed' });
    } else if (n.mode && !prev.mode) {
      existingNodeMap.set(n.id, { ...prev, mode: n.mode });
    }
  });

  const existingEdgeMap = new Map((state.osmEdges || []).map((e) => [e.id, e]));
  incomingEdges.forEach((e) => {
    if (!existingEdgeMap.has(e.id)) {
      existingEdgeMap.set(e.id, { ...e });
    }
  });

  const allNodes = Array.from(existingNodeMap.values());
  const allEdges = Array.from(existingEdgeMap.values());
  const seededNodes = ensureSeedConnectedOsmNodes(allNodes, allEdges, state.startingCity);

  const loadedChunks = state.loadedOsmChunks.includes(chunkKey)
    ? state.loadedOsmChunks
    : [...state.loadedOsmChunks, chunkKey];

  const prevRegions = state.loadedOsmRegions || [];
  const loadedRegions =
    regionId && !prevRegions.includes(regionId) ? [...prevRegions, regionId] : prevRegions;

  const mergedState: GameState = {
    ...state,
    osmNodes: seededNodes,
    osmEdges: allEdges,
    loadedOsmChunks: loadedChunks,
    loadedOsmRegions: loadedRegions,
  };

  return evaluateLinesAndAchievements(mergedState).newState;
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
  const edge = (state.osmEdges || []).find((e) => e.id === edgeId);
  if (!edge || edge.built) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
    };
  }

  const hasAnyConnected = (state.osmNodes || []).some((n) => n.connected);
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

  // Spawn 1 animated unit roughly every 2 built ~24m edges (and cap OSM units at 50)
  const existingOsmUnits = state.units.filter((u) => u.id.startsWith('u_osm_')).length;
  const shouldSpawnUnit =
    existingOsmUnits < 50 && state.stats.totalOsmEdgesBuilt % 2 === 0;
  const nextUnits = shouldSpawnUnit
    ? [
        ...state.units,
        {
          id: `u_osm_${edgeId}`,
          segmentId: edgeId,
          mode: edge.mode,
          color: edge.mode === 'rail' ? '#38bdf8' : '#f59e0b',
          progress: 0.25,
          direction: 1 as const,
        },
      ]
    : state.units;

  const midState: GameState = {
    ...state,
    capital: state.capital - cost + mults.edgeCashbackFlat,
    totalLifetimeEarnings: state.totalLifetimeEarnings + mults.edgeCashbackFlat,
    osmNodes: updatedNodes,
    osmEdges: updatedEdges,
    units: nextUnits,
    stats: {
      ...state.stats,
      totalOsmEdgesBuilt: state.stats.totalOsmEdgesBuilt + 1,
    },
  };

  const evalRes = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    newState: evalRes.newState,
    newlyCompletedLines: evalRes.newlyCompletedLines,
    newlyUnlockedAchievements: evalRes.newlyUnlockedAchievements,
    newlyCompletedOsmWays: evalRes.newlyCompletedOsmWays,
  };
}

function runModeSpecificDijkstra(
  edges: OsmEdge[],
  allowedMode: 'road' | 'rail',
  fromNodeId: string,
  toNodeId: string,
  maxHops: number
): { edgeIds: string[]; totalDistanceKm: number } | null {
  const adj = new Map<string, Array<{ nextId: string; edge: OsmEdge }>>();
  for (const e of edges) {
    if (e.mode !== allowedMode) continue;
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push({ nextId: e.toNodeId, edge: e });
    adj.get(e.toNodeId)!.push({ nextId: e.fromNodeId, edge: e });
  }

  if (!adj.has(fromNodeId) || !adj.has(toNodeId)) return null;

  const dist = new Map<string, number>();
  const hops = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edge: OsmEdge }>();
  const visited = new Set<string>();

  dist.set(fromNodeId, 0);
  hops.set(fromNodeId, 0);

  const queue: string[] = [fromNodeId];

  while (queue.length > 0) {
    let bestIdx = 0;
    let bestD = dist.get(queue[0]) ?? Infinity;
    for (let i = 1; i < queue.length; i++) {
      const d = dist.get(queue[i]) ?? Infinity;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const curr = queue.splice(bestIdx, 1)[0];
    if (visited.has(curr)) continue;
    visited.add(curr);

    if (curr === toNodeId) break;
    const currHops = hops.get(curr) || 0;
    if (currHops >= maxHops) continue;

    for (const neighbor of adj.get(curr) || []) {
      if (visited.has(neighbor.nextId)) continue;
      const alt = bestD + Math.max(0.002, neighbor.edge.distanceKm);
      if (alt < (dist.get(neighbor.nextId) ?? Infinity)) {
        dist.set(neighbor.nextId, alt);
        hops.set(neighbor.nextId, currHops + 1);
        prev.set(neighbor.nextId, { nodeId: curr, edge: neighbor.edge });
        queue.push(neighbor.nextId);
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

/**
 * Find shortest path along existing real OSM road/rail edges between two nodes (mode-isolated Dijkstra).
 * Road paths strictly traverse road edges; rail paths strictly traverse rail edges.
 */
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
  const edges = state.osmEdges || [];
  if (edges.length === 0) return null;

  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  if (!compat || compat === 'transfer') return null;

  let chosen: { edgeIds: string[]; totalDistanceKm: number } | null = null;
  if (compat === 'road' || compat === 'rail') {
    chosen = runModeSpecificDijkstra(edges, compat, fromNodeId, toNodeId, maxHops);
  } else {
    const roadPath = runModeSpecificDijkstra(edges, 'road', fromNodeId, toNodeId, maxHops);
    const railPath = runModeSpecificDijkstra(edges, 'rail', fromNodeId, toNodeId, maxHops);
    if (roadPath && railPath) {
      chosen = roadPath.totalDistanceKm <= railPath.totalDistanceKm ? roadPath : railPath;
    } else {
      chosen = roadPath || railPath;
    }
  }

  if (!chosen) return null;

  const mults = calculateMultipliers(state);
  const edgeMap = new Map(edges.map((e) => [e.id, e]));
  const unbuiltEdgeIds: string[] = [];
  let totalUnbuiltCost = 0;

  for (const eid of chosen.edgeIds) {
    const e = edgeMap.get(eid);
    if (!e) continue;
    if (!e.built) {
      unbuiltEdgeIds.push(eid);
      totalUnbuiltCost += getOsmEdgeBuildCost(e, mults);
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
  edges: OsmEdge[],
  startNodeId: string,
  allowedMode: 'road' | 'rail',
  maxHops: number
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.mode !== allowedMode) continue;
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
    adj.get(e.toNodeId)!.push(e.fromNodeId);
  }

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
    for (const nextId of adj.get(curr) || []) {
      if (reached.has(nextId)) continue;
      reached.add(nextId);
      hops.set(nextId, currHops + 1);
      queue.push(nextId);
    }
  }
  return reached;
}

/**
 * Returns all node IDs reachable from fromNodeId via valid mode-isolated OSM paths
 * (plus <=35m transfer links if sk_infra_4 is unlocked).
 */
export function getReachableOsmNodeSet(
  state: GameState,
  fromNodeId: string,
  maxHops = 140
): Set<string> {
  const edges = state.osmEdges || [];
  const modeA = getOsmNodeMode(state, fromNodeId);
  const result = new Set<string>([fromNodeId]);

  if (modeA === 'road' || modeA === 'mixed') {
    const roadReached = bfsReachableByMode(edges, fromNodeId, 'road', maxHops);
    for (const id of roadReached) {
      const m = getOsmNodeMode(state, id);
      if (m === 'road' || m === 'mixed') result.add(id);
    }
  }
  if (modeA === 'rail' || modeA === 'mixed') {
    const railReached = bfsReachableByMode(edges, fromNodeId, 'rail', maxHops);
    for (const id of railReached) {
      const m = getOsmNodeMode(state, id);
      if (m === 'rail' || m === 'mixed') result.add(id);
    }
  }

  const transferSkillLevel =
    state.skills.find((s) => s.id === 'sk_infra_4')?.level || 0;
  if (transferSkillLevel > 0) {
    const nA = (state.osmNodes || []).find((n) => n.id === fromNodeId);
    if (nA) {
      for (const nB of state.osmNodes || []) {
        if (nB.id === fromNodeId) continue;
        if (haversineKm(nA.lat, nA.lng, nB.lat, nB.lng) <= 0.035) {
          result.add(nB.id);
        }
      }
    }
  }

  if ((state.osmNodes || []).some((n) => n.connected)) {
    const frontierDist = computeOsmFrontierDistancesForState(state);
    for (const nid of Array.from(result)) {
      if (!frontierDist.has(nid)) {
        result.delete(nid);
      }
    }
  }

  return result;
}

/**
 * NIMBY Rails-style continuous track/road chain builder:
 * Links Node A -> Node B along the exact real OSM road/rail path (mode-isolated),
 * strictly within MAX_OSM_FRONTIER_DISTANCE (d <= 5) of explored nodes.
 */
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

  const hasAnyConnected = (state.osmNodes || []).some((n) => n.connected);
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

    if (initialFrontier) {
      const edgeMap = new Map((state.osmEdges || []).map((e) => [e.id, e]));
      const exceedsFrontier = path.unbuiltEdgeIds.some((eid) => {
        const edge = edgeMap.get(eid);
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

    let curState = state;
    let builtCount = 0;
    let allLines: TransportLine[] = [];
    let allAchs: Achievement[] = [];
    let allWays: CompletedOsmWayEvent[] = [];

    for (const eid of path.unbuiltEdgeIds) {
      const res = connectOsmEdge(curState, eid);
      if (!res.success) break;
      curState = res.newState;
      builtCount++;
      if (res.newlyCompletedLines.length > 0) {
        allLines = [...allLines, ...res.newlyCompletedLines];
      }
      if (res.newlyUnlockedAchievements.length > 0) {
        allAchs = [...allAchs, ...res.newlyUnlockedAchievements];
      }
      if (res.newlyCompletedOsmWays.length > 0) {
        allWays = [...allWays, ...res.newlyCompletedOsmWays];
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
        reason: `자금이 부족합니다 (다음 구간 최소 건설비 확인).`,
      };
    }

    return {
      success: true,
      newState: curState,
      builtCount,
      newlyCompletedLines: allLines,
      newlyUnlockedAchievements: allAchs,
      newlyCompletedOsmWays: allWays,
    };
  }

  // Fallback ONLY for special <=35m road<->rail transfer bridges or isolated orphan nodes.
  // Never allow jumping sideways across empty space between separate 2-lane road/rail tracks!
  const compat = resolveCompatibleOsmMode(state, fromNodeId, toNodeId);
  const edges = state.osmEdges || [];
  const fromHasEdges = edges.some((e) => e.fromNodeId === fromNodeId || e.toNodeId === fromNodeId);
  const toHasEdges = edges.some((e) => e.fromNodeId === toNodeId || e.toNodeId === toNodeId);

  if (compat && compat !== 'transfer' && fromHasEdges && toHasEdges) {
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

  const direct = connectOsmNodesDirect(state, fromNodeId, toNodeId, 0.15);
  return {
    success: direct.success,
    newState: direct.newState,
    builtCount: direct.success ? 1 : 0,
    newlyCompletedLines: direct.newlyCompletedLines,
    newlyUnlockedAchievements: direct.newlyUnlockedAchievements,
    newlyCompletedOsmWays: direct.newlyCompletedOsmWays,
    reason: direct.reason,
  };
}

/**
 * Connect two OSM nodes directly (enforces strict road vs rail separation & d <= 5 frontier).
 */
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

  if ((state.osmNodes || []).some((n) => n.connected)) {
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

  const existing = (state.osmEdges || []).find(
    (e) =>
      (e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) ||
      (e.fromNodeId === toNodeId && e.toNodeId === fromNodeId)
  );
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

  const nA = state.osmNodes.find((n) => n.id === fromNodeId);
  const nB = state.osmNodes.find((n) => n.id === toNodeId);
  if (!nA || !nB) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
      newlyCompletedOsmWays: [],
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
        '도로 노드와 철도 노드는 직접 연결할 수 없습니다. 같은 유형의 노드를 선택하거나 실제 환승 교차점(보라색)·환승 링크 스킬 해금 후 35m 이내에서만 연결하세요.',
    };
  }

  if (compat !== 'transfer') {
    const edges = state.osmEdges || [];
    const fromHasEdges = edges.some((e) => e.fromNodeId === fromNodeId || e.toNodeId === fromNodeId);
    const toHasEdges = edges.some((e) => e.fromNodeId === toNodeId || e.toNodeId === toNodeId);
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
  const effectiveMaxKm = compat === 'transfer' ? 0.035 : maxBridgeKm;
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
  };

  const withEdge: GameState = {
    ...state,
    osmEdges: [...state.osmEdges, customEdge],
  };

  return connectOsmEdge(withEdge, customEdge.id);
}

export function buildSegment(
  state: GameState,
  segmentId: string
): {
  success: boolean;
  newState: GameState;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
} {
  const seg = state.segments.find((s) => s.id === segmentId);
  if (!seg || seg.built) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
    };
  }

  const mults = calculateMultipliers(state);
  const cost = getSegmentBuildCost(seg, mults);
  if (state.capital < cost) {
    return {
      success: false,
      newState: state,
      newlyCompletedLines: [],
      newlyUnlockedAchievements: [],
    };
  }

  const parentLine = state.lines.find((l) => l.id === seg.lineId);

  const updatedSegments = state.segments.map((s) =>
    s.id === segmentId ? { ...s, built: true } : s
  );

  const updatedNodes = state.nodes.map((n) =>
    n.id === seg.fromNodeId || n.id === seg.toNodeId ? { ...n, connected: true } : n
  );

  const newUnits: MovingUnit[] = [
    {
      id: `u_${segmentId}_1`,
      segmentId,
      mode: seg.mode,
      color: parentLine?.color || (seg.mode === 'rail' ? '#38bdf8' : '#f59e0b'),
      progress: 0.1,
      direction: 1,
    },
    {
      id: `u_${segmentId}_2`,
      segmentId,
      mode: seg.mode,
      color: parentLine?.color || (seg.mode === 'rail' ? '#38bdf8' : '#f59e0b'),
      progress: 0.6,
      direction: -1,
    },
  ];

  const midState: GameState = {
    ...state,
    capital: state.capital - cost,
    nodes: updatedNodes,
    segments: updatedSegments,
    units: [...state.units, ...newUnits],
    stats: {
      ...state.stats,
      totalSegmentsBuilt: state.stats.totalSegmentsBuilt + 1,
    },
  };

  const evalResult = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    ...evalResult,
  };
}

export function upgradeSegment(
  state: GameState,
  segmentId: string
): { success: boolean; newState: GameState } {
  const seg = state.segments.find((s) => s.id === segmentId);
  if (!seg || !seg.built || seg.level >= 10) {
    return { success: false, newState: state };
  }

  const mults = calculateMultipliers(state);
  const cost = getSegmentUpgradeCost(seg, mults);
  if (state.capital < cost) {
    return { success: false, newState: state };
  }

  const updatedSegments = state.segments.map((s) =>
    s.id === segmentId ? { ...s, level: s.level + 1 } : s
  );

  const midState: GameState = {
    ...state,
    capital: state.capital - cost,
    segments: updatedSegments,
  };

  const evalResult = evaluateLinesAndAchievements(midState);
  return { success: true, newState: evalResult.newState };
}

export function canUnlockSkill(state: GameState, skill: SkillNode): boolean {
  if (skill.level >= skill.maxLevel) return false;
  const reqMet = skill.requires.every((reqId) => {
    const reqSkill = state.skills.find((s) => s.id === reqId);
    return reqSkill && reqSkill.level > 0;
  });
  if (!reqMet) return false;

  const spCost = skill.costSP;
  const moneyCost = getSkillMoneyCost(skill);
  return state.skillPoints >= spCost && state.capital >= moneyCost;
}

export function getSkillMoneyCost(skill: SkillNode): number {
  return Math.round(skill.costMoney * Math.pow(1.9, skill.level));
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
    skillPoints: state.skillPoints - skill.costSP,
    skills: updatedSkills,
  };

  const evalResult = evaluateLinesAndAchievements(midState);
  return {
    success: true,
    newState: evalResult.newState,
    newlyUnlockedAchievements: evalResult.newlyUnlockedAchievements,
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
  autoBuiltSomething?: boolean;
  newlyCompletedLines: TransportLine[];
  newlyUnlockedAchievements: Achievement[];
  newlyCompletedOsmWays: CompletedOsmWayEvent[];
  newlyUnlockedMilestones: MinigameMilestoneDef[];
} {
  const dt = Math.min(deltaSeconds, 0.25);
  const incomePerSec = calculateTotalIncomePerSec(state);
  const earned = incomePerSec * dt;
  const mults = calculateMultipliers(state);

  const updatedUnits = state.units.map((u) => {
    const speed = u.mode === 'rail' ? 0.16 : 0.12;
    let nextProg = u.progress + speed * dt * u.direction;
    let nextDir = u.direction;
    if (nextProg >= 1) {
      nextProg = 1;
      nextDir = -1;
    } else if (nextProg <= 0) {
      nextProg = 0;
      nextDir = 1;
    }
    return { ...u, progress: nextProg, direction: nextDir };
  });

  const prevMg = backfillMinigamesState(state.minigames);
  const prevMilestoneSet = new Set(prevMg.unlockedMilestoneIds || []);
  const nextMinigames = advanceMinigamesTick(prevMg, dt);
  const newlyUnlockedMilestones = MINIGAME_MILESTONES.filter(
    (ms) => !prevMilestoneSet.has(ms.id) && nextMinigames.unlockedMilestoneIds.includes(ms.id)
  );

  let nextState: GameState = {
    ...state,
    capital: state.capital + earned,
    totalLifetimeEarnings: state.totalLifetimeEarnings + earned,
    units: updatedUnits,
    lastTickTimestamp: Date.now(),
    minigames: nextMinigames,
  };

  let autoBuiltSomething = false;
  let newlyCompletedLines: TransportLine[] = [];
  let newlyUnlockedAchievements: Achievement[] = [];
  let newlyCompletedOsmWays: CompletedOsmWayEvent[] = [];

  if (mults.autoBuilderRatePerSec > 0) {
    let progress = nextState.autoBuilderProgress + mults.autoBuilderRatePerSec * dt;
    if (progress >= 1) {
      progress = 0;

      for (let step = 0; step < mults.parallelBuildCount; step++) {
        // Pure node-linking auto-builder: only constructs unbuilt OSM edges
        const connectedOsmIds = new Set(
          (nextState.osmNodes || []).filter((n) => n.connected).map((n) => n.id)
        );
        const osmAdj = (nextState.osmEdges || [])
          .filter(
            (e) =>
              !e.built &&
              (connectedOsmIds.has(e.fromNodeId) || connectedOsmIds.has(e.toNodeId))
          )
          .sort((a, b) => a.buildCost - b.buildCost);
        const osmAny =
          osmAdj.length > 0
            ? osmAdj
            : (nextState.osmEdges || [])
                .filter((e) => !e.built)
                .sort((a, b) => a.buildCost - b.buildCost);

        const curMults = calculateMultipliers(nextState);
        const bestOsm = osmAny[0];
        const osmCost = bestOsm ? getOsmEdgeBuildCost(bestOsm, curMults) : Infinity;

        if (bestOsm && nextState.capital >= osmCost) {
          const res = connectOsmEdge(nextState, bestOsm.id);
          if (res.success) {
            nextState = res.newState;
            autoBuiltSomething = true;
            newlyCompletedLines = [...newlyCompletedLines, ...res.newlyCompletedLines];
            newlyUnlockedAchievements = [
              ...newlyUnlockedAchievements,
              ...res.newlyUnlockedAchievements,
            ];
            newlyCompletedOsmWays = [
              ...newlyCompletedOsmWays,
              ...res.newlyCompletedOsmWays,
            ];
            continue;
          }
        }
        break;
      }
    }
    nextState = { ...nextState, autoBuilderProgress: progress };
  }

  return {
    newState: nextState,
    autoBuiltSomething,
    newlyCompletedLines,
    newlyUnlockedAchievements,
    newlyCompletedOsmWays,
    newlyUnlockedMilestones,
  };
}

export function calculatePrestigeGain(
  totalLifetimeEarnings: number,
  prestigeBonusMult = 1
): number {
  if (totalLifetimeEarnings < 50000) return 0;
  return (
    Math.floor(Math.pow(totalLifetimeEarnings / 50000, 0.45) * 50 * prestigeBonusMult) /
    100
  );
}
