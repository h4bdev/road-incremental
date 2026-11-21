import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNearbyProvincialRegions,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  fetchProvincialRegionInfo,
  resetBackendApiProbeForTests,
} from './osmService';
import { buildDenseRealOsmGraph } from './osmCore';

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


