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

export interface OsmMapResponse {
  elements?: Array<OsmRawNode | OsmRawWay | { type: string }>;
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
]);

const RAILWAYS = new Set(['rail', 'subway', 'light_rail', 'tram', 'narrow_gauge']);

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const chunkCache = new Map<string, ChunkPayload>();
const provinceCache = new Map<string, ProvincePayload>();
const regionInfoCache = new Map<string, ResolvedAdminRegion>();
const inFlightChunks = new Map<string, Promise<ChunkPayload>>();
const inFlightProvinces = new Map<string, Promise<ProvincePayload>>();
const inFlightRegionInfo = new Map<string, Promise<ResolvedAdminRegion | null>>();

function isServerRuntime(): boolean {
  return typeof window === 'undefined';
}

function buildRequestHeaders(accept = 'application/json', contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  // Browsers forbid setting User-Agent in fetch; only send it from Node server runtime.
  if (isServerRuntime()) {
    headers['User-Agent'] = 'TerraLine-OSM-Builder/1.0';
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
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: buildRequestHeaders('application/json', 'application/x-www-form-urlencoded'),
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = (await res.json()) as OsmMapResponse;
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    throw new Error('Overpass empty elements');
  }
  return data;
}

export async function fetchOverpassQuery(
  query: string,
  timeoutMs = 8500
): Promise<OsmMapResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.any(
      OVERPASS_ENDPOINTS.map((ep) => fetchOverpassFromUrl(ep, query, controller.signal))
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    throw new Error('OSM 0.6 empty elements');
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.any([
      fetchFromOsm06(minLat, minLng, maxLat, maxLng, controller.signal),
      fetchFromOverpass(
        'https://overpass-api.de/api/interpreter',
        minLat,
        minLng,
        maxLat,
        maxLng,
        controller.signal
      ),
      fetchFromOverpass(
        'https://overpass.openstreetmap.fr/api/interpreter',
        minLat,
        minLng,
        maxLat,
        maxLng,
        controller.signal
      ),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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

function simplifyRing(ring: number[][], maxPts: number): number[][] {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const rounded = ring.map((pt) => [
    Number(Number(pt[0]).toFixed(5)),
    Number(Number(pt[1]).toFixed(5)),
  ]);
  if (rounded.length <= maxPts) {
    const first = rounded[0];
    const last = rounded[rounded.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      rounded.push([first[0], first[1]]);
    }
    return rounded;
  }
  const step = Math.max(1, Math.floor((rounded.length - 1) / (maxPts - 1)));
  const out: number[][] = [];
  for (let i = 0; i < rounded.length - 1; i += step) {
    out.push(rounded[i]);
  }
  out.push([rounded[0][0], rounded[0][1]]);
  return out.length >= 4 ? out : [];
}

function simplifyGeoJsonBoundary(raw: unknown): GeoJsonBoundary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const rings = (g.coordinates as number[][][])
      .slice(0, 1)
      .map((r) => simplifyRing(r, 120))
      .filter((r) => r.length >= 4);
    if (rings.length === 0) return undefined;
    return { type: 'Polygon', coordinates: rings };
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const polys = (g.coordinates as number[][][][])
      .map((poly) => {
        const outer = Array.isArray(poly?.[0]) ? simplifyRing(poly[0], 90) : [];
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
      .slice(0, 3);
    if (polys.length === 0) return undefined;
    if (polys.length === 1) {
      return { type: 'Polygon', coordinates: [polys[0].outer] };
    }
    return { type: 'MultiPolygon', coordinates: polys.map((p) => [p.outer]) };
  }
  return undefined;
}

export async function resolveOsmProvincialRegion(
  lat: number,
  lng: number
): Promise<ResolvedAdminRegion | null> {
  try {
    const query = `[out:json][timeout:6];is_in(${lat.toFixed(6)},${lng.toFixed(6)})->.a;area.a["boundary"="administrative"]["admin_level"~"^(4|5|6|8)$"];out tags;`;
    const areaRes = await fetchOverpassQuery(query, 6500);
    const areas = (areaRes.elements || []).filter(
      (el): el is { type: 'area'; id: number; tags?: Record<string, string> } =>
        el.type === 'area' && 'id' in el
    );

    const byLevel = (lvl: string) => areas.filter((a) => a.tags?.admin_level === lvl);
    const getAreaName = (a?: { id: number; tags?: Record<string, string> }) =>
      a?.tags?.['name:ko'] || a?.tags?.name || a?.tags?.['name:en'] || '';

    const a3 = byLevel('3')[0];
    const a4 = byLevel('4')[0];
    const a5 = byLevel('5')[0];
    const a6 = byLevel('6')[0];

    const provinceArea = a4 || a3 || a5 || a6;
    const districtArea = byLevel('8')[0] || byLevel('6')[0] || byLevel('5')[0];

    if (provinceArea) {
      const relId = provinceArea.id > 3600000000 ? provinceArea.id - 3600000000 : provinceArea.id;
      const distRelId =
        districtArea && districtArea.id > 3600000000
          ? districtArea.id - 3600000000
          : districtArea?.id;
      const displayName = getAreaName(provinceArea) || `Province #${relId}`;

      let bbox: [number, number, number, number] = [
        lat - 0.075,
        lng - 0.095,
        lat + 0.075,
        lng + 0.095,
      ];
      let districtBbox: [number, number, number, number] | undefined;
      let boundaryGeoJson: GeoJsonBoundary | undefined;

      try {
        const ids = distRelId && distRelId !== relId ? `R${relId},R${distRelId}` : `R${relId}`;
        const nomRes = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json&polygon_geojson=1`,
          { headers: buildRequestHeaders('application/json') },
          5500
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
        // Keep fallback bbox
      }

      return {
        regionId: `osm_rel_${relId}`,
        relId,
        regionName: displayName,
        adminLevel: '4',
        bbox,
        districtBbox,
        boundaryGeoJson,
      };
    }
  } catch {
    // Fallback to Nominatim reverse lookup below
  }

  try {
    const revRes = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=5&addressdetails=1&polygon_geojson=1`,
      { headers: buildRequestHeaders('application/json') },
      5000
    );
    if (revRes.ok) {
      const rev = (await revRes.json()) as {
        osm_type?: string;
        osm_id?: number;
        name?: string;
        display_name?: string;
        address?: { state?: string; province?: string; region?: string; city?: string; county?: string };
        boundingbox?: [string, string, string, string];
        geojson?: unknown;
      };
      const name =
        rev.address?.state ||
        rev.address?.province ||
        rev.address?.region ||
        rev.name ||
        rev.address?.city ||
        rev.display_name?.split(',')[0] ||
        '인접 도·주 광역 행정구역';
      const bbox: [number, number, number, number] =
        rev.boundingbox && rev.boundingbox.length === 4
          ? [
              parseFloat(rev.boundingbox[0]),
              parseFloat(rev.boundingbox[2]),
              parseFloat(rev.boundingbox[1]),
              parseFloat(rev.boundingbox[3]),
            ]
          : [lat - 0.075, lng - 0.095, lat + 0.075, lng + 0.095];
      const relId = rev.osm_type === 'relation' && rev.osm_id ? rev.osm_id : undefined;
      return {
        regionId: relId
          ? `osm_rel_${relId}`
          : rev.osm_id
          ? `osm_nom_${rev.osm_id}`
          : `osm_grid_${quantizeChunkKey(lat, lng)}`,
        relId,
        regionName: name,
        adminLevel: '6',
        bbox,
        boundaryGeoJson: simplifyGeoJsonBoundary(rev.geojson),
      };
    }
  } catch {
    // Ignore
  }

  return null;
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
  }
): ChunkPayload {
  const elements = data.elements || [];
  const rawNodeCoords = new Map<number, { lat: number; lng: number }>();
  const validWays: OsmRawWay[] = [];

  for (const el of elements) {
    if (el.type === 'node' && 'lat' in el && 'lon' in el && 'id' in el) {
      rawNodeCoords.set(el.id, { lat: el.lat, lng: el.lon });
    } else if (el.type === 'way' && 'nodes' in el && Array.isArray(el.nodes) && el.nodes.length >= 2) {
      const hw = el.tags?.highway;
      const rw = el.tags?.railway;
      const isParkingAisle = el.tags?.service === 'parking_aisle';
      if ((hw && DRIVABLE_HIGHWAYS.has(hw) && !isParkingAisle) || (rw && RAILWAYS.has(rw))) {
        validWays.push(el);
      }
    }
  }

  const wayMinDistMap = new Map<number, number>();
  for (const way of validWays) {
    let minD = 99999;
    for (const nid of way.nodes!) {
      const pt = rawNodeCoords.get(nid);
      if (!pt) continue;
      const d = haversineMeters(centerLat, centerLng, pt.lat, pt.lng);
      if (d < minD) minD = d;
    }
    wayMinDistMap.set(way.id, minD);
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

  const nodeRefCount = new Map<number, number>();
  for (const way of validWays) {
    for (const nid of way.nodes!) {
      nodeRefCount.set(nid, (nodeRefCount.get(nid) || 0) + 1);
    }
  }

  const nodeMap = new Map<string, OsmNode>();
  const edgeMap = new Map<string, OsmEdge>();

  const MAX_EDGE_METERS = options?.maxEdgeMeters ?? 28.0;
  const TARGET_SUBDIV_METERS = options?.targetSubdivMeters ?? 24.0;
  const MAX_EMITTED_METERS = Math.max(45, TARGET_SUBDIV_METERS * 1.85);
  const MIN_VERTEX_METERS = options?.maxEdgeMeters ? Math.min(25, options.maxEdgeMeters * 0.35) : 10.0;
  const CLIP_LAT = options?.clipLat ?? 0.0048;
  const CLIP_LNG = options?.clipLng ?? 0.0062;
  const roadBudget = options?.roadBudget ?? 1250;
  const railBudget = options?.railBudget ?? 320;
  const maxPerWayBudget = options?.maxPerWay ?? 60;

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

      const basePts: { id: string; lat: number; lng: number; label: string }[] = [];
      for (let i = 0; i < wayNodes.length; i++) {
        const osmId = wayNodes[i];
        const coord = rawNodeCoords.get(osmId);
        if (!coord) continue;
        if (
          Math.abs(coord.lat - centerLat) > CLIP_LAT ||
          Math.abs(coord.lng - centerLng) > CLIP_LNG
        ) {
          continue;
        }
        const isMandatory =
          i === 0 || i === wayNodes.length - 1 || (nodeRefCount.get(osmId) || 0) > 1;
        const prev = basePts[basePts.length - 1];
        if (
          !prev ||
          isMandatory ||
          haversineMeters(prev.lat, prev.lng, coord.lat, coord.lng) >= MIN_VERTEX_METERS
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
        const segMeters = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);

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
            const lat = Number((prev.lat + (curr.lat - prev.lat) * t).toFixed(6));
            const lng = Number((prev.lng + (curr.lng - prev.lng) * t).toFixed(6));
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
          : 0.9;

      let wayAdded = 0;
      for (let i = 0; i < densePts.length - 1; i++) {
        if (groupAdded >= maxEdgesForGroup || wayAdded >= maxPerWay) break;
        const a = densePts[i];
        const b = densePts[i + 1];
        if (a.id === b.id) continue;

        const distM = haversineMeters(a.lat, a.lng, b.lat, b.lng);
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
  lng: number
): Promise<ResolvedAdminRegion | null> {
  const key = quantizeChunkKey(lat, lng);
  const cachedInfo = regionInfoCache.get(key);
  if (cachedInfo) return cachedInfo;

  let pendingInfo = inFlightRegionInfo.get(key);
  if (!pendingInfo) {
    pendingInfo = resolveOsmProvincialRegion(lat, lng).then((resolved) => {
      if (resolved) {
        regionInfoCache.set(key, resolved);
      }
      return resolved;
    });
    inFlightRegionInfo.set(key, pendingInfo);
    pendingInfo.finally(() => inFlightRegionInfo.delete(key));
  }
  return pendingInfo;
}

export async function loadOsmRoadChunkDirect(lat: number, lng: number): Promise<ChunkPayload> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const cached = chunkCache.get(chunkKey);
  if (cached && cached.osmEdges.length > 0) {
    return cached;
  }

  let pending = inFlightChunks.get(chunkKey);
  if (!pending) {
    pending = (async () => {
      const dLat1 = 0.0028;
      const dLng1 = 0.0036;
      let raw = await fetchOsmBbox(lat - dLat1, lng - dLng1, lat + dLat1, lng + dLng1);
      let payload = raw ? buildDenseRealOsmGraph(raw, chunkKey, lat, lng) : null;

      if (!payload || payload.osmEdges.length < 12) {
        const dLat2 = 0.0045;
        const dLng2 = 0.0058;
        raw = await fetchOsmBbox(lat - dLat2, lng - dLng2, lat + dLat2, lng + dLng2);
        if (raw) {
          payload = buildDenseRealOsmGraph(raw, chunkKey, lat, lng);
        }
      }

      if (!payload || payload.osmEdges.length < 6) {
        const dLat3 = 0.011;
        const dLng3 = 0.014;
        raw = await fetchOsmBbox(lat - dLat3, lng - dLng3, lat + dLat3, lng + dLng3);
        if (raw) {
          payload = buildDenseRealOsmGraph(raw, chunkKey, lat, lng, {
            clipLat: 0.012,
            clipLng: 0.015,
            maxEdgeMeters: 50,
            targetSubdivMeters: 40,
          });
        }
      }

      if (payload && payload.osmEdges.length > 0) {
        chunkCache.set(chunkKey, payload);
        return payload;
      }

      return buildFallbackStarterGrid(chunkKey, lat, lng);
    })();
    inFlightChunks.set(chunkKey, pending);
    pending.finally(() => inFlightChunks.delete(chunkKey));
  }

  return pending;
}

export async function loadOsmRegionInfoDirect(
  lat: number,
  lng: number
): Promise<ProvincialRegionMeta> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const region = await resolveRegionCached(lat, lng);
  if (!region) {
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
        [lat + 0.11, lng],
        [lat - 0.11, lng],
        [lat, lng + 0.14],
        [lat, lng - 0.14],
        [lat + 0.09, lng + 0.11],
        [lat + 0.09, lng - 0.11],
        [lat - 0.09, lng + 0.11],
        [lat - 0.09, lng - 0.11],
      ]
    : [
        [lat, lng],
        [lat + 0.11, lng],
        [lat - 0.11, lng],
        [lat, lng + 0.14],
        [lat, lng - 0.14],
      ];

  const settled = await Promise.allSettled(
    probes.map(([pLat, pLng]) => resolveRegionCached(pLat, pLng))
  );
  const byId = new Map<string, ProvincialRegionMeta>();

  settled.forEach((entry, idx) => {
    if (entry.status !== 'fulfilled' || !entry.value) return;
    const r = entry.value;
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

export async function loadOsmProvinceDirect(lat: number, lng: number): Promise<ProvincePayload> {
  const chunkKey = quantizeChunkKey(lat, lng);
  const region = await resolveRegionCached(lat, lng);
  const regionId = region?.regionId || `osm_prov_${chunkKey}`;
  const regionName = region?.regionName || '인접 도시 행정구역';
  const adminLevel = region?.adminLevel || '6';

  const cached = provinceCache.get(regionId);
  if (cached && cached.osmEdges.length > 0) {
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
        0.18,
        0.24
      );

      const distBoxStr = `${distBounds[0].toFixed(6)},${distBounds[1].toFixed(6)},${distBounds[2].toFixed(6)},${distBounds[3].toFixed(6)}`;
      const cityBoxStr = `${fullCityBounds[0].toFixed(6)},${fullCityBounds[1].toFixed(6)},${fullCityBounds[2].toFixed(6)},${fullCityBounds[3].toFixed(6)}`;

      const fullCityFilter = region?.relId
        ? `area(${3600000000 + region.relId})->.city;(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified).*$"](area.city);way["railway"~"^(rail|subway|light_rail|tram)$"](area.city););`
        : `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified).*$"](${cityBoxStr});way["railway"~"^(rail|subway|light_rail|tram)$"](${cityBoxStr}););`;

      const [districtRaw, cityWideRaw, localBboxRaw] = await Promise.allSettled([
        fetchOverpassQuery(
          `[out:json][timeout:6];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street).*$"](${distBoxStr});way["railway"](${distBoxStr}););out body;>;out skel qt;`,
          7500
        ),
        fetchOverpassQuery(
          `[out:json][timeout:9];${fullCityFilter}out body;>;out skel qt;`,
          9500
        ),
        fetchOsmBbox(lat - 0.0032, lng - 0.0042, lat + 0.0032, lng + 0.0042, 7500),
      ]);

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
          roadBudget: 1800,
          railBudget: 450,
          maxPerWay: 75,
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

      if (mergedEdges.size === 0) {
        const fallbackRaw = await fetchOsmBbox(lat - 0.005, lng - 0.006, lat + 0.005, lng + 0.006);
        if (fallbackRaw) {
          const g = buildDenseRealOsmGraph(fallbackRaw, chunkKey, lat, lng);
          totalWayCount += g.wayCount;
          g.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
          g.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
        }
      }

      const usedLiveOverpass = mergedEdges.size > 0;
      if (mergedEdges.size === 0) {
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

      if (usedLiveOverpass && payload.osmEdges.length > 0) {
        provinceCache.set(regionId, payload);
      }
      return payload;
    })();
    inFlightProvinces.set(regionId, pending);
    pending.finally(() => inFlightProvinces.delete(regionId));
  }

  return pending;
}
