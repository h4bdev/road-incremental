import { BuiltSkeletonTuple } from './osmOverview';
import {
  CachedSlotGraphSnapshot,
  deleteCachedSlotGraph,
  getCachedSlotGraph,
  hasIndexedDb,
  putCachedSlotGraph,
} from './osmTileCache';
import {
  createInitialGameState,
  evaluateLinesAndAchievements,
  getNodeTierRank,
  scopeGameStateToStartingCity,
} from './rules';
import { backfillMinigamesState } from './minigames';
import {
  GameState,
  OsmEdge,
  ProvincialRegion,
  StartingCity,
} from './types';

export const SAVE_SLOT_IDS = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'] as const;
export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];
export const MAX_SAVE_SLOTS = SAVE_SLOT_IDS.length;

export const LEGACY_SAVE_KEY = 'TERRALINE_SAVE_V4';
export const SLOT_STORAGE_PREFIX = 'ROAD_INC_SAVE_SLOT_V1_';
export const SLOT_CORE_V2_PREFIX = 'ROAD_INC_SAVE_SLOT_CORE_V2_';
export const SLOT_GRAPH_V2_PREFIX = 'ROAD_INC_SAVE_SLOT_GRAPH_V2_';
export const SLOT_META_MAP_KEY = 'ROAD_INC_SAVE_SLOTS_META_V1';
export const ACTIVE_SLOT_STORAGE_KEY = 'ROAD_INC_ACTIVE_SLOT_V1';
export const LEGACY_MIGRATED_KEY = 'ROAD_INC_LEGACY_MIGRATED_V1';
export const CLOUD_SYNC_BASE_STORAGE_KEY = 'ROAD_INC_CLOUD_SYNC_BASE_V1';

export const GRAPH_CHUNK_ITEM_LIMIT = 1500;
export const MAX_GRAPH_CHUNKS = 500;
export const MAX_CORE_DOC_BYTES = 750 * 1024;
export const MAX_CHUNK_DOC_BYTES = 400 * 1024;
export const MAX_MARK_CHUNK_WITH_PAYLOAD_BYTES = 260 * 1024;
export const MAX_CLOUD_GRAPH_B64_SLICE_CHARS = 280_000;
export const MAX_CLOUD_GRAPH_JSON_SLICE_CHARS = 90_000;

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

export function estimateFirestoreValueBytes(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return utf8ByteLength(value) + 1;
  if (Array.isArray(value)) {
    let total = 0;
    for (let i = 0; i < value.length; i++) {
      total += estimateFirestoreValueBytes(value[i]);
    }
    return total;
  }
  if (typeof value === 'object') {
    let total = 32;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      total += utf8ByteLength(k) + 1 + estimateFirestoreValueBytes(v);
    }
    return total;
  }
  return 8;
}

export function estimateFirestoreDocBytes(
  data: Record<string, unknown>,
  extraOverheadBytes = 256
): number {
  return extraOverheadBytes + estimateFirestoreValueBytes(data);
}

export interface SaveSlotSummary {
  slotId: SaveSlotId;
  slotIndex: number;
  slotName: string;
  cityId: string;
  cityName: string;
  cityCountry: string;
  cityLat: number;
  cityLng: number;
  cityZoom: number;
  cityDescription: string;
  cityIsCustom: boolean;
  capital: number;
  mapped1to1Km: number;
  connectedOsmNodes: number;
  totalOsmEdgesBuilt: number;
  tierLabel: string;
  clientSavedAt: number;
  source: 'local' | 'cloud' | 'synced';
  cloudSavedAt?: number;
  hasNewerCloud?: boolean;
  hasNewerLocal?: boolean;
  hasConflict?: boolean;
}

export interface CompactBridgeEdge {
  id: string;
  wayName: string;
  highwayType: string;
  mode: 'road' | 'rail';
  fromNodeId: string;
  toNodeId: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  distanceKm: number;
  buildCost: number;
  baseIncomePerSec: number;
  built: boolean;
  regionId: string;
}

export interface CompactRegionRecord {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  centerLat: number;
  centerLng: number;
  unlocked: boolean;
  isStartingRegion: boolean;
  isIsolated: boolean;
  isKnownIsland: boolean;
  totalNodeCount: number;
}

type LocalCompactRegionRecord = CompactRegionRecord & {
  hasRealOsmBoundary?: boolean;
};

export interface DehydratedCloudSlot {
  metaFields: {
    slotId: SaveSlotId;
    slotIndex: number;
    slotName: string;
    cityId: string;
    cityName: string;
    cityCountry: string;
    cityLat: number;
    cityLng: number;
    cityZoom: number;
    cityDescription: string;
    cityIsCustom: boolean;
    capital: number;
    mapped1to1Km: number;
    connectedOsmNodes: number;
    totalOsmEdgesBuilt: number;
    tierLabel: string;
    graphChunkCount: number;
    clientSavedAt: number;
  };
  coreFields: {
    version: 1;
    capital: number;
    totalLifetimeEarnings: number;
    lastTickTimestamp: number;
    startingCity: {
      id: string;
      name: string;
      country: string;
      lat: number;
      lng: number;
      zoom: number;
      description: string;
      isCustom: boolean;
    };
    stats: GameState['stats'];
    settings: GameState['settings'];
    skillsMap: Record<string, number>;
    unlockedAchievementIds: string[];
    loadedOsmChunks: string[];
    loadedOsmRegions: string[];
    pendingSeedRegionIds: string[];
    completedOsmWays: string[];
    regions: CompactRegionRecord[];
    customBridgeEdges: CompactBridgeEdge[];
    minigames: GameState['minigames'];
  };
  graphChunks: Array<{
    chunkIndex: number;
    nodeIds: string[];
    edgeIds: string[];
  }>;
}

export type CloudGraphEncoding = 'none' | 'gzip-b64-v1' | 'json-v1';

export interface CloudChunkPayloadRecord {
  chunkIndex: number;
  nodeIds: string[];
  edgeIds: string[];
  graphEncoding?: string;
  graphPayload?: string;
}

export interface CompactCloudGraphV1 {
  v: 1;
  wayNames: string[];
  hwTypes: string[];
  regionIds: string[];
  nodes: CompactNodeTuple[];
  edges: CompactEdgeTuple[];
  regionBoundaries: Array<[string, ProvincialRegion['boundaryGeoJson'], boolean | undefined]>;
  regions?: LocalCompactRegionRecord[];
  loadedOsmChunks: string[];
  loadedOsmRegions: string[];
  completedOsmWays: string[];
}

export interface RestoredGraphMarks {
  connectedNodeIds: Set<string>;
  builtEdgeIds: Set<string>;
  customBridgeEdges: OsmEdge[];
}

export function isSaveSlotId(val: unknown): val is SaveSlotId {
  return typeof val === 'string' && (SAVE_SLOT_IDS as readonly string[]).includes(val);
}

export function slotIndexFromId(slotId: SaveSlotId): number {
  const num = Number(slotId.split('_')[1]);
  return Number.isFinite(num) && num >= 1 && num <= MAX_SAVE_SLOTS ? num : 1;
}

export function defaultSlotName(slotId: SaveSlotId, cityName?: string): string {
  const idx = slotIndexFromId(slotId);
  return cityName ? `슬롯 ${idx} · ${cityName}`.slice(0, 60) : `슬롯 ${idx}`;
}

export function hydrateRawGameState(
  parsed: GameState,
  options?: { trustedV2?: boolean }
): GameState | null {
  if (!parsed || !parsed.startingCity || typeof parsed.startingCity.lat !== 'number') {
    return null;
  }
  return scopeGameStateToStartingCity(
    {
      ...parsed,
      osmNodes: Array.isArray(parsed.osmNodes) ? parsed.osmNodes : [],
      osmEdges: Array.isArray(parsed.osmEdges) ? parsed.osmEdges : [],
      loadedOsmChunks: Array.isArray(parsed.loadedOsmChunks) ? parsed.loadedOsmChunks : [],
      loadedOsmRegions: Array.isArray(parsed.loadedOsmRegions) ? parsed.loadedOsmRegions : [],
      provincialRegions: Array.isArray(parsed.provincialRegions) ? parsed.provincialRegions : [],
      pendingSeedRegionIds: Array.isArray(parsed.pendingSeedRegionIds)
        ? parsed.pendingSeedRegionIds
        : [],
      completedOsmWays: Array.isArray(parsed.completedOsmWays) ? parsed.completedOsmWays : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      upgrades: [],
      minigames: backfillMinigamesState(parsed.minigames),
      stats: {
        totalSegmentsBuilt: parsed.stats?.totalSegmentsBuilt || 0,
        totalOsmEdgesBuilt: parsed.stats?.totalOsmEdgesBuilt || 0,
        connectedOsmNodes: parsed.stats?.connectedOsmNodes || 0,
        totalScaledNodes: parsed.stats?.totalScaledNodes || 0,
        totalLinesCompleted: 0,
        totalTownsCompleted: 0,
        totalClicks: parsed.stats?.totalClicks || 0,
        mapped1to1Km: parsed.stats?.mapped1to1Km || 0,
        totalNetworkKm: parsed.stats?.totalNetworkKm || 0,
        prestigeCount: 0,
      },
      settings: {
        soundEnabled: parsed.settings?.soundEnabled ?? true,
        mapTileLayer: parsed.settings?.mapTileLayer || 'dark',
      },
    },
    { trustedV2: options?.trustedV2 }
  );
}

