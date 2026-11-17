import {
  GameState,
  MineGameState,
  MinigameId,
  MinigameMilestoneDef,
  MinigamesState,
  QuantumGameState,
  ReactorCellType,
  ReactorGameState,
  ShipyardGameState,
} from './types';

export interface MinigameMeta {
  id: MinigameId;
  name: string;
  shortName: string;
  subtitle: string;
  currencyName: string;
  currencySymbol: string;
  moneyPerBatch: number;
  currencyPerBatch: number;
  accentColor: string;
}

export const MINIGAME_META: Record<MinigameId, MinigameMeta> = {
  mine: {
    id: 'mine',
    name: '지하 광산 채굴',
    shortName: '광산',
    subtitle: '암반 층위를 뚫고 지하 심부 마일스톤을 돌파하는 드릴 인크리멘탈',
    currencyName: '광석 조각',
    currencySymbol: '◈',
    moneyPerBatch: 100,
    currencyPerBatch: 25,
    accentColor: '#f59e0b',
  },
  reactor: {
    id: 'reactor',
    name: '원자로 전력망',
    shortName: '원자로',
    subtitle: '3×3 코어 인접 시너지와 열 과클럭으로 전력을 생산하는 발전 퍼즐',
    currencyName: '플라즈마 셀',
    currencySymbol: '⚡',
    moneyPerBatch: 250,
    currencyPerBatch: 20,
    accentColor: '#22d3ee',
  },
  shipyard: {
    id: 'shipyard',
    name: '심우주 물류 공방',
    shortName: '우주공방',
    subtitle: '합금 → 반물질 → 성간 화물로 이어지는 3단 자동 생산 라인',
    currencyName: '다크매터 코어',
    currencySymbol: '✦',
    moneyPerBatch: 500,
    currencyPerBatch: 15,
    accentColor: '#818cf8',
  },
  quantum: {
    id: 'quantum',
    name: '퀀텀 연구소',
    shortName: '퀀텀연구소',
    subtitle: '3채널 파형 공명을 조율해 양자 연구 데이터를 축적하는 실험실',
    currencyName: '퀀텀 큐빗',
    currencySymbol: '⚛',
    moneyPerBatch: 400,
    currencyPerBatch: 18,
    accentColor: '#34d399',
  },
};

export const MINIGAME_ORDER: MinigameId[] = ['mine', 'reactor', 'shipyard', 'quantum'];

// ============================================================================
// MILESTONES (Minigame Progress -> Permanent Main Game Money Income Boost)
// ============================================================================

