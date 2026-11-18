import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTick,
  buyAllAffordableSkills,
  buyMaxSkill,
  calculateTotalIncomePerSec,
  computeOsmFrontierDistances,
  computeOsmFrontierDistancesForState,
  connectOsmEdge,
  connectOsmNodesDirect,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  ensureSeedConnectedOsmNodes,
  findOsmRoadPath,
  getExpandableProvincialRegions,
  getFrontierEdgeOpacity,
  getFrontierVisualStyle,
  getNodeTierRank,
  getReachableOsmNodeSet,
  getRegionProgressStats,
  getRegionUnlockCost,
  isNodeInUnlockedRegion,
  ISOLATED_ROUTE_BRIDGE_MAX_KM,
  isSkillBlockedByExclusivePath,
  MAX_OSM_FRONTIER_DISTANCE,
  mergeOsmChunk,
  registerDiscoveredProvincialRegion,
  resetSkillTree,
  scopeGameStateToStartingCity,
  selectIsolatedRegionSeed,
  unlockProvincialRegion,
  unlockSkill,
} from './rules';
import { CURATED_LINES, INITIAL_UPGRADES, PRESET_CITIES } from './worldCatalog';

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

test('createInitialGameState initializes city-level regions with GeoJSON boundaries, zero SP/milestones, and expanded 40+ study tree', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  assert.equal(state.startingCity.id, 'seoul');
  assert.equal(CURATED_LINES.length, 0);
  assert.equal(INITIAL_UPGRADES.length, 0);
  assert.equal(state.lines.length, 0);
  assert.equal(state.upgrades.length, 0);
  assert.equal(state.skillPoints, 0);

  // Zero line_complete, town_complete, or landmark achievements
  assert.equal(
    state.achievements.some(
      (a) =>
        (a.targetType as string) === 'line_complete' ||
        (a.targetType as string) === 'town_complete' ||
        (a.category as string) === 'landmark'
    ),
    false
  );
  assert.ok(state.skills.length >= 40, 'Expanded Antimatter Dimensions-style study tree should have >= 40 studies');
  assert.ok(state.skills.every((s) => s.costSP === 0 && s.costMoney > 0));
  assert.ok(state.provincialRegions.every((r) => Boolean(r.boundaryGeoJson)));
  assert.equal(state.provincialRegions.filter((r) => r.unlocked).length, 1);
  assert.equal(state.provincialRegions.find((r) => r.unlocked)?.regionId, 'curated_kr_seoul');
  assert.deepEqual(state.completedOsmWays, []);
  assert.deepEqual(state.loadedOsmRegions, []);
  assert.equal(calculateTotalIncomePerSec(state), 0);
});

test('linking OSM nodes completes real way and OSM junction achievements without SP or milestone lines', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 500_000 };

  // Money-only study purchases along [11] -> [32] -> [42] -> [53]
  state = unlockSkill(state, 'sk_root_0').newState;
  state = unlockSkill(state, 'sk_trunk_2').newState;
  state = unlockSkill(state, 'sk_auto_1').newState;
  state = unlockSkill(state, 'sk_auto_2').newState;
  assert.equal(state.skillPoints, 0);

  const { nodes, edges } = makeLongOsmGrid('세종대로', 'road', 13);
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul', {
    totalNodeCount: 50,
  });
  assert.ok(state.loadedOsmRegions?.includes('curated_kr_seoul'));

  // Jumping past d=5 is blocked
  const blockedFar = connectOsmPath(state, 'n1', 'n13');
  assert.equal(blockedFar.success, false);

  // Connect outward within d <= 5 increments
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
  assert.equal(res.newState.stats.totalScaledNodes, 13);
  assert.equal(res.newState.stats.totalNetworkKm, res.newState.stats.mapped1to1Km);
  assert.ok(calculateTotalIncomePerSec(res.newState) > 0);

  // Real way completed & OSM junction achievement unlocked (0 SP awarded)
  assert.ok(res.newlyCompletedOsmWays.some((w) => w.wayName === '세종대로'));
  assert.ok((res.newState.completedOsmWays || []).includes('road::세종대로'));
  assert.equal(res.newlyCompletedLines.length, 0);
  const osmAch5 = res.newState.achievements.find((a) => a.id === 'ach_osm_5')!;
  assert.equal(osmAch5.unlocked, true);
  assert.equal(res.newState.skillPoints, 0);

  // City progress tracking reports connectedCount / totalNodes / percentage
  const prog = getRegionProgressStats(res.newState, 'curated_kr_seoul');
  assert.equal(prog.connectedCount, 13);
  assert.equal(prog.totalNodes, 50);
  assert.equal(prog.pct, 26);
});

