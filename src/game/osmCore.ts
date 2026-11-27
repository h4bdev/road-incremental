import { GeoJsonBoundary, OsmEdge, OsmNode } from './types';

export interface OsmRawNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

export interface OsmRawWay {
  type: 'way';
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OsmRawRelationMember {
  type: 'node' | 'way' | 'relation';
  ref?: number;
  role?: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OsmRawRelation {
  type: 'relation';
  id: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: OsmRawRelationMember[];
  tags?: Record<string, string>;
}

export interface OsmMapResponse {
  remark?: string;
  elements?: Array<OsmRawNode | OsmRawWay | OsmRawRelation | { type: string }>;
}

export interface ChunkPayload {
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
  source: 'osm-0.6-api';
  wayCount: number;
}

export interface ProvincePayload extends ChunkPayload {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  boundaryGeoJson?: GeoJsonBoundary;
  totalNodeCount: number;
}

export interface ResolvedAdminRegion {
  regionId: string;
  relId?: number;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  districtBbox?: [number, number, number, number];
  boundaryGeoJson?: GeoJsonBoundary;
  exactBoundaryVersion?: number;
}

export interface ProvincialRegionMeta {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  boundaryGeoJson?: GeoJsonBoundary;
  exactBoundaryVersion?: number;
  centerLat: number;
  centerLng: number;
}

const DRIVABLE_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'residential',
  'unclassified',
  'living_street',
  'service',
  'pedestrian',
  'track',
  'road',
  'footway',
  'path',
  'cycleway',
  'steps',
]);

const RAILWAYS = new Set([
  'rail',
  'subway',
  'light_rail',
  'tram',
  'narrow_gauge',
  'monorail',
  'funicular',
]);

const OVERPASS_ENDPOINTS_SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const OVERPASS_ENDPOINTS_BROWSER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const MAX_CHUNK_CACHE_SIZE = 4000;
const chunkCache = new Map<string, ChunkPayload>();
const provinceCache = new Map<string, ProvincePayload>();
const regionInfoCache = new Map<string, ResolvedAdminRegion>();
const relationBoundaryCache = new Map<
  number,
  { bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary; name?: string; adminLevel?: string }
>();
const inFlightChunks = new Map<string, Promise<ChunkPayload>>();
const inFlightProvinces = new Map<string, Promise<ProvincePayload>>();
const inFlightRegionInfo = new Map<string, Promise<ResolvedAdminRegion | null>>();
const endpointCooldownUntil = new Map<string, number>();

function setChunkCache(key: string, payload: ChunkPayload): void {
  if (chunkCache.size >= MAX_CHUNK_CACHE_SIZE && !chunkCache.has(key)) {
    const oldest = chunkCache.keys().next().value;
    if (oldest !== undefined) chunkCache.delete(oldest);
  }
  chunkCache.set(key, payload);
}

function isServerRuntime(): boolean {
  return typeof window === 'undefined';
}

function getActiveOverpassEndpoints(): string[] {
  const list = isServerRuntime() ? OVERPASS_ENDPOINTS_SERVER : OVERPASS_ENDPOINTS_BROWSER;
  const now = Date.now();
  const healthy = list.filter((ep) => (endpointCooldownUntil.get(ep) || 0) <= now);
  return healthy.length > 0 ? healthy : list;
}

const MAX_UPSTREAM_CONCURRENT = 4;
let activeUpstreamCount = 0;
const upstreamWaiters: Array<() => void> = [];

async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (isServerRuntime()) {
    if (activeUpstreamCount >= MAX_UPSTREAM_CONCURRENT) {
      await new Promise<void>((resolve) => {
        upstreamWaiters.push(resolve);
      });
    }
    activeUpstreamCount++;
  }
  try {
    return await fn();
  } finally {
    if (isServerRuntime()) {
      activeUpstreamCount = Math.max(0, activeUpstreamCount - 1);
      const next = upstreamWaiters.shift();
      if (next) next();
    }
  }
}

function buildRequestHeaders(accept = 'application/json', contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  // Browsers forbid setting User-Agent in fetch; only send it from Node server runtime.
  if (isServerRuntime()) {
    headers['User-Agent'] = 'RoadIncremental-OSM-Builder/1.0';
  }
  return headers;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function quantizeChunkKey(lat: number, lng: number): string {
  const qLat = Math.round(lat * 300) / 300;
  const qLng = Math.round(lng * 300) / 300;
  return `${qLat.toFixed(4)}_${qLng.toFixed(4)}`;
}

function getWayPriority(way: OsmRawWay): number {
  const hw = way.tags?.highway || '';
  const rw = way.tags?.railway || '';
  const isTunnel = way.tags?.tunnel === 'yes' || way.tags?.layer === '-1' || way.tags?.layer === '-2';
  if (hw.startsWith('primary')) return 1;
  if (hw.startsWith('secondary')) return 2;
  if (hw.startsWith('tertiary')) return 3;
  if (hw.startsWith('motorway') || hw.startsWith('trunk')) return 4;
  if (hw === 'residential' || hw === 'unclassified' || hw === 'living_street' || hw === 'road') return 5;
  if (rw && !isTunnel && rw !== 'subway') return 6;
  if (hw === 'service') return 7;
  if (rw === 'subway' || isTunnel) return 8;
  return 9;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassFromUrl(
  endpoint: string,
  query: string,
  signal: AbortSignal
): Promise<OsmMapResponse> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: buildRequestHeaders('application/json', 'application/x-www-form-urlencoded'),
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        endpointCooldownUntil.set(endpoint, Date.now() + 12000);
      }
      throw new Error(`Overpass HTTP ${res.status}`);
    }
    const data = (await res.json()) as OsmMapResponse;
    if (!Array.isArray(data.elements)) {
      throw new Error('Overpass invalid elements');
    }
    if (data.elements.length === 0 && typeof data.remark === 'string' && data.remark.trim().length > 0) {
      throw new Error(`Overpass remark: ${data.remark}`);
    }
    endpointCooldownUntil.delete(endpoint);
    return data;
  } catch (err) {
    if (!signal.aborted) {
      endpointCooldownUntil.set(endpoint, Date.now() + 8000);
    }
    throw err;
  }
}

export async function fetchOverpassQuery(
  query: string,
  timeoutMs = 8500
): Promise<OsmMapResponse> {
  return withUpstreamSlot(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const endpoints = getActiveOverpassEndpoints();
    try {
      return await Promise.any(
        endpoints.map((ep) => fetchOverpassFromUrl(ep, query, controller.signal))
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });
}

async function fetchFromOverpass(
  endpoint: string,
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  signal: AbortSignal
): Promise<OsmMapResponse> {
  const bbox = `${minLat.toFixed(6)},${minLng.toFixed(6)},${maxLat.toFixed(6)},${maxLng.toFixed(6)}`;
  const query = `[out:json][timeout:8];(way["highway"](${bbox});way["railway"](${bbox}););out body;>;out skel qt;`;
  return fetchOverpassFromUrl(endpoint, query, signal);
}

async function fetchFromOsm06(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  signal: AbortSignal
): Promise<OsmMapResponse> {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${minLng.toFixed(
    6
  )},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;
  const res = await fetch(url, {
    signal,
    headers: buildRequestHeaders('application/json'),
  });
  if (!res.ok) throw new Error(`OSM 0.6 HTTP ${res.status}`);
  const data = (await res.json()) as OsmMapResponse;
  if (!Array.isArray(data.elements)) {
    throw new Error('OSM 0.6 invalid elements');
  }
  return data;
}

export async function fetchOsmBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  timeoutMs = 8500
): Promise<OsmMapResponse | null> {
  return withUpstreamSlot(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const latSpan = Math.abs(maxLat - minLat);
    const lngSpan = Math.abs(maxLng - minLng);
    const allowOsm06 = latSpan <= 0.015 && lngSpan <= 0.019;
    const overpassEndpoints = getActiveOverpassEndpoints();
    const attempts: Array<Promise<OsmMapResponse>> = overpassEndpoints.map((ep) =>
      fetchFromOverpass(ep, minLat, minLng, maxLat, maxLng, controller.signal)
    );
    if (allowOsm06) {
      attempts.unshift(fetchFromOsm06(minLat, minLng, maxLat, maxLng, controller.signal));
    }
    try {
      return await Promise.any(attempts);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });
}

export function buildFallbackStarterGrid(
  chunkKey: string,
  centerLat: number,
  centerLng: number
): ChunkPayload {
  const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
  const dLat = 0.00032; // ~35m N-S spacing
  const dLng = 0.00032 / cosLat; // ~35m E-W spacing
  const osmNodes: OsmNode[] = [];
  const osmEdges: OsmEdge[] = [];

  const rows = 5;
  const cols = 5;
  const halfR = Math.floor(rows / 2);
  const halfC = Math.floor(cols / 2);

  const nodeIdAt = (r: number, c: number) => `fb_${chunkKey}_r${r}_c${c}`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = Number((centerLat + (r - halfR) * dLat).toFixed(6));
      const lng = Number((centerLng + (c - halfC) * dLng).toFixed(6));
      const isRailCol = c === halfC;
      osmNodes.push({
        id: nodeIdAt(r, c),
        lat,
        lng,
        connected: false,
        mode: isRailCol ? 'mixed' : 'road',
        label: isRailCol ? '중앙 환승 교차점' : '도심 교차로',
      });
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = osmNodes[r * cols + c];
      if (c + 1 < cols) {
        const b = osmNodes[r * cols + (c + 1)];
        const distM = haversineMeters(a.lat, a.lng, b.lat, b.lng);
        osmEdges.push({
          id: `oe_fb_${a.id}_${b.id}`,
          wayName: `중앙 가로 ${r + 1}로`,
          highwayType: 'primary',
          mode: 'road',
          fromNodeId: a.id,
          toNodeId: b.id,
          coordinates: [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          distanceKm: Math.max(0.01, Math.round((distM / 1000) * 1000) / 1000),
          buildCost: 35,
          baseIncomePerSec: 2.4,
          built: false,
        });
      }
      if (r + 1 < rows) {
        const b = osmNodes[(r + 1) * cols + c];
        const distM = haversineMeters(a.lat, a.lng, b.lat, b.lng);
        const isRailLine = c === halfC;
        osmEdges.push({
          id: `oe_fb_${a.id}_${b.id}`,
          wayName: isRailLine ? '도심 순환선' : `중앙 세로 ${c + 1}로`,
          highwayType: isRailLine ? 'subway' : 'secondary',
          mode: isRailLine ? 'rail' : 'road',
          fromNodeId: a.id,
          toNodeId: b.id,
          coordinates: [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          distanceKm: Math.max(0.01, Math.round((distM / 1000) * 1000) / 1000),
          buildCost: isRailLine ? 45 : 32,
          baseIncomePerSec: isRailLine ? 3.2 : 2.1,
          built: false,
        });
      }
    }
  }

  return {
    chunkKey,
    osmNodes,
    osmEdges,
    usedLiveOverpass: false,
    source: 'osm-0.6-api',
    wayCount: rows + cols,
  };
}

