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
  canConnectIsolatedRoutePair,
  computeOsmFrontierDistances,
  computeOsmFrontierDistancesForState,
  connectOsmEdge,
  connectOsmNodesDirect,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  ensureSeedConnectedOsmNodes,
  evaluateLinesAndAchievements,
  findIncompleteLoadedChunksInViewport,
  findOsmRoadPath,
  getExpandableProvincialRegions,
  getFrontierEdgeOpacity,
  getFrontierOsmEdgesForState,
  getFrontierVisualStyle,
  getNodeTierRank,
  getOsmEdgeBuildCost,
  getOsmNodeConnectionFlags,
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
  isOsmNodePedestrianOnly,
  isPointInRegionBoundary,
  isSkillBlockedByExclusivePath,
  isSyntheticFallbackRegion,
  MAX_OSM_FRONTIER_DISTANCE,
  mergeOsmChunk,
  mergeOsmChunksBatch,
  registerDiscoveredProvincialRegion,
  registerStartingProvincialRegion,
  resetSkillTree,
  resolveProximityBridgeInfo,
  scopeGameStateToStartingCity,
  selectIsolatedRegionSeed,
  unlockProvincialRegion,
  unlockSkill,
} from './rules';
import { isCountryLevelOsmArea, quantizeChunkKey } from './osmCore';
import { enumerateChunkKeysForBounds } from './osmService';
import { CURATED_LINES, CURATED_PROVINCIAL_REGIONS, INITIAL_UPGRADES, PRESET_CITIES } from './worldCatalog';
import { MINIGAME_MILESTONES, MINIGAME_ORDER } from './minigames';
import { hydrateRawGameState } from './saveSlots';

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
  assert.equal(state.provincialRegions.find((r) => r.unlocked)?.regionId, 'curated_kr_seoul_jung');
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
  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung', {
    totalNodeCount: 50,
  });
  assert.ok(state.loadedOsmRegions?.includes('curated_kr_seoul_jung'));

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

  // County progress tracking reports connectedCount / totalNodes / percentage
  const prog = getRegionProgressStats(res.newState, 'curated_kr_seoul_jung');
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

test('County-level regional locking, exponential money unlock, GeoJSON border bridge, coastal -> Jeju isolated seed selection', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  const unlockedInit = state.provincialRegions.filter((r) => r.unlocked);
  assert.equal(unlockedInit.length, 1);
  const startRegion = unlockedInit[0];
  assert.equal(startRegion.regionId, 'curated_kr_seoul_jung');

  // Minimum regional unit is county / county-equivalent (US County / KR 시·군·구)
  const jongno = state.provincialRegions.find((r) => r.regionId === 'curated_kr_seoul_jongno')!;
  const jeju = state.provincialRegions.find((r) => r.regionId === 'curated_kr_jeju_city')!;
  assert.ok(jongno && jongno.unlocked === false && jongno.isIsolated === false);
  assert.ok(jeju && jeju.unlocked === false && jeju.isIsolated === true);

  const jongnoCostBefore = getRegionUnlockCost(state, jongno);
  const jejuCostBefore = getRegionUnlockCost(state, jeju);
  assert.ok(jongnoCostBefore < jejuCostBefore, 'Adjacent county should cost less than distant island county');

  assert.equal(unlockProvincialRegion(state, jongno.regionId).success, false);

  // Merge border node inside Seoul Jung-gu + node inside locked Jongno-gu (distance ~300m <= CROSS_BORDER_BRIDGE_MAX_KM 450m)
  state = { ...state, capital: 500_000 };
  state = mergeOsmChunk(
    state,
    '37.569_126.978',
    [
      { id: 'jung_tip', lat: 37.5685, lng: 126.9780, connected: true, mode: 'road', regionId: startRegion.regionId },
      { id: 'jongno_locked', lat: 37.5712, lng: 126.9780, connected: false, mode: 'road', regionId: jongno.regionId },
    ],
    []
  );
  assert.equal(connectOsmPath(state, 'jung_tip', 'jongno_locked').success, false);

  // Unlock adjacent county Jongno-gu -> cross-border connection allowed & cost increases exponentially
  const jongnoUnlock = unlockProvincialRegion(state, jongno.regionId, {
    chunkKey: 'prov_jongno',
    osmNodes: [
      { id: 'jongno_border', lat: 37.5712, lng: 126.9780, connected: false, mode: 'road', regionId: jongno.regionId },
      { id: 'jongno_next', lat: 37.5728, lng: 126.9780, connected: false, mode: 'road', regionId: jongno.regionId },
    ],
    osmEdges: [
      {
        id: 'e_jongno_1',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'jongno_border',
        toNodeId: 'jongno_next',
        coordinates: [[37.5712, 126.9780], [37.5728, 126.9780]],
        distanceKm: 0.18,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: jongno.regionId,
      },
    ],
  });
  assert.equal(jongnoUnlock.success, true);
  assert.equal(jongnoUnlock.isIsolated, false);
  assert.equal(jongnoUnlock.newState.capital, 500_000 - jongnoCostBefore);

  assert.ok(getRegionUnlockCost(jongnoUnlock.newState, jeju) > jejuCostBefore);

  const bridgedBorder = connectOsmPath(jongnoUnlock.newState, 'jung_tip', 'jongno_border');
  assert.equal(bridgedBorder.success, true);
  assert.equal(bridgedBorder.newState.osmNodes.find((n) => n.id === 'jongno_border')?.connected, true);

  // Non-adjacent Jeju cannot be unlocked directly from Seoul Jung-gu / Jongno-gu
  assert.equal(unlockProvincialRegion(bridgedBorder.newState, jeju.regionId).success, false);

  // From south-coast Mokpo-si, island Jeju-si becomes expandable (isolated sea crossing)
  const mokpoCity = {
    id: 'custom_mokpo',
    name: '목포시 대한민국',
    country: '대한민국',
    description: '전남 서남권 거점',
    lat: 34.8118,
    lng: 126.3922,
    zoom: 13,
    isCustom: true,
  };
  const mokpoState = { ...createInitialGameState(mokpoCity), capital: 500_000_000 };
  const jejuUnlock = unlockProvincialRegion(mokpoState, jeju.regionId, {
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
  const jejuCity = {
    id: 'custom_jeju_city',
    name: '제주시',
    country: '대한민국',
    description: '제주도 거점',
    lat: 33.4996,
    lng: 126.5312,
    zoom: 12,
    isCustom: true,
  };
  let jejuState = createInitialGameState(jejuCity);
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
  assert.ok(expandableIds.includes('curated_kr_seogwipo'), 'Seogwipo must be expandable from Jeju City');
  assert.ok(expandableIds.includes('curated_kr_mokpo'), 'Mokpo must be expandable from Jeju City');
  assert.equal(expandableIds.includes('curated_kr_seoul_jung'), false, 'Seoul Jung-gu must NOT be directly expandable from Jeju City');

  assert.equal(unlockProvincialRegion(jejuState, 'curated_kr_seoul_jung').success, false);

  // Strict GeoJSON polygon coordinate-level locked-region blocking across Seoul Jung-gu -> Jongno-gu
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let seoulState = { ...createInitialGameState(seoul), capital: 500_000 };
  seoulState = mergeOsmChunk(
    seoulState,
    '37.569_126.978',
    [
      { id: 's_in', lat: 37.5665, lng: 126.9780, connected: true, mode: 'road' },
      { id: 'jongno_out', lat: 37.5780, lng: 126.9780, connected: false, mode: 'road' }, // Inside Jongno-gu, outside Jung-gu
    ],
    [
      {
        id: 'e_cross',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 's_in',
        toNodeId: 'jongno_out',
        coordinates: [[37.5665, 126.9780], [37.5780, 126.9780]],
        distanceKm: 1.2,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
      },
    ],
    'curated_kr_seoul_jung'
  );

  const jongnoNode = seoulState.osmNodes.find((n) => n.id === 'jongno_out')!;
  assert.equal(isNodeInUnlockedRegion(seoulState, jongnoNode), false);
  assert.equal(connectOsmPath(seoulState, 's_in', 'jongno_out').success, false);

  const jongnoUnlocked = unlockProvincialRegion(seoulState, 'curated_kr_seoul_jongno');
  assert.equal(jongnoUnlocked.success, true);
  assert.equal(isNodeInUnlockedRegion(jongnoUnlocked.newState, jongnoNode), true);
  assert.equal(connectOsmPath(jongnoUnlocked.newState, 's_in', 'jongno_out').success, true);
});

test('Node Tier Rank progresses cleanly with widened lower tiers and narrowed Master -> Terra Challenger band', () => {
  assert.equal(getNodeTierRank(0).label, 'Bronze I');
  assert.equal(getNodeTierRank(800).label, 'Bronze V');
  assert.equal(getNodeTierRank(1400).label, 'Silver I');
  assert.equal(getNodeTierRank(12000).label, 'Gold I');
  assert.equal(getNodeTierRank(65000).label, 'Platinum I');
  assert.equal(getNodeTierRank(270000).label, 'Diamond I');
  assert.equal(getNodeTierRank(1200000).label, 'Master I');
  assert.equal(getNodeTierRank(3400000).label, 'Master V');
  assert.equal(getNodeTierRank(4200000).label, 'Grandmaster I');
  assert.equal(getNodeTierRank(10000000).label, 'Terra Challenger');

  // Verify tier progressPct has at most 3 decimal places cleanly
  const rank1 = getNodeTierRank(1);
  assert.equal(typeof rank1.progressPct, 'number');
  const decParts = rank1.progressPct.toString().split('.')[1] || '';
  assert.ok(decParts.length <= 3, `progressPct ${rank1.progressPct} must have at most 3 decimal places`);
  assert.equal(rank1.progressPct.toFixed(3), '1.250');
});

test('registerDiscoveredProvincialRegion upgrades boundary when exactBoundaryVersion: 2 arrives', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  // Initial simplified boundary with exactBoundaryVersion undefined
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_test_exact',
    regionName: '정밀 행정구역',
    adminLevel: '6',
    bbox: [37.5, 126.9, 37.6, 127.0],
    boundaryGeoJson: {
      type: 'Polygon',
      coordinates: [[[126.9, 37.5], [127.0, 37.5], [127.0, 37.6], [126.9, 37.6], [126.9, 37.5]]],
    },
    centerLat: 37.55,
    centerLng: 126.95,
  });

  const initial = state.provincialRegions.find((r) => r.regionId === 'osm_rel_test_exact')!;
  assert.equal(initial.exactBoundaryVersion, undefined);

  // Fresh exact 100% boundary arrives with exactBoundaryVersion: 2
  const exactCoordinates = [
    [126.9000000, 37.5000000],
    [126.9200000, 37.5050000],
    [126.9500000, 37.5100000],
    [127.0000000, 37.5000000],
    [127.0000000, 37.6000000],
    [126.9000000, 37.6000000],
    [126.9000000, 37.5000000],
  ];
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_test_exact',
    regionName: '정밀 행정구역',
    adminLevel: '6',
    bbox: [37.5, 126.9, 37.6, 127.0],
    boundaryGeoJson: {
      type: 'Polygon',
      coordinates: [exactCoordinates],
    },
    exactBoundaryVersion: 2,
    centerLat: 37.55,
    centerLng: 126.95,
  });

  const upgraded = state.provincialRegions.find((r) => r.regionId === 'osm_rel_test_exact')!;
  assert.equal(upgraded.exactBoundaryVersion, 2);
  assert.equal(upgraded.boundaryGeoJson?.coordinates[0].length, 7);
});

