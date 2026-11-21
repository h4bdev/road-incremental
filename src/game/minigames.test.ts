import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceMinigamesTick,
  boostShipyardChain,
  buyBioUpgrade,
  buyColliderUpgrade,
  buyMineUpgrade,
  buyQuantumUpgrade,
  buyReactorUpgrade,
  buyShipyardUnit,
  buySolarUpgrade,
  collideParticles,
  cultivateBioDome,
  digMineLayer,
  evaluateMinigameMilestones,
  evolveBioDome,
  exchangeMoneyToMinigameCurrency,
  getBioMetrics,
  getColliderMetrics,
  getMineMetrics,
  getMinigameIncomeBoost,
  getMinigameMilestoneSummary,
  getMinigameUnlockCost,
  getQuantumMetrics,
  getReactorMetrics,
  getSolarMetrics,
  isMinigameUnlocked,
  leapQuantumDimension,
  MINIGAME_MILESTONES,
  MINIGAME_UNLOCK_COSTS,
  mistBioHumidity,
  placeReactorCell,
  prestigeShipyardFleet,
  pulseQuantumExperiment,
  pulseSolarArray,
  setSolarOrbitalAngle,
  triggerColliderBurst,
  triggerMineSeismicBlast,
  tuneQuantumWave,
  unlockMinigame,
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
import { MinigameId } from './types';

test('town arcade minigames start locked and must be unlocked sequentially with escalating costs', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 5000 };

  // All start locked
  assert.equal(isMinigameUnlocked(state.minigames, 'mine'), false);
  assert.equal(isMinigameUnlocked(state.minigames, 'reactor'), false);
  assert.equal(getMinigameUnlockCost(state.minigames), 600);

  // Exchange fails when locked
  const lockedExchange = exchangeMoneyToMinigameCurrency(state, 'mine', 100);
  assert.equal(lockedExchange.success, false);

  // 1st unlock: Mine ($600)
  const u1 = unlockMinigame(state, 'mine');
  assert.equal(u1.success, true);
  assert.equal(u1.cost, 600);
  state = u1.newState;
  assert.equal(state.capital, 5000 - 600);
  assert.equal(isMinigameUnlocked(state.minigames, 'mine'), true);

  // 2nd unlock cost escalates to $3,500
  assert.equal(getMinigameUnlockCost(state.minigames), 3500);

  // Fails with insufficient capital
  state = { ...state, capital: 2000 };
  const u2Fail = unlockMinigame(state, 'reactor');
  assert.equal(u2Fail.success, false);

  // Succeeds when sufficient
  state = { ...state, capital: 4000 };
  const u2 = unlockMinigame(state, 'reactor');
  assert.equal(u2.success, true);
  assert.equal(u2.cost, 3500);
  state = u2.newState;
  assert.equal(state.capital, 4000 - 3500);
  assert.equal(isMinigameUnlocked(state.minigames, 'reactor'), true);

  // 3rd unlock cost escalates to $25,000
  assert.equal(getMinigameUnlockCost(state.minigames), 25000);
});

