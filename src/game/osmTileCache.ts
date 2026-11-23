import { GeoJsonBoundary, OsmEdge, OsmNode, ProvincialRegion } from './types';

export interface CachedOsmTile {
  tileKey: string;
  osmNodes: OsmNode[];
  osmEdges: OsmEdge[];
  usedLiveOverpass: boolean;
  updatedAt: number;
}

export interface CachedOsmRegion {
  regionId: string;
  regionName: string;
  adminLevel: string;
  bbox: [number, number, number, number];
  boundaryGeoJson?: GeoJsonBoundary;
  centerLat: number;
  centerLng: number;
  canonicalKey?: string;
  totalNodeCount?: number;
  updatedAt: number;
}

export interface CachedSlotGraphSnapshot {
  slotId: string;
  version: 3;
  cityId: string;
  wayNames: string[];
  hwTypes: string[];
  regionIds: string[];
  nodes: Array<[string, number, number, 0 | 1 | 2, number, string?]>;
  edges: Array<
    [
      string,
      number,
      number,
      0 | 1,
      string,
      string,
      number,
      number,
      number,
      number,
      Array<[number, number]> | 0,
    ]
  >;
  regionBoundaries: Array<[string, ProvincialRegion['boundaryGeoJson'], boolean | undefined]>;
  loadedOsmChunks: string[];
  loadedOsmRegions: string[];
  updatedAt: number;
}

const DB_NAME = 'terraline_osm_cache_v1';
const DB_VERSION = 2;
const STORE_TILES = 'osm_tiles';
const STORE_REGIONS = 'osm_regions';
const STORE_SLOT_GRAPHS = 'slot_graphs';

// Hot in-memory layer so repeated queries in the same session hit in <0.1ms
const memTiles = new Map<string, CachedOsmTile>();
const memRegions = new Map<string, CachedOsmRegion>();
const memSlotGraphs = new Map<string, CachedSlotGraphSnapshot>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbDisabled = false;

export function hasIndexedDb(): boolean {
  return !idbDisabled && typeof indexedDB !== 'undefined';
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TILES)) {
          db.createObjectStore(STORE_TILES, { keyPath: 'tileKey' });
        } else if (ev.oldVersion < 2 && req.transaction) {
          req.transaction.objectStore(STORE_TILES).clear();
        }
        if (!db.objectStoreNames.contains(STORE_REGIONS)) {
          db.createObjectStore(STORE_REGIONS, { keyPath: 'regionId' });
        }
        if (!db.objectStoreNames.contains(STORE_SLOT_GRAPHS)) {
          db.createObjectStore(STORE_SLOT_GRAPHS, { keyPath: 'slotId' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        idbDisabled = true;
        dbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch {
      idbDisabled = true;
      resolve(null);
    }
  });

  return dbPromise;
}

