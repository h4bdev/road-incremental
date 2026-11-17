import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceMinigamesTick,
  boostShipyardChain,
  buyMineUpgrade,
  buyQuantumUpgrade,
  buyReactorUpgrade,
  buyShipyardUnit,
  digMineLayer,
  evaluateMinigameMilestones,
  exchangeMoneyToMinigameCurrency,
  getMineMetrics,
  getMinigameIncomeBoost,
  getMinigameMilestoneSummary,
  getQuantumMetrics,
  getReactorMetrics,
  placeReactorCell,
  prestigeShipyardFleet,
  pulseQuantumExperiment,
  tuneQuantumWave,
  ventReactorHeat,
} from './minigames';
import {
  advanceTick,
  calculateMultipliers,
  calculateTotalIncomePerSec,
  connectOsmEdge,
  createInitialGameState,
  mergeOsmChunk,
} from './rules';
import { PRESET_CITIES } from './worldCatalog';

test('one-way exchange converts main money into unique minigame currencies without directly altering base income', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  const initialIncome = calculateTotalIncomePerSec(state);
  const initialEarnings = state.totalLifetimeEarnings;

  // Exchange $200 -> 50 Ore Shards
  const resMine = exchangeMoneyToMinigameCurrency(state, 'mine', 200);
  assert.equal(resMine.success, true);
  assert.equal(resMine.gained, 50);
  state = resMine.newState;
  assert.equal(state.capital, 1000);
  assert.equal(state.minigames.mine.ore, 50);

  // Exchange $250 -> 20 Plasma Cells
  const resReactor = exchangeMoneyToMinigameCurrency(state, 'reactor', 250);
  assert.equal(resReactor.success, true);
  assert.equal(resReactor.gained, 20);
  state = resReactor.newState;
  assert.equal(state.capital, 750);
  assert.equal(state.minigames.reactor.plasma, 20);

  // Exchange $500 -> 15 Darkmatter Cores
  const resShip = exchangeMoneyToMinigameCurrency(state, 'shipyard', 500);
  assert.equal(resShip.success, true);
  assert.equal(resShip.gained, 15);
  state = resShip.newState;
  assert.equal(state.capital, 250);
  assert.equal(state.minigames.shipyard.darkmatter, 15);

  // Reject over-budget exchange
  const resFail = exchangeMoneyToMinigameCurrency(state, 'quantum', 400);
  assert.equal(resFail.success, false);
  assert.equal(state.capital, 250);

  // Exchanging money alone grants zero free income or milestones
  assert.equal(calculateTotalIncomePerSec(state), initialIncome);
  assert.equal(state.totalLifetimeEarnings, initialEarnings);
  assert.equal(state.minigames.totalMoneyInvested, 950);
  assert.equal(getMinigameIncomeBoost(state.minigames).boostPct, 0);
});

test('mine progresses depth toward milestones without ever minting ◈ ore outside money exchange', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = exchangeMoneyToMinigameCurrency(state, 'mine', 500).newState; // 125 ore
  const startingOre = state.minigames.mine.ore;
  assert.equal(startingOre, 125);

  let mine = state.minigames.mine;
  // Dig until depth >= 3 (milestone 1 target)
  for (let i = 0; i < 16; i++) {
    mine = digMineLayer(mine);
  }
  assert.ok(mine.depth >= 3);
  assert.ok(mine.layersCleared >= 2);
  // Breaking layers MUST NOT mint ◈ ore currency
  assert.equal(mine.ore, startingOre);
  assert.equal(mine.totalOreEarned, startingOre);

  const manualEval = evaluateMinigameMilestones({ ...state.minigames, mine });
  assert.ok(manualEval.newlyUnlocked.some((m) => m.id === 'ms_mine_1'));

  // Buy auto-driller and simulate tick from depth 2 (1 HP left) -> auto-driller crosses depth 3 and unlocks ms_mine_1
  const upg = buyMineUpgrade({ ...mine, depth: 2, layerHp: 1, layerMaxHp: 43 }, 'autoDriller');
  assert.equal(upg.success, true);
  const oreAfterBuy = upg.mine.ore;
  assert.ok(getMineMetrics(upg.mine).autoDps > 0);

  const ticked = advanceTick({ ...state, minigames: { ...state.minigames, mine: upg.mine } }, 0.25);
  assert.ok(ticked.newState.minigames.mine.depth >= 3);
  assert.equal(ticked.newState.minigames.mine.ore, oreAfterBuy);
  assert.ok(ticked.newlyUnlockedMilestones.some((m) => m.id === 'ms_mine_1'));
});

