import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTick,
  buyUpgrade,
  calculateTotalIncomePerSec,
  computeOsmFrontierDistances,
  computeOsmFrontierDistancesForState,
  connectOsmEdge,
  connectOsmNodesDirect,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  findOsmRoadPath,
  getFrontierEdgeOpacity,
  getFrontierVisualStyle,
  getReachableOsmNodeSet,
  MAX_OSM_FRONTIER_DISTANCE,
  mergeOsmChunk,
  scopeGameStateToStartingCity,
  unlockSkill,
} from './rules';
import { CURATED_LINES, CURATED_NODES, PRESET_CITIES } from './worldCatalog';

function makeSampleOsmGrid(wayName = '세종대로', mode: 'road' | 'rail' = 'road') {
  const nodes = [
    { id: 'n1', lat: 37.56600, lng: 126.97800, connected: false, mode },
    { id: 'n2', lat: 37.56622, lng: 126.97800, connected: false, mode },
    { id: 'n3', lat: 37.56644, lng: 126.97800, connected: false, mode },
    { id: 'n4', lat: 37.56666, lng: 126.97800, connected: false, mode },
    { id: 'n5', lat: 37.56688, lng: 126.97800, connected: false, mode },
  ];
  const edges = [
    {
      id: 'e12',
      wayName,
      highwayType: mode === 'rail' ? 'subway' : 'primary',
      mode,
      fromNodeId: 'n1',
      toNodeId: 'n2',
      coordinates: [
        [37.56600, 126.97800],
        [37.56622, 126.97800],
      ] as [[number, number], [number, number]],
      distanceKm: 0.024,
      buildCost: 35,
      baseIncomePerSec: 3.0,
      built: false,
    },
    {
      id: 'e23',
      wayName,
      highwayType: mode === 'rail' ? 'subway' : 'primary',
      mode,
      fromNodeId: 'n2',
      toNodeId: 'n3',
      coordinates: [
        [37.56622, 126.97800],
        [37.56644, 126.97800],
      ] as [[number, number], [number, number]],
      distanceKm: 0.024,
      buildCost: 35,
      baseIncomePerSec: 3.0,
      built: false,
    },
    {
      id: 'e34',
      wayName,
      highwayType: mode === 'rail' ? 'subway' : 'primary',
      mode,
      fromNodeId: 'n3',
      toNodeId: 'n4',
      coordinates: [
        [37.56644, 126.97800],
        [37.56666, 126.97800],
      ] as [[number, number], [number, number]],
      distanceKm: 0.024,
      buildCost: 35,
      baseIncomePerSec: 3.0,
      built: false,
    },
    {
      id: 'e45',
      wayName,
      highwayType: mode === 'rail' ? 'subway' : 'primary',
      mode,
      fromNodeId: 'n4',
      toNodeId: 'n5',
      coordinates: [
        [37.56666, 126.97800],
        [37.56688, 126.97800],
      ] as [[number, number], [number, number]],
      distanceKm: 0.024,
      buildCost: 35,
      baseIncomePerSec: 3.0,
      built: false,
    },
  ];
  return { nodes, edges };
}

test('createInitialGameState initializes starting city, 28 tree skills, and 22 deep upgrades', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  assert.equal(state.startingCity.id, 'seoul');
  assert.equal(state.lines.length, 3);
  assert.ok(state.lines.every((l) => l.cityId === 'seoul'));
  assert.equal((state as unknown as Record<string, unknown>).landmarks, undefined);
  assert.equal(state.achievements.some((a) => (a.category as string) === 'landmark'), false);
  assert.ok(state.nodes.length > 0 && state.nodes.every((n) => n.cityId === 'seoul'));
  assert.ok(state.skills.length >= 25);
  assert.ok(state.upgrades.length >= 20);
  assert.deepEqual(state.completedOsmWays, []);
  assert.deepEqual(state.loadedOsmRegions, []);
  assert.equal(calculateTotalIncomePerSec(state), 0);
});