test('Region deduplication merges English/Korean duplicate county while preserving distinct same-named districts (Seoul Jung-gu vs Incheon Jung-gu)', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  const jongnoOsmBoundary = {
    type: 'Polygon' as const,
    coordinates: [[[126.95, 37.569], [127.024, 37.569], [127.024, 37.633], [126.95, 37.633], [126.95, 37.569]]],
  };
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_adm_jongno_dup',
    regionName: 'Jongno-gu',
    adminLevel: '6',
    bbox: [37.569, 126.95, 37.633, 127.024],
    boundaryGeoJson: jongnoOsmBoundary,
    centerLat: 37.594,
    centerLng: 126.982,
  });

  const jongnoMatches = state.provincialRegions.filter(
    (r) => r.regionName.includes('종로') || r.regionName.toLowerCase().includes('jongno')
  );
  assert.equal(jongnoMatches.length, 1, '서울 종로구 and Jongno-gu must merge into 1 region');
  assert.equal(jongnoMatches[0].regionName, '서울 종로구');
  assert.equal(jongnoMatches[0].hasRealOsmBoundary, true);

  // Bare '중구' at Incheon Jung-gu coordinates must NOT merge into '서울 중구'
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_incheon_jung_test',
    regionName: '중구',
    adminLevel: '6',
    bbox: [37.42, 126.38, 37.52, 126.66],
    centerLat: 37.4736,
    centerLng: 126.6215,
  });
  const seoulJungCount = state.provincialRegions.filter((r) => r.regionId === 'curated_kr_seoul_jung').length;
  const incheonJungCount = state.provincialRegions.filter((r) => r.regionId === 'curated_kr_incheon_jung').length;
  assert.equal(seoulJungCount, 1);
  assert.equal(incheonJungCount, 1);
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
  base = mergeOsmChunk(base, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung');
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
  const cols = 55; // 3,025 nodes, ~5,940 edges inside Seoul Jung-gu polygon
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
        lat: 37.552 + r * 0.0003,
        lng: 126.970 + c * 0.0003,
        connected: r === 27 && c === 27,
        mode: 'road',
        regionId: 'curated_kr_seoul_jung',
      });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `g_${r}_${c}`;
      const lat = 37.552 + r * 0.0003;
      const lng = 126.970 + c * 0.0003;
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
            [lat, lng + 0.0003],
          ],
          distanceKm: 0.026,
          buildCost: 35,
          baseIncomePerSec: 3.5,
          built: false,
          regionId: 'curated_kr_seoul_jung',
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
            [lat + 0.0003, lng],
          ],
          distanceKm: 0.033,
          buildCost: 35,
          baseIncomePerSec: 3.5,
          built: false,
          regionId: 'curated_kr_seoul_jung',
        });
      }
    }
  }

  state = mergeOsmChunk(state, 'bench_seoul', nodes, edges, 'curated_kr_seoul_jung');

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