function normalizeExactRing(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const cleaned: number[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rx = Math.round(x * 1e7) / 1e7;
    const ry = Math.round(y * 1e7) / 1e7;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev[0] === rx && prev[1] === ry) continue;
    cleaned.push([rx, ry]);
  }
  if (cleaned.length < 3) return [];
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned.length >= 4 ? cleaned : [];
}

function normalizeExactGeoJsonBoundary(raw: unknown): GeoJsonBoundary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const rings = (g.coordinates as number[][][])
      .map((r) => normalizeExactRing(r))
      .filter((r) => r.length >= 4);
    if (rings.length === 0) return undefined;
    return { type: 'Polygon', coordinates: rings };
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const polys = (g.coordinates as number[][][][])
      .map((poly) => {
        if (!Array.isArray(poly) || poly.length === 0) return null;
        const normalizedRings = poly
          .map((r) => normalizeExactRing(r))
          .filter((r) => r.length >= 4);
        if (normalizedRings.length === 0) return null;
        return normalizedRings;
      })
      .filter((p): p is number[][][] => p !== null);
    if (polys.length === 0) return undefined;
    if (polys.length === 1) {
      return { type: 'Polygon', coordinates: polys[0] };
    }
    return { type: 'MultiPolygon', coordinates: polys };
  }
  return undefined;
}