test('one-way exchange converts main money into all 7 unique minigame currencies without directly altering base income', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 10000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['mine', 'reactor', 'shipyard', 'solar', 'bio', 'collider', 'quantum'] as MinigameId[],
    },
  };
  const initialIncome = calculateTotalIncomePerSec(state);
  const initialEarnings = state.totalLifetimeEarnings;

  // Exchange $200 -> 50 Ore Shards
  const resMine = exchangeMoneyToMinigameCurrency(state, 'mine', 200);
  assert.equal(resMine.success, true);
  assert.equal(resMine.gained, 50);
  state = resMine.newState;
  assert.equal(state.minigames.mine.ore, 50);

  // Exchange $250 -> 20 Plasma Cells
  const resReactor = exchangeMoneyToMinigameCurrency(state, 'reactor', 250);
  assert.equal(resReactor.success, true);
  assert.equal(resReactor.gained, 20);
  state = resReactor.newState;
  assert.equal(state.minigames.reactor.plasma, 20);

  // Exchange $500 -> 15 Darkmatter Cores
  const resShip = exchangeMoneyToMinigameCurrency(state, 'shipyard', 500);
  assert.equal(resShip.success, true);
  assert.equal(resShip.gained, 15);
  state = resShip.newState;
  assert.equal(state.minigames.shipyard.darkmatter, 15);

  // Exchange $650 -> 22 Solar Photons
  const resSolar = exchangeMoneyToMinigameCurrency(state, 'solar', 650);
  assert.equal(resSolar.success, true);
  assert.equal(resSolar.gained, 22);
  state = resSolar.newState;
  assert.equal(state.minigames.solar.photons, 22);

  // Exchange $800 -> 20 Bio Spores
  const resBio = exchangeMoneyToMinigameCurrency(state, 'bio', 800);
  assert.equal(resBio.success, true);
  assert.equal(resBio.gained, 20);
  state = resBio.newState;
  assert.equal(state.minigames.bio.spores, 20);

  // Exchange $1200 -> 18 Collider Beams
  const resCol = exchangeMoneyToMinigameCurrency(state, 'collider', 1200);
  assert.equal(resCol.success, true);
  assert.equal(resCol.gained, 18);
  state = resCol.newState;
  assert.equal(state.minigames.collider.beamCurrency, 18);

  // Reject over-budget exchange
  const resFail = exchangeMoneyToMinigameCurrency(state, 'quantum', 500000);
  assert.equal(resFail.success, false);

  // Exchanging money alone grants zero free income or milestones
  assert.equal(calculateTotalIncomePerSec(state), initialIncome);
  assert.equal(state.totalLifetimeEarnings, initialEarnings);
  assert.equal(getMinigameIncomeBoost(state.minigames).boostPct, 0);
});

test('mine progresses depth and seismic blast without ever minting ◈ ore outside money exchange', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 10000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['mine'] as MinigameId[],
    },
  };
  state = exchangeMoneyToMinigameCurrency(state, 'mine', 1000).newState; // 250 ore
  const startingOre = state.minigames.mine.ore;
  assert.equal(startingOre, 250);

  let mine = state.minigames.mine;
  for (let i = 0; i < 20; i++) {
    mine = digMineLayer(mine);
  }
  assert.ok(mine.depth >= 3);
  assert.ok(mine.layersCleared >= 2);
  assert.equal(mine.ore, startingOre);
  assert.ok(mine.seismicCharge > 0);

  // Charge seismic blast to 100 and trigger massive blast without minting ore
  const chargedMine = { ...mine, seismicCharge: 100 };
  const blasted = triggerMineSeismicBlast(chargedMine);
  assert.equal(blasted.seismicCharge, 0);
  assert.ok(blasted.depth >= chargedMine.depth);
  assert.equal(blasted.ore, startingOre);

  const manualEval = evaluateMinigameMilestones({ ...state.minigames, mine: blasted });
  assert.ok(manualEval.newlyUnlocked.some((m) => m.id === 'ms_mine_1'));

  const upg = buyMineUpgrade({ ...mine, depth: 2, layerHp: 1, layerMaxHp: 43 }, 'autoDriller');
  assert.equal(upg.success, true);
  const oreAfterBuy = upg.mine.ore;
  assert.ok(getMineMetrics(upg.mine).autoDps > 0);

  const ticked = advanceTick({ ...state, minigames: { ...state.minigames, mine: upg.mine } }, 0.25);
  assert.ok(ticked.newState.minigames.mine.depth >= 3);
  assert.equal(ticked.newState.minigames.mine.ore, oreAfterBuy);
  assert.ok(ticked.newlyUnlockedMilestones.some((m) => m.id === 'ms_mine_1'));
});