test('frontier distance fog-of-war enforces d <= 5 visibility, constructability, and monotonic brightness falloff', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const { nodes, edges } = makeLongOsmGrid('종로', 'road', 10, 37.5665, 126.978, 'f');
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);

  assert.equal(state.osmNodes.find((n) => n.id === 'f1')?.connected, true);

  const dists = computeOsmFrontierDistancesForState(state);
  assert.equal(MAX_OSM_FRONTIER_DISTANCE, 5);
  assert.equal(dists.get('f1'), 0);
  assert.equal(dists.get('f6'), 5);
  assert.equal(dists.get('f7'), undefined);
  assert.equal(dists.get('f10'), undefined);

  const styles = [1, 2, 3, 4, 5].map((d) => getFrontierVisualStyle(d, 'road'));
  for (let i = 0; i < styles.length - 1; i++) {
    assert.ok(styles[i].brightness > styles[i + 1].brightness);
    assert.ok(styles[i].fillOpacity > styles[i + 1].fillOpacity);
    assert.ok(styles[i].strokeOpacity > styles[i + 1].strokeOpacity);
    assert.ok(styles[i].radiusScale > styles[i + 1].radiusScale);
    assert.ok(getFrontierEdgeOpacity(i + 1, true) > getFrontierEdgeOpacity(i + 2, true));
  }

  const blocked = connectOsmPath(state, 'f1', 'f7');
  assert.equal(blocked.success, false);
  const blockedEdge = connectOsmEdge(state, 'e_f_6_7');
  assert.equal(blockedEdge.success, false);

  const ok5 = connectOsmPath(state, 'f1', 'f6');
  assert.equal(ok5.success, true);
  assert.equal(ok5.builtCount, 5);

  const updatedDists = computeOsmFrontierDistances(ok5.newState.osmNodes, ok5.newState.osmEdges);
  assert.equal(updatedDists.get('f6'), 0);
  assert.equal(updatedDists.get('f7'), 1);
  assert.equal(updatedDists.get('f10'), 4);
});

test('road nodes and rail nodes cannot connect directly except with transfer study [71] sk_infra_4', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 5_000_000 };

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

  // Default: road -> rail blocked
  const blocked = connectOsmPath(state, 'road_a', 'rail_near');
  assert.equal(blocked.success, false);

  // Follow vertical Money-only Study Tree path: [11] -> [21] -> [31] -> [41] -> [51] -> [61] -> [71] sk_infra_4
  for (const id of [
    'sk_root_0',
    'sk_root_l',
    'sk_trunk_1',
    'sk_infra_1',
    'sk_infra_2',
    'sk_infra_3',
    'sk_infra_4',
  ]) {
    const res = unlockSkill(state, id);
    assert.equal(res.success, true, `Should unlock study ${id}`);
    state = res.newState;
  }

  const tooFarTransfer = connectOsmPath(state, 'road_a', 'rail_far');
  assert.equal(tooFarTransfer.success, false, 'Transfer bridge > 35m must remain blocked');

  const closeTransfer = connectOsmPath(state, 'road_a', 'rail_near');
  assert.equal(closeTransfer.success, true, 'Transfer bridge <= 35m with [71] should succeed');
  assert.equal(closeTransfer.newState.osmEdges.at(-1)?.wayName, '복합 환승 직결');
});

