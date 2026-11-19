import {
  createInitialGameState,
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
export const SLOT_META_MAP_KEY = 'ROAD_INC_SAVE_SLOTS_META_V1';
export const ACTIVE_SLOT_STORAGE_KEY = 'ROAD_INC_ACTIVE_SLOT_V1';
export const LEGACY_MIGRATED_KEY = 'ROAD_INC_LEGACY_MIGRATED_V1';

export const GRAPH_CHUNK_ITEM_LIMIT = 1500;
export const MAX_GRAPH_CHUNKS = 100;

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

export function hydrateRawGameState(parsed: GameState): GameState | null {
  if (!parsed || !parsed.startingCity || typeof parsed.startingCity.lat !== 'number') {
    return null;
  }
  return scopeGameStateToStartingCity({
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
  });
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
  const cityName = (state.startingCity.name || '도시').slice(0, 120);
  return {
    slotId,
    slotIndex: slotIndexFromId(slotId),
    slotName: (options?.slotName || defaultSlotName(slotId, cityName)).slice(0, 60),
    cityId: (state.startingCity.id || 'custom').slice(0, 100),
    cityName,
    cityCountry: (state.startingCity.country || '').slice(0, 80),
    cityLat: Number.isFinite(state.startingCity.lat) ? state.startingCity.lat : 37.5665,
    cityLng: Number.isFinite(state.startingCity.lng) ? state.startingCity.lng : 126.978,
    cityZoom: Math.max(1, Math.min(22, Number(state.startingCity.zoom) || 14)),
    cityDescription: (state.startingCity.description || '').slice(0, 300),
    cityIsCustom: Boolean(state.startingCity.isCustom),
    capital: Math.max(0, Number(state.capital) || 0),
    mapped1to1Km: Math.max(0, Number(state.stats?.mapped1to1Km) || 0),
    connectedOsmNodes: Math.max(0, Math.floor(state.stats?.connectedOsmNodes || 0)),
    totalOsmEdgesBuilt: Math.max(0, Math.floor(state.stats?.totalOsmEdgesBuilt || 0)),
    tierLabel: rank.label.slice(0, 40),
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

export function migrateLegacySaveIfNeeded(storage?: Storage): void {
  const st = getSafeStorage(storage);
  if (!st) return;
  try {
    if (st.getItem(LEGACY_MIGRATED_KEY) === '1') return;
    const slot1Key = `${SLOT_STORAGE_PREFIX}slot_1`;
    if (st.getItem(slot1Key)) {
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
    st.setItem(slot1Key, JSON.stringify(hydrated));
    const metaMap = readMetaMap(st);
    metaMap.slot_1 = buildSummaryFromState('slot_1', hydrated, {
      clientSavedAt: hydrated.lastTickTimestamp || Date.now(),
      source: 'local',
    });
    writeMetaMap(metaMap, st);
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
    const rawSlot = st.getItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    if (!rawSlot) {
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
      const parsed = JSON.parse(rawSlot) as GameState;
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

export function loadLocalSlotGameState(slotId: SaveSlotId, storage?: Storage): GameState | null {
  const st = getSafeStorage(storage);
  if (!st) return null;
  migrateLegacySaveIfNeeded(st);
  try {
    const raw = st.getItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    return hydrateRawGameState(parsed);
  } catch {
    return null;
  }
}

export function saveLocalSlotGameState(
  slotId: SaveSlotId,
  state: GameState,
  options?: { slotName?: string; storage?: Storage; savedAt?: number }
): SaveSlotSummary {
  const st = getSafeStorage(options?.storage);
  const metaMap = readMetaMap(st || undefined);
  const existingName = metaMap[slotId]?.slotName;
  const resolvedName =
    options?.slotName ||
    (existingName && metaMap[slotId]?.cityId === state.startingCity.id ? existingName : undefined);
  const summary = buildSummaryFromState(slotId, state, {
    slotName: resolvedName,
    clientSavedAt: options?.savedAt ?? Date.now(),
    source: 'local',
  });

  if (st) {
    try {
      st.setItem(`${SLOT_STORAGE_PREFIX}${slotId}`, JSON.stringify(state));
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
  if (!st) return;
  try {
    st.removeItem(`${SLOT_STORAGE_PREFIX}${slotId}`);
    const metaMap = readMetaMap(st);
    delete metaMap[slotId];
    writeMetaMap(metaMap, st);
  } catch {
    // Ignore storage errors
  }
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

export function dehydrateGameStateForCloud(
  slotId: SaveSlotId,
  state: GameState,
  options?: { slotName?: string; clientSavedAt?: number }
): DehydratedCloudSlot {
  const nowMs = Math.max(0, Math.floor(options?.clientSavedAt ?? Date.now()));
  const summary = buildSummaryFromState(slotId, state, {
    slotName: options?.slotName,
    clientSavedAt: nowMs,
    source: 'synced',
  });

  const skillsMap: Record<string, number> = {};
  for (const sk of state.skills || []) {
    if (sk.level > 0 && Object.keys(skillsMap).length < 200) {
      skillsMap[sk.id] = Math.floor(sk.level);
    }
  }

  const unlockedAchievementIds = (state.achievements || [])
    .filter((a) => a.unlocked)
    .map((a) => String(a.id).slice(0, 120))
    .slice(0, 100);

  const loadedOsmChunks = (state.loadedOsmChunks || [])
    .map((c) => String(c).slice(0, 120))
    .slice(-500);

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

  const customBridgeEdges: CompactBridgeEdge[] = (state.osmEdges || [])
    .filter((e) => e.id.startsWith('oe_custom_'))
    .slice(0, 500)
    .map((e) => ({
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
    }));

  const connectedNodeIds = (state.osmNodes || [])
    .filter((n) => n.connected)
    .map((n) => String(n.id).slice(0, 180));
  const builtEdgeIds = (state.osmEdges || [])
    .filter((e) => e.built)
    .map((e) => String(e.id).slice(0, 180));

  const chunkCount = Math.min(
    MAX_GRAPH_CHUNKS,
    Math.max(
      Math.ceil(connectedNodeIds.length / GRAPH_CHUNK_ITEM_LIMIT),
      Math.ceil(builtEdgeIds.length / GRAPH_CHUNK_ITEM_LIMIT)
    )
  );

  const graphChunks: DehydratedCloudSlot['graphChunks'] = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * GRAPH_CHUNK_ITEM_LIMIT;
    const end = start + GRAPH_CHUNK_ITEM_LIMIT;
    graphChunks.push({
      chunkIndex: i,
      nodeIds: connectedNodeIds.slice(start, end),
      edgeIds: builtEdgeIds.slice(start, end),
    });
  }

  const sanitizedMinigames = sanitizePlainObject(
    backfillMinigamesState(state.minigames) as unknown as Record<string, unknown>
  ) as unknown as GameState['minigames'];

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
    coreFields: {
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
        totalOsmEdgesBuilt: Math.max(0, Math.floor(state.stats?.totalOsmEdgesBuilt || 0)),
        connectedOsmNodes: Math.max(0, Math.floor(state.stats?.connectedOsmNodes || 0)),
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
    },
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
    return state;
  }

  return scopeGameStateToStartingCity({
    ...state,
    osmNodes: nextNodes,
    osmEdges: nextEdges,
  });
}

export function mergeSlotSummaries(
  localMap: Partial<Record<SaveSlotId, SaveSlotSummary>>,
  cloudMap: Partial<Record<SaveSlotId, SaveSlotSummary>>
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
    if (local && cloud) {
      const hasNewerCloud = cloud.clientSavedAt > local.clientSavedAt + 3000;
      const hasNewerLocal = local.clientSavedAt > cloud.clientSavedAt + 3000;
      merged[slotId] = {
        ...(hasNewerCloud ? cloud : local),
        source: hasNewerCloud || hasNewerLocal ? local.source : 'synced',
        cloudSavedAt: cloud.clientSavedAt,
        hasNewerCloud,
        hasNewerLocal,
      };
      if (!hasNewerCloud && !hasNewerLocal) {
        merged[slotId]!.source = 'synced';
      }
    } else if (cloud) {
      merged[slotId] = {
        ...cloud,
        source: 'cloud',
        cloudSavedAt: cloud.clientSavedAt,
        hasNewerCloud: true,
      };
    } else if (local) {
      merged[slotId] = {
        ...local,
        source: 'local',
        hasNewerLocal: true,
      };
    }
  }
  return merged;
}
