import { StartingCity } from './types';
import { searchLocalCityCatalog } from './cityCatalog';

export interface NominatimRawPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  class?: string;
  type?: string;
  importance?: number;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    province?: string;
    country?: string;
    country_code?: string;
    railway?: string;
    road?: string;
  };
}

export interface PhotonRawFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    osm_id?: number;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    district?: string;
    locality?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

function haversineApproxKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111.19;
  const avgLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * 111.19 * Math.cos(avgLat);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function deduplicateCities(cities: StartingCity[], max = 6): StartingCity[] {
  const deduped: StartingCity[] = [];
  for (const c of cities) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    // Check if duplicate or within 6km of another result with same name
    const isNearbyDup = deduped.some((existing) => {
      const dist = haversineApproxKm(existing.lat, existing.lng, c.lat, c.lng);
      if (dist < 4.0) return true;
      if (existing.name === c.name && dist < 25.0) return true;
      return false;
    });
    if (!isNearbyDup) {
      deduped.push(c);
      if (deduped.length >= max) break;
    }
  }
  return deduped;
}

/**
 * Searches Nominatim with server-side User-Agent, Accept-Language, and timeout.
 */
export async function searchViaNominatim(query: string, timeoutMs = 4500): Promise<StartingCity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(
      trimmed
    )}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RoadIncremental/1.0 (https://terraline.app)',
        'Accept-Language': 'ko,en;q=0.8',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data: NominatimRawPlace[] = await res.json();
    if (!Array.isArray(data)) return [];

    const results: StartingCity[] = [];
    for (const item of data) {
      const shortName =
        item.address?.city ||
        item.address?.town ||
        item.name ||
        item.address?.village ||
        item.display_name.split(',')[0]?.trim() ||
        trimmed;

      const subRegion = item.address?.province || item.address?.state || '';
      const country =
        item.address?.country ||
        item.display_name.split(',').slice(-1)[0]?.trim() ||
        '세계';

      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const displayName =
        subRegion && subRegion !== shortName
          ? `${shortName} (${subRegion})`
          : shortName;

      results.push({
        id: `osm_${item.place_id}`,
        name: displayName,
        country,
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        zoom: 12,
        description: `${displayName} (${country}) 1:1 실측 OpenStreetMap 거점`,
        isCustom: true,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Searches Komoot Photon (CORS-friendly open OSM geocoder).
 * Works reliably from both Node.js server and client browser!
 */
export async function searchViaPhoton(query: string, timeoutMs = 4500): Promise<StartingCity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Prefer place tags (cities, towns, villages, administrative areas)
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&osm_tag=place&limit=6`;

    let res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      // Retry without tag constraint
      res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=6`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    }
    clearTimeout(timer);

    if (!res.ok) return [];
    const json = (await res.json()) as { features?: PhotonRawFeature[] };
    if (!Array.isArray(json?.features) || json.features.length === 0) {
      // If osm_tag=place had 0 features, try broader query
      const broadRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=6`, {
        headers: { Accept: 'application/json' },
      });
      if (broadRes.ok) {
        const broadJson = await broadRes.json();
        if (Array.isArray(broadJson?.features)) {
          json.features = broadJson.features;
        }
      }
    }
    if (!Array.isArray(json?.features)) return [];

    const results: StartingCity[] = [];
    for (const f of json.features) {
      if (!f.geometry || !Array.isArray(f.geometry.coordinates)) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const p = f.properties || {};
      const shortName = p.name || p.city || p.district || trimmed;
      const subRegion = p.state || '';
      const country = p.country || '세계';

      const displayName =
        subRegion && subRegion !== shortName
          ? `${shortName} (${subRegion})`
          : shortName;

      results.push({
        id: `photon_${p.osm_id || Math.round(lat * 10000)}`,
        name: displayName,
        country,
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        zoom: 12,
        description: `${displayName} (${country}) 1:1 실측 OpenStreetMap 거점`,
        isCustom: true,
      });
    }

    return results;
  } catch {
    return [];
  }
}

function candidateScore(city: StartingCity, normQuery: string): number {
  const normName = city.name.toLowerCase().replace(/\s+/g, '');
  const isCuratedHub =
    city.id.startsWith('kr_') ||
    city.id.startsWith('jp_') ||
    city.id.startsWith('us_') ||
    city.id.startsWith('uk_') ||
    city.id.startsWith('fr_') ||
    city.id.startsWith('de_') ||
    city.id.startsWith('it_') ||
    city.id.startsWith('es_') ||
    city.id.startsWith('sg_') ||
    city.id.startsWith('tw_') ||
    city.id.startsWith('hk_') ||
    city.id.startsWith('ca_') ||
    city.id.startsWith('au_') ||
    city.id.startsWith('at_') ||
    city.id.startsWith('ch_') ||
    city.id.startsWith('nl_') ||
    city.id.startsWith('th_') ||
    city.id.startsWith('ae_');

  let score = isCuratedHub ? 50 : 0;

  if (normName === normQuery) {
    score += 40;
  } else if (normName.startsWith(normQuery)) {
    score += 30;
  } else if (normName.includes(`(${normQuery}`) || normName.includes(`/${normQuery}`)) {
    score += 35;
  } else if (normName.includes(normQuery)) {
    score += 20;
  }

  return score;
}

/**
 * High-reliability multi-tier city search:
 * 1. Queries local instant catalog
 * 2. Queries Nominatim (custom User-Agent / Lang)
 * 3. Queries Photon (CORS-friendly OpenStreetMap geocoder)
 * 4. Merges, deduplicates, and ensures real-world coordinates are returned.
 */
export async function searchCitiesUnified(query: string): Promise<StartingCity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const normQuery = trimmed.toLowerCase().replace(/\s+/g, '');

  // Instant local catalog check
  const localMatches = searchLocalCityCatalog(trimmed, 4);

  // Parallel fetch from online sources with timeout
  const [nominatimResults, photonResults] = await Promise.all([
    searchViaNominatim(trimmed, 3800).catch(() => []),
    searchViaPhoton(trimmed, 3800).catch(() => []),
  ]);

  const candidates: StartingCity[] = [
    ...localMatches,
    ...nominatimResults,
    ...photonResults,
  ];

  // Rank candidates: curated major hubs & exact/prefix matches come first
  candidates.sort((a, b) => candidateScore(b, normQuery) - candidateScore(a, normQuery));

  const deduped = deduplicateCities(candidates, 6);
  if (deduped.length > 0) return deduped;

  // Fallback to broader local catalog matches if online returned 0
  return searchLocalCityCatalog(trimmed, 6);
}