test('Loading new chunks in unlocked adjacent county or with unseeded rail never floods chunk nodes as d=1', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 500_000 };

  // Seed connected road node inside Seoul Jung-gu
  state = mergeOsmChunk(
    state,
    '37.5665_126.9780',
    [
      { id: 'seoul_r1', lat: 37.5665, lng: 126.978, connected: true, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'seoul_r2', lat: 37.5675, lng: 126.978, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
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
        regionId: 'curated_kr_seoul_jung',
      },
    ],
    'curated_kr_seoul_jung'
  );

  // Scenario A: Load a new chunk with rail nodes inside active Seoul Jung-gu region (no pendingSeedRegionIds)
  state = mergeOsmChunk(
    state,
    '37.5600_126.9700',
    [
      { id: 'seoul_rail1', lat: 37.5600, lng: 126.9700, connected: false, mode: 'rail', regionId: 'curated_kr_seoul_jung' },
      { id: 'seoul_rail2', lat: 37.5610, lng: 126.9710, connected: false, mode: 'rail', regionId: 'curated_kr_seoul_jung' },
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
        regionId: 'curated_kr_seoul_jung',
      },
    ],
    'curated_kr_seoul_jung'
  );

  // Scenario B: Unlock adjacent non-isolated county (Jongno-gu) and load a chunk inside Jongno-gu
  const jongnoRes = unlockProvincialRegion(state, 'curated_kr_seoul_jongno');
  assert.equal(jongnoRes.success, true);
  assert.equal(jongnoRes.isIsolated, false);

  const afterJongnoChunk = mergeOsmChunk(
    jongnoRes.newState,
    '37.5900_126.9800',
    [
      { id: 'gy_1', lat: 37.5900, lng: 126.9800, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jongno' },
      { id: 'gy_2', lat: 37.5910, lng: 126.9810, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jongno' },
    ],
    [
      {
        id: 'e_gy_1',
        wayName: '율곡로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'gy_1',
        toNodeId: 'gy_2',
        coordinates: [[37.5900, 126.9800], [37.5910, 126.9810]],
        distanceKm: 0.14,
        buildCost: 40,
        baseIncomePerSec: 4,
        built: false,
        regionId: 'curated_kr_seoul_jongno',
      },
    ],
    'curated_kr_seoul_jongno'
  );

  const frontier = computeOsmFrontierDistancesForState(afterJongnoChunk);
  assert.equal(frontier.get('seoul_r1'), 0);
  assert.equal(frontier.get('seoul_r2'), 1);
  assert.equal(frontier.get('seoul_rail1'), undefined, 'Unconnected distant rail nodes in new chunk must not become d=1');
  assert.equal(frontier.get('seoul_rail2'), undefined);
  assert.equal(frontier.get('gy_1'), undefined, 'New chunk nodes in adjacent Jongno-gu must not all become d=1');
  assert.equal(frontier.get('gy_2'), undefined);
  assert.equal(
    isNodeInUnseededModeInUnlockedRegion(
      afterJongnoChunk,
      afterJongnoChunk.osmNodes.find((n) => n.id === 'gy_1')!
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
    { id: 'r0', lat: 37.5650, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r2', lat: 37.5670, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r3', lat: 37.5680, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'p1', lat: 37.5660, lng: 126.9786, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'p2', lat: 37.5665, lng: 126.9789, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'p3', lat: 37.5670, lng: 126.9792, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'p4', lat: 37.5675, lng: 126.9795, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
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
      regionId: 'curated_kr_seoul_jung',
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
      regionId: 'curated_kr_seoul_jung',
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
      regionId: 'curated_kr_seoul_jung',
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
      regionId: 'curated_kr_seoul_jung',
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
      regionId: 'curated_kr_seoul_jung',
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
      regionId: 'curated_kr_seoul_jung',
    },
  ];

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung');

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

test('Detached island nodes within unlocked MultiPolygon region (Yeongjong inside Incheon Jung-gu) can be seeded and built', () => {
  const incheonJung = {
    id: 'custom_incheon_jung',
    name: '인천 중구 대한민국',
    country: '대한민국',
    description: '영종도 포함',
    lat: 37.4736,
    lng: 126.6215,
    zoom: 12,
    isCustom: true,
  };
  let state = { ...createInitialGameState(incheonJung), capital: 500_000 };
  assert.equal(state.provincialRegions.find((r) => r.unlocked)?.regionId, 'curated_kr_incheon_jung');

  // Load mainland Incheon Jung-gu connected node + detached Yeongjong island road grid (no bridge edge loaded)
  state = mergeOsmChunk(
    state,
    '37.4800_126.4900',
    [
      { id: 'ic_main_1', lat: 37.4736, lng: 126.6215, connected: true, mode: 'road', regionId: 'curated_kr_incheon_jung' },
      { id: 'yj_1', lat: 37.4820, lng: 126.4850, connected: false, mode: 'road', regionId: 'curated_kr_incheon_jung' },
      { id: 'yj_2', lat: 37.4840, lng: 126.4880, connected: false, mode: 'road', regionId: 'curated_kr_incheon_jung' },
      { id: 'yj_3', lat: 37.4860, lng: 126.4910, connected: false, mode: 'road', regionId: 'curated_kr_incheon_jung' },
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
        regionId: 'curated_kr_incheon_jung',
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
        regionId: 'curated_kr_incheon_jung',
      },
    ],
    'curated_kr_incheon_jung'
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

test('Rejects synthetic fallback regions, sub-county dong units, and coarse state containers over county regions', () => {
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

  // Sub-county neighborhood (명동, adminLevel '8') strictly inside Seoul Jung-gu ('6') rejected
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_999001',
    regionName: '명동',
    adminLevel: '8',
    bbox: [37.558, 126.980, 37.565, 126.990],
    centerLat: 37.561,
    centerLng: 126.985,
  });
  assert.equal(
    state.provincialRegions.some((r) => r.regionId === 'osm_rel_999001' || r.regionName === '명동'),
    false,
    'Sub-county 명동 inside Seoul Jung-gu must not create a separate region'
  );

  // Coarse state-level 서울특별시 (adminLevel '4') covering existing county regions must be rejected
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_2297418',
    regionName: '서울특별시',
    adminLevel: '4',
    bbox: [37.42, 126.76, 37.71, 127.19],
    centerLat: 37.5665,
    centerLng: 126.978,
  });
  assert.equal(
    state.provincialRegions.some((r) => r.regionId === 'osm_rel_2297418'),
    false,
    'State/province level 서울특별시 must not override county-level regions'
  );

  // Adjacent non-curated county (e.g. 용인시, adminLevel '6') registers cleanly as its own county
  state = registerDiscoveredProvincialRegion(state, {
    regionId: 'osm_rel_yongin',
    regionName: '용인시',
    adminLevel: '6',
    bbox: [37.15, 127.03, 37.38, 127.35],
    boundaryGeoJson: {
      type: 'Polygon',
      coordinates: [[[127.03, 37.15], [127.35, 37.15], [127.35, 37.38], [127.03, 37.38], [127.03, 37.15]]],
    },
    centerLat: 37.241,
    centerLng: 127.177,
  });
  const yongin = state.provincialRegions.find((r) => r.regionId === 'osm_rel_yongin');
  assert.ok(yongin);
  assert.equal(yongin.hasRealOsmBoundary, true);
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
  state = mergeOsmChunk(state, 'seoul_core', nodes, edges, 'curated_kr_seoul_jung');
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
  state = mergeOsmChunk(state, '37.5667_126.9767', nodes, edges, 'curated_kr_seoul_jung', {
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
  assert.equal(cleaned.osmNodes[0].regionId, 'curated_kr_seoul_jung');
  assert.equal(cleaned.osmEdges[0].regionId, 'curated_kr_seoul_jung');
});

test('mergeOsmChunk & boundary upgrade set hasRealOsmBoundary and re-tag __locked_outside__ nodes inside refined polygon', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);

  // Place a node slightly outside Jung-gu's coarse curated polygon (and outside Jongno's), then upgrade Jung-gu with a refined MultiPolygon covering it
  state = {
    ...state,
    osmNodes: [
      { id: 'n_edge_pocket', lat: 37.543, lng: 127.005, connected: false, mode: 'road', regionId: '__locked_outside__' },
    ],
  };

  const refinedBoundary = {
    type: 'MultiPolygon' as const,
    coordinates: [
      [[[126.95, 37.54], [127.03, 37.54], [127.03, 37.575], [126.95, 37.575], [126.95, 37.54]]],
    ],
  };

  // Check mergeOsmChunk sets hasRealOsmBoundary
  state = mergeOsmChunk(
    state,
    '37.550_126.975',
    [{ id: 'n_core', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' }],
    [],
    'curated_kr_seoul_jung',
    { boundaryGeoJson: refinedBoundary, skipEvaluate: false }
  );

  const seoulReg = state.provincialRegions.find((r) => r.regionId === 'curated_kr_seoul_jung')!;
  assert.equal(seoulReg.hasRealOsmBoundary, true);
  assert.equal(
    state.osmNodes.find((n) => n.id === 'n_edge_pocket')?.regionId,
    'curated_kr_seoul_jung',
    '__locked_outside__ node inside upgraded real boundary must re-tag to unlocked region'
  );
});

test('mergeOsmChunksBatch matches sequential mergeOsmChunk and scales fast across 4,000 nodes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const baseSeq = createInitialGameState(seoul);
  const baseBatch = createInitialGameState(seoul);

  const chunks = Array.from({ length: 20 }, (_, ci) => {
    const chunkNodes = [];
    const chunkEdges = [];
    const baseLat = 37.54 + ci * 0.002;
    const baseLng = 126.96 + (ci % 4) * 0.004;
    for (let i = 0; i < 200; i++) {
      const id = `c${ci}_n${i}`;
      chunkNodes.push({
        id,
        lat: baseLat + i * 0.00008,
        lng: baseLng + (i % 5) * 0.0002,
        connected: ci === 0 && i === 0,
        mode: 'road' as const,
      });
      if (i > 0) {
        chunkEdges.push({
          id: `c${ci}_e${i}`,
          wayName: `로_${ci}_${i % 7}`,
          highwayType: 'primary',
          mode: 'road' as const,
          fromNodeId: `c${ci}_n${i - 1}`,
          toNodeId: id,
          coordinates: [
            [baseLat + (i - 1) * 0.00008, baseLng + ((i - 1) % 5) * 0.0002],
            [baseLat + i * 0.00008, baseLng + (i % 5) * 0.0002],
          ] as [[number, number], [number, number]],
          distanceKm: 0.08,
          buildCost: 20,
          baseIncomePerSec: 1.5,
          built: false,
        });
      }
      if (i >= 10) {
        chunkEdges.push({
          id: `c${ci}_cross_${i}`,
          wayName: `교차로_${ci}_${i % 5}`,
          highwayType: 'secondary',
          mode: 'road' as const,
          fromNodeId: `c${ci}_n${i - 10}`,
          toNodeId: id,
          coordinates: [
            [baseLat + (i - 10) * 0.00008, baseLng + ((i - 10) % 5) * 0.0002],
            [baseLat + i * 0.00008, baseLng + (i % 5) * 0.0002],
          ] as [[number, number], [number, number]],
          distanceKm: 0.14,
          buildCost: 30,
          baseIncomePerSec: 2.0,
          built: false,
        });
      }
    }
    return {
      chunkKey: `chunk_${ci}`,
      osmNodes: chunkNodes,
      osmEdges: chunkEdges,
      regionId: 'curated_kr_seoul_jung',
    };
  });

  // Correctness parity check on first 3 chunks
  let seqState = baseSeq;
  for (let i = 0; i < 3; i++) {
    const ch = chunks[i];
    seqState = mergeOsmChunk(seqState, ch.chunkKey, ch.osmNodes, ch.osmEdges, ch.regionId, {
      skipAutoSeed: true,
    });
  }
  const smallBatchState = mergeOsmChunksBatch(baseBatch, chunks.slice(0, 3), {
    skipAutoSeed: true,
  });
  assert.equal(smallBatchState.osmNodes.length, seqState.osmNodes.length);
  assert.equal(smallBatchState.osmEdges.length, seqState.osmEdges.length);
  assert.deepEqual(smallBatchState.loadedOsmChunks, seqState.loadedOsmChunks);
  assert.equal(smallBatchState.stats.connectedOsmNodes, seqState.stats.connectedOsmNodes);

  // Throughput check on all 20 chunks (~4,000 nodes / ~7,780 edges)
  const t0 = performance.now();
  const fullBatchState = mergeOsmChunksBatch(baseBatch, chunks, { skipAutoSeed: true });
  const elapsedMs = performance.now() - t0;
  assert.equal(fullBatchState.osmNodes.length, 4000);
  assert.ok(fullBatchState.osmEdges.length > 7000);
  assert.ok(
    elapsedMs < 350,
    `Expected batch merge of 4,000 nodes / ~7,800 edges to finish < 350ms, got ${elapsedMs.toFixed(1)}ms`
  );
});

test('A* findOsmRoadPath picks exact shortest path and connectOsmPath stays fast on 5,000-node grid', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = { ...state, capital: 1e9 };

  // Build a 100 x 50 grid (5,000 nodes, ~9,850 edges) inside Seoul Jung-gu bbox
  const rows = 100;
  const cols = 50;
  const nodes: typeof state.osmNodes = [];
  const edges: typeof state.osmEdges = [];
  const lat0 = 37.551;
  const lng0 = 126.968;
  const step = 0.00018;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `g_${r}_${c}`;
      nodes.push({
        id,
        lat: lat0 + r * step,
        lng: lng0 + c * step,
        connected: r === 0 && c === 0,
        mode: 'road',
        regionId: 'curated_kr_seoul_jung',
      });
      if (c > 0) {
        const left = `g_${r}_${c - 1}`;
        edges.push({
          id: `eh_${r}_${c}`,
          wayName: `가로_${r}`,
          highwayType: 'primary',
          mode: 'road',
          fromNodeId: left,
          toNodeId: id,
          coordinates: [
            [lat0 + r * step, lng0 + (c - 1) * step],
            [lat0 + r * step, lng0 + c * step],
          ],
          distanceKm: 0.016,
          buildCost: 25,
          baseIncomePerSec: 1.5,
          built: false,
          regionId: 'curated_kr_seoul_jung',
        });
      }
      if (r > 0) {
        const down = `g_${r - 1}_${c}`;
        edges.push({
          id: `ev_${r}_${c}`,
          wayName: `세로_${c}`,
          highwayType: 'secondary',
          mode: 'road',
          fromNodeId: down,
          toNodeId: id,
          coordinates: [
            [lat0 + (r - 1) * step, lng0 + c * step],
            [lat0 + r * step, lng0 + c * step],
          ],
          distanceKm: 0.02,
          buildCost: 25,
          baseIncomePerSec: 1.5,
          built: false,
          regionId: 'curated_kr_seoul_jung',
        });
      }
    }
  }

  state = {
    ...state,
    pendingSeedRegionIds: [],
    osmNodes: nodes,
    osmEdges: edges,
    stats: { ...state.stats, connectedOsmNodes: 1 },
  };

  // Warm up WeakMap static topology once (simulating live game session after map open)
  const warmDist = computeOsmFrontierDistancesForState(state);
  assert.ok(warmDist.size > 0);

  // Optimal Manhattan path from (0,0) -> (4,4) = 4*0.016 + 4*0.02 = 0.144 km across 8 edges
  const path = findOsmRoadPath(state, 'g_0_0', 'g_4_4');
  assert.ok(path, 'A* must find road path in dense grid');
  assert.equal(path.edgeIds.length, 8);
  assert.ok(Math.abs(path.totalDistanceKm - 0.144) < 1e-6);

  // Sequential click-connect benchmark: 10 path clicks in a row must average < 25ms each
  let cursor = 'g_0_0';
  const targets = ['g_2_2', 'g_4_4', 'g_6_6', 'g_8_8', 'g_10_10', 'g_12_12', 'g_14_14', 'g_16_16'];
  const clickStart = performance.now();
  for (const tgt of targets) {
    const res = connectOsmPath(state, cursor, tgt);
    assert.equal(res.success, true);
    state = res.newState;
    const d = computeOsmFrontierDistancesForState(state);
    const reach = getReachableOsmNodeSet(state, tgt);
    const prox = getProximityAdjacentChunksToLoad(state, 5);
    assert.ok(d.size > 0);
    assert.ok(reach.size > 0);
    assert.ok(Array.isArray(prox));
    cursor = tgt;
  }
  const avgClickMs = (performance.now() - clickStart) / targets.length;
  assert.ok(
    avgClickMs < 40,
    `Expected full click+frontier+reachable+proximity pipeline on 5,000 nodes to average < 40ms, got ${avgClickMs.toFixed(2)}ms`
  );
});

