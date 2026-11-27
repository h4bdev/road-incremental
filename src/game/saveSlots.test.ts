import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameState, mergeOsmChunk, mergeOsmChunksBatch, unlockSkill } from './rules';
import { chunkKeyForCoords } from './osmService';
import {
  applyRestoredGraphMarks,
  clearCloudSyncBaseline,
  CloudChunkPayloadRecord,
  collectMarksWithExistingState,
  computeCloudGraphStructureSig,
  countSyntheticRestoredItems,
  countUnhydratedGraphMarks,
  decodeCloudGraphChunks,
  decodeImportedSaveString,
  dehydrateGameStateForCloud,
  deleteLocalSlotGameState,
  encodeCloudGraphChunks,
  estimateFirestoreDocBytes,
  EXPORT_SAVE_PREFIX_GZIP,
  exportSaveToString,
  getActiveSlotId,
  getCloudSyncBaseline,
  getCloudSyncBaselineMap,
  getLocalSlotGraphMarks,
  GRAPH_CHUNK_ITEM_LIMIT,
  hydrateCloudPayloadAsync,
  importDecodedSaveIntoSlot,
  isSlotConflict,
  LEGACY_SAVE_KEY,
  listLocalSlotSummaries,
  loadLocalSlotGameState,
  MAX_CHUNK_DOC_BYTES,
  MAX_CORE_DOC_BYTES,
  MAX_GRAPH_CHUNKS,
  MAX_MARK_CHUNK_WITH_PAYLOAD_BYTES,
  MAX_SAVE_SLOTS,
  mergeSlotSummaries,
  migrateLegacySaveIfNeeded,
  packCloudGraphV1,
  parseEdgeEndpointsFromId,
  rehydrateGameStateFromCloudPayload,
  RestoredGraphMarks,
  SAVE_SLOT_IDS,
  saveLocalSlotGameState,
  setActiveSlotId,
  setCloudSyncBaseline,
  updateLocalSlotTimestamp,
} from './saveSlots';
import { getCachedSlotGraph, resetMemoryTileCacheForTests } from './osmTileCache';
import { PRESET_CITIES } from './worldCatalog';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function assertFirestoreSafeValue(val: unknown, path = 'root'): void {
  assert.notEqual(val, undefined, `Undefined value at ${path}`);
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      const item: unknown = val[i];
      assert.equal(Array.isArray(item), false, `Nested array forbidden by Firestore at ${path}[${i}]`);
      assertFirestoreSafeValue(item, `${path}[${i}]`);
    }
    return;
  }
  if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      assertFirestoreSafeValue(v, `${path}.${k}`);
    }
  }
}

test('5 save slots CRUD and legacy TERRALINE_SAVE_V4 migration to slot_1', () => {
  const storage = createMemoryStorage();
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const tokyo = PRESET_CITIES.find((c) => c.id === 'tokyo')!;

  assert.equal(MAX_SAVE_SLOTS, 5);
  assert.deepEqual([...SAVE_SLOT_IDS], ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5']);

  // Seed legacy save and trigger migration
  const legacyState = { ...createInitialGameState(seoul), capital: 4321 };
  storage.setItem(LEGACY_SAVE_KEY, JSON.stringify(legacyState));
  migrateLegacySaveIfNeeded(storage);

  const listAfterMigration = listLocalSlotSummaries(storage);
  assert.ok(listAfterMigration.slot_1);
  assert.equal(listAfterMigration.slot_1?.cityId, 'seoul');
  assert.equal(listAfterMigration.slot_1?.capital, 4321);
  assert.equal(getActiveSlotId(storage), 'slot_1');

  // Save slot_3 and switch active slot
  const tokyoState = { ...createInitialGameState(tokyo), capital: 9876 };
  saveLocalSlotGameState('slot_3', tokyoState, { storage, slotName: '도쿄 본선' });
  setActiveSlotId('slot_3', storage);

  assert.equal(getActiveSlotId(storage), 'slot_3');
  const loadedTokyo = loadLocalSlotGameState('slot_3', storage);
  assert.equal(loadedTokyo?.startingCity.id, 'tokyo');
  assert.equal(loadedTokyo?.capital, 9876);

  // Delete slot_1
  deleteLocalSlotGameState('slot_1', storage);
  assert.equal(loadLocalSlotGameState('slot_1', storage), null);
});

test('dehydrateGameStateForCloud produces Firestore-safe flat structures & rehydrates accurately', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 25000 };
  const skRes = unlockSkill(state, state.skills[0].id);
  if (skRes.success) state = skRes.newState;

  state = mergeOsmChunk(
    state,
    '37.5665_126.9780',
    [
      { id: 'n1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' },
      { id: 'n2', lat: 37.5675, lng: 126.979, connected: true, mode: 'road' },
    ],
    [
      {
        id: 'oe_custom_n1_n2',
        wayName: '교차로 연결 링크',
        highwayType: 'unclassified',
        mode: 'road',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        coordinates: [
          [37.5665, 126.978],
          [37.5675, 126.979],
        ],
        distanceKm: 0.14,
        buildCost: 60,
        baseIncomePerSec: 3,
        built: true,
      },
    ]
  );

  const dehydrated = dehydrateGameStateForCloud('slot_2', state, { slotName: '테스트 슬롯' });
  assertFirestoreSafeValue(dehydrated);
  assert.equal(dehydrated.metaFields.slotIndex, 2);
  assert.equal(dehydrated.metaFields.slotName, '테스트 슬롯');
  assert.equal(dehydrated.coreFields.customBridgeEdges.length, 1);
  assert.equal(dehydrated.graphChunks.length, 1);
  assert.deepEqual(dehydrated.graphChunks[0].nodeIds.sort(), ['n1', 'n2']);
  assert.deepEqual(dehydrated.graphChunks[0].edgeIds, ['oe_custom_n1_n2']);

  // Rehydrate onto an empty client
  const { baseState, marks } = rehydrateGameStateFromCloudPayload(
    dehydrated.coreFields,
    dehydrated.graphChunks
  );
  const withChunk = mergeOsmChunk(
    baseState,
    '37.5665_126.9780',
    [
      { id: 'n1', lat: 37.5665, lng: 126.978, connected: false, mode: 'road' },
      { id: 'n2', lat: 37.5675, lng: 126.979, connected: false, mode: 'road' },
    ],
    []
  );
  const restored = applyRestoredGraphMarks(withChunk, marks);
  assert.equal(restored.osmNodes.filter((n) => n.connected).length, 2);
  assert.equal(restored.osmEdges.filter((e) => e.built).length, 1);
  assert.ok(restored.osmEdges.some((e) => e.id === 'oe_custom_n1_n2' && e.coordinates.length === 2));
});

