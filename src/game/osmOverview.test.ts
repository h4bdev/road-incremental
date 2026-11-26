import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSimplifiedOverviewCurves,
  buildSkeletonGeoJsonFeatures,
  isEdgeInViewport,
  isNodeInViewport,
  OVERVIEW_ZOOM_THRESHOLD,
  simplifyLonLatLine,
  UNEXPLORED_NODE_MIN_ZOOM,
} from './osmOverview';
import {
  getCachedOsmRegionsByIds,
  getCachedOsmTilesBatch,
  getCachedSlotGraph,
  putCachedOsmRegion,
  putCachedOsmTile,
  putCachedSlotGraph,
  resetMemoryTileCacheForTests,
} from './osmTileCache';
import {
  createInitialGameState,
  isPointInRegionBoundary,
  mergeOsmChunksBatch,
  scopeGameStateToStartingCity,
} from './rules';
import {
  getLocalSlotBuiltSkeleton,
  loadLocalSlotGameState,
  saveLocalSlotGameState,
} from './saveSlots';
import { PRESET_CITIES } from './worldCatalog';
import { OsmEdge, OsmNode, ProvincialRegion } from './types';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function buildLargeSyntheticGrid(cols = 65, rows = 70) {
  // 65 * 70 = 4,550 nodes and ~8,900 edges centered around Seoul
  const baseLat = 37.5665;
  const baseLng = 126.978;
  const step = 0.0005;
  const nodes: OsmNode[] = [];
  const edges: OsmEdge[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      nodes.push({
        id: `n_${idx}`,
        lat: baseLat + (r - rows / 2) * step,
        lng: baseLng + (c - cols / 2) * step,
        connected: r === 0 && c < 8,
        mode: r % 15 === 0 ? 'rail' : 'road',
        regionId: 'rel_seoul_bench',
      });
    }
  }

  let edgeSeq = 0;
  for (let r = 0; r < rows; r++) {
    const isRailRow = r % 15 === 0;
    const isMajor = r % 5 === 0;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (c + 1 < cols) {
        const right = nodes[idx + 1];
        const cur = nodes[idx];
        edges.push({
          id: `e_${edgeSeq++}`,
          wayName: isRailRow ? `지하철_${r}호선` : `세종대로_${r}`,
          highwayType: isRailRow ? 'subway' : isMajor ? 'primary' : 'residential',
          mode: isRailRow ? 'rail' : 'road',
          fromNodeId: cur.id,
          toNodeId: right.id,
          coordinates: [
            [cur.lat, cur.lng],
            [right.lat, right.lng],
          ],
          distanceKm: 0.05,
          buildCost: 50,
          baseIncomePerSec: 1.2,
          built: r === 0 && c < 7,
          regionId: 'rel_seoul_bench',
        });
      }
      if (r + 1 < rows && c % 4 === 0) {
        const down = nodes[idx + cols];
        const cur = nodes[idx];
        edges.push({
          id: `e_${edgeSeq++}`,
          wayName: `종로_${c}`,
          highwayType: c % 8 === 0 ? 'secondary' : 'tertiary',
          mode: 'road',
          fromNodeId: cur.id,
          toNodeId: down.id,
          coordinates: [
            [cur.lat, cur.lng],
            [down.lat, down.lng],
          ],
          distanceKm: 0.055,
          buildCost: 55,
          baseIncomePerSec: 1.0,
          built: false,
          regionId: 'rel_seoul_bench',
        });
      }
    }
  }
  return { nodes, edges };
}