function runIdbGet<T>(storeName: string, key: string): Promise<T | null> {
  return openCacheDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

function runIdbPut<T>(storeName: string, value: T): Promise<void> {
  return openCacheDb().then((db) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

function runIdbDelete(storeName: string, key: string): Promise<void> {
  return openCacheDb().then((db) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

export async function getCachedOsmTile(tileKey: string): Promise<CachedOsmTile | null> {
  const mem = memTiles.get(tileKey);
  if (mem) return mem;

  const fromIdb = await runIdbGet<CachedOsmTile>(STORE_TILES, tileKey);
  if (fromIdb && Array.isArray(fromIdb.osmNodes) && fromIdb.osmNodes.length > 0) {
    memTiles.set(tileKey, fromIdb);
    return fromIdb;
  }
  return null;
}

export async function getCachedOsmTilesBatch(
  tileKeys: string[]
): Promise<Map<string, CachedOsmTile>> {
  const result = new Map<string, CachedOsmTile>();
  const missing: string[] = [];

  for (const key of tileKeys) {
    const mem = memTiles.get(key);
    if (mem && mem.osmNodes.length > 0) {
      result.set(key, mem);
    } else {
      missing.push(key);
    }
  }

  if (missing.length === 0) return result;
  const db = await openCacheDb();
  if (!db) return result;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_TILES, 'readonly');
      const store = tx.objectStore(STORE_TILES);
      for (const key of missing) {
        const req = store.get(key);
        req.onsuccess = () => {
          const val = req.result as CachedOsmTile | undefined;
          if (val && Array.isArray(val.osmNodes) && val.osmNodes.length > 0) {
            memTiles.set(key, val);
            result.set(key, val);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  return result;
}

export async function putCachedOsmTile(tile: CachedOsmTile): Promise<void> {
  if (!tile.tileKey || !Array.isArray(tile.osmNodes) || tile.osmNodes.length === 0) return;
  const record: CachedOsmTile = {
    ...tile,
    updatedAt: tile.updatedAt || Date.now(),
  };
  memTiles.set(tile.tileKey, record);
  if (memTiles.size > 800) {
    const oldestKey = memTiles.keys().next().value;
    if (oldestKey) memTiles.delete(oldestKey);
  }
  await runIdbPut(STORE_TILES, record);
}

export async function putCachedOsmTilesBatch(tiles: CachedOsmTile[]): Promise<void> {
  const valid: CachedOsmTile[] = [];
  const now = Date.now();
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!tile.tileKey || !Array.isArray(tile.osmNodes) || tile.osmNodes.length === 0) continue;
    const record: CachedOsmTile = {
      ...tile,
      updatedAt: tile.updatedAt || now,
    };
    memTiles.set(tile.tileKey, record);
    valid.push(record);
  }
  while (memTiles.size > 800) {
    const oldestKey = memTiles.keys().next().value;
    if (!oldestKey) break;
    memTiles.delete(oldestKey);
  }
  if (valid.length === 0) return;
  const db = await openCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_TILES, 'readwrite');
      const store = tx.objectStore(STORE_TILES);
      for (let i = 0; i < valid.length; i++) {
        store.put(valid[i]);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedOsmRegion(regionId: string): Promise<CachedOsmRegion | null> {
  const mem = memRegions.get(regionId);
  if (mem) return mem;

  const fromIdb = await runIdbGet<CachedOsmRegion>(STORE_REGIONS, regionId);
  if (fromIdb) {
    memRegions.set(regionId, fromIdb);
    return fromIdb;
  }
  return null;
}

export async function getCachedOsmRegionsByIds(
  regionIds: string[]
): Promise<Map<string, CachedOsmRegion>> {
  const result = new Map<string, CachedOsmRegion>();
  const missing: string[] = [];

  for (const id of regionIds) {
    const mem = memRegions.get(id);
    if (mem) {
      result.set(id, mem);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return result;
  const db = await openCacheDb();
  if (!db) return result;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_REGIONS, 'readonly');
      const store = tx.objectStore(STORE_REGIONS);
      for (const id of missing) {
        const req = store.get(id);
        req.onsuccess = () => {
          const val = req.result as CachedOsmRegion | undefined;
          if (val) {
            memRegions.set(id, val);
            result.set(id, val);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  return result;
}

export async function getAllCachedOsmRegions(): Promise<CachedOsmRegion[]> {
  const byId = new Map<string, CachedOsmRegion>();
  for (const [id, rec] of memRegions.entries()) {
    byId.set(id, rec);
  }
  const db = await openCacheDb();
  if (!db) {
    return Array.from(byId.values());
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_REGIONS, 'readonly');
      const store = tx.objectStore(STORE_REGIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as CachedOsmRegion[] | undefined) || [];
        for (const val of rows) {
          if (val && val.regionId) {
            memRegions.set(val.regionId, val);
            byId.set(val.regionId, val);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  return Array.from(byId.values());
}

export async function putCachedOsmRegion(region: CachedOsmRegion): Promise<void> {
  if (!region.regionId) return;
  const existing = memRegions.get(region.regionId);
  const merged: CachedOsmRegion = {
    ...region,
    boundaryGeoJson: region.boundaryGeoJson || existing?.boundaryGeoJson,
    canonicalKey: region.canonicalKey || existing?.canonicalKey,
    totalNodeCount: Math.max(region.totalNodeCount || 0, existing?.totalNodeCount || 0) || undefined,
    updatedAt: region.updatedAt || Date.now(),
  };
  memRegions.set(region.regionId, merged);
  await runIdbPut(STORE_REGIONS, merged);
}

export async function getCachedSlotGraph(
  slotId: string
): Promise<CachedSlotGraphSnapshot | null> {
  const mem = memSlotGraphs.get(slotId);
  if (mem) return mem;

  const fromIdb = await runIdbGet<CachedSlotGraphSnapshot>(STORE_SLOT_GRAPHS, slotId);
  if (fromIdb) {
    memSlotGraphs.set(slotId, fromIdb);
    return fromIdb;
  }
  return null;
}

export async function putCachedSlotGraph(snapshot: CachedSlotGraphSnapshot): Promise<void> {
  memSlotGraphs.set(snapshot.slotId, snapshot);
  await runIdbPut(STORE_SLOT_GRAPHS, snapshot);
}

export async function deleteCachedSlotGraph(slotId: string): Promise<void> {
  memSlotGraphs.delete(slotId);
  await runIdbDelete(STORE_SLOT_GRAPHS, slotId);
}

export function resetMemoryTileCacheForTests(): void {
  memTiles.clear();
  memRegions.clear();
  memSlotGraphs.clear();
  idbDisabled = false;
  dbPromise = null;
}