test('parallel 2-lane road and railway nodes cannot bridge across separate lanes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const railLaneA = makeLongOsmGrid('경부선 상행', 'rail', 4, 37.566, 126.9780, 'ra');
  const railLaneB = makeLongOsmGrid('경부선 하행', 'rail', 4, 37.566, 126.97811, 'rb');
  const roadLaneA = makeLongOsmGrid('세종대로 상행', 'road', 4, 37.567, 126.9780, 'da');
  const roadLaneB = makeLongOsmGrid('세종대로 하행', 'road', 4, 37.567, 126.97816, 'db');

  state = mergeOsmChunk(
    state,
    '37.566_126.978',
    [...railLaneA.nodes, ...railLaneB.nodes, ...roadLaneA.nodes, ...roadLaneB.nodes],
    [...railLaneA.edges, ...railLaneB.edges, ...roadLaneA.edges, ...roadLaneB.edges]
  );

  const reachableRailA = getReachableOsmNodeSet(state, 'ra1');
  assert.equal(reachableRailA.has('ra4'), true);
  assert.equal(reachableRailA.has('rb1'), false);

  assert.equal(connectOsmPath(state, 'ra2', 'rb2').success, false);
  assert.equal(connectOsmNodesDirect(state, 'ra2', 'rb2').success, false);
  assert.equal(connectOsmPath(state, 'da2', 'db2').success, false);
  assert.equal(connectOsmNodesDirect(state, 'da2', 'db2').success, false);

  const sameLaneRail = connectOsmPath(state, 'ra1', 'ra4');
  assert.equal(sameLaneRail.success, true);
  assert.equal(sameLaneRail.builtCount, 3);
});

test('Antimatter Dimensions study tree supports top-to-bottom Money purchases, 3-way exclusive lock until [111], Buy Max, Buy All, and 100% Reset refund', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 5e12 };

  // Root [11] starts at top-center (x=800, y=85) and progresses downward
  const root = state.skills.find((s) => s.id === 'sk_root_0')!;
  const tier16 = state.skills.find((s) => s.id === 'sk_crown_3')!;
  assert.equal(root.code, '11');
  assert.equal(root.x, 800);
  assert.equal(root.y, 85);
  assert.equal(tier16.code, '161');
  assert.ok(tier16.y > 1800);

  // Prerequisites enforced
  assert.equal(unlockSkill(state, 'sk_trunk_1').success, false);
  assert.equal(unlockSkill(state, 'sk_infra_3').success, false);

  // Unlock prerequisites down to Tier 5 across all 3 paths
  for (const id of [
    'sk_root_0',
    'sk_root_l',
    'sk_trunk_1',
    'sk_trunk_2',
    'sk_infra_1',
    'sk_infra_2',
    'sk_speed_1',
    'sk_auto_1',
    'sk_auto_2',
  ]) {
    state = unlockSkill(state, id).newState;
  }
  assert.equal(state.skillPoints, 0);

  // Buy Path A [61] -> blocks Path B [62] and Path C [63] until [111] sk_multi_path!
  const pathA = unlockSkill(state, 'sk_infra_3');
  assert.equal(pathA.success, true);
  state = pathA.newState;

  const studyB = state.skills.find((s) => s.id === 'sk_double_track')!;
  const studyC = state.skills.find((s) => s.id === 'sk_auto_3')!;
  assert.equal(isSkillBlockedByExclusivePath(state, studyB), true);
  assert.equal(isSkillBlockedByExclusivePath(state, studyC), true);
  assert.equal(unlockSkill(state, 'sk_double_track').success, false);
  assert.equal(unlockSkill(state, 'sk_auto_3').success, false);

  // Finish Path A through [71] -> [74] -> [81] -> [84] -> [91] -> [101], then unlock convergence [111]!
  for (const id of [
    'sk_infra_4',
    'sk_infra_cost2',
    'sk_infra_5',
    'sk_interchange_grid',
    'sk_infra_regional',
    'sk_infra_6',
    'sk_multi_path',
  ]) {
    const r = unlockSkill(state, id);
    assert.equal(r.success, true, `Expected unlock of ${id} to succeed`);
    state = r.newState;
  }

  // Convergence [111] lifts exclusive restriction -> Path B [62] and Path C [63] now unlock!
  assert.equal(isSkillBlockedByExclusivePath(state, studyB), false);
  assert.equal(unlockSkill(state, 'sk_double_track').success, true);
  const pathCRes = unlockSkill(state, 'sk_auto_3');
  assert.equal(pathCRes.success, true);
  state = pathCRes.newState;

  // Buy Max buys multiple levels at once
  const capBeforeMax = state.capital;
  const maxRes = buyMaxSkill(state, 'sk_root_0');
  assert.equal(maxRes.success, true);
  assert.ok(maxRes.levelsBought >= 5);
  assert.ok(maxRes.newState.capital < capBeforeMax);
  state = maxRes.newState;

  // Buy All spends affordable studies cleanly
  const allRes = buyAllAffordableSkills({ ...state, capital: 5e11 });
  assert.equal(allRes.success, true);
  assert.ok(allRes.levelsBought > 0);
  const investedState = allRes.newState;

  // Reset refunds 100% of invested money and sets all studies back to Lv.0
  const capBeforeReset = investedState.capital;
  const resetRes = resetSkillTree(investedState);
  assert.equal(resetRes.success, true);
  assert.ok(resetRes.refundedMoney > 0);
  assert.equal(resetRes.newState.capital, capBeforeReset + resetRes.refundedMoney);
  assert.ok(resetRes.newState.skills.every((s) => s.level === 0));
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

  const directRes = connectOsmNodesDirect(edgeRes.newState, 'n2', 'n3');
  assert.equal(directRes.success, true);
  assert.equal(directRes.newState.stats.totalOsmEdgesBuilt, 2);
  assert.equal(directRes.newState.stats.connectedOsmNodes, 3);

  const isolatedRes = connectOsmNodesDirect(directRes.newState, 'n3', 'n_far');
  assert.equal(isolatedRes.success, false);
});