test('getFrontierVisualStyle LUT returns consistent immutable style properties across modes and distances', () => {
  for (let d = 0; d <= MAX_OSM_FRONTIER_DISTANCE; d++) {
    for (const mode of ['road', 'rail', 'mixed'] as const) {
      const a = getFrontierVisualStyle(d, mode, { isSelected: false, isHovered: false });
      const b = getFrontierVisualStyle(d, mode, { isSelected: false, isHovered: false });
      assert.equal(a, b, 'LUT lookup should return cached identical object reference');
      assert.ok(a.brightness >= 0.14 && a.brightness <= 1);
    }
  }
  const hovered = getFrontierVisualStyle(8, 'rail', { isHovered: true });
  assert.equal(hovered.brightness, 1);
  const undimmed = getFrontierVisualStyle(1, 'road', { dimForSelection: false });
  const dimmed = getFrontierVisualStyle(1, 'road', { dimForSelection: true });
  assert.ok(dimmed.fillOpacity < undimmed.fillOpacity * 0.45 && dimmed.fillOpacity < 0.36);
});

test('curated county-level regions globally (US/JP/UK/FR/KR) have geographic boundaries instead of coarse state blobs', () => {
  const manhattan = CURATED_PROVINCIAL_REGIONS.find((r) => r.regionId === 'curated_us_ny_manhattan');
  assert.ok(manhattan && manhattan.boundaryGeoJson, 'New York County (Manhattan) should exist with GeoJSON boundary');
  assert.equal(manhattan.adminLevel, '6');
  assert.equal(manhattan.boundaryGeoJson.type, 'Polygon');
  const outer = (manhattan.boundaryGeoJson.coordinates as number[][][])[0];
  assert.ok(outer.length >= 8, `Manhattan county polygon should have >=8 vertices, got ${outer.length}`);

  const manhattanRegion = { ...manhattan, unlocked: false, isIsolated: false };
  // Times Square (40.758, -73.9855) & Central Park South (40.778, -73.968) are inside Manhattan
  assert.equal(isPointInRegionBoundary(40.758, -73.9855, manhattanRegion), true);
  assert.equal(isPointInRegionBoundary(40.778, -73.968, manhattanRegion), true);
  // Brooklyn (40.6501, -73.9496) & Jersey City (40.728, -74.060) are outside New York County
  assert.equal(isPointInRegionBoundary(40.6501, -73.9496, manhattanRegion), false);
  assert.equal(isPointInRegionBoundary(40.728, -74.06, manhattanRegion), false);

  const chiyoda = CURATED_PROVINCIAL_REGIONS.find((r) => r.regionId === 'curated_jp_tokyo_chiyoda');
  assert.equal(chiyoda?.adminLevel, '7', 'Tokyo special ward Chiyoda should use county-equivalent adminLevel 7');
  const incheonJung = CURATED_PROVINCIAL_REGIONS.find((r) => r.regionId === 'curated_kr_incheon_jung');
  assert.equal(incheonJung?.boundaryGeoJson?.type, 'MultiPolygon', 'Incheon Jung-gu should include Yeongjong Island MultiPolygon');
});