export function buildSummaryFromState(
  slotId: SaveSlotId,
  state: GameState,
  options?: {
    slotName?: string;
    clientSavedAt?: number;
    source?: 'local' | 'cloud' | 'synced';
    cloudSavedAt?: number;
  }
): SaveSlotSummary {
  const rank = getNodeTierRank(state.stats?.connectedOsmNodes || 0);
  const cityName = ((state.startingCity.name || '').trim() || '도시').slice(0, 120);
  const cityId = ((state.startingCity.id || '').trim() || 'custom').slice(0, 100);
  const rawSlotName = typeof options?.slotName === 'string' ? options.slotName.trim() : '';
  const tierLabel = (rank.label.trim() || 'Bronze I').slice(0, 40);
  const rawLat = Number.isFinite(state.startingCity.lat) ? state.startingCity.lat : 37.5665;
  const rawLng = Number.isFinite(state.startingCity.lng) ? state.startingCity.lng : 126.978;
  return {
    slotId,
    slotIndex: slotIndexFromId(slotId),
    slotName: (rawSlotName || defaultSlotName(slotId, cityName)).slice(0, 60),
    cityId,
    cityName,
    cityCountry: (state.startingCity.country || '').slice(0, 80),
    cityLat: Math.max(-90, Math.min(90, rawLat)),
    cityLng: Math.max(-180, Math.min(180, rawLng)),
    cityZoom: Math.max(1, Math.min(22, Number(state.startingCity.zoom) || 14)),
    cityDescription: (state.startingCity.description || '').slice(0, 300),
    cityIsCustom: Boolean(state.startingCity.isCustom),
    capital: Math.max(0, Number(state.capital) || 0),
    mapped1to1Km: Math.max(0, Number(state.stats?.mapped1to1Km) || 0),
    connectedOsmNodes: Math.max(0, Math.floor(state.stats?.connectedOsmNodes || 0)),
    totalOsmEdgesBuilt: Math.max(0, Math.floor(state.stats?.totalOsmEdgesBuilt || 0)),
    tierLabel,
    clientSavedAt: Math.max(0, Math.floor(options?.clientSavedAt ?? state.lastTickTimestamp ?? Date.now())),
    source: options?.source || 'local',
    cloudSavedAt: options?.cloudSavedAt,
  };
}

function getSafeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function readMetaMap(storage?: Storage): Partial<Record<SaveSlotId, SaveSlotSummary>> {
  const st = getSafeStorage(storage);
  if (!st) return {};
  try {
    const raw = st.getItem(SLOT_META_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<SaveSlotId, SaveSlotSummary>>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMetaMap(
  map: Partial<Record<SaveSlotId, SaveSlotSummary>>,
  storage?: Storage
): void {
  const st = getSafeStorage(storage);
  if (!st) return;
  try {
    st.setItem(SLOT_META_MAP_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors
  }
}

// Compact V2 split local storage (CORE ~15-100KB written cleanly + GRAPH tuple cache written only on structure change)
type CompactNodeTuple = [string, number, number, 0 | 1 | 2, number, string?];
type CompactEdgeTuple = [
  string,
  number,
  number,
  0 | 1,
  string,
  string,
  number,
  number,
  number,
  number,
  Array<[number, number]> | 0,
];

interface CompactLocalCoreV2 {
  v: 2;
  capital: number;
  totalLifetimeEarnings: number;
  lastTickTimestamp: number;
  startingCity: StartingCity;
  stats: GameState['stats'];
  settings: GameState['settings'];
  skillsMap: Record<string, number>;
  unlockedAchievementIds: string[];
  loadedOsmChunks: string[];
  loadedOsmRegions: string[];
  pendingSeedRegionIds: string[];
  completedOsmWays: string[];
  regions: LocalCompactRegionRecord[];
  minigames: GameState['minigames'];
  connectedNodeIds: string[];
  builtEdgeIds: string[];
  customBridgeEdges: OsmEdge[];
  builtSkeleton?: BuiltSkeletonTuple[];
}

interface CompactLocalGraphV2 {
  v: 2;
  wayNames: string[];
  hwTypes: string[];
  regionIds: string[];
  nodes: CompactNodeTuple[];
  edges: CompactEdgeTuple[];
  regionBoundaries: Array<[string, ProvincialRegion['boundaryGeoJson'], boolean | undefined]>;
}

const lastSavedGraphSigByStorage = new WeakMap<Storage, Map<SaveSlotId, string>>();
const lastIdbGraphSigBySlot = new Map<SaveSlotId, string>();

function computeLocalGraphStructureSig(state: GameState): string {
  const nodes = state.osmNodes || [];
  const edges = state.osmEdges || [];
  const regions = state.provincialRegions || [];
  let boundaryCount = 0;
  let customCount = 0;
  for (let i = 0; i < regions.length; i++) {
    if (regions[i].boundaryGeoJson) boundaryCount++;
  }
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].id.startsWith('oe_custom_')) customCount++;
  }
  const nLen = nodes.length;
  const eLen = edges.length;
  return `${state.startingCity?.id || ''}:${nLen}:${eLen}:${customCount}:${boundaryCount}:${
    (state.loadedOsmChunks || []).length
  }:${(state.loadedOsmRegions || []).length}:${nLen > 0 ? nodes[0].id : ''}:${
    nLen > 0 ? nodes[nLen - 1].id : ''
  }:${eLen > 0 ? edges[eLen - 1].id : ''}`;
}

function quantizeChunkKeyForSave(lat: number, lng: number): string {
  const qLat = Math.round(lat * 300) / 300;
  const qLng = Math.round(lng * 300) / 300;
  return `${qLat.toFixed(4)}_${qLng.toFixed(4)}`;
}

export function countUnhydratedGraphMarks(
  state: GameState,
  marks: RestoredGraphMarks | null | undefined
): { unhydratedNodes: number; unhydratedEdges: number } {
  if (!marks) return { unhydratedNodes: 0, unhydratedEdges: 0 };
  const existingConnected = new Set<string>();
  const existingBuilt = new Set<string>();
  for (const n of state.osmNodes || []) {
    if (n.connected) existingConnected.add(n.id);
  }
  for (const e of state.osmEdges || []) {
    if (e.built) existingBuilt.add(e.id);
  }
  let unhydratedNodes = 0;
  for (const id of marks.connectedNodeIds) {
    if (!existingConnected.has(id)) unhydratedNodes++;
  }
  let unhydratedEdges = 0;
  for (const id of marks.builtEdgeIds) {
    if (!existingBuilt.has(id)) unhydratedEdges++;
  }
  return { unhydratedNodes, unhydratedEdges };
}

function packLocalCoreV2(
  state: GameState,
  pendingMarks?: RestoredGraphMarks | null
): CompactLocalCoreV2 {
  const skillsMap: Record<string, number> = {};
  for (let i = 0; i < (state.skills || []).length; i++) {
    const sk = state.skills[i];
    if (sk.level > 0) skillsMap[sk.id] = Math.floor(sk.level);
  }

  const unlockedAchievementIds: string[] = [];
  for (let i = 0; i < (state.achievements || []).length; i++) {
    if (state.achievements[i].unlocked) unlockedAchievementIds.push(state.achievements[i].id);
  }

  const regions: LocalCompactRegionRecord[] = (state.provincialRegions || []).map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    adminLevel: r.adminLevel || '6',
    bbox: r.bbox,
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    unlocked: Boolean(r.unlocked),
    isStartingRegion: Boolean(r.isStartingRegion),
    isIsolated: Boolean(r.isIsolated),
    isKnownIsland: Boolean(r.isKnownIsland),
    totalNodeCount: Math.max(0, Math.floor(r.totalNodeCount || 0)),
    ...(r.hasRealOsmBoundary ? { hasRealOsmBoundary: true } : {}),
  }));

  const connectedSet = new Set<string>();
  const osmNodes = state.osmNodes || [];
  for (let i = 0; i < osmNodes.length; i++) {
    if (osmNodes[i].connected) connectedSet.add(osmNodes[i].id);
  }
  if (pendingMarks) {
    for (const id of pendingMarks.connectedNodeIds) connectedSet.add(id);
  }
  const connectedNodeIds = Array.from(connectedSet);

  const builtSet = new Set<string>();
  const customBridgeById = new Map<string, OsmEdge>();
  const builtSkeleton: BuiltSkeletonTuple[] = [];
  const osmEdges = state.osmEdges || [];
  for (let i = 0; i < osmEdges.length; i++) {
    const e = osmEdges[i];
    if (e.built) {
      builtSet.add(e.id);
      if (builtSkeleton.length < 1500 && e.coordinates.length >= 2) {
        const c0 = e.coordinates[0];
        const c1 = e.coordinates[e.coordinates.length - 1];
        builtSkeleton.push([
          Math.round(c0[0] * 1e5) / 1e5,
          Math.round(c0[1] * 1e5) / 1e5,
          Math.round(c1[0] * 1e5) / 1e5,
          Math.round(c1[1] * 1e5) / 1e5,
          e.mode === 'rail' ? 1 : 0,
        ]);
      }
    }
    if (e.id.startsWith('oe_custom_')) customBridgeById.set(e.id, e);
  }
  if (pendingMarks) {
    for (const id of pendingMarks.builtEdgeIds) builtSet.add(id);
    for (const ce of pendingMarks.customBridgeEdges) {
      if (!customBridgeById.has(ce.id)) customBridgeById.set(ce.id, ce);
      if (ce.built) builtSet.add(ce.id);
    }
  }
  const builtEdgeIds = Array.from(builtSet);
  const customBridgeEdges = Array.from(customBridgeById.values());

  const stats: GameState['stats'] = {
    ...state.stats,
    connectedOsmNodes: Math.max(state.stats?.connectedOsmNodes || 0, connectedNodeIds.length),
    totalOsmEdgesBuilt: Math.max(state.stats?.totalOsmEdgesBuilt || 0, builtEdgeIds.length),
  };

  return {
    v: 2,
    capital: clampFinite(state.capital, 1200, 0),
    totalLifetimeEarnings: clampFinite(state.totalLifetimeEarnings, 0, 0),
    lastTickTimestamp: Math.max(0, Math.floor(state.lastTickTimestamp || Date.now())),
    startingCity: state.startingCity,
    stats,
    settings: state.settings,
    skillsMap,
    unlockedAchievementIds,
    loadedOsmChunks: state.loadedOsmChunks || [],
    loadedOsmRegions: state.loadedOsmRegions || [],
    pendingSeedRegionIds: state.pendingSeedRegionIds || [],
    completedOsmWays: state.completedOsmWays || [],
    regions,
    minigames: backfillMinigamesState(state.minigames),
    connectedNodeIds,
    builtEdgeIds,
    customBridgeEdges,
    builtSkeleton,
  };
}