export const MINIGAME_MILESTONES: MinigameMilestoneDef[] = [
  // 1. Mine (Depth)
  {
    id: 'ms_mine_1',
    gameId: 'mine',
    tier: 1,
    title: '표층 암반 돌파',
    description: '지하 깊이 Lv.3 도달',
    targetValue: 3,
    unitLabel: '층',
    incomeBoostPct: 15,
  },
  {
    id: 'ms_mine_2',
    gameId: 'mine',
    tier: 2,
    title: '기반암 굴착 개시',
    description: '지하 깊이 Lv.7 도달',
    targetValue: 7,
    unitLabel: '층',
    incomeBoostPct: 25,
  },
  {
    id: 'ms_mine_3',
    gameId: 'mine',
    tier: 3,
    title: '상부 맨틀 진입',
    description: '지하 깊이 Lv.15 도달',
    targetValue: 15,
    unitLabel: '층',
    incomeBoostPct: 45,
  },
  {
    id: 'ms_mine_4',
    gameId: 'mine',
    tier: 4,
    title: '외핵 관통 시추',
    description: '지하 깊이 Lv.28 도달',
    targetValue: 28,
    unitLabel: '층',
    incomeBoostPct: 80,
  },
  {
    id: 'ms_mine_5',
    gameId: 'mine',
    tier: 5,
    title: '지구 내핵 정복',
    description: '지하 깊이 Lv.50 도달',
    targetValue: 50,
    unitLabel: '층',
    incomeBoostPct: 150,
  },

  // 2. Reactor (Cumulative MWh)
  {
    id: 'ms_reactor_1',
    gameId: 'reactor',
    tier: 1,
    title: '시운전 송전 개시',
    description: '누적 발전량 100 MWh 달성',
    targetValue: 100,
    unitLabel: 'MWh',
    incomeBoostPct: 15,
  },
  {
    id: 'ms_reactor_2',
    gameId: 'reactor',
    tier: 2,
    title: '도시 전력망 직결',
    description: '누적 발전량 350 MWh 달성',
    targetValue: 350,
    unitLabel: 'MWh',
    incomeBoostPct: 25,
  },
  {
    id: 'ms_reactor_3',
    gameId: 'reactor',
    tier: 3,
    title: '초전도 과클럭 가동',
    description: '누적 발전량 1,800 MWh 달성',
    targetValue: 1800,
    unitLabel: 'MWh',
    incomeBoostPct: 45,
  },
  {
    id: 'ms_reactor_4',
    gameId: 'reactor',
    tier: 4,
    title: '핵융합 기가 그리드',
    description: '누적 발전량 9,000 MWh 달성',
    targetValue: 9000,
    unitLabel: 'MWh',
    incomeBoostPct: 80,
  },
  {
    id: 'ms_reactor_5',
    gameId: 'reactor',
    tier: 5,
    title: '행성 무한 청정 동력',
    description: '누적 발전량 45,000 MWh 달성',
    targetValue: 45000,
    unitLabel: 'MWh',
    incomeBoostPct: 150,
  },

  // 3. Shipyard (Cumulative Interstellar Cargo Shipped, tons)
  {
    id: 'ms_ship_1',
    gameId: 'shipyard',
    tier: 1,
    title: '첫 궤도 화물 선적',
    description: '성간 화물 누적 80 t 수송',
    targetValue: 80,
    unitLabel: 't',
    incomeBoostPct: 15,
  },
  {
    id: 'ms_ship_2',
    gameId: 'shipyard',
    tier: 2,
    title: '반물질 보급선 완편',
    description: '성간 화물 누적 450 t 수송',
    targetValue: 450,
    unitLabel: 't',
    incomeBoostPct: 25,
  },
  {
    id: 'ms_ship_3',
    gameId: 'shipyard',
    tier: 3,
    title: '성간 물류 허브 구축',
    description: '성간 화물 누적 2,200 t 수송',
    targetValue: 2200,
    unitLabel: 't',
    incomeBoostPct: 45,
  },
  {
    id: 'ms_ship_4',
    gameId: 'shipyard',
    tier: 4,
    title: '초공간 수송 대함대',
    description: '성간 화물 누적 12,000 t 수송',
    targetValue: 12000,
    unitLabel: 't',
    incomeBoostPct: 80,
  },
  {
    id: 'ms_ship_5',
    gameId: 'shipyard',
    tier: 5,
    title: '은하 물류 패권 달성',
    description: '성간 화물 누적 60,000 t 수송',
    targetValue: 60000,
    unitLabel: 't',
    incomeBoostPct: 150,
  },

  // 4. Quantum Lab (Cumulative Research Points, RP)
  {
    id: 'ms_quantum_1',
    gameId: 'quantum',
    tier: 1,
    title: '초기 파동 공명 관측',
    description: '누적 양자 연구 60 RP 달성',
    targetValue: 60,
    unitLabel: 'RP',
    incomeBoostPct: 15,
  },
  {
    id: 'ms_quantum_2',
    gameId: 'quantum',
    tier: 2,
    title: '양자 얽힘 실증 완료',
    description: '누적 양자 연구 160 RP 달성',
    targetValue: 160,
    unitLabel: 'RP',
    incomeBoostPct: 25,
  },
  {
    id: 'ms_quantum_3',
    gameId: 'quantum',
    tier: 3,
    title: '초전도 큐빗 어레이',
    description: '누적 양자 연구 850 RP 달성',
    targetValue: 850,
    unitLabel: 'RP',
    incomeBoostPct: 45,
  },
  {
    id: 'ms_quantum_4',
    gameId: 'quantum',
    tier: 4,
    title: '시공간 연산 돌파',
    description: '누적 양자 연구 4,500 RP 달성',
    targetValue: 4500,
    unitLabel: 'RP',
    incomeBoostPct: 80,
  },
  {
    id: 'ms_quantum_5',
    gameId: 'quantum',
    tier: 5,
    title: '특이점 관제 완성',
    description: '누적 양자 연구 25,000 RP 달성',
    targetValue: 25000,
    unitLabel: 'RP',
    incomeBoostPct: 150,
  },
];

export interface MinigameMilestoneStatus {
  def: MinigameMilestoneDef;
  currentValue: number;
  achieved: boolean;
  progressPct: number;
}

export function getMinigameProgressValue(mg: MinigamesState, gameId: MinigameId): number {
  switch (gameId) {
    case 'mine':
      return mg.mine.depth;
    case 'reactor':
      return mg.reactor.totalEnergyMWh;
    case 'shipyard':
      return mg.shipyard.totalCargoShipped;
    case 'quantum':
      return mg.quantum.researchPoints;
  }
}

