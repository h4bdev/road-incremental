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
  X,
} from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateMultipliers,
  computeOsmFrontierDistancesForState,
  findOsmRoadPath,
  getFrontierEdgeOpacity,
  getFrontierVisualStyle,
  getOsmEdgeBuildCost,
  getReachableOsmNodeSet,
  resolveCompatibleOsmMode,
} from '../game/rules';
import { haversineKm } from '../game/osmService';

interface WorldMapProps {
  gameState: GameState;
  flyToTarget: { lat: number; lng: number; zoom: number; ts: number } | null;
  onConnectOsmPath: (fromId: string, toId: string) => void;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const WorldMap: React.FC<WorldMapProps> = ({
  gameState,
  flyToTarget,
  onConnectOsmPath,
  onBottomCardChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const edgesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const previewGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const nodesGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);
  const unitsGeoJsonRef = useRef<GeoJsonData>(EMPTY_FC);

  const [tileType, setTileType] = useState<'dark' | 'osm' | 'satellite'>('dark');
  const tileTypeRef = useRef<'dark' | 'osm' | 'satellite'>('dark');
  tileTypeRef.current = tileType;

  const [mobileRegionsOpen, setMobileRegionsOpen] = useState(false);
  const [selectedOsmNodeId, setSelectedOsmNodeId] = useState<string | null>(null);
  const [hoverOsmNodeId, setHoverOsmNodeId] = useState<string | null>(null);

  const selectedOsmNodeIdRef = useRef<string | null>(null);
  selectedOsmNodeIdRef.current = selectedOsmNodeId;

  const hoverOsmNodeIdRef = useRef<string | null>(null);
  hoverOsmNodeIdRef.current = hoverOsmNodeId;

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const isTouchRef = useRef(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  );

  const callbacksRef = useRef({
    onConnectOsmPath,
  });
  callbacksRef.current = {
    onConnectOsmPath,
  };

  useEffect(() => {
    onBottomCardChange?.(Boolean(selectedOsmNodeId));
  }, [selectedOsmNodeId, onBottomCardChange]);

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

  const syncSourceData = (sourceId: string, data: GeoJsonData) => {
    const map = mapInstanceRef.current;
    if (!map || !styleReadyRef.current) return;
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
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
      maplibreLogo: false,
      attributionControl: { compact: true },
      canvasContextAttributes: {
        antialias: true,
        contextType: 'webgl2',
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
          'osm-edges': {
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
          'osm-units': {
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
            id: 'osm-edges-unbuilt-road',
            type: 'line',
            source: 'osm-edges',
            filter: ['all', ['==', ['get', 'built'], false], ['==', ['get', 'mode'], 'road']],
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
            source: 'osm-edges',
            filter: ['all', ['==', ['get', 'built'], false], ['==', ['get', 'mode'], 'rail']],
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
            source: 'osm-edges',
            filter: ['==', ['get', 'built'], true],
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
            source: 'osm-edges',
            filter: ['==', ['get', 'built'], true],
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
            id: 'osm-units-circle',
            type: 'circle',
            source: 'osm-units',
            paint: {
              'circle-radius': ['get', 'radius'],
              'circle-color': ['get', 'color'],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
              'circle-pitch-alignment': 'viewport',
            },
          },
        ],
      },
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      'bottom-right'
    );
    map.addControl(new maplibregl.GlobeControl(), 'bottom-right');

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'terraline-popup',
    });
    popupRef.current = popup;

    const queryNearestOsmNode = (point: maplibregl.Point) => {
      if (!styleReadyRef.current || !map.getLayer('osm-nodes-circle')) return null;
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

    const buildNodeTooltipHtml = (props: Record<string, unknown>) => {
      const mode = String(props.mode || 'road');
      const label = escapeHtml(String(props.label || 'OSM 노드'));
      const connected = Boolean(props.connected);
      const frontierDist = Number(props.frontierDist || 0);
      const isSelected = Boolean(props.isSelected);
      const isCompatible = Boolean(props.isCompatible);
      const isReachable = Boolean(props.isReachable);
      const activeAnchor = selectedOsmNodeIdRef.current;

      const modeBadge =
        mode === 'mixed'
          ? '<span style="color:#c084fc;font-weight:700;">[도로·철도 환승]</span>'
          : mode === 'rail'
          ? '<span style="color:#22d3ee;font-weight:700;">[철도 노드]</span>'
          : '<span style="color:#fbbf24;font-weight:700;">[도로 노드]</span>';

      const distTag =
        !connected && frontierDist > 0
          ? ` <span style="color:#94a3b8;">(개척 거리 d=${frontierDist})</span>`
          : '';

      const hint = isSelected
        ? '시점 노드 선택됨 · 목표 노드를 클릭해 연속 연결'
        : activeAnchor && !isCompatible
        ? '<span style="color:#fb7185;font-weight:700;">도로 ↔ 철도 연결 불가</span> (같은 유형 노드를 선택하세요)'
        : activeAnchor && !isReachable
        ? '<span style="color:#fb7185;font-weight:700;">별개 레인·거리 초과</span> (직접 교차 연결 불가)'
        : activeAnchor
        ? '클릭 시 실제 노선을 따라 여기까지 한 번에 연결'
        : connected
        ? '연결 완료 지점 · 클릭하여 미연결 지선 이어가기'
        : '클릭하여 연속 연결 시작';

      return `<div style="font-size:11px;line-height:1.4;">${modeBadge} <strong>${label}</strong>${distTag}<br/>${hint}</div>`;
    };

    const syncGlobeOverviewAttr = () => {
      if (mapContainerRef.current) {
        mapContainerRef.current.dataset.globeOverview = map.getZoom() < 8.5 ? 'true' : 'false';
      }
    };

    map.on('style.load', () => {
      styleReadyRef.current = true;
      map.setProjection({ type: 'globe' });
      applyTileVisibility(map, tileTypeRef.current);
      syncGlobeOverviewAttr();

      const edgesSrc = map.getSource('osm-edges') as maplibregl.GeoJSONSource | undefined;
      edgesSrc?.setData(edgesGeoJsonRef.current);

      const previewSrc = map.getSource('osm-preview') as maplibregl.GeoJSONSource | undefined;
      previewSrc?.setData(previewGeoJsonRef.current);

      const nodesSrc = map.getSource('osm-nodes') as maplibregl.GeoJSONSource | undefined;
      nodesSrc?.setData(nodesGeoJsonRef.current);

      const unitsSrc = map.getSource('osm-units') as maplibregl.GeoJSONSource | undefined;
      unitsSrc?.setData(unitsGeoJsonRef.current);
    });

    map.on('zoom', syncGlobeOverviewAttr);

    map.on('mousemove', (ev) => {
      const hit = queryNearestOsmNode(ev.point);
      if (!hit || hit.geometry.type !== 'Point') {
        map.getCanvas().style.cursor = '';
        if (hoverOsmNodeIdRef.current !== null) {
          setHoverOsmNodeId(null);
        }
        popup.remove();
        return;
      }

      const props = (hit.properties || {}) as Record<string, unknown>;
      const nodeId = String(props.id || '');
      if (!nodeId) return;

      map.getCanvas().style.cursor = 'pointer';
      if (hoverOsmNodeIdRef.current !== nodeId) {
        setHoverOsmNodeId(nodeId);
      }
      const coords = hit.geometry.coordinates as [number, number];
      popup.setLngLat(coords).setHTML(buildNodeTooltipHtml(props)).addTo(map);
    });

    map.on('mouseout', () => {
      map.getCanvas().style.cursor = '';
      if (hoverOsmNodeIdRef.current !== null) {
        setHoverOsmNodeId(null);
      }
      popup.remove();
    });

    map.on('click', (ev) => {
      const hit = queryNearestOsmNode(ev.point);
      if (!hit || !hit.properties) return;
      const nodeId = String((hit.properties as Record<string, unknown>).id || '');
      if (!nodeId) return;

      const currentStart = selectedOsmNodeIdRef.current;
      if (!currentStart) {
        setSelectedOsmNodeId(nodeId);
      } else if (currentStart === nodeId) {
        setSelectedOsmNodeId(null);
        setHoverOsmNodeId(null);
        popup.remove();
      } else {
        const canLink =
          resolveCompatibleOsmMode(gameStateRef.current, currentStart, nodeId) !== null &&
          Boolean(reachableOsmNodeSetRef.current?.has(nodeId));
        callbacksRef.current.onConnectOsmPath(currentStart, nodeId);
        if (canLink) {
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
        popup.remove();
      }
    });

    mapInstanceRef.current = map;

    return () => {
      styleReadyRef.current = false;
      popup.remove();
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
        popupRef.current?.remove();
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

  const multsForKey = calculateMultipliers(gameState);

  const affordableOsmKey = (gameState.osmEdges || [])
    .map(
      (e) =>
        `${e.id}:${
          e.built
            ? 'b'
            : gameState.capital >= getOsmEdgeBuildCost(e, multsForKey)
            ? '1'
            : '0'
        }`
    )
    .join('|');

  const connectedOsmNodeKey = (gameState.osmNodes || [])
    .map((n) => `${n.id}:${n.connected ? '1' : '0'}`)
    .join('|');

  const unbuiltEdgeSignature = (gameState.osmEdges || [])
    .filter((e) => !e.built)
    .map((e) => e.id)
    .join('|');

  const frontierDistances = useMemo(
    () => computeOsmFrontierDistancesForState(gameState),
    [connectedOsmNodeKey, unbuiltEdgeSignature, gameState.skills]
  );

  const reachableOsmNodeSet = useMemo(() => {
    if (!selectedOsmNodeId) return null;
    return getReachableOsmNodeSet(gameState, selectedOsmNodeId);
  }, [selectedOsmNodeId, gameState.osmEdges, gameState.osmNodes, gameState.skills]);

  const reachableOsmNodeSetRef = useRef<Set<string> | null>(null);
  reachableOsmNodeSetRef.current = reachableOsmNodeSet;

  // Compute live NIMBY Rails path preview when anchor node A is selected and node B is hovered
  const previewResult = useMemo(() => {
    if (!selectedOsmNodeId || !hoverOsmNodeId || selectedOsmNodeId === hoverOsmNodeId) {
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

    // Never preview a fake bridge across two separate 2-lane road/rail ways
    if (compat !== 'transfer') {
      const edges = gameState.osmEdges || [];
      const fromHasEdges = edges.some(
        (e) => e.fromNodeId === selectedOsmNodeId || e.toNodeId === selectedOsmNodeId
      );
      const toHasEdges = edges.some(
        (e) => e.fromNodeId === hoverOsmNodeId || e.toNodeId === hoverOsmNodeId
      );
      if (fromHasEdges && toHasEdges) {
        return null;
      }
    }

    const nA = (gameState.osmNodes || []).find((n) => n.id === selectedOsmNodeId);
    const nB = (gameState.osmNodes || []).find((n) => n.id === hoverOsmNodeId);
    if (!nA || !nB) return null;
    const distKm = haversineKm(nA.lat, nA.lng, nB.lat, nB.lng);
    const maxDist = compat === 'transfer' ? 0.035 : 0.15;
    if (distKm <= maxDist) {
      const m = calculateMultipliers(gameState);
      const rawCost = Math.max(20, Math.round(35 * (1 + distKm * 6) * m.buildCostMult));
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
  }, [selectedOsmNodeId, hoverOsmNodeId, gameState]);

  // Update Live Hover Preview Path GeoJSON
  useEffect(() => {
    const features: Array<{
      type: 'Feature';
      properties: { dashed: boolean; color: string; width: number };
      geometry: { type: 'LineString'; coordinates: number[][] };
    }> = [];

    if (previewResult) {
      const affordable = gameState.capital >= previewResult.cost;
      if (previewResult.kind === 'path') {
        const previewColor = affordable ? '#10b981' : '#f43f5e';
        const edgeMap = new Map((gameState.osmEdges || []).map((e) => [e.id, e]));
        previewResult.edgeIds.forEach((eid) => {
          const edge = edgeMap.get(eid);
          if (!edge || edge.coordinates.length < 2) return;
          features.push({
            type: 'Feature',
            properties: { dashed: false, color: previewColor, width: 6.5 },
            geometry: {
              type: 'LineString',
              coordinates: edge.coordinates.map(([lat, lng]) => [lng, lat]),
            },
          });
        });
      } else {
        const lineColor = !affordable
          ? '#f43f5e'
          : previewResult.kind === 'transfer'
          ? '#c084fc'
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
  }, [previewResult, gameState.capital, gameState.osmEdges]);

  // Update Atomic OpenStreetMap Street/Rail Edges GeoJSON (fog-of-war: hide unbuilt edges beyond d=5)
  useEffect(() => {
    const mults = calculateMultipliers(gameState);
    const hasAnyConnected = (gameState.osmNodes || []).some((n) => n.connected);
    const features: Array<Record<string, unknown>> = [];

    (gameState.osmEdges || []).forEach((edge) => {
      if (edge.coordinates.length < 2) return;
      if (!edge.built && hasAnyConnected) {
        const dFrom = frontierDistances.get(edge.fromNodeId);
        const dTo = frontierDistances.get(edge.toNodeId);
        if (dFrom === undefined || dTo === undefined) {
          return;
        }
        const cost = getOsmEdgeBuildCost(edge, mults);
        const canAfford = gameState.capital >= cost;
        const maxDist = Math.max(dFrom, dTo, 1);
        features.push({
          type: 'Feature',
          properties: {
            id: edge.id,
            built: false,
            mode: edge.mode,
            canAfford,
            edgeOpacity: getFrontierEdgeOpacity(maxDist, canAfford),
          },
          geometry: {
            type: 'LineString',
            coordinates: edge.coordinates.map(([lat, lng]) => [lng, lat]),
          },
        });
        return;
      }

      const cost = getOsmEdgeBuildCost(edge, mults);
      features.push({
        type: 'Feature',
        properties: {
          id: edge.id,
          built: edge.built,
          mode: edge.mode,
          canAfford: gameState.capital >= cost,
          edgeOpacity: 0.92,
        },
        geometry: {
          type: 'LineString',
          coordinates: edge.coordinates.map(([lat, lng]) => [lng, lat]),
        },
      });
    });

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    edgesGeoJsonRef.current = fc;
    syncSourceData('osm-edges', fc);
  }, [
    affordableOsmKey,
    connectedOsmNodeKey,
    frontierDistances,
    gameState.skills,
    gameState.upgrades,
    gameState.achievements,
  ]);

  // Update Atomic OpenStreetMap Nodes GeoJSON (only render frontier 1 <= d <= 5 with decreasing brightness)
  useEffect(() => {
    const derivedModeMap = new Map<string, 'road' | 'rail' | 'mixed'>();
    const nodesWithFrontierUnbuiltEdge = new Set<string>();
    const hasAnyConnected = (gameState.osmNodes || []).some((n) => n.connected);

    (gameState.osmEdges || []).forEach((e) => {
      for (const nid of [e.fromNodeId, e.toNodeId]) {
        const prev = derivedModeMap.get(nid);
        if (!prev) derivedModeMap.set(nid, e.mode);
        else if (prev !== e.mode) derivedModeMap.set(nid, 'mixed');
        if (
          !e.built &&
          (!hasAnyConnected ||
            (frontierDistances.has(e.fromNodeId) && frontierDistances.has(e.toNodeId)))
        ) {
          nodesWithFrontierUnbuiltEdge.add(nid);
        }
      }
    });

    const touchBoost = isTouchRef.current ? 1.2 : 0;
    const features: Array<Record<string, unknown>> = [];

    (gameState.osmNodes || []).forEach((node) => {
      const fDist = frontierDistances.get(node.id);
      // Hide unexplored nodes beyond d=5 (or unreachable) so they cannot be seen or explored
      if (!node.connected && hasAnyConnected && fDist === undefined) {
        return;
      }

      const mode = node.mode || derivedModeMap.get(node.id) || 'road';
      const isRail = mode === 'rail';
      const isSelected = node.id === selectedOsmNodeId;
      const isHovered = node.id === hoverOsmNodeId;
      const hasUnbuiltEdge = nodesWithFrontierUnbuiltEdge.has(node.id);

      // Explored (connected) nodes hide their dot marker so roads & rails look smooth and seamless.
      // Connected nodes at branch ends retain an invisible clickable hit-target.
      const hideDot = node.connected && !isSelected && !isHovered;
      if (hideDot && !hasUnbuiltEdge) {
        return;
      }

      const isCompatible =
        !selectedOsmNodeId ||
        selectedOsmNodeId === node.id ||
        resolveCompatibleOsmMode(gameState, selectedOsmNodeId, node.id) !== null;
      const isReachable =
        !selectedOsmNodeId ||
        selectedOsmNodeId === node.id ||
        Boolean(reachableOsmNodeSet?.has(node.id));
      const canTarget = isCompatible && isReachable;
      const dimForSelection = Boolean(selectedOsmNodeId) && !isSelected && !canTarget;

      const resolvedDist = node.connected ? 0 : fDist ?? 1;
      const visual = getFrontierVisualStyle(resolvedDist, mode, {
        isSelected,
        isHovered,
        dimForSelection,
        hideDot,
      });

      const baseRadius = isSelected
        ? 6.5
        : isHovered
        ? 5.5
        : hideDot
        ? 5.2
        : (isRail ? 3.2 : 3.8) * visual.radiusScale;

      const haloRadius = (isSelected ? 9 : isHovered ? 8 : 5.6 * visual.radiusScale) + touchBoost;
      const haloWidth = isSelected || isHovered ? 2.2 : 1.5;
      const strokeWidth = hideDot ? 0 : isSelected || isHovered ? 2.2 : 1.5;

      features.push({
        type: 'Feature',
        properties: {
          id: node.id,
          label: node.label || 'OSM 노드',
          mode,
          connected: node.connected,
          frontierDist: resolvedDist,
          brightness: visual.brightness,
          hideDot,
          isSelected,
          isHovered,
          isCompatible,
          isReachable,
          haloRadius,
          haloColor: visual.haloColor,
          haloWidth,
          haloOpacity: visual.haloOpacity,
          radius: Number((baseRadius + touchBoost).toFixed(2)),
          strokeColor: visual.strokeColor,
          strokeWidth,
          strokeOpacity: visual.strokeOpacity,
          fillColor: visual.fillColor,
          fillOpacity: visual.fillOpacity,
        },
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat],
        },
      });
    });

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    nodesGeoJsonRef.current = fc;
    syncSourceData('osm-nodes', fc);
  }, [connectedOsmNodeKey, unbuiltEdgeSignature, frontierDistances, selectedOsmNodeId, hoverOsmNodeId]);

  // Update Moving Vehicles / Trains GeoJSON along Built Segments & OSM Edges
  useEffect(() => {
    const segMap = new Map(gameState.segments.map((s) => [s.id, s]));
    const osmEdgeMap = new Map((gameState.osmEdges || []).map((e) => [e.id, e]));
    const features: Array<Record<string, unknown>> = [];

    gameState.units.forEach((unit) => {
      const seg = segMap.get(unit.segmentId);
      const osmEdge = !seg ? osmEdgeMap.get(unit.segmentId) : undefined;
      const coords = seg?.coordinates || osmEdge?.coordinates;
      if (!coords || coords.length < 2) return;

      const totalSegs = coords.length - 1;
      const scaled = unit.progress * totalSegs;
      const idx = Math.min(Math.floor(scaled), totalSegs - 1);
      const subT = scaled - idx;
      const p1 = coords[idx];
      const p2 = coords[idx + 1];

      const lat = p1[0] + (p2[0] - p1[0]) * subT;
      const lng = p1[1] + (p2[1] - p1[1]) * subT;

      features.push({
        type: 'Feature',
        properties: {
          id: unit.id,
          radius: osmEdge ? 3.2 : 4.5,
          color: unit.color,
        },
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      });
    });

    const fc = { type: 'FeatureCollection', features } as unknown as GeoJsonData;
    unitsGeoJsonRef.current = fc;
    syncSourceData('osm-units', fc);
  }, [gameState.units, gameState.segments, gameState.osmEdges]);

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
    ? (gameState.osmNodes || []).find((n) => n.id === selectedOsmNodeId)
    : undefined;

  const cycleTileLayer = () => {
    const order: ('dark' | 'osm' | 'satellite')[] = ['dark', 'osm', 'satellite'];
    const next = order[(order.indexOf(tileType) + 1) % order.length];
    switchTileLayer(next);
  };

  const tileLabel = tileType === 'dark' ? '다크 지도' : tileType === 'osm' ? 'OSM 도로' : '위성 지도';

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
                flyTo(gameState.startingCity.lat, gameState.startingCity.lng, 2.5);
                setMobileRegionsOpen(false);
              }}
              className="min-h-[36px] px-3 py-1 text-xs rounded-lg font-semibold text-cyan-300 bg-cyan-500/15 whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              3D 지구본
            </button>
          </div>
        )}

        {/* Compact Mobile Node Legend */}
        <div className="self-start pointer-events-auto flex items-center gap-2.5 px-2.5 py-1 rounded-lg bg-slate-950/85 border border-slate-800/90 text-[10px] text-slate-300 shadow">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 border border-amber-200 inline-block" />
            도로 노드
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-cyan-400 bg-sky-950 inline-block" />
            철도 노드
          </span>
          <span className="text-slate-400">· 노드 2개 터치로 연결</span>
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

        {/* Compact Road vs Rail Node Legend */}
        <div className="flex items-center gap-3 px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] text-slate-300 shadow-lg">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-200 inline-block" />
            도로 노드
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full border-2 border-cyan-400 bg-sky-950 inline-block" />
            철도 노드
          </span>
          <span className="text-slate-400">· 시야 거리 d≤5 표시</span>
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
                popupRef.current?.remove();
              }}
              aria-label="노드 선택 취소"
              className="min-h-[38px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 cursor-pointer shrink-0 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              종료
            </button>
          </div>

          {previewResult ? (
            <div className="px-2.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-[11px] font-mono-numbers">
              <span className="text-slate-300">
                {previewResult.kind === 'transfer'
                  ? '특수 환승 직결'
                  : previewResult.kind === 'bridge'
                  ? '교차로 직결'
                  : '실측 노선 경로'}
                :{' '}
                <strong className="text-white">{previewResult.meters.toLocaleString()}m</strong> ·{' '}
                {previewResult.unbuiltCount}구간
              </span>
              <span
                className={
                  gameState.capital >= previewResult.cost
                    ? 'text-emerald-400 font-bold'
                    : 'text-rose-400 font-bold'
                }
              >
                ${previewResult.cost.toLocaleString()}
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
    </div>
  );
};
