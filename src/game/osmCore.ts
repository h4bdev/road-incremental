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
}

export interface ProvincialRegionMeta {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  boundaryGeoJson?: GeoJsonBoundary;
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
]);

const RAILWAYS = new Set(['rail', 'subway', 'light_rail', 'tram', 'narrow_gauge']);

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

function pointToSegmentDistSq(
  pt: number[],
  segStart: number[],
  segEnd: number[]
): number {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = pt[0] - segStart[0];
    const py = pt[1] - segStart[1];
    return px * px + py * py;
  }
  const t = Math.max(0, Math.min(1, ((pt[0] - segStart[0]) * dx + (pt[1] - segStart[1]) * dy) / lenSq));
  const projX = segStart[0] + t * dx;
  const projY = segStart[1] + t * dy;
  const rx = pt[0] - projX;
  const ry = pt[1] - projY;
  return rx * rx + ry * ry;
}

function douglasPeucker(points: number[][], epsilonSq: number): number[][] {
  if (points.length <= 2) return points;
  let maxDistSq = 0;
  let maxIdx = 0;
  const lastIdx = points.length - 1;
  for (let i = 1; i < lastIdx; i++) {
    const dSq = pointToSegmentDistSq(points[i], points[0], points[lastIdx]);
    if (dSq > maxDistSq) {
      maxDistSq = dSq;
      maxIdx = i;
    }
  }
  if (maxDistSq > epsilonSq && maxIdx > 0 && maxIdx < lastIdx) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilonSq);
    const right = douglasPeucker(points.slice(maxIdx), epsilonSq);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[lastIdx]];
}

function simplifyRing(ring: number[][], maxPts: number): number[][] {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const rounded = ring.map((pt) => [
    Number(Number(pt[0]).toFixed(5)),
    Number(Number(pt[1]).toFixed(5)),
  ]);
  const first = rounded[0];
  const last = rounded[rounded.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    rounded.push([first[0], first[1]]);
  }
  if (rounded.length <= maxPts) {
    return rounded;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of rounded) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.01);
  let epsilon = span * 0.0005;
  let simplified = douglasPeucker(rounded, epsilon * epsilon);

  // Relax tolerance smoothly until point count fits maxPts without collapsing ring
  for (let iter = 0; iter < 8 && simplified.length > maxPts; iter++) {
    epsilon *= 1.55;
    const candidate = douglasPeucker(rounded, epsilon * epsilon);
    if (candidate.length < 4) break;
    simplified = candidate;
  }

  if (simplified.length > maxPts) {
    const step = Math.max(1, Math.floor((simplified.length - 1) / (maxPts - 1)));
    const strided: number[][] = [];
    for (let i = 0; i < simplified.length - 1; i += step) {
      strided.push(simplified[i]);
    }
    strided.push([simplified[0][0], simplified[0][1]]);
    simplified = strided;
  } else {
    const sFirst = simplified[0];
    const sLast = simplified[simplified.length - 1];
    if (sFirst[0] !== sLast[0] || sFirst[1] !== sLast[1]) {
      simplified.push([sFirst[0], sFirst[1]]);
    }
  }
  return simplified.length >= 4 ? simplified : [];
}