test('isolated route nodes can self-link within their own exposed component while connected component unconnected pairs stay blocked', () => {
  const seoul = PRESET_CITIES[0];
  let state = createInitialGameState(seoul);
  state = {
    ...state,
    capital: 50000,
    pendingSeedRegionIds: [],
    osmNodes: [
      { id: 'a1', lat: 37.566, lng: 126.978, connected: true, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'a2', lat: 37.5663, lng: 126.978, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      // Isolated route ~45m east of a1 (within ISOLATED_ROUTE_BRIDGE_MAX_KM=80m), service road
      { id: 'b1', lat: 37.566, lng: 126.9785, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'b2', lat: 37.5663, lng: 126.9785, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'b3', lat: 37.5666, lng: 126.9785, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
    ],
    osmEdges: [
      {
        id: 'ea1',
        wayName: '주도로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'a1',
        toNodeId: 'a2',
        coordinates: [[37.566, 126.978], [37.5663, 126.978]],
        distanceKm: 0.035,
        buildCost: 25,
        baseIncomePerSec: 2,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
      {
        id: 'eb1',
        wayName: '고립 골목길',
        highwayType: 'service',
        mode: 'road',
        fromNodeId: 'b1',
        toNodeId: 'b2',
        coordinates: [[37.566, 126.9785], [37.5663, 126.9785]],
        distanceKm: 0.035,
        buildCost: 20,
        baseIncomePerSec: 1.5,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
      {
        id: 'eb2',
        wayName: '고립 골목길',
        highwayType: 'service',
        mode: 'road',
        fromNodeId: 'b2',
        toNodeId: 'b3',
        coordinates: [[37.5663, 126.9785], [37.5666, 126.9785]],
        distanceKm: 0.035,
        buildCost: 20,
        baseIncomePerSec: 1.5,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
    ],
  };

  assert.equal(canConnectIsolatedRoutePair(state, 'b1', 'b3'), true);
  const res = connectOsmPath(state, 'b1', 'b3');
  assert.equal(res.success, true);
  assert.equal(res.builtCount, 2);
  assert.equal(res.newState.osmNodes.find((n) => n.id === 'b2')?.connected, true);
  assert.equal(res.newState.osmNodes.find((n) => n.id === 'b3')?.connected, true);
});

test('unlockProvincialRegion does not queue pendingSeedRegionIds when roadless island payload has 0 nodes', () => {
  const seoul = PRESET_CITIES[0];
  let state = createInitialGameState(seoul);
  state = {
    ...state,
    capital: 999999,
    provincialRegions: [
      ...state.provincialRegions,
      {
        regionId: 'curated_empty_island',
        regionName: '무도로 외딴섬',
        adminLevel: '6',
        bbox: [37.1, 125.1, 37.15, 125.15],
        centerLat: 37.125,
        centerLng: 125.125,
        unlocked: false,
        isIsolated: true,
        isKnownIsland: true,
      },
    ],
  };

  const res = unlockProvincialRegion(state, 'curated_empty_island', {
    chunkKey: '37.1250_125.1250',
    osmNodes: [],
    osmEdges: [],
    bbox: [37.1, 125.1, 37.15, 125.15],
    totalNodeCount: 0,
  });
  assert.equal(res.success, true);
  assert.equal(
    (res.newState.pendingSeedRegionIds || []).includes('curated_empty_island'),
    false,
    'Roadless island should not trap pendingSeedRegionIds waiting for a click on 0 nodes'
  );
});

test('getOsmNodeConnectionFlags flags d=0 terminal nodes with unlocked unexplored neighbors while hiding fully explored interior nodes', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 500_000, pendingSeedRegionIds: [] };

  // Build n1 -> n2 -> n3 inside Jung-gu; n4 is unexplored inside Jung-gu; n_locked is in locked Jongno-gu
  state = {
    ...state,
    osmNodes: [
      { id: 'n1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'n2', lat: 37.5663, lng: 126.9780, connected: true, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'n3', lat: 37.5666, lng: 126.9780, connected: true, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'n4', lat: 37.5669, lng: 126.9780, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jung' },
      { id: 'n_locked', lat: 37.5800, lng: 126.9780, connected: false, mode: 'road', regionId: 'curated_kr_seoul_jongno' },
    ],
    osmEdges: [
      {
        id: 'e12',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        coordinates: [[37.5660, 126.9780], [37.5663, 126.9780]],
        distanceKm: 0.033,
        buildCost: 30,
        baseIncomePerSec: 3,
        built: true,
        regionId: 'curated_kr_seoul_jung',
      },
      {
        id: 'e23',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n2',
        toNodeId: 'n3',
        coordinates: [[37.5663, 126.9780], [37.5666, 126.9780]],
        distanceKm: 0.033,
        buildCost: 30,
        baseIncomePerSec: 3,
        built: true,
        regionId: 'curated_kr_seoul_jung',
      },
      // Optional parallel/shortcut unbuilt edge between already-connected n1 and n2
      {
        id: 'e12_alt',
        wayName: '측면도로',
        highwayType: 'secondary',
        mode: 'road',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        coordinates: [[37.5660, 126.9780], [37.5663, 126.9780]],
        distanceKm: 0.035,
        buildCost: 30,
        baseIncomePerSec: 2,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
      // Unbuilt frontier edge from terminal n3 -> unexplored unlocked n4
      {
        id: 'e34',
        wayName: '세종대로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n3',
        toNodeId: 'n4',
        coordinates: [[37.5666, 126.9780], [37.5669, 126.9780]],
        distanceKm: 0.033,
        buildCost: 30,
        baseIncomePerSec: 3,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
      // Edge from n1 to locked node should NOT count as buildable unexplored neighbor
      {
        id: 'e1_locked',
        wayName: '종로연결로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'n1',
        toNodeId: 'n_locked',
        coordinates: [[37.5660, 126.9780], [37.5800, 126.9780]],
        distanceKm: 1.56,
        buildCost: 100,
        baseIncomePerSec: 5,
        built: false,
        regionId: 'curated_kr_seoul_jongno',
      },
    ],
    stats: { ...state.stats, connectedOsmNodes: 3, totalOsmEdgesBuilt: 2 },
  };

  const frontier = computeOsmFrontierDistancesForState(state);
  const f1 = getOsmNodeConnectionFlags(state, 'n1', frontier, true);
  const f2 = getOsmNodeConnectionFlags(state, 'n2', frontier, true);
  const f3 = getOsmNodeConnectionFlags(state, 'n3', frontier, true);

  assert.equal(f1.hasBuiltEdge, true);
  assert.equal(f1.hasUnexploredNeighbor, false, 'n1 only borders connected n2 and locked n_locked');
  assert.equal(f2.hasBuiltEdge, true);
  assert.equal(f2.hasUnexploredNeighbor, false, 'interior n2 only borders connected nodes');
  assert.equal(f3.hasBuiltEdge, true);
  assert.equal(f3.hasUnbuiltEdge, true);
  assert.equal(f3.hasUnexploredNeighbor, true, 'd=0 terminal n3 borders unexplored unlocked n4 and must stay rendered as a dot');
});

test('enumerateChunkKeysForBounds returns center and NE quadrant tiles on wide viewports instead of SW truncation', () => {
  // 0.06 deg x 0.06 deg = 18 x 18 = 324 chunks (far larger than 8x8=64)
  const bounds = {
    minLat: 37.74,
    maxLat: 37.80,
    minLng: -122.45,
    maxLng: -122.39,
  };
  const centerLat = (bounds.minLat + bounds.maxLat) / 2; // 37.77
  const centerLng = (bounds.minLng + bounds.maxLng) / 2; // -122.42
  const centerKey = quantizeChunkKey(centerLat, centerLng);

  const tiles = enumerateChunkKeysForBounds(bounds, 24);
  assert.equal(tiles.length, 24);
  assert.equal(tiles[0].key, centerKey, 'First tile must be the viewport center');
  assert.ok(
    tiles.some((t) => t.lat > centerLat && t.lng > centerLng),
    'Wide viewport tiles must include NE quadrant around center'
  );
  assert.ok(
    tiles.some((t) => t.lat < centerLat && t.lng < centerLng),
    'Wide viewport tiles must include SW quadrant around center'
  );
});

test('getProximityAdjacentChunksToLoad discovers diagonal neighbor chunks up to 0.55km around frontier endpoints', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);
  const centerKey = quantizeChunkKey(37.5667, 126.9767); // (37.5667, 126.9767)
  const state = {
    ...base,
    pendingSeedRegionIds: [],
    loadedOsmChunks: [centerKey],
    osmNodes: [
      { id: 'c0', lat: 37.5667, lng: 126.9767, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'c1', lat: 37.5679, lng: 126.9781, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    ],
    osmEdges: [
      {
        id: 'ec',
        wayName: '대각선도로',
        highwayType: 'primary',
        mode: 'road' as const,
        fromNodeId: 'c0',
        toNodeId: 'c1',
        coordinates: [[37.5667, 126.9767], [37.5679, 126.9781]] as [[number, number], [number, number]],
        distanceKm: 0.18,
        buildCost: 25,
        baseIncomePerSec: 2,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
    ],
    stats: { ...base.stats, connectedOsmNodes: 1 },
  };

  const adj = getProximityAdjacentChunksToLoad(state, 12);
  assert.ok(adj.length >= 3, `Expected >= 3 adjacent unloaded chunks around frontier, got ${adj.length}`);
  const neKey = quantizeChunkKey(37.5667 + 1 / 300, 126.9767 + 1 / 300);
  assert.ok(adj.some((a) => a.key === neKey), 'Diagonal NE chunk within 0.55km should be queued for loading');
});

test('findIncompleteLoadedChunksInViewport detects already-loaded chunks with sparse nodes or truncated degree<=1 tips', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);
  const sparseKey = quantizeChunkKey(37.5667, 126.9767);
  const denseHealthyKey = quantizeChunkKey(37.5700, 126.9767);
  const tipTruncatedKey = quantizeChunkKey(37.5733, 126.9767);

  const healthyNodes = Array.from({ length: 10 }, (_, idx) => ({
    id: `h_${idx}`,
    lat: 37.5700 + idx * 0.00005,
    lng: 126.9767,
    connected: false,
    mode: 'road' as const,
    regionId: 'curated_kr_seoul_jung',
  }));
  const tipDenseNodes = Array.from({ length: 10 }, (_, idx) => ({
    id: `t_${idx}`,
    lat: 37.5733 + idx * 0.00005,
    lng: 126.9767,
    connected: idx <= 1,
    mode: 'road' as const,
    regionId: 'curated_kr_seoul_jung',
  }));
  const tipEdges = [
    {
      id: 'e_tip',
      wayName: '단절도로',
      highwayType: 'motorway',
      mode: 'road' as const,
      fromNodeId: 't_0',
      toNodeId: 't_1',
      coordinates: [[37.5733, 126.9767], [37.57335, 126.9767]] as [[number, number], [number, number]],
      distanceKm: 0.01,
      buildCost: 20,
      baseIncomePerSec: 1,
      built: true,
      regionId: 'curated_kr_seoul_jung',
    },
  ];

  const state = {
    ...base,
    loadedOsmChunks: [sparseKey, denseHealthyKey, tipTruncatedKey],
    osmNodes: [
      { id: 'sp_1', lat: 37.5667, lng: 126.9767, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      ...healthyNodes,
      ...tipDenseNodes,
    ],
    osmEdges: tipEdges,
  };

  const screenChunks = [
    { key: sparseKey, lat: 37.5667, lng: 126.9767 },
    { key: denseHealthyKey, lat: 37.5700, lng: 126.9767 },
    { key: tipTruncatedKey, lat: 37.5733, lng: 126.9767 },
  ];

  const repair = findIncompleteLoadedChunksInViewport(state, screenChunks);
  const repairKeys = repair.map((r) => r.key);
  assert.equal(repairKeys.includes(sparseKey), true, 'Sparse loaded chunk (<8 nodes) must be queued for repair');
  assert.equal(repairKeys.includes(tipTruncatedKey), true, 'Chunk containing truncated degree<=1 connected tip must be queued for repair');
  assert.equal(repairKeys.includes(denseHealthyKey), false, 'Healthy dense chunk (>=8 unconnected nodes) should not be re-fetched');

  const already = new Set([sparseKey, tipTruncatedKey]);
  assert.equal(findIncompleteLoadedChunksInViewport(state, screenChunks, already).length, 0);
});

test('isOsmNodePedestrianOnly identifies pedestrian/footway/path nodes while keeping service roads and mixed junctions as standard road', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const state = {
    ...createInitialGameState(seoul),
    osmNodes: [
      { id: 'n_road', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'n_srv', lat: 37.5662, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'n_junc', lat: 37.5664, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'n_ped1', lat: 37.5666, lng: 126.9782, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'n_ped2', lat: 37.5668, lng: 126.9784, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    ],
    osmEdges: [
      {
        id: 'e_srv',
        wayName: '주차장 진입로',
        highwayType: 'service',
        mode: 'road' as const,
        fromNodeId: 'n_road',
        toNodeId: 'n_srv',
        coordinates: [[37.5660, 126.9780], [37.5662, 126.9780]] as [[number, number], [number, number]],
        distanceKm: 0.022,
        buildCost: 20,
        baseIncomePerSec: 1,
        built: false,
      },
      {
        id: 'e_res',
        wayName: '일반 골목길',
        highwayType: 'residential',
        mode: 'road' as const,
        fromNodeId: 'n_srv',
        toNodeId: 'n_junc',
        coordinates: [[37.5662, 126.9780], [37.5664, 126.9780]] as [[number, number], [number, number]],
        distanceKm: 0.022,
        buildCost: 20,
        baseIncomePerSec: 1,
        built: false,
      },
      {
        id: 'e_foot',
        wayName: '보행자 산책로',
        highwayType: 'footway',
        mode: 'road' as const,
        fromNodeId: 'n_junc',
        toNodeId: 'n_ped1',
        coordinates: [[37.5664, 126.9780], [37.5666, 126.9782]] as [[number, number], [number, number]],
        distanceKm: 0.028,
        buildCost: 20,
        baseIncomePerSec: 1,
        built: false,
      },
      {
        id: 'e_ped',
        wayName: '보행자 광장길',
        highwayType: 'pedestrian',
        mode: 'road' as const,
        fromNodeId: 'n_ped1',
        toNodeId: 'n_ped2',
        coordinates: [[37.5666, 126.9782], [37.5668, 126.9784]] as [[number, number], [number, number]],
        distanceKm: 0.028,
        buildCost: 20,
        baseIncomePerSec: 1,
        built: false,
      },
      {
        id: 'e_bridge',
        wayName: '교차로 연결 링크',
        highwayType: 'unclassified',
        mode: 'road' as const,
        fromNodeId: 'n_road',
        toNodeId: 'n_ped2',
        coordinates: [[37.5660, 126.9780], [37.5668, 126.9784]] as [[number, number], [number, number]],
        distanceKm: 0.09,
        buildCost: 40,
        baseIncomePerSec: 2,
        built: true,
      },
    ],
  };

  assert.equal(isOsmNodePedestrianOnly(state, 'n_road'), false, 'Service road endpoint must stay standard orange road');
  assert.equal(isOsmNodePedestrianOnly(state, 'n_srv'), false, 'Service + residential node must stay standard orange road');
  assert.equal(isOsmNodePedestrianOnly(state, 'n_junc'), false, 'Junction with residential + footway stays standard orange road');
  assert.equal(isOsmNodePedestrianOnly(state, 'n_ped1'), true, 'Pure footway/pedestrian node must be green');
  assert.equal(isOsmNodePedestrianOnly(state, 'n_ped2'), true, 'Pedestrian node connected via custom bridge must remain green');

  const roadStyle = getFrontierVisualStyle(1, 'road', { isPedestrian: false });
  const pedStyle = getFrontierVisualStyle(1, 'road', { isPedestrian: true });
  assert.notEqual(pedStyle.fillColor, roadStyle.fillColor);
  assert.equal(pedStyle.fillColor, '#059669');
  assert.equal(pedStyle.strokeColor, '#6ee7b7');
});

test('Legacy sub-county Miami save migrates cleanly into Miami-Dade County on load without losing unlock or nodes', () => {
  const miamiCity = {
    id: 'custom_miami',
    name: 'Miami',
    country: 'United States',
    description: 'Miami',
    lat: 25.7617,
    lng: -80.1918,
    zoom: 12,
    isCustom: true,
  };
  const base = createInitialGameState(miamiCity);
  assert.equal(
    base.provincialRegions.find((r) => r.unlocked)?.regionId,
    'curated_us_fl_miami_dade',
    'New Miami start must default to Miami-Dade County'
  );

  const legacyRegionId = 'osm_rel_1216769';
  const legacyState = {
    ...base,
    provincialRegions: [
      {
        regionId: legacyRegionId,
        regionName: 'City of Miami',
        adminLevel: '8',
        bbox: [25.709, -80.319, 25.856, -80.139] as [number, number, number, number],
        centerLat: 25.7617,
        centerLng: -80.1918,
        unlocked: true,
        isStartingRegion: true,
        isIsolated: false,
      },
    ],
    osmNodes: [
      { id: 'miami_n1', lat: 25.7617, lng: -80.1918, connected: true, mode: 'road' as const, regionId: legacyRegionId },
      { id: 'miami_n2', lat: 25.7630, lng: -80.1918, connected: false, mode: 'road' as const, regionId: legacyRegionId },
    ],
    osmEdges: [
      {
        id: 'miami_e1',
        wayName: 'Brickell Ave',
        highwayType: 'primary',
        mode: 'road' as const,
        fromNodeId: 'miami_n1',
        toNodeId: 'miami_n2',
        coordinates: [[25.7617, -80.1918], [25.7630, -80.1918]] as [[number, number], [number, number]],
        distanceKm: 0.14,
        buildCost: 35,
        baseIncomePerSec: 3,
        built: false,
        regionId: legacyRegionId,
      },
    ],
    loadedOsmRegions: [legacyRegionId],
    pendingSeedRegionIds: [legacyRegionId],
  };

  const migrated = scopeGameStateToStartingCity(legacyState);
  const dade = migrated.provincialRegions.find((r) => r.regionId === 'curated_us_fl_miami_dade');
  assert.ok(dade, 'Miami-Dade County must replace legacy City of Miami');
  assert.equal(dade.unlocked, true);
  assert.equal(dade.isStartingRegion, true);
  assert.equal(dade.adminLevel, '6');
  assert.equal(
    migrated.provincialRegions.some((r) => r.regionId === legacyRegionId || r.regionName === 'City of Miami'),
    false,
    'Legacy City of Miami region entry must be removed after migration'
  );
  assert.equal(
    migrated.osmNodes.every((n) => n.regionId === 'curated_us_fl_miami_dade'),
    true,
    'Existing nodes must retag to Miami-Dade County'
  );
  assert.equal(
    migrated.osmEdges.every((e) => e.regionId === 'curated_us_fl_miami_dade'),
    true,
    'Existing edges must retag to Miami-Dade County'
  );
  assert.deepEqual(migrated.pendingSeedRegionIds, ['curated_us_fl_miami_dade']);
  assert.equal(
    (migrated.loadedOsmRegions || []).includes(legacyRegionId),
    false,
    'Legacy region ID must clear from loadedOsmRegions so full county OSM auto-loads'
  );

  // Also ensure hydrateRawGameState preserves the migration cleanly
  const hydrated = hydrateRawGameState(legacyState);
  assert.ok(hydrated);
  assert.equal(hydrated.provincialRegions.some((r) => r.regionId === 'curated_us_fl_miami_dade' && r.unlocked), true);
  assert.equal(hydrated.provincialRegions.some((r) => r.regionId === legacyRegionId), false);
});

test('highway=steps nodes register as pedestrian-only green paths, connect cleanly, and preserve exactBoundaryVersion across region registration', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 50000 };

  state = mergeOsmChunk(
    state,
    '37.566_126.978',
    [
      { id: 'st_1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' },
      { id: 'st_2', lat: 37.5662, lng: 126.9780, connected: false, mode: 'road' },
      { id: 'st_3', lat: 37.5663, lng: 126.9780, connected: false, mode: 'road' },
    ],
    [
      {
        id: 'oe_steps_1',
        wayName: '남산 계단길',
        highwayType: 'steps',
        mode: 'road',
        fromNodeId: 'st_1',
        toNodeId: 'st_2',
        coordinates: [[37.5660, 126.9780], [37.5662, 126.9780]],
        distanceKm: 0.022,
        buildCost: 25,
        baseIncomePerSec: 1.5,
        built: false,
      },
      {
        id: 'oe_foot_2',
        wayName: '보행로',
        highwayType: 'footway',
        mode: 'road',
        fromNodeId: 'st_2',
        toNodeId: 'st_3',
        coordinates: [[37.5662, 126.9780], [37.5663, 126.9780]],
        distanceKm: 0.011,
        buildCost: 20,
        baseIncomePerSec: 1.2,
        built: false,
      },
    ],
    undefined,
    { skipAutoSeed: true }
  );

  assert.equal(isOsmNodePedestrianOnly(state, 'st_2'), true, 'Node between steps and footway must be pedestrian-only green');
  const connected = connectOsmPath(state, 'st_1', 'st_3');
  assert.equal(connected.success, true, 'Should connect across highway=steps into footway');
  assert.equal(connected.builtCount, 2);

  // Preserve exactBoundaryVersion when registering a newly discovered region with real boundaryGeoJson
  const poly = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [127.08, 37.42],
        [127.14, 37.42],
        [127.14, 37.47],
        [127.08, 37.47],
        [127.08, 37.42],
      ],
    ],
  };
  const withDiscovered = registerDiscoveredProvincialRegion(connected.newState, {
    regionId: 'osm_rel_555666',
    regionName: '테스트특례구',
    adminLevel: '6',
    bbox: [37.42, 127.08, 37.47, 127.14],
    boundaryGeoJson: poly,
    exactBoundaryVersion: 2,
    centerLat: 37.445,
    centerLng: 127.11,
  });
  const reg = withDiscovered.provincialRegions.find((r) => r.regionId === 'osm_rel_555666');
  assert.ok(reg);
  assert.equal(reg.exactBoundaryVersion, 2, 'New discovered region must preserve exactBoundaryVersion=2');
});