export function evaluateMinigameMilestones(mg: MinigamesState): {
  minigames: MinigamesState;
  newlyUnlocked: MinigameMilestoneDef[];
} {
  const existingSet = new Set(mg.unlockedMilestoneIds || []);
  const newlyUnlocked: MinigameMilestoneDef[] = [];

  for (const ms of MINIGAME_MILESTONES) {
    const val = getMinigameProgressValue(mg, ms.gameId);
    if (val >= ms.targetValue && !existingSet.has(ms.id)) {
      existingSet.add(ms.id);
      newlyUnlocked.push(ms);
    }
  }

  if (newlyUnlocked.length === 0) {
    return { minigames: mg, newlyUnlocked: [] };
  }

  return {
    minigames: {
      ...mg,
      unlockedMilestoneIds: Array.from(existingSet),
    },
    newlyUnlocked,
  };
}

export function getMinigameMilestoneSummary(mg: MinigamesState, filterGameId?: MinigameId) {
  const statuses: MinigameMilestoneStatus[] = [];
  let totalBoostPct = 0;
  let unlockedCount = 0;

  for (const ms of MINIGAME_MILESTONES) {
    const val = getMinigameProgressValue(mg, ms.gameId);
    const achieved =
      val >= ms.targetValue || (mg.unlockedMilestoneIds || []).includes(ms.id);
    if (achieved) {
      totalBoostPct += ms.incomeBoostPct;
      unlockedCount += 1;
    }
    if (!filterGameId || ms.gameId === filterGameId) {
      statuses.push({
        def: ms,
        currentValue: val,
        achieved,
        progressPct: Math.min(100, Math.max(0, (val / ms.targetValue) * 100)),
      });
    }
  }

  return {
    unlockedCount,
    totalCount: MINIGAME_MILESTONES.length,
    totalBoostPct,
    incomeMult: 1 + totalBoostPct / 100,
    statuses,
  };
}

export function getMinigameIncomeBoost(mg?: MinigamesState | null): {
  boostPct: number;
  incomeMult: number;
  unlockedCount: number;
  totalCount: number;
} {
  if (!mg) {
    return {
      boostPct: 0,
      incomeMult: 1,
      unlockedCount: 0,
      totalCount: MINIGAME_MILESTONES.length,
    };
  }
  const summary = getMinigameMilestoneSummary(mg);
  return {
    boostPct: summary.totalBoostPct,
    incomeMult: summary.incomeMult,
    unlockedCount: summary.unlockedCount,
    totalCount: summary.totalCount,
  };
}

function computeNextTargetWave(seedIndex: number): [number, number, number] {
  const a = ((seedIndex * 3 + 1) % 5) + 1;
  const b = ((seedIndex * 7 + 2) % 5) + 1;
  const c = ((seedIndex * 11 + 4) % 5) + 1;
  return [a, b, c];
}

export function createInitialMinigamesState(): MinigamesState {
  return {
    totalMoneyInvested: 0,
    unlockedMilestoneIds: [],
    mine: {
      ore: 0,
      totalOreEarned: 0,
      depth: 1,
      layersCleared: 0,
      layerHp: 35,
      layerMaxHp: 35,
      isGemVein: false,
      drillLevel: 0,
      autoDrillerLevel: 0,
      laserLevel: 0,
      blastLevel: 0,
    },
    reactor: {
      plasma: 0,
      totalPlasmaEarned: 0,
      totalEnergyMWh: 0,
      heat: 18,
      overheated: false,
      grid: ['empty', 'empty', 'empty', 'empty', 'fuel', 'empty', 'empty', 'empty', 'empty'],
      coreEfficiencyLevel: 0,
      coolantTechLevel: 0,
      autoVentUnlocked: false,
    },
    shipyard: {
      darkmatter: 0,
      totalDarkmatterEarned: 0,
      totalCargoShipped: 0,
      alloyParts: 0,
      antimatter: 0,
      droneCount: 1,
      refineryCount: 0,
      freighterCount: 0,
      fleetPrestigeLevel: 0,
      fleetMultiplier: 1,
    },
    quantum: {
      qubits: 0,
      totalQubitsEarned: 0,
      researchPoints: 0,
      experimentProgress: 0,
      experimentsCompleted: 0,
      targetWave: [2, 4, 1],
      tunedWave: [2, 1, 1],
      acceleratorLevel: 0,
      amplifierLevel: 0,
      entanglementLevel: 0,
    },
  };
}

