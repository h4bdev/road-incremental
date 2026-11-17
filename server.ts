import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

interface OsmRawNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

interface OsmRawWay {
  type: 'way';
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OsmMapResponse {
  elements?: Array<OsmRawNode | OsmRawWay | { type: string }>;
}

interface OsmNodeDTO {
  id: string;
  lat: number;
  lng: number;
  connected: boolean;
  mode: 'road' | 'rail' | 'mixed';
  label?: string;
}

interface OsmEdgeDTO {
  id: string;
  wayName: string;
  highwayType: string;
  mode: 'road' | 'rail';
  fromNodeId: string;
  toNodeId: string;
  coordinates: [[number, number], [number, number]];
  distanceKm: number;
  buildCost: number;
  baseIncomePerSec: number;
  built: boolean;
}

interface ChunkPayload {
  chunkKey: string;
  osmNodes: OsmNodeDTO[];
  osmEdges: OsmEdgeDTO[];
  usedLiveOverpass: boolean;
  source: 'osm-0.6-api';
  wayCount: number;
}

interface ProvincePayload extends ChunkPayload {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
}

interface ResolvedAdminRegion {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  districtBbox?: [number, number, number, number];
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

const chunkCache = new Map<string, ChunkPayload>();
const provinceCache = new Map<string, ProvincePayload>();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

function quantizeChunkKey(lat: number, lng: number): string {
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

async function fetchOverpassQuery(
  query: string,
  timeoutMs = 8500
): Promise<OsmMapResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://overpass.openstreetmap.fr/api/interpreter', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TerraLine-OSM-Builder/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = (await res.json()) as OsmMapResponse;
    if (!Array.isArray(data.elements) || data.elements.length === 0) {
      throw new Error('Overpass empty elements');
    }
    return data;
  } finally {
    clearTimeout(timer);
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
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TerraLine-OSM-Builder/1.0',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = (await res.json()) as OsmMapResponse;
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    throw new Error('Overpass empty elements');
  }
  return data;
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
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TerraLine-OSM-Builder/1.0',
    },
  });
  if (!res.ok) throw new Error(`OSM 0.6 HTTP ${res.status}`);
  const data = (await res.json()) as OsmMapResponse;
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    throw new Error('OSM 0.6 empty elements');
  }
  return data;
}