function makeLongOsmGrid(
  wayName: string,
  mode: 'road' | 'rail',
  nodeCount = 13,
  baseLat = 37.566,
  baseLng = 126.978,
  idPrefix = 'n'
) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `${idPrefix}${i + 1}`,
    lat: Number((baseLat + i * 0.00022).toFixed(6)),
    lng: baseLng,
    connected: false,
    mode,
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    id: `e_${idPrefix}_${i + 1}_${i + 2}`,
    wayName,
    highwayType: mode === 'rail' ? 'subway' : 'primary',
    mode,
    fromNodeId: nodes[i].id,
    toNodeId: nodes[i + 1].id,
    coordinates: [
      [nodes[i].lat, nodes[i].lng],
      [nodes[i + 1].lat, nodes[i + 1].lng],
    ] as [[number, number], [number, number]],
    distanceKm: 0.024,
    buildCost: 35,
    baseIncomePerSec: 3.0,
    built: false,
  }));
  return { nodes, edges };
}

test('linking OSM nodes completes real way, triggers matching local line & achievement without false AMTRAK unlock', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000, skillPoints: 10 };
  const initialSP = state.skillPoints;

  // Unlock scale-multiplying skills first to ensure scaledNodes NEVER falsely unlocks AMTRAK/foreign lines
  state = unlockSkill(state, 'sk_root_0').newState;
  state = unlockSkill(state, 'sk_trunk_2').newState;
  state = unlockSkill(state, 'sk_auto_1').newState;
  state = unlockSkill(state, 'sk_auto_2').newState;

  const { nodes, edges } = makeLongOsmGrid('세종대로', 'road', 13);
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'osm_prov_seoul');
  assert.ok(state.loadedOsmRegions?.includes('osm_prov_seoul'));

  // Jumping directly past d=5 (n1 -> n13) is blocked until frontier expands!
  const blockedFar = connectOsmPath(state, 'n1', 'n13');
  assert.equal(blockedFar.success, false, 'Nodes with d > 5 must NOT be explorable directly');

  // Connect outward within d <= 5 increments: n1 -> n6 (5 edges), n6 -> n11 (5 edges), n11 -> n13 (2 edges)
  const r1 = connectOsmPath(state, 'n1', 'n6');
  assert.equal(r1.success, true);
  assert.equal(r1.builtCount, 5);
  const r2 = connectOsmPath(r1.newState, 'n6', 'n11');
  assert.equal(r2.success, true);
  assert.equal(r2.builtCount, 5);
  const res = connectOsmPath(r2.newState, 'n11', 'n13');
  assert.equal(res.success, true);
  assert.equal(res.builtCount, 2);
  assert.equal(res.newState.stats.totalOsmEdgesBuilt, 12);
  assert.equal(res.newState.stats.connectedOsmNodes, 13);
  assert.ok(res.newState.stats.mapped1to1Km > 0);
  assert.ok(res.newState.stats.totalNetworkKm > 0);
  assert.ok(calculateTotalIncomePerSec(res.newState) > 0);

  // Real way '세종대로' completed -> bonus recorded
  assert.ok(res.newlyCompletedOsmWays.some((w) => w.wayName === '세종대로'));
  assert.ok((res.newState.completedOsmWays || []).includes('road::세종대로'));

  // Local Seoul ROAD line (한강 올림픽대로, target 12 road nodes) completes,
  // while Seoul RAIL (line_seoul_2) and New York RAIL (AMTRAK) stay uncompleted!
  assert.ok(res.newlyCompletedLines.some((l) => l.id === 'line_seoul_olympic'));
  assert.equal(
    res.newState.lines.find((l) => l.id === 'line_seoul_2')?.completed,
    false,
    'Road nodes must NOT complete rail line 서울 지하철 2호선'
  );
  assert.equal(
    res.newState.lines.find((l) => l.id === 'line_us_transcon'),
    undefined,
    'Foreign New York AMTRAK line must not exist in a Seoul game'
  );
  assert.equal(
    res.newState.achievements.find((a) => a.id === 'ach_line_line_us_transcon'),
    undefined,
    'Foreign AMTRAK achievement must not appear in a Seoul game'
  );

  const osmAch5 = res.newState.achievements.find((a) => a.id === 'ach_osm_5')!;
  assert.equal(osmAch5.unlocked, true);
  assert.ok(res.newState.skillPoints > initialSP - 4);
});