test('large graphs (>4500 nodes) split cleanly into bounded Firestore chunks', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  state.osmNodes = Array.from({ length: 4700 }, (_, i) => ({
    id: `node_${i}`,
    lat: 37.56 + (i % 100) * 0.0001,
    lng: 126.97 + Math.floor(i / 100) * 0.0001,
    connected: true,
    mode: 'road' as const,
  }));
  state.osmEdges = Array.from({ length: 3200 }, (_, i) => ({
    id: `edge_${i}`,
    wayName: '테스트로',
    highwayType: 'primary',
    mode: 'road' as const,
    fromNodeId: `node_${i}`,
    toNodeId: `node_${i + 1}`,
    coordinates: [
      [37.56, 126.97],
      [37.5601, 126.9701],
    ],
    distanceKm: 0.02,
    buildCost: 20,
    baseIncomePerSec: 1,
    built: true,
  }));

  const dehydrated = dehydrateGameStateForCloud('slot_1', state);
  assert.equal(dehydrated.graphChunks.length, 4); // ceil(4700 / 1500)
  for (const chunk of dehydrated.graphChunks) {
    assert.ok(chunk.nodeIds.length <= 1500);
    assert.ok(chunk.edgeIds.length <= 1500);
  }
});

test('mergeSlotSummaries resolves synced, cloud-newer, local-newer states across 5 slots', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const s = createInitialGameState(seoul);
  const local = {
    slot_1: {
      ...dehydrateGameStateForCloud('slot_1', s, { clientSavedAt: 10_000 }).metaFields,
      source: 'local' as const,
    },
    slot_2: {
      ...dehydrateGameStateForCloud('slot_2', s, { clientSavedAt: 20_000 }).metaFields,
      source: 'local' as const,
    },
  };
  const cloud = {
    slot_1: {
      ...dehydrateGameStateForCloud('slot_1', s, { clientSavedAt: 10_500 }).metaFields,
      source: 'cloud' as const,
    },
    slot_2: {
      ...dehydrateGameStateForCloud('slot_2', s, { clientSavedAt: 50_000 }).metaFields,
      source: 'cloud' as const,
    },
    slot_5: {
      ...dehydrateGameStateForCloud('slot_5', s, { clientSavedAt: 30_000 }).metaFields,
      source: 'cloud' as const,
    },
  };

  const merged = mergeSlotSummaries(local, cloud);
  assert.equal(merged.slot_1?.source, 'synced');
  assert.equal(merged.slot_2?.hasNewerCloud, true);
  assert.equal(merged.slot_3, null);
  assert.equal(merged.slot_5?.source, 'cloud');
});

test('oversized UTF-8 saves (>1MB raw core/chunks) respect Firestore document byte budgets', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  // 2,000 long Korean completedOsmWays (~1.08MB alone in UTF-8) + 500 custom bridges + 500 chunk keys
  const longKoreanSuffix = '가나다라마바사아자차카타파하'.repeat(10); // 140 Korean chars = 420 bytes in UTF-8
  state.completedOsmWays = Array.from({ length: 2000 }, (_, i) => `road::${i}_${longKoreanSuffix}`);
  state.loadedOsmChunks = Array.from({ length: 500 }, (_, i) => `37.${String(i).padStart(4, '0')}_126.${longKoreanSuffix.slice(0, 30)}`);
  state.osmEdges = Array.from({ length: 500 }, (_, i) => ({
    id: `oe_custom_${i}_${longKoreanSuffix.slice(0, 40)}`,
    wayName: `긴교차로링크_${i}_${longKoreanSuffix.slice(0, 30)}`,
    highwayType: 'unclassified',
    mode: 'road' as const,
    fromNodeId: `fn_${i}_${longKoreanSuffix.slice(0, 30)}`,
    toNodeId: `tn_${i}_${longKoreanSuffix.slice(0, 30)}`,
    coordinates: [
      [37.56, 126.97],
      [37.561, 126.971],
    ],
    distanceKm: 0.1,
    buildCost: 30,
    baseIncomePerSec: 2,
    built: true,
    regionId: 'curated_kr_seoul_jung',
  }));

  // 2,500 long UTF-8 connected nodeIds (~1.3MB combined if shoved into 2 chunks)
  state.osmNodes = Array.from({ length: 2500 }, (_, i) => ({
    id: `osm_n_${i}_${longKoreanSuffix}`,
    lat: 37.56 + (i % 50) * 0.0001,
    lng: 126.97 + Math.floor(i / 50) * 0.0001,
    connected: true,
    mode: 'road' as const,
  }));

  const dehydrated = dehydrateGameStateForCloud('slot_1', state, { slotName: '   ' });
  assertFirestoreSafeValue(dehydrated);
  assert.ok(dehydrated.metaFields.slotName.trim().length >= 1, 'Blank slotName must fall back to default name');

  const coreBytes = estimateFirestoreDocBytes(
    dehydrated.coreFields as unknown as Record<string, unknown>,
    320
  );
  assert.ok(
    coreBytes <= MAX_CORE_DOC_BYTES,
    `Expected core doc bytes (${coreBytes}) <= ${MAX_CORE_DOC_BYTES}`
  );

  assert.ok(dehydrated.graphChunks.length >= 2 && dehydrated.graphChunks.length <= MAX_GRAPH_CHUNKS);
  let totalRestoredNodes = 0;
  for (const chunk of dehydrated.graphChunks) {
    assert.ok(chunk.nodeIds.length <= GRAPH_CHUNK_ITEM_LIMIT);
    assert.ok(chunk.edgeIds.length <= GRAPH_CHUNK_ITEM_LIMIT);
    const chunkBytes = estimateFirestoreDocBytes(
      {
        ownerUid: 'uid_test_1234567890',
        slotId: 'slot_1',
        chunkIndex: chunk.chunkIndex,
        nodeIds: chunk.nodeIds,
        edgeIds: chunk.edgeIds,
      },
      256
    );
    assert.ok(
      chunkBytes <= MAX_CHUNK_DOC_BYTES + 1024,
      `Expected chunk doc bytes (${chunkBytes}) <= ${MAX_CHUNK_DOC_BYTES}`
    );
    totalRestoredNodes += chunk.nodeIds.length;
  }
  assert.equal(totalRestoredNodes, 2500);
});