function packLocalGraphV2(
  state: GameState,
  options?: { includeCustomBridges?: boolean; extraCustomEdges?: OsmEdge[] }
): CompactLocalGraphV2 {
  const wayNames: string[] = [];
  const wayIndex = new Map<string, number>();
  const hwTypes: string[] = [];
  const hwIndex = new Map<string, number>();
  const regionIds: string[] = [];
  const regIndex = new Map<string, number>();

  const intern = (arr: string[], map: Map<string, number>, val?: string): number => {
    if (!val) return -1;
    const hit = map.get(val);
    if (hit !== undefined) return hit;
    const idx = arr.length;
    arr.push(val);
    map.set(val, idx);
    return idx;
  };

  const osmNodes = state.osmNodes || [];
  const nodeMap = new Map<string, GameState['osmNodes'][number]>();
  const packedNodes: CompactNodeTuple[] = new Array(osmNodes.length);
  for (let i = 0; i < osmNodes.length; i++) {
    const n = osmNodes[i];
    nodeMap.set(n.id, n);
    const mCode: 0 | 1 | 2 = n.mode === 'rail' ? 1 : n.mode === 'mixed' ? 2 : 0;
    const rIdx = intern(regionIds, regIndex, n.regionId);
    packedNodes[i] = n.label
      ? [n.id, n.lat, n.lng, mCode, rIdx, n.label]
      : [n.id, n.lat, n.lng, mCode, rIdx];
  }

  const osmEdges = state.osmEdges || [];
  const packedEdges: CompactEdgeTuple[] = [];
  const seenEdgeIds = new Set<string>();
  const pushEdge = (e: OsmEdge) => {
    if (seenEdgeIds.has(e.id)) return;
    seenEdgeIds.add(e.id);
    const wIdx = intern(wayNames, wayIndex, e.wayName);
    const hIdx = intern(hwTypes, hwIndex, e.highwayType);
    const rIdx = intern(regionIds, regIndex, e.regionId);
    const nFrom = nodeMap.get(e.fromNodeId);
    const nTo = nodeMap.get(e.toNodeId);
    const matchesEndpoints =
      nFrom &&
      nTo &&
      e.coordinates.length === 2 &&
      e.coordinates[0][0] === nFrom.lat &&
      e.coordinates[0][1] === nFrom.lng &&
      e.coordinates[1][0] === nTo.lat &&
      e.coordinates[1][1] === nTo.lng;
    packedEdges.push([
      e.id,
      wIdx,
      hIdx,
      e.mode === 'rail' ? 1 : 0,
      e.fromNodeId,
      e.toNodeId,
      e.distanceKm,
      e.buildCost,
      e.baseIncomePerSec,
      rIdx,
      matchesEndpoints ? 0 : e.coordinates,
    ]);
  };

  for (let i = 0; i < osmEdges.length; i++) {
    const e = osmEdges[i];
    if (!options?.includeCustomBridges && e.id.startsWith('oe_custom_')) continue;
    pushEdge(e);
  }
  if (options?.includeCustomBridges && options?.extraCustomEdges?.length) {
    for (let i = 0; i < options.extraCustomEdges.length; i++) {
      pushEdge(options.extraCustomEdges[i]);
    }
  }

  const regionBoundaries: CompactLocalGraphV2['regionBoundaries'] = [];
  for (let i = 0; i < (state.provincialRegions || []).length; i++) {
    const r = state.provincialRegions[i];
    if (r.boundaryGeoJson) {
      regionBoundaries.push([r.regionId, r.boundaryGeoJson, r.hasRealOsmBoundary]);
    }
  }

  return {
    v: 2,
    wayNames,
    hwTypes,
    regionIds,
    nodes: packedNodes,
    edges: packedEdges,
    regionBoundaries,
  };
}

function unpackLocalV2ToRawGameState(
  core: CompactLocalCoreV2,
  graph: CompactLocalGraphV2 | null
): GameState {
  const initial = createInitialGameState(core.startingCity);
  const achSet = new Set(core.unlockedAchievementIds || []);
  const skillsMap = core.skillsMap || {};
  const connectedSet = new Set(core.connectedNodeIds || []);
  const builtSet = new Set(core.builtEdgeIds || []);

  const boundaryByRegionId = new Map<
    string,
    { boundaryGeoJson: ProvincialRegion['boundaryGeoJson']; hasRealOsmBoundary?: boolean }
  >();
  if (graph?.regionBoundaries) {
    for (let i = 0; i < graph.regionBoundaries.length; i++) {
      const [rid, geo, hasReal] = graph.regionBoundaries[i];
      boundaryByRegionId.set(rid, { boundaryGeoJson: geo, hasRealOsmBoundary: hasReal });
    }
  }

  const provincialRegions: ProvincialRegion[] = (core.regions || []).map((r) => {
    const b = boundaryByRegionId.get(r.regionId);
    const hasReal = b?.hasRealOsmBoundary ?? r.hasRealOsmBoundary;
    return {
      regionId: r.regionId,
      regionName: r.regionName,
      adminLevel: r.adminLevel,
      bbox: r.bbox,
      centerLat: r.centerLat,
      centerLng: r.centerLng,
      unlocked: Boolean(r.unlocked),
      isStartingRegion: Boolean(r.isStartingRegion),
      isIsolated: Boolean(r.isIsolated),
      isKnownIsland: Boolean(r.isKnownIsland),
      totalNodeCount: r.totalNodeCount || undefined,
      boundaryGeoJson: b?.boundaryGeoJson,
      hasRealOsmBoundary: hasReal,
    };
  });

  const osmNodes: GameState['osmNodes'] = [];
  const nodeById = new Map<string, GameState['osmNodes'][number]>();
  if (graph?.nodes) {
    const rIds = graph.regionIds || [];
    for (let i = 0; i < graph.nodes.length; i++) {
      const tuple = graph.nodes[i];
      const mode: 'road' | 'rail' | 'mixed' =
        tuple[3] === 1 ? 'rail' : tuple[3] === 2 ? 'mixed' : 'road';
      const node: GameState['osmNodes'][number] = {
        id: tuple[0],
        lat: tuple[1],
        lng: tuple[2],
        connected: connectedSet.has(tuple[0]),
        mode,
        regionId: tuple[4] >= 0 ? rIds[tuple[4]] : undefined,
        label: tuple[5],
      };
      osmNodes.push(node);
      nodeById.set(node.id, node);
    }
  }

  const osmEdges: OsmEdge[] = [];
  const seenEdgeIds = new Set<string>();
  if (graph?.edges) {
    const wNames = graph.wayNames || [];
    const hTypes = graph.hwTypes || [];
    const rIds = graph.regionIds || [];
    for (let i = 0; i < graph.edges.length; i++) {
      const t = graph.edges[i];
      const nFrom = nodeById.get(t[4]);
      const nTo = nodeById.get(t[5]);
      const coords: OsmEdge['coordinates'] =
        t[10] !== 0 && Array.isArray(t[10]) && t[10].length >= 2
          ? (t[10] as OsmEdge['coordinates'])
          : nFrom && nTo
          ? [
              [nFrom.lat, nFrom.lng],
              [nTo.lat, nTo.lng],
            ]
          : [
              [0, 0],
              [0, 0],
            ];
      seenEdgeIds.add(t[0]);
      osmEdges.push({
        id: t[0],
        wayName: t[1] >= 0 ? wNames[t[1]] || '' : '',
        highwayType: t[2] >= 0 ? hTypes[t[2]] || 'unclassified' : 'unclassified',
        mode: t[3] === 1 ? 'rail' : 'road',
        fromNodeId: t[4],
        toNodeId: t[5],
        coordinates: coords,
        distanceKm: t[6],
        buildCost: t[7],
        baseIncomePerSec: t[8],
        built: builtSet.has(t[0]),
        regionId: t[9] >= 0 ? rIds[t[9]] : undefined,
      });
    }
  }

  for (let i = 0; i < (core.customBridgeEdges || []).length; i++) {
    const ce = core.customBridgeEdges[i];
    if (!seenEdgeIds.has(ce.id)) {
      osmEdges.push({
        ...ce,
        built: ce.built || builtSet.has(ce.id),
      });
    }
  }

  return {
    ...initial,
    capital: core.capital,
    totalLifetimeEarnings: core.totalLifetimeEarnings,
    lastTickTimestamp: core.lastTickTimestamp,
    startingCity: core.startingCity,
    skills: initial.skills.map((sk) => ({
      ...sk,
      level: Math.min(sk.maxLevel, Math.max(0, Math.floor(skillsMap[sk.id] || 0))),
    })),
    achievements: initial.achievements.map((ach) => ({
      ...ach,
      unlocked: achSet.has(ach.id),
    })),
    provincialRegions:
      provincialRegions.length > 0 ? provincialRegions : initial.provincialRegions,
    loadedOsmChunks: core.loadedOsmChunks || [],
    loadedOsmRegions: core.loadedOsmRegions || [],
    pendingSeedRegionIds: core.pendingSeedRegionIds || [],
    completedOsmWays: core.completedOsmWays || [],
    osmNodes,
    osmEdges,
    minigames: backfillMinigamesState(core.minigames),
    stats: core.stats || initial.stats,
    settings: core.settings || initial.settings,
  };
}