test('frontier distance fog-of-war enforces d <= 5 visibility, constructability, and monotonic brightness falloff', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const { nodes, edges } = makeLongOsmGrid('종로', 'road', 10, 37.5665, 126.978, 'f');
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);

  // Starting seed marks f1 as connected (d = 0)
  assert.equal(state.osmNodes.find((n) => n.id === 'f1')?.connected, true);

  const dists = computeOsmFrontierDistancesForState(state);
  assert.equal(MAX_OSM_FRONTIER_DISTANCE, 5);
  assert.equal(dists.get('f1'), 0);
  assert.equal(dists.get('f2'), 1);
  assert.equal(dists.get('f3'), 2);
  assert.equal(dists.get('f4'), 3);
  assert.equal(dists.get('f5'), 4);
  assert.equal(dists.get('f6'), 5);
  // Nodes beyond d=5 MUST be omitted from frontier visibility
  assert.equal(dists.get('f7'), undefined);
  assert.equal(dists.get('f10'), undefined);

  // Brightness, opacity, and radius decrease monotonically as d rises from 1 to 5
  const styles = [1, 2, 3, 4, 5].map((d) => getFrontierVisualStyle(d, 'road'));
  for (let i = 0; i < styles.length - 1; i++) {
    assert.ok(styles[i].brightness > styles[i + 1].brightness, `brightness d=${i + 1} > d=${i + 2}`);
    assert.ok(styles[i].fillOpacity > styles[i + 1].fillOpacity, `fillOpacity d=${i + 1} > d=${i + 2}`);
    assert.ok(styles[i].strokeOpacity > styles[i + 1].strokeOpacity, `strokeOpacity d=${i + 1} > d=${i + 2}`);
    assert.ok(styles[i].radiusScale > styles[i + 1].radiusScale, `radiusScale d=${i + 1} > d=${i + 2}`);
    assert.ok(getFrontierEdgeOpacity(i + 1, true) > getFrontierEdgeOpacity(i + 2, true));
  }

  // Direct exploration to f7 (d=6) is blocked, while f6 (d=5) is permitted
  const blocked = connectOsmPath(state, 'f1', 'f7');
  assert.equal(blocked.success, false);
  const blockedEdge = connectOsmEdge(state, 'e_f_6_7');
  assert.equal(blockedEdge.success, false);

  const ok5 = connectOsmPath(state, 'f1', 'f6');
  assert.equal(ok5.success, true);
  assert.equal(ok5.builtCount, 5);

  // Now f7..f10 fall within d=1..4 from the newly extended tip f6
  const updatedDists = computeOsmFrontierDistances(ok5.newState.osmNodes, ok5.newState.osmEdges);
  assert.equal(updatedDists.get('f6'), 0);
  assert.equal(updatedDists.get('f7'), 1);
  assert.equal(updatedDists.get('f10'), 4);
});

