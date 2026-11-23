import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import {
  ChevronDown,
  Compass,
  GitCommitHorizontal,
  Globe,
  Layers,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  Unlock,
  X,
} from 'lucide-react';
import { GameState, OsmEdge, ProvincialRegion } from '../game/types';
import {
  calculateMultipliers,
  canConnectIsolatedRoutePair,
  computeOsmFrontierDistancesForState,
  findOsmRoadPath,
  getBuiltOsmEdgesForState,
  getDirectOsmBridgeCost,
  getExpandableProvincialRegions,
  getFrontierEdgeOpacity,
  getFrontierOsmEdgesForState,
  getFrontierVisualStyle,
  getOsmEdgeBuildCost,
  getOsmNodeConnectionFlags,
  getOsmNodeHasEdges,
  getOsmNodeMode,
  getReachableOsmNodeSet,
  getRegionUnlockCost,
  getUnseededIslandNodeIds,
  isNodeInUnlockedRegion,
  isPointInRegionBoundary,
  MAX_OSM_FRONTIER_DISTANCE,
  resolveCompatibleOsmMode,
  resolveProximityBridgeInfo,
} from '../game/rules';
import { enumerateChunkKeysForBounds, haversineKm } from '../game/osmService';
import { formatMoneyCompact } from '../game/format';
import {
  buildSimplifiedOverviewCurves,
  buildSkeletonGeoJsonFeatures,
  BuiltSkeletonTuple,
  isEdgeInViewport,
  isNodeInViewport,
  OVERVIEW_ZOOM_THRESHOLD,
  ViewportBounds,
} from '../game/osmOverview';

interface WorldMapProps {
  gameState: GameState;
  flyToTarget: { lat: number; lng: number; zoom: number; ts: number } | null;
  builtSkeleton?: BuiltSkeletonTuple[];
  loadingProgress?: { active: boolean; percent: number; label: string } | null;
  isLoadingOsm?: boolean;
  onReloadOsm?: () => void;
  onLoadOsmChunk?: (lat: number, lng: number) => void;
  onLoadOsmChunksBatch?: (
    coords: Array<{ lat: number; lng: number }>,
    options?: { force?: boolean; bypassCache?: boolean }
  ) => void;
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
  onConnectOsmPath: (fromId: string, toId: string) => void;
  onSelectIsolatedSeed?: (nodeId: string) => void;
  onUnlockRegion?: (regionId: string) => void;
  unlockingRegionId?: string | null;
  onOpenExpansionTab?: () => void;
  onBottomCardChange?: (open: boolean) => void;
}

type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

const EMPTY_FC: GeoJsonData = {
  type: 'FeatureCollection',
  features: [],
};

// MapLibre uses 512px base tile grid vs Leaflet 256px; -1 zoom keeps identical street scale
function toGlobeZoom(leafletZoom: number): number {
  if (leafletZoom <= 4) {
    const isNarrow = typeof window !== 'undefined' && window.innerWidth < 640;
    return isNarrow ? 1.35 : 2.0;
  }
  return Math.max(1.2, Math.min(18.5, leafletZoom - 1));
}

const edgeLonLatCache = new WeakMap<OsmEdge, number[][]>();

function getEdgeLonLatCoords(edge: OsmEdge): number[][] {
  let cached = edgeLonLatCache.get(edge);
  if (!cached) {
    cached = edge.coordinates.map(([lat, lng]) => [lng, lat]);
    edgeLonLatCache.set(edge, cached);
  }
  return cached;
}

