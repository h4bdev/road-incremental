import {
  MapNode,
  OsmEdge,
  OsmNode,
  PredefinedSegment,
  ProvincialRegion,
  StartingCity,
  TransportLine,
} from './types';
import {
  buildFallbackStarterGrid,
  fetchOverpassQuery,
  isCountryLevelOsmArea,
  loadNearbyProvincialRegionsDirect,
  loadOsmProvinceDirect,
  loadOsmRegionInfoDirect,
  loadOsmRoadChunkDirect,
  loadOsmRoadChunksBatchDirect,
  OsmRawWay,
  ProvincialRegionMeta,
  quantizeChunkKey,
} from './osmCore';
import {
  CachedOsmRegion,
  CachedOsmTile,
  getAllCachedOsmRegions,
  getCachedOsmRegion,
  getCachedOsmRegionsByIds,
  getCachedOsmTile,
  getCachedOsmTilesBatch,
  putCachedOsmRegion,
  putCachedOsmTile,
} from './osmTileCache';

export type { ProvincialRegionMeta };

let backendApiSupported: boolean | null = null;

export function resetBackendApiProbeForTests(): void {
  backendApiSupported = null;
}

async function tryFetchBackendJson<T>(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<T | null> {
  if (backendApiSupported === false) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || (res.ok && !contentType.includes('application/json'))) {
      backendApiSupported = false;
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as T;
    backendApiSupported = true;
    return json;
  } catch {
    return null;
  }
}

export interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
}

/**
 * Haversine great-circle distance in km
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1000) / 1000;
}

/**
 * Search any real-world city or town via OpenStreetMap Nominatim
 */