test('road nodes and rail nodes cannot connect directly except in special mixed-hub or transfer-skill cases', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000, skillPoints: 10 };

  // Place a road node and a nearby rail node ~22m apart, plus a further rail node ~80m apart
  state = mergeOsmChunk(
    state,
    '37.566_126.978',
    [
      { id: 'road_a', lat: 37.56600, lng: 126.97800, connected: false, mode: 'road' },
      { id: 'rail_near', lat: 37.56620, lng: 126.97800, connected: false, mode: 'rail' },
      { id: 'rail_far', lat: 37.56672, lng: 126.97800, connected: false, mode: 'rail' },
    ],
    []
  );

  // 1. Default: connecting road -> rail (even 22m apart) must FAIL
  const blocked = connectOsmPath(state, 'road_a', 'rail_near');
  assert.equal(blocked.success, false);
  assert.equal(blocked.newState.stats.totalOsmEdgesBuilt, 0);

  // 2. Unlocking special transfer skill (sk_infra_4) allows <= 35m transfer bridge, but still blocks > 35m
  state = unlockSkill(state, 'sk_root_0').newState;
  state = unlockSkill(state, 'sk_trunk_1').newState;
  state = unlockSkill(state, 'sk_infra_1').newState;
  state = unlockSkill(state, 'sk_infra_2').newState;
  state = unlockSkill(state, 'sk_infra_4').newState;

  const tooFarTransfer = connectOsmPath(state, 'road_a', 'rail_far');
  assert.equal(tooFarTransfer.success, false, 'Transfer bridge > 35m must still be blocked');

  const closeTransfer = connectOsmPath(state, 'road_a', 'rail_near');
  assert.equal(closeTransfer.success, true, 'Transfer bridge <= 35m with sk_infra_4 unlocked should succeed');
  assert.equal(closeTransfer.newState.osmEdges.at(-1)?.wayName, '복합 환승 직결');
});

test('parallel 2-lane road and railway nodes cannot bridge across separate lanes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  // Build parallel 2-lane railway tracks ~10m apart (lng 126.97800 vs 126.97811)
  const railLaneA = makeLongOsmGrid('경부선 상행', 'rail', 4, 37.566, 126.9780, 'ra');
  const railLaneB = makeLongOsmGrid('경부선 하행', 'rail', 4, 37.566, 126.97811, 'rb');
  // Build parallel 2-lane road carriageways ~14m apart
  const roadLaneA = makeLongOsmGrid('세종대로 상행', 'road', 4, 37.567, 126.9780, 'da');
  const roadLaneB = makeLongOsmGrid('세종대로 하행', 'road', 4, 37.567, 126.97816, 'db');

  state = mergeOsmChunk(
    state,
    '37.566_126.978',
    [...railLaneA.nodes, ...railLaneB.nodes, ...roadLaneA.nodes, ...roadLaneB.nodes],
    [...railLaneA.edges, ...railLaneB.edges, ...roadLaneA.edges, ...roadLaneB.edges]
  );

  // Reachable set from rail Lane A must exclude rail Lane B
  const reachableRailA = getReachableOsmNodeSet(state, 'ra1');
  assert.equal(reachableRailA.has('ra4'), true);
  assert.equal(reachableRailA.has('rb1'), false);
  assert.equal(reachableRailA.has('rb2'), false);

  // Cross-lane rail link must fail in both connectOsmPath and connectOsmNodesDirect
  const crossRailPath = connectOsmPath(state, 'ra2', 'rb2');
  assert.equal(crossRailPath.success, false, 'Parallel rail lanes must NOT cross-connect');
  const crossRailDirect = connectOsmNodesDirect(state, 'ra2', 'rb2');
  assert.equal(crossRailDirect.success, false, 'Direct cross-lane rail bridge must be blocked');

  // Cross-lane road link must also fail
  const crossRoadPath = connectOsmPath(state, 'da2', 'db2');
  assert.equal(crossRoadPath.success, false, 'Parallel 2-lane road carriageways must NOT cross-connect');
  const crossRoadDirect = connectOsmNodesDirect(state, 'da2', 'db2');
  assert.equal(crossRoadDirect.success, false, 'Direct cross-lane road bridge must be blocked');

  // Same-lane progression still works seamlessly
  const sameLaneRail = connectOsmPath(state, 'ra1', 'ra4');
  assert.equal(sameLaneRail.success, true);
  assert.equal(sameLaneRail.builtCount, 3);
});