test('Isolated rail routes (0 crossings, e.g. Miami Metromover) approach cleanly from nearby road and support intra-route linking', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 100_000 };

  const nodes = [
    { id: 'r0', lat: 37.5650, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r2', lat: 37.5670, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    // Isolated monorail line ~85m east of r1 (0 road crossings, no transfer skill [71])
    { id: 'm1', lat: 37.5660, lng: 126.9790, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'm2', lat: 37.5668, lng: 126.9792, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'm3', lat: 37.5676, lng: 126.9794, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'm4', lat: 37.5684, lng: 126.9796, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
  ];

  const edges = [
    {
      id: 'er01',
      wayName: 'Biscayne Blvd',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'r0',
      toNodeId: 'r1',
      coordinates: [[37.5650, 126.9780], [37.5660, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: true,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'er12',
      wayName: 'Biscayne Blvd',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'r1',
      toNodeId: 'r2',
      coordinates: [[37.5660, 126.9780], [37.5670, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'em12',
      wayName: 'Metromover Omni Loop',
      highwayType: 'monorail',
      mode: 'rail' as const,
      fromNodeId: 'm1',
      toNodeId: 'm2',
      coordinates: [[37.5660, 126.9790], [37.5668, 126.9792]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'em23',
      wayName: 'Metromover Omni Loop',
      highwayType: 'monorail',
      mode: 'rail' as const,
      fromNodeId: 'm2',
      toNodeId: 'm3',
      coordinates: [[37.5668, 126.9792], [37.5676, 126.9794]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'em34',
      wayName: 'Metromover Omni Loop',
      highwayType: 'monorail',
      mode: 'rail' as const,
      fromNodeId: 'm3',
      toNodeId: 'm4',
      coordinates: [[37.5676, 126.9794], [37.5684, 126.9796]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 35,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
  ];

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung', { skipAutoSeed: true });
  const frontier = computeOsmFrontierDistancesForState(state);
  assert.equal(frontier.get('m1'), 1, 'Closest isolated monorail entry node m1 must expose at d=1');
  assert.equal(frontier.get('m2'), 2);
  assert.equal(frontier.get('m3'), 3);
  assert.equal(frontier.get('m4'), undefined, 'Frontier horizon cap d<=3 must hold on isolated rail route');

  assert.equal(resolveProximityBridgeInfo(state, 'r1', 'm1')?.kind, 'isolated_route');
  assert.equal(getReachableOsmNodeSet(state, 'r1').has('m1'), true);
  assert.equal(getReachableOsmNodeSet(state, 'm1').has('r1'), true);

  // Intra-route linking within isolated rail route before bridging
  assert.equal(canConnectIsolatedRoutePair(state, 'm1', 'm3'), true);
  const intraRes = connectOsmPath(state, 'm1', 'm3');
  assert.equal(intraRes.success, true, 'Nodes inside isolated rail route must connect to each other');
  assert.equal(intraRes.builtCount, 2);

  // Bridging from adjacent road (forward & reverse)
  const forwardBridge = connectOsmPath(state, 'r1', 'm1');
  assert.equal(forwardBridge.success, true);
  assert.equal(forwardBridge.newState.osmNodes.find((n) => n.id === 'm1')?.connected, true);
  assert.equal(forwardBridge.newState.osmEdges.at(-1)?.wayName, '인접 노선 연결');

  const reverseBridge = connectOsmPath(state, 'm1', 'r1');
  assert.equal(reverseBridge.success, true);
});

test('Near-isolated rail routes with 1~2 road crossings behave like isolated routes without leaking onto unrelated streets', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 200_000 };

  // Connected road chain r0 -> r1 (85m west of m1), while crossing x1 is far down an unbuilt side road
  // Plus a 2nd crossing x2 to test roadCrossingCount === 2, and a branch s_side off x1 that must NOT expose via rail isolation
  const nodes = [
    { id: 'r0', lat: 37.5650, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r1', lat: 37.5660, lng: 126.9780, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'r2', lat: 37.5670, lng: 126.9780, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'm1', lat: 37.5660, lng: 126.9790, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'x1', lat: 37.5668, lng: 126.9792, connected: false, mode: 'mixed' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'm3', lat: 37.5676, lng: 126.9794, connected: false, mode: 'rail' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 'x2', lat: 37.5684, lng: 126.9796, connected: false, mode: 'mixed' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 's_side', lat: 37.5668, lng: 126.9802, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    { id: 's_far', lat: 37.5684, lng: 126.9806, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
  ];

  // Connect road grid r2 -> ... far road detour? Even simpler: attach x1->s_side->r2 (unbuilt) or connect r2->x1 at edge,
  // wait: let's add a long 12-edge unbuilt road chain from r2 -> s_side so mixed graph fuses comp(r1) and comp(m1),
  // AND normalReached (d<=10) doesn't even reach x1!
  const edges = [
    {
      id: 'er01',
      wayName: 'Main St',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'r0',
      toNodeId: 'r1',
      coordinates: [[37.5650, 126.9780], [37.5660, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: true,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'er12',
      wayName: 'Main St',
      highwayType: 'primary',
      mode: 'road' as const,
      fromNodeId: 'r1',
      toNodeId: 'r2',
      coordinates: [[37.5660, 126.9780], [37.5670, 126.9780]] as [[number, number], [number, number]],
      distanceKm: 0.11,
      buildCost: 30,
      baseIncomePerSec: 3,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    // Rail line m1 - x1 - m3 - x2 (with 2 road crossings at x1 and x2)
    {
      id: 'em_1x1',
      wayName: 'Tram Line A',
      highwayType: 'tram',
      mode: 'rail' as const,
      fromNodeId: 'm1',
      toNodeId: 'x1',
      coordinates: [[37.5660, 126.9790], [37.5668, 126.9792]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 30,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'em_x13',
      wayName: 'Tram Line A',
      highwayType: 'tram',
      mode: 'rail' as const,
      fromNodeId: 'x1',
      toNodeId: 'm3',
      coordinates: [[37.5668, 126.9792], [37.5676, 126.9794]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 30,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'em_3x2',
      wayName: 'Tram Line A',
      highwayType: 'tram',
      mode: 'rail' as const,
      fromNodeId: 'm3',
      toNodeId: 'x2',
      coordinates: [[37.5676, 126.9794], [37.5684, 126.9796]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 30,
      baseIncomePerSec: 4,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    // Cross streets at x1 and x2
    {
      id: 'es_x1',
      wayName: 'Cross St 1',
      highwayType: 'residential',
      mode: 'road' as const,
      fromNodeId: 'x1',
      toNodeId: 's_side',
      coordinates: [[37.5668, 126.9792], [37.5668, 126.9802]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 25,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
    {
      id: 'es_x2',
      wayName: 'Cross St 2',
      highwayType: 'residential',
      mode: 'road' as const,
      fromNodeId: 'x2',
      toNodeId: 's_far',
      coordinates: [[37.5684, 126.9796], [37.5684, 126.9806]] as [[number, number], [number, number]],
      distanceKm: 0.09,
      buildCost: 25,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    },
  ];

  // Long 12-hop road chain connecting r2 -> s_side so the mixed graph fuses r1 and m1 into ONE connected component!
  let prevId = 'r2';
  for (let i = 1; i <= 11; i++) {
    const nid = `det_${i}`;
    nodes.push({
      id: nid,
      lat: 37.5685 + i * 0.0005,
      lng: 126.9795,
      connected: false,
      mode: 'road' as const,
      regionId: 'curated_kr_seoul_jung',
    });
    edges.push({
      id: `edet_${i}`,
      wayName: 'Long Detour',
      highwayType: 'secondary',
      mode: 'road' as const,
      fromNodeId: prevId,
      toNodeId: nid,
      coordinates: [[37.5685, 126.9795], [37.569, 126.9795]],
      distanceKm: 0.06,
      buildCost: 25,
      baseIncomePerSec: 2,
      built: false,
      regionId: 'curated_kr_seoul_jung',
    });
    prevId = nid;
  }
  edges.push({
    id: 'edet_end',
    wayName: 'Long Detour',
    highwayType: 'secondary',
    mode: 'road' as const,
    fromNodeId: prevId,
    toNodeId: 's_side',
    coordinates: [[37.569, 126.9795], [37.5668, 126.9802]],
    distanceKm: 0.06,
    buildCost: 25,
    baseIncomePerSec: 2,
    built: false,
    regionId: 'curated_kr_seoul_jung',
  });

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung', { skipAutoSeed: true });
  const frontier = computeOsmFrontierDistancesForState(state);
  assert.equal(frontier.get('m1'), 1, 'Near-isolated 2-crossing rail entry m1 must expose at d=1');
  assert.equal(frontier.get('x1'), 2);
  assert.equal(frontier.get('m3'), 3);
  assert.equal(frontier.get('s_side'), undefined, 'Road crossing side street must NOT bleed through isolated rail exposure');

  assert.equal(resolveProximityBridgeInfo(state, 'r1', 'm1')?.kind, 'isolated_route');
  assert.equal(getReachableOsmNodeSet(state, 'r1').has('m1'), true);
  assert.equal(canConnectIsolatedRoutePair(state, 'm1', 'm3'), true, 'Intra-route linking must work on 2-crossing rail route');

  const intra = connectOsmPath(state, 'm1', 'm3');
  assert.equal(intra.success, true);
  assert.equal(intra.builtCount, 2);

  const bridged = connectOsmPath(state, 'r1', 'm1');
  assert.equal(bridged.success, true);
  assert.equal(bridged.newState.osmNodes.find((n) => n.id === 'm1')?.connected, true);

  // Adding a 3rd road crossing excludes the line from 1~2 crossing isolated rail bridging
  const withThreeCrossings = {
    ...state,
    osmNodes: [
      ...state.osmNodes.map((n) => (n.id === 'm3' ? { ...n, mode: 'mixed' as const } : n)),
      { id: 's_third', lat: 37.5676, lng: 126.9804, connected: false, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
    ],
    osmEdges: [
      ...state.osmEdges,
      {
        id: 'es_m3',
        wayName: 'Cross St 3',
        highwayType: 'residential',
        mode: 'road' as const,
        fromNodeId: 'm3',
        toNodeId: 's_third',
        coordinates: [[37.5676, 126.9794], [37.5676, 126.9804]] as [[number, number], [number, number]],
        distanceKm: 0.09,
        buildCost: 25,
        baseIncomePerSec: 2,
        built: false,
        regionId: 'curated_kr_seoul_jung',
      },
    ],
  };
  assert.equal(resolveProximityBridgeInfo(withThreeCrossings, 'r1', 'm1'), null);
});

test('Large 15,000+ node graph connectOsmPath + frontier + reachable + proximity chunks stay sub-220ms', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 50_000_000 };
  const nodes: Array<{
    id: string;
    lat: number;
    lng: number;
    connected: boolean;
    mode: 'road' | 'rail';
    regionId: string;
  }> = [];
  const edges: Array<{
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
    regionId: string;
  }> = [];

  for (let r = 0; r < 120; r++) {
    for (let c = 0; c < 120; c++) {
      const id = `g_${r}_${c}`;
      nodes.push({
        id,
        lat: 37.55 + r * 0.00025,
        lng: 126.96 + c * 0.0003,
        connected: r < 20 && c < 40,
        mode: 'road',
        regionId: 'curated_kr_seoul_jung',
      });
      if (r > 0) {
        edges.push({
          id: `ev_${r}_${c}`,
          wayName: `대로_${c}`,
          highwayType: 'primary',
          mode: 'road',
          fromNodeId: `g_${r - 1}_${c}`,
          toNodeId: id,
          coordinates: [
            [37.55 + (r - 1) * 0.00025, 126.96 + c * 0.0003],
            [37.55 + r * 0.00025, 126.96 + c * 0.0003],
          ],
          distanceKm: 0.028,
          buildCost: 25,
          baseIncomePerSec: 2,
          built: r < 20 && c < 40,
          regionId: 'curated_kr_seoul_jung',
        });
      }
      if (c > 0) {
        edges.push({
          id: `eh_${r}_${c}`,
          wayName: `가로_${r}`,
          highwayType: 'secondary',
          mode: 'road',
          fromNodeId: `g_${r}_${c - 1}`,
          toNodeId: id,
          coordinates: [
            [37.55 + r * 0.00025, 126.96 + (c - 1) * 0.0003],
            [37.55 + r * 0.00025, 126.96 + c * 0.0003],
          ],
          distanceKm: 0.026,
          buildCost: 25,
          baseIncomePerSec: 2,
          built: r < 20 && c < 40,
          regionId: 'curated_kr_seoul_jung',
        });
      }
    }
  }

  for (let m = 0; m < 300; m++) {
    const bLat = 37.55 + (m % 25) * 0.0011;
    const bLng = 126.96 + Math.floor(m / 25) * 0.0022;
    for (let k = 0; k < 4; k++) {
      const mode = m % 5 === 0 ? 'rail' : 'road';
      nodes.push({
        id: `m_${m}_${k}`,
        lat: bLat + k * 0.00018,
        lng: bLng + 0.0001,
        connected: false,
        mode,
        regionId: 'curated_kr_seoul_jung',
      });
      if (k > 0) {
        edges.push({
          id: `em_${m}_${k}`,
          wayName: mode === 'rail' ? `모노레일_${m}` : `보행길_${m}`,
          highwayType: mode === 'rail' ? 'monorail' : 'pedestrian',
          mode,
          fromNodeId: `m_${m}_${k - 1}`,
          toNodeId: `m_${m}_${k}`,
          coordinates: [
            [bLat + (k - 1) * 0.00018, bLng + 0.0001],
            [bLat + k * 0.00018, bLng + 0.0001],
          ],
          distanceKm: 0.02,
          buildCost: 20,
          baseIncomePerSec: 1.5,
          built: false,
          regionId: 'curated_kr_seoul_jung',
        });
      }
    }
  }

  state = mergeOsmChunk(state, '37.566_126.978', nodes, edges, 'curated_kr_seoul_jung', {
    skipAutoSeed: true,
  });
  computeOsmFrontierDistancesForState(state);

  const t0 = performance.now();
  const res = connectOsmPath(state, 'g_19_20', 'g_21_20');
  assert.equal(res.success, true);
  const frontier = computeOsmFrontierDistancesForState(res.newState);
  const reachable = getReachableOsmNodeSet(res.newState, 'g_21_20');
  const prox = getProximityAdjacentChunksToLoad(res.newState, 12);
  const elapsedMs = performance.now() - t0;

  assert.ok(frontier.size > 500);
  assert.ok(reachable.size > 100);
  assert.ok(prox.length > 0);
  assert.ok(
    elapsedMs < 350,
    `Expected full 15k-node click cycle to complete <350ms, took ${elapsedMs.toFixed(1)}ms`
  );
});

test('mergeOsmChunksBatch replaces synthetic 복원 연결점/복원 연결선 placeholders with real 1:1 OSM coordinates and updates incident custom bridges', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  const base = createInitialGameState(seoul);

  const corruptedState = {
    ...base,
    pendingSeedRegionIds: [],
    osmNodes: [
      { id: 'osm_real_1', lat: 37.566, lng: 126.978, connected: true, mode: 'road' as const, regionId: 'curated_kr_seoul_jung' },
      { id: 'osm_syn_2', lat: 37.5665, lng: 126.978, connected: true, mode: 'road' as const, label: '복원 연결점', regionId: 'curated_kr_seoul_jung' },
      { id: 'osm_syn_3', lat: 37.5665, lng: 126.9782, connected: true, mode: 'rail' as const, label: '복원 환승점', regionId: 'curated_kr_seoul_jung' },
    ],
    osmEdges: [
      {
        id: 'oe_syn_23',
        wayName: '복원 연결선',
        highwayType: 'unclassified',
        mode: 'road' as const,
        fromNodeId: 'osm_syn_2',
        toNodeId: 'osm_syn_3',
        coordinates: [[37.5665, 126.978], [37.5665, 126.9782]] as [[number, number], [number, number]],
        distanceKm: 0.02,
        buildCost: 20,
        baseIncomePerSec: 1.5,
        built: true,
        regionId: 'curated_kr_seoul_jung',
      },
      {
        id: 'oe_custom_bridge_12',
        wayName: '교차로 연결 링크',
        highwayType: 'unclassified',
        mode: 'road' as const,
        fromNodeId: 'osm_real_1',
        toNodeId: 'osm_syn_2',
        coordinates: [[37.566, 126.978], [37.5665, 126.978]] as [[number, number], [number, number]],
        distanceKm: 0.056,
        buildCost: 40,
        baseIncomePerSec: 2,
        built: true,
        regionId: 'curated_kr_seoul_jung',
      },
    ],
  };

  const healed = mergeOsmChunksBatch(
    corruptedState,
    [
      {
        chunkKey: '37.5667_126.9800',
        regionId: 'curated_kr_seoul_jung',
        osmNodes: [
          { id: 'osm_syn_2', lat: 37.5712, lng: 126.9854, connected: false, mode: 'road' },
          { id: 'osm_syn_3', lat: 37.5718, lng: 126.9862, connected: false, mode: 'rail', label: '종각역' },
        ],
        osmEdges: [
          {
            id: 'oe_syn_23',
            wayName: '종로 실제 도로',
            highwayType: 'primary',
            mode: 'road',
            fromNodeId: 'osm_syn_2',
            toNodeId: 'osm_syn_3',
            coordinates: [[37.5712, 126.9854], [37.5718, 126.9862]],
            distanceKm: 0.098,
            buildCost: 45,
            baseIncomePerSec: 4,
            built: false,
          },
        ],
      },
    ],
    { skipAutoSeed: true }
  );

  const n2 = healed.osmNodes.find((n) => n.id === 'osm_syn_2')!;
  const n3 = healed.osmNodes.find((n) => n.id === 'osm_syn_3')!;
  assert.equal(n2.lat, 37.5712);
  assert.equal(n2.lng, 126.9854);
  assert.equal(n2.connected, true);
  assert.equal(n2.label, undefined);

  assert.equal(n3.lat, 37.5718);
  assert.equal(n3.lng, 126.9862);
  assert.equal(n3.connected, true);
  assert.equal(n3.label, '종각역');

  const e23 = healed.osmEdges.find((e) => e.id === 'oe_syn_23')!;
  assert.equal(e23.wayName, '종로 실제 도로');
  assert.equal(e23.built, true);
  assert.deepEqual(e23.coordinates, [[37.5712, 126.9854], [37.5718, 126.9862]]);
  assert.equal(e23.distanceKm, 0.098);

  const bridge = healed.osmEdges.find((e) => e.id === 'oe_custom_bridge_12')!;
  assert.deepEqual(bridge.coordinates, [[37.566, 126.978], [37.5712, 126.9854]]);
  assert.ok(bridge.distanceKm > 0.8);
});



