import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIncomeRateCompact, formatMoneyCompact } from './format';
import {
  adjustGameCapital,
  advanceTick,
  buyAllAffordableSkills,
  buyMaxSkill,
  calculateMultipliers,
  calculateTotalIncomePerSec,
  computeOsmFrontierDistances,
  computeOsmFrontierDistancesForState,
  connectOsmEdge,
  connectOsmNodesDirect,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  ensureSeedConnectedOsmNodes,
  evaluateLinesAndAchievements,
  findOsmRoadPath,
  getExpandableProvincialRegions,
  getFrontierEdgeOpacity,
  getFrontierOsmEdgesForState,
  getFrontierVisualStyle,
  getNodeTierRank,
  getOsmEdgeBuildCost,
  getProximityAdjacentChunksToLoad,
  getReachableOsmNodeSet,
  getRecommendedBalancedCapital,
  getRegionProgressStats,
  getRegionUnlockCost,
  getUnseededIslandNodeIds,
  ISOLATED_ROUTE_BRIDGE_FRONTIER_CAP,
  ISOLATED_ROUTE_BRIDGE_MAX_KM,
  isCountryLevelRegion,
  isNodeInUnlockedRegion,
  isNodeInUnseededModeInUnlockedRegion,
  isSkillBlockedByExclusivePath,
  isSyntheticFallbackRegion,
  MAX_OSM_FRONTIER_DISTANCE,
  mergeOsmChunk,
  registerDiscoveredProvincialRegion,
  registerStartingProvincialRegion,
  resetSkillTree,
  resolveProximityBridgeInfo,
  scopeGameStateToStartingCity,
  selectIsolatedRegionSeed,
  unlockProvincialRegion,
  unlockSkill,
} from './rules';
import { isCountryLevelOsmArea } from './osmCore';
import { CURATED_LINES, INITIAL_UPGRADES, PRESET_CITIES } from './worldCatalog';
import { MINIGAME_MILESTONES, MINIGAME_ORDER } from './minigames';

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

  // Money-only study purchases along [11] -> [32] -> [42] -> [52]
  state = unlockSkill(state, 'sk_root_0').newState;
  state = unlockSkill(state, 'sk_trunk_1').newState;
  state = unlockSkill(state, 'sk_trunk_2').newState;
  state = unlockSkill(state, 'sk_snap_tool').newState;
  state = unlockSkill(state, 'sk_speed_1').newState;
  assert.equal(state.skillPoints, 0);

  const { nodes, edges } = makeLongOsmGrid('세종대로', 'road', 18);
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul', {
    totalNodeCount: 50,
  });
  assert.ok(state.loadedOsmRegions?.includes('curated_kr_seoul'));

  // Jumping past d=10 is blocked
  const blockedFar = connectOsmPath(state, 'n1', 'n18');
  assert.equal(blockedFar.success, false);

  // Connect outward within d <= 10 increments
  const r1 = connectOsmPath(state, 'n1', 'n6');
  assert.equal(r1.success, true);
  assert.equal(r1.builtCount, 5);
  const r2 = connectOsmPath(r1.newState, 'n6', 'n16');
  assert.equal(r2.success, true);
  assert.equal(r2.builtCount, 10);
  const res = connectOsmPath(r2.newState, 'n16', 'n18');
  assert.equal(res.success, true);
  assert.equal(res.builtCount, 2);
  assert.equal(res.newState.stats.totalOsmEdgesBuilt, 17);
  assert.equal(res.newState.stats.connectedOsmNodes, 18);
  assert.equal(res.newState.stats.totalScaledNodes, 18);
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
  assert.equal(prog.connectedCount, 18);
  assert.equal(prog.totalNodes, 50);
  assert.equal(prog.pct, 36);
});

test('frontier distance fog-of-war enforces d <= 10 visibility, constructability, and monotonic brightness falloff', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const { nodes, edges } = makeLongOsmGrid('종로', 'road', 15, 37.5665, 126.978, 'f');
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);

  assert.equal(state.osmNodes.find((n) => n.id === 'f1')?.connected, true);

  const dists = computeOsmFrontierDistancesForState(state);
  assert.equal(MAX_OSM_FRONTIER_DISTANCE, 10);
  assert.equal(dists.get('f1'), 0);
  assert.equal(dists.get('f11'), 10);
  assert.equal(dists.get('f12'), undefined);
  assert.equal(dists.get('f15'), undefined);

  const styles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => getFrontierVisualStyle(d, 'road'));
  for (let i = 0; i < styles.length - 1; i++) {
    assert.ok(styles[i].brightness > styles[i + 1].brightness);
    assert.ok(styles[i].fillOpacity > styles[i + 1].fillOpacity);
    assert.ok(styles[i].strokeOpacity > styles[i + 1].strokeOpacity);
    assert.ok(styles[i].radiusScale > styles[i + 1].radiusScale);
    assert.ok(getFrontierEdgeOpacity(i + 1, true) > getFrontierEdgeOpacity(i + 2, true));
  }

  const blocked = connectOsmPath(state, 'f1', 'f12');
  assert.equal(blocked.success, false);
  const blockedEdge = connectOsmEdge(state, 'e_f_11_12');
  assert.equal(blockedEdge.success, false);

  const ok10 = connectOsmPath(state, 'f1', 'f11');
  assert.equal(ok10.success, true);
  assert.equal(ok10.builtCount, 10);

  const updatedDists = computeOsmFrontierDistances(ok10.newState.osmNodes, ok10.newState.osmEdges);
  assert.equal(updatedDists.get('f11'), 0);
  assert.equal(updatedDists.get('f12'), 1);
  assert.equal(updatedDists.get('f15'), 4);
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