async function fetchOsmBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): Promise<OsmMapResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    return await Promise.any([
      fetchFromOsm06(minLat, minLng, maxLat, maxLng, controller.signal),
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

async function resolveOsmProvincialRegion(
  lat: number,
  lng: number
): Promise<ResolvedAdminRegion | null> {
  try {
    const query = `[out:json][timeout:6];is_in(${lat.toFixed(6)},${lng.toFixed(6)})->.a;area.a["boundary"="administrative"]["admin_level"~"^(4|5|6)$"];out tags;`;
    const areaRes = await fetchOverpassQuery(query, 6500);
    const areas = (areaRes.elements || []).filter(
      (el): el is { type: 'area'; id: number; tags?: Record<string, string> } =>
        el.type === 'area' && 'id' in el
    );

    const byLevel = (lvl: string) =>
      areas.find((a) => a.tags?.admin_level === lvl);
    const provinceArea = byLevel('4') || byLevel('5') || byLevel('6');
    const districtArea = byLevel('6') || byLevel('5');

    if (provinceArea) {
      const relId =
        provinceArea.id > 3600000000 ? provinceArea.id - 3600000000 : provinceArea.id;
      const distRelId =
        districtArea && districtArea.id > 3600000000
          ? districtArea.id - 3600000000
          : districtArea?.id;
      const provinceName =
        provinceArea.tags?.['name:ko'] ||
        provinceArea.tags?.name ||
        provinceArea.tags?.['name:en'] ||
        `Region #${relId}`;
      const districtName =
        districtArea?.tags?.['name:ko'] || districtArea?.tags?.name || '';
      const displayName =
        districtName && districtName !== provinceName
          ? `${provinceName} · ${districtName}`
          : provinceName;

      // Lookup exact bounding boxes via Nominatim
      let bbox: [number, number, number, number] = [
        lat - 0.09,
        lng - 0.11,
        lat + 0.09,
        lng + 0.11,
      ];
      let districtBbox: [number, number, number, number] | undefined;

      try {
        const ids = distRelId && distRelId !== relId ? `R${relId},R${distRelId}` : `R${relId}`;
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'TerraLine-OSM-Builder/1.0',
            },
            signal: AbortSignal.timeout(4500),
          }
        );
        if (nomRes.ok) {
          const items = (await nomRes.json()) as Array<{
            osm_id: number;
            boundingbox?: [string, string, string, string];
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
        // Keep coordinate-centered province bbox fallback
      }

      return {
        regionId: `osm_rel_${relId}`,
        regionName: displayName,
        adminLevel: provinceArea.tags?.admin_level || '4',
        bbox,
        districtBbox,
      };
    }
  } catch {
    // Fallback to Nominatim reverse lookup below
  }

  try {
    const revRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=6&addressdetails=1`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'TerraLine-OSM-Builder/1.0',
        },
        signal: AbortSignal.timeout(4500),
      }
    );
    if (revRes.ok) {
      const rev = (await revRes.json()) as {
        osm_type?: string;
        osm_id?: number;
        name?: string;
        display_name?: string;
        address?: { province?: string; state?: string; city?: string };
        boundingbox?: [string, string, string, string];
      };
      const name =
        rev.address?.province ||
        rev.address?.state ||
        rev.address?.city ||
        rev.name ||
        rev.display_name?.split(',')[0] ||
        'OSM 광역 행정구역';
      const bbox: [number, number, number, number] =
        rev.boundingbox && rev.boundingbox.length === 4
          ? [
              parseFloat(rev.boundingbox[0]),
              parseFloat(rev.boundingbox[2]),
              parseFloat(rev.boundingbox[1]),
              parseFloat(rev.boundingbox[3]),
            ]
          : [lat - 0.09, lng - 0.11, lat + 0.09, lng + 0.11];
      return {
        regionId: rev.osm_id ? `osm_nom_${rev.osm_id}` : `osm_grid_${quantizeChunkKey(lat, lng)}`,
        regionName: name,
        adminLevel: '4',
        bbox,
      };
    }
  } catch {
    // Ignore
  }

  return null;
}

function buildDenseRealOsmGraph(
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
      if (((hw && DRIVABLE_HIGHWAYS.has(hw) && !isParkingAisle) || (rw && RAILWAYS.has(rw)))) {
        validWays.push(el);
      }
    }
  }

  // Compute closest point on each way to center so small neighborhood streets near center aren't starved by distant highways
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

  // Sort by 120m concentric distance bands from center first, then by road priority within each band
  validWays.sort((a, b) => {
    const aDist = wayMinDistMap.get(a.id) ?? 99999;
    const bDist = wayMinDistMap.get(b.id) ?? 99999;
    const bandDiff = Math.floor(aDist / 120) - Math.floor(bDist / 120);
    if (bandDiff !== 0) return bandDiff;
    const pDiff = getWayPriority(a) - getWayPriority(b);
    if (pDiff !== 0) return pDiff;
    return aDist - bDist;
  });

  // Count node references across ways to preserve true OSM road intersections
  const nodeRefCount = new Map<number, number>();
  for (const way of validWays) {
    for (const nid of way.nodes!) {
      nodeRefCount.set(nid, (nodeRefCount.get(nid) || 0) + 1);
    }
  }

  const nodeMap = new Map<string, OsmNodeDTO>();
  const edgeMap = new Map<string, OsmEdgeDTO>();

  // 2-4x wider spacing (~20-28m between consecutive nodes) locally, or wider spacing for regional highways
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

      // Step 1: Collect vertices along the real way within local neighborhood while preserving intersections
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

      // Step 2: Subdivide straight stretches > MAX_EDGE_METERS along exact real road/rail geometry
      const densePts: { id: string; lat: number; lng: number; label: string }[] = [];
      for (let i = 0; i < basePts.length; i++) {
        const curr = basePts[i];
        if (i === 0) {
          densePts.push(curr);
          continue;
        }
        const prev = basePts[i - 1];
        const segMeters = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);

        // Skip jump only if clipped vertices left a massive discontinuity across the boundary
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

      // Step 3: Emit atomic real-road/rail edges & register only nodes belonging to emitted edges
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

function clampBbox(
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

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/osm-roads', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const chunkKey = quantizeChunkKey(lat, lng);
    const cached = chunkCache.get(chunkKey);
    if (cached && cached.osmEdges.length > 0) {
      res.json(cached);
      return;
    }

    // 1. Neighborhood box (~620m x 620m) for ~20-28m roads & railways
    const dLat1 = 0.0028;
    const dLng1 = 0.0036;
    let raw = await fetchOsmBbox(lat - dLat1, lng - dLng1, lat + dLat1, lng + dLng1);
    let payload = raw ? buildDenseRealOsmGraph(raw, chunkKey, lat, lng) : null;

    // 2. Widen once (~1.0km) if sparse suburban/highway area
    if (!payload || payload.osmEdges.length < 12) {
      const dLat2 = 0.0045;
      const dLng2 = 0.0058;
      raw = await fetchOsmBbox(lat - dLat2, lng - dLng2, lat + dLat2, lng + dLng2);
      if (raw) {
        payload = buildDenseRealOsmGraph(raw, chunkKey, lat, lng);
      }
    }

    if (!payload) {
      res.status(502).json({
        error: 'OpenStreetMap 도로 데이터를 일시적으로 불러오지 못했습니다.',
        chunkKey,
        osmNodes: [],
        osmEdges: [],
        usedLiveOverpass: false,
      });
      return;
    }

    if (payload.osmEdges.length > 0) {
      chunkCache.set(chunkKey, payload);
    }
    res.json(payload);
  });

  app.get('/api/osm-province', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const chunkKey = quantizeChunkKey(lat, lng);
    const region = await resolveOsmProvincialRegion(lat, lng);
    const regionId = region?.regionId || `osm_prov_${chunkKey}`;
    const regionName = region?.regionName || '인접 광역 행정구역';
    const adminLevel = region?.adminLevel || '4';

    const cached = provinceCache.get(regionId);
    if (cached && cached.osmEdges.length > 0) {
      res.json(cached);
      return;
    }

    const distBounds = clampBbox(
      region?.districtBbox || [lat - 0.011, lng - 0.014, lat + 0.011, lng + 0.014],
      lat,
      lng,
      0.012,
      0.015
    );
    const provBounds = clampBbox(
      region?.bbox || [lat - 0.06, lng - 0.08, lat + 0.06, lng + 0.08],
      lat,
      lng,
      0.06,
      0.08
    );

    const distBoxStr = `${distBounds[0].toFixed(6)},${distBounds[1].toFixed(6)},${distBounds[2].toFixed(6)},${distBounds[3].toFixed(6)}`;
    const provBoxStr = `${provBounds[0].toFixed(6)},${provBounds[1].toFixed(6)},${provBounds[2].toFixed(6)},${provBounds[3].toFixed(6)}`;

    const [districtRaw, arterialRaw] = await Promise.allSettled([
      fetchOverpassQuery(
        `[out:json][timeout:6];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street).*$"](${distBoxStr});way["railway"](${distBoxStr}););out body;>;out skel qt;`,
        7500
      ),
      fetchOverpassQuery(
        `[out:json][timeout:6];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary).*$"](${provBoxStr});way["railway"~"^(rail|subway|light_rail|tram)$"](${provBoxStr}););out body;>;out skel qt;`,
        7500
      ),
    ]);

    const mergedNodes = new Map<string, OsmNodeDTO>();
    const mergedEdges = new Map<string, OsmEdgeDTO>();
    let totalWayCount = 0;

    if (districtRaw.status === 'fulfilled') {
      const g = buildDenseRealOsmGraph(districtRaw.value, chunkKey, lat, lng, {
        clipLat: 0.013,
        clipLng: 0.016,
        maxEdgeMeters: 30,
        targetSubdivMeters: 25,
        roadBudget: 1800,
        railBudget: 450,
        maxPerWay: 75,
      });
      totalWayCount += g.wayCount;
      g.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
      g.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
    }

    if (arterialRaw.status === 'fulfilled') {
      const g = buildDenseRealOsmGraph(arterialRaw.value, chunkKey, lat, lng, {
        clipLat: 0.065,
        clipLng: 0.085,
        maxEdgeMeters: 140,
        targetSubdivMeters: 120,
        roadBudget: 1800,
        railBudget: 650,
        maxPerWay: 90,
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

    // Fallback to standard local OSM chunk if regional Overpass queries were rate-limited
    if (mergedEdges.size === 0) {
      const fallbackRaw = await fetchOsmBbox(lat - 0.004, lng - 0.005, lat + 0.004, lng + 0.005);
      if (fallbackRaw) {
        const g = buildDenseRealOsmGraph(fallbackRaw, chunkKey, lat, lng);
        totalWayCount += g.wayCount;
        g.osmNodes.forEach((n) => mergedNodes.set(n.id, n));
        g.osmEdges.forEach((e) => mergedEdges.set(e.id, e));
      }
    }

    const payload: ProvincePayload = {
      regionId,
      regionName,
      adminLevel,
      bbox: provBounds,
      chunkKey,
      osmNodes: Array.from(mergedNodes.values()),
      osmEdges: Array.from(mergedEdges.values()),
      usedLiveOverpass: mergedEdges.size > 0,
      source: 'osm-0.6-api',
      wayCount: totalWayCount,
    };

    if (payload.osmEdges.length > 0) {
      provinceCache.set(regionId, payload);
    }
    res.json(payload);
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TerraLine server listening on http://localhost:${PORT}`);
  });
}

startServer();