export async function searchCityNominatim(query: string): Promise<StartingCity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
      trimmed
    )}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data: NominatimPlace[] = await res.json();

    return data.map((item) => {
      const shortName =
        item.name ||
        item.address?.city ||
        item.address?.town ||
        item.address?.village ||
        item.display_name.split(',')[0];
      const country = item.address?.country || item.display_name.split(',').slice(-1)[0]?.trim() || '세계';
      return {
        id: `custom_${item.place_id}`,
        name: shortName,
        country,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        zoom: 12,
        description: `${shortName} (${country}) 실제 1:1 OSM 좌표 기반 시작 거점`,
        isCustom: true,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Query Overpass API around a custom starting city for real road/rail ways,
 * with clean real-coordinate procedural fallback if Overpass is slow or unavailable.
 */
export async function generateCustomCityNetwork(city: StartingCity): Promise<{
  nodes: MapNode[];
  lines: TransportLine[];
  segments: PredefinedSegment[];
  usedLiveOsm: boolean;
}> {
  const { lat, lng, id: cityId, name: cityName } = city;
  let osmRoads: [number, number][][] = [];
  let usedLiveOsm = false;

  try {
    const delta = 0.055; // ~6km bounding box around town center
    const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`;

    const query = `
      [out:json][timeout:4];
      way["highway"~"motorway|trunk|primary"](${bbox});
      out geom 14;
    `;

    const json = await fetchOverpassQuery(query, 4500);
    if (Array.isArray(json.elements) && json.elements.length > 0) {
      usedLiveOsm = true;
      for (const el of json.elements) {
        const wayEl = el as OsmRawWay & { geometry?: Array<{ lat: number; lon: number }> };
        if (wayEl.type === 'way' && Array.isArray(wayEl.geometry) && wayEl.geometry.length >= 2 && osmRoads.length < 4) {
          const pts: [number, number][] = wayEl.geometry.map((g) => [g.lat, g.lon]);
          osmRoads.push(pts);
        }
      }
    }
  } catch {
    // Graceful fallback to real 1:1 coordinate offsets
  }

  // Create 5 realistic 1:1 nodes around the chosen city center
  const nCenter: MapNode = {
    id: `${cityId}_center`,
    name: `${cityName} 중앙역 허브`,
    cityId,
    lat,
    lng,
    connected: false,
    isHub: true,
    level: 1,
  };
  const nNorth: MapNode = {
    id: `${cityId}_north`,
    name: `${cityName} 북부 교차로`,
    cityId,
    lat: Number((lat + 0.036).toFixed(5)),
    lng: Number((lng + 0.012).toFixed(5)),
    connected: false,
    level: 1,
  };
  const nEast: MapNode = {
    id: `${cityId}_east`,
    name: `${cityName} 동부 신도시`,
    cityId,
    lat: Number((lat + 0.008).toFixed(5)),
    lng: Number((lng + 0.048).toFixed(5)),
    connected: false,
    level: 1,
  };
  const nSouth: MapNode = {
    id: `${cityId}_south`,
    name: `${cityName} 남부 터미널`,
    cityId,
    lat: Number((lat - 0.034).toFixed(5)),
    lng: Number((lng + 0.01).toFixed(5)),
    connected: false,
    level: 1,
  };
  const nWest: MapNode = {
    id: `${cityId}_west`,
    name: `${cityName} 서부 산업단지`,
    cityId,
    lat: Number((lat - 0.006).toFixed(5)),
    lng: Number((lng - 0.046).toFixed(5)),
    connected: false,
    level: 1,
  };

  const nodes = [nCenter, nNorth, nEast, nSouth, nWest];

  const loopLineId = `line_${cityId}_loop`;
  const hwLineId = `line_${cityId}_highway`;

  const lines: TransportLine[] = [
    {
      id: loopLineId,
      name: `${cityName} 도심 순환철도`,
      lineCode: `${cityName} 순환`,
      cityId,
      mode: 'rail',
      category: 'metro',
      color: '#10b981',
      description: `${cityName}의 동서남북 주요 거점을 연결하는 도심 순환 전철 노선.`,
      segmentIds: [`seg_${cityId}_l1`, `seg_${cityId}_l2`, `seg_${cityId}_l3`, `seg_${cityId}_l4`],
      completionBonus: {
        incomeMultiplierPct: 50,
        instantCash: 16000,
        skillPoints: 2,
        label: '전체 수익 +50% · 2 SP · $16,000',
      },
      completed: false,
    },
    {
      id: hwLineId,
      name: `${cityName} 중앙 고속화도로`,
      lineCode: `${cityName} 대로`,
      cityId,
      mode: 'road',
      category: 'highway',
      color: '#f59e0b',
      description: `${cityName} 중앙역과 동·서부 핵심 구역을 관통하는 간선 도로망.`,
      segmentIds: [`seg_${cityId}_r1`, `seg_${cityId}_r2`],
      completionBonus: {
        incomeMultiplierPct: 35,
        instantCash: 9000,
        skillPoints: 1,
        label: '전체 수익 +35% · 1 SP · $9,000',
      },
      completed: false,
    },
  ];

  const makeCoords = (a: MapNode, b: MapNode, curveOffset: number): [number, number][] => {
    const midLat = (a.lat + b.lat) / 2 + curveOffset;
    const midLng = (a.lng + b.lng) / 2 - curveOffset;
    return [
      [a.lat, a.lng],
      [Number(midLat.toFixed(5)), Number(midLng.toFixed(5))],
      [b.lat, b.lng],
    ];
  };

  const r1Coords: [number, number][] =
    osmRoads[0] && osmRoads[0].length >= 2
      ? [[nWest.lat, nWest.lng], ...osmRoads[0].slice(0, 4), [nCenter.lat, nCenter.lng]]
      : makeCoords(nWest, nCenter, 0.004);

  const r2Coords: [number, number][] =
    osmRoads[1] && osmRoads[1].length >= 2
      ? [[nCenter.lat, nCenter.lng], ...osmRoads[1].slice(0, 4), [nEast.lat, nEast.lng]]
      : makeCoords(nCenter, nEast, -0.004);

  const segments: PredefinedSegment[] = [
    {
      id: `seg_${cityId}_r1`,
      lineId: hwLineId,
      name: `${cityName} 서부 ~ 중앙대로`,
      mode: 'road',
      fromNodeId: nWest.id,
      toNodeId: nCenter.id,
      distanceKm: haversineKm(nWest.lat, nWest.lng, nCenter.lat, nCenter.lng),
      feederNetworkKm: 140,
      coordinates: r1Coords,
      buildCost: 450,
      baseIncomePerSec: 20,
      built: false,
      level: 1,
    },
    {
      id: `seg_${cityId}_r2`,
      lineId: hwLineId,
      name: `${cityName} 중앙 ~ 동부대로`,
      mode: 'road',
      fromNodeId: nCenter.id,
      toNodeId: nEast.id,
      distanceKm: haversineKm(nCenter.lat, nCenter.lng, nEast.lat, nEast.lng),
      feederNetworkKm: 160,
      coordinates: r2Coords,
      buildCost: 950,
      baseIncomePerSec: 40,
      built: false,
      level: 1,
    },
    {
      id: `seg_${cityId}_l1`,
      lineId: loopLineId,
      name: `${cityName} 중앙 ~ 북부 순환선`,
      mode: 'rail',
      fromNodeId: nCenter.id,
      toNodeId: nNorth.id,
      distanceKm: haversineKm(nCenter.lat, nCenter.lng, nNorth.lat, nNorth.lng),
      feederNetworkKm: 120,
      coordinates: makeCoords(nCenter, nNorth, 0.005),
      buildCost: 550,
      baseIncomePerSec: 25,
      built: false,
      level: 1,
    },
    {
      id: `seg_${cityId}_l2`,
      lineId: loopLineId,
      name: `${cityName} 북부 ~ 동부 순환선`,
      mode: 'rail',
      fromNodeId: nNorth.id,
      toNodeId: nEast.id,
      distanceKm: haversineKm(nNorth.lat, nNorth.lng, nEast.lat, nEast.lng),
      feederNetworkKm: 150,
      coordinates: makeCoords(nNorth, nEast, 0.005),
      buildCost: 1300,
      baseIncomePerSec: 55,
      built: false,
      level: 1,
    },
    {
      id: `seg_${cityId}_l3`,
      lineId: loopLineId,
      name: `${cityName} 동부 ~ 남부 순환선`,
      mode: 'rail',
      fromNodeId: nEast.id,
      toNodeId: nSouth.id,
      distanceKm: haversineKm(nEast.lat, nEast.lng, nSouth.lat, nSouth.lng),
      feederNetworkKm: 170,
      coordinates: makeCoords(nEast, nSouth, -0.004),
      buildCost: 2200,
      baseIncomePerSec: 88,
      built: false,
      level: 1,
    },
    {
      id: `seg_${cityId}_l4`,
      lineId: loopLineId,
      name: `${cityName} 남부 ~ 서부 ~ 중앙 완결`,
      mode: 'rail',
      fromNodeId: nSouth.id,
      toNodeId: nCenter.id,
      distanceKm: haversineKm(nSouth.lat, nSouth.lng, nCenter.lat, nCenter.lng),
      feederNetworkKm: 140,
      coordinates: [
        [nSouth.lat, nSouth.lng],
        [nWest.lat, nWest.lng],
        [nCenter.lat, nCenter.lng],
      ],
      buildCost: 3400,
      baseIncomePerSec: 135,
      built: false,
      level: 1,
    },
  ];

  return { nodes, lines, segments, usedLiveOsm };
}

export function chunkKeyForCoords(lat: number, lng: number): string {
  const qLat = Math.round(lat * 300) / 300;
  const qLng = Math.round(lng * 300) / 300;
  return `${qLat.toFixed(4)}_${qLng.toFixed(4)}`;
}

/**
 * Deterministic 1:1 coordinate local street & railway starter grid around (lat, lng).
 * Used ONLY when live OSM endpoints fail, rate-limit, or return zero nearby ways,
 * guaranteeing that players always have starting nodes to play from.
 */
export function buildStarterOsmFallback(
  lat: number,
  lng: number,
  cityLabel = '도심'
): {
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
} {
  const chunkKey = chunkKeyForCoords(lat, lng);
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const dLatStep = 0.00024; // ~26.7m N-S
  const dLngStep = 0.00024 / cosLat; // ~26.7m E-W

  const osmNodes: OsmNode[] = [];
  const osmEdges: OsmEdge[] = [];
  const nodeMap = new Map<string, OsmNode>();

  const ensureNode = (id: string, nLat: number, nLng: number, mode: 'road' | 'rail', label: string) => {
    const prev = nodeMap.get(id);
    if (!prev) {
      const node: OsmNode = {
        id,
        lat: Number(nLat.toFixed(6)),
        lng: Number(nLng.toFixed(6)),
        connected: false,
        mode,
        label,
      };
      nodeMap.set(id, node);
      osmNodes.push(node);
    } else if (prev.mode !== mode && prev.mode !== 'mixed') {
      prev.mode = 'mixed';
    }
  };

  const addChain = (
    prefix: string,
    wayName: string,
    highwayType: string,
    mode: 'road' | 'rail',
    pts: Array<{ key: string; r: number; c: number; label: string }>
  ) => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const nLat = lat + p.r * dLatStep;
      const nLng = lng + p.c * dLngStep;
      ensureNode(p.key, nLat, nLng, mode, p.label);

      if (i > 0) {
        const a = nodeMap.get(pts[i - 1].key)!;
        const b = nodeMap.get(p.key)!;
        const distKm = Math.max(0.015, haversineKm(a.lat, a.lng, b.lat, b.lng));
        const tierMult = mode === 'rail' ? 1.8 : 1.35;
        osmEdges.push({
          id: `oe_${prefix}_${i}`,
          wayName,
          highwayType,
          mode,
          fromNodeId: a.id,
          toNodeId: b.id,
          coordinates: [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          distanceKm: distKm,
          buildCost: Math.max(20, Math.round(28 * tierMult * (1 + distKm * 20))),
          baseIncomePerSec: Math.round(1.6 * tierMult * (1 + distKm * 20) * 10) / 10,
          built: false,
        });
      }
    }
  };

  // Main East-West Avenue (passes through center 0,0)
  addChain(
    `fb_ew_${chunkKey}`,
    `${cityLabel} 중앙대로`,
    'primary',
    'road',
    Array.from({ length: 13 }, (_, i) => {
      const c = i - 6;
      return {
        key: `fb_r_${chunkKey}_0_${c}`,
        r: 0,
        c,
        label: c === 0 ? `${cityLabel} 중앙 교차로` : `${cityLabel} 중앙대로`,
      };
    })
  );

  // Main North-South Avenue (intersects at 0,0)
  addChain(
    `fb_ns_${chunkKey}`,
    `${cityLabel} 시청로`,
    'primary',
    'road',
    Array.from({ length: 13 }, (_, i) => {
      const r = i - 6;
      return {
        key: `fb_r_${chunkKey}_${r}_0`,
        r,
        c: 0,
        label: r === 0 ? `${cityLabel} 중앙 교차로` : `${cityLabel} 시청로`,
      };
    })
  );

  // Parallel Ring Street (North +3, South -3) & Cross Connectors (+3, -3)
  addChain(
    `fb_n3_${chunkKey}`,
    `${cityLabel} 북부 순환로`,
    'secondary',
    'road',
    Array.from({ length: 7 }, (_, i) => {
      const c = i - 3;
      return {
        key: `fb_r_${chunkKey}_3_${c}`,
        r: 3,
        c,
        label: c === 0 ? `${cityLabel} 북부 교차점` : `${cityLabel} 북부 순환로`,
      };
    })
  );
  addChain(
    `fb_s3_${chunkKey}`,
    `${cityLabel} 남부 순환로`,
    'secondary',
    'road',
    Array.from({ length: 7 }, (_, i) => {
      const c = i - 3;
      return {
        key: `fb_r_${chunkKey}_-3_${c}`,
        r: -3,
        c,
        label: c === 0 ? `${cityLabel} 남부 교차점` : `${cityLabel} 남부 순환로`,
      };
    })
  );

  // Local Metro / Rail Line slightly offset south-west to avoid overlapping road centerline
  addChain(
    `fb_rail_${chunkKey}`,
    `${cityLabel} 도심 도시철도`,
    'subway',
    'rail',
    Array.from({ length: 11 }, (_, i) => {
      const idx = i - 5;
      return {
        key: `fb_rail_${chunkKey}_${idx}`,
        r: idx * 0.8 + 0.5,
        c: idx * 0.55 - 0.8,
        label: idx === 0 ? `${cityLabel} 중앙역` : `${cityLabel} 도심 도시철도`,
      };
    })
  );

  return {
    chunkKey,
    osmNodes,
    osmEdges,
    usedLiveOverpass: false,
  };
}

/**
 * Fetch 100% REAL OpenStreetMap road & railway geometry via /api/osm-roads,
 * falling back directly to browser OSM 0.6 / Overpass API + starter grid when
 * deployed statically without an Express backend (e.g. Vercel).
 */
export function parseChunkKeyCoords(chunkKey: string): { lat: number; lng: number } | null {
  const parts = String(chunkKey).split('_');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function enumerateChunkKeysForBounds(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}, maxTiles = 16): Array<{ key: string; lat: number; lng: number }> {
  const STEP = 1 / 300;
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const cLatIdx = Math.round(centerLat * 300);
  const cLngIdx = Math.round(centerLng * 300);

  const maxHalfSteps = Math.max(8, Math.ceil(Math.sqrt(Math.max(1, maxTiles))) + 4);
  const startLatIdx = Math.max(Math.round(bounds.minLat * 300), cLatIdx - maxHalfSteps);
  const endLatIdx = Math.min(Math.round(bounds.maxLat * 300), cLatIdx + maxHalfSteps);
  const startLngIdx = Math.max(Math.round(bounds.minLng * 300), cLngIdx - maxHalfSteps);
  const endLngIdx = Math.min(Math.round(bounds.maxLng * 300), cLngIdx + maxHalfSteps);

  const list: Array<{ key: string; lat: number; lng: number; distSq: number }> = [];
  for (let latIdx = startLatIdx; latIdx <= endLatIdx; latIdx++) {
    const lat = latIdx * STEP;
    const dLat = lat - centerLat;
    for (let lngIdx = startLngIdx; lngIdx <= endLngIdx; lngIdx++) {
      const lng = lngIdx * STEP;
      const key = quantizeChunkKey(lat, lng);
      const dLng = lng - centerLng;
      list.push({ key, lat, lng, distSq: dLat * dLat + dLng * dLng });
    }
  }

  list.sort((a, b) => a.distSq - b.distSq);
  return list.slice(0, maxTiles).map(({ key, lat, lng }) => ({ key, lat, lng }));
}

export async function readCachedOsmTilesForKeys(
  tileKeys: string[]
): Promise<Map<string, CachedOsmTile>> {
  return getCachedOsmTilesBatch(tileKeys);
}

function normalizeRegionNameForCache(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/특별자치도|특별자치시|특별시|광역시|자치도|자치시/g, '')
    .replace(
      /\b(special self-governing province|special self-governing city|metropolitan city|special city|city of|state of|province|state|prefecture|region|metropolis|do|si)\b/g,
      ''
    )
    .replace(/(teukbyeolsi|gwangyeoksi|province|prefecture|state)$/g, '')
    .replace(/[-_.,·\s]+/g, '')
    .trim();
}

export function resolveCanonicalRegionCacheKey(
  name: string,
  lat: number,
  lng: number,
  regionId?: string
): string | undefined {
  if (regionId && regionId.startsWith('curated_')) {
    return regionId.slice('curated_'.length);
  }
  const norm = normalizeRegionNameForCache(name);
  if (!norm) return undefined;
  const isKorea = lat >= 33.0 && lat <= 38.9 && lng >= 124.4 && lng <= 132.0;
  if (isKorea) {
    if (norm === '서울' || norm === 'seoul' || norm === 'seoulmetropolitan') return 'kr_seoul';
    if (norm === '경기' || norm === '경기도' || norm === 'gyeonggi' || norm === 'gyeonggido') return 'kr_gyeonggi';
    if (norm === '인천' || norm === 'incheon') return 'kr_incheon';
    if (norm === '강원' || norm === '강원도' || norm === 'gangwon' || norm === 'gangwondo') return 'kr_gangwon';
    if (norm === '충북' || norm === '충청북' || norm === '충청북도' || norm === 'chungbuk' || norm === 'chungcheongbuk' || norm === 'chungcheongbukdo' || norm === 'northchungcheong') return 'kr_chungbuk';
    if (norm === '충남' || norm === '충청남' || norm === '충청남도' || norm === 'chungnam' || norm === 'chungcheongnam' || norm === 'chungcheongnamdo' || norm === 'southchungcheong') return 'kr_chungnam';
    if (norm === '대전' || norm === 'daejeon') return 'kr_daejeon';
    if (norm === '세종' || norm === 'sejong' || norm === 'sejongsi') return 'kr_sejong';
    if (norm === '전북' || norm === '전라북' || norm === '전라북도' || norm === 'jeonbuk' || norm === 'jeollabuk' || norm === 'jeollabukdo' || norm === 'northjeolla') return 'kr_jeonbuk';
    if (norm === '전남' || norm === '전라남' || norm === '전라남도' || norm === 'jeonnam' || norm === 'jeollanam' || norm === 'jeollanamdo' || norm === 'southjeolla') return 'kr_jeonnam';
    if (norm === '광주' || norm === 'gwangju') return 'kr_gwangju';
    if (norm === '경북' || norm === '경상북' || norm === '경상북도' || norm === 'gyeongbuk' || norm === 'gyeongsangbuk' || norm === 'gyeongsangbukdo' || norm === 'northgyeongsang') return 'kr_gyeongbuk';
    if (norm === '경남' || norm === '경상남' || norm === '경상남도' || norm === 'gyeongnam' || norm === 'gyeongsangnam' || norm === 'gyeongsangnamdo' || norm === 'southgyeongsang') return 'kr_gyeongnam';
    if (norm === '대구' || norm === 'daegu') return 'kr_daegu';
    if (norm === '울산' || norm === 'ulsan') return 'kr_ulsan';
    if (norm === '부산' || norm === 'busan') return 'kr_busan';
    if (norm === '제주' || norm === '제주도' || norm === 'jeju' || norm === 'jejudo') return 'kr_jeju';
  }
  if (norm.includes('tokyo') || norm.includes('東京都')) return 'jp_tokyo';
  if (norm.includes('kanagawa') || norm.includes('神奈川')) return 'jp_kanagawa';
  if (norm.includes('chiba') || norm.includes('千葉')) return 'jp_chiba';
  if (norm.includes('saitama') || norm.includes('埼玉')) return 'jp_saitama';
  if (norm.includes('osaka') || norm.includes('大阪')) return 'jp_osaka';
  if (norm.includes('kyoto') || norm.includes('京都')) return 'jp_kyoto';
  if (norm.includes('hyogo') || norm.includes('兵庫')) return 'jp_hyogo';
  if (norm.includes('aichi') || norm.includes('愛知')) return 'jp_aichi';
  if (norm.includes('fukuoka') || norm.includes('福岡')) return 'jp_fukuoka';
  if (norm.includes('hokkaido') || norm === '北海道') return 'jp_hokkaido';
  if (norm.includes('okinawa') || norm.includes('沖縄')) return 'jp_okinawa';
  if (norm === 'newyork' && lat > 40) return 'us_ny';
  if (norm === 'newjersey') return 'us_nj';
  if (norm === 'california') return 'us_ca';
  if (norm === 'washington' && lng < -100) return 'us_wa';
  if (norm === 'texas') return 'us_tx';
  if (norm === 'illinois') return 'us_il';
  if (norm === 'massachusetts') return 'us_ma';
  if (norm === 'greaterlondon' || norm === 'london') return 'uk_london';
  if (norm === 'southeastengland') return 'uk_southeast';
  if (norm === 'scotland') return 'uk_scotland';
  if (norm === 'iledefrance' || norm === 'îledefrance') return 'fr_idf';
  if (norm === 'auvergnerhonealpes' || norm === 'auvergnerhônealpes') return 'fr_ara';
  return undefined;
}

function cachedRecordMatchesRegion(rec: CachedOsmRegion, target: Pick<ProvincialRegion, 'regionId' | 'regionName' | 'centerLat' | 'centerLng'>): boolean {
  if (!rec.boundaryGeoJson) return false;
  if (
    isCountryLevelOsmArea({
      name: rec.regionName,
      regionId: rec.regionId,
      adminLevel: rec.adminLevel,
      bbox: rec.bbox,
    })
  ) {
    return false;
  }
  if (rec.regionId === target.regionId) return true;
  const targetCanonical = resolveCanonicalRegionCacheKey(
    target.regionName,
    target.centerLat,
    target.centerLng,
    target.regionId
  );
  const recCanonical =
    rec.canonicalKey ||
    resolveCanonicalRegionCacheKey(rec.regionName, rec.centerLat, rec.centerLng, rec.regionId);
  if (targetCanonical && recCanonical && targetCanonical === recCanonical) {
    return true;
  }
  const nRec = normalizeRegionNameForCache(rec.regionName);
  const nTarget = normalizeRegionNameForCache(target.regionName);
  if (
    nRec &&
    nTarget &&
    (nRec === nTarget || nRec.includes(nTarget) || nTarget.includes(nRec)) &&
    haversineKm(rec.centerLat, rec.centerLng, target.centerLat, target.centerLng) <= 150
  ) {
    return true;
  }
  return false;
}

async function cacheValidRegionMeta(
  meta: ProvincialRegionMeta,
  aliasRegionId?: string,
  totalNodeCount?: number
): Promise<void> {
  if (!meta.boundaryGeoJson) return;
  if (
    isCountryLevelOsmArea({
      name: meta.regionName,
      regionId: meta.regionId,
      adminLevel: meta.adminLevel,
      bbox: meta.bbox,
    })
  ) {
    return;
  }
  const canonicalKey =
    resolveCanonicalRegionCacheKey(meta.regionName, meta.centerLat, meta.centerLng, aliasRegionId) ||
    resolveCanonicalRegionCacheKey(meta.regionName, meta.centerLat, meta.centerLng, meta.regionId);
  const record: CachedOsmRegion = {
    ...meta,
    canonicalKey,
    totalNodeCount,
    updatedAt: Date.now(),
  };
  await putCachedOsmRegion(record);
  if (aliasRegionId && aliasRegionId !== meta.regionId) {
    await putCachedOsmRegion({
      ...record,
      regionId: aliasRegionId,
      regionName: meta.regionName,
    });
  }
}

export async function hydrateProvincialRegionsFromCache(
  regions: ProvincialRegion[]
): Promise<Map<string, ProvincialRegionMeta>> {
  const missingRegions = regions.filter((r) => !r.hasRealOsmBoundary || !r.boundaryGeoJson);
  const result = new Map<string, ProvincialRegionMeta>();
  if (missingRegions.length === 0) return result;

  const idsToCheck = missingRegions.map((r) => r.regionId);
  const cachedMap = await getCachedOsmRegionsByIds(idsToCheck);
  for (const reg of missingRegions) {
    const direct = cachedMap.get(reg.regionId);
    if (
      direct &&
      direct.boundaryGeoJson &&
      !isCountryLevelOsmArea({
        name: direct.regionName,
        regionId: direct.regionId,
        adminLevel: direct.adminLevel,
        bbox: direct.bbox,
      })
    ) {
      result.set(reg.regionId, {
        regionId: reg.regionId,
        regionName: direct.regionName,
        adminLevel: direct.adminLevel,
        bbox: direct.bbox,
        boundaryGeoJson: direct.boundaryGeoJson,
        centerLat: direct.centerLat,
        centerLng: direct.centerLng,
      });
    }
  }

  // Secondary pass: resolve curated_* <-> osm_rel_* aliases via canonicalKey or name + proximity
  const stillMissing = missingRegions.filter((r) => !result.has(r.regionId));
  if (stillMissing.length > 0) {
    const allCached = await getAllCachedOsmRegions();
    for (const reg of stillMissing) {
      const aliasHit = allCached.find((rec) => cachedRecordMatchesRegion(rec, reg));
      if (aliasHit && aliasHit.boundaryGeoJson) {
        const meta: ProvincialRegionMeta = {
          regionId: reg.regionId,
          regionName: aliasHit.regionName || reg.regionName,
          adminLevel: aliasHit.adminLevel || reg.adminLevel,
          bbox: aliasHit.bbox,
          boundaryGeoJson: aliasHit.boundaryGeoJson,
          centerLat: aliasHit.centerLat,
          centerLng: aliasHit.centerLng,
        };
        result.set(reg.regionId, meta);
        void cacheValidRegionMeta(meta, reg.regionId, aliasHit.totalNodeCount);
      }
    }
  }

  return result;
}

export async function fetchOsmRoadChunk(
  lat: number,
  lng: number,
  options?: { allowStarterFallback?: boolean; bypassCache?: boolean }
): Promise<{
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
}> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const allowFallback = options?.allowStarterFallback !== false;
  const bypassCache = Boolean(options?.bypassCache);

  if (!bypassCache) {
    const idbHit = await getCachedOsmTile(chunkKey);
    if (idbHit && (idbHit.osmNodes.length > 0 || idbHit.usedLiveOverpass)) {
      return {
        chunkKey: idbHit.tileKey,
        osmNodes: idbHit.osmNodes,
        osmEdges: idbHit.osmEdges,
        usedLiveOverpass: idbHit.usedLiveOverpass,
      };
    }
  }

  const fbParam = allowFallback ? '' : '&fallback=0';
  const refreshParam = bypassCache ? '&refresh=1' : '';
  const json = await tryFetchBackendJson<{
    chunkKey?: string;
    osmNodes?: OsmNode[];
    osmEdges?: OsmEdge[];
    usedLiveOverpass?: boolean;
  }>(
    `/api/osm-roads?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}${fbParam}${refreshParam}`,
    14000
  );

  if (
    json &&
    Array.isArray(json.osmNodes) &&
    Array.isArray(json.osmEdges) &&
    (json.osmNodes.length > 0 || json.usedLiveOverpass || !allowFallback)
  ) {
    const resolvedKey = json.chunkKey || chunkKey;
    const usedLive = Boolean(json.usedLiveOverpass);
    if (usedLive) {
      void putCachedOsmTile({
        tileKey: resolvedKey,
        osmNodes: json.osmNodes,
        osmEdges: json.osmEdges,
        usedLiveOverpass: true,
        updatedAt: Date.now(),
      });
    }
    return {
      chunkKey: resolvedKey,
      osmNodes: json.osmNodes,
      osmEdges: json.osmEdges,
      usedLiveOverpass: usedLive,
    };
  }

  try {
    const direct = await loadOsmRoadChunkDirect(lat, lng, options);
    if (direct.osmNodes.length > 0 || direct.usedLiveOverpass || !allowFallback) {
      if (direct.usedLiveOverpass) {
        void putCachedOsmTile({
          tileKey: direct.chunkKey,
          osmNodes: direct.osmNodes,
          osmEdges: direct.osmEdges,
          usedLiveOverpass: true,
          updatedAt: Date.now(),
        });
      }
      return {
        chunkKey: direct.chunkKey,
        osmNodes: direct.osmNodes,
        osmEdges: direct.osmEdges,
        usedLiveOverpass: direct.usedLiveOverpass,
      };
    }
  } catch {
    // Fall through below
  }

  if (!allowFallback) {
    return {
      chunkKey,
      osmNodes: [],
      osmEdges: [],
      usedLiveOverpass: false,
    };
  }

  return buildFallbackStarterGrid(chunkKey, lat, lng);
}

export async function fetchOsmRoadChunksBatch(
  coords: Array<{ key?: string; lat: number; lng: number }>,
  options?: { allowStarterFallback?: boolean; bypassCache?: boolean }
): Promise<
  Array<{
    chunkKey: string;
    osmNodes: OsmNode[];
    osmEdges: OsmEdge[];
    usedLiveOverpass: boolean;
  }>
> {
  if (coords.length === 0) return [];
  const allowFallback = options?.allowStarterFallback !== false;
  const bypassCache = Boolean(options?.bypassCache);
  const keyed = coords.map((c) => ({
    key: c.key || quantizeChunkKey(c.lat, c.lng),
    lat: c.lat,
    lng: c.lng,
  }));

  const cachedMap = bypassCache
    ? new Map()
    : await getCachedOsmTilesBatch(keyed.map((k) => k.key));
  const resultMap = new Map<
    string,
    {
      chunkKey: string;
      osmNodes: OsmNode[];
      osmEdges: OsmEdge[];
      usedLiveOverpass: boolean;
    }
  >();
  const uncached: Array<{ key: string; lat: number; lng: number }> = [];

  for (const pt of keyed) {
    const hit = cachedMap.get(pt.key);
    if (hit && (hit.osmNodes.length > 0 || hit.usedLiveOverpass)) {
      resultMap.set(pt.key, {
        chunkKey: hit.tileKey,
        osmNodes: hit.osmNodes,
        osmEdges: hit.osmEdges,
        usedLiveOverpass: hit.usedLiveOverpass,
      });
    } else {
      uncached.push(pt);
    }
  }

  if (uncached.length > 0) {
    let fetchedChunks: Array<{
      chunkKey: string;
      osmNodes: OsmNode[];
      osmEdges: OsmEdge[];
      usedLiveOverpass: boolean;
    }> | null = null;

    const backendRes = await tryFetchBackendJson<{
      chunks?: Array<{
        chunkKey: string;
        osmNodes: OsmNode[];
        osmEdges: OsmEdge[];
        usedLiveOverpass: boolean;
      }>;
    }>('/api/osm-roads-batch', 22000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coords: uncached.map((u) => ({ lat: u.lat, lng: u.lng })),
        allowStarterFallback: allowFallback,
        bypassCache,
      }),
    });

    if (backendRes && Array.isArray(backendRes.chunks)) {
      fetchedChunks = backendRes.chunks;
    } else {
      try {
        fetchedChunks = await loadOsmRoadChunksBatchDirect(
          uncached.map((u) => ({ lat: u.lat, lng: u.lng })),
          options
        );
      } catch {
        fetchedChunks = [];
      }
    }

    for (const chunk of fetchedChunks || []) {
      if (chunk.osmNodes.length > 0 || chunk.usedLiveOverpass || !allowFallback) {
        resultMap.set(chunk.chunkKey, {
          chunkKey: chunk.chunkKey,
          osmNodes: chunk.osmNodes,
          osmEdges: chunk.osmEdges,
          usedLiveOverpass: Boolean(chunk.usedLiveOverpass),
        });
        if (chunk.usedLiveOverpass) {
          void putCachedOsmTile({
            tileKey: chunk.chunkKey,
            osmNodes: chunk.osmNodes,
            osmEdges: chunk.osmEdges,
            usedLiveOverpass: true,
            updatedAt: Date.now(),
          });
        }
      }
    }
  }

  return keyed
    .map((pt) => resultMap.get(pt.key))
    .filter(
      (
        item
      ): item is {
        chunkKey: string;
        osmNodes: OsmNode[];
        osmEdges: OsmEdge[];
        usedLiveOverpass: boolean;
      } => Boolean(item)
    );
}

export async function fetchProvincialRegionInfo(
  lat: number,
  lng: number,
  knownRegionId?: string,
  expectedRegionName?: string
): Promise<ProvincialRegionMeta | null> {
  if (knownRegionId) {
    const idbRegion = await getCachedOsmRegion(knownRegionId);
    if (
      idbRegion &&
      idbRegion.boundaryGeoJson &&
      !isCountryLevelOsmArea({
        name: idbRegion.regionName,
        regionId: idbRegion.regionId,
        adminLevel: idbRegion.adminLevel,
        bbox: idbRegion.bbox,
      })
    ) {
      return {
        regionId: idbRegion.regionId,
        regionName: idbRegion.regionName,
        adminLevel: idbRegion.adminLevel,
        bbox: idbRegion.bbox,
        boundaryGeoJson: idbRegion.boundaryGeoJson,
        centerLat: idbRegion.centerLat,
        centerLng: idbRegion.centerLng,
      };
    }
  }

  if (knownRegionId || expectedRegionName) {
    const allCached = await getAllCachedOsmRegions();
    const aliasHit = allCached.find((rec) =>
      cachedRecordMatchesRegion(rec, {
        regionId: knownRegionId || '',
        regionName: expectedRegionName || '',
        centerLat: lat,
        centerLng: lng,
      })
    );
    if (aliasHit && aliasHit.boundaryGeoJson) {
      return {
        regionId: knownRegionId || aliasHit.regionId,
        regionName: aliasHit.regionName || expectedRegionName || '도시 행정구역',
        adminLevel: aliasHit.adminLevel,
        bbox: aliasHit.bbox,
        boundaryGeoJson: aliasHit.boundaryGeoJson,
        centerLat: aliasHit.centerLat,
        centerLng: aliasHit.centerLng,
      };
    }
  }

  const nameParam = expectedRegionName ? `&name=${encodeURIComponent(expectedRegionName)}` : '';
  const json = await tryFetchBackendJson<Partial<ProvincialRegionMeta>>(
    `/api/osm-region-info?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}${nameParam}`,
    8000
  );

  if (json && json.regionId && Array.isArray(json.bbox) && json.bbox.length === 4) {
    const meta: ProvincialRegionMeta = {
      regionId: json.regionId,
      regionName: json.regionName || expectedRegionName || '도시 행정구역',
      adminLevel: json.adminLevel || '6',
      bbox: json.bbox as [number, number, number, number],
      boundaryGeoJson: json.boundaryGeoJson,
      centerLat: Number.isFinite(json.centerLat) ? Number(json.centerLat) : lat,
      centerLng: Number.isFinite(json.centerLng) ? Number(json.centerLng) : lng,
    };
    if (
      isCountryLevelOsmArea({
        name: meta.regionName,
        regionId: meta.regionId,
        adminLevel: meta.adminLevel,
        bbox: meta.bbox,
      })
    ) {
      return null;
    }
    if (meta.boundaryGeoJson) {
      void cacheValidRegionMeta(meta, knownRegionId);
    }
    return meta;
  }

  try {
    const directMeta = await loadOsmRegionInfoDirect(lat, lng, expectedRegionName);
    if (
      !directMeta ||
      isCountryLevelOsmArea({
        name: directMeta.regionName,
        regionId: directMeta.regionId,
        adminLevel: directMeta.adminLevel,
        bbox: directMeta.bbox,
      })
    ) {
      return null;
    }
    if (directMeta.boundaryGeoJson) {
      void cacheValidRegionMeta(directMeta, knownRegionId);
    }
    return directMeta;
  } catch {
    return null;
  }
}

export async function fetchNearbyProvincialRegions(
  lat: number,
  lng: number
): Promise<ProvincialRegionMeta[]> {
  const json = await tryFetchBackendJson<{ regions?: ProvincialRegionMeta[] }>(
    `/api/osm-nearby-provinces?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
    9000
  );

  if (json && Array.isArray(json.regions) && json.regions.length > 0) {
    return json.regions.filter(
      (r) =>
        !isCountryLevelOsmArea({
          name: r.regionName,
          regionId: r.regionId,
          adminLevel: r.adminLevel,
          bbox: r.bbox,
        })
    );
  }

  try {
    const direct = await loadNearbyProvincialRegionsDirect(lat, lng);
    return direct.filter(
      (r) =>
        !isCountryLevelOsmArea({
          name: r.regionName,
          regionId: r.regionId,
          adminLevel: r.adminLevel,
          bbox: r.bbox,
        })
    );
  } catch {
    return [];
  }
}

/**
 * Fetch an entire city's OSM road & rail nodes (when starting or unlocking a city).
 */
export async function fetchOsmProvincialRegion(
  lat: number,
  lng: number,
  expectedRegionName?: string,
  knownRegionId?: string,
  options?: { allowStarterFallback?: boolean }
): Promise<{
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  boundaryGeoJson?: import('./types').GeoJsonBoundary;
  totalNodeCount: number;
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
}> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const allowFallback = options?.allowStarterFallback !== false;
  const defaultBbox: [number, number, number, number] = [
    lat - 0.075,
    lng - 0.095,
    lat + 0.075,
    lng + 0.095,
  ];
  const nameParam = expectedRegionName ? `&name=${encodeURIComponent(expectedRegionName)}` : '';
  const fbParam = allowFallback ? '' : '&fallback=0';

  const json = await tryFetchBackendJson<{
    regionId?: string;
    regionName?: string;
    adminLevel?: string;
    bbox?: [number, number, number, number];
    boundaryGeoJson?: import('./types').GeoJsonBoundary;
    totalNodeCount?: number;
    chunkKey?: string;
    osmNodes?: OsmNode[];
    osmEdges?: OsmEdge[];
    usedLiveOverpass?: boolean;
  }>(`/api/osm-province?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}${nameParam}${fbParam}`, 16000);

  if (
    json &&
    Array.isArray(json.osmNodes) &&
    Array.isArray(json.osmEdges) &&
    (json.osmNodes.length > 0 || json.usedLiveOverpass || !allowFallback)
  ) {
    const rawId = json.regionId || `osm_prov_${chunkKey}`;
    const rawName = json.regionName || expectedRegionName || '도시 행정구역';
    const rawBbox = Array.isArray(json.bbox) && json.bbox.length === 4 ? json.bbox : defaultBbox;
    const isCountry = isCountryLevelOsmArea({
      name: rawName,
      regionId: rawId,
      adminLevel: json.adminLevel,
      bbox: rawBbox,
    });
    const resolvedRegionId = isCountry ? (knownRegionId || `osm_prov_${chunkKey}`) : rawId;
    const resolvedBbox = isCountry ? defaultBbox : rawBbox;
    const resolvedBoundary = isCountry ? undefined : json.boundaryGeoJson;
    const resolvedName = isCountry ? (expectedRegionName || '도시 행정구역') : rawName;
    const resolvedTotal =
      typeof json.totalNodeCount === 'number' ? json.totalNodeCount : json.osmNodes.length;
    if (resolvedBoundary) {
      void cacheValidRegionMeta(
        {
          regionId: resolvedRegionId,
          regionName: resolvedName,
          adminLevel: isCountry ? '4' : json.adminLevel || '6',
          bbox: resolvedBbox,
          boundaryGeoJson: resolvedBoundary,
          centerLat: (resolvedBbox[0] + resolvedBbox[2]) / 2,
          centerLng: (resolvedBbox[1] + resolvedBbox[3]) / 2,
        },
        knownRegionId,
        resolvedTotal
      );
    }
    return {
      regionId: resolvedRegionId,
      regionName: resolvedName,
      adminLevel: isCountry ? '4' : json.adminLevel || '6',
      bbox: resolvedBbox,
      boundaryGeoJson: resolvedBoundary,
      totalNodeCount: resolvedTotal,
      chunkKey: json.chunkKey || chunkKey,
      osmNodes: json.osmNodes,
      osmEdges: json.osmEdges,
      usedLiveOverpass: Boolean(json.usedLiveOverpass),
    };
  }

  try {
    const direct = await loadOsmProvinceDirect(lat, lng, expectedRegionName, options);
    if (direct.osmNodes.length > 0 || direct.usedLiveOverpass || !allowFallback) {
      const isCountry = isCountryLevelOsmArea({
        name: direct.regionName,
        regionId: direct.regionId,
        adminLevel: direct.adminLevel,
        bbox: direct.bbox,
      });
      const resolvedRegionId = isCountry ? (knownRegionId || `osm_prov_${chunkKey}`) : direct.regionId;
      const resolvedBbox = isCountry ? defaultBbox : direct.bbox;
      const resolvedBoundary = isCountry ? undefined : direct.boundaryGeoJson;
      const resolvedName = isCountry ? (expectedRegionName || '도시 행정구역') : direct.regionName;

      if (resolvedBoundary) {
        void cacheValidRegionMeta(
          {
            regionId: resolvedRegionId,
            regionName: resolvedName,
            adminLevel: isCountry ? '4' : direct.adminLevel,
            bbox: resolvedBbox,
            boundaryGeoJson: resolvedBoundary,
            centerLat: (resolvedBbox[0] + resolvedBbox[2]) / 2,
            centerLng: (resolvedBbox[1] + resolvedBbox[3]) / 2,
          },
          knownRegionId,
          direct.totalNodeCount
        );
      }
      return {
        regionId: resolvedRegionId,
        regionName: resolvedName,
        adminLevel: isCountry ? '4' : direct.adminLevel,
        bbox: resolvedBbox,
        boundaryGeoJson: resolvedBoundary,
        totalNodeCount: direct.totalNodeCount,
        chunkKey: direct.chunkKey,
        osmNodes: direct.osmNodes,
        osmEdges: direct.osmEdges,
        usedLiveOverpass: direct.usedLiveOverpass,
      };
    }
  } catch {
    // Fall through below
  }

  if (!allowFallback) {
    return {
      regionId: knownRegionId || `osm_prov_${chunkKey}`,
      regionName: expectedRegionName || '도시 행정구역',
      adminLevel: '6',
      bbox: defaultBbox,
      totalNodeCount: 0,
      chunkKey,
      osmNodes: [],
      osmEdges: [],
      usedLiveOverpass: false,
    };
  }

  const fb = buildFallbackStarterGrid(chunkKey, lat, lng);
  return {
    regionId: knownRegionId || `osm_prov_${chunkKey}`,
    regionName: expectedRegionName || '도시 행정구역',
    adminLevel: '6',
    bbox: defaultBbox,
    totalNodeCount: fb.osmNodes.length,
    chunkKey: fb.chunkKey,
    osmNodes: fb.osmNodes,
    osmEdges: fb.osmEdges,
    usedLiveOverpass: false,
  };
}