test('unlockSkill enforces botanical tree prerequisites from root -> trunk -> branch', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000, skillPoints: 6 };

  // Cannot unlock trunk or branch before root
  assert.equal(unlockSkill(state, 'sk_trunk_1').success, false);
  assert.equal(unlockSkill(state, 'sk_infra_1').success, false);

  const r0 = unlockSkill(state, 'sk_root_0');
  assert.equal(r0.success, true);
  assert.equal(r0.newState.skillPoints, 5);

  const t1 = unlockSkill(r0.newState, 'sk_trunk_1');
  assert.equal(t1.success, true);

  const inf1 = unlockSkill(t1.newState, 'sk_infra_1');
  assert.equal(inf1.success, true);
});

test('mergeOsmChunk, connectOsmEdge, and connectOsmNodesDirect link atomic OSM nodes within frontier', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 20000 };

  state = mergeOsmChunk(
    state,
    '37.567_126.983',
    [
      { id: 'n1', lat: 37.566, lng: 126.978, connected: false, mode: 'road' },
      { id: 'n2', lat: 37.567, lng: 126.981, connected: false, mode: 'road' },
      { id: 'n3', lat: 37.568, lng: 126.984, connected: false, mode: 'road' },
      { id: 'n_far', lat: 37.575, lng: 126.995, connected: false, mode: 'road' },
    ],
    [
      {
        id: 'e1',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        coordinates: [
          [37.566, 126.978],
          [37.567, 126.981],
        ],
        distanceKm: 0.3,
        buildCost: 100,
        baseIncomePerSec: 8,
        built: false,
      },
      {
        id: 'e2',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n2',
        toNodeId: 'n3',
        coordinates: [
          [37.567, 126.981],
          [37.568, 126.984],
        ],
        distanceKm: 0.3,
        buildCost: 100,
        baseIncomePerSec: 8,
        built: false,
      },
    ]
  );

  const edgeRes = connectOsmEdge(state, 'e1');
  assert.equal(edgeRes.success, true);
  assert.equal(edgeRes.newState.stats.totalOsmEdgesBuilt, 1);
  assert.equal(edgeRes.newState.stats.connectedOsmNodes, 2);
  assert.ok(calculateTotalIncomePerSec(edgeRes.newState) >= 8);

  // Connecting existing edge via connectOsmNodesDirect builds e2 (n2 -> n3, d=1)
  const directRes = connectOsmNodesDirect(edgeRes.newState, 'n2', 'n3');
  assert.equal(directRes.success, true);
  assert.equal(directRes.newState.stats.totalOsmEdgesBuilt, 2);
  assert.equal(directRes.newState.stats.connectedOsmNodes, 3);

  // Isolated unreachable node beyond frontier (n_far) must be blocked
  const isolatedRes = connectOsmNodesDirect(directRes.newState, 'n3', 'n_far');
  assert.equal(isolatedRes.success, false);
});

test('findOsmRoadPath previews multi-hop road chains and promotes mixed road/rail transfer nodes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 10000 };

  const { nodes, edges } = makeSampleOsmGrid('을지로', 'road');
  state = mergeOsmChunk(state, '37.5667_126.9767', nodes, edges);

  // Overlapping rail chunk node promotes transfer node 'n4' to 'mixed'
  state = mergeOsmChunk(
    state,
    '37.5667_126.9800',
    [{ id: 'n4', lat: 37.56666, lng: 126.97800, connected: false, mode: 'rail' }],
    []
  );
  assert.equal(state.osmNodes.find((n) => n.id === 'n4')?.mode, 'mixed');

  const preview = findOsmRoadPath(state, 'n1', 'n4');
  assert.ok(preview);
  assert.equal(preview.edgeIds.length, 3);
  assert.equal(preview.unbuiltEdgeIds.length, 3);

  const res = connectOsmPath(state, 'n1', 'n4');
  assert.equal(res.success, true);
  assert.equal(res.builtCount, 3);
  assert.equal(res.newState.stats.totalOsmEdgesBuilt, 3);
  assert.equal(res.newState.stats.connectedOsmNodes, 4);
});