export function stitchOverpassWaysToGeoJson(
  elements: Array<OsmRawRelation | { type: string }>
): { bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary } {
  const rel = elements.find(
    (el): el is OsmRawRelation => el.type === 'relation' && Array.isArray((el as OsmRawRelation).members)
  );
  if (!rel || !rel.members) return {};

  const outerSegments: Array<number[][]> = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || !Array.isArray(m.geometry) || m.geometry.length < 2) continue;
    const role = (m.role || '').trim();
    if (role !== '' && role !== 'outer') continue;
    const coords = m.geometry
      .filter((pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat))
      .map((pt) => [pt.lon, pt.lat]);
    if (coords.length >= 2) {
      outerSegments.push(coords);
    }
  }

  if (outerSegments.length === 0) return {};

  const ptKey = (pt: number[]) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  const samePt = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) <= 1e-5 && Math.abs(a[1] - b[1]) <= 1e-5;

  const remaining = outerSegments.slice();
  const rings: number[][][] = [];

  while (remaining.length > 0) {
    const ring = remaining.shift()!.slice();
    let changed = true;
    while (changed && !samePt(ring[0], ring[ring.length - 1])) {
      changed = false;
      const head = ring[0];
      const tail = ring[ring.length - 1];
      const tailKey = ptKey(tail);
      const headKey = ptKey(head);

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const sFirst = seg[0];
        const sLast = seg[seg.length - 1];
        if (ptKey(sFirst) === tailKey || samePt(sFirst, tail)) {
          ring.push(...seg.slice(1));
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        if (ptKey(sLast) === tailKey || samePt(sLast, tail)) {
          ring.push(...seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        if (ptKey(sLast) === headKey || samePt(sLast, head)) {
          ring.unshift(...seg.slice(0, -1));
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        if (ptKey(sFirst) === headKey || samePt(sFirst, head)) {
          ring.unshift(...seg.slice(1).reverse());
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    if (ring.length >= 4) {
      if (!samePt(ring[0], ring[ring.length - 1])) {
        ring.push([ring[0][0], ring[0][1]]);
      }
      rings.push(ring);
    }
  }

  if (rings.length === 0) return {};

  let minLat = rel.bounds?.minlat ?? Infinity;
  let minLng = rel.bounds?.minlon ?? Infinity;
  let maxLat = rel.bounds?.maxlat ?? -Infinity;
  let maxLng = rel.bounds?.maxlon ?? -Infinity;

  if (!rel.bounds) {
    for (const r of rings) {
      for (const [lng, lat] of r) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }
  }

  const rawBoundary: GeoJsonBoundary =
    rings.length === 1
      ? { type: 'Polygon', coordinates: [rings[0]] }
      : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
  const boundaryGeoJson = normalizeExactGeoJsonBoundary(rawBoundary);
  const bbox: [number, number, number, number] | undefined =
    Number.isFinite(minLat) && Number.isFinite(minLng) && Number.isFinite(maxLat) && Number.isFinite(maxLng)
      ? [minLat, minLng, maxLat, maxLng]
      : undefined;

  return { bbox, boundaryGeoJson };
}

export async function fetchOverpassRelationBoundary(
  relId: number
): Promise<{ bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary } | null> {
  const cached = relationBoundaryCache.get(relId);
  if (cached?.boundaryGeoJson) {
    return { bbox: cached.bbox, boundaryGeoJson: cached.boundaryGeoJson };
  }
  try {
    const query = `[out:json][timeout:10];relation(${relId});out geom;`;
    const res = await fetchOverpassQuery(query, 9500);
    const stitched = stitchOverpassWaysToGeoJson((res.elements || []) as Array<OsmRawRelation | { type: string }>);
    if (stitched.boundaryGeoJson) {
      relationBoundaryCache.set(relId, {
        ...cached,
        bbox: stitched.bbox || cached?.bbox,
        boundaryGeoJson: stitched.boundaryGeoJson,
      });
      return stitched;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchBatchOverpassRelationBoundaries(
  relIds: number[]
): Promise<Map<number, { bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary }>> {
  const out = new Map<number, { bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary }>();
  const missing: number[] = [];
  const seen = new Set<number>();

  for (const id of relIds) {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const cached = relationBoundaryCache.get(id);
    if (cached?.boundaryGeoJson) {
      out.set(id, { bbox: cached.bbox, boundaryGeoJson: cached.boundaryGeoJson });
    } else {
      missing.push(id);
    }
  }

  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    if (batch.length === 0) continue;
    try {
      const query = `[out:json][timeout:10];relation(id:${batch.join(',')});out geom;`;
      const res = await fetchOverpassQuery(query, 10500);
      const elements = (res.elements || []) as Array<OsmRawRelation | { type: string }>;
      for (const el of elements) {
        if (el.type !== 'relation' || !('id' in el)) continue;
        const rel = el as OsmRawRelation;
        const stitched = stitchOverpassWaysToGeoJson([rel]);
        if (stitched.boundaryGeoJson) {
          out.set(rel.id, stitched);
          relationBoundaryCache.set(rel.id, {
            bbox: stitched.bbox,
            boundaryGeoJson: stitched.boundaryGeoJson,
            name: rel.tags?.['name:ko'] || rel.tags?.name || rel.tags?.['name:en'],
            adminLevel: rel.tags?.admin_level,
          });
        }
      }
    } catch {
      // Keep partial batch results if Overpass errors
    }
  }

  return out;
}

const KNOWN_COUNTRY_REL_IDS = new Set([
  307756, // South Korea (대한민국)
  192756, // North Korea
  382313, // Japan
  148838, // United States
  62149,  // United Kingdom
  1403916, // France (territories)
  2202162, // Metropolitan France
  270056, // China
]);

const COUNTRY_NAME_NORM_SET = new Set([
  '대한민국',
  '남한',
  '한국',
  'southkorea',
  'republicofkorea',
  'korea',
  '조선민주주의인민공화국',
  'northkorea',
  '일본',
  'japan',
  '日本',
  '미국',
  'unitedstates',
  'unitedstatesofamerica',
  'usa',
  '영국',
  'unitedkingdom',
  'greatbritain',
  'uk',
  '프랑스',
  'france',
  '중국',
  'china',
  '中华人民共和国',
]);

function normalizeNameToken(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s\-_.,·]/g, '')
    .trim();
}

export function isCountryLevelOsmArea(params: {
  name?: string;
  relId?: number;
  regionId?: string;
  adminLevel?: string;
  tags?: Record<string, string>;
  addresstype?: string;
  bbox?: [number, number, number, number];
}): boolean {
  if (params.adminLevel === '2' || params.tags?.admin_level === '2') return true;
  if (params.tags?.['ISO3166-1'] || params.tags?.border_type === 'nation') return true;
  if (params.addresstype === 'country') return true;
  if (params.relId && KNOWN_COUNTRY_REL_IDS.has(params.relId)) return true;
  if (params.regionId) {
    const m = params.regionId.match(/^osm_rel_(\d+)$/);
    if (m && KNOWN_COUNTRY_REL_IDS.has(Number(m[1]))) return true;
  }
  const norm = normalizeNameToken(params.name);
  if (norm && COUNTRY_NAME_NORM_SET.has(norm)) return true;
  if (params.bbox && params.bbox.length === 4) {
    const [minLat, minLng, maxLat, maxLng] = params.bbox;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const inKoreaBox = minLat >= 32.0 && maxLat <= 40.2 && minLng >= 123.0 && maxLng <= 133.0;
    if (inKoreaBox && latSpan > 3.5 && lngSpan > 3.2) return true;
    if (latSpan > 15 && lngSpan > 20) return true;
  }
  return false;
}

function adminNamesLikelyMatch(a?: string, b?: string): boolean {
  const clean = (s?: string) =>
    normalizeNameToken(s)
      .replace(/특별자치도|특별자치시|특별시|광역시|자치도|자치시/g, '')
      .replace(/(province|prefecture|state|metropolitancity|specialcity|do|si)$/g, '');
  const na = clean(a);
  const nb = clean(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function searchOsmProvinceByName(
  expectedName: string,
  nearLat: number,
  nearLng: number
): Promise<ResolvedAdminRegion | null> {
  const cleanQuery = expectedName.replace(/\([^)]*\)/g, ' ').trim();
  if (!cleanQuery) return null;
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        cleanQuery
      )}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0004&addressdetails=1&accept-language=ko,en&limit=6`,
      { headers: buildRequestHeaders('application/json') },
      8500
    );
    if (!res.ok) return null;
    const rawItems = (await res.json()) as Array<{
      osm_type?: string;
      osm_id?: number;
      name?: string;
      display_name?: string;
      addresstype?: string;
      boundingbox?: [string, string, string, string];
      geojson?: unknown;
    }>;

    const preferredAdminTypes = new Set(['state', 'province', 'region', 'prefecture', 'city', 'county']);
    const items = rawItems
      .filter((item) => item.osm_type === 'relation' && Boolean(item.osm_id))
      .sort((a, b) => {
        const score = (it: typeof a) => {
          let s = 0;
          const nm = it.name || it.display_name?.split(',')[0] || '';
          if (it.addresstype && ['state', 'province', 'region', 'prefecture'].includes(it.addresstype)) {
            s += 4;
          } else if (it.addresstype && preferredAdminTypes.has(it.addresstype)) {
            s += 2;
          }
          if (adminNamesLikelyMatch(nm, cleanQuery)) s += 3;
          if (it.geojson) s += 1;
          return s;
        };
        return score(b) - score(a);
      });

    for (const item of items) {
      if (item.osm_type !== 'relation' || !item.osm_id) continue;
      const bbox: [number, number, number, number] =
        item.boundingbox && item.boundingbox.length === 4
          ? [
              parseFloat(item.boundingbox[0]),
              parseFloat(item.boundingbox[2]),
              parseFloat(item.boundingbox[1]),
              parseFloat(item.boundingbox[3]),
            ]
          : [nearLat - 0.15, nearLng - 0.15, nearLat + 0.15, nearLng + 0.15];
      const itemName = item.name || item.display_name?.split(',')[0] || cleanQuery;
      if (
        isCountryLevelOsmArea({
          name: itemName,
          relId: item.osm_id,
          addresstype: item.addresstype,
          bbox,
        })
      ) {
        continue;
      }
      const cLat = (bbox[0] + bbox[2]) / 2;
      const cLng = (bbox[1] + bbox[3]) / 2;
      if (haversineMeters(nearLat, nearLng, cLat, cLng) > 950_000) continue;

      let boundaryGeoJson = normalizeExactGeoJsonBoundary(item.geojson);
      if (!boundaryGeoJson) {
        const opGeom = await fetchOverpassRelationBoundary(item.osm_id);
        if (opGeom?.boundaryGeoJson) boundaryGeoJson = opGeom.boundaryGeoJson;
      }
      if (!boundaryGeoJson) continue;
      return {
        regionId: `osm_rel_${item.osm_id}`,
        relId: item.osm_id,
        regionName: itemName,
        adminLevel: '4',
        bbox,
        boundaryGeoJson,
        exactBoundaryVersion: 2,
      };
    }
  } catch {
    // Ignore Nominatim search failures
  }
  return null;
}

export async function resolveOsmProvincialRegion(
  lat: number,
  lng: number,
  expectedRegionName?: string
): Promise<ResolvedAdminRegion | null> {
  try {
    const query = `[out:json][timeout:7];is_in(${lat.toFixed(6)},${lng.toFixed(6)})->.a;area.a["boundary"="administrative"]["admin_level"~"^(4|5|6|7|8)$"];out tags;`;
    const areaRes = await fetchOverpassQuery(query, 7500);
    const areas = (areaRes.elements || []).filter(
      (el): el is { type: 'area'; id: number; tags?: Record<string, string> } =>
        el.type === 'area' && 'id' in el
    );

    const getAreaName = (a?: { id: number; tags?: Record<string, string> }) =>
      a?.tags?.['name:ko'] || a?.tags?.name || a?.tags?.['name:en'] || '';

    const validAreas = areas.filter((a) => {
      const relId = a.id > 3600000000 ? a.id - 3600000000 : a.id;
      return !isCountryLevelOsmArea({
        name: getAreaName(a),
        relId,
        tags: a.tags,
      });
    });

    const byLevel = (lvl: string) => validAreas.filter((a) => a.tags?.admin_level === lvl);
    const primaryCountyAreas = [...byLevel('6'), ...byLevel('7')];
    const primaryCountyMatch = expectedRegionName
      ? primaryCountyAreas.find((a) => adminNamesLikelyMatch(getAreaName(a), expectedRegionName))
      : undefined;
    const subCityMatch =
      primaryCountyAreas.length === 0 && expectedRegionName
        ? byLevel('8').find((a) => adminNamesLikelyMatch(getAreaName(a), expectedRegionName))
        : undefined;
    const coarseAreas = [...byLevel('5'), ...byLevel('4')];
    const coarseNameMatched =
      primaryCountyAreas.length === 0 && byLevel('8').length === 0 && expectedRegionName
        ? coarseAreas.find((a) => adminNamesLikelyMatch(getAreaName(a), expectedRegionName))
        : undefined;

    // Prefer county / county-equivalent globally:
    // 6 = US county, KR 시·군·구, FR département, UK unitary
    // 7 = JP 시구정촌/특별구
    // 8 = UK London boroughs / fine cities (only when no level 6/7 exists)
    // Fallback to 5/4 only when no 6/7/8 exists
    const targetArea =
      primaryCountyMatch ||
      byLevel('6')[0] ||
      byLevel('7')[0] ||
      subCityMatch ||
      byLevel('8')[0] ||
      coarseNameMatched ||
      byLevel('5')[0] ||
      byLevel('4')[0];

    const subDistrictArea =
      targetArea && targetArea.tags?.admin_level !== '8' ? byLevel('8')[0] : undefined;

    if (targetArea) {
      const relId = targetArea.id > 3600000000 ? targetArea.id - 3600000000 : targetArea.id;
      const distRelId =
        subDistrictArea && subDistrictArea.id > 3600000000
          ? subDistrictArea.id - 3600000000
          : subDistrictArea?.id;
      const displayName = getAreaName(targetArea) || `Region #${relId}`;
      const adminLevel = targetArea.tags?.admin_level || '6';

      let bbox: [number, number, number, number] = [
        lat - 0.055,
        lng - 0.068,
        lat + 0.055,
        lng + 0.068,
      ];
      let hasExplicitBbox = false;
      let districtBbox: [number, number, number, number] | undefined;
      let boundaryGeoJson: GeoJsonBoundary | undefined;

      try {
        const ids = distRelId && distRelId !== relId ? `R${relId},R${distRelId}` : `R${relId}`;
        const nomRes = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json&polygon_geojson=1&polygon_threshold=0.0004&accept-language=ko,en`,
          { headers: buildRequestHeaders('application/json') },
          9500
        );
        if (nomRes.ok) {
          const items = (await nomRes.json()) as Array<{
            osm_id: number;
            boundingbox?: [string, string, string, string];
            geojson?: unknown;
          }>;
          const pItem = items.find((i) => i.osm_id === relId);
          if (pItem?.boundingbox && pItem.boundingbox.length === 4) {
            bbox = [
              parseFloat(pItem.boundingbox[0]),
              parseFloat(pItem.boundingbox[2]),
              parseFloat(pItem.boundingbox[1]),
              parseFloat(pItem.boundingbox[3]),
            ];
            hasExplicitBbox = true;
          }
          if (pItem?.geojson) {
            boundaryGeoJson = normalizeExactGeoJsonBoundary(pItem.geojson);
          }
          const dItem = distRelId ? items.find((i) => i.osm_id === distRelId) : undefined;
          if (dItem?.boundingbox && dItem.boundingbox.length === 4) {
            districtBbox = [
              parseFloat(dItem.boundingbox[0]),
              parseFloat(dItem.boundingbox[2]),
              parseFloat(dItem.boundingbox[1]),
              parseFloat(dItem.boundingbox[3]),
            ];
          }
        }
      } catch {
        // Fallback to Overpass relation geometry below
      }

      if (!boundaryGeoJson) {
        const opGeom = await fetchOverpassRelationBoundary(relId);
        if (opGeom?.boundaryGeoJson) {
          boundaryGeoJson = opGeom.boundaryGeoJson;
        }
        if (!hasExplicitBbox && opGeom?.bbox) {
          bbox = opGeom.bbox;
        }
      }

      if (
        !isCountryLevelOsmArea({
          name: displayName,
          relId,
          adminLevel,
          bbox,
        })
      ) {
        if (boundaryGeoJson) {
          relationBoundaryCache.set(relId, {
            bbox,
            boundaryGeoJson,
            name: displayName,
            adminLevel,
          });
        }
        return {
          regionId: `osm_rel_${relId}`,
          relId,
          regionName: displayName,
          adminLevel,
          bbox,
          districtBbox,
          boundaryGeoJson,
          exactBoundaryVersion: boundaryGeoJson ? 2 : undefined,
        };
      }
    }
  } catch {
    // Fallback to Nominatim reverse lookup below
  }

  for (const zoomLevel of [10, 8, 6]) {
    try {
      const revRes = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoomLevel}&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0004&accept-language=ko,en`,
        { headers: buildRequestHeaders('application/json') },
        8500
      );
      if (!revRes.ok) continue;
      const rev = (await revRes.json()) as {
        osm_type?: string;
        osm_id?: number;
        name?: string;
        display_name?: string;
        addresstype?: string;
        address?: {
          county?: string;
          borough?: string;
          city_district?: string;
          district?: string;
          city?: string;
          state?: string;
          province?: string;
          region?: string;
          country?: string;
        };
        boundingbox?: [string, string, string, string];
        geojson?: unknown;
      };

      const countyName =
        rev.address?.county ||
        rev.address?.borough ||
        rev.address?.city_district ||
        rev.address?.district ||
        rev.address?.city ||
        (rev.addresstype !== 'country' ? rev.name : undefined) ||
        rev.address?.state ||
        rev.address?.province ||
        rev.address?.region;

      if (
        rev.addresstype === 'country' ||
        isCountryLevelOsmArea({ name: rev.name, relId: rev.osm_id, addresstype: rev.addresstype })
      ) {
        if (countyName && !isCountryLevelOsmArea({ name: countyName })) {
          const viaName = await searchOsmProvinceByName(countyName, lat, lng);
          if (viaName) return { ...viaName, adminLevel: '6' };
        }
        continue;
      }

      if (
        (rev.addresstype === 'city' ||
          rev.addresstype === 'town' ||
          rev.addresstype === 'village' ||
          rev.addresstype === 'municipality') &&
        rev.address?.county &&
        !adminNamesLikelyMatch(rev.address.county, rev.name)
      ) {
        const countyFallback = await searchOsmProvinceByName(rev.address.county, lat, lng);
        if (countyFallback) return { ...countyFallback, adminLevel: '6' };
        if (zoomLevel > 8) continue;
      }

      const name =
        countyName ||
        rev.name ||
        rev.display_name?.split(',')[0] ||
        '';
      if (!name || isCountryLevelOsmArea({ name, relId: rev.osm_id, addresstype: rev.addresstype })) {
        continue;
      }

      let bbox: [number, number, number, number] =
        rev.boundingbox && rev.boundingbox.length === 4
          ? [
              parseFloat(rev.boundingbox[0]),
              parseFloat(rev.boundingbox[2]),
              parseFloat(rev.boundingbox[1]),
              parseFloat(rev.boundingbox[3]),
            ]
          : [lat - 0.055, lng - 0.068, lat + 0.055, lng + 0.068];
      if (isCountryLevelOsmArea({ name, relId: rev.osm_id, bbox })) {
        continue;
      }

      const relId = rev.osm_type === 'relation' && rev.osm_id ? rev.osm_id : undefined;
      let boundaryGeoJson = normalizeExactGeoJsonBoundary(rev.geojson);
      if (relId && !boundaryGeoJson) {
        const opGeom = await fetchOverpassRelationBoundary(relId);
        if (opGeom?.boundaryGeoJson) {
          boundaryGeoJson = opGeom.boundaryGeoJson;
        }
        if (!rev.boundingbox && opGeom?.bbox) {
          bbox = opGeom.bbox;
        }
      }
      const inferredLevel =
        rev.addresstype === 'borough' || rev.addresstype === 'city_district'
          ? '8'
          : rev.addresstype === 'state' || rev.addresstype === 'province'
          ? '4'
          : '6';
      return {
        regionId: relId
          ? `osm_rel_${relId}`
          : rev.osm_id
          ? `osm_nom_${rev.osm_id}`
          : `osm_grid_${quantizeChunkKey(lat, lng)}`,
        relId,
        regionName: name,
        adminLevel: inferredLevel,
        bbox,
        boundaryGeoJson,
        exactBoundaryVersion: boundaryGeoJson ? 2 : undefined,
      };
    } catch {
      // Try next zoom level
    }
  }

  if (expectedRegionName && !isCountryLevelOsmArea({ name: expectedRegionName })) {
    const byNameFallback = await searchOsmProvinceByName(expectedRegionName, lat, lng);
    if (byNameFallback && byNameFallback.boundaryGeoJson) {
      return byNameFallback;
    }
  }

  return null;
}

export interface IndexedOsmWay {
  way: OsmRawWay;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  isRail: boolean;
}

export interface PreIndexedOsmData {
  rawNodeCoords: Map<number, { lat: number; lng: number }>;
  indexedWays: IndexedOsmWay[];
  nodeRefCount: Map<number, number>;
}

export function prepareOsmElementsIndex(data: OsmMapResponse): PreIndexedOsmData {
  const elements = data.elements || [];
  const rawNodeCoords = new Map<number, { lat: number; lng: number }>();
  const validWays: OsmRawWay[] = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === 'node' && 'lat' in el && 'lon' in el && 'id' in el) {
      rawNodeCoords.set((el as OsmRawNode).id, { lat: (el as OsmRawNode).lat, lng: (el as OsmRawNode).lon });
    } else if (el.type === 'way' && 'nodes' in el && Array.isArray((el as OsmRawWay).nodes) && (el as OsmRawWay).nodes!.length >= 2) {
      const w = el as OsmRawWay;
      const hw = w.tags?.highway;
      const rw = w.tags?.railway;
      if ((hw && DRIVABLE_HIGHWAYS.has(hw)) || (rw && RAILWAYS.has(rw))) {
        validWays.push(w);
      }
    }
  }

  const nodeRefCount = new Map<number, number>();
  const indexedWays: IndexedOsmWay[] = [];
  for (let i = 0; i < validWays.length; i++) {
    const way = validWays[i];
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    const nodes = way.nodes!;
    for (let j = 0; j < nodes.length; j++) {
      const nid = nodes[j];
      nodeRefCount.set(nid, (nodeRefCount.get(nid) || 0) + 1);
      const pt = rawNodeCoords.get(nid);
      if (pt) {
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.lng < minLng) minLng = pt.lng;
        if (pt.lng > maxLng) maxLng = pt.lng;
      }
    }
    if (minLat <= maxLat) {
      indexedWays.push({
        way,
        minLat,
        maxLat,
        minLng,
        maxLng,
        isRail: Boolean(way.tags?.railway),
      });
    }
  }

  return { rawNodeCoords, indexedWays, nodeRefCount };
}