export function migrateLegacySaveIfNeeded(storage?: Storage): void {
  const st = getSafeStorage(storage);
  if (!st) return;
  try {
    if (st.getItem(LEGACY_MIGRATED_KEY) === '1') return;
    const slot1Key = `${SLOT_STORAGE_PREFIX}slot_1`;
    const slot1V2Key = `${SLOT_CORE_V2_PREFIX}slot_1`;
    if (st.getItem(slot1V2Key) || st.getItem(slot1Key)) {
      st.setItem(LEGACY_MIGRATED_KEY, '1');
      return;
    }
    const legacyRaw = st.getItem(LEGACY_SAVE_KEY);
    if (!legacyRaw) {
      st.setItem(LEGACY_MIGRATED_KEY, '1');
      return;
    }
    const parsed = JSON.parse(legacyRaw) as GameState;
    const hydrated = hydrateRawGameState(parsed);
    if (!hydrated) return;
    saveLocalSlotGameState('slot_1', hydrated, {
      storage: st,
      savedAt: hydrated.lastTickTimestamp || Date.now(),
    });
    if (!st.getItem(ACTIVE_SLOT_STORAGE_KEY)) {
      st.setItem(ACTIVE_SLOT_STORAGE_KEY, 'slot_1');
    }
    st.setItem(LEGACY_MIGRATED_KEY, '1');
  } catch {
    // Ignore corrupted legacy saves
  }
}

export function getActiveSlotId(storage?: Storage): SaveSlotId {
  const st = getSafeStorage(storage);
  if (!st) return 'slot_1';
  const raw = st.getItem(ACTIVE_SLOT_STORAGE_KEY);
  return isSaveSlotId(raw) ? raw : 'slot_1';
}

export function setActiveSlotId(slotId: SaveSlotId, storage?: Storage): void {
  const st = getSafeStorage(storage);
  if (!st) return;
  try {
    st.setItem(ACTIVE_SLOT_STORAGE_KEY, slotId);
  } catch {
    // Ignore quota errors
  }
}

export function listLocalSlotSummaries(storage?: Storage): Partial<Record<SaveSlotId, SaveSlotSummary>> {
  const st = getSafeStorage(storage);
  if (!st) return {};
  migrateLegacySaveIfNeeded(st);
  const metaMap = readMetaMap(st);
  const result: Partial<Record<SaveSlotId, SaveSlotSummary>> = {};
  let dirty = false;

  for (const slotId of SAVE_SLOT_IDS) {
    const rawCoreV2 = st.getItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    const rawSlotV1 = rawCoreV2 ? null : st.getItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    if (!rawCoreV2 && !rawSlotV1) {
      if (metaMap[slotId]) {
        delete metaMap[slotId];
        dirty = true;
      }
      continue;
    }
    if (metaMap[slotId]) {
      result[slotId] = { ...metaMap[slotId]!, source: 'local' };
      continue;
    }
    try {
      const parsed = rawCoreV2
        ? unpackLocalV2ToRawGameState(JSON.parse(rawCoreV2) as CompactLocalCoreV2, null)
        : (JSON.parse(rawSlotV1!) as GameState);
      const summary = buildSummaryFromState(slotId, parsed, {
        clientSavedAt: parsed.lastTickTimestamp || Date.now(),
        source: 'local',
      });
      result[slotId] = summary;
      metaMap[slotId] = summary;
      dirty = true;
    } catch {
      // Ignore unreadable slot
    }
  }

  if (dirty) {
    writeMetaMap(metaMap, st);
  }
  return result;
}

export function getLocalSlotBuiltSkeleton(
  slotId: SaveSlotId,
  storage?: Storage
): BuiltSkeletonTuple[] {
  const st = getSafeStorage(storage);
  if (!st) return [];
  try {
    const rawCoreV2 = st.getItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    if (!rawCoreV2) return [];
    const core = JSON.parse(rawCoreV2) as CompactLocalCoreV2;
    return Array.isArray(core.builtSkeleton) ? core.builtSkeleton : [];
  } catch {
    return [];
  }
}

export function getLocalSlotGraphMarks(
  slotId: SaveSlotId,
  storage?: Storage
): RestoredGraphMarks | null {
  const st = getSafeStorage(storage);
  if (!st) return null;
  try {
    const rawCoreV2 = st.getItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    if (!rawCoreV2) return null;
    const core = JSON.parse(rawCoreV2) as CompactLocalCoreV2;
    return {
      connectedNodeIds: new Set(core.connectedNodeIds || []),
      builtEdgeIds: new Set(core.builtEdgeIds || []),
      customBridgeEdges: Array.isArray(core.customBridgeEdges) ? core.customBridgeEdges : [],
    };
  } catch {
    return null;
  }
}

export function loadLocalSlotGameState(slotId: SaveSlotId, storage?: Storage): GameState | null {
  const st = getSafeStorage(storage);
  if (!st) return null;
  migrateLegacySaveIfNeeded(st);
  try {
    const rawCoreV2 = st.getItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    if (rawCoreV2) {
      const core = JSON.parse(rawCoreV2) as CompactLocalCoreV2;
      const rawGraphV2 = st.getItem(`${SLOT_GRAPH_V2_PREFIX}${slotId}`);
      const graph = rawGraphV2 ? (JSON.parse(rawGraphV2) as CompactLocalGraphV2) : null;
      const rawState = unpackLocalV2ToRawGameState(core, graph);
      return hydrateRawGameState(rawState, { trustedV2: true });
    }

    const raw = st.getItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    return hydrateRawGameState(parsed);
  } catch {
    return null;
  }
}

export async function hydrateLocalSlotGraphFromIndexedDb(
  slotId: SaveSlotId,
  currentState: GameState,
  storage?: Storage
): Promise<GameState | null> {
  if (!hasIndexedDb()) return null;
  const snapshot = await getCachedSlotGraph(slotId);
  if (!snapshot || snapshot.cityId !== currentState.startingCity.id) return null;

  const st = getSafeStorage(storage);
  let core: CompactLocalCoreV2;
  try {
    const rawCoreV2 = st?.getItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    core = rawCoreV2
      ? (JSON.parse(rawCoreV2) as CompactLocalCoreV2)
      : packLocalCoreV2(currentState);
  } catch {
    core = packLocalCoreV2(currentState);
  }

  const graphV2: CompactLocalGraphV2 = {
    v: 2,
    wayNames: snapshot.wayNames || [],
    hwTypes: snapshot.hwTypes || [],
    regionIds: snapshot.regionIds || [],
    nodes: snapshot.nodes || [],
    edges: snapshot.edges || [],
    regionBoundaries: snapshot.regionBoundaries || [],
  };

  const unpacked = unpackLocalV2ToRawGameState(core, graphV2);
  if (snapshot.loadedOsmChunks?.length) {
    unpacked.loadedOsmChunks = Array.from(
      new Set([...(unpacked.loadedOsmChunks || []), ...snapshot.loadedOsmChunks])
    );
  }
  if (snapshot.loadedOsmRegions?.length) {
    unpacked.loadedOsmRegions = Array.from(
      new Set([...(unpacked.loadedOsmRegions || []), ...snapshot.loadedOsmRegions])
    );
  }
  return hydrateRawGameState(unpacked, { trustedV2: true });
}

export function saveLocalSlotGameState(
  slotId: SaveSlotId,
  state: GameState,
  options?: {
    slotName?: string;
    storage?: Storage;
    savedAt?: number;
    forceGraphWrite?: boolean;
    pendingMarks?: RestoredGraphMarks | null;
  }
): SaveSlotSummary {
  const st = getSafeStorage(options?.storage);
  const metaMap = readMetaMap(st || undefined);
  const existingName = metaMap[slotId]?.slotName;
  const resolvedName =
    options?.slotName ||
    (existingName && metaMap[slotId]?.cityId === state.startingCity.id ? existingName : undefined);
  const coreV2 = packLocalCoreV2(state, options?.pendingMarks);
  const stateForSummary: GameState =
    coreV2.stats.connectedOsmNodes > (state.stats?.connectedOsmNodes || 0) ||
    coreV2.stats.totalOsmEdgesBuilt > (state.stats?.totalOsmEdgesBuilt || 0)
      ? { ...state, stats: coreV2.stats }
      : state;
  const summary = buildSummaryFromState(slotId, stateForSummary, {
    slotName: resolvedName,
    clientSavedAt: options?.savedAt ?? Date.now(),
    source: 'local',
  });

  if (st) {
    try {
      st.setItem(`${SLOT_CORE_V2_PREFIX}${slotId}`, JSON.stringify(coreV2));

      const graphSig = computeLocalGraphStructureSig(state);
      const graphKey = `${SLOT_GRAPH_V2_PREFIX}${slotId}`;
      const useIndexedDb = !options?.storage && hasIndexedDb();

      if (useIndexedDb) {
        // Offload bulky graph JSON to asynchronous IndexedDB & free 5MB localStorage quota
        if (options?.forceGraphWrite || lastIdbGraphSigBySlot.get(slotId) !== graphSig) {
          lastIdbGraphSigBySlot.set(slotId, graphSig);
          const packed = packLocalGraphV2(state);
          const snapshot: CachedSlotGraphSnapshot = {
            slotId,
            version: 3,
            cityId: state.startingCity.id,
            wayNames: packed.wayNames,
            hwTypes: packed.hwTypes,
            regionIds: packed.regionIds,
            nodes: packed.nodes,
            edges: packed.edges,
            regionBoundaries: packed.regionBoundaries,
            loadedOsmChunks: state.loadedOsmChunks || [],
            loadedOsmRegions: state.loadedOsmRegions || [],
            updatedAt: Date.now(),
          };
          void putCachedSlotGraph(snapshot).then(() => {
            try {
              if (st.getItem(graphKey)) {
                st.removeItem(graphKey);
              }
            } catch {
              // Ignore storage cleanup errors
            }
          });
        }
      } else {
        let sigMap = lastSavedGraphSigByStorage.get(st);
        if (!sigMap) {
          sigMap = new Map();
          lastSavedGraphSigByStorage.set(st, sigMap);
        }
        if (options?.forceGraphWrite || sigMap.get(slotId) !== graphSig || !st.getItem(graphKey)) {
          try {
            st.setItem(graphKey, JSON.stringify(packLocalGraphV2(state)));
            sigMap.set(slotId, graphSig);
          } catch {
            // If graph cache exceeds storage quota, CORE_V2 + OSM refetch preserves all progress safely
          }
        }
      }

      // Free legacy duplicate V1 key once V2 core is safely persisted
      if (st.getItem(`${SLOT_STORAGE_PREFIX}${slotId}`)) {
        st.removeItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
      }

      metaMap[slotId] = summary;
      writeMetaMap(metaMap, st);
    } catch {
      // Ignore storage quota errors
    }
  }
  return summary;
}