function simplifyGeoJsonBoundary(raw: unknown): GeoJsonBoundary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const rings = (g.coordinates as number[][][])
      .slice(0, 1)
      .map((r) => simplifyRing(r, 520))
      .filter((r) => r.length >= 4);
    if (rings.length === 0) return undefined;
    return { type: 'Polygon', coordinates: rings };
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const polys = (g.coordinates as number[][][][])
      .map((poly, idx) => {
        const budget = idx === 0 ? 380 : idx < 10 ? 120 : 50;
        const outer = Array.isArray(poly?.[0]) ? simplifyRing(poly[0], budget) : [];
        if (outer.length < 4) return null;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const [x, y] of outer) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return { outer, area: (maxX - minX) * (maxY - minY) };
      })
      .filter((p): p is { outer: number[][]; area: number } => p !== null)
      .sort((a, b) => b.area - a.area)
      .slice(0, 36);
    if (polys.length === 0) return undefined;
    if (polys.length === 1) {
      return { type: 'Polygon', coordinates: [polys[0].outer] };
    }
    return { type: 'MultiPolygon', coordinates: polys.map((p) => [p.outer]) };
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
  const boundaryGeoJson = simplifyGeoJsonBoundary(rawBoundary);
  const bbox: [number, number, number, number] | undefined =
    Number.isFinite(minLat) && Number.isFinite(minLng) && Number.isFinite(maxLat) && Number.isFinite(maxLng)
      ? [minLat, minLng, maxLat, maxLng]
      : undefined;

  return { bbox, boundaryGeoJson };
}