test('4x4 reactor generates MWh progress with turbine synergy without minting ⚡ plasma, and cell removal grants 0⚡ refund', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 10000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['reactor'] as MinigameId[],
    },
  };
  state = exchangeMoneyToMinigameCurrency(state, 'reactor', 2500).newState; // 200 plasma

  let reactor = state.minigames.reactor;
  assert.equal(reactor.grid.length, 16);
  const baseMetrics = getReactorMetrics(reactor);

  // Deleting pre-placed starter fuel cell at index 5 must NOT grant free plasma
  const clearRes = placeReactorCell(reactor, 5, 'empty');
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.reactor.plasma, 200);

  // Restore fuel at 5, place generator at 1 and turbine at 6
  reactor = placeReactorCell(clearRes.reactor, 5, 'fuel').reactor; // -22 -> 178
  reactor = placeReactorCell(reactor, 1, 'generator').reactor; // -36 -> 142
  const turbRes = placeReactorCell(reactor, 6, 'turbine'); // -54 -> 88
  assert.equal(turbRes.success, true);
  reactor = turbRes.reactor;
  assert.equal(reactor.plasma, 88);

  const boostedMetrics = getReactorMetrics(reactor);
  assert.ok(boostedMetrics.rawEnergyPerSec > baseMetrics.rawEnergyPerSec);

  const tickedMg = advanceMinigamesTick({ ...state.minigames, reactor }, 2);
  assert.ok(tickedMg.reactor.totalEnergyMWh > 0);
  assert.equal(tickedMg.reactor.plasma, 88);

  // Overheat and manual vent (-38 heat)
  const overheated = { ...tickedMg.reactor, heat: 100, overheated: true };
  assert.equal(getReactorMetrics(overheated).effectiveEnergyPerSec, 0);
  const vented = ventReactorHeat(overheated);
  assert.equal(vented.heat, 62);

  // Turbine upgrade works & boosts output
  const tUpg = buyReactorUpgrade({ ...vented, plasma: 200 }, 'turbineTech');
  assert.equal(tUpg.success, true);
  assert.equal(tUpg.reactor.turbineTechLevel, 1);
});

test('shipyard 5-unit pipeline ships cargo tons without minting ✦ darkmatter, including on prestige', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 15000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['shipyard'] as MinigameId[],
    },
  };
  state = exchangeMoneyToMinigameCurrency(state, 'shipyard', 4000).newState; // 120 darkmatter

  let ship = state.minigames.shipyard;
  ship = buyShipyardUnit(ship, 'refinery').shipyard; // -14 -> 106
  ship = buyShipyardUnit(ship, 'freighter').shipyard; // -22 -> 84
  ship = buyShipyardUnit(ship, 'orbitalHub').shipyard; // -45 -> 39
  assert.equal(ship.refineryCount, 1);
  assert.equal(ship.freighterCount, 1);
  assert.equal(ship.orbitalHubCount, 1);
  assert.equal(ship.darkmatter, 39);

  ship = boostShipyardChain(ship);
  assert.ok(ship.totalCargoShipped > 0);
  assert.equal(ship.darkmatter, 39);

  const mgTicked = advanceMinigamesTick({ ...state.minigames, shipyard: ship }, 1);
  assert.ok(mgTicked.shipyard.totalCargoShipped >= ship.totalCargoShipped);
  assert.equal(mgTicked.shipyard.darkmatter, 39);

  assert.equal(prestigeShipyardFleet(ship).success, false);
  const okPre = prestigeShipyardFleet({ ...ship, totalCargoShipped: 300 });
  assert.equal(okPre.success, true);
  assert.equal(okPre.shipyard.fleetPrestigeLevel, 1);
  assert.ok(okPre.shipyard.fleetMultiplier > 2);
  assert.equal(okPre.shipyard.darkmatter, 39);
});

test('quantum lab wave tuning, cryo, and dimensional leap accumulate RP without minting ⚛ qubits', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 10000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['quantum'] as MinigameId[],
    },
  };
  state = exchangeMoneyToMinigameCurrency(state, 'quantum', 2000).newState; // 90 qubits
  assert.equal(state.minigames.quantum.qubits, 90);

  let q = state.minigames.quantum;
  q = tuneQuantumWave(q, 0, q.targetWave[0]);
  q = tuneQuantumWave(q, 1, q.targetWave[1]);
  q = tuneQuantumWave(q, 2, q.targetWave[2]);

  const metrics = getQuantumMetrics(q);
  assert.equal(metrics.matchedChannels, 3);
  assert.equal(metrics.resonanceMult, 3.4);

  for (let i = 0; i < 5; i++) {
    q = pulseQuantumExperiment(q);
  }
  assert.ok(q.experimentsCompleted >= 1);
  assert.ok(q.researchPoints > 0);
  assert.equal(q.qubits, 90);

  const upg = buyQuantumUpgrade(q, 'cryo');
  assert.equal(upg.success, true);
  assert.equal(upg.quantum.cryoLevel, 1);

  const leapFail = leapQuantumDimension(upg.quantum);
  assert.equal(leapFail.success, false);
  const leapOk = leapQuantumDimension({ ...upg.quantum, experimentsCompleted: metrics.leapReq });
  assert.equal(leapOk.success, true);
  assert.equal(leapOk.quantum.leapCount, 1);
  assert.ok(leapOk.quantum.leapMultiplier > 2);
  assert.equal(leapOk.quantum.qubits, upg.quantum.qubits);
});

