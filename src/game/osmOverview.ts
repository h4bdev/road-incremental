import { OsmEdge } from './types';

export interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const OVERVIEW_ZOOM_THRESHOLD = 11.5;

export interface SimplifiedOverviewCurve {
  id: string;
  mode: 'road' | 'rail';
  built: boolean;
  wayName: string;
  highwayType: string;
  tier: 'built' | 'major' | 'minor';
  coordinates: [number, number][]; // [lng, lat] for MapLibre GeoJSON
}

export type BuiltSkeletonTuple = [number, number, number, number, 0 | 1];

export function isEdgeInViewport(edge: OsmEdge, bounds: ViewportBounds): boolean {
  const c0 = edge.coordinates[0];
  const c1 = edge.coordinates[edge.coordinates.length - 1];
  if (!c0 || !c1) return false;
  const eMinLat = Math.min(c0[0], c1[0]);
  const eMaxLat = Math.max(c0[0], c1[0]);
  const eMinLng = Math.min(c0[1], c1[1]);
  const eMaxLng = Math.max(c0[1], c1[1]);
  return (
    eMaxLat >= bounds.minLat &&
    eMinLat <= bounds.maxLat &&
    eMaxLng >= bounds.minLng &&
    eMinLng <= bounds.maxLng
  );
}

export function isNodeInViewport(lat: number, lng: number, bounds: ViewportBounds): boolean {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

function pointSegDistSq(pt: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = pt[0] - a[0];
    const py = pt[1] - a[1];
    return px * px + py * py;
  }
  const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq));
  const rx = pt[0] - (a[0] + t * dx);
  const ry = pt[1] - (a[1] + t * dy);
  return rx * rx + ry * ry;
}

export function simplifyLonLatLine(
  points: [number, number][],
  epsilonDeg = 0.0004
): [number, number][] {
  if (points.length <= 2) return points;
  const epsSq = epsilonDeg * epsilonDeg;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative Douglas-Peucker using stack (prevents recursion stack overflow on long rail/motorway chains)
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;
    let maxDistSq = 0;
    let maxIdx = -1;
    const pStart = points[start];
    const pEnd = points[end];
    for (let i = start + 1; i < end; i++) {
      const dSq = pointSegDistSq(points[i], pStart, pEnd);
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        maxIdx = i;
      }
    }
    if (maxDistSq > epsSq && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      out.push([
        Number(points[i][0].toFixed(5)),
        Number(points[i][1].toFixed(5)),
      ]);
    }
  }
  return out.length >= 2 ? out : [points[0], points[points.length - 1]];
}

const MAJOR_HW_RE = /^(motorway|trunk|primary|secondary|tertiary|rail|subway|light_rail|tram)/;

function mergeGroupIntoPolylines(
  groupEdges: OsmEdge[],
  epsilonDeg: number
): [number, number][][] {
  if (groupEdges.length === 0) return [];
  if (groupEdges.length === 1) {
    const e = groupEdges[0];
    return [
      e.coordinates.map(([lat, lng]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]),
    ];
  }

  const adj = new Map<string, number[]>();
  const coordsByNode = new Map<string, [number, number]>();

  for (let i = 0; i < groupEdges.length; i++) {
    const e = groupEdges[i];
    if (e.coordinates.length < 2) continue;
    const c0 = e.coordinates[0];
    const cLast = e.coordinates[e.coordinates.length - 1];
    coordsByNode.set(e.fromNodeId, [c0[1], c0[0]]);
    coordsByNode.set(e.toNodeId, [cLast[1], cLast[0]]);

    let listA = adj.get(e.fromNodeId);
    if (!listA) {
      listA = [];
      adj.set(e.fromNodeId, listA);
    }
    listA.push(i);

    let listB = adj.get(e.toNodeId);
    if (!listB) {
      listB = [];
      adj.set(e.toNodeId, listB);
    }
    listB.push(i);
  }

  const visited = new Uint8Array(groupEdges.length);
  const chains: [number, number][][] = [];

  const traceChain = (startNodeId: string, startEdgeIdx: number) => {
    const pts: [number, number][] = [];
    const startPt = coordsByNode.get(startNodeId);
    if (startPt) pts.push(startPt);

    let currNode = startNodeId;
    let currEdgeIdx: number | undefined = startEdgeIdx;

    while (currEdgeIdx !== undefined && !visited[currEdgeIdx]) {
      visited[currEdgeIdx] = 1;
      const e = groupEdges[currEdgeIdx];
      const forward = e.fromNodeId === currNode;
      const nextNode = forward ? e.toNodeId : e.fromNodeId;

      if (e.coordinates.length > 2) {
        const mids = forward
          ? e.coordinates.slice(1, -1)
          : e.coordinates.slice(1, -1).reverse();
        for (const [lat, lng] of mids) {
          pts.push([lng, lat]);
        }
      }

      const endPt = coordsByNode.get(nextNode);
      if (endPt) pts.push(endPt);

      currNode = nextNode;
      const incident = adj.get(currNode);
      if (!incident || incident.length > 2) {
        // Stop cleanly at junctions (degree >= 3) or dead ends
        break;
      }
      currEdgeIdx = incident.find((idx) => !visited[idx]);
    }

    if (pts.length >= 2) {
      chains.push(simplifyLonLatLine(pts, epsilonDeg));
    }
  };

  // Pass 1: start from endpoints or intersections (degree !== 2)
  for (const [nodeId, incident] of adj.entries()) {
    if (incident.length === 2) continue;
    for (const edgeIdx of incident) {
      if (!visited[edgeIdx]) {
        traceChain(nodeId, edgeIdx);
      }
    }
  }

  // Pass 2: remaining closed loops (all nodes degree === 2)
  for (let i = 0; i < groupEdges.length; i++) {
    if (!visited[i]) {
      traceChain(groupEdges[i].fromNodeId, i);
    }
  }

  return chains;
}

