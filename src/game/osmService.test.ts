import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNearbyProvincialRegions,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  fetchProvincialRegionInfo,
  resetBackendApiProbeForTests,
} from './osmService';
import { buildDenseRealOsmGraph, resolveOsmProvincialRegion } from './osmCore';

test('fetchOsmRoadChunk and fetchOsmProvincialRegion fall back when /api returns 404 (Vercel static deployment)', async () => {
  resetBackendApiProbeForTests();
  const originalFetch = globalThis.fetch;

  const sampleOsm06Response = {
    elements: [
      { type: 'node', id: 1, lat: 37.5665, lon: 126.978 },
      { type: 'node', id: 2, lat: 37.5668, lon: 126.9783 },
      {
        type: 'way',
        id: 101,
        nodes: [1, 2],
        tags: { highway: 'primary', name: '세종대로' },
      },
    ],
  };

  let hitApiCount = 0;
  let hitOsm06Count = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('/api/')) {
      hitApiCount++;
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.startsWith('https://api.openstreetmap.org/api/0.6/map.json')) {
      hitOsm06Count++;
      return new Response(JSON.stringify(sampleOsm06Response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Service Unavailable', { status: 503 });
  }) as typeof fetch;

  try {
    const chunk = await fetchOsmRoadChunk(37.5665, 126.978);
    assert.ok(hitApiCount >= 1, 'Should probe /api/ once');
    assert.ok(hitOsm06Count >= 1, 'Should fall back to direct OSM 0.6 API');
    assert.ok(chunk.osmNodes.length >= 2, 'Should produce OSM nodes');
    assert.ok(chunk.osmEdges.length >= 1, 'Should produce OSM edges');
    assert.equal(chunk.osmEdges[0].wayName, '세종대로');

    const prevApiCount = hitApiCount;
    const province = await fetchOsmProvincialRegion(37.5665, 126.978);
    assert.equal(
      hitApiCount,
      prevApiCount,
      'Should remember /api/ is unavailable on static host without repeating 404 probes'
    );
    assert.ok(province.osmNodes.length >= 2, 'Province fallback should also produce nodes');
    assert.ok(province.osmEdges.length >= 1, 'Province fallback should also produce edges');
  } finally {
    globalThis.fetch = originalFetch;
    resetBackendApiProbeForTests();
  }
});

test('fetchOsmRoadChunk falls back to starter grid when /api returns SPA HTML (200 text/html) and external OSM fails', async () => {
  resetBackendApiProbeForTests();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('/api/')) {
      return new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Rate limited', { status: 429 });
  }) as typeof fetch;

  try {
    // Use unique coordinates so live cache from previous test does not match
    const chunk = await fetchOsmRoadChunk(35.1796, 129.0756);
    assert.ok(chunk.osmNodes.length >= 25, 'Should return deterministic 5x5 starter grid nodes');
    assert.ok(chunk.osmEdges.length >= 40, 'Should return deterministic 5x5 starter grid edges');
    assert.equal(chunk.usedLiveOverpass, false);

    const province = await fetchOsmProvincialRegion(35.1796, 129.0756);
    assert.ok(province.osmNodes.length >= 25, 'Province should never return 0 nodes');
    assert.ok(province.osmEdges.length >= 40, 'Province should never return 0 edges');

    const regionInfo = await fetchProvincialRegionInfo(35.1796, 129.0756);
    assert.ok(regionInfo && regionInfo.regionId, 'Region info should return graceful fallback metadata');

    const nearby = await fetchNearbyProvincialRegions(35.1796, 129.0756);
    assert.ok(Array.isArray(nearby), 'Nearby provinces should return an array');
  } finally {
    globalThis.fetch = originalFetch;
    resetBackendApiProbeForTests();
  }
});