test('expanded minigames (Solar, BioDome, Collider) advance milestones without minting currencies', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = {
    ...createInitialGameState(seoul),
    capital: 50_000,
    minigames: {
      ...createInitialGameState(seoul).minigames,
      unlockedGameIds: ['solar', 'bio', 'collider'] as MinigameId[],
    },
  };
  state = exchangeMoneyToMinigameCurrency(state, 'solar', 650).newState; // 22 photons
  state = exchangeMoneyToMinigameCurrency(state, 'bio', 800).newState; // 20 spores
  state = exchangeMoneyToMinigameCurrency(state, 'collider', 1200).newState; // 18 beams

  // 1. Solar
  let solar = setSolarOrbitalAngle(state.minigames.solar, state.minigames.solar.optimalAngle);
  assert.equal(getSolarMetrics(solar).alignmentMult, 3.0);
  solar = pulseSolarArray(solar);
  assert.ok(solar.totalPowerGW > 0);
  assert.equal(solar.photons, 22);
  const solarBuy = buySolarUpgrade(solar, 'mirror');
  assert.equal(solarBuy.success, true);
  assert.equal(solarBuy.solar.mirrorCount, 2);

  // 2. BioDome
  let bio = state.minigames.bio;
  assert.equal(getBioMetrics(bio).isOptimalHumidity, true);
  bio = cultivateBioDome(bio);
  assert.ok(bio.totalBiomass > 0);
  assert.equal(bio.spores, 20);
  bio = mistBioHumidity(bio, 10);
  assert.ok(bio.humidity <= 95);
  const bioBuy = buyBioUpgrade(bio, 'algae');
  assert.equal(bioBuy.success, true);
  const evolved = evolveBioDome({ ...bioBuy.bio, totalBiomass: 700 });
  assert.equal(evolved.success, true);
  assert.equal(evolved.bio.evolutionLevel, 1);
  assert.equal(evolved.bio.spores, bioBuy.bio.spores);

  // 3. Collider
  let col = state.minigames.collider;
  for (let i = 0; i < 5; i++) col = collideParticles(col);
  assert.ok(col.totalCollisions > 0);
  assert.equal(col.luminosity, 100);
  col = triggerColliderBurst(col);
  assert.equal(col.luminosity, 0);
  assert.equal(col.exoticParticles, 1);
  assert.equal(col.beamCurrency, 18);
  const colBuy = buyColliderUpgrade(col, 'magnet');
  assert.equal(colBuy.success, true);
  assert.ok(getColliderMetrics(colBuy.collider).tevPerSec > getColliderMetrics(col).tevPerSec);

  // Verify total 56 milestones across all 7 games (8 tiers each)
  assert.equal(MINIGAME_MILESTONES.length, 56);
});

test('minigame milestone achievements directly boost main Road Incremental money income', () => {
  const seoul = PRESET_CITIES.find((c) => c.id === 'seoul')!;
  let state = { ...createInitialGameState(seoul), capital: 50000 };

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

  const progressedMg = evaluateMinigameMilestones({
    ...state.minigames,
    mine: { ...state.minigames.mine, depth: 3, layersCleared: 2 },
    quantum: { ...state.minigames.quantum, researchPoints: 65, experimentsCompleted: 5 },
  }).minigames;

  const boostedState = { ...state, minigames: progressedMg };
  const summary = getMinigameMilestoneSummary(boostedState.minigames);
  assert.equal(summary.unlockedCount, 2);
  assert.equal(summary.totalBoostPct, 10);
  assert.equal(Number(summary.incomeMult.toFixed(4)), 1.1025);
  assert.ok(summary.buildCostMult < 1, 'Unlocked minigame milestones should discount build costs');

  const mults = calculateMultipliers(boostedState);
  assert.equal(mults.minigameBoostPct, 10);
  assert.equal(Number(mults.minigameIncomeMult.toFixed(4)), 1.1025);

  const boostedIncome = calculateTotalIncomePerSec(boostedState);
  assert.equal(Math.round(boostedIncome), Math.round(baseIncome * 1.1025));
});