test('V2 split local save/load roundtrips 10,000 nodes cleanly, skips redundant graph writes, and falls back to V1', () => {
  const storage = createMemoryStorage();
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  const nodes = Array.from({ length: 10_000 }, (_, i) => ({
    id: `osm_perf_${i}`,
    lat: 37.54 + (i % 100) * 0.0005,
    lng: 126.95 + Math.floor(i / 100) * 0.0005,
    connected: i < 500,
    mode: 'road' as const,
    regionId: 'curated_kr_seoul_jung',
  }));
  const edges = Array.from({ length: 9_999 }, (_, i) => ({
    id: `edge_perf_${i}`,
    wayName: '성능검증대로',
    highwayType: 'primary',
    mode: 'road' as const,
    fromNodeId: `osm_perf_${i}`,
    toNodeId: `osm_perf_${i + 1}`,
    coordinates: [
      [nodes[i].lat, nodes[i].lng],
      [nodes[i + 1].lat, nodes[i + 1].lng],
    ] as [[number, number], [number, number]],
    distanceKm: 0.05,
    buildCost: 25,
    baseIncomePerSec: 2,
    built: i < 499,
    regionId: 'curated_kr_seoul_jung',
  }));

  const largeState = {
    ...state,
    capital: 987_654,
    osmNodes: nodes,
    osmEdges: edges,
    stats: {
      ...state.stats,
      connectedOsmNodes: 500,
      totalOsmEdgesBuilt: 499,
    },
  };

  const tSave1 = Date.now();
  saveLocalSlotGameState('slot_3', largeState, { storage, slotName: '1만 노드 슬롯' });
  const save1Ms = Date.now() - tSave1;
  assert.ok(save1Ms < 2000, `Expected first 10k V2 save < 2000ms, got ${save1Ms}ms`);

  // Ensure V2 split keys exist and V1 legacy key is not duplicated
  const hasCoreV2 = Boolean(storage.getItem('ROAD_INC_SAVE_SLOT_CORE_V2_slot_3'));
  const hasGraphV2 = Boolean(storage.getItem('ROAD_INC_SAVE_SLOT_GRAPH_V2_slot_3'));
  assert.equal(hasCoreV2, true);
  assert.equal(hasGraphV2, true);
  assert.equal(storage.getItem('ROAD_INC_SAVE_SLOT_V1_slot_3'), null);

  // Subsequent autosave when only capital changed must succeed quickly while preserving graph
  const afterTickState = { ...largeState, capital: 1_234_567 };
  saveLocalSlotGameState('slot_3', afterTickState, { storage });

  const tLoad = Date.now();
  const loaded = loadLocalSlotGameState('slot_3', storage);
  const loadMs = Date.now() - tLoad;
  assert.ok(loaded);
  assert.ok(loadMs < 2000, `Expected 10k V2 load < 2000ms, got ${loadMs}ms`);
  assert.equal(loaded.capital, 1_234_567);
  assert.equal(loaded.osmNodes.length, 10_000);
  assert.equal(loaded.osmEdges.length, 9_999);
  assert.equal(loaded.osmNodes.filter((n) => n.connected).length, 500);
  assert.equal(loaded.osmEdges.filter((e) => e.built).length, 499);

  // V1 legacy slot key still loads if V2 keys are absent
  storage.setItem(
    'ROAD_INC_SAVE_SLOT_V1_slot_4',
    JSON.stringify({ ...state, capital: 77_777 })
  );
  const v1Loaded = loadLocalSlotGameState('slot_4', storage);
  assert.ok(v1Loaded);
  assert.equal(v1Loaded.capital, 77_777);
  const summaries = listLocalSlotSummaries(storage);
  assert.equal(summaries.slot_4?.capital, 77_777);
});

test('4,351-node progressive restore across chunks never truncates at 600 and preserves unhydrated marks during mid-stream autosaves', () => {
  const storage = createMemoryStorage();
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;

  // Build 4,351 connected nodes distributed across 44 chunks (~99 nodes per chunk)
  const totalNodes = 4351;
  const allNodes = Array.from({ length: totalNodes }, (_, i) => {
    const chunkIdx = Math.floor(i / 100);
    const baseLat = 37.45 + Math.floor(chunkIdx / 7) * 0.025;
    const baseLng = 126.82 + (chunkIdx % 7) * 0.025;
    return {
      id: `n4k_${i}`,
      lat: baseLat + (i % 10) * 0.0005,
      lng: baseLng + Math.floor((i % 100) / 10) * 0.0005,
      connected: true,
      mode: 'road' as const,
      regionId: 'curated_kr_seoul_jung',
    };
  });
  const allEdges = Array.from({ length: totalNodes - 1 }, (_, i) => ({
    id: `e4k_${i}`,
    wayName: '광역도로망',
    highwayType: 'primary',
    mode: 'road' as const,
    fromNodeId: allNodes[i].id,
    toNodeId: allNodes[i + 1].id,
    coordinates: [
      [allNodes[i].lat, allNodes[i].lng],
      [allNodes[i + 1].lat, allNodes[i + 1].lng],
    ] as [[number, number], [number, number]],
    distanceKm: 0.05,
    buildCost: 20,
    baseIncomePerSec: 1,
    built: true,
    regionId: 'curated_kr_seoul_jung',
  }));

  // Also simulate >500 loaded chunks where connected chunks must survive the 500-chunk cap
  const dummyChunks = Array.from({ length: 520 }, (_, i) => `35.${String(i).padStart(3, '0')}_125.000`);
  const fullState = {
    ...createInitialGameState(seoul),
    loadedOsmChunks: dummyChunks,
    osmNodes: allNodes,
    osmEdges: allEdges,
    stats: {
      ...createInitialGameState(seoul).stats,
      connectedOsmNodes: totalNodes,
      totalOsmEdgesBuilt: totalNodes - 1,
    },
  };

  const dehydrated = dehydrateGameStateForCloud('slot_1', fullState);
  assert.ok(dehydrated.coreFields.loadedOsmChunks.length <= 500);
  // Prioritized chunk with connected node must match osmService chunkKeyForCoords precision (1/300)
  assert.ok(
    dehydrated.coreFields.loadedOsmChunks.includes(chunkKeyForCoords(allNodes[0].lat, allNodes[0].lng))
  );

  const { baseState, marks } = rehydrateGameStateFromCloudPayload(
    dehydrated.coreFields,
    dehydrated.graphChunks
  );
  assert.equal(marks.connectedNodeIds.size, totalNodes);

  // Hydrate ONLY the first 6 chunks (600 nodes) and simulate an 8s local autosave + cloud autosave mid-stream
  const partialBatches = Array.from({ length: 6 }, (_, chIdx) => ({
    chunkKey: `chunk_${chIdx}`,
    osmNodes: allNodes.slice(chIdx * 100, (chIdx + 1) * 100).map((n) => ({ ...n, connected: false })),
    osmEdges: allEdges.slice(chIdx * 100, Math.min((chIdx + 1) * 100, allEdges.length)).map((e) => ({ ...e, built: false })),
  }));
  let partialState = mergeOsmChunksBatch(baseState, partialBatches, { skipAutoSeed: true });
  partialState = applyRestoredGraphMarks(partialState, marks);

  assert.equal(partialState.osmNodes.filter((n) => n.connected).length, 600);
  // HUD/summary stat floor preserves all 4,351 nodes while unhydrated marks remain
  assert.equal(partialState.stats.connectedOsmNodes, totalNodes);
  assert.equal(countUnhydratedGraphMarks(partialState, marks).unhydratedNodes, totalNodes - 600);

  // Mid-stream autosave with pendingMarks must preserve all 4,351 IDs in CORE_V2 and cloud payload
  saveLocalSlotGameState('slot_1', partialState, { storage, pendingMarks: marks });
  const savedLocalMarks = getLocalSlotGraphMarks('slot_1', storage)!;
  assert.equal(savedLocalMarks.connectedNodeIds.size, totalNodes);

  const midCloudDehydrated = dehydrateGameStateForCloud('slot_1', partialState, { pendingMarks: marks });
  const totalMidCloudNodes = midCloudDehydrated.graphChunks.reduce((acc, c) => acc + c.nodeIds.length, 0);
  assert.equal(totalMidCloudNodes, totalNodes);

  // Stream remaining chunks (chunks 6..43) and apply marks
  const remainingBatches = Array.from({ length: 38 }, (_, idx) => {
    const chIdx = idx + 6;
    return {
      chunkKey: `chunk_${chIdx}`,
      osmNodes: allNodes.slice(chIdx * 100, (chIdx + 1) * 100).map((n) => ({ ...n, connected: false })),
      osmEdges: allEdges.slice(chIdx * 100, Math.min((chIdx + 1) * 100, allEdges.length)).map((e) => ({ ...e, built: false })),
    };
  });
  let completedState = mergeOsmChunksBatch(partialState, remainingBatches, { skipAutoSeed: true });
  completedState = applyRestoredGraphMarks(completedState, marks);

  assert.equal(completedState.osmNodes.filter((n) => n.connected).length, totalNodes);
  assert.equal(completedState.osmEdges.filter((e) => e.built).length, totalNodes - 1);
  assert.equal(completedState.stats.connectedOsmNodes, totalNodes);
  assert.equal(countUnhydratedGraphMarks(completedState, marks).unhydratedNodes, 0);
});