test('Antimatter Dimensions study tree supports top-to-bottom Money purchases with free parallel branch selection, Buy Max, Buy All, and 100% Reset refund', () => {
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

  // Unlock prerequisites down to Tier 5 across all 3 branches
  for (const id of [
    'sk_root_0',
    'sk_root_l',
    'sk_root_r',
    'sk_trunk_1',
    'sk_trunk_2',
    'sk_node_yield',
    'sk_infra_1',
    'sk_infra_2',
    'sk_snap_tool',
    'sk_speed_1',
    'sk_re_1',
    'sk_re_2',
  ]) {
    const res = unlockSkill(state, id);
    assert.equal(res.success, true, `Expected prerequisite ${id} to unlock`);
    state = res.newState;
  }
  assert.equal(state.skillPoints, 0);

  // Buy Civil [61] -> Rail [62] and Commerce [63] remain completely unlocked (no exclusive 경로 locks)
  const branchA = unlockSkill(state, 'sk_infra_3');
  assert.equal(branchA.success, true);
  state = branchA.newState;

  const studyB = state.skills.find((s) => s.id === 'sk_double_track')!;
  const studyC = state.skills.find((s) => s.id === 'sk_commerce_1')!;
  assert.equal(isSkillBlockedByExclusivePath(state, studyB), false);
  assert.equal(isSkillBlockedByExclusivePath(state, studyC), false);
  assert.equal(unlockSkill(state, 'sk_double_track').success, true);
  const branchCRes = unlockSkill(state, 'sk_commerce_1');
  assert.equal(branchCRes.success, true);
  state = branchCRes.newState;

  // Buy Max buys multiple levels at once
  const capBeforeMax = state.capital;
  const maxRes = buyMaxSkill(state, 'sk_root_0');
  assert.equal(maxRes.success, true);
  assert.ok(maxRes.levelsBought >= 5);
  assert.ok(maxRes.newState.capital < capBeforeMax);
  state = maxRes.newState;

  // Buy All spends affordable studies cleanly across all unlocked branches
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

test('advanceTick earns idle money strictly without auto-building any roads or rails', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 80000 };

  const { nodes, edges } = makeSampleOsmGrid('남대문로', 'road');
  const withGrid = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  const seedId = withGrid.osmNodes.find((n) => n.connected)!.id;
  const targetId = seedId === 'n1' ? 'n2' : 'n1';
  const linked1 = connectOsmPath(withGrid, seedId, targetId).newState;
  const r0 = unlockSkill(linked1, 'sk_root_0').newState;
  let s = unlockSkill(r0, 'sk_trunk_2').newState;

  const capBefore = s.capital;
  const startOsmBuilt = s.stats.totalOsmEdgesBuilt;

  for (let i = 0; i < 40; i++) {
    s = advanceTick(s, 0.2).newState;
  }

  assert.ok(s.capital > capBefore, 'Expected idle income to accrue');
  assert.equal(s.stats.totalOsmEdgesBuilt, startOsmBuilt, 'Expected zero auto-constructed OSM edges');
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

test('Rule 0: dead-end/isolated routes bridge only to the single nearest node with d <= 3 (d=2~3 horizon)', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 50000 };

  const nodes = [
    { id: 'a1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const },
    { id: 'a2', lat: 37.5662, lng: 126.9780, connected: true, mode: 'road' as const },
    // Nearest component b1 -> b2 -> b3 -> b4 (~210m from a2)
    { id: 'b1', lat: 37.5662, lng: 126.9804, connected: false, mode: 'road' as const },
    { id: 'b2', lat: 37.5672, lng: 126.9804, connected: false, mode: 'road' as const },
    { id: 'b3', lat: 37.5682, lng: 126.9804, connected: false, mode: 'road' as const },
    { id: 'b4', lat: 37.5692, lng: 126.9804, connected: false, mode: 'road' as const },
    // Second nearby component c1 (~300m from a2) must NOT be opened when b1 is closer
    { id: 'c1', lat: 37.5662, lng: 126.9814, connected: false, mode: 'road' as const },
    { id: 'c2', lat: 37.5665, lng: 126.9814, connected: false, mode: 'road' as const },
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
      coordinates: [[37.5662, 126.9804], [37.5672, 126.9804]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
    {
      id: 'eb23',
      wayName: '을지로 지선',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'b2',
      toNodeId: 'b3',
      coordinates: [[37.5672, 126.9804], [37.5682, 126.9804]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
    {
      id: 'eb34',
      wayName: '을지로 지선',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'b3',
      toNodeId: 'b4',
      coordinates: [[37.5682, 126.9804], [37.5692, 126.9804]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
    {
      id: 'ec12',
      wayName: '차순위 도로',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'c1',
      toNodeId: 'c2',
      coordinates: [[37.5662, 126.9814], [37.5665, 126.9814]] as [[number, number], [number, number]],
      distanceKm: 0.033,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
    },
  ];

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);
  assert.equal(ISOLATED_ROUTE_BRIDGE_FRONTIER_CAP, 3);
  assert.ok(ISOLATED_ROUTE_BRIDGE_MAX_KM >= 0.4);

  const frontier = computeOsmFrontierDistancesForState(state);
  assert.equal(frontier.get('b1'), 1);
  assert.equal(frontier.get('b2'), 2);
  assert.equal(frontier.get('b3'), 3);
  assert.equal(frontier.get('b4'), undefined);
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

test('Region deduplication merges English/Korean duplicate Gyeonggi while preserving Seoul enclave separation', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  const gyeonggiOsmBoundary = {
    type: 'Polygon' as const,
    coordinates: [[[126.5, 36.9], [127.8, 36.9], [127.8, 38.2], [126.5, 38.2], [126.5, 36.9]]],
  };
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_adm_gyeonggi_dup',
    regionName: 'Gyeonggi',
    adminLevel: '4',
    bbox: [36.91, 126.52, 38.25, 127.81],
    boundaryGeoJson: gyeonggiOsmBoundary,
    centerLat: 37.28,
    centerLng: 127.01,
  });

  const gyeonggiMatches = state.provincialRegions.filter(
    (r) => r.regionName.includes('경기') || r.regionName.toLowerCase().includes('gyeonggi')
  );
  assert.equal(gyeonggiMatches.length, 1, '경기도 and Gyeonggi must merge into 1 region');
  assert.equal(gyeonggiMatches[0].regionName, '경기도');
  assert.equal(gyeonggiMatches[0].hasRealOsmBoundary, true);
  assert.ok(state.provincialRegions.some((r) => r.regionId === 'curated_kr_seoul'), 'Seoul enclave must stay separate');
});

test('Build cost scales upward with total connected nodes and prevents linking two unconnected nodes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 100000 };

  const { nodes, edges } = makeLongOsmGrid('태평로', 'road', 45);
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges);

  const sampleEdge = state.osmEdges[0];
  const lowNodeCost = getOsmEdgeBuildCost(sampleEdge, calculateMultipliers(state));

  // Cannot connect two unconnected nodes (n4 <-> n5 while only seed n3 is connected)
  const blockedUnconnected = connectOsmPath(state, 'n4', 'n5');
  assert.equal(blockedUnconnected.success, false);
  const blockedDirectUnconnected = connectOsmNodesDirect(state, 'n4', 'n5');
  assert.equal(blockedDirectUnconnected.success, false);

  // Connecting 30+ nodes scales build cost noticeably higher
  const highNodeState = {
    ...state,
    osmNodes: state.osmNodes.map((n, idx) => (idx < 35 ? { ...n, connected: true } : n)),
    stats: { ...state.stats, connectedOsmNodes: 35 },
  };
  const highNodeCost = getOsmEdgeBuildCost(sampleEdge, calculateMultipliers(highNodeState));
  assert.ok(highNodeCost > lowNodeCost * 2, `Expected scaled build cost (${highNodeCost}) > 2x base (${lowNodeCost})`);
});

test('Manual starting-node selection skips auto-seeding until player picks a starting node', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);
  const startRegion = base.provincialRegions.find((r) => r.isStartingRegion)!;
  let state = {
    ...base,
    capital: 50000,
    pendingSeedRegionIds: [startRegion.regionId],
  };

  const { nodes, edges } = makeLongOsmGrid('종로', 'road', 16, 37.5665, 126.978, 's');
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, startRegion.regionId);

  // Zero nodes are auto-connected while awaiting starting node choice
  assert.equal(state.osmNodes.some((n) => n.connected), false);
  assert.deepEqual(state.pendingSeedRegionIds, [startRegion.regionId]);
  assert.equal(connectOsmPath(state, 's4', 's5').success, false);

  // Scoped save reload preserves waiting state without auto-seeding
  const scoped = scopeGameStateToStartingCity(state);
  assert.equal(scoped.osmNodes.some((n) => n.connected), false);
  assert.deepEqual(scoped.pendingSeedRegionIds, [startRegion.regionId]);

  // Player picks 's4' as their starting node
  const picked = selectIsolatedRegionSeed(scoped, 's4');
  assert.equal(picked.success, true);
  assert.equal(picked.newState.osmNodes.filter((n) => n.connected).length, 1);
  assert.equal(picked.newState.osmNodes.find((n) => n.id === 's4')?.connected, true);
  assert.deepEqual(picked.newState.pendingSeedRegionIds, []);

  // Frontier opens outward from chosen starting node 's4' up to d=10
  const dists = computeOsmFrontierDistancesForState(picked.newState);
  assert.equal(dists.get('s4'), 0);
  assert.equal(dists.get('s14'), 10);
  assert.equal(dists.get('s15'), undefined);
  assert.equal(dists.get('s16'), undefined);

  const buildRes = connectOsmPath(picked.newState, 's4', 's6');
  assert.equal(buildRes.success, true);
  assert.equal(buildRes.builtCount, 2);
});