export function backfillMinigamesState(raw?: Partial<MinigamesState> | null): MinigamesState {
  const base = createInitialMinigamesState();
  if (!raw || typeof raw !== 'object') return base;

  const merged: MinigamesState = {
    totalMoneyInvested: Number(raw.totalMoneyInvested) || 0,
    unlockedMilestoneIds: Array.isArray(raw.unlockedMilestoneIds)
      ? [...raw.unlockedMilestoneIds]
      : [],
    mine: {
      ...base.mine,
      ...(raw.mine || {}),
      layersCleared:
        typeof raw.mine?.layersCleared === 'number'
          ? raw.mine.layersCleared
          : Math.max(0, (raw.mine?.depth ?? 1) - 1),
    },
    reactor: {
      ...base.reactor,
      ...(raw.reactor || {}),
      totalEnergyMWh: Number(raw.reactor?.totalEnergyMWh) || 0,
      grid:
        Array.isArray(raw.reactor?.grid) && raw.reactor!.grid.length === 9
          ? [...raw.reactor!.grid]
          : [...base.reactor.grid],
    },
    shipyard: {
      ...base.shipyard,
      ...(raw.shipyard || {}),
      totalCargoShipped: Number(raw.shipyard?.totalCargoShipped) || 0,
    },
    quantum: {
      ...base.quantum,
      ...(raw.quantum || {}),
      researchPoints: Number(raw.quantum?.researchPoints) || 0,
      targetWave:
        Array.isArray(raw.quantum?.targetWave) && raw.quantum!.targetWave.length === 3
          ? ([...raw.quantum!.targetWave] as [number, number, number])
          : [...base.quantum.targetWave],
      tunedWave:
        Array.isArray(raw.quantum?.tunedWave) && raw.quantum!.tunedWave.length === 3
          ? ([...raw.quantum!.tunedWave] as [number, number, number])
          : [...base.quantum.tunedWave],
    },
  };

  return evaluateMinigameMilestones(merged).minigames;
}

/**
 * STRICT ONE-WAY & EXCLUSIVE CURRENCY EXCHANGE:
 * Minigame unique currencies (◈, ⚡, ✦, ⚛) can ONLY be obtained through
 * Main Game Capital ($) -> Selected Minigame Currency exchange.
 * Minigame gameplay advances progress toward Milestones, which grant permanent
 * main money income boosts instead of minting minigame or main currency directly.
 */
export function calculateExchangePreview(gameId: MinigameId, moneyAmount: number): number {
  if (!Number.isFinite(moneyAmount) || moneyAmount <= 0) return 0;
  const meta = MINIGAME_META[gameId];
  return Math.floor((moneyAmount / meta.moneyPerBatch) * meta.currencyPerBatch);
}

export function exchangeMoneyToMinigameCurrency(
  state: GameState,
  gameId: MinigameId,
  moneyAmount: number
): { success: boolean; newState: GameState; gained: number } {
  const cleanAmount = Math.floor(moneyAmount);
  if (cleanAmount <= 0 || state.capital < cleanAmount) {
    return { success: false, newState: state, gained: 0 };
  }

  const gained = calculateExchangePreview(gameId, cleanAmount);
  if (gained <= 0) {
    return { success: false, newState: state, gained: 0 };
  }

  const mg = backfillMinigamesState(state.minigames);
  const nextMg: MinigamesState = {
    ...mg,
    totalMoneyInvested: mg.totalMoneyInvested + cleanAmount,
  };

  if (gameId === 'mine') {
    nextMg.mine = {
      ...mg.mine,
      ore: mg.mine.ore + gained,
      totalOreEarned: mg.mine.totalOreEarned + gained,
    };
  } else if (gameId === 'reactor') {
    nextMg.reactor = {
      ...mg.reactor,
      plasma: mg.reactor.plasma + gained,
      totalPlasmaEarned: mg.reactor.totalPlasmaEarned + gained,
    };
  } else if (gameId === 'shipyard') {
    nextMg.shipyard = {
      ...mg.shipyard,
      darkmatter: mg.shipyard.darkmatter + gained,
      totalDarkmatterEarned: mg.shipyard.totalDarkmatterEarned + gained,
    };
  } else {
    nextMg.quantum = {
      ...mg.quantum,
      qubits: mg.quantum.qubits + gained,
      totalQubitsEarned: mg.quantum.totalQubitsEarned + gained,
    };
  }

  return {
    success: true,
    gained,
    newState: {
      ...state,
      capital: state.capital - cleanAmount,
      minigames: nextMg,
    },
  };
}

// ============================================================================
// 1. DEEP CORE MINE (◈ Ore Shards -> Depth Milestones)
// ============================================================================

export function getMineMetrics(mine: MineGameState) {
  const laserMult = 1 + mine.laserLevel * 0.45;
  const blastMult = 1 + mine.blastLevel * 0.35;
  const veinPierceMult = mine.isGemVein ? 1.5 : 1;

  const clickDamage = Math.round(
    (9 + mine.drillLevel * 12) * Math.pow(1.22, mine.drillLevel) * blastMult * laserMult * veinPierceMult
  );
  const autoDps =
    mine.autoDrillerLevel > 0
      ? Math.round(
          mine.autoDrillerLevel *
            7.5 *
            Math.pow(1.24, mine.autoDrillerLevel - 1) *
            blastMult *
            laserMult
        )
      : 0;
  return { clickDamage, autoDps, laserMult };
}

export type MineUpgradeKind = 'drill' | 'autoDriller' | 'laser' | 'blast';