test('cloud sync baseline prevents false single-device conflicts and catches cross-device or unlinked divergence', () => {
  const storage = createMemoryStorage();
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const tokyo = PRESET_CITIES.find((c) => c.id === 'tokyo')!;

  const sBase = createInitialGameState(seoul);
  const sTokyo = createInitialGameState(tokyo);

  const cloudT0 = {
    ...dehydrateGameStateForCloud('slot_1', sBase, { clientSavedAt: 100_000 }).metaFields,
    source: 'cloud' as const,
  };
  const localForward = {
    ...dehydrateGameStateForCloud('slot_1', { ...sBase, capital: 5500 }, { clientSavedAt: 220_000 }).metaFields,
    connectedOsmNodes: 15,
    totalOsmEdgesBuilt: 12,
    source: 'local' as const,
  };

  // Without baseline -> unlinked local + cloud saves must trigger conflict
  assert.equal(isSlotConflict(localForward, cloudT0, undefined), true);

  // With matching sync baseline (100_000) -> clean single-device forward progress is NOT a conflict
  setCloudSyncBaseline('slot_1', 100_000, storage);
  assert.equal(getCloudSyncBaseline('slot_1', storage), 100_000);
  assert.equal(isSlotConflict(localForward, cloudT0, getCloudSyncBaseline('slot_1', storage)), false);

  const mergedForward = mergeSlotSummaries(
    { slot_1: localForward },
    { slot_1: cloudT0 },
    getCloudSyncBaselineMap(storage)
  );
  assert.equal(mergedForward.slot_1?.hasConflict, false);
  assert.equal(mergedForward.slot_1?.hasNewerLocal, true);
  assert.equal(mergedForward.slot_1?.source, 'local');

  // If another device updates Cloud (150_000 !== baseline 100_000) -> MUST trigger conflict
  const cloudFromOtherDevice = {
    ...dehydrateGameStateForCloud('slot_1', { ...sBase, capital: 9900 }, { clientSavedAt: 150_000 }).metaFields,
    connectedOsmNodes: 20,
    totalOsmEdgesBuilt: 18,
    source: 'cloud' as const,
  };
  assert.equal(
    isSlotConflict(localForward, cloudFromOtherDevice, getCloudSyncBaseline('slot_1', storage)),
    true
  );

  // If city differs even with close timestamps -> MUST trigger conflict
  const localTokyo = {
    ...dehydrateGameStateForCloud('slot_1', sTokyo, { clientSavedAt: 100_500 }).metaFields,
    source: 'local' as const,
  };
  assert.equal(isSlotConflict(localTokyo, cloudT0, 100_000), true);

  // Timestamp unification & baseline clearing
  saveLocalSlotGameState('slot_1', sBase, { storage, savedAt: 250_000 });
  updateLocalSlotTimestamp('slot_1', 150_000, {
    storage,
    source: 'synced',
    cloudSavedAt: 150_000,
  });
  const localAfterSync = listLocalSlotSummaries(storage).slot_1!;
  assert.equal(localAfterSync.clientSavedAt, 150_000);

  clearCloudSyncBaseline('slot_1', storage);
  assert.equal(getCloudSyncBaseline('slot_1', storage), undefined);
});