export function renameLocalSlot(
  slotId: SaveSlotId,
  newName: string,
  storage?: Storage
): SaveSlotSummary | null {
  const st = getSafeStorage(storage);
  const trimmed = newName.trim().slice(0, 60);
  if (!st || !trimmed) return null;
  const metaMap = readMetaMap(st);
  const existing = metaMap[slotId];
  if (!existing) return null;
  const updated: SaveSlotSummary = { ...existing, slotName: trimmed };
  metaMap[slotId] = updated;
  writeMetaMap(metaMap, st);
  return updated;
}

export function deleteLocalSlotGameState(slotId: SaveSlotId, storage?: Storage): void {
  const st = getSafeStorage(storage);
  if (!optionsStoragePresent(storage) && hasIndexedDb()) {
    lastIdbGraphSigBySlot.delete(slotId);
    void deleteCachedSlotGraph(slotId);
  }
  if (!st) return;
  try {
    st.removeItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    st.removeItem(`${SLOT_CORE_V2_PREFIX}${slotId}`);
    st.removeItem(`${SLOT_GRAPH_V2_PREFIX}${slotId}`);
    lastSavedGraphSigByStorage.get(st)?.delete(slotId);
    const metaMap = readMetaMap(st);
    delete metaMap[slotId];
    writeMetaMap(metaMap, st);
  } catch {
    // Ignore storage errors
  }
}

function optionsStoragePresent(storage?: Storage): boolean {
  return Boolean(storage);
}

function clampFinite(val: unknown, fallback = 0, min = 0): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, num);
}