test('findOsmRoadPath previews multi-hop road chains and promotes mixed road/rail transfer nodes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 10000 };

  const { nodes, edges } = makeSampleOsmGrid('을지로', 'road');
  state = mergeOsmChunk(state, '37.5667_126.9767', nodes, edges);

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

test('advanceTick earns idle money and auto-builder constructs strictly OSM node edges', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 80000 };

  const { nodes, edges } = makeSampleOsmGrid('남대문로', 'road');
  const withGrid = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  const linked1 = connectOsmPath(withGrid, 'n1', 'n2').newState;
  const r0 = unlockSkill(linked1, 'sk_root_0').newState;
  const t2 = unlockSkill(r0, 'sk_trunk_2').newState;
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
  assert.equal(s.stats.totalSegmentsBuilt, 0);
});

test('dispatchClickBonus grants immediate cash and increments clicks', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);
  const res = dispatchClickBonus(state);

  assert.ok(res.earned >= 25);
  assert.equal(res.newState.capital, state.capital + res.earned);
  assert.equal(res.newState.stats.totalClicks, 1);
});

test('scopeGameStateToStartingCity strips legacy milestones, upgrades, SP, prestigeCount, and foreign cities', () => {
  const tokyo = PRESET_CITIES.find((c) => c.id === 'tokyo')!;
  const tokyoState = createInitialGameState(tokyo);

  assert.ok(tokyoState.nodes.length > 0 && tokyoState.nodes.every((n) => n.cityId === 'tokyo'));
  assert.equal(tokyoState.lines.length, 0);
  assert.equal(tokyoState.upgrades.length, 0);
  assert.equal(tokyoState.skillPoints, 0);
  assert.equal(
    tokyoState.achievements.some(
      (a) =>
        (a.category as string) === 'landmark' ||
        (a.targetType as string) === 'line_complete' ||
        (a.targetType as string) === 'town_complete'
    ),
    false
  );

  // Legacy dirty save migration
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const legacyDirty = createInitialGameState(seoul);
  legacyDirty.skillPoints = 42;
  legacyDirty.prestigeMultiplier = 9.5;
  legacyDirty.stats.prestigeCount = 3;
  legacyDirty.achievements = ([
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
  ] as unknown) as typeof legacyDirty.achievements;

  const cleaned = scopeGameStateToStartingCity(legacyDirty);
  assert.equal(cleaned.skillPoints, 0);
  assert.equal(cleaned.prestigeMultiplier, 1);
  assert.equal(cleaned.stats.prestigeCount, 0);
  assert.equal(cleaned.lines.length, 0);
  assert.equal(cleaned.upgrades.length, 0);
  assert.equal(cleaned.achievements.some((a) => a.targetId === 'line_us_transcon'), false);
  assert.equal(cleaned.achievements.some((a) => a.targetId === 'tokyo'), false);
});