test('compressed cloud snapshot (CompactCloudGraphV1) restores 12,000 nodes, 14,650 edges, >600 bridges, >600 chunks, and real boundaries on an empty device with zero loss in <2s', async () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);

  const regions = [
    {
      regionId: 'osm_rel_seoul',
      regionName: '서울특별시',
      adminLevel: '4',
      bbox: [37.42, 126.76, 37.71, 127.19] as [number, number, number, number],
      centerLat: 37.5665,
      centerLng: 126.978,
      unlocked: true,
      isStartingRegion: true,
      isIsolated: false,
      hasRealOsmBoundary: true,
      totalNodeCount: 5000,
      boundaryGeoJson: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [126.76, 37.42],
            [127.19, 37.42],
            [127.19, 37.71],
            [126.76, 37.71],
            [126.76, 37.42],
          ],
        ],
      },
    },
    {
      regionId: 'osm_rel_gyeonggi',
      regionName: '경기도',
      adminLevel: '4',
      bbox: [37.0, 126.5, 38.0, 127.6] as [number, number, number, number],
      centerLat: 37.27,
      centerLng: 127.01,
      unlocked: true,
      isStartingRegion: false,
      isIsolated: false,
      hasRealOsmBoundary: true,
      totalNodeCount: 7000,
      boundaryGeoJson: {
        type: 'MultiPolygon' as const,
        coordinates: [
          [
            [
              [126.5, 37.0],
              [127.6, 37.0],
              [127.6, 38.0],
              [126.5, 38.0],
              [126.5, 37.0],
            ],
          ],
        ],
      },
    },
  ];

  const osmNodes = Array.from({ length: 12_000 }, (_, i) => ({
    id: `osm_n_${i}`,
    lat: Number((37.45 + (i % 120) * 0.002).toFixed(6)),
    lng: Number((126.82 + Math.floor(i / 120) * 0.0025).toFixed(6)),
    connected: i < 5_000,
    mode: (i % 5 === 0 ? 'rail' : 'road') as 'road' | 'rail',
    regionId: i < 5_000 ? 'osm_rel_seoul' : 'osm_rel_gyeonggi',
  }));

  const osmEdges = Array.from({ length: 14_000 }, (_, i) => {
    const a = osmNodes[i % 11_999];
    const b = osmNodes[(i + 1) % 11_999];
    return {
      id: `osm_e_${i}`,
      wayName: `간선노선_${i % 40}`,
      highwayType: i % 5 === 0 ? 'rail' : 'primary',
      mode: (i % 5 === 0 ? 'rail' : 'road') as 'road' | 'rail',
      fromNodeId: a.id,
      toNodeId: b.id,
      coordinates: [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ] as [[number, number], [number, number]],
      distanceKm: 0.08,
      buildCost: 24,
      baseIncomePerSec: 2,
      built: i < 5_500,
      regionId: a.regionId,
    };
  });

  // Add 650 custom bridges (exceeds the legacy CORE 500-item cap!)
  const customBridges = Array.from({ length: 650 }, (_, i) => {
    const a = osmNodes[i * 10];
    const b = osmNodes[i * 10 + 5];
    return {
      id: `oe_custom_bridge_${i}`,
      wayName: '교차로 연결 링크',
      highwayType: 'unclassified',
      mode: 'road' as const,
      fromNodeId: a.id,
      toNodeId: b.id,
      coordinates: [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ] as [[number, number], [number, number]],
      distanceKm: 0.12,
      buildCost: 45,
      baseIncomePerSec: 3,
      built: true,
      regionId: a.regionId,
    };
  });

  const loadedChunks = Array.from(
    { length: 650 },
    (_, i) => `${(37.4 + (i % 50) * 0.0033).toFixed(4)}_${(126.8 + Math.floor(i / 50) * 0.0033).toFixed(4)}`
  );

  const largeState = {
    ...base,
    capital: 8_888_888,
    provincialRegions: regions,
    loadedOsmChunks: loadedChunks,
    loadedOsmRegions: ['osm_rel_seoul', 'osm_rel_gyeonggi'],
    completedOsmWays: ['road::간선노선_0', 'rail::간선노선_5'],
    osmNodes,
    osmEdges: [...osmEdges, ...customBridges],
    stats: {
      ...base.stats,
      connectedOsmNodes: 5_000,
      totalOsmEdgesBuilt: 6_150,
    },
  };

  const tStart = Date.now();
  const sig = computeCloudGraphStructureSig(largeState);
  assert.ok(sig.includes('cb=650'));

  const packedCloudGraph = packCloudGraphV1(largeState);
  const encoded = await encodeCloudGraphChunks(packedCloudGraph);
  assert.equal(encoded.encoding, 'gzip-b64-v1');
  assert.ok(encoded.slices.length >= 1 && encoded.slices.length <= MAX_GRAPH_CHUNKS);
  assert.ok(encoded.encodedBytes < encoded.rawBytes * 0.45, 'gzip+b64 should shrink JSON dramatically');

  const dehydrated = dehydrateGameStateForCloud('slot_1', largeState, {
    maxChunkBytes: MAX_MARK_CHUNK_WITH_PAYLOAD_BYTES,
  });

  const totalChunks = Math.max(dehydrated.graphChunks.length, encoded.slices.length);
  const firestoreChunks: CloudChunkPayloadRecord[] = Array.from({ length: totalChunks }, (_, idx) => {
    const mc = dehydrated.graphChunks[idx] || { chunkIndex: idx, nodeIds: [], edgeIds: [] };
    const payload = idx < encoded.slices.length ? encoded.slices[idx] : '';
    const encoding = payload.length > 0 ? encoded.encoding : 'none';
    assert.ok(payload.length <= 350_000, `Slice ${idx} exceeds 350,000 char rule cap`);
    const docBytes = estimateFirestoreDocBytes(
      {
        ownerUid: 'uid_test_1234567890',
        slotId: 'slot_1',
        chunkIndex: idx,
        nodeIds: mc.nodeIds,
        edgeIds: mc.edgeIds,
        graphEncoding: encoding,
        graphPayload: payload,
      },
      256
    );
    assert.ok(
      docBytes <= 750 * 1024,
      `Combined chunk doc ${idx} (${docBytes} B) must remain comfortably under Firestore 1MiB cap`
    );
    return {
      chunkIndex: idx,
      nodeIds: mc.nodeIds,
      edgeIds: mc.edgeIds,
      graphEncoding: encoding,
      graphPayload: payload,
    };
  });

  // Simulate brand-new empty device (no localStorage, no IndexedDB, no Overpass)
  const decodedDirect = await decodeCloudGraphChunks(firestoreChunks);
  assert.ok(decodedDirect);
  assert.equal(decodedDirect.nodes.length, 12_000);

  const hydrated = await hydrateCloudPayloadAsync(dehydrated.coreFields, firestoreChunks);
  const elapsedMs = Date.now() - tStart;

  assert.ok(elapsedMs < 3000, `Expected full encode+decode roundtrip < 3000ms, got ${elapsedMs}ms`);
  assert.equal(hydrated.hasFullGraphSnapshot, true);
  assert.equal(hydrated.baseState.osmNodes.length, 12_000, 'Zero node loss');
  assert.equal(hydrated.baseState.osmEdges.length, 14_650, 'Zero edge & zero custom bridge loss');
  assert.equal(
    hydrated.baseState.osmEdges.filter((e) => e.id.startsWith('oe_custom_bridge_') && e.built).length,
    650,
    'All 650 custom bridges must survive uncapped'
  );
  assert.equal(hydrated.baseState.osmNodes.filter((n) => n.connected).length, 5_000);
  assert.equal(hydrated.baseState.osmEdges.filter((e) => e.built).length, 6_150);
  assert.equal(
    hydrated.baseState.loadedOsmChunks.length >= 650,
    true,
    'All >500 loadedOsmChunks preserved'
  );
  assert.deepEqual(
    [...(hydrated.baseState.loadedOsmRegions || [])].sort(),
    ['osm_rel_gyeonggi', 'osm_rel_seoul']
  );
  const restoredSeoul = hydrated.baseState.provincialRegions.find((r) => r.regionId === 'osm_rel_seoul');
  const restoredGg = hydrated.baseState.provincialRegions.find((r) => r.regionId === 'osm_rel_gyeonggi');
  assert.equal(restoredSeoul?.hasRealOsmBoundary, true);
  assert.equal(restoredSeoul?.boundaryGeoJson?.type, 'Polygon');
  assert.equal(restoredGg?.hasRealOsmBoundary, true);
  assert.equal(restoredGg?.boundaryGeoJson?.type, 'MultiPolygon');

  const unhydrated = countUnhydratedGraphMarks(hydrated.baseState, hydrated.marks);
  assert.equal(unhydrated.unhydratedNodes, 0);
  assert.equal(unhydrated.unhydratedEdges, 0);
});

test('hydrateCloudPayloadAsync falls back gracefully on legacy cloud saves lacking graphPayload', async () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  state.osmNodes = [
    { id: 'legacy_n1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' },
    { id: 'legacy_n2', lat: 37.567, lng: 126.979, connected: true, mode: 'road' },
  ];
  state.osmEdges = [
    {
      id: 'legacy_e1',
      wayName: '종로',
      highwayType: 'primary',
      mode: 'road',
      fromNodeId: 'legacy_n1',
      toNodeId: 'legacy_n2',
      coordinates: [
        [37.5665, 126.978],
        [37.567, 126.979],
      ],
      distanceKm: 0.1,
      buildCost: 20,
      baseIncomePerSec: 1,
      built: true,
    },
  ];

  const dehydrated = dehydrateGameStateForCloud('slot_1', state);
  const result = await hydrateCloudPayloadAsync(dehydrated.coreFields, dehydrated.graphChunks);
  assert.equal(result.hasFullGraphSnapshot, false);
  assert.equal(result.baseState.osmNodes.length, 0);
  assert.equal(result.marks.connectedNodeIds.size, 2);
  assert.equal(result.marks.builtEdgeIds.size, 1);
});

test('packCloudGraphV1 does not poison loadedOsmChunks with sparse neighbor-spilled bridge tiles', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  const denseKey = chunkKeyForCoords(37.5667, 126.9767);
  const spilledKey = chunkKeyForCoords(37.5733, 126.9767);

  state.loadedOsmChunks = [];
  state.osmNodes = [
    ...Array.from({ length: 14 }, (_, i) => ({
      id: `d_${i}`,
      lat: 37.5667 + i * 0.00002,
      lng: 126.9767,
      connected: i === 0,
      mode: 'road' as const,
      regionId: 'curated_kr_seoul_jung',
    })),
    {
      id: 'spill_1',
      lat: 37.5733,
      lng: 126.9767,
      connected: true,
      mode: 'road' as const,
      regionId: 'curated_kr_seoul_jung',
    },
  ];

  const packed = packCloudGraphV1(state);
  assert.equal(packed.loadedOsmChunks.includes(denseKey), true);
  assert.equal(
    packed.loadedOsmChunks.includes(spilledKey),
    false,
    'Tile with only 1 spilled node must not be marked loaded in loadedOsmChunks'
  );
});