function sanitizePlainObject(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      clean[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizePlainObject(item as Record<string, unknown>)
          : typeof item === 'number' && !Number.isFinite(item)
          ? 0
          : item
      );
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizePlainObject(val as Record<string, unknown>);
    } else if (typeof val === 'number' && !Number.isFinite(val)) {
      clean[key] = 0;
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export async function saveLocalSlotGraphToIndexedDb(
  slotId: SaveSlotId,
  state: GameState
): Promise<void> {
  if (!hasIndexedDb()) return;
  const graphSig = computeLocalGraphStructureSig(state);
  lastIdbGraphSigBySlot.set(slotId, graphSig);
  const packed = packLocalGraphV2(state);
  const snapshot: CachedSlotGraphSnapshot = {
    slotId,
    version: 3,
    cityId: state.startingCity.id,
    wayNames: packed.wayNames,
    hwTypes: packed.hwTypes,
    regionIds: packed.regionIds,
    nodes: packed.nodes,
    edges: packed.edges,
    regionBoundaries: packed.regionBoundaries,
    loadedOsmChunks: state.loadedOsmChunks || [],
    loadedOsmRegions: state.loadedOsmRegions || [],
    updatedAt: Date.now(),
  };
  await putCachedSlotGraph(snapshot);
}

export function dehydrateGameStateForCloud(
  slotId: SaveSlotId,
  state: GameState,
  options?: {
    slotName?: string;
    clientSavedAt?: number;
    pendingMarks?: RestoredGraphMarks | null;
    maxChunkBytes?: number;
  }
): DehydratedCloudSlot {
  const pendingMarks = options?.pendingMarks;
  const connectedSet = new Set<string>();
  const connectedChunkKeys = new Set<string>();
  for (const n of state.osmNodes || []) {
    if (n.connected) {
      connectedSet.add(String(n.id).slice(0, 180));
      connectedChunkKeys.add(quantizeChunkKeyForSave(n.lat, n.lng));
    }
  }
  if (pendingMarks) {
    for (const id of pendingMarks.connectedNodeIds) {
      connectedSet.add(String(id).slice(0, 180));
    }
  }
  const connectedNodeIds = Array.from(connectedSet);

  const builtSet = new Set<string>();
  const customBridgeMap = new Map<string, CompactBridgeEdge>();
  for (const e of state.osmEdges || []) {
    if (e.built) builtSet.add(String(e.id).slice(0, 180));
    if (e.id.startsWith('oe_custom_') && customBridgeMap.size < 500) {
      customBridgeMap.set(e.id, {
        id: String(e.id).slice(0, 180),
        wayName: String(e.wayName || '연결 링크').slice(0, 120),
        highwayType: String(e.highwayType || 'unclassified').slice(0, 60),
        mode: e.mode === 'rail' ? 'rail' : 'road',
        fromNodeId: String(e.fromNodeId).slice(0, 120),
        toNodeId: String(e.toNodeId).slice(0, 120),
        fromLat: Number(e.coordinates?.[0]?.[0]) || 0,
        fromLng: Number(e.coordinates?.[0]?.[1]) || 0,
        toLat: Number(e.coordinates?.[1]?.[0]) || 0,
        toLng: Number(e.coordinates?.[1]?.[1]) || 0,
        distanceKm: clampFinite(e.distanceKm, 0.05, 0),
        buildCost: Math.max(0, Math.round(e.buildCost || 0)),
        baseIncomePerSec: clampFinite(e.baseIncomePerSec, 0, 0),
        built: Boolean(e.built),
        regionId: String(e.regionId || '').slice(0, 120),
      });
    }
  }
  if (pendingMarks) {
    for (const id of pendingMarks.builtEdgeIds) {
      builtSet.add(String(id).slice(0, 180));
    }
    for (const e of pendingMarks.customBridgeEdges) {
      if (e.built) builtSet.add(String(e.id).slice(0, 180));
      if (!customBridgeMap.has(e.id) && customBridgeMap.size < 500) {
        customBridgeMap.set(e.id, {
          id: String(e.id).slice(0, 180),
          wayName: String(e.wayName || '연결 링크').slice(0, 120),
          highwayType: String(e.highwayType || 'unclassified').slice(0, 60),
          mode: e.mode === 'rail' ? 'rail' : 'road',
          fromNodeId: String(e.fromNodeId).slice(0, 120),
          toNodeId: String(e.toNodeId).slice(0, 120),
          fromLat: Number(e.coordinates?.[0]?.[0]) || 0,
          fromLng: Number(e.coordinates?.[0]?.[1]) || 0,
          toLat: Number(e.coordinates?.[1]?.[0]) || 0,
          toLng: Number(e.coordinates?.[1]?.[1]) || 0,
          distanceKm: clampFinite(e.distanceKm, 0.05, 0),
          buildCost: Math.max(0, Math.round(e.buildCost || 0)),
          baseIncomePerSec: clampFinite(e.baseIncomePerSec, 0, 0),
          built: Boolean(e.built),
          regionId: String(e.regionId || '').slice(0, 120),
        });
      }
    }
  }
  const builtEdgeIds = Array.from(builtSet);
  const customBridgeEdges = Array.from(customBridgeMap.values());

  const nowMs = Math.max(0, Math.floor(options?.clientSavedAt ?? Date.now()));
  const stateForSummary: GameState = {
    ...state,
    stats: {
      ...state.stats,
      connectedOsmNodes: Math.max(state.stats?.connectedOsmNodes || 0, connectedNodeIds.length),
      totalOsmEdgesBuilt: Math.max(state.stats?.totalOsmEdgesBuilt || 0, builtEdgeIds.length),
    },
  };
  const summary = buildSummaryFromState(slotId, stateForSummary, {
    slotName: options?.slotName,
    clientSavedAt: nowMs,
    source: 'synced',
  });

  const skillsMap: Record<string, number> = {};
  for (const sk of state.skills || []) {
    if (Number.isFinite(sk.level) && sk.level > 0 && Object.keys(skillsMap).length < 200) {
      skillsMap[String(sk.id).slice(0, 120)] = Math.floor(sk.level);
    }
  }

  const unlockedAchievementIds = (state.achievements || [])
    .filter((a) => a.unlocked)
    .map((a) => String(a.id).slice(0, 120))
    .slice(0, 100);

  // Prioritize chunks that contain connected nodes at the end so .slice(-500) preserves all built chunks
  const rawChunks = Array.from(
    new Set([...(state.loadedOsmChunks || []), ...Array.from(connectedChunkKeys)])
  ).map((c) => String(c).slice(0, 120));
  const nonConnectedChunks = rawChunks.filter((c) => !connectedChunkKeys.has(c));
  const prioritizedConnectedChunks = rawChunks.filter((c) => connectedChunkKeys.has(c));
  const loadedOsmChunks = [...nonConnectedChunks, ...prioritizedConnectedChunks].slice(-500);

  const loadedOsmRegions = (state.loadedOsmRegions || [])
    .map((r) => String(r).slice(0, 120))
    .slice(0, 200);

  const pendingSeedRegionIds = (state.pendingSeedRegionIds || [])
    .map((r) => String(r).slice(0, 120))
    .slice(0, 200);

  const completedOsmWays = (state.completedOsmWays || [])
    .map((w) => String(w).slice(0, 180))
    .slice(-2000);

  const regions: CompactRegionRecord[] = (state.provincialRegions || [])
    .slice(0, 200)
    .map((r) => ({
      regionId: String(r.regionId).slice(0, 120),
      regionName: String(r.regionName).slice(0, 120),
      adminLevel: String(r.adminLevel || '6').slice(0, 24),
      bbox: [
        Number(r.bbox?.[0]) || 0,
        Number(r.bbox?.[1]) || 0,
        Number(r.bbox?.[2]) || 0,
        Number(r.bbox?.[3]) || 0,
      ],
      centerLat: Number(r.centerLat) || 0,
      centerLng: Number(r.centerLng) || 0,
      unlocked: Boolean(r.unlocked),
      isStartingRegion: Boolean(r.isStartingRegion),
      isIsolated: Boolean(r.isIsolated),
      isKnownIsland: Boolean(r.isKnownIsland),
      totalNodeCount: Math.max(0, Math.floor(r.totalNodeCount || 0)),
    }));

  const graphChunks: DehydratedCloudSlot['graphChunks'] = [];
  let nodeCursor = 0;
  let edgeCursor = 0;
  const CHUNK_DOC_BASE_BYTES = 320; // ownerUid, slotId, chunkIndex, timestamps, doc path
  const chunkDocBudget = Math.max(64 * 1024, Math.min(MAX_CHUNK_DOC_BYTES, options?.maxChunkBytes ?? MAX_CHUNK_DOC_BYTES));

  while (
    (nodeCursor < connectedNodeIds.length || edgeCursor < builtEdgeIds.length) &&
    graphChunks.length < MAX_GRAPH_CHUNKS
  ) {
    const chunkNodes: string[] = [];
    const chunkEdges: string[] = [];
    let chunkBytes = CHUNK_DOC_BASE_BYTES;

    while (nodeCursor < connectedNodeIds.length || edgeCursor < builtEdgeIds.length) {
      let addedAny = false;

      if (nodeCursor < connectedNodeIds.length && chunkNodes.length < GRAPH_CHUNK_ITEM_LIMIT) {
        const nid = connectedNodeIds[nodeCursor];
        const nidBytes = utf8ByteLength(nid) + 1;
        if (chunkBytes + nidBytes <= chunkDocBudget || (chunkNodes.length === 0 && chunkEdges.length === 0)) {
          chunkNodes.push(nid);
          chunkBytes += nidBytes;
          nodeCursor++;
          addedAny = true;
        }
      }

      if (edgeCursor < builtEdgeIds.length && chunkEdges.length < GRAPH_CHUNK_ITEM_LIMIT) {
        const eid = builtEdgeIds[edgeCursor];
        const eidBytes = utf8ByteLength(eid) + 1;
        if (chunkBytes + eidBytes <= chunkDocBudget || (chunkNodes.length === 0 && chunkEdges.length === 0)) {
          chunkEdges.push(eid);
          chunkBytes += eidBytes;
          edgeCursor++;
          addedAny = true;
        }
      }

      if (!addedAny) break;
    }

    if (chunkNodes.length === 0 && chunkEdges.length === 0) break;
    graphChunks.push({
      chunkIndex: graphChunks.length,
      nodeIds: chunkNodes,
      edgeIds: chunkEdges,
    });
  }

  const sanitizedMinigames = sanitizePlainObject(
    backfillMinigamesState(state.minigames) as unknown as Record<string, unknown>
  ) as unknown as GameState['minigames'];

  const coreFields: DehydratedCloudSlot['coreFields'] = {
    version: 1,
    capital: clampFinite(state.capital, 1200, 0),
    totalLifetimeEarnings: clampFinite(state.totalLifetimeEarnings, 0, 0),
    lastTickTimestamp: Math.max(0, Math.floor(state.lastTickTimestamp || nowMs)),
    startingCity: {
      id: summary.cityId,
      name: summary.cityName,
      country: summary.cityCountry,
      lat: summary.cityLat,
      lng: summary.cityLng,
      zoom: summary.cityZoom,
      description: summary.cityDescription,
      isCustom: summary.cityIsCustom,
    },
    stats: {
      totalSegmentsBuilt: Math.max(0, Math.floor(state.stats?.totalSegmentsBuilt || 0)),
      totalOsmEdgesBuilt: Math.max(0, Math.floor(state.stats?.totalOsmEdgesBuilt || 0), builtEdgeIds.length),
      connectedOsmNodes: Math.max(0, Math.floor(state.stats?.connectedOsmNodes || 0), connectedNodeIds.length),
      totalScaledNodes: Math.max(0, Math.floor(state.stats?.totalScaledNodes || 0)),
      totalLinesCompleted: 0,
      totalTownsCompleted: 0,
      totalClicks: Math.max(0, Math.floor(state.stats?.totalClicks || 0)),
      mapped1to1Km: clampFinite(state.stats?.mapped1to1Km, 0, 0),
      totalNetworkKm: clampFinite(state.stats?.totalNetworkKm, 0, 0),
      prestigeCount: 0,
    },
    settings: {
      soundEnabled: Boolean(state.settings?.soundEnabled ?? true),
      mapTileLayer:
        state.settings?.mapTileLayer === 'osm' || state.settings?.mapTileLayer === 'satellite'
          ? state.settings.mapTileLayer
          : 'dark',
    },
    skillsMap,
    unlockedAchievementIds,
    loadedOsmChunks,
    loadedOsmRegions,
    pendingSeedRegionIds,
    completedOsmWays,
    regions,
    customBridgeEdges,
    minigames: sanitizedMinigames,
  };

  // Enforce strict Firestore document byte budget (< 750 KiB so it never approaches 1 MiB limit)
  const estimateCoreBytes = () =>
    estimateFirestoreDocBytes(coreFields as unknown as Record<string, unknown>, 320);

  if (estimateCoreBytes() > MAX_CORE_DOC_BYTES && coreFields.completedOsmWays.length > 0) {
    // Re-evaluated cleanly from loaded OSM chunks on restore, so trim oldest completedOsmWays first
    while (coreFields.completedOsmWays.length > 0 && estimateCoreBytes() > MAX_CORE_DOC_BYTES) {
      const dropCount = Math.max(1, Math.ceil(coreFields.completedOsmWays.length * 0.25));
      coreFields.completedOsmWays = coreFields.completedOsmWays.slice(dropCount);
    }
  }

  if (estimateCoreBytes() > MAX_CORE_DOC_BYTES && coreFields.loadedOsmChunks.length > 0) {
    while (coreFields.loadedOsmChunks.length > 0 && estimateCoreBytes() > MAX_CORE_DOC_BYTES) {
      const dropCount = Math.max(1, Math.ceil(coreFields.loadedOsmChunks.length * 0.25));
      coreFields.loadedOsmChunks = coreFields.loadedOsmChunks.slice(dropCount);
    }
  }

  if (estimateCoreBytes() > MAX_CORE_DOC_BYTES && coreFields.customBridgeEdges.length > 0) {
    // Drop unbuilt custom bridges first before touching built ones
    coreFields.customBridgeEdges = coreFields.customBridgeEdges.filter((e) => e.built);
    while (coreFields.customBridgeEdges.length > 0 && estimateCoreBytes() > MAX_CORE_DOC_BYTES) {
      const dropCount = Math.max(1, Math.ceil(coreFields.customBridgeEdges.length * 0.2));
      coreFields.customBridgeEdges = coreFields.customBridgeEdges.slice(dropCount);
    }
  }

  if (estimateCoreBytes() > MAX_CORE_DOC_BYTES && coreFields.regions.length > 1) {
    const essentialRegions = coreFields.regions.filter((r) => r.unlocked || r.isStartingRegion);
    coreFields.regions = essentialRegions.length > 0 ? essentialRegions : coreFields.regions.slice(0, 1);
  }

  return {
    metaFields: {
      slotId: summary.slotId,
      slotIndex: summary.slotIndex,
      slotName: summary.slotName,
      cityId: summary.cityId,
      cityName: summary.cityName,
      cityCountry: summary.cityCountry,
      cityLat: summary.cityLat,
      cityLng: summary.cityLng,
      cityZoom: summary.cityZoom,
      cityDescription: summary.cityDescription,
      cityIsCustom: summary.cityIsCustom,
      capital: summary.capital,
      mapped1to1Km: summary.mapped1to1Km,
      connectedOsmNodes: summary.connectedOsmNodes,
      totalOsmEdgesBuilt: summary.totalOsmEdgesBuilt,
      tierLabel: summary.tierLabel,
      graphChunkCount: graphChunks.length,
      clientSavedAt: nowMs,
    },
    coreFields,
    graphChunks,
  };
}

export function rehydrateGameStateFromCloudPayload(
  core: DehydratedCloudSlot['coreFields'],
  graphChunks: Array<{ chunkIndex: number; nodeIds: string[]; edgeIds: string[] }>
): {
  baseState: GameState;
  marks: RestoredGraphMarks;
} {
  const city: StartingCity = {
    id: core.startingCity.id,
    name: core.startingCity.name,
    country: core.startingCity.country,
    lat: core.startingCity.lat,
    lng: core.startingCity.lng,
    zoom: core.startingCity.zoom,
    description: core.startingCity.description,
    isCustom: Boolean(core.startingCity.isCustom),
  };

  const initial = createInitialGameState(city);
  const achSet = new Set(core.unlockedAchievementIds || []);
  const skillsMap = core.skillsMap || {};

  const provincialRegions: ProvincialRegion[] = (core.regions || []).map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    adminLevel: r.adminLevel,
    bbox: r.bbox,
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    unlocked: Boolean(r.unlocked),
    isStartingRegion: Boolean(r.isStartingRegion),
    isIsolated: Boolean(r.isIsolated),
    isKnownIsland: Boolean(r.isKnownIsland),
    totalNodeCount: r.totalNodeCount || undefined,
    hasRealOsmBoundary: false,
  }));

  const customBridgeEdges: OsmEdge[] = (core.customBridgeEdges || []).map((e) => ({
    id: e.id,
    wayName: e.wayName,
    highwayType: e.highwayType,
    mode: e.mode,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    coordinates: [
      [e.fromLat, e.fromLng],
      [e.toLat, e.toLng],
    ],
    distanceKm: e.distanceKm,
    buildCost: e.buildCost,
    baseIncomePerSec: e.baseIncomePerSec,
    built: Boolean(e.built),
    regionId: e.regionId || undefined,
  }));

  const connectedNodeIds = new Set<string>();
  const builtEdgeIds = new Set<string>();
  const sortedChunks = [...graphChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  for (const chunk of sortedChunks) {
    for (const nid of chunk.nodeIds || []) connectedNodeIds.add(nid);
    for (const eid of chunk.edgeIds || []) builtEdgeIds.add(eid);
  }

  const baseState: GameState = {
    ...initial,
    capital: clampFinite(core.capital, initial.capital, 0),
    totalLifetimeEarnings: clampFinite(core.totalLifetimeEarnings, 0, 0),
    lastTickTimestamp: clampFinite(core.lastTickTimestamp, Date.now(), 0),
    skills: initial.skills.map((sk) => ({
      ...sk,
      level: Math.min(sk.maxLevel, Math.max(0, Math.floor(skillsMap[sk.id] || 0))),
    })),
    achievements: initial.achievements.map((ach) => ({
      ...ach,
      unlocked: achSet.has(ach.id),
    })),
    provincialRegions:
      provincialRegions.length > 0 ? provincialRegions : initial.provincialRegions,
    pendingSeedRegionIds: [...(core.pendingSeedRegionIds || [])],
    loadedOsmChunks: [], // Trigger fresh Overpass chunk loads on this device
    loadedOsmRegions: [], // Trigger fresh Overpass province loads on this device
    completedOsmWays: [...(core.completedOsmWays || [])],
    osmEdges: customBridgeEdges,
    minigames: backfillMinigamesState(core.minigames),
    stats: {
      ...initial.stats,
      ...(core.stats || {}),
    },
    settings: {
      soundEnabled: core.settings?.soundEnabled ?? true,
      mapTileLayer: core.settings?.mapTileLayer || 'dark',
    },
  };

  return {
    baseState,
    marks: {
      connectedNodeIds,
      builtEdgeIds,
      customBridgeEdges,
    },
  };
}