test('ensureSeedConnectedOsmNodes skips tiny disconnected islands and picks healthy main network', () => {
  const london = PRESET_CITIES.find((c) => c.id === 'london')!;

  const tinyNodes = [
    { id: 'tiny_1', lat: london.lat, lng: london.lng, connected: false, mode: 'road' as const },
    { id: 'tiny_2', lat: london.lat + 0.0001, lng: london.lng, connected: false, mode: 'road' as const },
  ];
  const tinyEdges = [
    {
      id: 'tiny_e1',
      wayName: 'Isolated Alley',
      highwayType: 'residential',
      mode: 'road' as const,
      fromNodeId: 'tiny_1',
      toNodeId: 'tiny_2',
      coordinates: [[london.lat, london.lng], [london.lat + 0.0001, london.lng]] as [[number, number], [number, number]],
      distanceKm: 0.011,
      buildCost: 20,
      baseIncomePerSec: 2,
      built: false,
    },
  ];

  const mainNodes = Array.from({ length: 10 }, (_, idx) => ({
    id: `main_${idx}`,
    lat: london.lat + 0.002 + idx * 0.0002,
    lng: london.lng + 0.002,
    connected: false,
    mode: 'road' as const,
  }));
  const mainEdges = Array.from({ length: 9 }, (_, idx) => ({
    id: `main_e${idx}`,
    wayName: 'Strand',
    highwayType: 'primary',
    mode: 'road' as const,
    fromNodeId: `main_${idx}`,
    toNodeId: `main_${idx + 1}`,
    coordinates: [
      [mainNodes[idx].lat, mainNodes[idx].lng],
      [mainNodes[idx + 1].lat, mainNodes[idx + 1].lng],
    ] as [[number, number], [number, number]],
    distanceKm: 0.022,
    buildCost: 30,
    baseIncomePerSec: 3,
    built: false,
  }));

  const seeded = ensureSeedConnectedOsmNodes(
    [...tinyNodes, ...mainNodes],
    [...tinyEdges, ...mainEdges],
    london
  );

  const connectedIds = seeded.filter((n) => n.connected).map((n) => n.id);
  assert.equal(connectedIds.length, 1);
  assert.ok(connectedIds[0].startsWith('main_'));
});

test('mergeOsmChunk does not mark empty chunkKey as loaded so failed fetches can retry', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = createInitialGameState(seoul);

  const afterEmpty = mergeOsmChunk(state, 'chunk_empty_retry', [], []);
  assert.equal(afterEmpty.loadedOsmChunks.includes('chunk_empty_retry'), false);
  assert.equal(afterEmpty.osmNodes.length, 0);

  const { nodes, edges } = makeSampleOsmGrid();
  const afterValid = mergeOsmChunk(afterEmpty, 'chunk_empty_retry', nodes, edges);
  assert.equal(afterValid.loadedOsmChunks.includes('chunk_empty_retry'), true);
  assert.equal(afterValid.osmNodes.length, nodes.length);
  assert.ok(afterValid.osmNodes.some((n) => n.connected));
});