export function buildDenseRealOsmGraph(
  data: OsmMapResponse,
  chunkKey: string,
  centerLat: number,
  centerLng: number,
  options?: {
    clipLat?: number;
    clipLng?: number;
    maxEdgeMeters?: number;
    targetSubdivMeters?: number;
    roadBudget?: number;
    railBudget?: number;
    maxPerWay?: number;
    preIndexed?: PreIndexedOsmData;
  }
): ChunkPayload {
  const indexed = options?.preIndexed || prepareOsmElementsIndex(data);
  const { rawNodeCoords, indexedWays, nodeRefCount } = indexed;

  const DEG_TO_RAD = Math.PI / 180;
  const METERS_PER_DEG_LAT = 111194.9266;
  const metersPerDegLngCenter = METERS_PER_DEG_LAT * Math.cos(centerLat * DEG_TO_RAD);
  const fastEquirectMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const dLatM = (lat2 - lat1) * METERS_PER_DEG_LAT;
    const dLngM = (lng2 - lng1) * metersPerDegLngCenter;
    return Math.sqrt(dLatM * dLatM + dLngM * dLngM);
  };

  const MAX_EDGE_METERS = options?.maxEdgeMeters ?? 28.0;
  const TARGET_SUBDIV_METERS = options?.targetSubdivMeters ?? 24.0;
  const MAX_EMITTED_METERS = Math.max(45, TARGET_SUBDIV_METERS * 1.85);
  const MIN_VERTEX_METERS = options?.maxEdgeMeters ? Math.min(25, options.maxEdgeMeters * 0.35) : 10.0;
  const CLIP_LAT = options?.clipLat ?? 0.0048;
  const CLIP_LNG = options?.clipLng ?? 0.0062;
  const BRIDGE_CLIP_LAT = CLIP_LAT * 1.45;
  const BRIDGE_CLIP_LNG = CLIP_LNG * 1.45;
  const roadBudget = options?.roadBudget ?? 2600;
  const railBudget = options?.railBudget ?? 420;
  const maxPerWayBudget = options?.maxPerWay ?? 95;

  const minBoxLat = centerLat - BRIDGE_CLIP_LAT;
  const maxBoxLat = centerLat + BRIDGE_CLIP_LAT;
  const minBoxLng = centerLng - BRIDGE_CLIP_LNG;
  const maxBoxLng = centerLng + BRIDGE_CLIP_LNG;

  const validWays: OsmRawWay[] = [];
  const wayMinDistMap = new Map<number, number>();
  for (let i = 0; i < indexedWays.length; i++) {
    const iw = indexedWays[i];
    if (
      iw.maxLat < minBoxLat ||
      iw.minLat > maxBoxLat ||
      iw.maxLng < minBoxLng ||
      iw.minLng > maxBoxLng
    ) {
      continue;
    }
    const way = iw.way;
    let minD = 99999;
    for (const nid of way.nodes!) {
      const pt = rawNodeCoords.get(nid);
      if (!pt) continue;
      const d = fastEquirectMeters(centerLat, centerLng, pt.lat, pt.lng);
      if (d < minD) minD = d;
    }
    wayMinDistMap.set(way.id, minD);
    validWays.push(way);
  }

  validWays.sort((a, b) => {
    const aDist = wayMinDistMap.get(a.id) ?? 99999;
    const bDist = wayMinDistMap.get(b.id) ?? 99999;
    const bandDiff = Math.floor(aDist / 120) - Math.floor(bDist / 120);
    if (bandDiff !== 0) return bandDiff;
    const pDiff = getWayPriority(a) - getWayPriority(b);
    if (pDiff !== 0) return pDiff;
    return aDist - bDist;
  });

  const nodeMap = new Map<string, OsmNode>();
  const edgeMap = new Map<string, OsmEdge>();

  const roadWays = validWays.filter((w) => !w.tags?.railway);
  const railWays = validWays.filter((w) => Boolean(w.tags?.railway));

  const registerNodeMode = (
    node: { id: string; lat: number; lng: number; label: string },
    mode: 'road' | 'rail'
  ) => {
    const existing = nodeMap.get(node.id);
    if (!existing) {
      nodeMap.set(node.id, {
        id: node.id,
        lat: node.lat,
        lng: node.lng,
        connected: false,
        mode,
        label: node.label,
      });
    } else if (existing.mode !== mode && existing.mode !== 'mixed') {
      existing.mode = 'mixed';
    }
  };

  // Spatial grid keyed by `${mode}:${layerKey}` to collapse nearly-coincident (<=2.0m) duplicate OSM vertices
  // while strictly preserving parallel carriageways (>=6m apart) and stacked bridges/tunnels (different layerKey).
  // Additionally, highway=steps specifically connect vertical layers (ground <-> bridge/tunnel/subway), so steps
  // endpoints (i === 0 || i === densePts.length - 1) can bridge across road layerKeys within 2.8m.
  const SNAP_CELL_DEG = 0.0001;
  const SNAP_METERS = 2.0;
  const STEPS_CROSS_LAYER_SNAP_METERS = 2.8;
  const snapGridByLayer = new Map<string, Map<string, Array<{ id: string; lat: number; lng: number }>>>();
  const roadAllLayerGrid = new Map<string, Array<{ id: string; lat: number; lng: number }>>();
  const stepsEndpointGrid = new Map<string, Array<{ id: string; lat: number; lng: number }>>();
  const snappedAlias = new Map<string, { id: string; lat: number; lng: number }>();

  const pushGridPoint = (
    targetGrid: Map<string, Array<{ id: string; lat: number; lng: number }>>,
    cellKey: string,
    vertex: { id: string; lat: number; lng: number }
  ) => {
    let b = targetGrid.get(cellKey);
    if (!b) {
      b = [];
      targetGrid.set(cellKey, b);
    }
    b.push(vertex);
  };

  const findNearestInGrid = (
    targetGrid: Map<string, Array<{ id: string; lat: number; lng: number }>> | undefined,
    gx: number,
    gy: number,
    pt: { lat: number; lng: number },
    maxMeters: number
  ): { id: string; lat: number; lng: number } | null => {
    if (!targetGrid) return null;
    let bestMatch: { id: string; lat: number; lng: number } | null = null;
    let bestDist = maxMeters;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = targetGrid.get(`${gx + dx}_${gy + dy}`);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const cand = bucket[k];
          const d = fastEquirectMeters(cand.lat, cand.lng, pt.lat, pt.lng);
          if (d <= bestDist) {
            bestDist = d;
            bestMatch = cand;
          }
        }
      }
    }
    return bestMatch;
  };

  const resolveOrRegisterSnapVertex = (
    pt: { id: string; lat: number; lng: number; label: string },
    mode: 'road' | 'rail',
    layerKey: string,
    options?: { isStepsEndpoint?: boolean; isStepsWay?: boolean }
  ): { id: string; lat: number; lng: number; label: string } => {
    const existingNode = nodeMap.get(pt.id);
    if (existingNode) {
      return { id: existingNode.id, lat: existingNode.lat, lng: existingNode.lng, label: pt.label };
    }
    const aliased = snappedAlias.get(pt.id);
    if (aliased) {
      return { id: aliased.id, lat: aliased.lat, lng: aliased.lng, label: pt.label };
    }

    const groupKey = `${mode}:${layerKey}`;
    let grid = snapGridByLayer.get(groupKey);
    if (!grid) {
      grid = new Map();
      snapGridByLayer.set(groupKey, grid);
    }
    const gx = Math.floor(pt.lat / SNAP_CELL_DEG);
    const gy = Math.floor(pt.lng / SNAP_CELL_DEG);
    const cellKey = `${gx}_${gy}`;

    let bestMatch = findNearestInGrid(grid, gx, gy, pt, SNAP_METERS);
    if (!bestMatch && mode === 'road') {
      if (options?.isStepsEndpoint) {
        bestMatch = findNearestInGrid(roadAllLayerGrid, gx, gy, pt, STEPS_CROSS_LAYER_SNAP_METERS);
      } else if (!options?.isStepsWay) {
        bestMatch = findNearestInGrid(stepsEndpointGrid, gx, gy, pt, STEPS_CROSS_LAYER_SNAP_METERS);
      }
    }

    if (bestMatch) {
      snappedAlias.set(pt.id, bestMatch);
      return { id: bestMatch.id, lat: bestMatch.lat, lng: bestMatch.lng, label: pt.label };
    }

    const vertex = { id: pt.id, lat: pt.lat, lng: pt.lng };
    pushGridPoint(grid, cellKey, vertex);
    if (mode === 'road') {
      pushGridPoint(roadAllLayerGrid, cellKey, vertex);
      if (options?.isStepsEndpoint) {
        pushGridPoint(stepsEndpointGrid, cellKey, vertex);
      }
    }
    return pt;
  };

  const segmentIntersectsClipBox = (
    p1: { lat: number; lng: number },
    p2: { lat: number; lng: number }
  ): boolean => {
    const minX = centerLng - CLIP_LNG;
    const maxX = centerLng + CLIP_LNG;
    const minY = centerLat - CLIP_LAT;
    const maxY = centerLat + CLIP_LAT;
    let t0 = 0;
    let t1 = 1;
    const dx = p2.lng - p1.lng;
    const dy = p2.lat - p1.lat;
    const checks: Array<[number, number]> = [
      [-dx, p1.lng - minX],
      [dx, maxX - p1.lng],
      [-dy, p1.lat - minY],
      [dy, maxY - p1.lat],
    ];
    for (let k = 0; k < 4; k++) {
      const p = checks[k][0];
      const q = checks[k][1];
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return false;
      } else {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return t0 <= t1;
  };

  const emitWaysWithBudget = (waysList: OsmRawWay[], maxEdgesForGroup: number, maxPerWay: number) => {
    let groupAdded = 0;

    for (const way of waysList) {
      if (groupAdded >= maxEdgesForGroup) break;

      const wayNodes = way.nodes!;
      const isRail = Boolean(way.tags?.railway);
      const mode: 'road' | 'rail' = isRail ? 'rail' : 'road';
      const hwType = way.tags?.railway || way.tags?.highway || 'road';
      const isLongSpanEligible =
        way.tags?.bridge === 'yes' ||
        way.tags?.tunnel === 'yes' ||
        hwType === 'motorway' ||
        hwType === 'motorway_link' ||
        hwType === 'trunk' ||
        hwType === 'trunk_link' ||
        hwType === 'primary' ||
        hwType === 'primary_link' ||
        isRail;
      const effectiveMaxPerWay = isLongSpanEligible ? Math.max(maxPerWay, 950) : maxPerWay;
      const groupCapForWay = isLongSpanEligible ? maxEdgesForGroup + 320 : maxEdgesForGroup;
      const wayName =
        way.tags?.['name:ko'] ||
        way.tags?.name ||
        way.tags?.ref ||
        `${hwType.toUpperCase()} #${way.id}`;

      const isInsideClip = (coord: { lat: number; lng: number }) =>
        Math.abs(coord.lat - centerLat) <= CLIP_LAT &&
        Math.abs(coord.lng - centerLng) <= CLIP_LNG;

      const isInsideBridgeClip = (coord: { lat: number; lng: number }) =>
        Math.abs(coord.lat - centerLat) <= BRIDGE_CLIP_LAT &&
        Math.abs(coord.lng - centerLng) <= BRIDGE_CLIP_LNG;

      const basePts: { id: string; lat: number; lng: number; label: string }[] = [];
      for (let i = 0; i < wayNodes.length; i++) {
        const osmId = wayNodes[i];
        const coord = rawNodeCoords.get(osmId);
        if (!coord) continue;

        const inClip = isInsideClip(coord);
        let keepAsBoundaryBridge = false;
        if (!inClip) {
          const prevCoord = i > 0 ? rawNodeCoords.get(wayNodes[i - 1]) : undefined;
          const nextCoord = i + 1 < wayNodes.length ? rawNodeCoords.get(wayNodes[i + 1]) : undefined;
          const touchesClip =
            Boolean(prevCoord && isInsideClip(prevCoord)) ||
            Boolean(nextCoord && isInsideClip(nextCoord));
          const crossesClipSpan =
            isLongSpanEligible &&
            ((Boolean(prevCoord) &&
              segmentIntersectsClipBox(prevCoord!, coord) &&
              fastEquirectMeters(prevCoord!.lat, prevCoord!.lng, coord.lat, coord.lng) <= 22000) ||
              (Boolean(nextCoord) &&
                segmentIntersectsClipBox(coord, nextCoord!) &&
                fastEquirectMeters(coord.lat, coord.lng, nextCoord!.lat, nextCoord!.lng) <= 22000));
          const inLongSpanRange =
            isLongSpanEligible &&
            (touchesClip || crossesClipSpan) &&
            fastEquirectMeters(centerLat, centerLng, coord.lat, coord.lng) <= 22000;
          if (!inLongSpanRange) {
            if (!isInsideBridgeClip(coord)) continue;
            keepAsBoundaryBridge = touchesClip;
            if (!keepAsBoundaryBridge) continue;
          } else {
            keepAsBoundaryBridge = true;
          }
        }

        const isMandatory =
          keepAsBoundaryBridge ||
          i === 0 ||
          i === wayNodes.length - 1 ||
          (nodeRefCount.get(osmId) || 0) > 1;
        const prev = basePts[basePts.length - 1];
        if (
          !prev ||
          isMandatory ||
          fastEquirectMeters(prev.lat, prev.lng, coord.lat, coord.lng) >= MIN_VERTEX_METERS
        ) {
          const id = `osm_${osmId}`;
          basePts.push({
            id,
            lat: coord.lat,
            lng: coord.lng,
            label: (nodeRefCount.get(osmId) || 0) > 1 ? `${wayName} 교차점` : wayName,
          });
        }
      }

      if (basePts.length < 2) continue;

      const densePts: { id: string; lat: number; lng: number; label: string }[] = [];
      for (let i = 0; i < basePts.length; i++) {
        const curr = basePts[i];
        if (i === 0) {
          densePts.push(curr);
          continue;
        }
        const prev = basePts[i - 1];
        const segMeters = fastEquirectMeters(prev.lat, prev.lng, curr.lat, curr.lng);

        if (segMeters > 25000) {
          densePts.push(curr);
          continue;
        }

        if (segMeters > MAX_EDGE_METERS) {
          const maxSubSteps = isLongSpanEligible ? 950 : 120;
          const subCount = Math.min(maxSubSteps, Math.ceil(segMeters / TARGET_SUBDIV_METERS));
          const pairKey = prev.id < curr.id ? `${prev.id}_${curr.id}` : `${curr.id}_${prev.id}`;
          const forward = prev.id < curr.id;

          for (let s = 1; s < subCount; s++) {
            const t = s / subCount;
            const lat = Math.round((prev.lat + (curr.lat - prev.lat) * t) * 1e6) / 1e6;
            const lng = Math.round((prev.lng + (curr.lng - prev.lng) * t) * 1e6) / 1e6;
            const subIdx = forward ? s : subCount - s;
            const subId = `osm_sub_${pairKey}_${subIdx}`;
            densePts.push({
              id: subId,
              lat,
              lng,
              label: `${wayName} (약 ${Math.round(segMeters / subCount)}m 간격)`,
            });
          }
        }
        densePts.push(curr);
      }

      const tierMult =
        hwType.startsWith('motorway') || hwType.startsWith('trunk') || isRail
          ? 1.9
          : hwType.startsWith('primary')
          ? 1.5
          : hwType.startsWith('secondary')
          ? 1.25
          : hwType.startsWith('tertiary')
          ? 1.1
          : hwType === 'footway' || hwType === 'path' || hwType === 'cycleway' || hwType === 'steps'
          ? 0.75
          : hwType === 'service' || hwType === 'track' || hwType === 'pedestrian'
          ? 0.85
          : 0.9;

      const layerKey = `${way.tags?.layer || '0'}_${
        way.tags?.tunnel === 'yes' ? 't' : way.tags?.bridge === 'yes' ? 'b' : 'g'
      }`;
      const isStepsWay = hwType === 'steps';
      const snappedPts = densePts.map((pt, idx) =>
        resolveOrRegisterSnapVertex(pt, mode, layerKey, {
          isStepsWay,
          isStepsEndpoint: isStepsWay && (idx === 0 || idx === densePts.length - 1),
        })
      );

      let wayAdded = 0;
      for (let i = 0; i < snappedPts.length - 1; i++) {
        if (groupAdded >= groupCapForWay || wayAdded >= effectiveMaxPerWay) break;
        const a = snappedPts[i];
        const b = snappedPts[i + 1];
        if (a.id === b.id) continue;

        const distM = fastEquirectMeters(a.lat, a.lng, b.lat, b.lng);
        if (distM > MAX_EMITTED_METERS) continue;

        const edgeId = a.id < b.id ? `oe_${a.id}_${b.id}` : `oe_${b.id}_${a.id}`;
        if (edgeMap.has(edgeId)) continue;

        registerNodeMode(a, mode);
        registerNodeMode(b, mode);

        const distKm = Math.max(0.008, Math.round((distM / 1000) * 1000) / 1000);

        edgeMap.set(edgeId, {
          id: edgeId,
          wayName,
          highwayType: hwType,
          mode,
          fromNodeId: a.id,
          toNodeId: b.id,
          coordinates: [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          distanceKm: distKm,
          buildCost: Math.max(20, Math.round(28 * tierMult * (1 + distM / 30))),
          baseIncomePerSec: Math.round(1.6 * tierMult * (1 + distM / 25) * 10) / 10,
          built: false,
        });
        groupAdded++;
        wayAdded++;
      }
    }
  };

  emitWaysWithBudget(roadWays, roadBudget, maxPerWayBudget);
  emitWaysWithBudget(railWays, railBudget, maxPerWayBudget);

  return {
    chunkKey,
    osmNodes: Array.from(nodeMap.values()),
    osmEdges: Array.from(edgeMap.values()),
    usedLiveOverpass: true,
    source: 'osm-0.6-api',
    wayCount: validWays.length,
  };
}

export function clampBbox(
  bbox: [number, number, number, number],
  centerLat: number,
  centerLng: number,
  maxHalfLat: number,
  maxHalfLng: number
): [number, number, number, number] {
  return [
    Math.max(bbox[0], centerLat - maxHalfLat),
    Math.max(bbox[1], centerLng - maxHalfLng),
    Math.min(bbox[2], centerLat + maxHalfLat),
    Math.min(bbox[3], centerLng + maxHalfLng),
  ];
}

async function resolveKnownOsmRelation(
  relId: number,
  lat: number,
  lng: number,
  expectedRegionName?: string
): Promise<ResolvedAdminRegion | null> {
  const cachedRel = relationBoundaryCache.get(relId);
  if (cachedRel?.boundaryGeoJson && cachedRel.bbox) {
    const name = cachedRel.name || expectedRegionName || `Region #${relId}`;
    const adminLevel = cachedRel.adminLevel || '6';
    if (!isCountryLevelOsmArea({ name, relId, adminLevel, bbox: cachedRel.bbox })) {
      return {
        regionId: `osm_rel_${relId}`,
        relId,
        regionName: name,
        adminLevel,
        bbox: cachedRel.bbox,
        boundaryGeoJson: cachedRel.boundaryGeoJson,
        exactBoundaryVersion: 2,
      };
    }
  }

  let bbox: [number, number, number, number] | undefined = cachedRel?.bbox;
  let boundaryGeoJson: GeoJsonBoundary | undefined = cachedRel?.boundaryGeoJson;
  let regionName = cachedRel?.name || expectedRegionName || '';
  let adminLevel = cachedRel?.adminLevel || '6';

  try {
    const nomRes = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/lookup?osm_ids=R${relId}&format=json&polygon_geojson=1&polygon_threshold=0.0004&addressdetails=1&accept-language=ko,en`,
      { headers: buildRequestHeaders('application/json') },
      8000
    );
    if (nomRes.ok) {
      const items = (await nomRes.json()) as Array<{
        osm_id?: number;
        name?: string;
        display_name?: string;
        addresstype?: string;
        boundingbox?: [string, string, string, string];
        geojson?: unknown;
      }>;
      const item = items.find((i) => i.osm_id === relId) || items[0];
      if (item) {
        if (item.boundingbox && item.boundingbox.length === 4) {
          bbox = [
            parseFloat(item.boundingbox[0]),
            parseFloat(item.boundingbox[2]),
            parseFloat(item.boundingbox[1]),
            parseFloat(item.boundingbox[3]),
          ];
        }
        const gj = normalizeExactGeoJsonBoundary(item.geojson);
        if (gj) boundaryGeoJson = gj;
        regionName = item.name || item.display_name?.split(',')[0] || regionName;
        if (item.addresstype === 'state' || item.addresstype === 'province') adminLevel = '4';
        else if (item.addresstype === 'borough' || item.addresstype === 'city_district') adminLevel = '8';
      }
    }
  } catch {
    // Fallback to Overpass below
  }

  if (!boundaryGeoJson) {
    const opGeom = await fetchOverpassRelationBoundary(relId);
    if (opGeom?.boundaryGeoJson) {
      boundaryGeoJson = opGeom.boundaryGeoJson;
    }
    if (!bbox && opGeom?.bbox) {
      bbox = opGeom.bbox;
    }
  }

  if (!boundaryGeoJson) return null;
  const finalBbox: [number, number, number, number] = bbox || [
    lat - 0.055,
    lng - 0.068,
    lat + 0.055,
    lng + 0.068,
  ];
  const finalName = regionName || `Region #${relId}`;
  if (isCountryLevelOsmArea({ name: finalName, relId, adminLevel, bbox: finalBbox })) {
    return null;
  }
  relationBoundaryCache.set(relId, {
    bbox: finalBbox,
    boundaryGeoJson,
    name: finalName,
    adminLevel,
  });
  return {
    regionId: `osm_rel_${relId}`,
    relId,
    regionName: finalName,
    adminLevel,
    bbox: finalBbox,
    boundaryGeoJson,
    exactBoundaryVersion: 2,
  };
}

export async function resolveRegionCached(
  lat: number,
  lng: number,
  expectedRegionName?: string,
  knownRegionId?: string
): Promise<ResolvedAdminRegion | null> {
  const relMatch = knownRegionId?.match(/^osm_rel_(\d+)$/);
  const knownRelId = relMatch ? Number(relMatch[1]) : undefined;
  const key = knownRelId
    ? `rel:${knownRelId}`
    : expectedRegionName
    ? `${quantizeChunkKey(lat, lng)}:${normalizeNameToken(expectedRegionName)}`
    : quantizeChunkKey(lat, lng);
  const cachedInfo = regionInfoCache.get(key);
  if (cachedInfo && cachedInfo.boundaryGeoJson) return cachedInfo;

  let pendingInfo = inFlightRegionInfo.get(key);
  if (!pendingInfo) {
    pendingInfo = (async () => {
      if (knownRelId) {
        const directRel = await resolveKnownOsmRelation(knownRelId, lat, lng, expectedRegionName);
        if (directRel && directRel.boundaryGeoJson) {
          regionInfoCache.set(key, directRel);
          return directRel;
        }
      }
      const resolved = await resolveOsmProvincialRegion(lat, lng, expectedRegionName);
      if (resolved && resolved.boundaryGeoJson && !isCountryLevelOsmArea(resolved)) {
        regionInfoCache.set(key, resolved);
      }
      return resolved;
    })();
    inFlightRegionInfo.set(key, pendingInfo);
    pendingInfo.finally(() => inFlightRegionInfo.delete(key));
  }
  return pendingInfo;
}

export async function loadOsmRoadChunkDirect(
  lat: number,
  lng: number,
  options?: { allowStarterFallback?: boolean; bypassCache?: boolean }
): Promise<ChunkPayload> {
  const chunkKey = quantizeChunkKey(lat, lng);
  if (!options?.bypassCache) {
    const cached = chunkCache.get(chunkKey);
    if (cached && (cached.osmEdges.length > 0 || cached.usedLiveOverpass)) {
      return cached;
    }
  }

  let pending = inFlightChunks.get(chunkKey);
  if (!pending) {
    pending = (async () => {
      let hadLiveResponse = false;
      const dLat1 = 0.0046;
      const dLng1 = 0.0059;
      let raw = await fetchOsmBbox(lat - dLat1, lng - dLng1, lat + dLat1, lng + dLng1, 8000);
      if (raw !== null) hadLiveResponse = true;
      let payload = raw ? buildDenseRealOsmGraph(raw, chunkKey, lat, lng) : null;

      if (hadLiveResponse && (!payload || payload.osmEdges.length < 4)) {
        const dLat2 = 0.010;
        const dLng2 = 0.013;
        raw = await fetchOsmBbox(lat - dLat2, lng - dLng2, lat + dLat2, lng + dLng2, 8500);
        if (raw !== null) {
          hadLiveResponse = true;
          payload = buildDenseRealOsmGraph(raw, chunkKey, lat, lng, {
            clipLat: 0.011,
            clipLng: 0.014,
            maxEdgeMeters: 45,
            targetSubdivMeters: 36,
          });
        }
      } else if (!hadLiveResponse) {
        // Retry once with same compact bbox on any healthy mirror/OSM0.6
        raw = await fetchOsmBbox(lat - dLat1, lng - dLng1, lat + dLat1, lng + dLng1, 8500);
        if (raw !== null) {
          hadLiveResponse = true;
          payload = buildDenseRealOsmGraph(raw, chunkKey, lat, lng);
        }
      }

      if (payload && payload.osmEdges.length > 0) {
        setChunkCache(chunkKey, payload);
        return payload;
      }

      if (hadLiveResponse || options?.allowStarterFallback === false) {
        const emptyPayload: ChunkPayload = {
          chunkKey,
          osmNodes: [],
          osmEdges: [],
          usedLiveOverpass: hadLiveResponse,
          source: 'osm-0.6-api',
          wayCount: 0,
        };
        if (hadLiveResponse) {
          setChunkCache(chunkKey, emptyPayload);
        }
        return emptyPayload;
      }

      return buildFallbackStarterGrid(chunkKey, lat, lng);
    })();
    inFlightChunks.set(chunkKey, pending);
    pending.finally(() => inFlightChunks.delete(chunkKey));
  }

  const res = await pending;
  if (
    !res.usedLiveOverpass &&
    res.osmNodes.length === 0 &&
    options?.allowStarterFallback !== false
  ) {
    return buildFallbackStarterGrid(chunkKey, lat, lng);
  }
  return res;
}

export async function loadOsmRoadChunksBatchDirect(
  coords: Array<{ lat: number; lng: number }>,
  options?: { allowStarterFallback?: boolean; bypassCache?: boolean }
): Promise<ChunkPayload[]> {
  const deduped: Array<{ key: string; lat: number; lng: number }> = [];
  const seenKeys = new Set<string>();
  for (const pt of coords) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) continue;
    const key = quantizeChunkKey(pt.lat, pt.lng);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push({ key, lat: pt.lat, lng: pt.lng });
  }
  if (deduped.length === 0) return [];

  const resultsByKey = new Map<string, ChunkPayload>();
  const pendingCoords: Array<{ key: string; lat: number; lng: number }> = [];
  const inFlightWaiters: Array<Promise<void>> = [];
  for (const pt of deduped) {
    if (!options?.bypassCache) {
      const cached = chunkCache.get(pt.key);
      if (cached && (cached.osmEdges.length > 0 || cached.usedLiveOverpass)) {
        resultsByKey.set(pt.key, cached);
        continue;
      }
    }
    const existingFlight = inFlightChunks.get(pt.key);
    if (existingFlight) {
      inFlightWaiters.push(
        existingFlight.then((val) => {
          resultsByKey.set(pt.key, val);
        }).catch(() => undefined)
      );
      continue;
    }
    pendingCoords.push(pt);
  }

  // Group nearby chunks into macro bounding-box clusters (<= 0.065 deg lat x 0.085 deg lng, max 48 chunks)
  const clusters: Array<Array<{ key: string; lat: number; lng: number }>> = [];
  for (const pt of pendingCoords) {
    let targetCluster: Array<{ key: string; lat: number; lng: number }> | null = null;
    for (const cl of clusters) {
      if (cl.length >= 48) continue;
      let minLat = pt.lat;
      let maxLat = pt.lat;
      let minLng = pt.lng;
      let maxLng = pt.lng;
      for (const item of cl) {
        if (item.lat < minLat) minLat = item.lat;
        if (item.lat > maxLat) maxLat = item.lat;
        if (item.lng < minLng) minLng = item.lng;
        if (item.lng > maxLng) maxLng = item.lng;
      }
      if (maxLat - minLat <= 0.065 && maxLng - minLng <= 0.085) {
        targetCluster = cl;
        break;
      }
    }
    if (targetCluster) {
      targetCluster.push(pt);
    } else {
      clusters.push([pt]);
    }
  }

  const MAX_CONCURRENT_CLUSTERS = 4;
  for (let start = 0; start < clusters.length; start += MAX_CONCURRENT_CLUSTERS) {
    const wave = clusters.slice(start, start + MAX_CONCURRENT_CLUSTERS);
    await Promise.allSettled(
      wave.map(async (cluster) => {
        if (cluster.length === 1) {
          const single = await loadOsmRoadChunkDirect(cluster[0].lat, cluster[0].lng, options);
          resultsByKey.set(cluster[0].key, single);
          return;
        }
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLng = Infinity;
        let maxLng = -Infinity;
        for (const pt of cluster) {
          if (pt.lat < minLat) minLat = pt.lat;
          if (pt.lat > maxLat) maxLat = pt.lat;
          if (pt.lng < minLng) minLng = pt.lng;
          if (pt.lng > maxLng) maxLng = pt.lng;
        }
        const raw = await fetchOsmBbox(
          minLat - 0.0048,
          minLng - 0.0062,
          maxLat + 0.0048,
          maxLng + 0.0062,
          12500
        );
        const failedPoints: Array<{ key: string; lat: number; lng: number }> = [];
        if (raw) {
          const preIndexed = prepareOsmElementsIndex(raw);
          for (const pt of cluster) {
            const payload = buildDenseRealOsmGraph(raw, pt.key, pt.lat, pt.lng, { preIndexed });
            setChunkCache(pt.key, payload);
            resultsByKey.set(pt.key, payload);
          }
        } else {
          failedPoints.push(...cluster);
        }

        if (failedPoints.length > 0) {
          for (const pt of failedPoints) {
            if (options?.allowStarterFallback !== false) {
              const fb = buildFallbackStarterGrid(pt.key, pt.lat, pt.lng);
              resultsByKey.set(pt.key, fb);
            } else {
              resultsByKey.set(pt.key, {
                chunkKey: pt.key,
                osmNodes: [],
                osmEdges: [],
                usedLiveOverpass: false,
                source: 'osm-0.6-api',
                wayCount: 0,
              });
            }
          }
        }
      })
    );
  }

  if (inFlightWaiters.length > 0) {
    await Promise.allSettled(inFlightWaiters);
  }

  return deduped
    .map((pt) => resultsByKey.get(pt.key))
    .filter((item): item is ChunkPayload => Boolean(item));
}