export function getMineUpgradeCost(mine: MineGameState, kind: MineUpgradeKind): number {
  switch (kind) {
    case 'drill':
      return Math.round(18 * Math.pow(1.55, mine.drillLevel));
    case 'autoDriller':
      return Math.round(30 * Math.pow(1.62, mine.autoDrillerLevel));
    case 'laser':
      return Math.round(45 * Math.pow(1.75, mine.laserLevel));
    case 'blast':
      return Math.round(80 * Math.pow(1.85, mine.blastLevel));
  }
}

function applyMineDamage(mine: MineGameState, damage: number): MineGameState {
  if (damage <= 0) return mine;
  let next = { ...mine };
  let remaining = damage;
  let breaks = 0;

  while (remaining > 0 && breaks < 5) {
    if (remaining < next.layerHp) {
      next.layerHp = Math.max(0, next.layerHp - remaining);
      remaining = 0;
    } else {
      remaining -= next.layerHp;
      // Clearing a layer advances mine depth/layersCleared toward milestones ONLY;
      // ore currency is strictly exchange-only ($ -> ◈).
      next.depth += 1;
      next.layersCleared += 1;
      next.isGemVein = next.depth % 4 === 0;
      const newMaxHp = Math.round(35 * Math.pow(1.22, next.depth - 1));
      next.layerMaxHp = newMaxHp;
      next.layerHp = newMaxHp;
      breaks += 1;
    }
  }
  return next;
}

export function digMineLayer(mine: MineGameState): MineGameState {
  const { clickDamage } = getMineMetrics(mine);
  return applyMineDamage(mine, clickDamage);
}

export function buyMineUpgrade(
  mine: MineGameState,
  kind: MineUpgradeKind
): { success: boolean; mine: MineGameState } {
  const cost = getMineUpgradeCost(mine, kind);
  if (mine.ore < cost) return { success: false, mine };
  const next = { ...mine, ore: mine.ore - cost };
  if (kind === 'drill') next.drillLevel += 1;
  else if (kind === 'autoDriller') next.autoDrillerLevel += 1;
  else if (kind === 'laser') next.laserLevel += 1;
  else next.blastLevel += 1;
  return { success: true, mine: next };
}

// ============================================================================
// 2. FUSION POWER PLANT (⚡ Plasma Cells -> Cumulative MWh Milestones)
// ============================================================================

export const REACTOR_CELL_COST: Record<Exclude<ReactorCellType, 'empty'>, number> = {
  fuel: 22,
  generator: 36,
  coolant: 30,
};

function getAdjacentGridIndices(idx: number): number[] {
  const row = Math.floor(idx / 3);
  const col = idx % 3;
  const out: number[] = [];
  if (row > 0) out.push(idx - 3);
  if (row < 2) out.push(idx + 3);
  if (col > 0) out.push(idx - 1);
  if (col < 2) out.push(idx + 1);
  return out;
}

export function getReactorMetrics(reactor: ReactorGameState) {
  let rawEnergyPerSec = 0;
  let heatGenPerSec = 0;
  let coolingPerSec = 2.0; // Natural ambient cooling

  const effMult = Math.pow(1.32, reactor.coreEfficiencyLevel);

  reactor.grid.forEach((cell, idx) => {
    const neighbors = getAdjacentGridIndices(idx);
    if (cell === 'fuel') {
      const adjGenerators = neighbors.filter((n) => reactor.grid[n] === 'generator').length;
      const adjCoolants = neighbors.filter((n) => reactor.grid[n] === 'coolant').length;
      const fuelOutput = 1.6 * (1 + adjGenerators * 0.55 + adjCoolants * 0.25) * effMult;
      rawEnergyPerSec += fuelOutput;
      heatGenPerSec += 3.6 + adjGenerators * 1.3;
    } else if (cell === 'coolant') {
      coolingPerSec += 5.4 + reactor.coolantTechLevel * 3.0;
    }
  });

  const isOverclockZone = !reactor.overheated && reactor.heat >= 45 && reactor.heat <= 88;
  const overclockMult = isOverclockZone ? 1.6 : 1;
  const effectiveEnergyPerSec = reactor.overheated ? 0 : rawEnergyPerSec * overclockMult;
  const netHeatPerSec = heatGenPerSec - coolingPerSec;

  return {
    rawEnergyPerSec,
    effectiveEnergyPerSec,
    heatGenPerSec,
    coolingPerSec,
    netHeatPerSec,
    isOverclockZone,
  };
}

