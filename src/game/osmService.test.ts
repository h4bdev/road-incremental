import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNearbyProvincialRegions,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  fetchProvincialRegionInfo,
  resetBackendApiProbeForTests,
} from './osmService';

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