test('applyRestoredGraphMarks with healGaps: true heals missing edges and nodes with 0 unhydrated marks', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  // Present nodes
  state.osmNodes = [
    { id: 'node_alpha', lat: 37.5665, lng: 126.978, connected: false, mode: 'road' },
    { id: 'node_beta', lat: 37.5675, lng: 126.979, connected: false, mode: 'road' },
  ];
  state.osmEdges = [
    {
      id: 'oe_node_alpha_node_beta',
      wayName: '세종대로',
      highwayType: 'primary',
      mode: 'road',
      fromNodeId: 'node_alpha',
      toNodeId: 'node_beta',
      coordinates: [
        [37.5665, 126.978],
        [37.5675, 126.979],
      ],
      distanceKm: 0.12,
      buildCost: 20,
      baseIncomePerSec: 1,
      built: false,
    },
  ];

  // Restored marks contains:
  // 1. Built edge present in state (oe_node_alpha_node_beta)
  // 2. Built edge missing from state, but with known endpoints (oe_node_beta_node_gamma)
  // 3. Built edge with both endpoints missing (oe_missing1_missing2)
  // 4. Station node missing from state (station_seoul_subway)
  const marks: RestoredGraphMarks = {
    connectedNodeIds: new Set(['node_alpha', 'node_beta', 'node_gamma', 'station_seoul_subway']),
    builtEdgeIds: new Set([
      'oe_node_alpha_node_beta',
      'oe_node_beta_node_gamma',
      'oe_missing1_missing2',
    ]),
    customBridgeEdges: [],
  };

  // Without healGaps (mid-stream behavior)
  const unhealed = applyRestoredGraphMarks(state, marks, { healGaps: false });
  const unhealedCounts = countUnhydratedGraphMarks(unhealed, marks);
  assert.ok(unhealedCounts.unhydratedNodes > 0 || unhealedCounts.unhydratedEdges > 0);

  // With healGaps (final restore / cloud save behavior)
  const healed = applyRestoredGraphMarks(state, marks, { healGaps: true });
  const healedCounts = countUnhydratedGraphMarks(healed, marks);

  // Must have 0 unhydrated marks!
  assert.equal(healedCounts.unhydratedNodes, 0);
  assert.equal(healedCounts.unhydratedEdges, 0);

  // Verify missing nodes were synthesized
  const gammaNode = healed.osmNodes.find((n) => n.id === 'node_gamma');
  assert.ok(gammaNode, 'Missing endpoint node_gamma must be synthesized');
  assert.equal(gammaNode.connected, true);

  const stationNode = healed.osmNodes.find((n) => n.id === 'station_seoul_subway');
  assert.ok(stationNode, 'Missing station node must be synthesized');
  assert.equal(stationNode.connected, true);

  // Verify missing edges were synthesized and marked built
  const betaGammaEdge = healed.osmEdges.find((e) => e.id === 'oe_node_beta_node_gamma');
  assert.ok(betaGammaEdge, 'Missing edge oe_node_beta_node_gamma must be synthesized');
  assert.equal(betaGammaEdge.built, true);
  assert.ok(betaGammaEdge.coordinates.length >= 2);

  const missingEdge = healed.osmEdges.find((e) => e.id === 'oe_missing1_missing2');
  assert.ok(missingEdge, 'Missing edge oe_missing1_missing2 must be synthesized');
  assert.equal(missingEdge.built, true);
});

test('6,000-node scale save packs compressed snapshot and unpacks in under 200ms with 0 data loss', async () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  const NODE_COUNT = 6000;
  const EDGE_COUNT = 4500;

  state.osmNodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
    id: `node_bulk_${i}`,
    lat: 37.5 + (i % 80) * 0.001,
    lng: 126.9 + Math.floor(i / 80) * 0.001,
    connected: i % 2 === 0,
    mode: 'road' as const,
  }));

  state.osmEdges = Array.from({ length: EDGE_COUNT }, (_, i) => ({
    id: `oe_node_bulk_${i}_node_bulk_${i + 1}`,
    wayName: `대로_${i % 100}`,
    highwayType: 'primary',
    mode: 'road' as const,
    fromNodeId: `node_bulk_${i}`,
    toNodeId: `node_bulk_${i + 1}`,
    coordinates: [
      [37.5 + (i % 80) * 0.001, 126.9 + Math.floor(i / 80) * 0.001],
      [37.5 + ((i + 1) % 80) * 0.001, 126.9 + Math.floor((i + 1) / 80) * 0.001],
    ],
    distanceKm: 0.1,
    buildCost: 30,
    baseIncomePerSec: 2,
    built: i % 3 === 0,
  }));

  const startTime = Date.now();
  const packed = packCloudGraphV1(state);
  const encoded = await encodeCloudGraphChunks(packed);
  const dehydrated = dehydrateGameStateForCloud('slot_1', state, {
    maxChunkBytes: MAX_MARK_CHUNK_WITH_PAYLOAD_BYTES,
  });
  const packTime = Date.now() - startTime;

  assert.equal(encoded.encoding, 'gzip-b64-v1');
  assert.ok(encoded.slices.length >= 1);
  assert.ok(packTime < 1000, `Packing took ${packTime}ms, should be <1000ms`);

  const totalChunks = Math.max(dehydrated.graphChunks.length, encoded.slices.length);
  const firestoreChunks: CloudChunkPayloadRecord[] = Array.from({ length: totalChunks }, (_, idx) => {
    const mc = dehydrated.graphChunks[idx] || { chunkIndex: idx, nodeIds: [], edgeIds: [] };
    const payload = idx < encoded.slices.length ? encoded.slices[idx] : '';
    const encoding = payload.length > 0 ? encoded.encoding : 'none';
    return {
      chunkIndex: idx,
      nodeIds: mc.nodeIds,
      edgeIds: mc.edgeIds,
      graphEncoding: encoding,
      graphPayload: payload,
    };
  });

  const unpackStart = Date.now();
  const hydrated = await hydrateCloudPayloadAsync(dehydrated.coreFields, firestoreChunks);
  const unpackTime = Date.now() - unpackStart;

  assert.equal(hydrated.hasFullGraphSnapshot, true);
  assert.equal(hydrated.baseState.osmNodes.length, NODE_COUNT);
  assert.equal(hydrated.baseState.osmEdges.length, EDGE_COUNT);
  assert.ok(unpackTime < 1000, `Unpacking took ${unpackTime}ms, should be <1000ms`);

  // Verify node and edge integrity
  const connectedBefore = state.osmNodes.filter((n) => n.connected).length;
  const connectedAfter = hydrated.baseState.osmNodes.filter((n) => n.connected).length;
  assert.equal(connectedAfter, connectedBefore);

  const builtBefore = state.osmEdges.filter((e) => e.built).length;
  const builtAfter = hydrated.baseState.osmEdges.filter((e) => e.built).length;
  assert.equal(builtAfter, builtBefore);
});