const utf8Decoder = new TextDecoder();

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function readAllStreamBytes(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const parts: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      parts.push(value);
      totalLen += value.length;
    }
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], offset);
    offset += parts[i].length;
  }
  return out;
}

async function gzipBytes(raw: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('gzip');
    const readPromise = readAllStreamBytes(cs.readable);
    const writer = cs.writable.getWriter();
    const writePromise = (async () => {
      await writer.write(new Uint8Array(raw));
      await writer.close();
    })();
    const [compressed] = await Promise.all([readPromise, writePromise]);
    return compressed;
  } catch {
    return null;
  }
}

async function gunzipBytes(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const readPromise = readAllStreamBytes(ds.readable);
    const writer = ds.writable.getWriter();
    const writePromise = (async () => {
      await writer.write(new Uint8Array(compressed));
      await writer.close();
    })();
    const [raw] = await Promise.all([readPromise, writePromise]);
    return raw;
  } catch {
    return null;
  }
}

function sliceStringSafely(str: string, maxSliceChars: number): string[] {
  if (!str) return [];
  const slices: string[] = [];
  let pos = 0;
  while (pos < str.length) {
    let end = Math.min(str.length, pos + maxSliceChars);
    if (end < str.length) {
      const lastChar = str.charCodeAt(end - 1);
      if (lastChar >= 0xd800 && lastChar <= 0xdbff) {
        end = Math.max(pos + 1, end - 1);
      }
    }
    slices.push(str.slice(pos, end));
    pos = end;
  }
  return slices;
}

export function computeCloudGraphStructureSig(
  state: GameState,
  pendingMarks?: RestoredGraphMarks | null
): string {
  const customBridgeCount =
    (state.osmEdges || []).filter((e) => e.id.startsWith('oe_custom_')).length +
    (pendingMarks?.customBridgeEdges?.length || 0);
  return `${computeLocalGraphStructureSig(state)}:cb=${customBridgeCount}:ways=${
    (state.completedOsmWays || []).length
  }`;
}

export function packCloudGraphV1(
  state: GameState,
  pendingMarks?: RestoredGraphMarks | null
): CompactCloudGraphV1 {
  const packed = packLocalGraphV2(state, {
    includeCustomBridges: true,
    extraCustomEdges: pendingMarks?.customBridgeEdges,
  });

  const regions: LocalCompactRegionRecord[] = (state.provincialRegions || []).map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    adminLevel: r.adminLevel || '6',
    bbox: r.bbox,
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    unlocked: Boolean(r.unlocked),
    isStartingRegion: Boolean(r.isStartingRegion),
    isIsolated: Boolean(r.isIsolated),
    isKnownIsland: Boolean(r.isKnownIsland),
    totalNodeCount: Math.max(0, Math.floor(r.totalNodeCount || 0)),
    ...(r.hasRealOsmBoundary ? { hasRealOsmBoundary: true } : {}),
  }));

  const chunkSet = new Set<string>(state.loadedOsmChunks || []);
  const tileNodeCounts = new Map<string, number>();
  for (const n of state.osmNodes || []) {
    const ck = quantizeChunkKeyForSave(n.lat, n.lng);
    tileNodeCounts.set(ck, (tileNodeCounts.get(ck) || 0) + 1);
  }
  for (const [ck, cnt] of tileNodeCounts.entries()) {
    if (cnt >= 12) {
      chunkSet.add(ck);
    }
  }

  return {
    v: 1,
    wayNames: packed.wayNames,
    hwTypes: packed.hwTypes,
    regionIds: packed.regionIds,
    nodes: packed.nodes,
    edges: packed.edges,
    regionBoundaries: packed.regionBoundaries,
    regions,
    loadedOsmChunks: Array.from(chunkSet),
    loadedOsmRegions: Array.from(new Set(state.loadedOsmRegions || [])),
    completedOsmWays: Array.from(new Set(state.completedOsmWays || [])),
  };
}

export async function encodeCloudGraphChunks(graph: CompactCloudGraphV1): Promise<{
  encoding: CloudGraphEncoding;
  slices: string[];
  rawBytes: number;
  encodedBytes: number;
}> {
  if (
    graph.nodes.length === 0 &&
    graph.edges.length === 0 &&
    graph.regionBoundaries.length === 0 &&
    graph.loadedOsmChunks.length === 0
  ) {
    return { encoding: 'none', slices: [], rawBytes: 0, encodedBytes: 0 };
  }

  const json = JSON.stringify(graph);
  const rawBytesArr = utf8Encoder.encode(json);
  const gzipped = await gzipBytes(rawBytesArr);

  if (gzipped && gzipped.length > 0) {
    const b64 = uint8ToBase64(gzipped);
    const slices = sliceStringSafely(b64, MAX_CLOUD_GRAPH_B64_SLICE_CHARS);
    if (slices.length <= MAX_GRAPH_CHUNKS) {
      return {
        encoding: 'gzip-b64-v1',
        slices,
        rawBytes: rawBytesArr.length,
        encodedBytes: b64.length,
      };
    }
  }

  const jsonSlices = sliceStringSafely(json, MAX_CLOUD_GRAPH_JSON_SLICE_CHARS).slice(
    0,
    MAX_GRAPH_CHUNKS
  );
  return {
    encoding: jsonSlices.length > 0 ? 'json-v1' : 'none',
    slices: jsonSlices,
    rawBytes: rawBytesArr.length,
    encodedBytes: rawBytesArr.length,
  };
}