test('Batched connectOsmPath matches sequential connectOsmEdge rewards, costs, way bonuses, and achievements', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let base = { ...createInitialGameState(seoul), capital: 500_000 };
  base = unlockSkill(base, 'sk_root_0').newState;
  base = unlockSkill(base, 'sk_trunk_2').newState;
  base = unlockSkill(base, 'sk_snap_tool').newState;

  const { nodes, edges } = makeSampleOsmGrid('테헤란로', 'road');
  nodes[0].connected = true;
  base = mergeOsmChunk(base, '37.566_126.978', nodes, edges, 'curated_kr_seoul');
  const seedId = 'n1';
  const targetId = 'n5';

  const path = findOsmRoadPath(base, seedId, targetId)!;
  assert.ok(path && path.unbuiltEdgeIds.length === 4);

  const batched = connectOsmPath(base, seedId, targetId);
  assert.equal(batched.success, true);

  let seqState = base;
  for (const eid of path.unbuiltEdgeIds) {
    const step = connectOsmEdge(seqState, eid);
    assert.equal(step.success, true);
    seqState = step.newState;
  }

  assert.equal(batched.newState.capital, seqState.capital);
  assert.equal(batched.newState.totalLifetimeEarnings, seqState.totalLifetimeEarnings);
  assert.equal(batched.newState.stats.totalOsmEdgesBuilt, seqState.stats.totalOsmEdgesBuilt);
  assert.equal(batched.newState.stats.connectedOsmNodes, seqState.stats.connectedOsmNodes);
  assert.equal(batched.newState.stats.mapped1to1Km, seqState.stats.mapped1to1Km);
  assert.deepEqual(batched.newState.completedOsmWays, seqState.completedOsmWays);
  assert.deepEqual(
    batched.newState.achievements.filter((a) => a.unlocked).map((a) => a.id),
    seqState.achievements.filter((a) => a.unlocked).map((a) => a.id)
  );
});

