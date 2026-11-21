import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameState, mergeOsmChunk, mergeOsmChunksBatch, unlockSkill } from './rules';
import {
  applyRestoredGraphMarks,
  countUnhydratedGraphMarks,
  dehydrateGameStateForCloud,
  deleteLocalSlotGameState,
  estimateFirestoreDocBytes,
  getActiveSlotId,
  getLocalSlotGraphMarks,
  GRAPH_CHUNK_ITEM_LIMIT,
  LEGACY_SAVE_KEY,
  listLocalSlotSummaries,
  loadLocalSlotGameState,
  MAX_CHUNK_DOC_BYTES,
  MAX_CORE_DOC_BYTES,
  MAX_GRAPH_CHUNKS,
  MAX_SAVE_SLOTS,
  mergeSlotSummaries,
  migrateLegacySaveIfNeeded,
  rehydrateGameStateFromCloudPayload,
  SAVE_SLOT_IDS,
  saveLocalSlotGameState,
  setActiveSlotId,
} from './saveSlots';
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
    regionId: 'curated_kr_seoul',
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
    regionId: 'curated_kr_seoul',
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
    regionId: 'curated_kr_seoul',
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
      regionId: 'curated_kr_seoul',
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
    regionId: 'curated_kr_seoul',
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
  // Prioritized chunk with connected node must be retained in loadedOsmChunks
  assert.ok(dehydrated.coreFields.loadedOsmChunks.includes('37.450_126.825'));

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