test('Rule 0: dead-end and completed isolated routes bridge to nearby routes within 400m without breaking 2-lane isolation', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const nodes = [
    { id: 'a1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const },
    { id: 'a2', lat: 37.5662, lng: 126.9780, connected: true, mode: 'road' as const },
    { id: 'b1', lat: 37.5662, lng: 126.9804, connected: false, mode: 'road' as const },
    { id: 'b2', lat: 37.5698, lng: 126.9804, connected: false, mode: 'road' as const },
    { id: 'c1', lat: 37.5662, lng: 126.9845, connected: false, mode: 'road' as const },
    { id: 'c2', lat: 37.5665, lng: 126.9845, connected: false, mode: 'road' as const },
  ];
  const edges = [
    {
      id: 'ea12',
      wayName: '고립 골목길',
      highwayType: 'residential',
      mode: 'road' as const,
      fromNodeId: 'a1',
      toNodeId: 'a2',
      coordinates: [[37.5660, 126.9780], [37.5662, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.022,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: true,
    },
    {
      id: 'eb12',
      wayName: '을지로 지선',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'b1',
      toNodeId: 'b2',
      coordinates: [[37.5662, 126.9804], [37.5698, 126.9804]] as [[number, number], [number, number]],
      distanceKm: 0.4,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
    {
      id: 'ec12',
      wayName: '원거리 도로',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'c1',
      toNodeId: 'c2',
      coordinates: [[37.5662, 126.9845], [37.5665, 126.9845]] as [[number, number], [number, number]],
      distanceKm: 0.033,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
  ];

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  assert.equal(ISOLATED_ROUTE_BRIDGE_MAX_KM, 0.4);

  const frontier = computeOsmFrontierDistancesForState(state);
  assert.equal(frontier.get('b1'), 1);
  assert.equal(frontier.get('b2'), 2);
  assert.equal(frontier.get('c1'), undefined);

  const reachable = getReachableOsmNodeSet(state, 'a2');
  assert.equal(reachable.has('b1'), true);
  assert.equal(reachable.has('c1'), false);

  const bridged = connectOsmPath(state, 'a2', 'b1');
  assert.equal(bridged.success, true);
  assert.equal(bridged.newState.osmNodes.find((n) => n.id === 'b1')?.connected, true);

  assert.equal(connectOsmPath(state, 'a2', 'c1').success, false);
});

test('Province-level regional locking, exponential money unlock, GeoJSON border bridge, mainland corridor -> Jeju isolated seed selection', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  const unlockedInit = state.provincialRegions.filter((r) => r.unlocked);
  assert.equal(unlockedInit.length, 1);
  const startRegion = unlockedInit[0];
  assert.equal(startRegion.regionId, 'curated_kr_seoul');

  // Minimum regional unit is province/state (도·주)
  const gyeonggi = state.provincialRegions.find((r) => r.regionId === 'curated_kr_gyeonggi')!;
  const jeju = state.provincialRegions.find((r) => r.regionId === 'curated_kr_jeju')!;
  assert.ok(gyeonggi && gyeonggi.unlocked === false && gyeonggi.isIsolated === false);
  assert.ok(jeju && jeju.unlocked === false && jeju.isIsolated === true);

  const gyeonggiCostBefore = getRegionUnlockCost(state, gyeonggi);
  const jejuCostBefore = getRegionUnlockCost(state, jeju);
  assert.ok(gyeonggiCostBefore < jejuCostBefore, 'Adjacent province should cost less than distant island province');

  assert.equal(unlockProvincialRegion(state, gyeonggi.regionId).success, false);

  // Merge border node inside Seoul's real polygon + node inside locked Gyeonggi
  state = { ...state, capital: 500_000 };
  state = mergeOsmChunk(
    state,
    '37.700_127.050',
    [
      { id: 'seoul_tip', lat: 37.6990, lng: 127.0500, connected: true, mode: 'road', regionId: startRegion.regionId },
      { id: 'gyeonggi_locked', lat: 37.7025, lng: 127.0500, connected: false, mode: 'road', regionId: gyeonggi.regionId },
    ],
    []
  );
  assert.equal(connectOsmPath(state, 'seoul_tip', 'gyeonggi_locked').success, false);

  // Unlock adjacent province Gyeonggi -> cross-border connection allowed & cost increases exponentially
  const gyeonggiUnlock = unlockProvincialRegion(state, gyeonggi.regionId, {
    chunkKey: 'prov_gyeonggi',
    osmNodes: [
      { id: 'gyeonggi_border', lat: 37.7025, lng: 127.0500, connected: false, mode: 'road', regionId: gyeonggi.regionId },
      { id: 'gyeonggi_next', lat: 37.7040, lng: 127.0500, connected: false, mode: 'road', regionId: gyeonggi.regionId },
    ],
    osmEdges: [
      {
        id: 'e_gyeonggi_1',
        wayName: '평화로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'gyeonggi_border',
        toNodeId: 'gyeonggi_next',
        coordinates: [[37.7025, 127.0500], [37.7040, 127.0500]],
        distanceKm: 0.16,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: gyeonggi.regionId,
      },
    ],
  });
  assert.equal(gyeonggiUnlock.success, true);
  assert.equal(gyeonggiUnlock.isIsolated, false);
  assert.equal(gyeonggiUnlock.newState.capital, 500_000 - gyeonggiCostBefore);

  assert.ok(getRegionUnlockCost(gyeonggiUnlock.newState, jeju) > jejuCostBefore);

  const bridgedBorder = connectOsmPath(gyeonggiUnlock.newState, 'seoul_tip', 'gyeonggi_border');
  assert.equal(bridgedBorder.success, true);
  assert.equal(bridgedBorder.newState.osmNodes.find((n) => n.id === 'gyeonggi_border')?.connected, true);

  // Non-adjacent Jeju cannot be unlocked directly from Seoul/Gyeonggi
  assert.equal(unlockProvincialRegion(bridgedBorder.newState, jeju.regionId).success, false);

  // Step through province-level mainland corridor to Jeonnam, then unlock Jeju
  let stepState = { ...bridgedBorder.newState, capital: 500_000_000_000 };
  const provinceCorridor = [
    'curated_kr_chungnam',
    'curated_kr_jeonbuk',
    'curated_kr_jeonnam',
  ];
  for (const rid of provinceCorridor) {
    const stepRes = unlockProvincialRegion(stepState, rid);
    assert.equal(stepRes.success, true, `Must unlock contiguous province corridor ${rid}: ${stepRes.reason || ''}`);
    stepState = stepRes.newState;
  }

  const jejuUnlock = unlockProvincialRegion(stepState, jeju.regionId, {
    chunkKey: 'prov_jeju',
    osmNodes: [
      { id: 'jeju_1', lat: 33.4996, lng: 126.5312, connected: false, mode: 'road', regionId: jeju.regionId },
      { id: 'jeju_2', lat: 33.5010, lng: 126.5312, connected: false, mode: 'road', regionId: jeju.regionId },
    ],
    osmEdges: [
      {
        id: 'e_jeju_1',
        wayName: '중앙로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'jeju_1',
        toNodeId: 'jeju_2',
        coordinates: [[33.4996, 126.5312], [33.5010, 126.5312]],
        distanceKm: 0.15,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: jeju.regionId,
      },
    ],
  });
  assert.equal(jejuUnlock.success, true);
  assert.equal(jejuUnlock.isIsolated, true);
  assert.ok(jejuUnlock.newState.pendingSeedRegionIds.includes(jeju.regionId));

  const seededJeju = selectIsolatedRegionSeed(jejuUnlock.newState, 'jeju_1');
  assert.equal(seededJeju.success, true);
  assert.equal(seededJeju.newState.osmNodes.find((n) => n.id === 'jeju_1')?.connected, true);

  const jejuStep = connectOsmPath(seededJeju.newState, 'jeju_1', 'jeju_2');
  assert.equal(jejuStep.success, true);
  assert.equal(jejuStep.newState.osmNodes.find((n) => n.id === 'jeju_2')?.connected, true);
});

test('Neighbor-only expansion from Jeju (no Tokyo/Paris/NY/Seoul) and GeoJSON polygon coordinate-level locked-region blocking', () => {
  const jejuProv = {
    id: 'custom_jeju_prov',
    name: '제주특별자치도',
    country: '대한민국',
    description: '제주도 거점',
    lat: 33.4996,
    lng: 126.5312,
    zoom: 10,
    isCustom: true,
  };
  let jejuState = createInitialGameState(jejuProv);
  jejuState = { ...jejuState, capital: 500_000 };

  const regionIds = jejuState.provincialRegions.map((r) => r.regionId);
  assert.equal(
    regionIds.some(
      (id) =>
        id.includes('tokyo') ||
        id.includes('paris') ||
        id.includes('curated_us_') ||
        id.includes('london')
    ),
    false
  );

  // Attempting to register Tokyo dynamically from Korea must be rejected
  jejuState = registerDiscoveredProvincialRegion(jejuState, {
    regionId: 'osm_adm_tokyo',
    regionName: '도쿄 특별구',
    adminLevel: '4',
    bbox: [35.52, 139.56, 35.82, 139.92],
    centerLat: 35.6812,
    centerLng: 139.7671,
  });
  assert.equal(jejuState.provincialRegions.some((r) => r.regionId === 'osm_adm_tokyo'), false);

  const expandable = getExpandableProvincialRegions(jejuState);
  const expandableIds = expandable.map((r) => r.regionId);
  assert.ok(expandableIds.includes('curated_kr_jeonnam'), 'Jeonnam must be expandable from Jeju');
  assert.equal(expandableIds.includes('curated_kr_seoul'), false, 'Seoul must NOT be directly expandable from Jeju');

  assert.equal(unlockProvincialRegion(jejuState, 'curated_kr_seoul').success, false);

  // Strict GeoJSON polygon coordinate-level locked-region blocking across Seoul -> Gyeonggi
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let seoulState = { ...createInitialGameState(seoul), capital: 500_000 };
  seoulState = mergeOsmChunk(
    seoulState,
    '37.700_127.050',
    [
      { id: 's_in', lat: 37.6990, lng: 127.0500, connected: true, mode: 'road' },
      { id: 'gyeonggi_out', lat: 37.7080, lng: 127.0500, connected: false, mode: 'road' }, // Inside Gyeonggi, outside Seoul polygon
    ],
    [
      {
        id: 'e_cross',
        wayName: '도봉로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 's_in',
        toNodeId: 'gyeonggi_out',
        coordinates: [[37.6990, 127.0500], [37.7080, 127.0500]],
        distanceKm: 1.0,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
      },
    ],
    'curated_kr_seoul'
  );

  const gyeonggiNode = seoulState.osmNodes.find((n) => n.id === 'gyeonggi_out')!;
  assert.equal(isNodeInUnlockedRegion(seoulState, gyeonggiNode), false);
  assert.equal(connectOsmPath(seoulState, 's_in', 'gyeonggi_out').success, false);

  const gyeonggiUnlocked = unlockProvincialRegion(seoulState, 'curated_kr_gyeonggi');
  assert.equal(gyeonggiUnlocked.success, true);
  assert.equal(isNodeInUnlockedRegion(gyeonggiUnlocked.newState, gyeonggiNode), true);
  assert.equal(connectOsmPath(gyeonggiUnlocked.newState, 's_in', 'gyeonggi_out').success, true);
});

test('Node Tier Rank progresses cleanly from Bronze I -> V -> Silver -> Gold -> Platinum -> Diamond -> Master -> Grandmaster -> Terra Challenger', () => {
  assert.equal(getNodeTierRank(0).label, 'Bronze I');
  assert.equal(getNodeTierRank(100).label, 'Bronze V');
  assert.equal(getNodeTierRank(170).label, 'Silver I');
  assert.equal(getNodeTierRank(1550).label, 'Gold I');
  assert.equal(getNodeTierRank(11000).label, 'Platinum I');
  assert.equal(getNodeTierRank(75000).label, 'Diamond I');
  assert.equal(getNodeTierRank(480000).label, 'Master I');
  assert.equal(getNodeTierRank(2050000).label, 'Master V');
  assert.equal(getNodeTierRank(2850000).label, 'Grandmaster I');
  assert.equal(getNodeTierRank(8600000).label, 'Grandmaster V');
  assert.equal(getNodeTierRank(10000000).label, 'Terra Challenger');
});