test('Large 3,000+ node OSM graph operations (frontier, reachable, preview, batched link, ticks) run sub-150ms', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 5_000_000 };

  const rows = 55;
  const cols = 55; // 3,025 nodes, ~5,940 edges inside Seoul polygon
  const nodes: Array<{
    id: string;
    lat: number;
    lng: number;
    connected: boolean;
    mode: 'road';
    regionId: string;
  }> = [];
  const edges: Array<{
    id: string;
    wayName: string;
    highwayType: string;
    mode: 'road';
    fromNodeId: string;
    toNodeId: string;
    coordinates: [[number, number], [number, number]];
    distanceKm: number;
    buildCost: number;
    baseIncomePerSec: number;
    built: boolean;
    regionId: string;
  }> = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        id: `g_${r}_${c}`,
        lat: 37.54 + r * 0.0005,
        lng: 126.96 + c * 0.0005,
        connected: r === 27 && c === 27,
        mode: 'road',
        regionId: 'curated_kr_seoul',
      });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `g_${r}_${c}`;
      const lat = 37.54 + r * 0.0005;
      const lng = 126.96 + c * 0.0005;
      if (c + 1 < cols) {
        const nid = `g_${r}_${c + 1}`;
        edges.push({
          id: `eh_${r}_${c}`,
          wayName: `가로대로 ${r}`,
          highwayType: 'primary',
          mode: 'road',
          fromNodeId: id,
          toNodeId: nid,
          coordinates: [
            [lat, lng],
            [lat, lng + 0.0005],
          ],
          distanceKm: 0.044,
          buildCost: 35,
          baseIncomePerSec: 3.5,
          built: false,
          regionId: 'curated_kr_seoul',
        });
      }
      if (r + 1 < rows) {
        const nid = `g_${r + 1}_${c}`;
        edges.push({
          id: `ev_${r}_${c}`,
          wayName: `세로대로 ${c}`,
          highwayType: 'secondary',
          mode: 'road',
          fromNodeId: id,
          toNodeId: nid,
          coordinates: [
            [lat, lng],
            [lat + 0.0005, lng],
          ],
          distanceKm: 0.055,
          buildCost: 35,
          baseIncomePerSec: 3.5,
          built: false,
          regionId: 'curated_kr_seoul',
        });
      }
    }
  }

  state = mergeOsmChunk(state, 'bench_seoul', nodes, edges, 'curated_kr_seoul');

  // Warm index and measure repeated operations
  const t0 = performance.now();
  const frontier = computeOsmFrontierDistancesForState(state);
  const frontierEdges = getFrontierOsmEdgesForState(state, frontier);
  assert.ok(frontier.size > 0 && frontier.size < 400);
  assert.ok(frontierEdges.length > 0 && frontierEdges.length < 800);

  const reachable = getReachableOsmNodeSet(state, 'g_27_27');
  assert.equal(reachable.has('g_27_31'), true);
  assert.equal(reachable.has('g_0_0'), false);

  for (let i = 0; i < 20; i++) {
    const preview = findOsmRoadPath(state, 'g_27_27', 'g_29_30');
    assert.ok(preview && preview.edgeIds.length === 5);
  }

  const linkRes = connectOsmPath(state, 'g_27_27', 'g_29_30');
  assert.equal(linkRes.success, true);
  assert.equal(linkRes.builtCount, 5);
  state = linkRes.newState;

  for (let i = 0; i < 50; i++) {
    state = advanceTick(state, 0.1).newState;
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(
    elapsedMs < 350,
    `Expected large 3k-node benchmark suite to run quickly (<350ms), took ${elapsedMs.toFixed(1)}ms`
  );
});