export async function fetchOverpassRelationBoundary(
  relId: number
): Promise<{ bbox?: [number, number, number, number]; boundaryGeoJson?: GeoJsonBoundary } | null> {
  try {
    const query = `[out:json][timeout:10];relation(${relId});out geom;`;
    const res = await fetchOverpassQuery(query, 9500);
    const stitched = stitchOverpassWaysToGeoJson((res.elements || []) as Array<OsmRawRelation | { type: string }>);
    return stitched.boundaryGeoJson ? stitched : null;
  } catch {
    return null;
  }
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
      )}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.005&addressdetails=1&accept-language=ko,en&limit=6`,
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

      let boundaryGeoJson = simplifyGeoJsonBoundary(item.geojson);
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
  if (expectedRegionName && !isCountryLevelOsmArea({ name: expectedRegionName })) {
    const byNameFirst = await searchOsmProvinceByName(expectedRegionName, lat, lng);
    if (byNameFirst && byNameFirst.boundaryGeoJson) {
      return byNameFirst;
    }
  }

  try {
    const query = `[out:json][timeout:6];is_in(${lat.toFixed(6)},${lng.toFixed(6)})->.a;area.a["boundary"="administrative"]["admin_level"~"^(3|4|5|6|8)$"];out tags;`;
    const areaRes = await fetchOverpassQuery(query, 6500);
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

    const nameMatched = expectedRegionName
      ? validAreas.find((a) => adminNamesLikelyMatch(getAreaName(a), expectedRegionName))
      : undefined;

    const a4 = byLevel('4')[0];
    const a5 = byLevel('5')[0];
    const a6 = byLevel('6')[0];
    const a3 = byLevel('3')[0];

    const provinceArea = nameMatched || a4 || a5 || a6 || a3;
    const districtArea = byLevel('8')[0] || byLevel('6')[0] || byLevel('5')[0];

    if (provinceArea) {
      const relId = provinceArea.id > 3600000000 ? provinceArea.id - 3600000000 : provinceArea.id;
      const distRelId =
        districtArea && districtArea.id > 3600000000
          ? districtArea.id - 3600000000
          : districtArea?.id;
      const displayName = getAreaName(provinceArea) || `Province #${relId}`;
      const adminLevel = provinceArea.tags?.admin_level || '4';

      let bbox: [number, number, number, number] = [
        lat - 0.075,
        lng - 0.095,
        lat + 0.075,
        lng + 0.095,
      ];
      let hasExplicitBbox = false;
      let districtBbox: [number, number, number, number] | undefined;
      let boundaryGeoJson: GeoJsonBoundary | undefined;

      try {
        const ids = distRelId && distRelId !== relId ? `R${relId},R${distRelId}` : `R${relId}`;
        const nomRes = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json&polygon_geojson=1&polygon_threshold=0.005&accept-language=ko,en`,
          { headers: buildRequestHeaders('application/json') },
          7500
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
            boundaryGeoJson = simplifyGeoJsonBoundary(pItem.geojson);
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
        return {
          regionId: `osm_rel_${relId}`,
          relId,
          regionName: displayName,
          adminLevel,
          bbox,
          districtBbox,
          boundaryGeoJson,
        };
      }
    }
  } catch {
    // Fallback to Nominatim reverse lookup below
  }

  for (const zoomLevel of [5, 6, 8]) {
    try {
      const revRes = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoomLevel}&addressdetails=1&polygon_geojson=1&polygon_threshold=0.005&accept-language=ko,en`,
        { headers: buildRequestHeaders('application/json') },
        6500
      );
      if (!revRes.ok) continue;
      const rev = (await revRes.json()) as {
        osm_type?: string;
        osm_id?: number;
        name?: string;
        display_name?: string;
        addresstype?: string;
        address?: {
          state?: string;
          province?: string;
          region?: string;
          city?: string;
          county?: string;
          country?: string;
        };
        boundingbox?: [string, string, string, string];
        geojson?: unknown;
      };

      const provinceName =
        rev.address?.state ||
        rev.address?.province ||
        rev.address?.region ||
        (rev.addresstype !== 'country' ? rev.name : undefined);

      if (
        rev.addresstype === 'country' ||
        isCountryLevelOsmArea({ name: rev.name, relId: rev.osm_id, addresstype: rev.addresstype })
      ) {
        if (provinceName && !isCountryLevelOsmArea({ name: provinceName })) {
          const viaName = await searchOsmProvinceByName(provinceName, lat, lng);
          if (viaName) return viaName;
        }
        continue;
      }

      if (
        provinceName &&
        rev.name &&
        !adminNamesLikelyMatch(provinceName, rev.name) &&
        !isCountryLevelOsmArea({ name: provinceName })
      ) {
        const viaProvinceName = await searchOsmProvinceByName(provinceName, lat, lng);
        if (viaProvinceName) return viaProvinceName;
      }

      const name =
        provinceName ||
        rev.address?.city ||
        rev.address?.county ||
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
          : [lat - 0.075, lng - 0.095, lat + 0.075, lng + 0.095];
      if (isCountryLevelOsmArea({ name, relId: rev.osm_id, bbox })) {
        continue;
      }

      const relId = rev.osm_type === 'relation' && rev.osm_id ? rev.osm_id : undefined;
      let boundaryGeoJson = simplifyGeoJsonBoundary(rev.geojson);
      if (relId && !boundaryGeoJson) {
        const opGeom = await fetchOverpassRelationBoundary(relId);
        if (opGeom?.boundaryGeoJson) {
          boundaryGeoJson = opGeom.boundaryGeoJson;
        }
        if (!rev.boundingbox && opGeom?.bbox) {
          bbox = opGeom.bbox;
        }
      }
      return {
        regionId: relId
          ? `osm_rel_${relId}`
          : rev.osm_id
          ? `osm_nom_${rev.osm_id}`
          : `osm_grid_${quantizeChunkKey(lat, lng)}`,
        relId,
        regionName: name,
        adminLevel: relId ? '4' : '6',
        bbox,
        boundaryGeoJson,
      };
    } catch {
      // Try next zoom level
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
  const SNAP_CELL_DEG = 0.0001;
  const SNAP_METERS = 2.0;
  const snapGridByLayer = new Map<string, Map<string, Array<{ id: string; lat: number; lng: number }>>>();

  const resolveOrRegisterSnapVertex = (
    pt: { id: string; lat: number; lng: number; label: string },
    mode: 'road' | 'rail',
    layerKey: string
  ): { id: string; lat: number; lng: number; label: string } => {
    const existingNode = nodeMap.get(pt.id);
    if (existingNode) {
      return { id: existingNode.id, lat: existingNode.lat, lng: existingNode.lng, label: pt.label };
    }
    const groupKey = `${mode}:${layerKey}`;
    let grid = snapGridByLayer.get(groupKey);
    if (!grid) {
      grid = new Map();
      snapGridByLayer.set(groupKey, grid);
    }
    const gx = Math.floor(pt.lat / SNAP_CELL_DEG);
    const gy = Math.floor(pt.lng / SNAP_CELL_DEG);
    let bestMatch: { id: string; lat: number; lng: number } | null = null;
    let bestDist = SNAP_METERS;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx}_${gy + dy}`);
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
    if (bestMatch) {
      return { id: bestMatch.id, lat: bestMatch.lat, lng: bestMatch.lng, label: pt.label };
    }
    const cellKey = `${gx}_${gy}`;
    let bucket = grid.get(cellKey);
    if (!bucket) {
      bucket = [];
      grid.set(cellKey, bucket);
    }
    bucket.push({ id: pt.id, lat: pt.lat, lng: pt.lng });
    return pt;
  };

  const emitWaysWithBudget = (waysList: OsmRawWay[], maxEdgesForGroup: number, maxPerWay: number) => {
    let groupAdded = 0;

    for (const way of waysList) {
      if (groupAdded >= maxEdgesForGroup) break;

      const wayNodes = way.nodes!;
      const isRail = Boolean(way.tags?.railway);
      const mode: 'road' | 'rail' = isRail ? 'rail' : 'road';
      const hwType = way.tags?.railway || way.tags?.highway || 'road';
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
          if (!isInsideBridgeClip(coord)) continue;
          const prevCoord = i > 0 ? rawNodeCoords.get(wayNodes[i - 1]) : undefined;
          const nextCoord = i + 1 < wayNodes.length ? rawNodeCoords.get(wayNodes[i + 1]) : undefined;
          keepAsBoundaryBridge =
            Boolean(prevCoord && isInsideClip(prevCoord)) ||
            Boolean(nextCoord && isInsideClip(nextCoord));
          if (!keepAsBoundaryBridge) continue;
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

        if (segMeters > 2500) {
          densePts.push(curr);
          continue;
        }

        if (segMeters > MAX_EDGE_METERS) {
          const subCount = Math.min(80, Math.ceil(segMeters / TARGET_SUBDIV_METERS));
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
          : hwType === 'footway' || hwType === 'path' || hwType === 'cycleway'
          ? 0.75
          : hwType === 'service' || hwType === 'track' || hwType === 'pedestrian'
          ? 0.85
          : 0.9;

      const layerKey = `${way.tags?.layer || '0'}_${
        way.tags?.tunnel === 'yes' ? 't' : way.tags?.bridge === 'yes' ? 'b' : 'g'
      }`;
      const snappedPts = densePts.map((pt) => resolveOrRegisterSnapVertex(pt, mode, layerKey));

      let wayAdded = 0;
      for (let i = 0; i < snappedPts.length - 1; i++) {
        if (groupAdded >= maxEdgesForGroup || wayAdded >= maxPerWay) break;
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

export async function resolveRegionCached(
  lat: number,
  lng: number,
  expectedRegionName?: string
): Promise<ResolvedAdminRegion | null> {
  const key = expectedRegionName
    ? `${quantizeChunkKey(lat, lng)}:${normalizeNameToken(expectedRegionName)}`
    : quantizeChunkKey(lat, lng);
  const cachedInfo = regionInfoCache.get(key);
  if (cachedInfo && cachedInfo.boundaryGeoJson) return cachedInfo;

  let pendingInfo = inFlightRegionInfo.get(key);
  if (!pendingInfo) {
    pendingInfo = resolveOsmProvincialRegion(lat, lng, expectedRegionName).then((resolved) => {
      if (resolved && resolved.boundaryGeoJson && !isCountryLevelOsmArea(resolved)) {
        regionInfoCache.set(key, resolved);
      }
      return resolved;
    });
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

  // Group nearby chunks into compact bounding-box clusters (<= 0.014 deg lat x 0.018 deg lng, max 8 chunks)
  const clusters: Array<Array<{ key: string; lat: number; lng: number }>> = [];
  for (const pt of pendingCoords) {
    let targetCluster: Array<{ key: string; lat: number; lng: number }> | null = null;
    for (const cl of clusters) {
      if (cl.length >= 8) continue;
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
      if (maxLat - minLat <= 0.014 && maxLng - minLng <= 0.018) {
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

  const MAX_CONCURRENT_CLUSTERS = 2;
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
          10500
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
          for (let fStart = 0; fStart < failedPoints.length; fStart += 2) {
            const fSlice = failedPoints.slice(fStart, fStart + 2);
            const fallbacks = await Promise.allSettled(
              fSlice.map((pt) => loadOsmRoadChunkDirect(pt.lat, pt.lng, options))
            );
            for (let k = 0; k < fallbacks.length; k++) {
              const fb = fallbacks[k];
              if (fb.status === 'fulfilled') {
                resultsByKey.set(fSlice[k].key, fb.value);
              }
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
  expectedRegionName?: string
): Promise<ProvincialRegionMeta> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const region = await resolveRegionCached(lat, lng, expectedRegionName);
  if (!region || isCountryLevelOsmArea(region)) {
    return {
      regionId: `osm_prov_${chunkKey}`,
      regionName: '인접 광역 행정구역',
      adminLevel: '4',
      bbox: [lat - 0.08, lng - 0.1, lat + 0.08, lng + 0.1],
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
    centerLat: (region.bbox[0] + region.bbox[2]) / 2,
    centerLng: (region.bbox[1] + region.bbox[3]) / 2,
  };
}

export async function loadNearbyProvincialRegionsDirect(
  lat: number,
  lng: number
): Promise<ProvincialRegionMeta[]> {
  const probes: Array<[number, number]> = isServerRuntime()
    ? [
        [lat, lng],
        [lat + 0.16, lng],
        [lat - 0.18, lng],
        [lat, lng + 0.24],
        [lat, lng - 0.28],
        [lat + 0.24, lng + 0.35],
        [lat + 0.24, lng - 0.28],
        [lat - 0.24, lng + 0.28],
        [lat - 0.24, lng - 0.28],
      ]
    : [
        [lat, lng],
        [lat + 0.18, lng],
        [lat - 0.20, lng],
        [lat, lng + 0.30],
        [lat, lng - 0.28],
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
  options?: { allowStarterFallback?: boolean }
): Promise<ProvincePayload> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const region = await resolveRegionCached(lat, lng, expectedRegionName);
  const regionId = region?.regionId || `osm_prov_${chunkKey}`;
  const regionName = region?.regionName || expectedRegionName || '인접 도시 행정구역';
  const adminLevel = region?.adminLevel || '6';

  const cached = provinceCache.get(regionId);
  if (cached && (cached.osmEdges.length > 0 || cached.usedLiveOverpass)) {
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
        region?.bbox || [lat - 0.09, lng - 0.11, lat + 0.09, lng + 0.11],
        cityCenterLat,
        cityCenterLng,
        region?.relId ? 0.45 : 0.18,
        region?.relId ? 0.60 : 0.24
      );

      const distBoxStr = `${distBounds[0].toFixed(6)},${distBounds[1].toFixed(6)},${distBounds[2].toFixed(6)},${distBounds[3].toFixed(6)}`;
      const cityBoxStr = `${fullCityBounds[0].toFixed(6)},${fullCityBounds[1].toFixed(6)},${fullCityBounds[2].toFixed(6)},${fullCityBounds[3].toFixed(6)}`;

      const fullCityFilter = region?.relId
        ? `area(${3600000000 + region.relId})->.city;(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified).*$"](area.city);way["railway"~"^(rail|subway|light_rail|tram)$"](area.city););`
        : `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified).*$"](${cityBoxStr});way["railway"~"^(rail|subway|light_rail|tram)$"](${cityBoxStr}););`;

      const [districtRaw, cityWideRaw, localBboxRaw] = await Promise.allSettled([
        fetchOverpassQuery(
          `[out:json][timeout:6];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|track|road|footway|path|cycleway).*$"](${distBoxStr});way["railway"](${distBoxStr}););out body;>;out skel qt;`,
          7500
        ),
        fetchOverpassQuery(
          `[out:json][timeout:9];${fullCityFilter}out body;>;out skel qt;`,
          9500
        ),
        fetchOsmBbox(lat - 0.0032, lng - 0.0042, lat + 0.0032, lng + 0.0042, 7500),
      ]);

      let hadLiveResponse =
        (localBboxRaw.status === 'fulfilled' && localBboxRaw.value !== null) ||
        districtRaw.status === 'fulfilled' ||
        cityWideRaw.status === 'fulfilled';

      const mergedNodes = new Map<string, OsmNode>();
      const mergedEdges = new Map<string, OsmEdge>();
      let totalWayCount = 0;

      if (localBboxRaw.status === 'fulfilled' && localBboxRaw.value) {
        const g = buildDenseRealOsmGraph(localBboxRaw.value, chunkKey, lat, lng);
        totalWayCount += g.wayCount;
        g.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
        g.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
      }

      if (districtRaw.status === 'fulfilled') {
        const g = buildDenseRealOsmGraph(districtRaw.value, chunkKey, lat, lng, {
          clipLat: 0.015,
          clipLng: 0.019,
          maxEdgeMeters: 30,
          targetSubdivMeters: 25,
          roadBudget: 2600,
          railBudget: 450,
          maxPerWay: 95,
        });
        totalWayCount += g.wayCount;
        g.osmNodes.forEach((n) => {
          const prev = mergedNodes.get(n.id);
          if (!prev) mergedNodes.set(n.id, n);
          else if (n.mode && prev.mode !== n.mode) prev.mode = 'mixed';
        });
        g.osmEdges.forEach((e) => {
          if (!mergedEdges.has(e.id)) mergedEdges.set(e.id, e);
        });
      }

      if (cityWideRaw.status === 'fulfilled') {
        const halfLat = Math.max(0.12, (fullCityBounds[2] - fullCityBounds[0]) / 2 + 0.02);
        const halfLng = Math.max(0.15, (fullCityBounds[3] - fullCityBounds[1]) / 2 + 0.02);
        const g = buildDenseRealOsmGraph(cityWideRaw.value, chunkKey, cityCenterLat, cityCenterLng, {
          clipLat: halfLat,
          clipLng: halfLng,
          maxEdgeMeters: 110,
          targetSubdivMeters: 95,
          roadBudget: 4200,
          railBudget: 1100,
          maxPerWay: 95,
        });
        totalWayCount += g.wayCount;
        g.osmNodes.forEach((n) => {
          const prev = mergedNodes.get(n.id);
          if (!prev) mergedNodes.set(n.id, n);
          else if (n.mode && prev.mode !== n.mode) prev.mode = 'mixed';
        });
        g.osmEdges.forEach((e) => {
          if (!mergedEdges.has(e.id)) mergedEdges.set(e.id, e);
        });
      }

      if (mergedEdges.size === 0 && !hadLiveResponse) {
        const fallbackRaw = await fetchOsmBbox(lat - 0.005, lng - 0.006, lat + 0.005, lng + 0.006);
        if (fallbackRaw !== null) {
          hadLiveResponse = true;
          const g = buildDenseRealOsmGraph(fallbackRaw, chunkKey, lat, lng);
          totalWayCount += g.wayCount;
          g.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
          g.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
        }
      }

      const usedLiveOverpass = hadLiveResponse || mergedEdges.size > 0;
      if (mergedEdges.size === 0 && !hadLiveResponse && options?.allowStarterFallback !== false) {
        const fb = buildFallbackStarterGrid(chunkKey, lat, lng);
        totalWayCount += fb.wayCount;
        fb.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
        fb.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
      }

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