/**
 * Merge fragmented street/rail segments along shared ways & intersections into
 * simplified continuous polylines for Overview Zoom (< 11.5).
 * Built routes are ALWAYS included; unbuilt arterial/rail curves fill context like a vector map.
 */
export function buildSimplifiedOverviewCurves(
  edges: OsmEdge[],
  options?: {
    epsilonDeg?: number;
    maxUnbuiltCurves?: number;
  }
): SimplifiedOverviewCurve[] {
  const epsilonDeg = options?.epsilonDeg ?? 0.00042;
  const maxUnbuiltCurves = options?.maxUnbuiltCurves ?? 650;

  const builtGroups = new Map<string, { meta: OsmEdge; edges: OsmEdge[] }>();
  const majorUnbuiltGroups = new Map<string, { meta: OsmEdge; edges: OsmEdge[] }>();
  const minorUnbuiltGroups = new Map<string, { meta: OsmEdge; edges: OsmEdge[] }>();

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e || e.coordinates.length < 2) continue;
    const normWay = (e.wayName || e.highwayType || e.mode).trim();
    const gKey = `${e.built ? '1' : '0'}|${e.mode}|${normWay}`;

    if (e.built) {
      let grp = builtGroups.get(gKey);
      if (!grp) {
        grp = { meta: e, edges: [] };
        builtGroups.set(gKey, grp);
      }
      grp.edges.push(e);
    } else if (e.mode === 'rail' || MAJOR_HW_RE.test(e.highwayType || '')) {
      let grp = majorUnbuiltGroups.get(gKey);
      if (!grp) {
        grp = { meta: e, edges: [] };
        majorUnbuiltGroups.set(gKey, grp);
      }
      grp.edges.push(e);
    } else {
      let grp = minorUnbuiltGroups.get(gKey);
      if (!grp) {
        grp = { meta: e, edges: [] };
        minorUnbuiltGroups.set(gKey, grp);
      }
      grp.edges.push(e);
    }
  }

  const curves: SimplifiedOverviewCurve[] = [];
  let seq = 0;

  for (const grp of builtGroups.values()) {
    const polylines = mergeGroupIntoPolylines(grp.edges, epsilonDeg * 0.75);
    for (const coords of polylines) {
      curves.push({
        id: `ov_b_${seq++}`,
        mode: grp.meta.mode,
        built: true,
        wayName: grp.meta.wayName,
        highwayType: grp.meta.highwayType,
        tier: 'built',
        coordinates: coords,
      });
    }
  }

  let unbuiltCount = 0;
  for (const grp of majorUnbuiltGroups.values()) {
    if (unbuiltCount >= maxUnbuiltCurves) break;
    const polylines = mergeGroupIntoPolylines(grp.edges, epsilonDeg);
    for (const coords of polylines) {
      if (unbuiltCount >= maxUnbuiltCurves) break;
      curves.push({
        id: `ov_m_${seq++}`,
        mode: grp.meta.mode,
        built: false,
        wayName: grp.meta.wayName,
        highwayType: grp.meta.highwayType,
        tier: 'major',
        coordinates: coords,
      });
      unbuiltCount++;
    }
  }

  // If very few major arterials loaded yet (e.g. local neighborhood), fill remaining budget with longest minor chains
  if (unbuiltCount < 180 && minorUnbuiltGroups.size > 0) {
    const sortedMinor = Array.from(minorUnbuiltGroups.values()).sort(
      (a, b) => b.edges.length - a.edges.length
    );
    for (const grp of sortedMinor) {
      if (unbuiltCount >= Math.min(maxUnbuiltCurves, 320)) break;
      const polylines = mergeGroupIntoPolylines(grp.edges, epsilonDeg * 1.2);
      for (const coords of polylines) {
        if (unbuiltCount >= Math.min(maxUnbuiltCurves, 320)) break;
        curves.push({
          id: `ov_n_${seq++}`,
          mode: grp.meta.mode,
          built: false,
          wayName: grp.meta.wayName,
          highwayType: grp.meta.highwayType,
          tier: 'minor',
          coordinates: coords,
        });
        unbuiltCount++;
      }
    }
  }

  return curves;
}

export function buildSkeletonGeoJsonFeatures(
  skeleton: BuiltSkeletonTuple[]
): Array<{
  type: 'Feature';
  properties: { id: string; mode: 'road' | 'rail'; built: true; tier: 'built' };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}> {
  const features: Array<{
    type: 'Feature';
    properties: { id: string; mode: 'road' | 'rail'; built: true; tier: 'built' };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }> = [];
  for (let i = 0; i < skeleton.length; i++) {
    const [fLat, fLng, tLat, tLng, m] = skeleton[i];
    features.push({
      type: 'Feature',
      properties: {
        id: `sk_${i}`,
        mode: m === 1 ? 'rail' : 'road',
        built: true,
        tier: 'built',
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [fLng, fLat],
          [tLng, tLat],
        ],
      },
    });
  }
  return features;
}