export async function loadOsmRegionInfoDirect(
  lat: number,
  lng: number,
  expectedRegionName?: string,
  knownRegionId?: string
): Promise<ProvincialRegionMeta> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const region = await resolveRegionCached(lat, lng, expectedRegionName, knownRegionId);
  if (!region || isCountryLevelOsmArea(region)) {
    return {
      regionId: `osm_prov_${chunkKey}`,
      regionName: '인접 행정구역',
      adminLevel: '6',
      bbox: [lat - 0.055, lng - 0.068, lat + 0.055, lng + 0.068],
      centerLat: lat,
      centerLng: lng,
    };
  }
  return {
    regionId: region.regionId,
    regionName: region.regionName,
    adminLevel: region.adminLevel,
    bbox: region.bbox,
    boundaryGeoJson: region.boundaryGeoJson,
    exactBoundaryVersion: region.exactBoundaryVersion || (region.boundaryGeoJson ? 2 : undefined),
    centerLat: (region.bbox[0] + region.bbox[2]) / 2,
    centerLng: (region.bbox[1] + region.bbox[3]) / 2,
  };
}

export async function loadNearbyProvincialRegionsDirect(
  lat: number,
  lng: number
): Promise<ProvincialRegionMeta[]> {
  try {
    const south = (lat - 0.16).toFixed(5);
    const north = (lat + 0.16).toFixed(5);
    const west = (lng - 0.22).toFixed(5);
    const east = (lng + 0.22).toFixed(5);
    let rawRes = await fetchOverpassQuery(
      `[out:json][timeout:8];rel["boundary"="administrative"]["admin_level"~"^(6|7|8)$"](${south},${west},${north},${east});out tags bb;`,
      8500
    );
    let rawRels = (rawRes.elements || []).filter(
      (
        el
      ): el is {
        type: 'relation';
        id: number;
        tags?: Record<string, string>;
        bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
      } => el.type === 'relation' && 'id' in el && Boolean((el as { bounds?: unknown }).bounds)
    );

    const level67 = rawRels.filter(
      (r) => r.tags?.admin_level === '6' || r.tags?.admin_level === '7'
    );
    if (level67.length < 3) {
      try {
        const wideS = (lat - 0.44).toFixed(5);
        const wideN = (lat + 0.44).toFixed(5);
        const wideW = (lng - 0.58).toFixed(5);
        const wideE = (lng + 0.58).toFixed(5);
        const wideRes = await fetchOverpassQuery(
          `[out:json][timeout:8];rel["boundary"="administrative"]["admin_level"~"^(6|7)$"](${wideS},${wideW},${wideN},${wideE});out tags bb;`,
          8500
        );
        const wideRels = (wideRes.elements || []).filter(
          (
            el
          ): el is {
            type: 'relation';
            id: number;
            tags?: Record<string, string>;
            bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
          } => el.type === 'relation' && 'id' in el && Boolean((el as { bounds?: unknown }).bounds)
        );
        if (wideRels.length > rawRels.length) {
          rawRels = wideRels;
        }
      } catch {
        // Keep narrower query results
      }
    }

    const hasPrimary67 =
      rawRels.filter((r) => r.tags?.admin_level === '6' || r.tags?.admin_level === '7').length >= 3;
    const filteredRels = rawRels
      .filter((r) => {
        const lvl = r.tags?.admin_level || '6';
        if (hasPrimary67 && lvl === '8') return false;
        const name = r.tags?.['name:ko'] || r.tags?.name || r.tags?.['name:en'] || '';
        if (!name || !r.bounds) return false;
        const bbox: [number, number, number, number] = [
          r.bounds.minlat,
          r.bounds.minlon,
          r.bounds.maxlat,
          r.bounds.maxlon,
        ];
        return !isCountryLevelOsmArea({ name, relId: r.id, adminLevel: lvl, bbox });
      })
      .map((r) => {
        const b = r.bounds!;
        const cLat = (b.minlat + b.maxlat) / 2;
        const cLng = (b.minlon + b.maxlon) / 2;
        const dist = haversineMeters(lat, lng, cLat, cLng);
        return { r, cLat, cLng, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 16);

    if (filteredRels.length > 0) {
      const geoById = new Map<number, GeoJsonBoundary>();
      const uncachedNomIds: number[] = [];
      for (const { r } of filteredRels) {
        const cached = relationBoundaryCache.get(r.id);
        if (cached?.boundaryGeoJson) {
          geoById.set(r.id, cached.boundaryGeoJson);
        } else {
          uncachedNomIds.push(r.id);
        }
      }

      if (uncachedNomIds.length > 0) {
        try {
          const osmIds = uncachedNomIds.map((id) => `R${id}`).join(',');
          const lookupRes = await fetchWithTimeout(
            `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmIds}&format=json&polygon_geojson=1&polygon_threshold=0.0004&accept-language=ko,en`,
            { headers: buildRequestHeaders('application/json') },
            9500
          );
          if (lookupRes.ok) {
            const items = (await lookupRes.json()) as Array<{
              osm_id: number;
              geojson?: unknown;
            }>;
            for (const item of items) {
              const gj = normalizeExactGeoJsonBoundary(item.geojson);
              if (gj) {
                geoById.set(item.osm_id, gj);
                const prev = relationBoundaryCache.get(item.osm_id);
                relationBoundaryCache.set(item.osm_id, {
                  ...prev,
                  boundaryGeoJson: gj,
                });
              }
            }
          }
        } catch {
          // Overpass batch relation stitching handles any missing boundaries below
        }
      }

      const missingIds = filteredRels.map((e) => e.r.id).filter((id) => !geoById.has(id));
      if (missingIds.length > 0) {
        const opBatch = await fetchBatchOverpassRelationBoundaries(missingIds);
        for (const [relId, geom] of opBatch.entries()) {
          if (geom.boundaryGeoJson) {
            geoById.set(relId, geom.boundaryGeoJson);
          }
        }
      }

      const metas: ProvincialRegionMeta[] = filteredRels.map(({ r, cLat, cLng }) => {
        const b = r.bounds!;
        const name = r.tags?.['name:ko'] || r.tags?.name || r.tags?.['name:en'] || `Region #${r.id}`;
        const adminLevel = r.tags?.admin_level || '6';
        const boundaryGeoJson = geoById.get(r.id);
        if (boundaryGeoJson) {
          relationBoundaryCache.set(r.id, {
            bbox: [b.minlat, b.minlon, b.maxlat, b.maxlon],
            boundaryGeoJson,
            name,
            adminLevel,
          });
        }
        return {
          regionId: `osm_rel_${r.id}`,
          regionName: name,
          adminLevel,
          bbox: [b.minlat, b.minlon, b.maxlat, b.maxlon],
          boundaryGeoJson,
          exactBoundaryVersion: boundaryGeoJson ? 2 : undefined,
          centerLat: cLat,
          centerLng: cLng,
        };
      });
      return metas;
    }
  } catch {
    // Fallback to compact multi-ring is_in probes below
  }

  const probes: Array<[number, number]> = [
    [lat, lng],
    [lat + 0.07, lng],
    [lat - 0.07, lng],
    [lat, lng + 0.09],
    [lat, lng - 0.09],
    [lat + 0.14, lng + 0.16],
    [lat - 0.14, lng - 0.16],
  ];

  const resolvedList: Array<{ idx: number; region: ResolvedAdminRegion | null }> = [];
  const batchSize = 3;
  for (let start = 0; start < probes.length; start += batchSize) {
    const slice = probes.slice(start, start + batchSize);
    const settled = await Promise.allSettled(
      slice.map(([pLat, pLng]) => resolveRegionCached(pLat, pLng))
    );
    settled.forEach((entry, offset) => {
      resolvedList.push({
        idx: start + offset,
        region: entry.status === 'fulfilled' ? entry.value : null,
      });
    });
  }

  const byId = new Map<string, ProvincialRegionMeta>();

  resolvedList.forEach(({ idx, region: r }) => {
    if (!r || isCountryLevelOsmArea(r)) return;
    if (!byId.has(r.regionId)) {
      byId.set(r.regionId, {
        regionId: r.regionId,
        regionName: r.regionName,
        adminLevel: r.adminLevel,
        bbox: r.bbox,
        boundaryGeoJson: r.boundaryGeoJson,
        centerLat: (r.bbox[0] + r.bbox[2]) / 2 || probes[idx][0],
        centerLng: (r.bbox[1] + r.bbox[3]) / 2 || probes[idx][1],
      });
    }
  });

  return Array.from(byId.values());
}

export async function loadOsmProvinceDirect(
  lat: number,
  lng: number,
  expectedRegionName?: string,
  options?: {
    allowStarterFallback?: boolean;
    onProgress?: (percent: number, label?: string) => void;
  }
): Promise<ProvincePayload> {
  const report = (pct: number, label?: string) => {
    try {
      options?.onProgress?.(Math.max(1, Math.min(100, Math.round(pct))), label);
    } catch {
      // Ignore UI progress callback errors
    }
  };
  const chunkKey = quantizeChunkKey(lat, lng);
  report(10, '행정구역 경계 탐색 중');
  const region = await resolveRegionCached(lat, lng, expectedRegionName);
  const regionId = region?.regionId || `osm_prov_${chunkKey}`;
  const regionName = region?.regionName || expectedRegionName || '도시 행정구역';
  const adminLevel = region?.adminLevel || '6';
  report(26, `${regionName} 도로·철도 요청 중`);

  const cached = provinceCache.get(regionId);
  if (cached && (cached.osmEdges.length > 0 || cached.usedLiveOverpass)) {
    report(100, `${regionName} 캐시 로드 완료`);
    return cached;
  }

  let pending = inFlightProvinces.get(regionId);
  if (!pending) {
    pending = (async () => {
      const distBounds = clampBbox(
        region?.districtBbox || [lat - 0.012, lng - 0.015, lat + 0.012, lng + 0.015],
        lat,
        lng,
        0.014,
        0.018
      );
      const cityCenterLat = region ? (region.bbox[0] + region.bbox[2]) / 2 : lat;
      const cityCenterLng = region ? (region.bbox[1] + region.bbox[3]) / 2 : lng;
      const fullCityBounds = clampBbox(
        region?.bbox || [lat - 0.06, lng - 0.08, lat + 0.06, lng + 0.08],
        cityCenterLat,
        cityCenterLng,
        region?.relId ? 0.55 : 0.20,
        region?.relId ? 0.75 : 0.28
      );

      const distBoxStr = `${distBounds[0].toFixed(6)},${distBounds[1].toFixed(6)},${distBounds[2].toFixed(6)},${distBounds[3].toFixed(6)}`;
      const cityBoxStr = `${fullCityBounds[0].toFixed(6)},${fullCityBounds[1].toFixed(6)},${fullCityBounds[2].toFixed(6)},${fullCityBounds[3].toFixed(6)}`;

      // Full-county query: load ALL drivable, residential, service, pedestrian, and rail ways in the county at once
      const fullAllRoadsFilter = region?.relId
        ? `area(${3600000000 + region.relId})->.city;(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|track|road|footway|path|cycleway|steps).*$"](area.city);way["railway"~"^(rail|subway|light_rail|tram|narrow_gauge|monorail|funicular)$"](area.city););`
        : `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|track|road|footway|path|cycleway|steps).*$"](${cityBoxStr});way["railway"~"^(rail|subway|light_rail|tram|narrow_gauge|monorail|funicular)$"](${cityBoxStr}););`;

      let currentPct = 30;
      const bump = (pct: number, lbl?: string) => {
        if (pct > currentPct) currentPct = pct;
        report(currentPct, lbl);
      };
      bump(30, `${regionName} 전체 도로망 수신 중`);

      const ticker = setInterval(() => {
        if (currentPct < 74) {
          bump(currentPct + 3, `${regionName} 전체 도로망 수신 중`);
        }
      }, 450);

      let fullCountyRaw: PromiseSettledResult<OsmMapResponse>;
      let districtRaw: PromiseSettledResult<OsmMapResponse>;
      let localBboxRaw: PromiseSettledResult<OsmMapResponse | null>;
      try {
        [fullCountyRaw, districtRaw, localBboxRaw] = await Promise.allSettled([
          fetchOverpassQuery(
            `[out:json][timeout:16];${fullAllRoadsFilter}out body;>;out skel qt;`,
            19000
          ).then((r) => {
            bump(78, `${regionName} 도로·철도 그래프 생성 중`);
            return r;
          }),
          fetchOverpassQuery(
            `[out:json][timeout:7];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|track|road|footway|path|cycleway|steps).*$"](${distBoxStr});way["railway"](${distBoxStr}););out body;>;out skel qt;`,
            8500
          ).then((r) => {
            bump(56);
            return r;
          }),
          fetchOsmBbox(lat - 0.0032, lng - 0.0042, lat + 0.0032, lng + 0.0042, 7500).then((r) => {
            bump(42);
            return r;
          }),
        ]);
      } finally {
        clearInterval(ticker);
      }

      let hadLiveResponse =
        (localBboxRaw.status === 'fulfilled' && localBboxRaw.value !== null) ||
        districtRaw.status === 'fulfilled' ||
        fullCountyRaw.status === 'fulfilled';

      const mergedNodes = new Map<string, OsmNode>();
      const mergedEdges = new Map<string, OsmEdge>();
      let totalWayCount = 0;

      const mergeGraphSlice = (g: ReturnType<typeof buildDenseRealOsmGraph>) => {
        totalWayCount += g.wayCount;
        g.osmNodes.forEach((n) => {
          const prev = mergedNodes.get(n.id);
          if (!prev) mergedNodes.set(n.id, n);
          else if (n.mode && prev.mode !== n.mode) prev.mode = 'mixed';
        });
        g.osmEdges.forEach((e) => {
          if (!mergedEdges.has(e.id)) mergedEdges.set(e.id, e);
        });
      };

      if (localBboxRaw.status === 'fulfilled' && localBboxRaw.value) {
        mergeGraphSlice(buildDenseRealOsmGraph(localBboxRaw.value, chunkKey, lat, lng));
      }

      if (districtRaw.status === 'fulfilled') {
        mergeGraphSlice(
          buildDenseRealOsmGraph(districtRaw.value, chunkKey, lat, lng, {
            clipLat: 0.015,
            clipLng: 0.019,
            maxEdgeMeters: 30,
            targetSubdivMeters: 25,
            roadBudget: 4500,
            railBudget: 900,
            maxPerWay: 140,
          })
        );
      }

      bump(84, `${regionName} 교차점 병합 중`);

      if (fullCountyRaw.status === 'fulfilled') {
        const halfLat = Math.max(0.08, (fullCityBounds[2] - fullCityBounds[0]) / 2 + 0.015);
        const halfLng = Math.max(0.1, (fullCityBounds[3] - fullCityBounds[1]) / 2 + 0.015);
        mergeGraphSlice(
          buildDenseRealOsmGraph(fullCountyRaw.value, chunkKey, cityCenterLat, cityCenterLng, {
            clipLat: halfLat,
            clipLng: halfLng,
            maxEdgeMeters: 85,
            targetSubdivMeters: 75,
            roadBudget: 24000,
            railBudget: 4000,
            maxPerWay: 320,
          })
        );
      } else {
        // Fallback for giant dense counties when all-roads query exceeds budget: arterial + residential full county + 3x3 dense tiles
        const majorResFilter = region?.relId
          ? `area(${3600000000 + region.relId})->.city;(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street).*$"](area.city);way["railway"~"^(rail|subway|light_rail|tram|narrow_gauge|monorail|funicular)$"](area.city););`
          : `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street).*$"](${cityBoxStr});way["railway"~"^(rail|subway|light_rail|tram|narrow_gauge|monorail|funicular)$"](${cityBoxStr}););`;
        try {
          const majorRaw = await fetchOverpassQuery(
            `[out:json][timeout:12];${majorResFilter}out body;>;out skel qt;`,
            14000
          );
          hadLiveResponse = true;
          const halfLat = Math.max(0.08, (fullCityBounds[2] - fullCityBounds[0]) / 2 + 0.015);
          const halfLng = Math.max(0.1, (fullCityBounds[3] - fullCityBounds[1]) / 2 + 0.015);
          mergeGraphSlice(
            buildDenseRealOsmGraph(majorRaw, chunkKey, cityCenterLat, cityCenterLng, {
              clipLat: halfLat,
              clipLng: halfLng,
              maxEdgeMeters: 100,
              targetSubdivMeters: 85,
              roadBudget: 16000,
              railBudget: 3000,
              maxPerWay: 260,
            })
          );
        } catch {
          // Continue with local/batch tiles below
        }
      }

      if (mergedEdges.size === 0 && !hadLiveResponse) {
        const fallbackRaw = await fetchOsmBbox(lat - 0.005, lng - 0.006, lat + 0.005, lng + 0.006);
        if (fallbackRaw !== null) {
          hadLiveResponse = true;
          mergeGraphSlice(buildDenseRealOsmGraph(fallbackRaw, chunkKey, lat, lng));
        }
      }

      const usedLiveOverpass = hadLiveResponse || mergedEdges.size > 0;
      if (mergedEdges.size === 0 && !hadLiveResponse && options?.allowStarterFallback !== false) {
        const fb = buildFallbackStarterGrid(chunkKey, lat, lng);
        totalWayCount += fb.wayCount;
        fb.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
        fb.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
      }

      bump(95, `${regionName} 노드 연결망 정리 중`);

      const payload: ProvincePayload = {
        regionId,
        regionName,
        adminLevel,
        bbox: region?.bbox || fullCityBounds,
        boundaryGeoJson: region?.boundaryGeoJson,
        totalNodeCount: mergedNodes.size,
        chunkKey,
        osmNodes: Array.from(mergedNodes.values()),
        osmEdges: Array.from(mergedEdges.values()),
        usedLiveOverpass,
        source: 'osm-0.6-api',
        wayCount: totalWayCount,
      };

      if (usedLiveOverpass) {
        provinceCache.set(regionId, payload);
      }
      return payload;
    })();
    inFlightProvinces.set(regionId, pending);
    pending.finally(() => inFlightProvinces.delete(regionId));
  }

  const res = await pending;
  report(100, `${regionName} 로드 완료`);
  if (
    !res.usedLiveOverpass &&
    res.osmNodes.length === 0 &&
    options?.allowStarterFallback !== false
  ) {
    const fb = buildFallbackStarterGrid(chunkKey, lat, lng);
    return {
      ...res,
      totalNodeCount: fb.osmNodes.length,
      osmNodes: fb.osmNodes,
      osmEdges: fb.osmEdges,
      wayCount: fb.wayCount,
    };
  }
  return res;
}