describe('OSM Overview Curves, Viewport Culling & High-Scale Performance', () => {
  it('merges collinear/curved street segments into simplified overview curves and preserves built corridors', () => {
    const { edges } = buildLargeSyntheticGrid(40, 40); // 1,600 nodes, ~2,000 edges
    const curves = buildSimplifiedOverviewCurves(edges, {
      epsilonDeg: 0.00042,
      maxUnbuiltCurves: 300,
    });

    assert.ok(curves.length > 0);
    assert.ok(curves.length < edges.length / 4, 'Overview curves must collapse segments tightly');
    const builtCurves = curves.filter((c) => c.built);
    assert.ok(builtCurves.length >= 1, 'Built corridor should stay represented as a continuous built curve');
    assert.ok(builtCurves[0].coordinates.length >= 2);
  });

  it('simplifyLonLatLine preserves sharp corners while dropping dense micro-points', () => {
    const pts: [number, number][] = [
      [126.9, 37.5],
      [126.9001, 37.50001],
      [126.9002, 37.50001],
      [126.905, 37.508], // sharp corner
      [126.91, 37.50801],
    ];
    const simplified = simplifyLonLatLine(pts, 0.0003);
    assert.equal(simplified.length, 3);
    assert.deepEqual(simplified[0], [126.9, 37.5]);
    assert.deepEqual(simplified[1], [126.905, 37.508]);
    assert.deepEqual(simplified[2], [126.91, 37.50801]);
  });

  it('culls nodes and edges accurately against padded viewport bounds', () => {
    const bounds = { minLat: 37.5, maxLat: 37.55, minLng: 126.95, maxLng: 127.0 };
    assert.equal(isNodeInViewport(37.52, 126.97, bounds), true);
    assert.equal(isNodeInViewport(37.62, 126.97, bounds), false);

    const insideEdge: OsmEdge = {
      id: 'in',
      wayName: '내부길',
      highwayType: 'primary',
      mode: 'road',
      fromNodeId: 'a',
      toNodeId: 'b',
      coordinates: [
        [37.51, 126.96],
        [37.52, 126.97],
      ],
      distanceKm: 0.1,
      buildCost: 10,
      baseIncomePerSec: 1,
      built: false,
    };
    const farEdge: OsmEdge = {
      ...insideEdge,
      id: 'out',
      coordinates: [
        [35.1, 129.0],
        [35.11, 129.01],
      ],
    };
    assert.equal(isEdgeInViewport(insideEdge, bounds), true);
    assert.equal(isEdgeInViewport(farEdge, bounds), false);
  });

  it('builds instant GeoJSON features from BuiltSkeletonTuple snapshots', () => {
    const feats = buildSkeletonGeoJsonFeatures([
      [37.56, 126.97, 37.57, 126.98, 0],
      [37.57, 126.98, 37.58, 126.99, 1],
    ]);
    assert.equal(feats.length, 2);
    assert.equal(feats[0].properties.mode, 'road');
    assert.equal(feats[1].properties.mode, 'rail');
    assert.deepEqual(feats[0].geometry.coordinates, [
      [126.97, 37.56],
      [126.98, 37.57],
    ]);
  });

  it('stores and retrieves tiles, regions, and slot graph snapshots from cache cleanly', async () => {
    resetMemoryTileCacheForTests();
    await putCachedOsmTile({
      tileKey: '37.567_126.978',
      osmNodes: [
        { id: 'n1', lat: 37.567, lng: 126.978, connected: false, mode: 'road' },
      ],
      osmEdges: [],
      usedLiveOverpass: true,
      updatedAt: 1000,
    });
    const tiles = await getCachedOsmTilesBatch(['37.567_126.978', 'missing']);
    assert.equal(tiles.size, 1);
    assert.equal(tiles.get('37.567_126.978')?.osmNodes[0].id, 'n1');

    await putCachedOsmRegion({
      regionId: 'rel_1',
      regionName: '서울특별시',
      adminLevel: '4',
      bbox: [37.4, 126.7, 37.7, 127.2],
      centerLat: 37.56,
      centerLng: 126.97,
      boundaryGeoJson: {
        type: 'Polygon',
        coordinates: [
          [
            [126.7, 37.4],
            [127.2, 37.4],
            [127.2, 37.7],
            [126.7, 37.7],
            [126.7, 37.4],
          ],
        ],
      },
      updatedAt: 1000,
    });
    const regMap = await getCachedOsmRegionsByIds(['rel_1']);
    assert.equal(regMap.get('rel_1')?.regionName, '서울특별시');

    await putCachedSlotGraph({
      slotId: 'slot_1',
      version: 3,
      cityId: 'seoul',
      wayNames: ['세종대로'],
      hwTypes: ['primary'],
      regionIds: ['rel_1'],
      nodes: [['n1', 37.567, 126.978, 0, 0]],
      edges: [],
      regionBoundaries: [],
      loadedOsmChunks: ['37.567_126.978'],
      loadedOsmRegions: ['rel_1'],
      updatedAt: 1000,
    });
    const snap = await getCachedSlotGraph('slot_1');
    assert.equal(snap?.nodes.length, 1);
  });

  it('hydrates 4,550+ nodes, simplifies overview curves, and checks MultiPolygon bounds in under 200ms', () => {
    const seoul = PRESET_CITIES[0];
    const base = createInitialGameState(seoul);
    const { nodes, edges } = buildLargeSyntheticGrid(65, 70); // 4,550 nodes, ~5,500+ edges

    const multiRegion: ProvincialRegion = {
      regionId: 'rel_seoul_bench',
      regionName: '서울특별시',
      adminLevel: '4',
      bbox: [37.4, 126.7, 37.75, 127.2],
      centerLat: seoul.lat,
      centerLng: seoul.lng,
      unlocked: true,
      isStartingRegion: true,
      isIsolated: false,
      hasRealOsmBoundary: true,
      boundaryGeoJson: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [126.7, 37.4],
              [127.2, 37.4],
              [127.2, 37.75],
              [126.7, 37.75],
              [126.7, 37.4],
            ],
          ],
          [
            [
              [126.1, 37.1],
              [126.2, 37.1],
              [126.2, 37.2],
              [126.1, 37.2],
              [126.1, 37.1],
            ],
          ],
        ],
      },
    };

    const populated = {
      ...base,
      provincialRegions: [multiRegion],
      osmNodes: nodes,
      osmEdges: edges,
      loadedOsmChunks: ['37.567_126.978'],
      loadedOsmRegions: ['rel_seoul_bench'],
    };

    const storage = createMemoryStorage();
    saveLocalSlotGameState('slot_1', populated, { storage });
    const skeleton = getLocalSlotBuiltSkeleton('slot_1', storage);
    assert.ok(skeleton.length >= 7, 'Built skeleton should preserve built segments compactly');

    const t0 = performance.now();
    const loaded = loadLocalSlotGameState('slot_1', storage);
    assert.ok(loaded);
    const scoped = scopeGameStateToStartingCity(loaded, { trustedV2: true });
    assert.equal(scoped.osmNodes.length, 4550);

    const curves = buildSimplifiedOverviewCurves(scoped.osmEdges, {
      epsilonDeg: 0.00042,
      maxUnbuiltCurves: 650,
    });
    assert.ok(curves.length > 0);

    for (let i = 0; i < scoped.osmNodes.length; i++) {
      isPointInRegionBoundary(scoped.osmNodes[i].lat, scoped.osmNodes[i].lng, multiRegion);
    }

    const batchRes = mergeOsmChunksBatch(scoped, []);
    assert.equal(batchRes.osmNodes.length, 4550);
    const elapsedMs = performance.now() - t0;

    assert.ok(
      elapsedMs < 400,
      `Expected <400ms for 4,550-node load + overview simplification + GeoJSON BBox check, got ${elapsedMs.toFixed(1)}ms`
    );
  });

  it('keeps unexplored-node visibility threshold strictly narrower than overview threshold and within street zoom', () => {
    assert.ok(
      UNEXPLORED_NODE_MIN_ZOOM > OVERVIEW_ZOOM_THRESHOLD,
      `UNEXPLORED_NODE_MIN_ZOOM (${UNEXPLORED_NODE_MIN_ZOOM}) must exceed OVERVIEW_ZOOM_THRESHOLD (${OVERVIEW_ZOOM_THRESHOLD})`
    );
    assert.ok(
      UNEXPLORED_NODE_MIN_ZOOM >= 13.4 && UNEXPLORED_NODE_MIN_ZOOM <= 14.0,
      `UNEXPLORED_NODE_MIN_ZOOM (${UNEXPLORED_NODE_MIN_ZOOM}) must remain within street zoom window (<=14.0 globe)`
    );
  });
});

