import { MapNode, OsmEdge, OsmNode, PredefinedSegment, StartingCity, TransportLine } from './types';

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const delta = 0.055; // ~6km bounding box around town center
    const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`;

    const query = `
      [out:json][timeout:4];
      way["highway"~"motorway|trunk|primary"](${bbox});
      out geom 14;
    `;

    const res = await fetch('https://overpass.openstreetmap.fr/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.elements) && json.elements.length > 0) {
        usedLiveOsm = true;
        for (const el of json.elements) {
          if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2 && osmRoads.length < 4) {
            const pts: [number, number][] = el.geometry.map((g: { lat: number; lon: number }) => [g.lat, g.lon]);
            osmRoads.push(pts);
          }
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
 * Fetch 100% REAL OpenStreetMap road & railway geometry via /api/osm-roads
 * (backed by official api.openstreetmap.org/api/0.6/map.json, subdivided to ~24m per node).
 */
export async function fetchOsmRoadChunk(
  lat: number,
  lng: number
): Promise<{
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
}> {
  const chunkKey = chunkKeyForCoords(lat, lng);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);
    const res = await fetch(
      `/api/osm-roads?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as {
        chunkKey?: string;
        osmNodes?: OsmNode[];
        osmEdges?: OsmEdge[];
        usedLiveOverpass?: boolean;
      };
      if (Array.isArray(json.osmNodes) && Array.isArray(json.osmEdges)) {
        return {
          chunkKey: json.chunkKey || chunkKey,
          osmNodes: json.osmNodes,
          osmEdges: json.osmEdges,
          usedLiveOverpass: Boolean(json.usedLiveOverpass),
        };
      }
    }
  } catch {
    // Return empty chunk on network interruption rather than inventing fake roads
  }

  return {
    chunkKey,
    osmNodes: [],
    osmEdges: [],
    usedLiveOverpass: false,
  };
}

/**
 * Automatically fetch the enclosing OSM administrative provincial region's road & rail nodes
 * whenever the player owns >= 1 connected node inside that provincial region.
 */
export async function fetchOsmProvincialRegion(
  lat: number,
  lng: number
): Promise<{
  regionId: string;
  regionName: string;
  adminLevel: string;
  chunkKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
}> {
  const chunkKey = chunkKeyForCoords(lat, lng);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(
      `/api/osm-province?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as {
        regionId?: string;
        regionName?: string;
        adminLevel?: string;
        chunkKey?: string;
        osmNodes?: OsmNode[];
        osmEdges?: OsmEdge[];
        usedLiveOverpass?: boolean;
      };
      if (Array.isArray(json.osmNodes) && Array.isArray(json.osmEdges)) {
        return {
          regionId: json.regionId || `osm_prov_${chunkKey}`,
          regionName: json.regionName || '광역 행정구역',
          adminLevel: json.adminLevel || '4',
          chunkKey: json.chunkKey || chunkKey,
          osmNodes: json.osmNodes,
          osmEdges: json.osmEdges,
          usedLiveOverpass: Boolean(json.usedLiveOverpass),
        };
      }
    }
  } catch {
    // Graceful empty fallback if provincial Overpass lookup times out
  }

  return {
    regionId: `osm_prov_${chunkKey}`,
    regionName: '광역 행정구역',
    adminLevel: '4',
    chunkKey,
    osmNodes: [],
    osmEdges: [],
    usedLiveOverpass: false,
  };
}