export function placeReactorCell(
  reactor: ReactorGameState,
  cellIndex: number,
  cellType: ReactorCellType
): { success: boolean; reactor: ReactorGameState } {
  if (cellIndex < 0 || cellIndex >= 9) return { success: false, reactor };
  const current = reactor.grid[cellIndex];
  if (current === cellType) return { success: false, reactor };

  // Strict exchange-only rule: removing or overwriting a cell never generates or refunds ⚡ currency.
  const price = cellType !== 'empty' ? REACTOR_CELL_COST[cellType] : 0;

  if (reactor.plasma < price) {
    return { success: false, reactor };
  }

  const nextGrid = [...reactor.grid];
  nextGrid[cellIndex] = cellType;
  return {
    success: true,
    reactor: {
      ...reactor,
      plasma: reactor.plasma - price,
      grid: nextGrid,
    },
  };
}

export function ventReactorHeat(reactor: ReactorGameState): ReactorGameState {
  const nextHeat = Math.max(0, reactor.heat - 35);
  return {
    ...reactor,
    heat: nextHeat,
    overheated: reactor.overheated && nextHeat > 35,
  };
}

export type ReactorUpgradeKind = 'efficiency' | 'coolantTech' | 'autoVent';

export function getReactorUpgradeCost(
  reactor: ReactorGameState,
  kind: ReactorUpgradeKind
): number {
  switch (kind) {
    case 'efficiency':
      return Math.round(35 * Math.pow(1.75, reactor.coreEfficiencyLevel));
    case 'coolantTech':
      return Math.round(30 * Math.pow(1.68, reactor.coolantTechLevel));
    case 'autoVent':
      return 120;
  }
}

export function buyReactorUpgrade(
  reactor: ReactorGameState,
  kind: ReactorUpgradeKind
): { success: boolean; reactor: ReactorGameState } {
  if (kind === 'autoVent' && reactor.autoVentUnlocked) {
    return { success: false, reactor };
  }
  const cost = getReactorUpgradeCost(reactor, kind);
  if (reactor.plasma < cost) return { success: false, reactor };

  const next = { ...reactor, plasma: reactor.plasma - cost };
  if (kind === 'efficiency') next.coreEfficiencyLevel += 1;
  else if (kind === 'coolantTech') next.coolantTechLevel += 1;
  else next.autoVentUnlocked = true;
  return { success: true, reactor: next };
}

// ============================================================================
// 3. ORBITAL SHIPYARD & FACTORY (✦ Darkmatter Cores -> Cargo Shipped Milestones)
// ============================================================================

export type ShipyardUnitKind = 'drone' | 'refinery' | 'freighter';

export function getShipyardUnitCost(shipyard: ShipyardGameState, kind: ShipyardUnitKind): number {
  switch (kind) {
    case 'drone':
      return Math.round(10 * Math.pow(1.42, shipyard.droneCount - 1));
    case 'refinery':
      return Math.round(14 * Math.pow(1.5, shipyard.refineryCount));
    case 'freighter':
      return Math.round(22 * Math.pow(1.62, shipyard.freighterCount));
  }
}

export function getShipyardMetrics(shipyard: ShipyardGameState) {
  const mult = shipyard.fleetMultiplier;
  const alloyPerSec =
    shipyard.droneCount * 2.5 * Math.pow(1.16, Math.max(0, shipyard.droneCount - 1)) * mult;
  const maxRefineAlloyPerSec = shipyard.refineryCount * 2.2 * mult;
  const antimatterPerSecCap = maxRefineAlloyPerSec * 0.6;
  const maxShipAntimatterPerSec = shipyard.freighterCount * 1.4 * mult;
  const cargoPerSecCap = maxShipAntimatterPerSec * 1.8;
  const prestigeReq = Math.round(220 * Math.pow(3.2, shipyard.fleetPrestigeLevel));
  return {
    alloyPerSec,
    maxRefineAlloyPerSec,
    antimatterPerSecCap,
    maxShipAntimatterPerSec,
    cargoPerSecCap,
    prestigeReq,
  };
}

export function buyShipyardUnit(
  shipyard: ShipyardGameState,
  kind: ShipyardUnitKind
): { success: boolean; shipyard: ShipyardGameState } {
  const cost = getShipyardUnitCost(shipyard, kind);
  if (shipyard.darkmatter < cost) return { success: false, shipyard };
  const next = { ...shipyard, darkmatter: shipyard.darkmatter - cost };
  if (kind === 'drone') next.droneCount += 1;
  else if (kind === 'refinery') next.refineryCount += 1;
  else next.freighterCount += 1;
  return { success: true, shipyard: next };
}