test('resolveOsmProvincialRegion stitches Overpass relation outer ways into GeoJSON boundary when Nominatim lookup returns 429', async () => {
  const { resolveOsmProvincialRegion, stitchOverpassWaysToGeoJson } = await import('./osmCore');

  const stitched = stitchOverpassWaysToGeoJson([
    {
      type: 'relation',
      id: 2297418,
      bounds: { minlat: 37.42, minlon: 126.76, maxlat: 37.71, maxlon: 127.19 },
      members: [
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 37.42, lon: 126.76 },
            { lat: 37.42, lon: 127.19 },
          ],
        },
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 37.71, lon: 126.76 },
            { lat: 37.71, lon: 127.19 },
            { lat: 37.42, lon: 127.19 },
          ],
        },
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 37.71, lon: 126.76 },
            { lat: 37.42, lon: 126.76 },
          ],
        },
      ],
    },
  ]);

  assert.equal(stitched.boundaryGeoJson?.type, 'Polygon');
  assert.ok(stitched.bbox && stitched.bbox[0] === 37.42);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('nominatim.openstreetmap.org')) {
      return new Response('Rate limited', { status: 429 });
    }
    if (url.includes('overpass')) {
      const bodyStr = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
      if (bodyStr.includes('is_in(')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'area',
                id: 3602297418,
                tags: { boundary: 'administrative', admin_level: '4', 'name:ko': '서울특별시' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (bodyStr.includes('relation(2297418)')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'relation',
                id: 2297418,
                bounds: { minlat: 37.42, minlon: 126.76, maxlat: 37.71, maxlon: 127.19 },
                members: [
                  {
                    type: 'way',
                    role: 'outer',
                    geometry: [
                      { lat: 37.42, lon: 126.76 },
                      { lat: 37.42, lon: 127.19 },
                      { lat: 37.71, lon: 127.19 },
                      { lat: 37.71, lon: 126.76 },
                      { lat: 37.42, lon: 126.76 },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const resolved = await resolveOsmProvincialRegion(37.5665, 126.978);
    assert.ok(resolved);
    assert.equal(resolved.regionId, 'osm_rel_2297418');
    assert.equal(resolved.boundaryGeoJson?.type, 'Polygon');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildDenseRealOsmGraph retains cross-clip bridge vertices so roads are never severed at chunk seams', () => {
  const centerLat = 37.5665;
  const centerLng = 126.978;
  const raw = {
    elements: [
      { type: 'node' as const, id: 101, lat: centerLat, lon: centerLng },
      { type: 'node' as const, id: 102, lat: centerLat + 0.0025, lon: centerLng },
      { type: 'node' as const, id: 103, lat: centerLat + 0.0062, lon: centerLng }, // outside clipLat=0.0048, inside 1.45*clipLat
      { type: 'node' as const, id: 104, lat: centerLat + 0.015, lon: centerLng },  // far outside
      {
        type: 'way' as const,
        id: 5001,
        tags: { highway: 'primary', name: '세종대로 연장선' },
        nodes: [101, 102, 103, 104],
      },
    ],
  };

  const graph = buildDenseRealOsmGraph(raw, '37.5665_126.9780', centerLat, centerLng, {
    clipLat: 0.0048,
    clipLng: 0.006,
  });

  // Must include inner edge 101->102 AND boundary crossing edge 102->103
  assert.ok(graph.osmNodes.length >= 3, `Expected boundary bridge node retained, got ${graph.osmNodes.length}`);
  assert.ok(graph.osmEdges.length >= 2, `Expected crossing edge retained, got ${graph.osmEdges.length}`);
  assert.ok(
    graph.osmNodes.some((n) => n.lat > centerLat + 0.0048),
    'Boundary bridge vertex slightly past clipLat must remain in graph so adjacent chunks share an anchor'
  );
});

test('buildDenseRealOsmGraph generates nodes for minor roads (parking_aisle, footway, path, cycleway) and snaps <=2m duplicates without merging parallel lanes', () => {
  const centerLat = 37.734;
  const centerLng = -122.388;
  const raw = {
    elements: [
      // Minor parking_aisle & footway roads meeting within 1.1m (~0.00001 deg)
      { type: 'node' as const, id: 1, lat: centerLat, lon: centerLng },
      { type: 'node' as const, id: 2, lat: centerLat + 0.00025, lon: centerLng },
      { type: 'node' as const, id: 3, lat: centerLat + 0.000255, lon: centerLng + 0.000005 }, // ~0.7m from node 2
      { type: 'node' as const, id: 4, lat: centerLat + 0.00025, lon: centerLng + 0.00025 },
      // Parallel carriageway 12m away (~0.00011 deg) must stay distinct
      { type: 'node' as const, id: 5, lat: centerLat, lon: centerLng + 0.00014 },
      { type: 'node' as const, id: 6, lat: centerLat + 0.00025, lon: centerLng + 0.00014 },
      {
        type: 'way' as const,
        id: 201,
        tags: { highway: 'service', service: 'parking_aisle' },
        nodes: [1, 2],
      },
      {
        type: 'way' as const,
        id: 202,
        tags: { highway: 'footway' },
        nodes: [3, 4],
      },
      {
        type: 'way' as const,
        id: 203,
        tags: { highway: 'primary', name: 'Newcomb Ave' },
        nodes: [5, 6],
      },
    ],
  };

  const graph = buildDenseRealOsmGraph(raw, '37.7340_-122.3880', centerLat, centerLng);
  assert.ok(graph.osmEdges.some((e) => e.highwayType === 'service'), 'parking_aisle service road should emit edges');
  assert.ok(graph.osmEdges.some((e) => e.highwayType === 'footway'), 'footway minor road should emit edges');

  const node4Adjacent = graph.osmEdges.find((e) => e.fromNodeId === 'osm_4' || e.toNodeId === 'osm_4');
  assert.ok(node4Adjacent, 'footway should retain connection');
  assert.equal(
    graph.osmNodes.some((n) => n.id === 'osm_3'),
    false,
    'Duplicate vertex within <=2m on same mode/layer should snap to primary endpoint instead of stacking dots'
  );
  assert.ok(
    graph.osmNodes.some((n) => n.id === 'osm_5') && graph.osmNodes.some((n) => n.id === 'osm_1'),
    '12m parallel road must remain distinct'
  );
});

test('fetchOsmRoadChunk and fetchOsmProvincialRegion return empty graph (no phantom fb_* grid) when live OSM is empty or allowStarterFallback is false', async () => {
  resetBackendApiProbeForTests();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('/api/')) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('nominatim.openstreetmap.org')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Live OSM returns empty HTTP 200 elements (e.g. uninhabited island / ocean)
    return new Response(JSON.stringify({ elements: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const emptyIslandChunk = await fetchOsmRoadChunk(31.23, 130.65);
    assert.equal(emptyIslandChunk.osmNodes.length, 0, 'Empty live OSM response must produce 0 synthetic nodes');
    assert.equal(emptyIslandChunk.osmEdges.length, 0);
    assert.equal(emptyIslandChunk.usedLiveOverpass, true);

    const emptyIslandProvince = await fetchOsmProvincialRegion(31.24, 130.66, '외딴섬', 'curated_empty', {
      allowStarterFallback: false,
    });
    assert.equal(emptyIslandProvince.osmNodes.length, 0, 'Empty roadless island unlock must produce 0 nodes');
    assert.equal(emptyIslandProvince.osmEdges.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    resetBackendApiProbeForTests();
  }
});

test('loadOsmRoadChunksBatchDirect clusters nearby coordinates into one Overpass request', async () => {
  const { loadOsmRoadChunksBatchDirect } = await import('./osmCore');
  const originalFetch = globalThis.fetch;

  let clusterFetchCount = 0;
  const mockNodes: Array<{ type: 'node'; id: number; lat: number; lon: number }> = [];
  const mockWays: Array<{ type: 'way'; id: number; nodes: number[]; tags: Record<string, string> }> = [];
  let nextId = 1000;
  // Build 2 dense horizontal + vertical streets per tile on fresh coordinates
  const baseCoords = [
    { lat: 36.5, lng: 127.5 },
    { lat: 36.5, lng: 127.5033 },
    { lat: 36.5033, lng: 127.5 },
    { lat: 36.5033, lng: 127.5033 },
    { lat: 36.5067, lng: 127.5067 },
  ];
  for (let c = 0; c < baseCoords.length; c++) {
    const { lat, lng } = baseCoords[c];
    const rowA: number[] = [];
    const colA: number[] = [];
    for (let k = -2; k <= 2; k++) {
      const nId1 = nextId++;
      mockNodes.push({ type: 'node', id: nId1, lat: lat + k * 0.0005, lon: lng });
      colA.push(nId1);
      const nId2 = nextId++;
      mockNodes.push({ type: 'node', id: nId2, lat, lon: lng + k * 0.0006 });
      rowA.push(nId2);
    }
    mockWays.push({ type: 'way', id: nextId++, nodes: colA, tags: { highway: 'primary', name: `남북대로_${c}` } });
    mockWays.push({ type: 'way', id: nextId++, nodes: rowA, tags: { highway: 'secondary', name: `동서로_${c}` } });
  }

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('overpass-api.de')) {
      clusterFetchCount++;
      return new Response(
        JSON.stringify({ elements: [...mockNodes, ...mockWays] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const results = await loadOsmRoadChunksBatchDirect(baseCoords, { allowStarterFallback: false });
    assert.equal(results.length, 5);
    assert.equal(
      clusterFetchCount,
      1,
      `Expected 1 clustered fetchOsmBbox invocation for 5 adjacent tiles, got ${clusterFetchCount}`
    );
    assert.ok(results.every((r) => r.osmNodes.length > 0 && r.usedLiveOverpass));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildDenseRealOsmGraph preserves multi-kilometer 2-node bridge spans (e.g. SF-Oakland Bay Bridge West Span)', () => {
  const raw = {
    elements: [
      { type: 'node' as const, id: 6196866302, lat: 37.7861827, lon: -122.3906949 },
      { type: 'node' as const, id: 645557712, lat: 37.7864781, lon: -122.3903709 },
      { type: 'node' as const, id: 1895821104, lat: 37.8080581, lon: -122.3672612 }, // ~3.15 km NE at Yerba Buena Island
      {
        type: 'way' as const,
        id: 50690291,
        tags: { highway: 'motorway', name: 'Dwight D. Eisenhower Highway', oneway: 'yes' },
        nodes: [6196866302, 645557712],
      },
      {
        type: 'way' as const,
        id: 661905446,
        tags: { highway: 'motorway', bridge: 'yes', layer: '1', name: 'Dwight D. Eisenhower Highway' },
        nodes: [645557712, 1895821104],
      },
    ],
  };

  const graph = buildDenseRealOsmGraph(raw, '37.7867_-122.3900', 37.7867, -122.39);
  assert.ok(
    graph.osmNodes.some((n) => n.id === 'osm_645557712'),
    'Should retain SF anchorage node osm_645557712'
  );
  assert.ok(
    graph.osmNodes.some((n) => n.id === 'osm_1895821104'),
    'Should retain Yerba Buena Island far-end bridge anchor osm_1895821104 (~3.15 km away)'
  );
  assert.ok(
    graph.osmEdges.length >= 130,
    `Expected >130 subdivided edges across the 3.15km Bay Bridge span, got ${graph.osmEdges.length}`
  );

  // Verify full BFS continuity from SF approach (osm_6196866302) to YBI anchor (osm_1895821104)
  const adj = new Map<string, string[]>();
  for (const e of graph.osmEdges) {
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
    adj.get(e.toNodeId)!.push(e.fromNodeId);
  }
  const visited = new Set<string>(['osm_6196866302']);
  const q = ['osm_6196866302'];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) || []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        q.push(nb);
      }
    }
  }
  assert.ok(
    visited.has('osm_1895821104'),
    'Bay Bridge West Span must form a complete continuous path from SF to Yerba Buena Island'
  );
});

test('resolveOsmProvincialRegion prefers county-equivalent admin_level 6 over state admin_level 4 even when expectedRegionName is state name', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('nominatim.openstreetmap.org/lookup')) {
      return new Response(
        JSON.stringify([
          {
            osm_id: 2404020,
            boundingbox: ['37.547', '37.570', '126.961', '127.025'],
            geojson: {
              type: 'Polygon',
              coordinates: [[[126.961, 37.547], [127.025, 37.547], [127.025, 37.570], [126.961, 37.570], [126.961, 37.547]]],
            },
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('overpass')) {
      const bodyStr = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
      if (bodyStr.includes('is_in(')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'area',
                id: 3602297418,
                tags: { boundary: 'administrative', admin_level: '4', 'name:ko': '서울특별시' },
              },
              {
                type: 'area',
                id: 3602404020,
                tags: { boundary: 'administrative', admin_level: '6', 'name:ko': '중구' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const resolved = await resolveOsmProvincialRegion(37.564, 126.995, '서울');
    assert.ok(resolved);
    assert.equal(resolved.regionId, 'osm_rel_2404020');
    assert.equal(resolved.adminLevel, '6');
    assert.equal(resolved.regionName, '중구');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadOsmProvinceDirect queries full county streets including residential and service ways across the region', async () => {
  const { loadOsmProvinceDirect } = await import('./osmCore');
  const originalFetch = globalThis.fetch;
  let capturedProvinceQuery = '';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('nominatim.openstreetmap.org/lookup')) {
      return new Response(
        JSON.stringify([
          {
            osm_id: 9912345,
            boundingbox: ['37.60', '37.70', '126.80', '126.95'],
            geojson: {
              type: 'Polygon',
              coordinates: [[[126.80, 37.60], [126.95, 37.60], [126.95, 37.70], [126.80, 37.70], [126.80, 37.60]]],
            },
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('overpass')) {
      const bodyStr = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
      if (bodyStr.includes('is_in(')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'area',
                id: 3609912345,
                tags: { boundary: 'administrative', admin_level: '6', 'name:ko': '테스트군' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (bodyStr.includes('3609912345')) {
        capturedProvinceQuery = bodyStr;
        return new Response(
          JSON.stringify({
            elements: [
              { type: 'node', id: 7001, lat: 37.65, lon: 126.87 },
              { type: 'node', id: 7002, lat: 37.655, lon: 126.875 },
              { type: 'node', id: 7003, lat: 37.685, lon: 126.925 }, // Distant corner of county
              { type: 'node', id: 7004, lat: 37.688, lon: 126.928 },
              { type: 'way', id: 8001, nodes: [7001, 7002], tags: { highway: 'residential', name: '군내골목길' } },
              { type: 'way', id: 8002, nodes: [7003, 7004], tags: { highway: 'service', name: '외곽진입로' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const reportedPcts: number[] = [];
    const payload = await loadOsmProvinceDirect(37.6501, 126.8701, '테스트군', {
      allowStarterFallback: false,
      onProgress: (pct) => {
        reportedPcts.push(pct);
      },
    });
    assert.ok(capturedProvinceQuery.includes('residential'), 'Full-county query must include residential ways');
    assert.ok(capturedProvinceQuery.includes('service'), 'Full-county query must include service ways');
    assert.equal(payload.regionId, 'osm_rel_9912345');
    assert.equal(payload.osmNodes.some((n) => n.id === 'osm_7003'), true, 'Distant corner node of county must load in one pass');
    assert.ok(reportedPcts.length >= 3, `Expected multiple percentage progress updates, got ${reportedPcts.length}`);
    assert.equal(reportedPcts[reportedPcts.length - 1], 100, 'Progress must conclude at 100%');
    for (let i = 1; i < reportedPcts.length; i++) {
      assert.ok(reportedPcts[i] >= reportedPcts[i - 1], 'Progress percentages must be non-decreasing');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveOsmProvincialRegion uses polygon_threshold=0 and preserves exact complex polygon vertices with exactBoundaryVersion: 2', async () => {
  const originalFetch = globalThis.fetch;
  let capturedNominatimUrl = '';

  // Generate 650 exact vertices
  const exactCoords: Array<[number, number]> = [];
  for (let i = 0; i < 650; i++) {
    const angle = (i / 650) * Math.PI * 2;
    const r = 0.05 + 0.005 * Math.sin(i * 7);
    exactCoords.push([
      Math.round((126.98 + r * Math.cos(angle)) * 1e7) / 1e7,
      Math.round((37.56 + r * Math.sin(angle)) * 1e7) / 1e7,
    ]);
  }
  exactCoords.push(exactCoords[0]); // close loop

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('nominatim.openstreetmap.org')) {
      capturedNominatimUrl = url;
      return new Response(
        JSON.stringify([
          {
            osm_id: 8881234,
            boundingbox: ['37.50', '37.62', '126.92', '127.04'],
            geojson: {
              type: 'Polygon',
              coordinates: [exactCoords],
            },
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('overpass')) {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'area',
              id: 3608881234,
              tags: { boundary: 'administrative', admin_level: '6', 'name:ko': '정밀행정구' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const resolved = await resolveOsmProvincialRegion(37.56, 126.98);
    assert.ok(resolved);
    assert.ok(
      capturedNominatimUrl.includes('polygon_threshold=0'),
      `Nominatim URL must specify polygon_threshold=0 for 100% exact boundary, got: ${capturedNominatimUrl}`
    );
    assert.equal(resolved.exactBoundaryVersion, 2);
    assert.ok(
      (resolved.boundaryGeoJson?.coordinates[0].length || 0) >= 650,
      `Exact coordinates count must be preserved (>600), got: ${resolved.boundaryGeoJson?.coordinates[0].length}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildDenseRealOsmGraph connects highway=steps across layerKey boundaries and disjoint <=2.5m endpoints', () => {
  const centerLat = 37.55;
  const centerLng = 126.99;
  const raw = {
    elements: [
      // Ground footway at layer=0 -> shared OSM node 11 + nearby disjoint node 12 (~1.8m from steps start)
      { type: 'node' as const, id: 10, lat: centerLat, lon: centerLng },
      { type: 'node' as const, id: 11, lat: centerLat + 0.0002, lon: centerLng },
      { type: 'node' as const, id: 12, lat: centerLat + 0.000215, lon: centerLng + 0.00001 },
      // Elevated walkway at layer=1 bridge=yes
      { type: 'node' as const, id: 13, lat: centerLat + 0.0004, lon: centerLng },
      { type: 'node' as const, id: 14, lat: centerLat + 0.0006, lon: centerLng },
      {
        type: 'way' as const,
        id: 701,
        tags: { highway: 'footway', name: '지상 보행로' },
        nodes: [10, 11],
      },
      {
        type: 'way' as const,
        id: 702,
        tags: { highway: 'steps', layer: '1', incline: 'up', name: '육교 계단' },
        nodes: [12, 13],
      },
      {
        type: 'way' as const,
        id: 703,
        tags: { highway: 'footway', layer: '1', bridge: 'yes', name: '육교 상부' },
        nodes: [13, 14],
      },
    ],
  };

  const graph = buildDenseRealOsmGraph(raw, '37.5500_126.9900', centerLat, centerLng);
  assert.ok(graph.osmEdges.some((e) => e.highwayType === 'steps'), 'highway=steps edge must be emitted');

  // Verify BFS reachability from osm_10 (ground) through steps to osm_14 (bridge layer=1)
  const adj = new Map<string, string[]>();
  for (const e of graph.osmEdges) {
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
    adj.get(e.toNodeId)!.push(e.fromNodeId);
  }
  const visited = new Set<string>(['osm_10']);
  const q = ['osm_10'];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const nxt of adj.get(cur) || []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        q.push(nxt);
      }
    }
  }
  assert.equal(visited.has('osm_14'), true, 'Ground footway -> steps -> elevated bridge footway must form a connected component');
});

test('loadNearbyProvincialRegionsDirect stitches real boundaries via batched Overpass fallback when Nominatim throttles', async () => {
  const { loadNearbyProvincialRegionsDirect } = await import('./osmCore');
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('nominatim.openstreetmap.org')) {
      return new Response('Too many requests', { status: 429 });
    }
    if (url.includes('overpass')) {
      const bodyStr = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
      if (bodyStr.includes('out tags bb;')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'relation',
                id: 990101,
                tags: { boundary: 'administrative', admin_level: '6', 'name:ko': '중구테스트' },
                bounds: { minlat: 37.54, minlon: 126.96, maxlat: 37.57, maxlon: 127.01 },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (bodyStr.includes('relation(id:990101)')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'relation',
                id: 990101,
                bounds: { minlat: 37.54, minlon: 126.96, maxlat: 37.57, maxlon: 127.01 },
                members: [
                  {
                    type: 'way',
                    role: 'outer',
                    geometry: [
                      { lat: 37.54, lon: 126.96 },
                      { lat: 37.54, lon: 127.01 },
                      { lat: 37.57, lon: 127.01 },
                      { lat: 37.57, lon: 126.96 },
                      { lat: 37.54, lon: 126.96 },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const nearby = await loadNearbyProvincialRegionsDirect(37.55, 126.98);
    assert.ok(nearby.length >= 1);
    const target = nearby.find((r) => r.regionId === 'osm_rel_990101');
    assert.ok(target);
    assert.equal(target.boundaryGeoJson?.type, 'Polygon');
    assert.equal(target.exactBoundaryVersion, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