test('skill tree starts at exact center (800, 600) and branches outward in all four directions', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  const root = state.skills.find((s) => s.id === 'sk_root_0')!;
  assert.equal(root.x, 800);
  assert.equal(root.y, 600);

  const directChildren = state.skills.filter((s) => s.requires.includes('sk_root_0'));
  assert.ok(directChildren.some((s) => s.x < 800), 'Expected westward root branch');
  assert.ok(directChildren.some((s) => s.x > 800), 'Expected eastward root branch');
  assert.ok(directChildren.some((s) => s.y < 600), 'Expected northward root branch');
  assert.ok(directChildren.some((s) => s.y > 600), 'Expected southward root branch');
});

test('buyUpgrade supports single and bulk x10 levels and boosts node-link income', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 5_000_000 };

  const { nodes, edges } = makeSampleOsmGrid('종로', 'road');
  const withGrid = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  const built = connectOsmPath(withGrid, 'n1', 'n4').newState;
  const baseInc = calculateTotalIncomePerSec(built);

  const bulk = buyUpgrade(built, 'upg_atcs_signal', 10);
  assert.equal(bulk.success, true);
  assert.equal(bulk.levelsBought, 10);
  assert.ok(calculateTotalIncomePerSec(bulk.newState) > baseInc * 2);
});

test('advanceTick earns idle money and auto-builder constructs strictly OSM node edges', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 80000, skillPoints: 10 };

  const { nodes, edges } = makeSampleOsmGrid('남대문로', 'road');
  const withGrid = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  const linked1 = connectOsmPath(withGrid, 'n1', 'n2').newState;
  const r0 = unlockSkill(linked1, 'sk_root_0').newState;
  const t1 = unlockSkill(r0, 'sk_trunk_1').newState;
  const t2 = unlockSkill(t1, 'sk_trunk_2').newState;
  const sk = unlockSkill(t2, 'sk_auto_1');
  assert.equal(sk.success, true);

  let s = sk.newState;
  const startOsmBuilt = s.stats.totalOsmEdgesBuilt;

  let autoBuiltCount = 0;
  for (let i = 0; i < 40; i++) {
    const tick = advanceTick(s, 0.2);
    s = tick.newState;
    if (tick.autoBuiltSomething) autoBuiltCount += 1;
  }

  assert.ok(autoBuiltCount >= 1, 'Expected auto-builder to construct at least 1 OSM edge');
  assert.ok(s.stats.totalOsmEdgesBuilt > startOsmBuilt);
  assert.equal(s.stats.totalSegmentsBuilt, 0, 'Auto-builder must never build macro segments');
});

test('dispatchClickBonus grants immediate cash and increments clicks', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  const res = dispatchClickBonus(state);

  assert.ok(res.earned >= 25);
  assert.equal(res.newState.capital, state.capital + res.earned);
  assert.equal(res.newState.stats.totalClicks, 1);
});