export function boostShipyardChain(shipyard: ShipyardGameState): ShipyardGameState {
  const { alloyPerSec } = getShipyardMetrics(shipyard);
  const bonusAlloy = Math.max(5, alloyPerSec * 2.5);
  let nextAlloy = shipyard.alloyParts + bonusAlloy;
  let nextAnti = shipyard.antimatter;
  let totalCargo = shipyard.totalCargoShipped;

  if (shipyard.refineryCount > 0 && nextAlloy > 0) {
    const refined = Math.min(nextAlloy, shipyard.refineryCount * 3 * shipyard.fleetMultiplier);
    nextAlloy -= refined;
    nextAnti += refined * 0.6;
  }
  if (shipyard.freighterCount > 0 && nextAnti > 0) {
    const shipped = Math.min(nextAnti, shipyard.freighterCount * 2 * shipyard.fleetMultiplier);
    nextAnti -= shipped;
    totalCargo += shipped * 1.8;
  }

  return {
    ...shipyard,
    alloyParts: nextAlloy,
    antimatter: nextAnti,
    totalCargoShipped: totalCargo,
  };
}

export function prestigeShipyardFleet(shipyard: ShipyardGameState): {
  success: boolean;
  shipyard: ShipyardGameState;
} {
  const { prestigeReq } = getShipyardMetrics(shipyard);
  if (shipyard.totalCargoShipped < prestigeReq) {
    return { success: false, shipyard };
  }
  const nextLevel = shipyard.fleetPrestigeLevel + 1;
  const nextMult = Number((shipyard.fleetMultiplier * 2.25).toFixed(2));
  return {
    success: true,
    shipyard: {
      // Never mint free ✦ currency on fleet prestige
      darkmatter: shipyard.darkmatter,
      totalDarkmatterEarned: shipyard.totalDarkmatterEarned,
      totalCargoShipped: shipyard.totalCargoShipped,
      alloyParts: 0,
      antimatter: 0,
      droneCount: 1,
      refineryCount: 0,
      freighterCount: 0,
      fleetPrestigeLevel: nextLevel,
      fleetMultiplier: nextMult,
    },
  };
}

// ============================================================================
// 4. QUANTUM RESEARCH LAB (⚛ Quantum Qubits -> Research Points Milestones)
// ============================================================================

export function getQuantumMetrics(quantum: QuantumGameState) {
  let matchedChannels = 0;
  for (let i = 0; i < 3; i++) {
    if (quantum.tunedWave[i] === quantum.targetWave[i]) {
      matchedChannels += 1;
    }
  }
  const resonanceMult =
    matchedChannels === 3
      ? 3.2
      : matchedChannels === 2
      ? 2.3
      : matchedChannels === 1
      ? 1.6
      : 1.0;

  const progressPerSec = ((1 + quantum.acceleratorLevel * 0.45) * resonanceMult) / 6.5;
  const experimentRewardRp = Math.round(
    (8 + quantum.amplifierLevel * 7) *
      Math.pow(1.24, quantum.amplifierLevel) *
      (matchedChannels === 3 ? 1.5 : 1)
  );
  const passiveRpPerSec =
    quantum.entanglementLevel * 0.85 * (1 + matchedChannels * 0.25);

  return {
    matchedChannels,
    resonanceMult,
    progressPerSec,
    experimentRewardRp,
    passiveRpPerSec,
  };
}

export function tuneQuantumWave(
  quantum: QuantumGameState,
  channelIndex: 0 | 1 | 2,
  value: number
): QuantumGameState {
  const clamped = Math.max(1, Math.min(5, Math.round(value)));
  const nextTuned: [number, number, number] = [...quantum.tunedWave] as [number, number, number];
  nextTuned[channelIndex] = clamped;
  return {
    ...quantum,
    tunedWave: nextTuned,
  };
}

export function pulseQuantumExperiment(quantum: QuantumGameState): QuantumGameState {
  const metrics = getQuantumMetrics(quantum);
  let nextProg = quantum.experimentProgress + 0.24;
  let nextRp = quantum.researchPoints;
  let nextCompleted = quantum.experimentsCompleted;
  let nextTarget = quantum.targetWave;

  if (nextProg >= 1) {
    nextProg -= 1;
    nextRp += metrics.experimentRewardRp;
    nextCompleted += 1;
    nextTarget = computeNextTargetWave(nextCompleted + 1);
  }

  return {
    ...quantum,
    experimentProgress: nextProg,
    researchPoints: nextRp,
    experimentsCompleted: nextCompleted,
    targetWave: nextTarget,
  };
}

export type QuantumUpgradeKind = 'accelerator' | 'amplifier' | 'entanglement';

export function getQuantumUpgradeCost(
  quantum: QuantumGameState,
  kind: QuantumUpgradeKind
): number {
  switch (kind) {
    case 'accelerator':
      return Math.round(16 * Math.pow(1.6, quantum.acceleratorLevel));
    case 'amplifier':
      return Math.round(22 * Math.pow(1.68, quantum.amplifierLevel));
    case 'entanglement':
      return Math.round(28 * Math.pow(1.72, quantum.entanglementLevel));
  }
}