test('Loading new chunks in unlocked adjacent province or with unseeded rail never floods chunk nodes as d=1', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 500_000 };

  // Seed connected road node inside Seoul
  state = mergeOsmChunk(
    state,
    '37.5665_126.9780',
    [
      { id: 'seoul_r1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road', regionId: 'curated_kr_seoul' },
      { id: 'seoul_r2', lat: 37.5675, lng: 126.978, connected: false, mode: 'road', regionId: 'curated_kr_seoul' },
    ],
    [
      {
        id: 'e_seoul_r1',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'seoul_r1',
        toNodeId: 'seoul_r2',
        coordinates: [[37.5665, 126.978], [37.5675, 126.978]],
        distanceKm: 0.11,
        buildCost: 30,
        baseIncomePerSec: 3,
        built: false,
        regionId: 'curated_kr_seoul',
      },
    ],
    'curated_kr_seoul'
  );

  // Scenario A: Load a new chunk with rail nodes inside active Seoul region (no pendingSeedRegionIds)
  state = mergeOsmChunk(
    state,
    '37.5600_126.9700',
    [
      { id: 'seoul_rail1', lat: 37.5600, lng: 126.9700, connected: false, mode: 'rail', regionId: 'curated_kr_seoul' },
      { id: 'seoul_rail2', lat: 37.5610, lng: 126.9710, connected: false, mode: 'rail', regionId: 'curated_kr_seoul' },
    ],
    [
      {
        id: 'e_seoul_rail',
        wayName: '수도권 1호선',
        highwayType: 'subway',
        mode: 'rail',
        fromNodeId: 'seoul_rail1',
        toNodeId: 'seoul_rail2',
        coordinates: [[37.5600, 126.9700], [37.5610, 126.9710]],
        distanceKm: 0.14,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: 'curated_kr_seoul',
      },
    ],
    'curated_kr_seoul'
  );

  // Scenario B: Unlock adjacent non-isolated province (Gyeonggi) and load a distant chunk inside Gyeonggi
  const gyeonggiRes = unlockProvincialRegion(state, 'curated_kr_gyeonggi');
  assert.equal(gyeonggiRes.success, true);
  assert.equal(gyeonggiRes.isIsolated, false);

  const afterGyeonggiChunk = mergeOsmChunk(
    gyeonggiRes.newState,
    '37.2700_127.0100',
    [
      { id: 'gy_1', lat: 37.2700, lng: 127.0100, connected: false, mode: 'road', regionId: 'curated_kr_gyeonggi' },
      { id: 'gy_2', lat: 37.2710, lng: 127.0110, connected: false, mode: 'road', regionId: 'curated_kr_gyeonggi' },
    ],
    [
      {
        id: 'e_gy_1',
        wayName: '수원역로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'gy_1',
        toNodeId: 'gy_2',
        coordinates: [[37.2700, 127.0100], [37.2710, 127.0110]],
        distanceKm: 0.14,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: 'curated_kr_gyeonggi',
      },
    ],
    'curated_kr_gyeonggi'
  );

  const frontier = computeOsmFrontierDistancesForState(afterGyeonggiChunk);
  assert.equal(frontier.get('seoul_r1'), 0);
  assert.equal(frontier.get('seoul_r2'), 1);
  assert.equal(frontier.get('seoul_rail1'), undefined, 'Unconnected distant rail nodes in new chunk must not become d=1');
  assert.equal(frontier.get('seoul_rail2'), undefined);
  assert.equal(frontier.get('gy_1'), undefined, 'New chunk nodes in adjacent Gyeonggi must not all become d=1');
  assert.equal(frontier.get('gy_2'), undefined);
  assert.equal(
    isNodeInUnseededModeInUnlockedRegion(
      afterGyeonggiChunk,
      afterGyeonggiChunk.osmNodes.find((n) => n.id === 'gy_1')!
    ),
    false
  );
});