function countAffordableAtOrBelow(sortedCosts: number[], capital: number): number {
  let lo = 0;
  let hi = sortedCosts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedCosts[mid] <= capital) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function buildRegionPolygonGeometry(
  region: ProvincialRegion
): { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } {
  if (region.boundaryGeoJson && region.boundaryGeoJson.coordinates.length > 0) {
    return region.boundaryGeoJson;
  }
  const [minLat, minLng, maxLat, maxLng] = region.bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

function getSafeRegionLabelAnchor(
  region: ProvincialRegion,
  unlockedRegions: ProvincialRegion[],
  placedAnchors: Array<[number, number]> = []
): [number, number] {
  let lat = region.centerLat;
  let lng = region.centerLng;
  const insideUnlocked = unlockedRegions.find(
    (u) => lat >= u.bbox[0] && lat <= u.bbox[2] && lng >= u.bbox[1] && lng <= u.bbox[3]
  );
  if (insideUnlocked) {
    if (insideUnlocked.bbox[0] - region.bbox[0] > 0.05) {
      lat = (region.bbox[0] + insideUnlocked.bbox[0]) / 2;
    } else if (region.bbox[2] - insideUnlocked.bbox[2] > 0.05) {
      lat = (insideUnlocked.bbox[2] + region.bbox[2]) / 2;
    }
  }

  const collides = (candLng: number, candLat: number) =>
    placedAnchors.some(
      (a) => Math.abs(a[0] - candLng) < 0.18 && Math.abs(a[1] - candLat) < 0.14
    );

  if (collides(lng, lat)) {
    const offsets: Array<[number, number]> = [
      [0, -0.16],
      [0, 0.16],
      [-0.22, 0],
      [0.22, 0],
      [-0.2, -0.16],
      [0.2, 0.16],
    ];
    for (const [dLng, dLat] of offsets) {
      const cLng = Math.min(region.bbox[3] - 0.03, Math.max(region.bbox[1] + 0.03, lng + dLng));
      const cLat = Math.min(region.bbox[2] - 0.03, Math.max(region.bbox[0] + 0.03, lat + dLat));
      if (!collides(cLng, cLat)) {
        return [cLng, cLat];
      }
    }
  }
  return [lng, lat];
}

const WorldMapComponent: React.FC<WorldMapProps> = ({
  gameState,
  flyToTarget,
  builtSkeleton,
  loadingProgress,
  isLoadingOsm = false,
  onReloadOsm,
  onLoadOsmChunk,
  onLoadOsmChunksBatch,
  onViewportChange,
  onConnectOsmPath,
  onSelectIsolatedSeed,
  onUnlockRegion,
  unlockingRegionId = null,
  onOpenExpansionTab,
  onBottomCardChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const regionMarkersRef = useRef<maplibregl.Marker[]>([]);

  const regionsGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const overviewEdgesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const builtEdgesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const frontierEdgesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const previewGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const nodesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const hoverNodeGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const renderedBoundsRef = useRef<ViewportBounds | null>(null);
  const prevBuiltSigRef = useRef<string>('');
  const requestViewportChunksRef = useRef<(forceRescan?: boolean) => void>(() => {});

  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  const [isOverviewZoom, setIsOverviewZoom] = useState(false);

  const [tileType, setTileType] = useState<'dark' | 'osm' | 'satellite'>('dark');
  const tileTypeRef = useRef<'dark' | 'osm' | 'satellite'>('dark');
  tileTypeRef.current = tileType;

  const [mobileRegionsOpen, setMobileRegionsOpen] = useState(false);
  const [selectedOsmNodeId, setSelectedOsmNodeId] = useState<string | null>(null);
  const [hoverOsmNodeId, setHoverOsmNodeId] = useState<string | null>(null);
  const [selectedExpandableRegionId, setSelectedExpandableRegionId] = useState<string | null>(null);

  const selectedOsmNodeIdRef = useRef<string | null>(null);
  selectedOsmNodeIdRef.current = selectedOsmNodeId;

  const hoverOsmNodeIdRef = useRef<string | null>(null);
  hoverOsmNodeIdRef.current = hoverOsmNodeId;

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const osmNodeIndex = useMemo(() => {
    const byId = new Map<string, (typeof gameState.osmNodes)[number]>();
    let connectedCount = 0;
    let connectedHash = 0;
    const nodes = gameState.osmNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      byId.set(n.id, n);
      if (n.connected) {
        connectedCount++;
        for (let j = 0; j < n.id.length; j++) {
          connectedHash = (connectedHash * 31 + n.id.charCodeAt(j)) | 0;
        }
      }
    }
    return {
      byId,
      hasAnyConnected: connectedCount > 0,
      connectedSig: `${connectedCount}:${connectedHash}`,
    };
  }, [gameState.osmNodes]);

  const osmNodeIndexRef = useRef(osmNodeIndex);
  osmNodeIndexRef.current = osmNodeIndex;

  const osmEdgeById = useMemo(() => {
    const map = new Map<string, (typeof gameState.osmEdges)[number]>();
    for (const e of gameState.osmEdges || []) {
      map.set(e.id, e);
    }
    return map;
  }, [gameState.osmEdges]);

  const isTouchRef = useRef(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  );

  const callbacksRef = useRef({
    onLoadOsmChunk,
    onLoadOsmChunksBatch,
    onViewportChange,
    onConnectOsmPath,
    onSelectIsolatedSeed,
    onUnlockRegion,
  });
  callbacksRef.current = {
    onLoadOsmChunk,
    onLoadOsmChunksBatch,
    onViewportChange,
    onConnectOsmPath,
    onSelectIsolatedSeed,
    onUnlockRegion,
  };

  const pendingSeedCount = (gameState.pendingSeedRegionIds || []).length;
  const prevPendingCountRef = useRef(pendingSeedCount);
  useEffect(() => {
    if (pendingSeedCount > prevPendingCountRef.current) {
      setSelectedOsmNodeId(null);
      setHoverOsmNodeId(null);
    }
    prevPendingCountRef.current = pendingSeedCount;
  }, [pendingSeedCount]);

  useEffect(() => {
    onBottomCardChange?.(Boolean(selectedOsmNodeId) || pendingSeedCount > 0);
  }, [selectedOsmNodeId, pendingSeedCount, onBottomCardChange]);

  const applyTileVisibility = (map: maplibregl.Map, active: 'dark' | 'osm' | 'satellite') => {
    const layers: Array<{ id: string; key: 'dark' | 'osm' | 'satellite' }> = [
      { id: 'tile-dark-layer', key: 'dark' },
      { id: 'tile-osm-layer', key: 'osm' },
      { id: 'tile-satellite-layer', key: 'satellite' },
    ];
    for (const item of layers) {
      if (map.getLayer(item.id)) {
        map.setLayoutProperty(item.id, 'visibility', item.key === active ? 'visible' : 'none');
      }
    }
  };

  const isOverviewZoomRef = useRef(isOverviewZoom);
  isOverviewZoomRef.current = isOverviewZoom;
  const overviewDataVersionRef = useRef(0);
  const overviewSyncedVersionRef = useRef(-1);

  const pendingSourceSyncRef = useRef<Map<string, GeoJsonData>>(new Map());
  const sourceSyncRafRef = useRef(0);

  const flushPendingSourceSync = () => {
    sourceSyncRafRef.current = 0;
    const map = mapInstanceRef.current;
    if (!map) {
      pendingSourceSyncRef.current.clear();
      return;
    }
    pendingSourceSyncRef.current.forEach((data, sourceId) => {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      }
    });
    pendingSourceSyncRef.current.clear();
  };

  const syncSourceData = (sourceId: string, data: GeoJsonData) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    pendingSourceSyncRef.current.set(sourceId, data);
    if (sourceSyncRafRef.current === 0) {
      sourceSyncRafRef.current = requestAnimationFrame(flushPendingSourceSync);
    }
  };

  // Initialize MapLibre GL 3D Globe once at street-node scale
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialZoom = toGlobeZoom(Math.max(gameState.startingCity.zoom || 12, 16));

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: [gameState.startingCity.lng, gameState.startingCity.lat],
      zoom: initialZoom,
      minZoom: 0.9,
      maxZoom: 19,
      pitch: 0,
      bearing: 0,
      doubleClickZoom: false,
      touchPitch: false,
      maplibreLogo: false,
      attributionControl: { compact: true },
      canvasContextAttributes: {
        antialias: true,
      },
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: {
          'sky-color': '#050b18',
          'horizon-color': '#1d4ed8',
          'sky-horizon-blend': 0.5,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.88, 5, 0.72, 8, 0],
        },
        sources: {
          'tile-dark': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 16,
            attribution: 'Tiles &copy; Esri | OpenStreetMap 1:1 World Data',
          },
          'tile-osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          },
          'tile-satellite': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 18,
            attribution: 'Tiles &copy; Esri World Imagery',
          },
          'regions-overlay': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-edges-overview': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-edges-frontier': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-edges-built': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-preview': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-nodes': {
            type: 'geojson',
            data: EMPTY_FC,
          },
          'osm-hover-node': {
            type: 'geojson',
            data: EMPTY_FC,
          },
        },
        layers: [
          {
            id: 'tile-dark-layer',
            type: 'raster',
            source: 'tile-dark',
            layout: { visibility: 'visible' },
            paint: { 'raster-fade-duration': 150 },
          },
          {
            id: 'tile-osm-layer',
            type: 'raster',
            source: 'tile-osm',
            layout: { visibility: 'none' },
            paint: { 'raster-fade-duration': 150 },
          },
          {
            id: 'tile-satellite-layer',
            type: 'raster',
            source: 'tile-satellite',
            layout: { visibility: 'none' },
            paint: { 'raster-fade-duration': 150 },
          },
          {
            id: 'regions-unlocked-line',
            type: 'line',
            source: 'regions-overlay',
            filter: ['==', ['get', 'kind'], 'unlocked'],
            paint: {
              'line-color': '#38bdf8',
              'line-width': 1.6,
              'line-opacity': 0.38,
            },
          },
          {
            id: 'regions-expandable-fill',
            type: 'fill',
            source: 'regions-overlay',
            filter: ['==', ['get', 'kind'], 'expandable'],
            paint: {
              'fill-color': ['case', ['get', 'canAfford'], '#38bdf8', '#f59e0b'],
              'fill-opacity': [
                'case',
                ['get', 'selected'],
                0.18,
                ['get', 'canAfford'],
                0.11,
                0.06,
              ],
            },
          },
          {
            id: 'regions-expandable-line',
            type: 'line',
            source: 'regions-overlay',
            filter: ['==', ['get', 'kind'], 'expandable'],
            paint: {
              'line-color': ['case', ['get', 'canAfford'], '#38bdf8', '#f59e0b'],
              'line-width': ['case', ['get', 'selected'], 2.8, 2.0],
              'line-opacity': 0.85,
              'line-dasharray': [4, 3],
            },
          },
          // Overview Zoom (< 11.5): simplified smooth curved polylines (no sub-pixel dot clutter)
          {
            id: 'osm-overview-unbuilt-road',
            type: 'line',
            source: 'osm-edges-overview',
            maxzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['all', ['==', ['get', 'built'], false], ['==', ['get', 'mode'], 'road']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#f59e0b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.0, 8, 1.7, 11.4, 2.5],
              'line-opacity': ['case', ['==', ['get', 'tier'], 'major'], 0.58, 0.34],
            },
          },
          {
            id: 'osm-overview-unbuilt-rail',
            type: 'line',
            source: 'osm-edges-overview',
            maxzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['all', ['==', ['get', 'built'], false], ['==', ['get', 'mode'], 'rail']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#22d3ee',
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.1, 8, 2.0, 11.4, 2.7],
              'line-opacity': 0.65,
            },
          },
          {
            id: 'osm-overview-built-casing',
            type: 'line',
            source: 'osm-edges-overview',
            maxzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'built'], true],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['==', ['get', 'mode'], 'rail'], '#082f49', '#291a05'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.8, 8, 4.4, 11.4, 6.2],
              'line-opacity': 0.9,
            },
          },
          {
            id: 'osm-overview-built-surface',
            type: 'line',
            source: 'osm-edges-overview',
            maxzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'built'], true],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['==', ['get', 'mode'], 'rail'], '#22d3ee', '#f59e0b'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.6, 8, 2.7, 11.4, 3.8],
              'line-opacity': 0.98,
            },
          },
          // Street Zoom (>= 11.5): detailed clickable nodes & frontier edges
          {
            id: 'osm-edges-unbuilt-road',
            type: 'line',
            source: 'osm-edges-frontier',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'mode'], 'road'],
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['get', 'canAfford'], '#f59e0b', '#78350f'],
              'line-width': 2.6,
              'line-opacity': ['get', 'edgeOpacity'],
              'line-dasharray': [2.2, 2],
            },
          },
          {
            id: 'osm-edges-unbuilt-rail',
            type: 'line',
            source: 'osm-edges-frontier',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'mode'], 'rail'],
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['get', 'canAfford'], '#22d3ee', '#155e75'],
              'line-width': 3.5,
              'line-opacity': ['get', 'edgeOpacity'],
              'line-dasharray': [1.2, 1.8],
            },
          },
          {
            id: 'osm-edges-built-casing',
            type: 'line',
            source: 'osm-edges-built',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['==', ['get', 'mode'], 'rail'], '#082f49', '#291a05'],
              'line-width': ['case', ['==', ['get', 'mode'], 'rail'], 7.2, 6.8],
              'line-opacity': 0.92,
            },
          },
          {
            id: 'osm-edges-built-surface',
            type: 'line',
            source: 'osm-edges-built',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['==', ['get', 'mode'], 'rail'], '#22d3ee', '#f59e0b'],
              'line-width': ['case', ['==', ['get', 'mode'], 'rail'], 3.4, 4.2],
              'line-opacity': 0.98,
            },
          },
          {
            id: 'osm-preview-solid',
            type: 'line',
            source: 'osm-preview',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'dashed'], false],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['get', 'width'],
              'line-opacity': 0.95,
            },
          },
          {
            id: 'osm-preview-dashed',
            type: 'line',
            source: 'osm-preview',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['==', ['get', 'dashed'], true],
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['get', 'width'],
              'line-opacity': 0.9,
              'line-dasharray': [2, 2],
            },
          },
          {
            id: 'osm-nodes-halo',
            type: 'circle',
            source: 'osm-nodes',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['all', ['==', ['get', 'hideDot'], false], ['!=', ['get', 'mode'], 'road']],
            paint: {
              'circle-radius': ['get', 'haloRadius'],
              'circle-color': 'rgba(0,0,0,0)',
              'circle-opacity': 0,
              'circle-stroke-color': ['get', 'haloColor'],
              'circle-stroke-width': ['get', 'haloWidth'],
              'circle-stroke-opacity': ['get', 'haloOpacity'],
              'circle-pitch-alignment': 'viewport',
            },
          },
          {
            id: 'osm-nodes-circle',
            type: 'circle',
            source: 'osm-nodes',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            paint: {
              'circle-radius': ['get', 'radius'],
              'circle-color': ['get', 'fillColor'],
              'circle-opacity': ['get', 'fillOpacity'],
              'circle-stroke-color': ['get', 'strokeColor'],
              'circle-stroke-width': ['get', 'strokeWidth'],
              'circle-stroke-opacity': ['get', 'strokeOpacity'],
              'circle-pitch-alignment': 'viewport',
            },
          },
          {
            id: 'osm-nodes-hover-halo',
            type: 'circle',
            source: 'osm-hover-node',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            filter: ['!=', ['get', 'mode'], 'road'],
            paint: {
              'circle-radius': ['get', 'haloRadius'],
              'circle-color': 'rgba(0,0,0,0)',
              'circle-opacity': 0,
              'circle-stroke-color': ['get', 'haloColor'],
              'circle-stroke-width': ['get', 'haloWidth'],
              'circle-stroke-opacity': ['get', 'haloOpacity'],
              'circle-pitch-alignment': 'viewport',
            },
          },
          {
            id: 'osm-nodes-hover-circle',
            type: 'circle',
            source: 'osm-hover-node',
            minzoom: OVERVIEW_ZOOM_THRESHOLD,
            paint: {
              'circle-radius': ['get', 'radius'],
              'circle-color': ['get', 'fillColor'],
              'circle-opacity': ['get', 'fillOpacity'],
              'circle-stroke-color': ['get', 'strokeColor'],
              'circle-stroke-width': ['get', 'strokeWidth'],
              'circle-stroke-opacity': ['get', 'strokeOpacity'],
              'circle-pitch-alignment': 'viewport',
            },
          },
        ],
      },
    });

    map.doubleClickZoom?.disable();
    map.on('dblclick', (ev) => {
      ev.preventDefault();
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      'bottom-right'
    );
    map.addControl(new maplibregl.GlobeControl(), 'bottom-right');

    const queryNearestOsmNode = (point: maplibregl.Point) => {
      if (
        !styleReadyRef.current ||
        !map.getLayer('osm-nodes-circle') ||
        map.getZoom() < OVERVIEW_ZOOM_THRESHOLD
      ) {
        return null;
      }
      const tol = isTouchRef.current ? 16 : 7;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - tol, point.y - tol],
        [point.x + tol, point.y + tol],
      ];
      const features = map.queryRenderedFeatures(bbox, { layers: ['osm-nodes-circle'] });
      if (features.length === 0) return null;

      let best = features[0];
      let bestDistSq = Infinity;
      for (const feat of features) {
        if (feat.geometry.type !== 'Point') continue;
        const coords = feat.geometry.coordinates as [number, number];
        const projected = map.project(coords);
        const dx = projected.x - point.x;
        const dy = projected.y - point.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = feat;
        }
      }
      return best;
    };

    const computeRawViewportBounds = (): ViewportBounds => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      return {
        minLat: Math.max(-85, sw.lat),
        maxLat: Math.min(85, ne.lat),
        minLng: Math.max(-180, sw.lng),
        maxLng: Math.min(180, ne.lng),
      };
    };

    const computePaddedViewportBounds = (): ViewportBounds => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      const spanLat = Math.abs(ne.lat - sw.lat);
      const spanLng = Math.abs(ne.lng - sw.lng);
      const padLat = Math.max(0.035, spanLat * 0.75);
      const padLng = Math.max(0.045, (spanLng > 340 ? 0 : spanLng) * 0.75);
      const minLng = spanLng > 340 ? -180 : Math.max(-180, sw.lng - padLng);
      const maxLng = spanLng > 340 ? 180 : Math.min(180, ne.lng + padLng);
      return {
        minLat: Math.max(-85, sw.lat - padLat),
        maxLat: Math.min(85, ne.lat + padLat),
        minLng,
        maxLng,
      };
    };

    const syncGlobeOverviewAttr = () => {
      const z = map.getZoom();
      if (mapContainerRef.current) {
        mapContainerRef.current.dataset.globeOverview = z < 8.5 ? 'true' : 'false';
        mapContainerRef.current.dataset.lodOverview =
          z < OVERVIEW_ZOOM_THRESHOLD ? 'true' : 'false';
      }
      setIsOverviewZoom((prev) => {
        const next = z < OVERVIEW_ZOOM_THRESHOLD;
        return prev === next ? prev : next;
      });
    };

    const syncViewportState = (forceRefresh = false) => {
      const raw = computeRawViewportBounds();
      const prevRendered = renderedBoundsRef.current;
      const z = map.getZoom();

      // While panning inside the already-rendered padded buffer, skip React/GeoJSON updates completely
      if (
        !forceRefresh &&
        prevRendered &&
        raw.minLat >= prevRendered.minLat + 0.002 &&
        raw.maxLat <= prevRendered.maxLat - 0.002 &&
        raw.minLng >= prevRendered.minLng + 0.002 &&
        raw.maxLng <= prevRendered.maxLng - 0.002
      ) {
        callbacksRef.current.onViewportChange?.(prevRendered, z);
        return;
      }

      const bounds = computePaddedViewportBounds();
      if (
        prevRendered &&
        Math.abs(prevRendered.minLat - bounds.minLat) < 0.0015 &&
        Math.abs(prevRendered.maxLat - bounds.maxLat) < 0.0015 &&
        Math.abs(prevRendered.minLng - bounds.minLng) < 0.0015 &&
        Math.abs(prevRendered.maxLng - bounds.maxLng) < 0.0015
      ) {
        callbacksRef.current.onViewportChange?.(prevRendered, z);
        return;
      }

      renderedBoundsRef.current = bounds;
      setViewportBounds(bounds);
      callbacksRef.current.onViewportChange?.(bounds, z);
    };

    const syncAllSources = () => {
      styleReadyRef.current = true;
      map.setProjection({ type: 'globe' });
      applyTileVisibility(map, tileTypeRef.current);
      syncGlobeOverviewAttr();
      syncViewportState();
      pendingSourceSyncRef.current.clear();

      const regionsSrc = map.getSource('regions-overlay') as maplibregl.GeoJSONSource | undefined;
      regionsSrc?.setData(regionsGeoJsonRef.current);

      const overviewEdgesSrc = map.getSource('osm-edges-overview') as
        | maplibregl.GeoJSONSource
        | undefined;
      overviewEdgesSrc?.setData(overviewEdgesGeoJsonRef.current);

      const builtEdgesSrc = map.getSource('osm-edges-built') as maplibregl.GeoJSONSource | undefined;
      builtEdgesSrc?.setData(builtEdgesGeoJsonRef.current);

      const frontierEdgesSrc = map.getSource('osm-edges-frontier') as maplibregl.GeoJSONSource | undefined;
      frontierEdgesSrc?.setData(frontierEdgesGeoJsonRef.current);

      const previewSrc = map.getSource('osm-preview') as maplibregl.GeoJSONSource | undefined;
      previewSrc?.setData(previewGeoJsonRef.current);

      const nodesSrc = map.getSource('osm-nodes') as maplibregl.GeoJSONSource | undefined;
      nodesSrc?.setData(nodesGeoJsonRef.current);

      const hoverNodeSrc = map.getSource('osm-hover-node') as maplibregl.GeoJSONSource | undefined;
      hoverNodeSrc?.setData(hoverNodeGeoJsonRef.current);
    };

    const handleInitialMapLoad = () => {
      syncAllSources();
      setTimeout(() => {
        requestViewportChunksRef.current(false);
      }, 450);
    };

    map.on('style.load', syncAllSources);
    map.on('load', handleInitialMapLoad);
    if (map.isStyleLoaded() || Boolean(map.getSource('osm-edges-built'))) {
      syncAllSources();
    }

    map.on('zoom', syncGlobeOverviewAttr);

    let hoverRafId = 0;
    let pendingMousePoint: maplibregl.Point | null = null;
    let lastQueriedPoint: { x: number; y: number } | null = null;

    map.on('mousemove', (ev) => {
      pendingMousePoint = ev.point;
      if (hoverRafId !== 0) return;
      hoverRafId = requestAnimationFrame(() => {
        hoverRafId = 0;
        const pt = pendingMousePoint;
        if (!pt || !mapInstanceRef.current) return;
        if (lastQueriedPoint) {
          const dx = pt.x - lastQueriedPoint.x;
          const dy = pt.y - lastQueriedPoint.y;
          if (dx * dx + dy * dy < 4) return;
        }
        lastQueriedPoint = { x: pt.x, y: pt.y };

        const hit = queryNearestOsmNode(pt);
        if (!hit || hit.geometry.type !== 'Point') {
          map.getCanvas().style.cursor = '';
          if (hoverOsmNodeIdRef.current !== null) {
            setHoverOsmNodeId(null);
          }
          return;
        }

        const props = (hit.properties || {}) as Record<string, unknown>;
        const nodeId = String(props.id || '');
        if (!nodeId) return;

        map.getCanvas().style.cursor = 'pointer';
        if (hoverOsmNodeIdRef.current !== nodeId) {
          setHoverOsmNodeId(nodeId);
        }
      });
    });

    map.on('mouseout', () => {
      if (hoverRafId !== 0) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = 0;
      }
      pendingMousePoint = null;
      lastQueriedPoint = null;
      map.getCanvas().style.cursor = '';
      if (hoverOsmNodeIdRef.current !== null) {
        setHoverOsmNodeId(null);
      }
    });

    map.on('click', (ev) => {
      const hit = queryNearestOsmNode(ev.point);
      if (!hit || !hit.properties) {
        // Allow clicking an expandable region polygon on the map to focus/select it
        if (!selectedOsmNodeIdRef.current && map.getLayer('regions-expandable-fill')) {
          const regFeats = map.queryRenderedFeatures(ev.point, {
            layers: ['regions-expandable-fill'],
          });
          if (regFeats.length > 0) {
            const rid = String(regFeats[0].properties?.regionId || '');
            if (rid) {
              setSelectedExpandableRegionId(rid);
            }
          }
        }
        return;
      }
      const hitProps = hit.properties as Record<string, unknown>;
      const nodeId = String(hitProps.id || '');
      if (!nodeId) return;

      if (Boolean(hitProps.isPendingSeed)) {
        callbacksRef.current.onSelectIsolatedSeed?.(nodeId);
        setSelectedOsmNodeId(null);
        setHoverOsmNodeId(null);
        return;
      }

      const currentStart = selectedOsmNodeIdRef.current;
      if (!currentStart) {
        setSelectedOsmNodeId(nodeId);
      } else if (currentStart === nodeId) {
        setSelectedOsmNodeId(null);
        setHoverOsmNodeId(null);
      } else {
        const nodeIdx = osmNodeIndexRef.current;
        const startNode = nodeIdx.byId.get(currentStart);
        const targetNode = nodeIdx.byId.get(nodeId);
        if (
          nodeIdx.hasAnyConnected &&
          !startNode?.connected &&
          !targetNode?.connected &&
          !canConnectIsolatedRoutePair(gameStateRef.current, currentStart, nodeId)
        ) {
          setSelectedOsmNodeId(nodeId);
          return;
        }

        const canLink =
          resolveCompatibleOsmMode(gameStateRef.current, currentStart, nodeId) !== null &&
          Boolean(reachableOsmNodeSetRef.current?.has(nodeId));
        if (canLink) {
          callbacksRef.current.onConnectOsmPath(currentStart, nodeId);
          setSelectedOsmNodeId(nodeId);
        } else {
          setSelectedOsmNodeId(nodeId);
        }
      }
    });

    // Right-click exits continuous NIMBY Rails node-chain mode cleanly
    map.on('contextmenu', (ev) => {
      ev.preventDefault();
      if (selectedOsmNodeIdRef.current) {
        setSelectedOsmNodeId(null);
        setHoverOsmNodeId(null);
      }
    });

    const executeViewportChunkCheck = (forceRescan = false) => {
      const curMap = mapInstanceRef.current;
      if (!curMap) return;
      syncViewportState(true);
      if (curMap.getZoom() < OVERVIEW_ZOOM_THRESHOLD) return;
      const rawBounds = computeRawViewportBounds();
      const prefetchBounds: ViewportBounds = {
        minLat: Math.max(-85, rawBounds.minLat - 0.010),
        maxLat: Math.min(85, rawBounds.maxLat + 0.010),
        minLng: Math.max(-180, rawBounds.minLng - 0.014),
        maxLng: Math.min(180, rawBounds.maxLng + 0.014),
      };
      const gs = gameStateRef.current;
      const unlockedRegions = (gs.provincialRegions || []).filter((r) => r.unlocked);
      if (unlockedRegions.length === 0) return;

      const screenChunks = enumerateChunkKeysForBounds(rawBounds, 20);
      if (forceRescan) {
        const rescanCoords: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < screenChunks.length && rescanCoords.length < 16; i++) {
          const c = screenChunks[i];
          const inUnlocked = unlockedRegions.some((r) =>
            isPointInRegionBoundary(c.lat, c.lng, r, 0.005)
          );
          if (inUnlocked) {
            rescanCoords.push({ lat: c.lat, lng: c.lng });
          }
        }
        if (rescanCoords.length > 0 && callbacksRef.current.onLoadOsmChunksBatch) {
          callbacksRef.current.onLoadOsmChunksBatch(rescanCoords, {
            force: true,
            bypassCache: true,
          });
        }
        return;
      }

      // Prioritize currently visible on-screen chunks first, then moderate prefetch halo
      const haloChunks = enumerateChunkKeysForBounds(prefetchBounds, 28);
      const orderedCandidates: Array<{ key: string; lat: number; lng: number }> = [];
      const seenKeys = new Set<string>();
      for (let i = 0; i < screenChunks.length; i++) {
        const c = screenChunks[i];
        if (!seenKeys.has(c.key)) {
          seenKeys.add(c.key);
          orderedCandidates.push(c);
        }
      }
      for (let i = 0; i < haloChunks.length; i++) {
        const c = haloChunks[i];
        if (!seenKeys.has(c.key)) {
          seenKeys.add(c.key);
          orderedCandidates.push(c);
        }
      }

      const loadedSet = new Set(gs.loadedOsmChunks || []);
      const missingCoords: Array<{ lat: number; lng: number }> = [];

      for (let i = 0; i < orderedCandidates.length && missingCoords.length < 24; i++) {
        const c = orderedCandidates[i];
        if (loadedSet.has(c.key)) continue;
        const inUnlocked = unlockedRegions.some((r) =>
          isPointInRegionBoundary(c.lat, c.lng, r, 0.005)
        );
        if (inUnlocked) {
          missingCoords.push({ lat: c.lat, lng: c.lng });
        }
      }

      if (missingCoords.length > 0) {
        if (callbacksRef.current.onLoadOsmChunksBatch) {
          callbacksRef.current.onLoadOsmChunksBatch(missingCoords);
        } else if (callbacksRef.current.onLoadOsmChunk) {
          for (let i = 0; i < Math.min(missingCoords.length, 4); i++) {
            callbacksRef.current.onLoadOsmChunk(missingCoords[i].lat, missingCoords[i].lng);
          }
        }
      }
    };
    requestViewportChunksRef.current = executeViewportChunkCheck;

    let moveEndTimer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      syncGlobeOverviewAttr();
      if (moveEndTimer) clearTimeout(moveEndTimer);
      moveEndTimer = setTimeout(() => {
        executeViewportChunkCheck(false);
      }, 110);
    };
    map.on('moveend', onMoveEnd);

    let moveThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    const onMapMove = () => {
      if (moveThrottleTimer) return;
      moveThrottleTimer = setTimeout(() => {
        moveThrottleTimer = null;
        if (!mapInstanceRef.current) return;
        syncViewportState(false);
      }, 180);
    };
    map.on('move', onMapMove);

    mapInstanceRef.current = map;

    return () => {
      if (moveEndTimer) {
        clearTimeout(moveEndTimer);
        moveEndTimer = null;
      }
      if (moveThrottleTimer) {
        clearTimeout(moveThrottleTimer);
        moveThrottleTimer = null;
      }
      map.off('move', onMapMove);
      map.off('moveend', onMoveEnd);
      if (hoverRafId !== 0) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = 0;
      }
      if (sourceSyncRafRef.current !== 0) {
        cancelAnimationFrame(sourceSyncRafRef.current);
        sourceSyncRafRef.current = 0;
      }
      pendingSourceSyncRef.current.clear();
      styleReadyRef.current = false;
      regionMarkersRef.current.forEach((m) => m.remove());
      regionMarkersRef.current = [];
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Esc key cancels active OSM node selection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedOsmNodeId(null);
        setHoverOsmNodeId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Fly to requested target
  useEffect(() => {
    if (!flyToTarget || !mapInstanceRef.current) return;
    const targetZoom = toGlobeZoom(flyToTarget.zoom);
    mapInstanceRef.current.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: targetZoom,
      pitch: flyToTarget.zoom <= 4 ? 14 : 0,
      bearing: 0,
      duration: 1200,
    });
  }, [flyToTarget]);

  const switchTileLayer = (type: 'dark' | 'osm' | 'satellite') => {
    setTileType(type);
    if (!mapInstanceRef.current) return;
    applyTileVisibility(mapInstanceRef.current, type);
  };

  const pendingSeedSet = useMemo(
    () => new Set(gameState.pendingSeedRegionIds || []),
    [gameState.pendingSeedRegionIds]
  );

  const pendingRegionList = useMemo(
    () => (gameState.provincialRegions || []).filter((r) => pendingSeedSet.has(r.regionId)),
    [gameState.provincialRegions, pendingSeedSet]
  );

  const connectedOsmNodeKey = osmNodeIndex.connectedSig;

  const edgeTopologyKey = `${(gameState.osmEdges || []).length}:${gameState.stats.totalOsmEdgesBuilt}`;

  const frontierDistances = useMemo(
    () => computeOsmFrontierDistancesForState(gameState),
    [
      connectedOsmNodeKey,
      edgeTopologyKey,
      gameState.skills,
      gameState.provincialRegions,
      gameState.pendingSeedRegionIds,
    ]
  );

  const unseededIslandNodeIds = useMemo(
    () => getUnseededIslandNodeIds(gameState),
    [
      connectedOsmNodeKey,
      edgeTopologyKey,
      gameState.osmNodes,
      gameState.osmEdges,
      gameState.provincialRegions,
      gameState.pendingSeedRegionIds,
    ]
  );

  // Auto-center on primary starting seed node if it is > 0.25km away from city center
  const centeredSeedCityRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || gameState.stats.totalOsmEdgesBuilt > 0) return;
    if (centeredSeedCityRef.current === gameState.startingCity.id) return;
    if ((gameState.pendingSeedRegionIds || []).length > 0) {
      centeredSeedCityRef.current = gameState.startingCity.id;
      return;
    }
    const seedNode = (gameState.osmNodes || []).find((n) => n.connected);
    if (!seedNode) return;
    centeredSeedCityRef.current = gameState.startingCity.id;
    const distKm = haversineKm(
      gameState.startingCity.lat,
      gameState.startingCity.lng,
      seedNode.lat,
      seedNode.lng
    );
    if (distKm > 0.25) {
      map.easeTo({
        center: [seedNode.lng, seedNode.lat],
        zoom: toGlobeZoom(Math.max(gameState.startingCity.zoom || 12, 16)),
        duration: 700,
      });
    }
  }, [
    gameState.startingCity.id,
    gameState.osmNodes.length,
    gameState.stats.totalOsmEdgesBuilt,
    gameState.pendingSeedRegionIds,
  ]);

  const reachableOsmNodeSet = useMemo(() => {
    if (!selectedOsmNodeId) return null;
    return getReachableOsmNodeSet(gameState, selectedOsmNodeId);
  }, [
    selectedOsmNodeId,
    gameState.osmEdges,
    gameState.osmNodes,
    gameState.skills,
    gameState.provincialRegions,
  ]);

  const reachableOsmNodeSetRef = useRef<Set<string> | null>(null);
  reachableOsmNodeSetRef.current = reachableOsmNodeSet;

  // Compute live NIMBY Rails path preview when anchor node A is selected and node B is hovered (decoupled from 10Hz capital ticks)
  const previewResult = useMemo(() => {
    if (!selectedOsmNodeId || !hoverOsmNodeId || selectedOsmNodeId === hoverOsmNodeId) {
      return null;
    }
    const nA = osmNodeIndex.byId.get(selectedOsmNodeId);
    const nB = osmNodeIndex.byId.get(hoverOsmNodeId);
    if (!nA || !nB) return null;
    if (
      osmNodeIndex.hasAnyConnected &&
      !nA.connected &&
      !nB.connected &&
      !canConnectIsolatedRoutePair(gameState, selectedOsmNodeId, hoverOsmNodeId)
    ) {
      return null;
    }

    const path = findOsmRoadPath(gameState, selectedOsmNodeId, hoverOsmNodeId);
    if (path) {
      return {
        kind: 'path' as const,
        edgeIds: path.edgeIds,
        unbuiltCount: path.unbuiltEdgeIds.length,
        meters: Math.max(1, Math.round(path.totalDistanceKm * 1000)),
        cost: path.totalUnbuiltCost,
      };
    }

    const compat = resolveCompatibleOsmMode(gameState, selectedOsmNodeId, hoverOsmNodeId);
    if (!compat) return null;

    const bridgeInfo = resolveProximityBridgeInfo(gameState, selectedOsmNodeId, hoverOsmNodeId);
    if (bridgeInfo) {
      const m = calculateMultipliers(gameState);
      const rawCost = getDirectOsmBridgeCost(bridgeInfo.distKm, m);
      return {
        kind: bridgeInfo.kind,
        fromCoords: [nA.lat, nA.lng] as [number, number],
        toCoords: [nB.lat, nB.lng] as [number, number],
        unbuiltCount: 1,
        meters: Math.max(1, Math.round(bridgeInfo.distKm * 1000)),
        cost: rawCost,
      };
    }

    // Never preview a fake bridge across two separate 2-lane road/rail ways
    if (compat !== 'transfer') {
      const fromHasEdges = getOsmNodeHasEdges(gameState, selectedOsmNodeId);
      const toHasEdges = getOsmNodeHasEdges(gameState, hoverOsmNodeId);
      if (fromHasEdges && toHasEdges) {
        return null;
      }
    }

    const distKm = haversineKm(nA.lat, nA.lng, nB.lat, nB.lng);
    const maxDist = compat === 'transfer' ? 0.035 : 0.15;
    if (distKm <= maxDist) {
      const m = calculateMultipliers(gameState);
      const rawCost = getDirectOsmBridgeCost(distKm, m);
      return {
        kind: compat === 'transfer' ? ('transfer' as const) : ('bridge' as const),
        fromCoords: [nA.lat, nA.lng] as [number, number],
        toCoords: [nB.lat, nB.lng] as [number, number],
        unbuiltCount: 1,
        meters: Math.max(1, Math.round(distKm * 1000)),
        cost: rawCost,
      };
    }
    return null;
  }, [
    selectedOsmNodeId,
    hoverOsmNodeId,
    osmNodeIndex,
    gameState.osmNodes,
    gameState.osmEdges,
    gameState.skills,
    gameState.provincialRegions,
    gameState.stats.connectedOsmNodes,
    gameState.stats.totalOsmEdgesBuilt,
  ]);

  const previewAffordable = Boolean(previewResult && gameState.capital >= previewResult.cost);

  // Update Live Hover Preview Path GeoJSON
  useEffect(() => {
    const features: Array<{
      type: 'Feature';
      properties: { dashed: boolean; color: string; width: number };
      geometry: { type: 'LineString'; coordinates: number[][] };
    }> = [];

    if (previewResult) {
      const affordable = previewAffordable;
      if (previewResult.kind === 'path') {
        const previewColor = affordable ? '#10b981' : '#f43f5e';
        previewResult.edgeIds.forEach((eid) => {
          const edge = osmEdgeById.get(eid);
          if (!edge || edge.coordinates.length < 2) return;
          features.push({
            type: 'Feature',
            properties: { dashed: false, color: previewColor, width: 6.5 },
            geometry: {
              type: 'LineString',
              coordinates: getEdgeLonLatCoords(edge),
            },
          });
        });
      } else {
        const lineColor = !affordable
          ? '#f43f5e'
          : previewResult.kind === 'transfer'
          ? '#c084fc'
          : previewResult.kind === 'isolated_route'
          ? '#34d399'
          : '#38bdf8';
        features.push({
          type: 'Feature',
          properties: { dashed: true, color: lineColor, width: 4.5 },
          geometry: {
            type: 'LineString',
            coordinates: [
              [previewResult.fromCoords[1], previewResult.fromCoords[0]],
              [previewResult.toCoords[1], previewResult.toCoords[0]],
            ],
          },
        });
      }
    }

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    previewGeoJsonRef.current = fc;
    syncSourceData('osm-preview', fc);
  }, [previewResult, previewAffordable, osmEdgeById]);

  // Update Built OSM Road/Rail Edges + Overview Zoom Simplified Curves GeoJSON (never triggered by capital ticks or hover)
  const unlockedRegionsKey = useMemo(
    () =>
      (gameState.provincialRegions || [])
        .filter((r) => r.unlocked)
        .map((r) => r.regionId)
        .sort()
        .join(','),
    [gameState.provincialRegions]
  );

  useEffect(() => {
    const builtEdges = getBuiltOsmEdgesForState(gameState);
    const builtLen = builtEdges.length;
    const builtSig = `${builtLen}:${gameState.stats.totalOsmEdgesBuilt}:${
      builtLen > 0 ? builtEdges[0].id : ''
    }:${builtLen > 0 ? builtEdges[builtLen - 1].id : ''}:${unlockedRegionsKey}:${
      builtSkeleton?.length || 0
    }:${(gameState.osmEdges || []).length === 0 ? 'empty' : 'graph'}`;

    if (builtSig === prevBuiltSigRef.current && builtLen > 0) {
      if (isOverviewZoomRef.current) {
        overviewDataVersionRef.current += 1;
      }
      return;
    }
    prevBuiltSigRef.current = builtSig;

    const features: Array<Record<string, unknown>> = [];

    for (const edge of builtEdges) {
      if (edge.coordinates.length < 2) continue;
      const nFrom = osmNodeIndex.byId.get(edge.fromNodeId);
      const nTo = osmNodeIndex.byId.get(edge.toNodeId);
      if (
        !nFrom ||
        !nTo ||
        !isNodeInUnlockedRegion(gameState, nFrom) ||
        !isNodeInUnlockedRegion(gameState, nTo)
      ) {
        continue;
      }
      features.push({
        type: 'Feature',
        properties: {
          id: edge.id,
          mode: edge.mode,
        },
        geometry: {
          type: 'LineString',
          coordinates: getEdgeLonLatCoords(edge),
        },
      });
    }

    // Immediate Built-First Skeleton render before full OSM graph hydrates from IndexedDB/Overpass
    if (features.length === 0 && (gameState.osmEdges || []).length === 0 && builtSkeleton && builtSkeleton.length > 0) {
      const skFeatures = buildSkeletonGeoJsonFeatures(builtSkeleton);
      const fcSk = { type: 'FeatureCollection', features: skFeatures } as unknown as GeoJsonData;
      builtEdgesGeoJsonRef.current = fcSk;
      overviewEdgesGeoJsonRef.current = fcSk;
      overviewDataVersionRef.current += 1;
      overviewSyncedVersionRef.current = overviewDataVersionRef.current;
      syncSourceData('osm-edges-built', fcSk);
      syncSourceData('osm-edges-overview', fcSk);
      return;
    }

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    builtEdgesGeoJsonRef.current = fc;
    syncSourceData('osm-edges-built', fc);
    overviewDataVersionRef.current += 1;
  }, [
    edgeTopologyKey,
    unlockedRegionsKey,
    osmNodeIndex,
    builtSkeleton,
    gameState.osmNodes,
    gameState.osmEdges,
    gameState.provincialRegions,
  ]);

  // Lazy Overview Zoom (< 11.5) curve builder: skipped completely during Street Zoom node connections
  useEffect(() => {
    if (!isOverviewZoom) return;
    if (overviewSyncedVersionRef.current === overviewDataVersionRef.current) return;
    overviewSyncedVersionRef.current = overviewDataVersionRef.current;

    const osmEdges = gameState.osmEdges || [];
    if (osmEdges.length === 0 && builtSkeleton && builtSkeleton.length > 0) {
      return;
    }

    const unlockedEdges = osmEdges.filter((edge) => {
      if (edge.coordinates.length < 2) return false;
      if (edge.built) return true;
      const nFrom = osmNodeIndex.byId.get(edge.fromNodeId);
      const nTo = osmNodeIndex.byId.get(edge.toNodeId);
      return Boolean(
        nFrom &&
          nTo &&
          isNodeInUnlockedRegion(gameState, nFrom) &&
          isNodeInUnlockedRegion(gameState, nTo)
      );
    });

    const curves = buildSimplifiedOverviewCurves(unlockedEdges, {
      epsilonDeg: 0.00042,
      maxUnbuiltCurves: 650,
    });
    const overviewFeatures = curves.map((curve) => ({
      type: 'Feature',
      properties: {
        id: curve.id,
        mode: curve.mode,
        built: curve.built,
        tier: curve.tier,
      },
      geometry: {
        type: 'LineString',
        coordinates: curve.coordinates,
      },
    }));

    const fcOverview = {
      type: 'FeatureCollection',
      features: overviewFeatures,
    } as unknown as GeoJsonData;
    overviewEdgesGeoJsonRef.current = fcOverview;
    syncSourceData('osm-edges-overview', fcOverview);
  }, [
    isOverviewZoom,
    edgeTopologyKey,
    unlockedRegionsKey,
    osmNodeIndex,
    builtSkeleton,
    gameState.osmNodes,
    gameState.osmEdges,
    gameState.provincialRegions,
  ]);

  // Pre-slice visible unbuilt frontier edges so capital ticks never touch all 15,000 edges
  const frontierEdgePack = useMemo(() => {
    const mults = calculateMultipliers(gameState);
    const hasAnyConnected = osmNodeIndex.hasAnyConnected;
    const rawEdges =
      hasAnyConnected && pendingSeedSet.size === 0
        ? getFrontierOsmEdgesForState(gameState, frontierDistances)
        : (gameState.osmEdges || []).filter((edge) => {
            if (edge.built || edge.coordinates.length < 2) return false;
            const nFrom = osmNodeIndex.byId.get(edge.fromNodeId);
            const nTo = osmNodeIndex.byId.get(edge.toNodeId);
            if (
              !nFrom ||
              !nTo ||
              !isNodeInUnlockedRegion(gameState, nFrom) ||
              !isNodeInUnlockedRegion(gameState, nTo)
            ) {
              return false;
            }
            const inPendingRegion =
              (nFrom.regionId && pendingSeedSet.has(nFrom.regionId)) ||
              (nTo.regionId && pendingSeedSet.has(nTo.regionId));
            if (hasAnyConnected && !inPendingRegion) {
              return (
                frontierDistances.has(edge.fromNodeId) && frontierDistances.has(edge.toNodeId)
              );
            }
            return true;
          });

    const entries = rawEdges.map((edge) => {
      const nFrom = osmNodeIndex.byId.get(edge.fromNodeId);
      const nTo = osmNodeIndex.byId.get(edge.toNodeId);
      const inPendingRegion = Boolean(
        (nFrom?.regionId && pendingSeedSet.has(nFrom.regionId)) ||
          (nTo?.regionId && pendingSeedSet.has(nTo.regionId))
      );
      const dFrom = frontierDistances.get(edge.fromNodeId);
      const dTo = frontierDistances.get(edge.toNodeId);
      const maxDist =
        dFrom !== undefined && dTo !== undefined
          ? Math.max(dFrom, dTo, 1)
          : MAX_OSM_FRONTIER_DISTANCE;
      const cost = getOsmEdgeBuildCost(edge, mults);
      return { edge, inPendingRegion, maxDist, cost };
    });

    const sortedCosts = entries.map((e) => e.cost).sort((a, b) => a - b);
    return { entries, sortedCosts };
  }, [
    osmNodeIndex,
    frontierDistances,
    pendingSeedSet,
    edgeTopologyKey,
    gameState.osmNodes,
    gameState.osmEdges,
    gameState.skills,
    gameState.provincialRegions,
  ]);

  const frontierAffordableCount = countAffordableAtOrBelow(
    frontierEdgePack.sortedCosts,
    gameState.capital
  );
  const frontierAffordSig = `${frontierEdgePack.entries.length}:${frontierAffordableCount}`;

  // Update Unbuilt Frontier Edges GeoJSON (viewport-culled in Street Zoom; skipped while Overview Zoom curves handle display)
  useEffect(() => {
    if (isOverviewZoom) return;
    const hasAnyConnected = osmNodeIndex.hasAnyConnected;
    const features: Array<Record<string, unknown>> = [];
    const curCapital = gameStateRef.current.capital;

    for (const entry of frontierEdgePack.entries) {
      const { edge, inPendingRegion, maxDist, cost } = entry;
      if (edge.coordinates.length < 2) continue;
      if (viewportBounds && !isEdgeInViewport(edge, viewportBounds)) continue;
      const canAfford = curCapital >= cost;
      const edgeOpacity =
        hasAnyConnected && !inPendingRegion
          ? getFrontierEdgeOpacity(maxDist, canAfford)
          : inPendingRegion
          ? 0.55
          : 0.92;
      features.push({
        type: 'Feature',
        properties: {
          id: edge.id,
          mode: edge.mode,
          canAfford,
          edgeOpacity,
        },
        geometry: {
          type: 'LineString',
          coordinates: getEdgeLonLatCoords(edge),
        },
      });
    }

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    frontierEdgesGeoJsonRef.current = fc;
    syncSourceData('osm-edges-frontier', fc);
  }, [frontierEdgePack, frontierAffordSig, osmNodeIndex.hasAnyConnected, viewportBounds, isOverviewZoom]);

  // Update Atomic OpenStreetMap Nodes GeoJSON (viewport-culled when zoomed into Street Zoom >= 11.5)
  useEffect(() => {
    if (isOverviewZoom) return;
    const hasAnyConnected = osmNodeIndex.hasAnyConnected;
    const hasStartingPending = pendingRegionList.some((r) => r.isStartingRegion);

    const isPendingSeedNode = (n: {
      id?: string;
      regionId?: string;
      lat: number;
      lng: number;
      connected: boolean;
    }) => {
      if (n.connected) return false;
      if (n.id && unseededIslandNodeIds.has(n.id)) return true;
      if (pendingSeedSet.size > 0) {
        if (n.regionId && pendingSeedSet.has(n.regionId)) return true;
        if (!n.regionId && !hasAnyConnected && hasStartingPending) {
          return true;
        }
        if (
          pendingRegionList.some(
            (r) =>
              n.lat >= r.bbox[0] &&
              n.lat <= r.bbox[2] &&
              n.lng >= r.bbox[1] &&
              n.lng <= r.bbox[3]
          )
        ) {
          return true;
        }
      }
      return false;
    };

    const touchBoost = isTouchRef.current ? 1.2 : 0;
    const features: Array<Record<string, unknown>> = [];

    const pendingSeedCountLocal = pendingSeedSet.size;
    const unseededCountLocal = unseededIslandNodeIds.size;

    const processNode = (node: (typeof gameState.osmNodes)[number]) => {
      const isSelected = node.id === selectedOsmNodeId;
      const isReachable =
        !selectedOsmNodeId ||
        isSelected ||
        Boolean(reachableOsmNodeSet && reachableOsmNodeSet.has(node.id));
      if (
        viewportBounds &&
        !isSelected &&
        !(selectedOsmNodeId && isReachable) &&
        !isNodeInViewport(node.lat, node.lng, viewportBounds)
      ) {
        return;
      }

      if (!isNodeInUnlockedRegion(gameState, node)) return;

      let isPendingSeed = false;
      if (!node.connected) {
        if (unseededCountLocal > 0 && unseededIslandNodeIds.has(node.id)) {
          isPendingSeed = true;
        } else if (pendingSeedCountLocal > 0) {
          isPendingSeed = isPendingSeedNode(node);
        }
      }

      const fDist = frontierDistances.get(node.id);
      if (!node.connected && hasAnyConnected && fDist === undefined && !isPendingSeed) {
        return;
      }

      const mode = getOsmNodeMode(gameState, node.id);
      const isRail = mode === 'rail';
      const { hasBuiltEdge, hasUnbuiltEdge, hasUnexploredNeighbor } = getOsmNodeConnectionFlags(
        gameState,
        node.id,
        frontierDistances,
        hasAnyConnected
      );

      const isTerminalWithUnexplored = node.connected && hasBuiltEdge && hasUnexploredNeighbor;
      const hideDot = node.connected && hasBuiltEdge && !isSelected && !isTerminalWithUnexplored;
      if (hideDot && !hasUnbuiltEdge) {
        return;
      }

      const canTarget =
        !selectedOsmNodeId ||
        isSelected ||
        (isReachable && resolveCompatibleOsmMode(gameState, selectedOsmNodeId, node.id) !== null);
      const dimForSelection =
        !isPendingSeed && Boolean(selectedOsmNodeId) && !isSelected && !canTarget;

      const resolvedDist = node.connected ? 0 : isPendingSeed ? 1 : fDist ?? MAX_OSM_FRONTIER_DISTANCE;
      const visual = getFrontierVisualStyle(resolvedDist, mode, {
        isSelected,
        isHovered: false,
        dimForSelection,
        hideDot,
      });

      const isStartHub = node.connected && !hasBuiltEdge && !isSelected;
      const baseRadius = isSelected
        ? 6.5
        : isPendingSeed
        ? 5.3
        : isStartHub
        ? 5.4
        : isTerminalWithUnexplored
        ? isRail
          ? 3.8
          : 4.2
        : hideDot
        ? 5.2
        : (isRail ? 3.2 : 3.8) * visual.radiusScale;

      const haloRadius =
        (isSelected
          ? 9
          : isPendingSeed
          ? 8.0
          : isStartHub
          ? 8.2
          : isTerminalWithUnexplored
          ? 6.4
          : 5.6 * visual.radiusScale) + touchBoost;
      const haloWidth = isSelected || isStartHub || isPendingSeed ? 2.2 : isTerminalWithUnexplored ? 1.8 : 1.5;
      const strokeWidth = hideDot
        ? 0
        : isSelected || isStartHub || isPendingSeed
        ? 2.2
        : isTerminalWithUnexplored
        ? 1.8
        : 1.5;

      const pendingFill =
        mode === 'rail' ? '#0284c7' : mode === 'mixed' ? '#9333ea' : '#f59e0b';
      const pendingStroke =
        mode === 'rail' ? '#67e8f9' : mode === 'mixed' ? '#e9d5ff' : '#fef08a';

      features.push({
        type: 'Feature',
        properties: {
          id: node.id,
          mode,
          isPendingSeed,
          hideDot,
          haloRadius,
          haloColor: isPendingSeed ? '#34d399' : isStartHub ? '#34d399' : visual.haloColor,
          haloWidth,
          haloOpacity: isPendingSeed ? 0.92 : isStartHub ? 0.95 : visual.haloOpacity,
          radius: Math.round((baseRadius + touchBoost) * 100) / 100,
          strokeColor: isPendingSeed ? pendingStroke : isStartHub ? '#34d399' : visual.strokeColor,
          strokeWidth,
          strokeOpacity: isPendingSeed ? 0.96 : visual.strokeOpacity,
          fillColor: isPendingSeed ? pendingFill : isStartHub ? '#059669' : visual.fillColor,
          fillOpacity: isPendingSeed ? 0.95 : visual.fillOpacity,
        },
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat],
        },
      });
    };

    if (hasAnyConnected && pendingSeedSet.size === 0) {
      const seenNodeIds = new Set<string>();
      for (const nodeId of frontierDistances.keys()) {
        const node = osmNodeIndex.byId.get(nodeId);
        if (node) {
          seenNodeIds.add(nodeId);
          processNode(node);
        }
      }
      for (const nodeId of unseededIslandNodeIds) {
        if (seenNodeIds.has(nodeId)) continue;
        const node = osmNodeIndex.byId.get(nodeId);
        if (node) {
          processNode(node);
        }
      }
    } else {
      for (const node of gameState.osmNodes || []) {
        processNode(node);
      }
    }

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    nodesGeoJsonRef.current = fc;
    syncSourceData('osm-nodes', fc);
  }, [
    osmNodeIndex,
    connectedOsmNodeKey,
    edgeTopologyKey,
    frontierDistances,
    unseededIslandNodeIds,
    reachableOsmNodeSet,
    selectedOsmNodeId,
    pendingSeedSet,
    pendingRegionList,
    gameState.provincialRegions,
    viewportBounds,
    isOverviewZoom,
  ]);

  // Update lightweight 0-or-1 feature hover highlight without touching the main osm-nodes source
  useEffect(() => {
    const node = hoverOsmNodeId ? osmNodeIndex.byId.get(hoverOsmNodeId) : undefined;
    if (!node) {
      hoverNodeGeoJsonRef.current = EMPTY_FC;
      syncSourceData('osm-hover-node', EMPTY_FC);
      return;
    }

    const hasAnyConnected = osmNodeIndex.hasAnyConnected;
    const isPendingSeed =
      !node.connected &&
      (unseededIslandNodeIds.has(node.id) ||
        (pendingSeedSet.size > 0 &&
          (Boolean(node.regionId && pendingSeedSet.has(node.regionId)) ||
            (!node.regionId && !hasAnyConnected && pendingRegionList.some((r) => r.isStartingRegion)) ||
            pendingRegionList.some(
              (r) =>
                node.lat >= r.bbox[0] &&
                node.lat <= r.bbox[2] &&
                node.lng >= r.bbox[1] &&
                node.lng <= r.bbox[3]
            ))));

    const mode = getOsmNodeMode(gameState, node.id);
    const isSelected = node.id === selectedOsmNodeId;
    const fDist = frontierDistances.get(node.id);
    const resolvedDist = node.connected ? 0 : isPendingSeed ? 1 : fDist ?? MAX_OSM_FRONTIER_DISTANCE;
    const visual = getFrontierVisualStyle(resolvedDist, mode, {
      isSelected,
      isHovered: true,
      dimForSelection: false,
      hideDot: false,
    });
    const touchBoost = isTouchRef.current ? 1.2 : 0;
    const baseRadius = isSelected ? 6.5 : 5.5;
    const haloRadius = (isSelected ? 9 : 8) + touchBoost;

    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: node.id,
            mode,
            haloRadius,
            haloColor: isPendingSeed ? '#34d399' : visual.haloColor,
            haloWidth: 2.2,
            haloOpacity: 0.96,
            radius: Number((baseRadius + touchBoost).toFixed(2)),
            strokeColor: isPendingSeed ? '#fef08a' : visual.strokeColor,
            strokeWidth: 2.2,
            strokeOpacity: 0.98,
            fillColor: visual.fillColor,
            fillOpacity: 0.98,
          },
          geometry: {
            type: 'Point',
            coordinates: [node.lng, node.lat],
          },
        },
      ],
    } as unknown as GeoJsonData;
    hoverNodeGeoJsonRef.current = fc;
    syncSourceData('osm-hover-node', fc);
  }, [
    hoverOsmNodeId,
    selectedOsmNodeId,
    osmNodeIndex,
    frontierDistances,
    unseededIslandNodeIds,
    pendingSeedSet,
    pendingRegionList,
    gameState.osmNodes,
    gameState.osmEdges,
  ]);

  // Visualize Unlocked Region Borders + Expandable Neighboring Regions (Polygons & Interactive Map Labels)
  const expandableEntries = useMemo(() => {
    const expandable = getExpandableProvincialRegions(gameState);
    return expandable
      .map((r) => ({ region: r, cost: getRegionUnlockCost(gameState, r) }))
      .sort((a, b) => {
        if (a.region.isIsolated !== b.region.isIsolated) {
          return a.region.isIsolated ? 1 : -1;
        }
        return a.cost - b.cost;
      });
  }, [gameState.provincialRegions, gameState.startingCity.lat, gameState.startingCity.lng]);

  const expandableSortedCosts = useMemo(
    () => expandableEntries.map((e) => e.cost).sort((a, b) => a - b),
    [expandableEntries]
  );
  const expandableRegionsKey = useMemo(
    () => expandableEntries.map((e) => `${e.region.regionId}:${e.cost}`).join('|'),
    [expandableEntries]
  );
  const expandableAffordCount = countAffordableAtOrBelow(expandableSortedCosts, gameState.capital);
  const expandableSig = `${expandableRegionsKey}|${expandableAffordCount}|${selectedExpandableRegionId || ''}`;

  useEffect(() => {
    const regions = gameState.provincialRegions || [];
    const unlockedRegions = regions.filter((r) => r.unlocked);

    const features: Array<Record<string, unknown>> = [];

    for (const region of unlockedRegions) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'unlocked',
          regionId: region.regionId,
          regionName: region.regionName,
        },
        geometry: buildRegionPolygonGeometry(region),
      });
    }

    for (const entry of expandableEntries) {
      const { region, cost } = entry;
      const canAfford = gameState.capital >= cost;
      features.push({
        type: 'Feature',
        properties: {
          kind: 'expandable',
          regionId: region.regionId,
          regionName: region.regionName,
          cost,
          canAfford,
          selected: selectedExpandableRegionId === region.regionId,
        },
        geometry: buildRegionPolygonGeometry(region),
      });
    }

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    regionsGeoJsonRef.current = fc;
    syncSourceData('regions-overlay', fc);

    const map = mapInstanceRef.current;
    if (!map) return;

    regionMarkersRef.current.forEach((m) => m.remove());
    regionMarkersRef.current = [];
    const placedAnchors: Array<[number, number]> = [];

    for (const entry of expandableEntries) {
      const { region, cost } = entry;
      const canAfford = gameState.capital >= cost;
      const isBusy = unlockingRegionId === region.regionId;
      const isSelected = selectedExpandableRegionId === region.regionId;

      const wrapper = document.createElement('div');
      wrapper.className = 'terraline-region-marker';
      wrapper.dataset.testid = `map-expandable-region-${region.regionId}`;
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '6px';
      wrapper.style.padding = '4px 8px';
      wrapper.style.borderRadius = '8px';
      wrapper.style.background = 'rgba(2, 6, 23, 0.92)';
      wrapper.style.border = isSelected
        ? '1.5px solid #38bdf8'
        : canAfford
        ? '1px solid rgba(56, 189, 248, 0.7)'
        : '1px solid rgba(245, 158, 11, 0.55)';
      wrapper.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.5)';
      wrapper.style.cursor = 'pointer';
      wrapper.style.userSelect = 'none';
      wrapper.style.touchAction = 'manipulation';
      wrapper.style.whiteSpace = 'nowrap';

      const textSpan = document.createElement('span');
      textSpan.style.fontSize = '11px';
      textSpan.style.fontWeight = '700';
      textSpan.style.fontVariantNumeric = 'tabular-nums';
      textSpan.style.color = canAfford ? '#e0f2fe' : '#fde68a';
      textSpan.textContent = `${region.regionName} · ${formatMoneyCompact(cost)}`;
      wrapper.appendChild(textSpan);

      if (callbacksRef.current.onUnlockRegion) {
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.disabled = !canAfford || Boolean(unlockingRegionId);
        unlockBtn.textContent = isBusy ? '로드 중' : '개척';
        unlockBtn.style.padding = '2px 7px';
        unlockBtn.style.borderRadius = '5px';
        unlockBtn.style.fontSize = '10px';
        unlockBtn.style.fontWeight = '700';
        unlockBtn.style.border = 'none';
        unlockBtn.style.touchAction = 'manipulation';
        unlockBtn.style.cursor = canAfford && !unlockingRegionId ? 'pointer' : 'not-allowed';
        unlockBtn.style.background = canAfford && !unlockingRegionId ? '#059669' : '#1e293b';
        unlockBtn.style.color = canAfford && !unlockingRegionId ? '#ffffff' : '#64748b';
        unlockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (canAfford && !unlockingRegionId) {
            callbacksRef.current.onUnlockRegion?.(region.regionId);
          }
        });
        wrapper.appendChild(unlockBtn);
      }

      wrapper.addEventListener('click', () => {
        setSelectedExpandableRegionId(region.regionId);
        map.flyTo({
          center: [region.centerLng, region.centerLat],
          zoom: toGlobeZoom(10.5),
          duration: 900,
        });
      });

      const anchor = getSafeRegionLabelAnchor(region, unlockedRegions, placedAnchors);
      placedAnchors.push(anchor);
      const marker = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat(anchor)
        .addTo(map);
      regionMarkersRef.current.push(marker);
    }
  }, [expandableSig, gameState.provincialRegions, unlockingRegionId]);

  const flyTo = (lat: number, lng: number, zoom: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (zoom <= 4) {
      map.setProjection({ type: 'globe' });
    }
    map.flyTo({
      center: [lng, lat],
      zoom: toGlobeZoom(zoom),
      pitch: zoom <= 4 ? 14 : 0,
      bearing: 0,
      duration: 1200,
    });
  };

  const selectedOsmNode = selectedOsmNodeId
    ? osmNodeIndex.byId.get(selectedOsmNodeId)
    : undefined;

  const cycleTileLayer = () => {
    const order: ('dark' | 'osm' | 'satellite')[] = ['dark', 'osm', 'satellite'];
    const next = order[(order.indexOf(tileType) + 1) % order.length];
    switchTileLayer(next);
  };

  const tileLabel = tileType === 'dark' ? '다크 지도' : tileType === 'osm' ? 'OSM 도로' : '위성 지도';

  const regions = gameState.provincialRegions || [];
  const pendingSeedIds = gameState.pendingSeedRegionIds || [];
  const pendingRegion =
    pendingSeedIds.length > 0
      ? regions.find((r) => r.regionId === pendingSeedIds[0])
      : undefined;

  const nextLockedEntry = useMemo(() => {
    if (expandableEntries.length === 0) return null;
    if (selectedExpandableRegionId) {
      const picked = expandableEntries.find(
        (e) => e.region.regionId === selectedExpandableRegionId
      );
      if (picked) return picked;
    }
    return expandableEntries[0];
  }, [expandableEntries, selectedExpandableRegionId]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#02040a]">
      <div ref={mapContainerRef} className="w-full h-full" data-testid="world-map" />

      {/* MOBILE UNIFIED TOP TOOLBAR (< md): Clean controls without obscuring the globe */}
      <div className="md:hidden fixed top-[58px] left-1.5 right-1.5 z-20 flex flex-col gap-1.5 pointer-events-none">
        <div className="flex items-center justify-between gap-1.5 pointer-events-auto">
          <button
            data-testid="mobile-region-toggle"
            onClick={() => setMobileRegionsOpen((o) => !o)}
            className="min-h-[40px] px-2.5 rounded-xl bg-slate-950/95 border border-slate-800 text-xs font-semibold text-slate-200 shadow-lg flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span>지역</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                mobileRegionsOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <button
            onClick={cycleTileLayer}
            aria-label="지도 스타일 전환"
            className="min-h-[40px] px-2.5 rounded-xl bg-slate-950/95 border border-slate-800 text-xs font-semibold text-slate-200 shadow-lg flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>{tileLabel}</span>
          </button>
        </div>

        {mobileRegionsOpen && (
          <div className="pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl overflow-x-auto no-scrollbar">
            <button
              onClick={() => {
                flyTo(
                  gameState.startingCity.lat,
                  gameState.startingCity.lng,
                  Math.max(gameState.startingCity.zoom || 12, 16)
                );
                setMobileRegionsOpen(false);
              }}
              className="min-h-[36px] px-3 py-1 text-xs rounded-lg font-semibold text-sky-300 bg-sky-500/15 whitespace-nowrap shrink-0 cursor-pointer"
            >
              내 도시 ({gameState.startingCity.name.split(' ')[0]})
            </button>
            <button
              onClick={() => {
                flyTo(gameState.startingCity.lat, gameState.startingCity.lng, 8.2);
                setMobileRegionsOpen(false);
              }}
              className="min-h-[36px] px-3 py-1 text-xs rounded-lg font-semibold text-emerald-300 bg-emerald-500/15 whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
            >
              <MapPin className="w-3.5 h-3.5" />
              개척 가능 지역
            </button>
            <button
              onClick={() => {
                flyTo(gameState.startingCity.lat, gameState.startingCity.lng, 2.5);
                setMobileRegionsOpen(false);
              }}
              className="min-h-[36px] px-3 py-1 text-xs rounded-lg font-semibold text-cyan-300 bg-cyan-500/15 whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              3D 지구본
            </button>
            {onOpenExpansionTab && (
              <button
                onClick={() => {
                  onOpenExpansionTab();
                  setMobileRegionsOpen(false);
                }}
                className="min-h-[36px] px-3 py-1 text-xs rounded-lg font-semibold text-indigo-300 bg-indigo-500/15 whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
              >
                <Lock className="w-3.5 h-3.5" />
                지역 해금 ({regions.filter((r) => r.unlocked).length}/{regions.length})
              </button>
            )}
          </div>
        )}

        {/* Compact Mobile Node Legend + Manual Viewport Rescan */}
        <div className="self-start pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950/85 border border-slate-800/90 text-[10px] text-slate-300 shadow">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 border border-amber-200 inline-block" />
            도로 노드
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-cyan-400 bg-sky-950 inline-block" />
            철도 노드
          </span>
          {!isOverviewZoom && onLoadOsmChunksBatch && (
            <button
              type="button"
              onClick={() => requestViewportChunksRef.current(true)}
              disabled={isLoadingOsm}
              title="현재 화면 도로·철도 노드 다시 수신"
              className="ml-0.5 px-1.5 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-50 text-sky-300 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${isLoadingOsm ? 'animate-spin' : ''}`} />
              도로 재수신
            </button>
          )}
        </div>
      </div>

      {/* DESKTOP Quick Region Jump Bar (md+) */}
      <div className="hidden md:flex fixed top-18 left-3 z-20 items-center gap-1 p-1 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl max-w-[calc(100vw-24rem)] overflow-x-auto no-scrollbar">
        <span className="text-[11px] font-medium text-slate-400 px-2 flex items-center gap-1 whitespace-nowrap">
          <Compass className="w-3.5 h-3.5 text-sky-400" />
          지역 이동
        </span>
        <button
          onClick={() =>
            flyTo(
              gameState.startingCity.lat,
              gameState.startingCity.lng,
              Math.max(gameState.startingCity.zoom || 12, 16)
            )
          }
          className="px-2.5 py-1 text-xs rounded-lg font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 transition-colors cursor-pointer whitespace-nowrap"
        >
          내 도시 ({gameState.startingCity.name})
        </button>
        <button
          onClick={() => flyTo(gameState.startingCity.lat, gameState.startingCity.lng, 8.2)}
          className="px-2.5 py-1 text-xs rounded-lg font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
        >
          <MapPin className="w-3.5 h-3.5" />
          개척 가능 지역
        </button>
        <button
          onClick={() => flyTo(gameState.startingCity.lat, gameState.startingCity.lng, 2.5)}
          className="px-2.5 py-1 text-xs rounded-lg font-semibold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
        >
          <Globe className="w-3.5 h-3.5" />
          3D 지구본
        </button>
      </div>

      {/* DESKTOP Right Top Map Controls: Tile Layer Switcher (md+) */}
      <div className="hidden md:flex fixed top-18 right-3 z-20 flex-col items-end gap-1.5">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/95 border border-slate-800 shadow-xl">
          <button
            onClick={() => switchTileLayer('dark')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
              tileType === 'dark' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            다크 지도
          </button>
          <button
            onClick={() => switchTileLayer('osm')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
              tileType === 'osm' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            OSM 도로
          </button>
          <button
            onClick={() => switchTileLayer('satellite')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
              tileType === 'satellite' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            위성
          </button>
        </div>

        {/* Compact Road vs Rail Node Legend + Manual Viewport Rescan */}
        <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] text-slate-300 shadow-lg">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-200 inline-block" />
            도로 노드
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full border-2 border-cyan-400 bg-sky-950 inline-block" />
            철도 노드
          </span>
          <span className="text-slate-400">· 시야 거리 d≤10</span>
          {!isOverviewZoom && onLoadOsmChunksBatch && (
            <button
              type="button"
              onClick={() => requestViewportChunksRef.current(true)}
              disabled={isLoadingOsm}
              title="이미 로드된 구역의 누락된 도로·철도 노드를 현재 화면 기준으로 다시 수신합니다"
              className="px-2 py-0.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-50 text-sky-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingOsm ? 'animate-spin' : ''}`} />
              화면 도로 재수신
            </button>
          )}
        </div>
      </div>

      {/* NIMBY Rails-Style Continuous OSM Node Path Builder Banner */}
      {selectedOsmNode && (
        <div
          data-testid="osm-builder-banner"
          className="fixed bottom-[74px] sm:bottom-20 left-2 right-2 sm:left-3 sm:right-auto sm:w-96 z-30 p-3.5 rounded-2xl bg-slate-950/95 border border-emerald-500/60 shadow-2xl space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <GitCommitHorizontal className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-white">
                  노드 연결 시공 모드 (NIMBY 방식)
                </h4>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                  시점:{' '}
                  <span className="text-emerald-300 font-semibold">
                    {selectedOsmNode.label || '선택된 교차점'}
                  </span>{' '}
                  · 목표 노드를 {isTouchRef.current ? '터치' : '클릭'}하면 실제 도로·철도를 따라 연결됩니다.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedOsmNodeId(null);
                setHoverOsmNodeId(null);
              }}
              aria-label="노드 선택 취소"
              className="min-h-[38px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 cursor-pointer shrink-0 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              종료
            </button>
          </div>

          {previewResult ? (
            <div className="px-2.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono-numbers">
              <span className="text-slate-300 truncate">
                {previewResult.kind === 'transfer'
                  ? '특수 환승 직결'
                  : previewResult.kind === 'cross_border'
                  ? '광역 경계 직결'
                  : previewResult.kind === 'isolated_route'
                  ? '인접 노선 연결'
                  : previewResult.kind === 'bridge'
                  ? '교차로 직결'
                  : '실측 노선 경로'}
                :{' '}
                <strong className="text-white">{previewResult.meters.toLocaleString()}m</strong> ·{' '}
                {previewResult.unbuiltCount}구간
              </span>
              <span
                className={`shrink-0 ${
                  gameState.capital >= previewResult.cost
                    ? 'text-emerald-400 font-bold'
                    : 'text-rose-400 font-bold'
                }`}
              >
                {formatMoneyCompact(previewResult.cost)}
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 px-1">
              {isTouchRef.current
                ? '도로·철도 위 다음 노드를 터치하면 최단 노선을 따라 연속 연결됩니다.'
                : '다른 노드에 마우스를 올리면 시공 길이·비용이 미리 표시됩니다. (Esc / 우클릭 종료)'}
            </div>
          )}
        </div>
      )}

      {/* Starting Region / Isolated Region Manual Start-Node Selection Banner */}
      {pendingRegion && !selectedOsmNode && (
        <div
          data-testid="isolated-seed-banner"
          className="fixed bottom-[74px] sm:bottom-20 left-2 right-2 sm:left-3 sm:right-auto sm:w-96 z-30 p-3.5 rounded-2xl bg-slate-950/95 border border-amber-500/70 shadow-2xl space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-white">
                  {pendingRegion.isStartingRegion
                    ? `시작 거점 노드 선택: ${pendingRegion.regionName}`
                    : `고립 지역 개척 시작: ${pendingRegion.regionName}`}
                </h4>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                  {pendingRegion.isStartingRegion
                    ? `지도에서 원하는 도로·철도 노드를 ${
                        isTouchRef.current ? '터치' : '클릭'
                      }해 첫 출발 거점으로 지정하세요.`
                    : `새 지역에서 첫 출발 노드를 ${
                        isTouchRef.current ? '터치' : '클릭'
                      }해 선택하면 게임을 진척시킬 수 있습니다.`}
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                pendingRegion.isStartingRegion
                  ? flyTo(
                      gameState.startingCity.lat,
                      gameState.startingCity.lng,
                      Math.max(gameState.startingCity.zoom || 12, 16)
                    )
                  : flyTo(pendingRegion.centerLat, pendingRegion.centerLng, 15)
              }
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              {pendingRegion.isStartingRegion ? '중심 이동' : '지역 이동'}
            </button>
          </div>
        </div>
      )}

      {/* DESKTOP Map Adjacent Locked Region Quick-Unlock Banner */}
      {nextLockedEntry && onUnlockRegion && !pendingRegion && (
        <div
          data-testid="adjacent-region-banner"
          className="hidden md:flex fixed bottom-20 right-3 z-20 w-80 p-3 rounded-2xl bg-slate-950/95 border border-slate-700/80 shadow-2xl flex-col gap-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400 font-medium">
                {nextLockedEntry.region.isIsolated
                  ? '고립 도·주 · 새 출발 노드 선택'
                  : '인접 도·주 · 경계 교차점 연결'}
              </div>
              <div className="text-xs font-bold text-white truncate mt-0.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">{nextLockedEntry.region.regionName}</span>
              </div>
            </div>
            {onOpenExpansionTab && (
              <button
                onClick={onOpenExpansionTab}
                className="text-[11px] text-indigo-300 hover:text-white font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                전체 보기
              </button>
            )}
          </div>

          <button
            disabled={gameState.capital < nextLockedEntry.cost || Boolean(unlockingRegionId)}
            onClick={() => onUnlockRegion(nextLockedEntry.region.regionId)}
            className={`w-full min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-bold font-mono-numbers tabular-nums flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
              gameState.capital >= nextLockedEntry.cost && !unlockingRegionId
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {unlockingRegionId === nextLockedEntry.region.regionId ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>지역 도로 로드 중...</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5" />
                <span>잠금 해제 ({formatMoneyCompact(nextLockedEntry.cost)})</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Non-blocking Background Streaming Progress Overlay (0% ~ 100%) */}
      {loadingProgress?.active && (
        <div
          data-testid="loading-progress-indicator"
          aria-live="polite"
          className="fixed top-[134px] left-1.5 md:top-[118px] md:left-3 z-30 pointer-events-none px-3 py-1.5 rounded-xl bg-slate-950/92 border border-sky-500/40 shadow-lg flex flex-col gap-1 min-w-[168px] max-w-[78vw]"
        >
          <div className="flex items-center justify-between gap-2.5 text-[11px] text-slate-200 tabular-nums">
            <span className="flex items-center gap-1.5 truncate">
              <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />
              <span className="truncate">{loadingProgress.label}</span>
            </span>
            <span className="font-mono font-bold text-sky-300 shrink-0">
              {loadingProgress.percent}%
            </span>
          </div>
          <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full w-full origin-left bg-sky-400 transition-transform duration-200 ease-out"
              style={{
                transform: `scaleX(${Math.max(0.02, Math.min(1, loadingProgress.percent / 100))})`,
              }}
            />
          </div>
        </div>
      )}

      {/* Fallback / Loading Banner when OSM nodes are not yet loaded */}
      {(gameState.osmNodes || []).length === 0 && !loadingProgress?.active && (
        <div
          data-testid="osm-empty-banner"
          className="fixed bottom-[82px] left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 rounded-2xl bg-slate-950/95 border border-sky-500/50 shadow-2xl flex items-center gap-3 max-w-[92vw]"
        >
          {isLoadingOsm ? (
            <>
              <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
              <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
                주변 도로·철도 노드를 불러오는 중...
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-slate-200">
                주변 노드를 아직 불러오지 못했습니다.
              </span>
              {onReloadOsm && (
                <button
                  onClick={onReloadOsm}
                  className="min-h-[34px] px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  노드 불러오기
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const WorldMap = React.memo(WorldMapComponent);