test('reactor generates MWh progress without minting ⚡ plasma, and cell removal grants 0⚡ refund', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = exchangeMoneyToMinigameCurrency(state, 'reactor', 1000).newState; // 80 plasma

  let reactor = state.minigames.reactor;
  const baseMetrics = getReactorMetrics(reactor);

  // Deleting pre-placed starter fuel cell at index 4 must NOT grant free plasma
  const clearRes = placeReactorCell(reactor, 4, 'empty');
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.reactor.plasma, 80);

  // Restore fuel at 4 and place generator at 1
  reactor = placeReactorCell(clearRes.reactor, 4, 'fuel').reactor; // costs 22 -> 58
  const genRes = placeReactorCell(reactor, 1, 'generator'); // costs 36 -> 22
  assert.equal(genRes.success, true);
  reactor = genRes.reactor;
  assert.equal(reactor.plasma, 22);

  const boostedMetrics = getReactorMetrics(reactor);
  assert.ok(boostedMetrics.rawEnergyPerSec > baseMetrics.rawEnergyPerSec);

  // Ticking advances totalEnergyMWh but NEVER increases spendable plasma
  const tickedMg = advanceMinigamesTick({ ...state.minigames, reactor }, 2);
  assert.ok(tickedMg.reactor.totalEnergyMWh > 0);
  assert.equal(tickedMg.reactor.plasma, 22);

  // Overheat and manual vent
  const overheated = { ...tickedMg.reactor, heat: 100, overheated: true };
  assert.equal(getReactorMetrics(overheated).effectiveEnergyPerSec, 0);
  const vented = ventReactorHeat(overheated);
  assert.equal(vented.heat, 65);

  // Efficiency upgrade increases output
  const effRes = buyReactorUpgrade({ ...vented, plasma: 100 }, 'efficiency');
  assert.equal(effRes.success, true);
  assert.equal(effRes.reactor.coreEfficiencyLevel, 1);
});

test('shipyard 3-stage pipeline ships cargo tons without minting ✦ darkmatter, including on prestige', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 5000 };
  state = exchangeMoneyToMinigameCurrency(state, 'shipyard', 2000).newState; // 60 darkmatter

  let ship = state.minigames.shipyard;
  ship = buyShipyardUnit(ship, 'refinery').shipyard; // -14 -> 46
  ship = buyShipyardUnit(ship, 'freighter').shipyard; // -22 -> 24
  assert.equal(ship.refineryCount, 1);
  assert.equal(ship.freighterCount, 1);
  assert.equal(ship.darkmatter, 24);

  ship = boostShipyardChain(ship);
  assert.ok(ship.totalCargoShipped > 0);
  assert.equal(ship.darkmatter, 24); // never minted!

  const mgTicked = advanceMinigamesTick({ ...state.minigames, shipyard: ship }, 1);
  assert.ok(mgTicked.shipyard.totalCargoShipped >= ship.totalCargoShipped);
  assert.equal(mgTicked.shipyard.darkmatter, 24);

  // Internal prestige requires >= 220 totalCargoShipped and preserves darkmatter without gifting currency
  const failPre = prestigeShipyardFleet(ship);
  assert.equal(failPre.success, false);

  const okPre = prestigeShipyardFleet({ ...ship, totalCargoShipped: 300 });
  assert.equal(okPre.success, true);
  assert.equal(okPre.shipyard.fleetPrestigeLevel, 1);
  assert.ok(okPre.shipyard.fleetMultiplier > 2);
  assert.equal(okPre.shipyard.darkmatter, 24);
});