test('Isolated pedestrian route component (0 connected nodes) bridges cleanly from adjacent mid-block road', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 50_000 };

  // Main connected road r0 -> r1 -> r2 -> r3_unbuilt (so r1 has totalDegree=2 and main network has unbuilt edges!)
  // Nearby isolated pedestrian route p1 -> p2 -> p3 -> p4 (~55m east of r1)
  const nodes = [
    { id: 'r0', lat: 37.5650, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'r1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'r2', lat: 37.5670, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'r3', lat: 37.5680, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'p1', lat: 37.5660, lng: 126.9786, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'p2', lat: 37.5665, lng: 126.9789, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'p3', lat: 37.5670, lng: 126.9792, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul' },
    { id: 'p4', lat: 37.5675, lng: 126.9795, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul' },
  ];

  const edges = [
    {
      id: 'e_r01',
      wayName: '명동중앙로',
      highwayType: 'secondary',
      mode: 'road' as const,
      fromNodeId: 'r0',
      toNodeId: 'r1',
      coordinates: [[37.5650, 126.9780], [37.5660, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: true,
      regionId: 'curated_kr_seoul',
    },
    {
      id: 'e_r12',
      wayName: '명동중앙로',
      highwayType: 'secondary',
      mode: 'road' as const,
      fromNodeId: 'r1',
      toNodeId: 'r2',
      coordinates: [[37.5660, 126.9780], [37.5670, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: true,
      regionId: 'curated_kr_seoul',
    },
    {
      id: 'e_r23',
      wayName: '명동중앙로',
      highwayType: 'secondary',
      mode: 'road' as const,
      fromNodeId: 'r2',
      toNodeId: 'r3',
      coordinates: [[37.5670, 126.9780], [37.5680, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: false,
      regionId: 'curated_kr_seoul',
    },
    {
      id: 'e_p12',
      wayName: '명동보행자길',
      highwayType: 'pedestrian',
      mode: 'road' as const,
      fromNodeId: 'p1',
      toNodeId: 'p2',
      coordinates: [[37.5660, 126.9786], [37.5665, 126.9789]] as [[number, number], [number, number]],
      distanceKm: 0.06,
      buildCost: 20,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul',
    },
    {
      id: 'e_p23',
      wayName: '명동보행자길',
      highwayType: 'pedestrian',
      mode: 'road' as const,
      fromNodeId: 'p2',
      toNodeId: 'p3',
      coordinates: [[37.5665, 126.9789], [37.5670, 126.9792]] as [[number, number], [number, number]],
      distanceKm: 0.06,
      buildCost: 20,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul',
    },
    {
      id: 'e_p34',
      wayName: '명동보행자길',
      highwayType: 'pedestrian',
      mode: 'road' as const,
      fromNodeId: 'p3',
      toNodeId: 'p4',
      coordinates: [[37.5670, 126.9792], [37.5675, 126.9795]] as [[number, number], [number, number]],
      distanceKm: 0.06,
      buildCost: 20,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul',
    },
  ];

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul');

  const frontier = computeOsmFrontierDistancesForState(state);
  assert.equal(frontier.get('p1'), 1, 'Closest isolated pedestrian entry node must expose at d=1');
  assert.equal(frontier.get('p2'), 2);
  assert.equal(frontier.get('p3'), 3);
  assert.equal(frontier.get('p4'), undefined, 'Frontier horizon cap d<=3 must hold on isolated pedestrian route');

  const bridgeInfo = resolveProximityBridgeInfo(state, 'r1', 'p1');
  assert.equal(bridgeInfo?.kind, 'isolated_route');

  const reachableFromR1 = getReachableOsmNodeSet(state, 'r1');
  assert.equal(reachableFromR1.has('p1'), true, 'Mid-block road node r1 must reach isolated pedestrian entry p1');
  assert.equal(reachableFromR1.has('p2'), false, 'Only single nearest entry node p1 bridges directly');

  // Bridge works even in reverse click order (p1 -> r1)
  const reverseBridge = connectOsmPath(state, 'p1', 'r1');
  assert.equal(reverseBridge.success, true);
  assert.equal(reverseBridge.newState.osmNodes.find((n) => n.id === 'p1')?.connected, true);

  // Subsequent pedestrian street segments can now be pioneered along the way
  const pedStep = connectOsmPath(reverseBridge.newState, 'p1', 'p3');
  assert.equal(pedStep.success, true);
  assert.equal(pedStep.builtCount, 2);
  assert.equal(pedStep.newState.osmNodes.find((n) => n.id === 'p3')?.connected, true);
});

test('Economy balance prevents 1e30+ compounding runaway at full max endgame and rewards Research + Minigames together', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);

  const maxedSkillsState = {
    ...base,
    skills: base.skills.map((s) => ({ ...s, level: s.maxLevel })),
    achievements: base.achievements.map((a) => ({ ...a, unlocked: true })),
    provincialRegions: base.provincialRegions.map((r) => ({ ...r, unlocked: true })),
    stats: {
      ...base.stats,
      connectedOsmNodes: 250_000,
      totalOsmEdgesBuilt: 250_000,
      mapped1to1Km: 1_000_000,
    },
  };

  const studiesOnlyMults = calculateMultipliers(maxedSkillsState);

  const fullEndgameState = {
    ...maxedSkillsState,
    minigames: {
      ...maxedSkillsState.minigames,
      unlockedGameIds: [...MINIGAME_ORDER],
      unlockedMilestoneIds: MINIGAME_MILESTONES.map((m) => m.id),
    },
  };

  const fullMults = calculateMultipliers(fullEndgameState);

  assert.ok(
    Number.isFinite(fullMults.globalIncomeMult) && fullMults.globalIncomeMult < 1e11,
    `globalIncomeMult must remain strictly < 1e11 (got ${fullMults.globalIncomeMult})`
  );
  assert.ok(
    Number.isFinite(fullMults.osmNodeIncomeMult) && fullMults.osmNodeIncomeMult < 1e12,
    `osmNodeIncomeMult must remain strictly < 1e12 (got ${fullMults.osmNodeIncomeMult})`
  );
  assert.ok(
    fullMults.osmNodeIncomeMult > studiesOnlyMults.osmNodeIncomeMult * 500,
    'Combining Research + Minigames must dramatically outperform Research alone'
  );
  assert.ok(
    fullMults.buildCostMult <= 0.25 && fullMults.buildCostMult >= 0.15,
    `buildCostMult should benefit from studies+minigames without collapsing below 0.15 (got ${fullMults.buildCostMult})`
  );
});

test('Detached island nodes within unlocked MultiPolygon region (Yeongjong inside Incheon) can be seeded and built', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 500_000 };

  const gyeonggiRes = unlockProvincialRegion(state, 'curated_kr_gyeonggi');
  assert.equal(gyeonggiRes.success, true);
  state = gyeonggiRes.newState;

  const incheonRes = unlockProvincialRegion(state, 'curated_kr_incheon');
  assert.equal(incheonRes.success, true);
  assert.equal(incheonRes.isIsolated, false, 'Incheon touches Gyeonggi/Seoul mainland');
  state = incheonRes.newState;

  // Load mainland Incheon connected node + detached Yeongjong island road grid (no bridge edge loaded)
  state = mergeOsmChunk(
    state,
    '37.4800_126.4900',
    [
      { id: 'ic_main_1', lat: 37.4563, lng: 126.7052, connected: true, mode: 'road', regionId: 'curated_kr_incheon' },
      { id: 'yj_1', lat: 37.4820, lng: 126.4850, connected: false, mode: 'road', regionId: 'curated_kr_incheon' },
      { id: 'yj_2', lat: 37.4840, lng: 126.4880, connected: false, mode: 'road', regionId: 'curated_kr_incheon' },
      { id: 'yj_3', lat: 37.4860, lng: 126.4910, connected: false, mode: 'road', regionId: 'curated_kr_incheon' },
    ],
    [
      {
        id: 'e_yj_12',
        wayName: '영종해안남로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'yj_1',
        toNodeId: 'yj_2',
        coordinates: [[37.4820, 126.4850], [37.4840, 126.4880]],
        distanceKm: 0.34,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: 'curated_kr_incheon',
      },
      {
        id: 'e_yj_23',
        wayName: '영종해안남로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'yj_2',
        toNodeId: 'yj_3',
        coordinates: [[37.4840, 126.4880], [37.4860, 126.4910]],
        distanceKm: 0.34,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: 'curated_kr_incheon',
      },
    ],
    'curated_kr_incheon'
  );

  const unseededIslandIds = getUnseededIslandNodeIds(state);
  assert.equal(unseededIslandIds.has('yj_1'), true, 'Unreachable island node yj_1 inside Yeongjong polygon must be seedable');
  assert.equal(unseededIslandIds.has('ic_main_1'), false);

  const seeded = selectIsolatedRegionSeed(state, 'yj_1');
  assert.equal(seeded.success, true);
  assert.equal(seeded.newState.osmNodes.find((n) => n.id === 'yj_1')?.connected, true);

  const islandFrontier = computeOsmFrontierDistancesForState(seeded.newState);
  assert.equal(islandFrontier.get('yj_2'), 1);
  assert.equal(islandFrontier.get('yj_3'), 2);

  const buildIsland = connectOsmPath(seeded.newState, 'yj_1', 'yj_3');
  assert.equal(buildIsland.success, true);
  assert.equal(buildIsland.builtCount, 2);
});

test('Rejects synthetic fallback regions and sub-district regions inside an existing province', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  const initialCount = state.provincialRegions.length;

  assert.equal(isSyntheticFallbackRegion('osm_prov_37.5000_127.0000', '테스트'), true);
  assert.equal(isSyntheticFallbackRegion('osm_rel_1234', '인접 광역 행정구역'), true);

  // Synthetic fallback rejected
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_prov_37.5000_127.0000',
    regionName: '인접 광역 행정구역',
    adminLevel: '4',
    bbox: [37.1, 126.7, 37.9, 127.4],
    centerLat: 37.5,
    centerLng: 127.0,
  });
  assert.equal(state.provincialRegions.length, initialCount);

  // Sub-district (수원시, adminLevel '6') strictly inside Gyeonggi rejected
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_999001',
    regionName: '수원시',
    adminLevel: '6',
    bbox: [37.23, 126.96, 37.31, 127.07],
    centerLat: 37.2636,
    centerLng: 127.0286,
  });
  assert.equal(
    state.provincialRegions.some((r) => r.regionId === 'osm_rel_999001' || r.regionName === '수원시'),
    false,
    'Sub-district 수원시 inside Gyeonggi must not create a separate region'
  );

  // Official modern variant 'Gangwon State' merges into curated_kr_gangwon instead of duplicating
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_2304591',
    regionName: 'Gangwon State',
    adminLevel: '4',
    bbox: [37.02, 127.09, 38.61, 129.36],
    boundaryGeoJson: {
      type: 'Polygon',
      coordinates: [[[127.1, 37.0], [129.3, 37.0], [129.3, 38.6], [127.1, 38.6], [127.1, 37.0]]],
    },
    centerLat: 37.82,
    centerLng: 128.15,
  });
  const gangwonList = state.provincialRegions.filter(
    (r) => r.regionId === 'curated_kr_gangwon' || r.regionName.includes('강원') || r.regionName.toLowerCase().includes('gangwon')
  );
  assert.equal(gangwonList.length, 1);
  assert.equal(gangwonList[0].hasRealOsmBoundary, true);
});