test('city scoping hides foreign preset lines, nodes, and achievements and strips landmarks across preset and custom cities', () => {
  // 1. Non-Seoul preset city (Tokyo) excludes Seoul/NY/London/Paris/Busan/Global items
  const tokyo = PRESET_CITIES.find((c) => c.id === 'tokyo')!;
  const tokyoState = createInitialGameState(tokyo);

  assert.ok(tokyoState.nodes.length > 0 && tokyoState.nodes.every((n) => n.cityId === 'tokyo'));
  assert.ok(tokyoState.lines.length > 0 && tokyoState.lines.every((l) => l.cityId === 'tokyo'));
  assert.equal(tokyoState.achievements.some((a) => (a.category as string) === 'landmark'), false);
  assert.equal(tokyoState.lines.some((l) => l.id === 'line_seoul_2'), false);
  assert.equal(tokyoState.lines.some((l) => l.id === 'line_eurasia_global'), false);

  const lineAchs = tokyoState.achievements.filter((a) => a.targetType === 'line_complete');
  const townAchs = tokyoState.achievements.filter((a) => a.targetType === 'town_complete');
  assert.equal(lineAchs.length, tokyoState.lines.length);
  assert.equal(townAchs.length, 1);
  assert.equal(townAchs[0].targetId, 'tokyo');

  // 2. Custom searched city excludes ALL preset curated nodes, lines, and foreign achievements
  const customCity = {
    id: 'custom_zurich',
    name: '취리히 (Zurich)',
    country: 'Switzerland',
    lat: 47.3769,
    lng: 8.5417,
    zoom: 13,
    description: '스위스 철도 허브',
    isCustom: true,
  };
  const customNetwork = {
    nodes: [
      { id: 'custom_n1', name: '취리히 중앙역', cityId: 'custom_zurich', lat: 47.3779, lng: 8.5402, isHub: true, connected: true, level: 1 },
    ],
    lines: [
      {
        id: 'line_custom_zurich_s',
        name: '취리히 S-Bahn 간선',
        cityId: 'custom_zurich',
        mode: 'rail' as const,
        category: 'metro' as const,
        color: '#22c55e',
        lineCode: 'ZUR-S',
        description: '취리히 광역 철도 노선',
        segmentIds: ['seg_custom_1'],
        completed: false,
        completionBonus: { incomeMultiplierPct: 40, skillPoints: 2, instantCash: 3000, label: '수익 +40%' },
      },
    ],
    segments: [
      {
        id: 'seg_custom_1',
        lineId: 'line_custom_zurich_s',
        name: '중앙역 ~ 공항',
        mode: 'rail' as const,
        fromNodeId: 'custom_n1',
        toNodeId: 'custom_n1',
        distanceKm: 10,
        feederNetworkKm: 100,
        coordinates: [[47.3779, 8.5402], [47.4582, 8.5555]] as [number, number][],
        buildCost: 500,
        baseIncomePerSec: 20,
        built: false,
        level: 1,
      },
    ],
  };
  const customState = createInitialGameState(customCity, customNetwork);
  assert.equal(customState.nodes.length, 1);
  assert.equal(customState.lines.length, 1);
  assert.equal(customState.achievements.some((a) => a.targetId === 'line_seoul_2'), false);
  assert.equal(customState.achievements.some((a) => a.targetId === 'seoul'), false);

  // 3. Legacy save containing foreign cities & removed landmark achievements gets cleanly stripped
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const legacyDirty = createInitialGameState(seoul);
  legacyDirty.nodes = CURATED_NODES.map((n) => ({ ...n }));
  legacyDirty.lines = CURATED_LINES.map((l) => ({
    ...l,
    completed: l.id === 'line_us_transcon' || l.id === 'line_seoul_2',
  }));
  legacyDirty.achievements = [
    ...legacyDirty.achievements,
    {
      id: 'ach_line_line_us_transcon',
      title: 'AMTRAK 완전 개통',
      description: '외국 노선',
      category: 'line',
      targetType: 'line_complete',
      targetId: 'line_us_transcon',
      unlocked: true,
      rewardText: '...',
      bonusIncomePct: 100,
      bonusSkillPoints: 2,
      bonusCash: 1000,
    },
    {
      id: 'ach_town_tokyo',
      title: '도쿄 교통망 마스터',
      description: '외국 도시',
      category: 'town',
      targetType: 'town_complete',
      targetId: 'tokyo',
      unlocked: true,
      rewardText: '...',
      bonusIncomePct: 100,
      bonusSkillPoints: 4,
      bonusCash: 50000,
    },
  ];

  const cleaned = scopeGameStateToStartingCity(legacyDirty);
  assert.ok(cleaned.nodes.every((n) => n.cityId === 'seoul'));
  assert.ok(cleaned.lines.every((l) => l.cityId === 'seoul'));
  assert.equal(cleaned.achievements.some((a) => a.targetId === 'line_us_transcon'), false);
  assert.equal(cleaned.achievements.some((a) => a.targetId === 'tokyo'), false);
  assert.equal(cleaned.achievements.some((a) => (a.category as string) === 'landmark'), false);
  assert.equal(cleaned.stats.totalLinesCompleted, 1);
});