test('quantum lab wave tuning accumulates RP without minting ⚛ qubits outside exchange', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = createInitialGameState(seoul);
  state = exchangeMoneyToMinigameCurrency(state, 'quantum', 1000).newState; // 45 qubits
  assert.equal(state.minigames.quantum.qubits, 45);

  let q = state.minigames.quantum;
  q = tuneQuantumWave(q, 0, q.targetWave[0]);
  q = tuneQuantumWave(q, 1, q.targetWave[1]);
  q = tuneQuantumWave(q, 2, q.targetWave[2]);

  const metrics = getQuantumMetrics(q);
  assert.equal(metrics.matchedChannels, 3);
  assert.equal(metrics.resonanceMult, 3.2);

  for (let i = 0; i < 5; i++) {
    q = pulseQuantumExperiment(q);
  }
  assert.ok(q.experimentsCompleted >= 1);
  assert.ok(q.researchPoints > 0);
  // Qubits currency must NEVER increase from experiment completions
  assert.equal(q.qubits, 45);

  const upg = buyQuantumUpgrade(q, 'entanglement');
  assert.equal(upg.success, true);
  assert.ok(getQuantumMetrics(upg.quantum).passiveRpPerSec > 0);
  const qubitsAfterUpg = upg.quantum.qubits;

  const mgTicked = advanceMinigamesTick({ ...state.minigames, quantum: upg.quantum }, 1);
  assert.ok(mgTicked.quantum.researchPoints > upg.quantum.researchPoints);
  assert.equal(mgTicked.quantum.qubits, qubitsAfterUpg);
});

test('minigame milestone achievements directly boost main TerraLine money income', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 50000 };

  // Build an OSM road edge so main game has non-zero $/s income
  state = mergeOsmChunk(
    state,
    '37.566_126.978',
    [
      { id: 'mg_n1', lat: 37.566, lng: 126.978, connected: false, mode: 'road' },
      { id: 'mg_n2', lat: 37.567, lng: 126.978, connected: false, mode: 'road' },
    ],
    [
      {
        id: 'mg_e1',
        wayName: '테스트 간선도로',
        highwayType: 'primary',
        mode: 'road',
        fromNodeId: 'mg_n1',
        toNodeId: 'mg_n2',
        coordinates: [
          [37.566, 126.978],
          [37.567, 126.978],
        ],
        distanceKm: 0.11,
        buildCost: 50,
        baseIncomePerSec: 100,
        built: false,
      },
    ]
  );
  state = connectOsmEdge(state, 'mg_e1').newState;
  const baseIncome = calculateTotalIncomePerSec(state);
  assert.ok(baseIncome > 0);
  assert.equal(calculateMultipliers(state).minigameIncomeMult, 1);

  // Advance Mine to depth 3 (+15%) and Quantum to 65 RP (+15%) -> +30% total (x1.30)
  const progressedMg = evaluateMinigameMilestones({
    ...state.minigames,
    mine: { ...state.minigames.mine, depth: 3, layersCleared: 2 },
    quantum: { ...state.minigames.quantum, researchPoints: 65, experimentsCompleted: 5 },
  }).minigames;

  const boostedState = { ...state, minigames: progressedMg };
  const summary = getMinigameMilestoneSummary(boostedState.minigames);
  assert.equal(summary.unlockedCount, 2);
  assert.equal(summary.totalBoostPct, 30);
  assert.equal(summary.incomeMult, 1.3);

  const mults = calculateMultipliers(boostedState);
  assert.equal(mults.minigameBoostPct, 30);
  assert.equal(mults.minigameIncomeMult, 1.3);

  const boostedIncome = calculateTotalIncomePerSec(boostedState);
  assert.equal(Math.round(boostedIncome), Math.round(baseIncome * 1.3));
});