export function buyQuantumUpgrade(
  quantum: QuantumGameState,
  kind: QuantumUpgradeKind
): { success: boolean; quantum: QuantumGameState } {
  const cost = getQuantumUpgradeCost(quantum, kind);
  if (quantum.qubits < cost) return { success: false, quantum };
  const next = { ...quantum, qubits: quantum.qubits - cost };
  if (kind === 'accelerator') next.acceleratorLevel += 1;
  else if (kind === 'amplifier') next.amplifierLevel += 1;
  else next.entanglementLevel += 1;
  return { success: true, quantum: next };
}

// ============================================================================
// UNIFIED TICK SIMULATION (CURRENCIES STAY EXCHANGE-ONLY; MILESTONES ADVANCE)
// ============================================================================

export function advanceMinigamesTick(mg: MinigamesState, dt: number): MinigamesState {
  if (dt <= 0) return mg;

  // 1. Mine Auto-Drillers -> Depth & Layers Cleared
  const mineMetrics = getMineMetrics(mg.mine);
  const nextMine =
    mineMetrics.autoDps > 0 ? applyMineDamage(mg.mine, mineMetrics.autoDps * dt) : mg.mine;

  // 2. Reactor Heat & Cumulative MWh Output (plasma currency stays exchange-only)
  const reactorMetrics = getReactorMetrics(mg.reactor);
  let nextHeat = mg.reactor.heat + reactorMetrics.netHeatPerSec * dt;
  let nextOverheated = mg.reactor.overheated;

  if (mg.reactor.overheated) {
    nextHeat = Math.max(0, mg.reactor.heat - Math.max(8, reactorMetrics.coolingPerSec * 1.4) * dt);
    if (nextHeat <= 30) {
      nextOverheated = false;
    }
  } else {
    if (mg.reactor.autoVentUnlocked && nextHeat >= 92) {
      nextHeat = Math.max(20, nextHeat - 36);
    } else if (nextHeat >= 100) {
      nextHeat = 100;
      nextOverheated = true;
    } else if (nextHeat < 0) {
      nextHeat = 0;
    }
  }
  const energyGainMWh = reactorMetrics.effectiveEnergyPerSec * dt;
  const nextReactor: ReactorGameState = {
    ...mg.reactor,
    heat: nextHeat,
    overheated: nextOverheated,
    totalEnergyMWh: mg.reactor.totalEnergyMWh + energyGainMWh,
  };

  // 3. Shipyard 3-Tier Chain -> Cumulative Cargo Shipped (darkmatter currency stays exchange-only)
  const shipMetrics = getShipyardMetrics(mg.shipyard);
  let alloy = mg.shipyard.alloyParts + shipMetrics.alloyPerSec * dt;
  let anti = mg.shipyard.antimatter;
  let cargoShipped = mg.shipyard.totalCargoShipped;

  if (shipMetrics.maxRefineAlloyPerSec > 0 && alloy > 0) {
    const consumedAlloy = Math.min(alloy, shipMetrics.maxRefineAlloyPerSec * dt);
    alloy -= consumedAlloy;
    anti += consumedAlloy * 0.6;
  }
  if (shipMetrics.maxShipAntimatterPerSec > 0 && anti > 0) {
    const shippedAnti = Math.min(anti, shipMetrics.maxShipAntimatterPerSec * dt);
    anti -= shippedAnti;
    cargoShipped += shippedAnti * 1.8;
  }
  const nextShipyard: ShipyardGameState = {
    ...mg.shipyard,
    alloyParts: alloy,
    antimatter: anti,
    totalCargoShipped: cargoShipped,
  };

  // 4. Quantum Experiment Loop -> Research Points (qubits currency stays exchange-only)
  const qMetrics = getQuantumMetrics(mg.quantum);
  let qProg = mg.quantum.experimentProgress + qMetrics.progressPerSec * dt;
  let qRp = mg.quantum.researchPoints + qMetrics.passiveRpPerSec * dt;
  let qCompleted = mg.quantum.experimentsCompleted;
  let qTarget = mg.quantum.targetWave;

  if (qProg >= 1) {
    qProg -= 1;
    qRp += qMetrics.experimentRewardRp;
    qCompleted += 1;
    qTarget = computeNextTargetWave(qCompleted + 1);
  }
  const nextQuantum: QuantumGameState = {
    ...mg.quantum,
    experimentProgress: Math.min(0.999, Math.max(0, qProg)),
    researchPoints: qRp,
    experimentsCompleted: qCompleted,
    targetWave: qTarget,
  };

  const updatedMg: MinigamesState = {
    totalMoneyInvested: mg.totalMoneyInvested,
    unlockedMilestoneIds: mg.unlockedMilestoneIds || [],
    mine: nextMine,
    reactor: nextReactor,
    shipyard: nextShipyard,
    quantum: nextQuantum,
  };

  return evaluateMinigameMilestones(updatedMg).minigames;
}