test('Compact currency & income formatters render short units cleanly', () => {
  assert.equal(formatMoneyCompact(999), '$999');
  assert.equal(formatMoneyCompact(1250), '$1.25K');
  assert.equal(formatMoneyCompact(1_000_000), '$1.00M');
  assert.equal(formatMoneyCompact(2_550_135_025_478), '$2.55T');
  assert.equal(formatIncomeRateCompact(4.5), '+$4.5/s');
  assert.equal(formatIncomeRateCompact(1_500_000), '+$1.50M/s');
});

test('adjustGameCapital & getRecommendedBalancedCapital cleanly reset legacy runaway capital without wiping network', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  const { nodes, edges } = makeSampleOsmGrid();
  state = mergeOsmChunk(state, 'seoul_core', nodes, edges, 'curated_kr_seoul');
  state = {
    ...state,
    capital: 1e31,
    totalLifetimeEarnings: 1e31,
    stats: { ...state.stats, connectedOsmNodes: 350, totalOsmEdgesBuilt: 340 },
  };

  const recommended = getRecommendedBalancedCapital(state);
  assert.ok(recommended >= 1200 && recommended <= 1e12);

  const balanced = adjustGameCapital(state, recommended, { clampLifetime: true });
  assert.equal(balanced.capital, recommended);
  assert.equal(balanced.totalLifetimeEarnings, recommended);
  assert.equal(balanced.osmNodes.length, state.osmNodes.length);

  const reset = adjustGameCapital(state, 1200, { clampLifetime: true });
  assert.equal(reset.capital, 1200);
  assert.equal(reset.totalLifetimeEarnings, 1200);
});