export async function decodeCloudGraphChunks(
  chunks: CloudChunkPayloadRecord[]
): Promise<CompactCloudGraphV1 | null> {
  const sorted = [...chunks]
    .filter(
      (c) =>
        typeof c.graphPayload === 'string' &&
        c.graphPayload.length > 0 &&
        (c.graphEncoding === 'gzip-b64-v1' || c.graphEncoding === 'json-v1')
    )
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  if (sorted.length === 0) return null;
  const primaryEncoding = sorted[0].graphEncoding;
  const joined = sorted
    .filter((c) => c.graphEncoding === primaryEncoding)
    .map((c) => c.graphPayload!)
    .join('');
  if (!joined) return null;

  try {
    let jsonText = '';
    if (primaryEncoding === 'gzip-b64-v1') {
      const compressed = base64ToUint8(joined);
      const raw = await gunzipBytes(compressed);
      if (!raw) return null;
      jsonText = utf8Decoder.decode(raw);
    } else if (primaryEncoding === 'json-v1') {
      jsonText = joined;
    } else {
      return null;
    }

    const parsed = JSON.parse(jsonText) as CompactCloudGraphV1;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function hydrateCloudPayloadAsync(
  core: DehydratedCloudSlot['coreFields'],
  graphChunks: CloudChunkPayloadRecord[]
): Promise<{
  baseState: GameState;
  marks: RestoredGraphMarks;
  hasFullGraphSnapshot: boolean;
}> {
  const { baseState, marks } = rehydrateGameStateFromCloudPayload(core, graphChunks);
  const cloudGraph = await decodeCloudGraphChunks(graphChunks);

  const hasSnapshotContent =
    Boolean(cloudGraph) &&
    (cloudGraph!.nodes.length > 0 ||
      cloudGraph!.edges.length > 0 ||
      (cloudGraph!.regionBoundaries?.length || 0) > 0 ||
      (cloudGraph!.regions?.length || 0) > 0);

  if (!cloudGraph || !hasSnapshotContent) {
    return { baseState, marks, hasFullGraphSnapshot: false };
  }

  const corePayloadWithAllRegions: CompactLocalCoreV2 = {
    v: 2,
    capital: baseState.capital,
    totalLifetimeEarnings: baseState.totalLifetimeEarnings,
    lastTickTimestamp: baseState.lastTickTimestamp,
    startingCity: baseState.startingCity,
    stats: baseState.stats,
    settings: baseState.settings,
    skillsMap: core.skillsMap || {},
    unlockedAchievementIds: core.unlockedAchievementIds || [],
    loadedOsmChunks: Array.from(
      new Set([...(cloudGraph.loadedOsmChunks || []), ...(core.loadedOsmChunks || [])])
    ),
    loadedOsmRegions: Array.from(
      new Set([...(cloudGraph.loadedOsmRegions || []), ...(core.loadedOsmRegions || [])])
    ),
    pendingSeedRegionIds: [...(core.pendingSeedRegionIds || [])],
    completedOsmWays: Array.from(
      new Set([...(cloudGraph.completedOsmWays || []), ...(core.completedOsmWays || [])])
    ),
    regions:
      Array.isArray(cloudGraph.regions) && cloudGraph.regions.length > 0
        ? cloudGraph.regions
        : (core.regions || []).map((r) => ({ ...r })),
    minigames: baseState.minigames,
    connectedNodeIds: Array.from(marks.connectedNodeIds),
    builtEdgeIds: Array.from(marks.builtEdgeIds),
    customBridgeEdges: marks.customBridgeEdges,
  };

  const graphV2: CompactLocalGraphV2 = {
    v: 2,
    wayNames: cloudGraph.wayNames || [],
    hwTypes: cloudGraph.hwTypes || [],
    regionIds: cloudGraph.regionIds || [],
    nodes: cloudGraph.nodes || [],
    edges: cloudGraph.edges || [],
    regionBoundaries: cloudGraph.regionBoundaries || [],
  };

  const unpacked = unpackLocalV2ToRawGameState(corePayloadWithAllRegions, graphV2);
  const hydrated = hydrateRawGameState(unpacked, { trustedV2: true }) || baseState;
  const withMarks = applyRestoredGraphMarks(hydrated, marks);

  return {
    baseState: withMarks,
    marks,
    hasFullGraphSnapshot: true,
  };
}

export function applyRestoredGraphMarks(
  state: GameState,
  marks: RestoredGraphMarks | null | undefined
): GameState {
  if (!marks) return state;
  const { connectedNodeIds, builtEdgeIds, customBridgeEdges } = marks;
  if (
    connectedNodeIds.size === 0 &&
    builtEdgeIds.size === 0 &&
    customBridgeEdges.length === 0
  ) {
    return state;
  }

  let nodesChanged = false;
  const nextNodes = state.osmNodes.map((n) => {
    if (!n.connected && connectedNodeIds.has(n.id)) {
      nodesChanged = true;
      return { ...n, connected: true };
    }
    return n;
  });

  const existingEdgeIds = new Set(state.osmEdges.map((e) => e.id));
  const missingCustomEdges = customBridgeEdges.filter((e) => !existingEdgeIds.has(e.id));

  let edgesChanged = missingCustomEdges.length > 0;
  const nextEdges = [...state.osmEdges, ...missingCustomEdges].map((e) => {
    if (!e.built && builtEdgeIds.has(e.id)) {
      edgesChanged = true;
      return { ...e, built: true };
    }
    return e;
  });

  if (!nodesChanged && !edgesChanged) {
    const minNodes = Math.max(state.stats.connectedOsmNodes, connectedNodeIds.size);
    const minEdges = Math.max(state.stats.totalOsmEdgesBuilt, builtEdgeIds.size);
    if (minNodes !== state.stats.connectedOsmNodes || minEdges !== state.stats.totalOsmEdgesBuilt) {
      return {
        ...state,
        stats: {
          ...state.stats,
          connectedOsmNodes: minNodes,
          totalOsmEdgesBuilt: minEdges,
        },
      };
    }
    return state;
  }

  const nextState: GameState = {
    ...state,
    osmNodes: nextNodes,
    osmEdges: nextEdges,
  };

  const evaluated =
    state.skills.length > 0 && state.provincialRegions.length > 0
      ? evaluateLinesAndAchievements(nextState).newState
      : scopeGameStateToStartingCity(nextState);

  const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(evaluated, marks);
  if (unhydratedNodes > 0 || unhydratedEdges > 0) {
    return {
      ...evaluated,
      stats: {
        ...evaluated.stats,
        connectedOsmNodes: Math.max(evaluated.stats.connectedOsmNodes, connectedNodeIds.size),
        totalOsmEdgesBuilt: Math.max(evaluated.stats.totalOsmEdgesBuilt, builtEdgeIds.size),
      },
    };
  }
  return evaluated;
}

export function getCloudSyncBaselineMap(
  storage?: Storage
): Partial<Record<SaveSlotId, number>> {
  const st = getSafeStorage(storage);
  if (!st) return {};
  try {
    const raw = st.getItem(CLOUD_SYNC_BASE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Partial<Record<SaveSlotId, number>> = {};
    for (const slotId of SAVE_SLOT_IDS) {
      const val = Number(parsed?.[slotId]);
      if (Number.isFinite(val) && val > 0) {
        result[slotId] = Math.floor(val);
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function getCloudSyncBaseline(
  slotId: SaveSlotId,
  storage?: Storage
): number | undefined {
  return getCloudSyncBaselineMap(storage)[slotId];
}

export function setCloudSyncBaseline(
  slotId: SaveSlotId,
  clientSavedAt: number,
  storage?: Storage
): void {
  const st = getSafeStorage(storage);
  if (!st || !Number.isFinite(clientSavedAt) || clientSavedAt <= 0) return;
  try {
    const current = getCloudSyncBaselineMap(st);
    current[slotId] = Math.floor(clientSavedAt);
    st.setItem(CLOUD_SYNC_BASE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCloudSyncBaseline(slotId: SaveSlotId, storage?: Storage): void {
  const st = getSafeStorage(storage);
  if (!st) return;
  try {
    const current = getCloudSyncBaselineMap(st);
    delete current[slotId];
    st.setItem(CLOUD_SYNC_BASE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export function updateLocalSlotTimestamp(
  slotId: SaveSlotId,
  clientSavedAt: number,
  options?: { source?: 'local' | 'cloud' | 'synced'; cloudSavedAt?: number; storage?: Storage }
): SaveSlotSummary | null {
  const st = getSafeStorage(options?.storage);
  if (!st) return null;
  const metaMap = readMetaMap(st);
  const existing = metaMap[slotId];
  if (!existing) return null;
  const updated: SaveSlotSummary = {
    ...existing,
    clientSavedAt: Math.max(0, Math.floor(clientSavedAt)),
    source: options?.source || existing.source,
    cloudSavedAt: options?.cloudSavedAt ?? existing.cloudSavedAt,
  };
  metaMap[slotId] = updated;
  writeMetaMap(metaMap, st);
  return updated;
}

export function isSlotConflict(
  local?: SaveSlotSummary | null,
  cloud?: SaveSlotSummary | null,
  syncedCloudBaseAt?: number | null
): boolean {
  if (!local || !cloud) return false;

  const sameCoreValues =
    local.cityId === cloud.cityId &&
    local.connectedOsmNodes === cloud.connectedOsmNodes &&
    local.totalOsmEdgesBuilt === cloud.totalOsmEdgesBuilt &&
    Math.round(local.capital) === Math.round(cloud.capital);

  const timeDiff = Math.abs(local.clientSavedAt - cloud.clientSavedAt);
  if (timeDiff <= 3000 && sameCoreValues) {
    return false;
  }

  // Single-device clean forward progress since last known cloud sync baseline: NOT a conflict
  if (
    typeof syncedCloudBaseAt === 'number' &&
    Number.isFinite(syncedCloudBaseAt) &&
    syncedCloudBaseAt > 0 &&
    Math.abs(cloud.clientSavedAt - syncedCloudBaseAt) <= 3000 &&
    local.clientSavedAt >= cloud.clientSavedAt - 3000 &&
    local.cityId === cloud.cityId &&
    local.connectedOsmNodes >= cloud.connectedOsmNodes &&
    local.totalOsmEdgesBuilt >= cloud.totalOsmEdgesBuilt
  ) {
    return false;
  }

  // Otherwise local and cloud have diverged (different city, unseen cloud update, offline edits, or unlinked local+cloud saves)
  if (timeDiff > 3000) return true;
  if (!sameCoreValues) return true;
  return false;
}

export function mergeSlotSummaries(
  localMap: Partial<Record<SaveSlotId, SaveSlotSummary>>,
  cloudMap: Partial<Record<SaveSlotId, SaveSlotSummary>>,
  syncBaseMap?: Partial<Record<SaveSlotId, number>>
): Record<SaveSlotId, SaveSlotSummary | null> {
  const merged: Record<SaveSlotId, SaveSlotSummary | null> = {
    slot_1: null,
    slot_2: null,
    slot_3: null,
    slot_4: null,
    slot_5: null,
  };

  for (const slotId of SAVE_SLOT_IDS) {
    const local = localMap[slotId];
    const cloud = cloudMap[slotId];
    const syncedBase = syncBaseMap?.[slotId];
    if (local && cloud) {
      const hasNewerCloud = cloud.clientSavedAt > local.clientSavedAt + 3000;
      const hasNewerLocal = local.clientSavedAt > cloud.clientSavedAt + 3000;
      const hasConflict = isSlotConflict(local, cloud, syncedBase);
      merged[slotId] = {
        ...(hasNewerCloud ? cloud : local),
        source: hasConflict
          ? hasNewerCloud
            ? 'cloud'
            : 'local'
          : hasNewerLocal
          ? 'local'
          : hasNewerCloud
          ? 'cloud'
          : 'synced',
        cloudSavedAt: cloud.clientSavedAt,
        hasNewerCloud,
        hasNewerLocal,
        hasConflict,
      };
    } else if (cloud) {
      merged[slotId] = {
        ...cloud,
        source: 'cloud',
        cloudSavedAt: cloud.clientSavedAt,
        hasNewerCloud: true,
        hasConflict: false,
      };
    } else if (local) {
      merged[slotId] = {
        ...local,
        source: 'local',
        hasNewerLocal: true,
        hasConflict: false,
      };
    }
  }
  return merged;
}
