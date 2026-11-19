import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameState, mergeOsmChunk, unlockSkill } from './rules';
import {
  applyRestoredGraphMarks,
  dehydrateGameStateForCloud,
  deleteLocalSlotGameState,
  getActiveSlotId,
  LEGACY_SAVE_KEY,
  listLocalSlotSummaries,
  loadLocalSlotGameState,
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