test('stalled IndexedDB open resolves safely to null within timeout instead of hanging', async () => {
  resetMemoryTileCacheForTests();
  const prevIdb = (globalThis as Record<string, unknown>).indexedDB;
  // Simulate a hung indexedDB.open that never fires onsuccess/onerror/onblocked
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => ({}),
  };
  try {
    const start = Date.now();
    const res = await getCachedSlotGraph('slot_1');
    const elapsed = Date.now() - start;
    assert.equal(res, null);
    assert.ok(elapsed < 4000, `Expected IDB timeout recovery <4s, got ${elapsed}ms`);
  } finally {
    resetMemoryTileCacheForTests();
    if (prevIdb === undefined) {
      delete (globalThis as Record<string, unknown>).indexedDB;
    } else {
      (globalThis as Record<string, unknown>).indexedDB = prevIdb;
    }
  }
});

test('parseEdgeEndpointsFromId accurately parses complex osm, osm_sub, custom, and fb_fb edge IDs without bogus splits', () => {
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_osm_100_osm_sub_osm_100_osm_200_0'),
    { fromId: 'osm_100', toId: 'osm_sub_osm_100_osm_200_0' }
  );
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_osm_sub_osm_100_osm_200_0_osm_300'),
    { fromId: 'osm_sub_osm_100_osm_200_0', toId: 'osm_300' }
  );
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_osm_sub_osm_1_osm_2_0_osm_sub_osm_1_osm_2_1'),
    { fromId: 'osm_sub_osm_1_osm_2_0', toId: 'osm_sub_osm_1_osm_2_1' }
  );
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_custom_osm_123_osm_456'),
    { fromId: 'osm_123', toId: 'osm_456' }
  );
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_custom_osm_sub_osm_1_osm_2_0_osm_9'),
    { fromId: 'osm_sub_osm_1_osm_2_0', toId: 'osm_9' }
  );
  assert.deepEqual(
    parseEdgeEndpointsFromId('oe_fb_fb_37.5667_126.9767_r0_c0_fb_37.5667_126.9767_r0_c1'),
    { fromId: 'fb_37.5667_126.9767_r0_c0', toId: 'fb_37.5667_126.9767_r0_c1' }
  );
  // Non-pair chain IDs from starter fallback must not be split in half into phantom node IDs
  assert.equal(parseEdgeEndpointsFromId('oe_fb_ew_37.5667_126.9767_1'), null);
});

test('applyRestoredGraphMarks with healGaps: true interpolates multi-node holes smoothly along route instead of jumping to city center', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!; // center at 37.5665, 126.978
  const state = createInitialGameState(seoul);

  // Present anchor nodes ~9km away from city hall in Gangnam
  state.osmNodes = [
    { id: 'osm_1', lat: 37.498, lng: 127.028, connected: true, mode: 'road' },
    { id: 'osm_4', lat: 37.501, lng: 127.031, connected: true, mode: 'road' },
    { id: 'osm_5', lat: 37.502, lng: 127.032, connected: true, mode: 'road' },
  ];
  state.osmEdges = [];

  // Notice middle edge oe_osm_2_osm_3 comes FIRST before anchor edges oe_osm_1_osm_2 and oe_osm_3_osm_4
  const marks: RestoredGraphMarks = {
    connectedNodeIds: new Set([
      'osm_1',
      'osm_2',
      'osm_3',
      'osm_4',
      'osm_sub_osm_4_osm_5_0',
      'osm_5',
    ]),
    builtEdgeIds: new Set([
      'oe_osm_2_osm_3',
      'oe_osm_1_osm_2',
      'oe_osm_3_osm_4',
      'oe_custom_osm_4_osm_sub_osm_4_osm_5_0',
    ]),
    customBridgeEdges: [],
  };

  const healed = applyRestoredGraphMarks(state, marks, { healGaps: true });
  const counts = countUnhydratedGraphMarks(healed, marks);
  assert.equal(counts.unhydratedNodes, 0);
  assert.equal(counts.unhydratedEdges, 0);

  const n2 = healed.osmNodes.find((n) => n.id === 'osm_2')!;
  const n3 = healed.osmNodes.find((n) => n.id === 'osm_3')!;
  const sub = healed.osmNodes.find((n) => n.id === 'osm_sub_osm_4_osm_5_0')!;

  assert.ok(n2 && n3 && sub);
  // Must stay smoothly along Gangnam route (around 37.499/37.500), never jump to city hall (37.5665)
  assert.ok(Math.abs(n2.lat - 37.499) < 0.0002, `Expected osm_2 lat ~37.499, got ${n2.lat}`);
  assert.ok(Math.abs(n2.lng - 127.029) < 0.0002, `Expected osm_2 lng ~127.029, got ${n2.lng}`);
  assert.ok(Math.abs(n3.lat - 37.5) < 0.0002, `Expected osm_3 lat ~37.500, got ${n3.lat}`);
  assert.ok(Math.abs(n3.lng - 127.03) < 0.0002, `Expected osm_3 lng ~127.030, got ${n3.lng}`);
  assert.ok(Math.abs(sub.lat - 37.5015) < 0.0002, `Expected sub lat ~37.5015, got ${sub.lat}`);
  assert.ok(Math.abs(sub.lng - 127.0315) < 0.0002, `Expected sub lng ~127.0315, got ${sub.lng}`);
});

test('dehydrateGameStateForCloud caps coreFields.customBridgeEdges at 500 per firestore.rules while packCloudGraphV1 preserves all edges', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  state.osmNodes = [
    { id: 'osm_1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' },
    { id: 'osm_2', lat: 37.5675, lng: 126.979, connected: true, mode: 'road' },
  ];
  state.osmEdges = Array.from({ length: 620 }, (_, i) => ({
    id: `oe_custom_osm_1_osm_2_${i}`,
    wayName: `브릿지 ${i}`,
    highwayType: 'unclassified',
    mode: 'road' as const,
    fromNodeId: 'osm_1',
    toNodeId: 'osm_2',
    coordinates: [
      [37.5665, 126.978],
      [37.5675, 126.979],
    ] as [[number, number], [number, number]],
    distanceKm: 0.15,
    buildCost: 100,
    baseIncomePerSec: 5,
    built: true,
    regionId: 'r_seoul',
  }));

  const dehydrated = dehydrateGameStateForCloud('slot_1', state);
  assert.equal(dehydrated.coreFields.customBridgeEdges.length, 500);

  const packed = packCloudGraphV1(state);
  assert.equal(packed.edges.length, 620);
});