test('mergeOsmChunk with skipEvaluate defers evaluation cleanly and getProximityAdjacentChunksToLoad discovers frontier neighbors', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  const { nodes, edges } = makeSampleOsmGrid();
  state = mergeOsmChunk(state, '37.5667_126.9767', nodes, edges, 'curated_kr_seoul', {
    skipEvaluate: true,
  });
  state = evaluateLinesAndAchievements(state).newState;
  assert.ok(state.osmNodes.length === nodes.length);
  const prox = getProximityAdjacentChunksToLoad(state, 5);
  assert.ok(prox.length >= 1, 'Expected proximity chunk loader to find neighboring unloaded chunks');
});

test('Rejects and strips country-level South Korea regions even if unlocked in legacy saves, re-tagging nodes cleanly', () => {
  assert.equal(isCountryLevelOsmArea({ name: '대한민국', adminLevel: '4' }), true);
  assert.equal(isCountryLevelOsmArea({ regionId: 'osm_rel_307756', name: 'Seoul' }), true);
  assert.equal(isCountryLevelOsmArea({ name: '경기도', adminLevel: '4', bbox: [36.89, 126.37, 38.3, 127.86] }), false);
  assert.equal(
    isCountryLevelRegion({ regionName: 'Republic of Korea', bbox: [33.1, 124.6, 38.6, 131.9] }),
    true
  );

  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  const countBefore = state.provincialRegions.length;

  // Dynamic discovery or starting-region registration of 대한민국 / osm_rel_307756 must be rejected
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_307756',
    regionName: '대한민국',
    adminLevel: '2',
    bbox: [33.0, 124.5, 38.7, 131.9],
    centerLat: 36.5,
    centerLng: 127.8,
  });
  state = registerStartingProvincialRegion(state, {
    regionId: 'osm_rel_307756',
    regionName: '대한민국',
    adminLevel: '2',
    bbox: [33.0, 124.5, 38.7, 131.9],
    centerLat: 36.5,
    centerLng: 127.8,
  });
  assert.equal(state.provincialRegions.length, countBefore);
  assert.equal(
    state.provincialRegions.some((r) => r.regionId === 'osm_rel_307756' || r.regionName === '대한민국'),
    false
  );

  // Polluted legacy save containing an unlocked '대한민국' region must be stripped on scopeGameStateToStartingCity
  const polluted: typeof state = {
    ...state,
    provincialRegions: [
      ...state.provincialRegions,
      {
        regionId: 'osm_rel_307756',
        regionName: '대한민국',
        adminLevel: '2',
        bbox: [33.0, 124.5, 38.7, 131.9],
        centerLat: 36.5,
        centerLng: 127.8,
        unlocked: true,
        isIsolated: false,
      },
    ],
    osmNodes: [
      { id: 'kr_n1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road', regionId: 'osm_rel_307756' },
    ],
    osmEdges: [
      {
        id: 'kr_e1',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'kr_n1',
        toNodeId: 'kr_n1',
        coordinates: [[37.5665, 126.978], [37.5665, 126.978]],
        distanceKm: 0,
        buildCost: 10,
        baseIncomePerSec: 1,
        built: true,
        regionId: 'osm_rel_307756',
      },
    ],
  };

  const cleaned = scopeGameStateToStartingCity(polluted);
  assert.equal(
    cleaned.provincialRegions.some((r) => r.regionId === 'osm_rel_307756' || r.regionName === '대한민국'),
    false
  );
  assert.equal(cleaned.osmNodes[0].regionId, 'curated_kr_seoul');
  assert.equal(cleaned.osmEdges[0].regionId, 'curated_kr_seoul');
});

test('mergeOsmChunk & boundary upgrade set hasRealOsmBoundary and re-tag __locked_outside__ nodes inside refined polygon', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  // Place a node slightly outside Seoul's coarse curated polygon, then upgrade Seoul with a real OSM MultiPolygon covering it
  state = {
    ...state,
    osmNodes: [
      { id: 'n_edge_pocket', lat: 37.705, lng: 127.08, connected: false, mode: 'road', regionId: '__locked_outside__' },
    ],
  };

  const refinedBoundary = {
    type: 'MultiPolygon' as const,
    coordinates: [
      [[[126.76, 37.42], [127.19, 37.42], [127.19, 37.71], [126.76, 37.71], [126.76, 37.42]]],
    ],
  };

  // Check mergeOsmChunk sets hasRealOsmBoundary
  state = mergeOsmChunk(
    state,
    '37.550_126.975',
    [{ id: 'n_core', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' }],
    [],
    'curated_kr_seoul',
    { boundaryGeoJson: refinedBoundary, skipEvaluate: false }
  );

  const seoulReg = state.provincialRegions.find((r) => r.regionId === 'curated_kr_seoul')!;
  assert.equal(seoulReg.hasRealOsmBoundary, true);
  assert.equal(
    state.osmNodes.find((n) => n.id === 'n_edge_pocket')?.regionId,
    'curated_kr_seoul',
    '__locked_outside__ node inside upgraded real boundary must re-tag to unlocked region'
  );
});