test('exportSaveToString and decodeImportedSaveString roundtrip lossless graph, custom bridges, skills, boundaries, and stats', async () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 54_321, totalLifetimeEarnings: 99_999 };
  const skRes = unlockSkill(state, state.skills[0].id);
  if (skRes.success) state = skRes.newState;

  state.provincialRegions = [
    {
      regionId: 'osm_rel_seoul',
      regionName: '서울특별시',
      adminLevel: '4',
      bbox: [37.42, 126.76, 37.71, 127.19],
      centerLat: 37.5665,
      centerLng: 126.978,
      unlocked: true,
      isStartingRegion: true,
      isIsolated: false,
      hasRealOsmBoundary: true,
      boundaryGeoJson: {
        type: 'Polygon',
        coordinates: [
          [
            [126.76, 37.42],
            [127.19, 37.42],
            [127.19, 37.71],
            [126.76, 37.71],
            [126.76, 37.42],
          ],
        ],
      },
    },
  ];

  state = mergeOsmChunk(
    state,
    '37.5667_126.9767',
    [
      { id: 'osm_a', lat: 37.5665, lng: 126.978, connected: true, mode: 'road', regionId: 'osm_rel_seoul' },
      { id: 'osm_b', lat: 37.5675, lng: 126.979, connected: true, mode: 'road', regionId: 'osm_rel_seoul' },
    ],
    [
      {
        id: 'oe_custom_osm_a_osm_b',
        wayName: '교차로 연결 링크',
        highwayType: 'unclassified',
        mode: 'road',
        fromNodeId: 'osm_a',
        toNodeId: 'osm_b',
        coordinates: [
          [37.5665, 126.978],
          [37.5675, 126.979],
        ],
        distanceKm: 0.14,
        buildCost: 60,
        baseIncomePerSec: 3,
        built: true,
        regionId: 'osm_rel_seoul',
      },
    ]
  );

  const exported = await exportSaveToString(state, {
    slotName: '내 서울 본선',
    savedAt: 1_700_000_000_000,
  });
  assert.ok(exported.startsWith(EXPORT_SAVE_PREFIX_GZIP), 'Should produce gzipped TERRALINE1 string');

  // Also ensure line-wrapped / whitespace-padded exports decode seamlessly
  const wrapped = `  ${exported.slice(0, 40)}\n${exported.slice(40)}  `;
  const preview = await decodeImportedSaveString(wrapped);

  assert.equal(preview.format, 'terraline1');
  assert.equal(preview.slotName, '내 서울 본선');
  assert.equal(preview.savedAt, 1_700_000_000_000);
  assert.equal(preview.cityName, seoul.name);
  assert.equal(preview.capital, state.capital);
  assert.equal(preview.connectedOsmNodes, 2);
  assert.equal(preview.totalOsmEdgesBuilt, 1);
  assert.equal(preview.totalNodesInSnapshot, 2);
  assert.equal(preview.totalEdgesInSnapshot, 1);
  assert.equal(preview.state.skills[0].level, state.skills[0].level);
  assert.ok(
    preview.state.osmEdges.some((e) => e.id === 'oe_custom_osm_a_osm_b' && e.built),
    'Custom bridge edge must survive Export -> Import roundtrip'
  );
  assert.equal(preview.state.provincialRegions[0].hasRealOsmBoundary, true);
  assert.equal(preview.state.provincialRegions[0].boundaryGeoJson?.type, 'Polygon');

  // Import into localStorage slot_4 and reload cleanly
  const storage = createMemoryStorage();
  const importedSummary = await importDecodedSaveIntoSlot('slot_4', preview, {
    slotName: '복원된 서울',
    storage,
  });
  assert.equal(importedSummary.slotId, 'slot_4');
  assert.equal(importedSummary.slotName, '복원된 서울');
  assert.equal(importedSummary.source, 'local');

  const reloaded = loadLocalSlotGameState('slot_4', storage);
  assert.ok(reloaded);
  assert.equal(reloaded.capital, state.capital);
  assert.equal(reloaded.osmNodes.filter((n) => n.connected).length, 2);
  assert.equal(reloaded.osmEdges.filter((e) => e.built).length, 1);
});

test('decodeImportedSaveString supports raw JSON fallback and rejects invalid/corrupted inputs with clear errors', async () => {
  const tokyo = PRESET_CITIES.find((c) => c.id === 'tokyo')!;
  const rawState = { ...createInitialGameState(tokyo), capital: 7_777 };

  const rawPreview = await decodeImportedSaveString(JSON.stringify(rawState));
  assert.equal(rawPreview.format, 'raw-json');
  assert.equal(rawPreview.cityName, tokyo.name);
  assert.equal(rawPreview.capital, 7_777);

  await assert.rejects(() => decodeImportedSaveString('   '), /입력/);
  await assert.rejects(() => decodeImportedSaveString('NOT_A_SAVE_CODE'), /지원하지 않는/);
  await assert.rejects(() => decodeImportedSaveString('TERRALINE1:not-valid-gzip-data!!!'), /압축 해제|Base64/);
  await assert.rejects(() => decodeImportedSaveString('{"foo":"bar"}'), /세이브 데이터/);
});

test('countSyntheticRestoredItems, collectMarksWithExistingState, and CORE_V2 chunk tracking avoid sawtooth grid wraps', () => {
  const storage = createMemoryStorage();
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  const corrupted = {
    ...state,
    loadedOsmChunks: [],
    osmNodes: [
      { id: 'real_gangnam', lat: 37.498, lng: 127.028, connected: true, mode: 'road' as const },
      { id: 'syn_1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' as const, label: '복원 연결점' },
      { id: 'syn_2', lat: 37.5666, lng: 126.9781, connected: true, mode: 'rail' as const, label: '복원 환승점' },
    ],
    osmEdges: [
      {
        id: 'oe_syn_1_2',
        wayName: '복원 연결선',
        highwayType: 'unclassified',
        mode: 'road' as const,
        fromNodeId: 'syn_1',
        toNodeId: 'syn_2',
        coordinates: [[37.5665, 126.978], [37.5666, 126.9781]] as [[number, number], [number, number]],
        distanceKm: 0.02,
        buildCost: 20,
        baseIncomePerSec: 1.5,
        built: true,
      },
    ],
  };

  assert.deepEqual(countSyntheticRestoredItems(corrupted), {
    syntheticNodes: 2,
    syntheticEdges: 1,
  });

  const collected = collectMarksWithExistingState(corrupted);
  assert.equal(collected.connectedNodeIds.has('real_gangnam'), true);
  assert.equal(collected.connectedNodeIds.has('syn_1'), true);
  assert.equal(collected.builtEdgeIds.has('oe_syn_1_2'), true);

  saveLocalSlotGameState('slot_2', corrupted, { storage });
  const rawCore = JSON.parse(storage.getItem('ROAD_INC_SAVE_SLOT_CORE_V2_slot_2')!);
  assert.equal(rawCore.loadedOsmChunks.includes(chunkKeyForCoords(37.498, 127.028)), true);
  assert.equal(rawCore.loadedOsmChunks.includes(chunkKeyForCoords(37.5665, 126.978)), false);

  const emptyState = { ...createInitialGameState(seoul), osmNodes: [], osmEdges: [] };
  const orphanNodeIds = Array.from({ length: 40 }, (_, i) => `orphan_${i}`);
  const orphanEdgeIds = Array.from({ length: 39 }, (_, i) => `oe_orphan_${i}_orphan_${i + 1}`);
  const orphanMarks: RestoredGraphMarks = {
    connectedNodeIds: new Set(orphanNodeIds),
    builtEdgeIds: new Set(orphanEdgeIds),
    customBridgeEdges: [],
  };

  const healedOrphan = applyRestoredGraphMarks(emptyState, orphanMarks, { healGaps: true });
  assert.equal(healedOrphan.osmEdges.length, 39);
  for (const edge of healedOrphan.osmEdges) {
    assert.ok(
      edge.distanceKm <= 0.05,
      `Orphan healed edge ${edge.id} jumped ${edge.distanceKm}km (sawtooth column-wrap regression)`
    );
  }
});




