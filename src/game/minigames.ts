import {
  BioGameState,
  ColliderGameState,
  GameState,
  MineGameState,
  MinigameId,
  MinigameMilestoneDef,
  MinigamesState,
  QuantumGameState,
  ReactorCellType,
  ReactorGameState,
  ShipyardGameState,
  SolarGameState,
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
    subtitle: '지진파 발파와 심부 굴착으로 암반 층위를 돌파하는 드릴 인크리멘탈',
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
    subtitle: '4×4 코어·터빈 인접 시너지와 열 과클럭을 조율하는 발전 그리드',
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
    subtitle: '합금 → 반물질 → 궤도 릴레이 → 워프 수송으로 이어지는 초장거리 공방',
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
    subtitle: '3채널 파형 공명·초전도 냉각·차원 도약으로 양자 데이터를 축적하는 연구소',
    currencyName: '퀀텀 큐빗',
    currencySymbol: '⚛',
    moneyPerBatch: 400,
    currencyPerBatch: 18,
    accentColor: '#34d399',
  },
  solar: {
    id: 'solar',
    name: '궤도 태양광 어레이',
    shortName: '태양광',
    subtitle: '궤도 집광 거울 각도를 맞추고 태양풍을 모아 기가와트 발전을 달성하는 어레이',
    currencyName: '광자 셀',
    currencySymbol: '☀',
    moneyPerBatch: 650,
    currencyPerBatch: 22,
    accentColor: '#facc15',
  },
  bio: {
    id: 'bio',
    name: '테라 바이오돔',
    shortName: '바이오돔',
    subtitle: '조류 → 원시림 → 생물권 진화 및 습도 균형으로 생체 에너지를 키우는 생태계',
    currencyName: '생체 포자',
    currencySymbol: '✿',
    moneyPerBatch: 800,
    currencyPerBatch: 20,
    accentColor: '#4ade80',
  },
  collider: {
    id: 'collider',
    name: '초전도 입자 가속기',
    shortName: '가속기',
    subtitle: '초전도 자석 링으로 빔 광도를 끌어올려 고에너지 입자 충돌을 일으키는 가속기',
    currencyName: '빔 에너지',
    currencySymbol: '⊕',
    moneyPerBatch: 1200,
    currencyPerBatch: 18,
    accentColor: '#f472b6',
  },
};

export const MINIGAME_ORDER: MinigameId[] = [
  'mine',
  'reactor',
  'shipyard',
  'quantum',
  'solar',
  'bio',
  'collider',
];

export const MINIGAME_UNLOCK_COSTS: number[] = [
  600,        // 1st: $600
  3500,       // 2nd: $3,500
  25000,      // 3rd: $25,000
  180000,     // 4th: $180,000
  1500000,    // 5th: $1,500,000
  15000000,   // 6th: $15,000,000
  150000000,  // 7th: $150,000,000
];

export function getMinigameUnlockCost(mg?: MinigamesState | null): number {
  const unlockedCount = (mg?.unlockedGameIds || []).length;
  const idx = Math.min(unlockedCount, MINIGAME_UNLOCK_COSTS.length - 1);
  return MINIGAME_UNLOCK_COSTS[idx];
}

export function isMinigameUnlocked(mg?: MinigamesState | null, gameId?: MinigameId): boolean {
  if (!mg || !gameId) return false;
  return (mg.unlockedGameIds || []).includes(gameId);
}

export function unlockMinigame(
  state: GameState,
  gameId: MinigameId
): { success: boolean; newState: GameState; cost: number; error?: string } {
  const currentMg = backfillMinigamesState(state.minigames);
  const unlocked = currentMg.unlockedGameIds || [];
  if (unlocked.includes(gameId)) {
    return { success: false, newState: state, cost: 0, error: '이미 잠금 해제된 미니게임입니다.' };
  }
  const cost = getMinigameUnlockCost(currentMg);
  if (state.capital < cost) {
    return { success: false, newState: state, cost, error: '보유 자금이 부족합니다.' };
  }
  const nextUnlocked = [...unlocked, gameId];
  const nextMg: MinigamesState = {
    ...currentMg,
    unlockedGameIds: nextUnlocked,
  };
  return {
    success: true,
    cost,
    newState: {
      ...state,
      capital: state.capital - cost,
      minigames: nextMg,
    },
  };
}

// ============================================================================
// MILESTONES (56 Total = 8 Tiers x 7 Minigames -> Main Money Income Boost)
// ============================================================================

export const MINIGAME_MILESTONES: MinigameMilestoneDef[] = [
  // 1. Mine (Depth)
  { id: 'ms_mine_1', gameId: 'mine', tier: 1, title: '표층 암반 돌파', description: '지하 깊이 Lv.3 도달', targetValue: 3, unitLabel: '층', incomeBoostPct: 8 },
  { id: 'ms_mine_2', gameId: 'mine', tier: 2, title: '기반암 굴착 개시', description: '지하 깊이 Lv.7 도달', targetValue: 7, unitLabel: '층', incomeBoostPct: 15 },
  { id: 'ms_mine_3', gameId: 'mine', tier: 3, title: '상부 맨틀 진입', description: '지하 깊이 Lv.15 도달', targetValue: 15, unitLabel: '층', incomeBoostPct: 25 },
  { id: 'ms_mine_4', gameId: 'mine', tier: 4, title: '외핵 관통 시추', description: '지하 깊이 Lv.28 도달', targetValue: 28, unitLabel: '층', incomeBoostPct: 40 },
  { id: 'ms_mine_5', gameId: 'mine', tier: 5, title: '지구 내핵 정복', description: '지하 깊이 Lv.50 도달', targetValue: 50, unitLabel: '층', incomeBoostPct: 60 },
  { id: 'ms_mine_6', gameId: 'mine', tier: 6, title: '마그마 공동 굴착', description: '지하 깊이 Lv.85 도달', targetValue: 85, unitLabel: '층', incomeBoostPct: 90 },
  { id: 'ms_mine_7', gameId: 'mine', tier: 7, title: '지핵 공명 시추', description: '지하 깊이 Lv.140 도달', targetValue: 140, unitLabel: '층', incomeBoostPct: 130 },
  { id: 'ms_mine_8', gameId: 'mine', tier: 8, title: '행성 관통 샤프트', description: '지하 깊이 Lv.220 도달', targetValue: 220, unitLabel: '층', incomeBoostPct: 180 },

  // 2. Reactor (Cumulative MWh)
  { id: 'ms_reactor_1', gameId: 'reactor', tier: 1, title: '시운전 송전 개시', description: '누적 발전량 100 MWh 달성', targetValue: 100, unitLabel: 'MWh', incomeBoostPct: 8 },
  { id: 'ms_reactor_2', gameId: 'reactor', tier: 2, title: '도시 전력망 직결', description: '누적 발전량 350 MWh 달성', targetValue: 350, unitLabel: 'MWh', incomeBoostPct: 15 },
  { id: 'ms_reactor_3', gameId: 'reactor', tier: 3, title: '초전도 과클럭 가동', description: '누적 발전량 1,800 MWh 달성', targetValue: 1800, unitLabel: 'MWh', incomeBoostPct: 25 },
  { id: 'ms_reactor_4', gameId: 'reactor', tier: 4, title: '핵융합 기가 그리드', description: '누적 발전량 9,000 MWh 달성', targetValue: 9000, unitLabel: 'MWh', incomeBoostPct: 40 },
  { id: 'ms_reactor_5', gameId: 'reactor', tier: 5, title: '행성 무한 청정 동력', description: '누적 발전량 45,000 MWh 달성', targetValue: 45000, unitLabel: 'MWh', incomeBoostPct: 60 },
  { id: 'ms_reactor_6', gameId: 'reactor', tier: 6, title: '테라와트 코어 배열', description: '누적 발전량 250,000 MWh 달성', targetValue: 250000, unitLabel: 'MWh', incomeBoostPct: 90 },
  { id: 'ms_reactor_7', gameId: 'reactor', tier: 7, title: '항성 플라즈마 격자', description: '누적 발전량 1,200,000 MWh 달성', targetValue: 1200000, unitLabel: 'MWh', incomeBoostPct: 130 },
  { id: 'ms_reactor_8', gameId: 'reactor', tier: 8, title: '초공간 영점 발전소', description: '누적 발전량 6,000,000 MWh 달성', targetValue: 6000000, unitLabel: 'MWh', incomeBoostPct: 180 },

  // 3. Shipyard (Cumulative Cargo Shipped, tons)
  { id: 'ms_ship_1', gameId: 'shipyard', tier: 1, title: '첫 궤도 화물 선적', description: '성간 화물 누적 80 t 수송', targetValue: 80, unitLabel: 't', incomeBoostPct: 8 },
  { id: 'ms_ship_2', gameId: 'shipyard', tier: 2, title: '반물질 보급선 완편', description: '성간 화물 누적 450 t 수송', targetValue: 450, unitLabel: 't', incomeBoostPct: 15 },
  { id: 'ms_ship_3', gameId: 'shipyard', tier: 3, title: '성간 물류 허브 구축', description: '성간 화물 누적 2,200 t 수송', targetValue: 2200, unitLabel: 't', incomeBoostPct: 25 },
  { id: 'ms_ship_4', gameId: 'shipyard', tier: 4, title: '초공간 수송 대함대', description: '성간 화물 누적 12,000 t 수송', targetValue: 12000, unitLabel: 't', incomeBoostPct: 40 },
  { id: 'ms_ship_5', gameId: 'shipyard', tier: 5, title: '은하 물류 패권 달성', description: '성간 화물 누적 60,000 t 수송', targetValue: 60000, unitLabel: 't', incomeBoostPct: 60 },
  { id: 'ms_ship_6', gameId: 'shipyard', tier: 6, title: '워프 물류 고속도로', description: '성간 화물 누적 320,000 t 수송', targetValue: 320000, unitLabel: 't', incomeBoostPct: 90 },
  { id: 'ms_ship_7', gameId: 'shipyard', tier: 7, title: '성단 수송 엘리베이터', description: '성간 화물 누적 1,500,000 t 수송', targetValue: 1500000, unitLabel: 't', incomeBoostPct: 130 },
  { id: 'ms_ship_8', gameId: 'shipyard', tier: 8, title: '다중우주 공방 함대', description: '성간 화물 누적 8,000,000 t 수송', targetValue: 8000000, unitLabel: 't', incomeBoostPct: 180 },

  // 4. Quantum Lab (Cumulative Research Points, RP)
  { id: 'ms_quantum_1', gameId: 'quantum', tier: 1, title: '초기 파동 공명 관측', description: '누적 양자 연구 60 RP 달성', targetValue: 60, unitLabel: 'RP', incomeBoostPct: 8 },
  { id: 'ms_quantum_2', gameId: 'quantum', tier: 2, title: '양자 얽힘 실증 완료', description: '누적 양자 연구 160 RP 달성', targetValue: 160, unitLabel: 'RP', incomeBoostPct: 15 },
  { id: 'ms_quantum_3', gameId: 'quantum', tier: 3, title: '초전도 큐빗 어레이', description: '누적 양자 연구 850 RP 달성', targetValue: 850, unitLabel: 'RP', incomeBoostPct: 25 },
  { id: 'ms_quantum_4', gameId: 'quantum', tier: 4, title: '시공간 연산 돌파', description: '누적 양자 연구 4,500 RP 달성', targetValue: 4500, unitLabel: 'RP', incomeBoostPct: 40 },
  { id: 'ms_quantum_5', gameId: 'quantum', tier: 5, title: '특이점 관제 완성', description: '누적 양자 연구 25,000 RP 달성', targetValue: 25000, unitLabel: 'RP', incomeBoostPct: 60 },
  { id: 'ms_quantum_6', gameId: 'quantum', tier: 6, title: '차원 위상 동기화', description: '누적 양자 연구 140,000 RP 달성', targetValue: 140000, unitLabel: 'RP', incomeBoostPct: 90 },
  { id: 'ms_quantum_7', gameId: 'quantum', tier: 7, title: '극저온 퀀텀 코어', description: '누적 양자 연구 750,000 RP 달성', targetValue: 750000, unitLabel: 'RP', incomeBoostPct: 130 },
  { id: 'ms_quantum_8', gameId: 'quantum', tier: 8, title: '다중우주 시뮬레이터', description: '누적 양자 연구 4,000,000 RP 달성', targetValue: 4000000, unitLabel: 'RP', incomeBoostPct: 180 },

  // 5. Orbital Solar Array (Cumulative Power, GW)
  { id: 'ms_solar_1', gameId: 'solar', tier: 1, title: '초기 반사경 전개', description: '누적 태양광 120 GW 집광', targetValue: 120, unitLabel: 'GW', incomeBoostPct: 8 },
  { id: 'ms_solar_2', gameId: 'solar', tier: 2, title: '정지궤도 송전 빔', description: '누적 태양광 600 GW 집광', targetValue: 600, unitLabel: 'GW', incomeBoostPct: 15 },
  { id: 'ms_solar_3', gameId: 'solar', tier: 3, title: '위상 자동 추적 완료', description: '누적 태양광 3,200 GW 집광', targetValue: 3200, unitLabel: 'GW', incomeBoostPct: 25 },
  { id: 'ms_solar_4', gameId: 'solar', tier: 4, title: '라그랑주 태양 링', description: '누적 태양광 18,000 GW 집광', targetValue: 18000, unitLabel: 'GW', incomeBoostPct: 40 },
  { id: 'ms_solar_5', gameId: 'solar', tier: 5, title: '코로나 플레어 포집', description: '누적 태양광 95,000 GW 집광', targetValue: 95000, unitLabel: 'GW', incomeBoostPct: 60 },
  { id: 'ms_solar_6', gameId: 'solar', tier: 6, title: '내행성 집광 벨트', description: '누적 태양광 500,000 GW 집광', targetValue: 500000, unitLabel: 'GW', incomeBoostPct: 90 },
  { id: 'ms_solar_7', gameId: 'solar', tier: 7, title: '다이슨 스웜 1단계', description: '누적 태양광 2,500,000 GW 집광', targetValue: 2500000, unitLabel: 'GW', incomeBoostPct: 130 },
  { id: 'ms_solar_8', gameId: 'solar', tier: 8, title: '항성 완전 포위망', description: '누적 태양광 15,000,000 GW 집광', targetValue: 15000000, unitLabel: 'GW', incomeBoostPct: 180 },

  // 6. Terra Biodome (Cumulative Biomass, Bio)
  { id: 'ms_bio_1', gameId: 'bio', tier: 1, title: '광합성 배양 개시', description: '누적 바이오매스 150 Bio 달성', targetValue: 150, unitLabel: 'Bio', incomeBoostPct: 8 },
  { id: 'ms_bio_2', gameId: 'bio', tier: 2, title: '온실 원시림 조성', description: '누적 바이오매스 800 Bio 달성', targetValue: 800, unitLabel: 'Bio', incomeBoostPct: 15 },
  { id: 'ms_bio_3', gameId: 'bio', tier: 3, title: '순환 생태계 안착', description: '누적 바이오매스 4,500 Bio 달성', targetValue: 4500, unitLabel: 'Bio', incomeBoostPct: 25 },
  { id: 'ms_bio_4', gameId: 'bio', tier: 4, title: '대륙 녹화 프로젝트', description: '누적 바이오매스 24,000 Bio 달성', targetValue: 24000, unitLabel: 'Bio', incomeBoostPct: 40 },
  { id: 'ms_bio_5', gameId: 'bio', tier: 5, title: '행성 생물권 완성', description: '누적 바이오매스 120,000 Bio 달성', targetValue: 120000, unitLabel: 'Bio', incomeBoostPct: 60 },
  { id: 'ms_bio_6', gameId: 'bio', tier: 6, title: '에코 교통망 통합', description: '누적 바이오매스 650,000 Bio 달성', targetValue: 650000, unitLabel: 'Bio', incomeBoostPct: 90 },
  { id: 'ms_bio_7', gameId: 'bio', tier: 7, title: '가이아 공명 진화', description: '누적 바이오매스 3,200,000 Bio 달성', targetValue: 3200000, unitLabel: 'Bio', incomeBoostPct: 130 },
  { id: 'ms_bio_8', gameId: 'bio', tier: 8, title: '테라포밍 정점', description: '누적 바이오매스 18,000,000 Bio 달성', targetValue: 18000000, unitLabel: 'Bio', incomeBoostPct: 180 },

  // 7. Superconducting Collider (Cumulative Collision Energy, TeV)
  { id: 'ms_col_1', gameId: 'collider', tier: 1, title: '첫 양성자 빔 충돌', description: '누적 충돌 200 TeV 달성', targetValue: 200, unitLabel: 'TeV', incomeBoostPct: 8 },
  { id: 'ms_col_2', gameId: 'collider', tier: 2, title: '힉스 공명 관측', description: '누적 충돌 1,000 TeV 달성', targetValue: 1000, unitLabel: 'TeV', incomeBoostPct: 15 },
  { id: 'ms_col_3', gameId: 'collider', tier: 3, title: '초전도 대링 가동', description: '누적 충돌 5,500 TeV 달성', targetValue: 5500, unitLabel: 'TeV', incomeBoostPct: 25 },
  { id: 'ms_col_4', gameId: 'collider', tier: 4, title: '쿼크-글루온 플라즈마', description: '누적 충돌 30,000 TeV 달성', targetValue: 30000, unitLabel: 'TeV', incomeBoostPct: 40 },
  { id: 'ms_col_5', gameId: 'collider', tier: 5, title: '타키온 선형 링', description: '누적 충돌 160,000 TeV 달성', targetValue: 160000, unitLabel: 'TeV', incomeBoostPct: 60 },
  { id: 'ms_col_6', gameId: 'collider', tier: 6, title: '초대칭 입자 합성', description: '누적 충돌 850,000 TeV 달성', targetValue: 850000, unitLabel: 'TeV', incomeBoostPct: 90 },
  { id: 'ms_col_7', gameId: 'collider', tier: 7, title: '플랑크 스케일 가속', description: '누적 충돌 4,500,000 TeV 달성', targetValue: 4500000, unitLabel: 'TeV', incomeBoostPct: 130 },
  { id: 'ms_col_8', gameId: 'collider', tier: 8, title: '미니 빅뱅 통제 실험', description: '누적 충돌 25,000,000 TeV 달성', targetValue: 25000000, unitLabel: 'TeV', incomeBoostPct: 180 },
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
    case 'solar':
      return mg.solar?.totalPowerGW || 0;
    case 'bio':
      return mg.bio?.totalBiomass || 0;
    case 'collider':
      return mg.collider?.totalCollisions || 0;
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
  const emptyReactorGrid: ReactorCellType[] = Array(16).fill('empty');
  emptyReactorGrid[5] = 'fuel';

  return {
    totalMoneyInvested: 0,
    unlockedMilestoneIds: [],
    unlockedGameIds: [],
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
      excavatorLevel: 0,
      seismicLevel: 0,
      seismicCharge: 0,
    },
    reactor: {
      plasma: 0,
      totalPlasmaEarned: 0,
      totalEnergyMWh: 0,
      heat: 18,
      overheated: false,
      grid: emptyReactorGrid,
      coreEfficiencyLevel: 0,
      coolantTechLevel: 0,
      autoVentUnlocked: false,
      turbineTechLevel: 0,
      overclockShieldLevel: 0,
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
      orbitalHubCount: 0,
      warpDriveLevel: 0,
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
      cryoLevel: 0,
      autoTunerUnlocked: false,
      leapCount: 0,
      leapMultiplier: 1,
    },
    solar: {
      photons: 0,
      totalPhotonsEarned: 0,
      totalPowerGW: 0,
      orbitalAngle: 5,
      optimalAngle: 6,
      pulseCharge: 0,
      mirrorCount: 1,
      collectorCount: 1,
      trackerLevel: 0,
      solarFlareLevel: 0,
      concentratorLevel: 0,
      autoTrackerUnlocked: false,
    },
    bio: {
      spores: 0,
      totalSporesEarned: 0,
      totalBiomass: 0,
      humidity: 58,
      algaeCount: 1,
      forestCount: 0,
      biosphereCount: 0,
      enzymeLevel: 0,
      climateRegLevel: 0,
      evolutionLevel: 0,
      evolutionMultiplier: 1,
    },
    collider: {
      beamCurrency: 0,
      totalBeamEarned: 0,
      totalCollisions: 0,
      luminosity: 0,
      exoticParticles: 0,
      magnetLevel: 1,
      vacuumLevel: 0,
      detectorLevel: 0,
      superCoilLevel: 0,
      injectorLevel: 0,
      resonanceBurstLevel: 0,
    },
  };
}

function migrateReactorGrid(rawGrid?: unknown): ReactorCellType[] {
  const base: ReactorCellType[] = Array(16).fill('empty');
  base[5] = 'fuel';
  if (!Array.isArray(rawGrid)) return base;
  if (rawGrid.length === 16) return [...(rawGrid as ReactorCellType[])];
  if (rawGrid.length === 9) {
    // Embed legacy 3x3 grid cleanly into top-left 3x3 of the new 4x4 grid
    const next: ReactorCellType[] = Array(16).fill('empty');
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        next[r * 4 + c] = (rawGrid[r * 3 + c] as ReactorCellType) || 'empty';
      }
    }
    return next;
  }
  return base;
}

export function backfillMinigamesState(raw?: Partial<MinigamesState> | null): MinigamesState {
  const base = createInitialMinigamesState();
  if (!raw || typeof raw !== 'object') return base;

  const merged: MinigamesState = {
    totalMoneyInvested: Number(raw.totalMoneyInvested) || 0,
    unlockedMilestoneIds: Array.isArray(raw.unlockedMilestoneIds)
      ? [...raw.unlockedMilestoneIds]
      : [],
    unlockedGameIds: Array.isArray(raw.unlockedGameIds)
      ? [...raw.unlockedGameIds]
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
      grid: migrateReactorGrid(raw.reactor?.grid),
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
      leapCount: Number(raw.quantum?.leapCount) || 0,
      leapMultiplier: Number(raw.quantum?.leapMultiplier) || 1,
      targetWave:
        Array.isArray(raw.quantum?.targetWave) && raw.quantum!.targetWave.length === 3
          ? ([...raw.quantum!.targetWave] as [number, number, number])
          : [...base.quantum.targetWave],
      tunedWave:
        Array.isArray(raw.quantum?.tunedWave) && raw.quantum!.tunedWave.length === 3
          ? ([...raw.quantum!.tunedWave] as [number, number, number])
          : [...base.quantum.tunedWave],
    },
    solar: {
      ...base.solar,
      ...(raw.solar || {}),
      totalPowerGW: Number(raw.solar?.totalPowerGW) || 0,
    },
    bio: {
      ...base.bio,
      ...(raw.bio || {}),
      totalBiomass: Number(raw.bio?.totalBiomass) || 0,
      evolutionMultiplier: Number(raw.bio?.evolutionMultiplier) || 1,
    },
    collider: {
      ...base.collider,
      ...(raw.collider || {}),
      totalCollisions: Number(raw.collider?.totalCollisions) || 0,
    },
  };

  return evaluateMinigameMilestones(merged).minigames;
}

/**
 * STRICT ONE-WAY & EXCLUSIVE CURRENCY EXCHANGE:
 * Minigame unique currencies (◈, ⚡, ✦, ⚛, ☀, ✿, ⊕) can ONLY be obtained through
 * Main Game Capital ($) -> Selected Minigame Currency exchange.
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
  if (!isMinigameUnlocked(state.minigames, gameId)) {
    return { success: false, newState: state, gained: 0 };
  }
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
  } else if (gameId === 'quantum') {
    nextMg.quantum = {
      ...mg.quantum,
      qubits: mg.quantum.qubits + gained,
      totalQubitsEarned: mg.quantum.totalQubitsEarned + gained,
    };
  } else if (gameId === 'solar') {
    nextMg.solar = {
      ...mg.solar,
      photons: mg.solar.photons + gained,
      totalPhotonsEarned: mg.solar.totalPhotonsEarned + gained,
    };
  } else if (gameId === 'bio') {
    nextMg.bio = {
      ...mg.bio,
      spores: mg.bio.spores + gained,
      totalSporesEarned: mg.bio.totalSporesEarned + gained,
    };
  } else {
    nextMg.collider = {
      ...mg.collider,
      beamCurrency: mg.collider.beamCurrency + gained,
      totalBeamEarned: mg.collider.totalBeamEarned + gained,
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
  const laserMult = 1 + mine.laserLevel * 0.55;
  const blastMult = 1 + mine.blastLevel * 0.45;
  const excavatorMult = Math.pow(1.45, mine.excavatorLevel || 0);
  const seismicMult = 1 + (mine.seismicLevel || 0) * 0.6;
  const veinPierceMult = mine.isGemVein ? 1.65 : 1;

  const clickDamage = Math.round(
    (10 + mine.drillLevel * 14) *
      Math.pow(1.24, mine.drillLevel) *
      blastMult *
      laserMult *
      excavatorMult *
      veinPierceMult
  );
  const autoDps =
    mine.autoDrillerLevel > 0
      ? Math.round(
          mine.autoDrillerLevel *
            9 *
            Math.pow(1.28, mine.autoDrillerLevel - 1) *
            blastMult *
            laserMult *
            excavatorMult
        )
      : 0;
  const seismicBurstDamage = Math.round(clickDamage * 8 * seismicMult);
  return { clickDamage, autoDps, laserMult, seismicBurstDamage };
}

export type MineUpgradeKind =
  | 'drill'
  | 'autoDriller'
  | 'laser'
  | 'blast'
  | 'excavator'
  | 'seismic';

export function getMineUpgradeCost(mine: MineGameState, kind: MineUpgradeKind): number {
  switch (kind) {
    case 'drill':
      return Math.round(16 * Math.pow(1.52, mine.drillLevel));
    case 'autoDriller':
      return Math.round(28 * Math.pow(1.58, mine.autoDrillerLevel));
    case 'laser':
      return Math.round(42 * Math.pow(1.7, mine.laserLevel));
    case 'blast':
      return Math.round(75 * Math.pow(1.8, mine.blastLevel));
    case 'excavator':
      return Math.round(140 * Math.pow(1.95, mine.excavatorLevel || 0));
    case 'seismic':
      return Math.round(95 * Math.pow(1.78, mine.seismicLevel || 0));
  }
}

function applyMineDamage(mine: MineGameState, damage: number, chargeDelta = 0): MineGameState {
  if (damage <= 0) return mine;
  let next = {
    ...mine,
    seismicCharge: Math.min(100, (mine.seismicCharge || 0) + chargeDelta),
  };
  let remaining = damage;
  let breaks = 0;

  while (remaining > 0 && breaks < 10) {
    if (remaining < next.layerHp) {
      next.layerHp = Math.max(0, next.layerHp - remaining);
      remaining = 0;
    } else {
      remaining -= next.layerHp;
      next.depth += 1;
      next.layersCleared += 1;
      next.isGemVein = next.depth % 4 === 0;
      const newMaxHp = Math.round(35 * Math.pow(1.2, Math.min(180, next.depth - 1)));
      next.layerMaxHp = newMaxHp;
      next.layerHp = newMaxHp;
      breaks += 1;
    }
  }
  return next;
}

export function digMineLayer(mine: MineGameState): MineGameState {
  const { clickDamage } = getMineMetrics(mine);
  return applyMineDamage(mine, clickDamage, 14 + (mine.seismicLevel || 0) * 3);
}

export function triggerMineSeismicBlast(mine: MineGameState): MineGameState {
  if ((mine.seismicCharge || 0) < 100) return mine;
  const { seismicBurstDamage } = getMineMetrics(mine);
  const cleared = applyMineDamage({ ...mine, seismicCharge: 0 }, seismicBurstDamage, 0);
  return { ...cleared, seismicCharge: 0 };
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
  else if (kind === 'blast') next.blastLevel += 1;
  else if (kind === 'excavator') next.excavatorLevel = (next.excavatorLevel || 0) + 1;
  else next.seismicLevel = (next.seismicLevel || 0) + 1;
  return { success: true, mine: next };
}

// ============================================================================
// 2. FUSION POWER PLANT (4x4 Grid, ⚡ Plasma Cells -> Cumulative MWh Milestones)
// ============================================================================

export const REACTOR_CELL_COST: Record<Exclude<ReactorCellType, 'empty'>, number> = {
  fuel: 22,
  generator: 36,
  coolant: 30,
  turbine: 54,
};

function getAdjacentGridIndices(idx: number): number[] {
  const row = Math.floor(idx / 4);
  const col = idx % 4;
  const out: number[] = [];
  if (row > 0) out.push(idx - 4);
  if (row < 3) out.push(idx + 4);
  if (col > 0) out.push(idx - 1);
  if (col < 3) out.push(idx + 1);
  return out;
}

export function getReactorMetrics(reactor: ReactorGameState) {
  let rawEnergyPerSec = 0;
  let heatGenPerSec = 0;
  let coolingPerSec = 2.2;

  const effMult = Math.pow(1.36, reactor.coreEfficiencyLevel);
  const turbineBonus = 1 + (reactor.turbineTechLevel || 0) * 0.4;
  const maxSafeHeat = 88 + Math.min(10, (reactor.overclockShieldLevel || 0) * 2);

  reactor.grid.forEach((cell, idx) => {
    const neighbors = getAdjacentGridIndices(idx);
    if (cell === 'fuel') {
      const adjGenerators = neighbors.filter((n) => reactor.grid[n] === 'generator').length;
      const adjCoolants = neighbors.filter((n) => reactor.grid[n] === 'coolant').length;
      const adjTurbines = neighbors.filter((n) => reactor.grid[n] === 'turbine').length;
      const fuelOutput =
        1.9 *
        (1 + adjGenerators * 0.6 + adjCoolants * 0.25 + adjTurbines * 1.05 * turbineBonus) *
        effMult;
      rawEnergyPerSec += fuelOutput;
      heatGenPerSec += 3.5 + adjGenerators * 1.2 + adjTurbines * 0.8;
    } else if (cell === 'generator') {
      const adjTurbines = neighbors.filter((n) => reactor.grid[n] === 'turbine').length;
      if (adjTurbines > 0) {
        rawEnergyPerSec += adjTurbines * 1.4 * turbineBonus * effMult;
      }
    } else if (cell === 'coolant') {
      coolingPerSec += 5.5 + reactor.coolantTechLevel * 3.2;
    }
  });

  const isOverclockZone = !reactor.overheated && reactor.heat >= 40 && reactor.heat <= maxSafeHeat;
  const overclockMult = isOverclockZone ? 1.75 + (reactor.overclockShieldLevel || 0) * 0.18 : 1;
  const effectiveEnergyPerSec = reactor.overheated ? 0 : rawEnergyPerSec * overclockMult;
  const netHeatPerSec = heatGenPerSec - coolingPerSec;

  return {
    rawEnergyPerSec,
    effectiveEnergyPerSec,
    heatGenPerSec,
    coolingPerSec,
    netHeatPerSec,
    isOverclockZone,
    maxSafeHeat,
  };
}

export function placeReactorCell(
  reactor: ReactorGameState,
  cellIndex: number,
  cellType: ReactorCellType
): { success: boolean; reactor: ReactorGameState } {
  if (cellIndex < 0 || cellIndex >= reactor.grid.length) return { success: false, reactor };
  const current = reactor.grid[cellIndex];
  if (current === cellType) return { success: false, reactor };

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
  const nextHeat = Math.max(0, reactor.heat - 38);
  return {
    ...reactor,
    heat: nextHeat,
    overheated: reactor.overheated && nextHeat > 35,
  };
}

export type ReactorUpgradeKind =
  | 'efficiency'
  | 'coolantTech'
  | 'autoVent'
  | 'turbineTech'
  | 'overclockShield';

export function getReactorUpgradeCost(
  reactor: ReactorGameState,
  kind: ReactorUpgradeKind
): number {
  switch (kind) {
    case 'efficiency':
      return Math.round(32 * Math.pow(1.72, reactor.coreEfficiencyLevel));
    case 'coolantTech':
      return Math.round(28 * Math.pow(1.65, reactor.coolantTechLevel));
    case 'autoVent':
      return 110;
    case 'turbineTech':
      return Math.round(65 * Math.pow(1.8, reactor.turbineTechLevel || 0));
    case 'overclockShield':
      return Math.round(80 * Math.pow(1.85, reactor.overclockShieldLevel || 0));
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
  else if (kind === 'autoVent') next.autoVentUnlocked = true;
  else if (kind === 'turbineTech') next.turbineTechLevel = (next.turbineTechLevel || 0) + 1;
  else next.overclockShieldLevel = (next.overclockShieldLevel || 0) + 1;
  return { success: true, reactor: next };
}

// ============================================================================
// 3. ORBITAL SHIPYARD & FACTORY (✦ Darkmatter Cores -> Cargo Shipped Milestones)
// ============================================================================

export type ShipyardUnitKind =
  | 'drone'
  | 'refinery'
  | 'freighter'
  | 'orbitalHub'
  | 'warpDrive';

export function getShipyardUnitCost(shipyard: ShipyardGameState, kind: ShipyardUnitKind): number {
  switch (kind) {
    case 'drone':
      return Math.round(10 * Math.pow(1.4, shipyard.droneCount - 1));
    case 'refinery':
      return Math.round(14 * Math.pow(1.48, shipyard.refineryCount));
    case 'freighter':
      return Math.round(22 * Math.pow(1.58, shipyard.freighterCount));
    case 'orbitalHub':
      return Math.round(45 * Math.pow(1.72, shipyard.orbitalHubCount || 0));
    case 'warpDrive':
      return Math.round(70 * Math.pow(1.85, shipyard.warpDriveLevel || 0));
  }
}

export function getShipyardMetrics(shipyard: ShipyardGameState) {
  const hubMult = 1 + (shipyard.orbitalHubCount || 0) * 0.45;
  const warpMult = Math.pow(1.42, shipyard.warpDriveLevel || 0);
  const mult = shipyard.fleetMultiplier * hubMult * warpMult;

  const alloyPerSec =
    shipyard.droneCount * 2.8 * Math.pow(1.17, Math.max(0, shipyard.droneCount - 1)) * mult;
  const maxRefineAlloyPerSec = shipyard.refineryCount * 2.4 * mult;
  const antimatterPerSecCap = maxRefineAlloyPerSec * 0.65;
  const maxShipAntimatterPerSec = shipyard.freighterCount * 1.6 * mult;
  const cargoPerSecCap = maxShipAntimatterPerSec * 2.0;
  const warpReqReduction = Math.pow(0.88, shipyard.warpDriveLevel || 0);
  const prestigeReq = Math.max(
    180,
    Math.round(220 * Math.pow(3.0, shipyard.fleetPrestigeLevel) * warpReqReduction)
  );
  return {
    alloyPerSec,
    maxRefineAlloyPerSec,
    antimatterPerSecCap,
    maxShipAntimatterPerSec,
    cargoPerSecCap,
    prestigeReq,
    hubMult,
    warpMult,
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
  else if (kind === 'freighter') next.freighterCount += 1;
  else if (kind === 'orbitalHub') next.orbitalHubCount = (next.orbitalHubCount || 0) + 1;
  else next.warpDriveLevel = (next.warpDriveLevel || 0) + 1;
  return { success: true, shipyard: next };
}

export function boostShipyardChain(shipyard: ShipyardGameState): ShipyardGameState {
  const metrics = getShipyardMetrics(shipyard);
  const bonusAlloy = Math.max(6, metrics.alloyPerSec * 2.6);
  let nextAlloy = shipyard.alloyParts + bonusAlloy;
  let nextAnti = shipyard.antimatter;
  let totalCargo = shipyard.totalCargoShipped;
  const mult = shipyard.fleetMultiplier * metrics.hubMult * metrics.warpMult;

  if (shipyard.refineryCount > 0 && nextAlloy > 0) {
    const refined = Math.min(nextAlloy, shipyard.refineryCount * 3.2 * mult);
    nextAlloy -= refined;
    nextAnti += refined * 0.65;
  }
  if (shipyard.freighterCount > 0 && nextAnti > 0) {
    const shipped = Math.min(nextAnti, shipyard.freighterCount * 2.2 * mult);
    nextAnti -= shipped;
    totalCargo += shipped * 2.0;
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
  const nextMult = Number((shipyard.fleetMultiplier * 2.4).toFixed(2));
  return {
    success: true,
    shipyard: {
      darkmatter: shipyard.darkmatter,
      totalDarkmatterEarned: shipyard.totalDarkmatterEarned,
      totalCargoShipped: shipyard.totalCargoShipped,
      alloyParts: 0,
      antimatter: 0,
      droneCount: 1,
      refineryCount: 0,
      freighterCount: 0,
      orbitalHubCount: 0,
      warpDriveLevel: shipyard.warpDriveLevel || 0,
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
      ? 3.4
      : matchedChannels === 2
      ? 2.35
      : matchedChannels === 1
      ? 1.6
      : 1.0;

  const cryoMult = Math.pow(1.38, quantum.cryoLevel || 0);
  const leapMult = quantum.leapMultiplier || 1;
  const progressPerSec =
    ((1 + quantum.acceleratorLevel * 0.5) * resonanceMult * (1 + (quantum.cryoLevel || 0) * 0.22)) /
    6.2;
  const experimentRewardRp = Math.round(
    (9 + quantum.amplifierLevel * 8) *
      Math.pow(1.26, quantum.amplifierLevel) *
      cryoMult *
      leapMult *
      (matchedChannels === 3 ? 1.6 : 1)
  );
  const passiveRpPerSec =
    quantum.entanglementLevel * 1.1 * (1 + matchedChannels * 0.3) * cryoMult * leapMult;
  const leapReq = Math.round(12 * Math.pow(1.85, quantum.leapCount || 0));

  return {
    matchedChannels,
    resonanceMult,
    progressPerSec,
    experimentRewardRp,
    passiveRpPerSec,
    cryoMult,
    leapMult,
    leapReq,
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
  let nextProg = quantum.experimentProgress + 0.25;
  let nextRp = quantum.researchPoints;
  let nextCompleted = quantum.experimentsCompleted;
  let nextTarget = quantum.targetWave;
  let nextTuned = quantum.tunedWave;

  if (nextProg >= 1) {
    nextProg -= 1;
    nextRp += metrics.experimentRewardRp;
    nextCompleted += 1;
    nextTarget = computeNextTargetWave(nextCompleted + 1);
    if (quantum.autoTunerUnlocked) {
      nextTuned = [...nextTarget] as [number, number, number];
    }
  }

  return {
    ...quantum,
    experimentProgress: nextProg,
    researchPoints: nextRp,
    experimentsCompleted: nextCompleted,
    targetWave: nextTarget,
    tunedWave: nextTuned,
  };
}

export function leapQuantumDimension(quantum: QuantumGameState): {
  success: boolean;
  quantum: QuantumGameState;
} {
  const { leapReq } = getQuantumMetrics(quantum);
  if (quantum.experimentsCompleted < leapReq) {
    return { success: false, quantum };
  }
  const nextCount = (quantum.leapCount || 0) + 1;
  const nextMult = Number(((quantum.leapMultiplier || 1) * 2.2).toFixed(2));
  return {
    success: true,
    quantum: {
      ...quantum,
      experimentProgress: 0,
      experimentsCompleted: 0,
      acceleratorLevel: 0,
      amplifierLevel: 0,
      leapCount: nextCount,
      leapMultiplier: nextMult,
    },
  };
}

export type QuantumUpgradeKind =
  | 'accelerator'
  | 'amplifier'
  | 'entanglement'
  | 'cryo'
  | 'autoTuner';

export function getQuantumUpgradeCost(
  quantum: QuantumGameState,
  kind: QuantumUpgradeKind
): number {
  switch (kind) {
    case 'accelerator':
      return Math.round(16 * Math.pow(1.58, quantum.acceleratorLevel));
    case 'amplifier':
      return Math.round(22 * Math.pow(1.65, quantum.amplifierLevel));
    case 'entanglement':
      return Math.round(28 * Math.pow(1.7, quantum.entanglementLevel));
    case 'cryo':
      return Math.round(48 * Math.pow(1.85, quantum.cryoLevel || 0));
    case 'autoTuner':
      return 140;
  }
}

export function buyQuantumUpgrade(
  quantum: QuantumGameState,
  kind: QuantumUpgradeKind
): { success: boolean; quantum: QuantumGameState } {
  if (kind === 'autoTuner' && quantum.autoTunerUnlocked) {
    return { success: false, quantum };
  }
  const cost = getQuantumUpgradeCost(quantum, kind);
  if (quantum.qubits < cost) return { success: false, quantum };
  const next = { ...quantum, qubits: quantum.qubits - cost };
  if (kind === 'accelerator') next.acceleratorLevel += 1;
  else if (kind === 'amplifier') next.amplifierLevel += 1;
  else if (kind === 'entanglement') next.entanglementLevel += 1;
  else if (kind === 'cryo') next.cryoLevel = (next.cryoLevel || 0) + 1;
  else {
    next.autoTunerUnlocked = true;
    next.tunedWave = [...next.targetWave] as [number, number, number];
  }
  return { success: true, quantum: next };
}

// ============================================================================
// 5. ORBITAL SOLAR ARRAY (☀ Photons -> Power GW Milestones)
// ============================================================================

export function getSolarMetrics(solar: SolarGameState) {
  const diff = Math.abs(solar.orbitalAngle - solar.optimalAngle);
  const alignmentMult = diff === 0 ? 3.0 : diff === 1 ? 2.1 : diff === 2 ? 1.45 : 0.85;
  const trackerMult = 1 + solar.trackerLevel * 0.45;
  const flareMult = Math.pow(1.38, solar.solarFlareLevel);
  const concMult = Math.pow(1.5, solar.concentratorLevel);

  const gwPerSec =
    solar.mirrorCount *
    1.8 *
    Math.pow(1.18, Math.max(0, solar.mirrorCount - 1)) *
    (1 + solar.collectorCount * 0.65) *
    alignmentMult *
    trackerMult *
    flareMult *
    concMult;

  const pulseGw = Math.max(12, gwPerSec * 4.5);
  return { alignmentMult, gwPerSec, pulseGw };
}

export function setSolarOrbitalAngle(solar: SolarGameState, angle: number): SolarGameState {
  const clamped = Math.max(1, Math.min(10, Math.round(angle)));
  return { ...solar, orbitalAngle: clamped };
}

export function pulseSolarArray(solar: SolarGameState): SolarGameState {
  const { pulseGw } = getSolarMetrics(solar);
  const nextCharge = Math.min(100, solar.pulseCharge + 28);
  const bonus = nextCharge >= 100 ? pulseGw * 2.5 : pulseGw;
  const nextOptimal =
    nextCharge >= 100 && !solar.autoTrackerUnlocked
      ? ((solar.optimalAngle * 3 + 2) % 9) + 1
      : solar.optimalAngle;

  return {
    ...solar,
    totalPowerGW: solar.totalPowerGW + bonus,
    pulseCharge: nextCharge >= 100 ? 0 : nextCharge,
    optimalAngle: nextOptimal,
    orbitalAngle: solar.autoTrackerUnlocked ? nextOptimal : solar.orbitalAngle,
  };
}

export type SolarUpgradeKind =
  | 'mirror'
  | 'collector'
  | 'tracker'
  | 'flare'
  | 'concentrator'
  | 'autoTracker';

export function getSolarUpgradeCost(solar: SolarGameState, kind: SolarUpgradeKind): number {
  switch (kind) {
    case 'mirror':
      return Math.round(14 * Math.pow(1.48, solar.mirrorCount - 1));
    case 'collector':
      return Math.round(22 * Math.pow(1.56, solar.collectorCount - 1));
    case 'tracker':
      return Math.round(35 * Math.pow(1.7, solar.trackerLevel));
    case 'flare':
      return Math.round(58 * Math.pow(1.85, solar.solarFlareLevel));
    case 'concentrator':
      return Math.round(110 * Math.pow(2.05, solar.concentratorLevel));
    case 'autoTracker':
      return 160;
  }
}

export function buySolarUpgrade(
  solar: SolarGameState,
  kind: SolarUpgradeKind
): { success: boolean; solar: SolarGameState } {
  if (kind === 'autoTracker' && solar.autoTrackerUnlocked) {
    return { success: false, solar };
  }
  const cost = getSolarUpgradeCost(solar, kind);
  if (solar.photons < cost) return { success: false, solar };
  const next = { ...solar, photons: solar.photons - cost };
  if (kind === 'mirror') next.mirrorCount += 1;
  else if (kind === 'collector') next.collectorCount += 1;
  else if (kind === 'tracker') next.trackerLevel += 1;
  else if (kind === 'flare') next.solarFlareLevel += 1;
  else if (kind === 'concentrator') next.concentratorLevel += 1;
  else {
    next.autoTrackerUnlocked = true;
    next.orbitalAngle = next.optimalAngle;
  }
  return { success: true, solar: next };
}

// ============================================================================
// 6. TERRA BIODOME (✿ Bio Spores -> Biomass Milestones)
// ============================================================================

export function getBioMetrics(bio: BioGameState) {
  const isOptimalHumidity = bio.humidity >= 45 && bio.humidity <= 75;
  const climateMult = isOptimalHumidity ? 2.4 + bio.climateRegLevel * 0.45 : 1.0;
  const enzymeMult = Math.pow(1.36, bio.enzymeLevel);
  const baseBioPerSec =
    (bio.algaeCount * 2.2 + bio.forestCount * 9.5 + bio.biosphereCount * 42) *
    climateMult *
    enzymeMult *
    (bio.evolutionMultiplier || 1);

  const evolveReq = Math.round(600 * Math.pow(3.4, bio.evolutionLevel));
  return { isOptimalHumidity, climateMult, baseBioPerSec, evolveReq };
}

export function cultivateBioDome(bio: BioGameState): BioGameState {
  const { baseBioPerSec } = getBioMetrics(bio);
  const gain = Math.max(8, baseBioPerSec * 2.2);
  return {
    ...bio,
    totalBiomass: bio.totalBiomass + gain,
    humidity: Math.max(20, bio.humidity - 2),
  };
}

export function mistBioHumidity(bio: BioGameState, targetDelta: number): BioGameState {
  const nextHum = Math.max(10, Math.min(95, bio.humidity + targetDelta));
  return { ...bio, humidity: nextHum };
}

export function evolveBioDome(bio: BioGameState): {
  success: boolean;
  bio: BioGameState;
} {
  const { evolveReq } = getBioMetrics(bio);
  if (bio.totalBiomass < evolveReq) return { success: false, bio };
  return {
    success: true,
    bio: {
      ...bio,
      algaeCount: 1,
      forestCount: 0,
      biosphereCount: 0,
      humidity: 60,
      evolutionLevel: bio.evolutionLevel + 1,
      evolutionMultiplier: Number(((bio.evolutionMultiplier || 1) * 2.5).toFixed(2)),
    },
  };
}

export type BioUpgradeKind = 'algae' | 'forest' | 'biosphere' | 'enzyme' | 'climateReg';

export function getBioUpgradeCost(bio: BioGameState, kind: BioUpgradeKind): number {
  switch (kind) {
    case 'algae':
      return Math.round(12 * Math.pow(1.42, bio.algaeCount - 1));
    case 'forest':
      return Math.round(28 * Math.pow(1.52, bio.forestCount));
    case 'biosphere':
      return Math.round(65 * Math.pow(1.68, bio.biosphereCount));
    case 'enzyme':
      return Math.round(35 * Math.pow(1.74, bio.enzymeLevel));
    case 'climateReg':
      return Math.round(45 * Math.pow(1.82, bio.climateRegLevel));
  }
}

export function buyBioUpgrade(
  bio: BioGameState,
  kind: BioUpgradeKind
): { success: boolean; bio: BioGameState } {
  const cost = getBioUpgradeCost(bio, kind);
  if (bio.spores < cost) return { success: false, bio };
  const next = { ...bio, spores: bio.spores - cost };
  if (kind === 'algae') next.algaeCount += 1;
  else if (kind === 'forest') next.forestCount += 1;
  else if (kind === 'biosphere') next.biosphereCount += 1;
  else if (kind === 'enzyme') next.enzymeLevel += 1;
  else next.climateRegLevel += 1;
  return { success: true, bio: next };
}

// ============================================================================
// 7. SUPERCONDUCTING COLLIDER (⊕ Beam Currency -> TeV Milestones)
// ============================================================================

export function getColliderMetrics(col: ColliderGameState) {
  const vacuumMult = 1 + col.vacuumLevel * 0.48;
  const superMult = Math.pow(1.42, col.superCoilLevel);
  const detectorMult = 1 + col.detectorLevel * 0.55;
  const exoticMult = 1 + col.exoticParticles * 0.35;

  const tevPerSec =
    col.magnetLevel *
    3.2 *
    Math.pow(1.2, Math.max(0, col.magnetLevel - 1)) *
    vacuumMult *
    superMult *
    detectorMult *
    exoticMult;

  const lumRatePerSec = 8 + col.injectorLevel * 5.5;
  const burstDamageTeV = Math.round(
    (25 + tevPerSec * 5.0) * (1 + col.resonanceBurstLevel * 0.75)
  );
  return { tevPerSec, lumRatePerSec, burstDamageTeV, exoticMult };
}

export function collideParticles(col: ColliderGameState): ColliderGameState {
  const { tevPerSec } = getColliderMetrics(col);
  const gain = Math.max(10, tevPerSec * 1.8);
  const nextLum = Math.min(100, col.luminosity + 24 + col.injectorLevel * 4);
  return {
    ...col,
    totalCollisions: col.totalCollisions + gain,
    luminosity: nextLum,
  };
}

export function triggerColliderBurst(col: ColliderGameState): ColliderGameState {
  if (col.luminosity < 100) return col;
  const { burstDamageTeV } = getColliderMetrics(col);
  return {
    ...col,
    luminosity: 0,
    totalCollisions: col.totalCollisions + burstDamageTeV,
    exoticParticles: col.exoticParticles + 1 + Math.floor(col.resonanceBurstLevel / 2),
  };
}

export type ColliderUpgradeKind =
  | 'magnet'
  | 'vacuum'
  | 'detector'
  | 'superCoil'
  | 'injector'
  | 'resonanceBurst';

export function getColliderUpgradeCost(
  col: ColliderGameState,
  kind: ColliderUpgradeKind
): number {
  switch (kind) {
    case 'magnet':
      return Math.round(14 * Math.pow(1.46, col.magnetLevel - 1));
    case 'vacuum':
      return Math.round(24 * Math.pow(1.6, col.vacuumLevel));
    case 'detector':
      return Math.round(32 * Math.pow(1.68, col.detectorLevel));
    case 'superCoil':
      return Math.round(60 * Math.pow(1.88, col.superCoilLevel));
    case 'injector':
      return Math.round(40 * Math.pow(1.75, col.injectorLevel));
    case 'resonanceBurst':
      return Math.round(85 * Math.pow(1.92, col.resonanceBurstLevel));
  }
}

export function buyColliderUpgrade(
  col: ColliderGameState,
  kind: ColliderUpgradeKind
): { success: boolean; collider: ColliderGameState } {
  const cost = getColliderUpgradeCost(col, kind);
  if (col.beamCurrency < cost) return { success: false, collider: col };
  const next = { ...col, beamCurrency: col.beamCurrency - cost };
  if (kind === 'magnet') next.magnetLevel += 1;
  else if (kind === 'vacuum') next.vacuumLevel += 1;
  else if (kind === 'detector') next.detectorLevel += 1;
  else if (kind === 'superCoil') next.superCoilLevel += 1;
  else if (kind === 'injector') next.injectorLevel += 1;
  else next.resonanceBurstLevel += 1;
  return { success: true, collider: next };
}

// ============================================================================
// UNIFIED TICK SIMULATION (CURRENCIES STAY EXCHANGE-ONLY; MILESTONES ADVANCE)
// ============================================================================

export function advanceMinigamesTick(mg: MinigamesState, dt: number): MinigamesState {
  if (dt <= 0) return mg;

  const unlocked = mg.unlockedGameIds || [];

  // 1. Mine
  let nextMine = mg.mine;
  if (unlocked.includes('mine')) {
    const mineMetrics = getMineMetrics(mg.mine);
    nextMine =
      mineMetrics.autoDps > 0
        ? applyMineDamage(mg.mine, mineMetrics.autoDps * dt, (4 + (mg.mine.seismicLevel || 0) * 1.5) * dt)
        : mg.mine;
  }

  // 2. Reactor (4x4)
  let nextReactor = mg.reactor;
  if (unlocked.includes('reactor')) {
    const reactorMetrics = getReactorMetrics(mg.reactor);
    let nextHeat = mg.reactor.heat + reactorMetrics.netHeatPerSec * dt;
    let nextOverheated = mg.reactor.overheated;

    if (mg.reactor.overheated) {
      nextHeat = Math.max(0, mg.reactor.heat - Math.max(8, reactorMetrics.coolingPerSec * 1.4) * dt);
      if (nextHeat <= 30) nextOverheated = false;
    } else {
      if (mg.reactor.autoVentUnlocked && nextHeat >= reactorMetrics.maxSafeHeat) {
        nextHeat = Math.max(22, nextHeat - 36);
      } else if (nextHeat >= 100) {
        nextHeat = 100;
        nextOverheated = true;
      } else if (nextHeat < 0) {
        nextHeat = 0;
      }
    }
    nextReactor = {
      ...mg.reactor,
      heat: nextHeat,
      overheated: nextOverheated,
      totalEnergyMWh: mg.reactor.totalEnergyMWh + reactorMetrics.effectiveEnergyPerSec * dt,
    };
  }

  // 3. Shipyard
  let nextShipyard = mg.shipyard;
  if (unlocked.includes('shipyard')) {
    const shipMetrics = getShipyardMetrics(mg.shipyard);
    let alloy = mg.shipyard.alloyParts + shipMetrics.alloyPerSec * dt;
    let anti = mg.shipyard.antimatter;
    let cargoShipped = mg.shipyard.totalCargoShipped;

    if (shipMetrics.maxRefineAlloyPerSec > 0 && alloy > 0) {
      const consumedAlloy = Math.min(alloy, shipMetrics.maxRefineAlloyPerSec * dt);
      alloy -= consumedAlloy;
      anti += consumedAlloy * 0.65;
    }
    if (shipMetrics.maxShipAntimatterPerSec > 0 && anti > 0) {
      const shippedAnti = Math.min(anti, shipMetrics.maxShipAntimatterPerSec * dt);
      anti -= shippedAnti;
      cargoShipped += shippedAnti * 2.0;
    }
    nextShipyard = {
      ...mg.shipyard,
      alloyParts: alloy,
      antimatter: anti,
      totalCargoShipped: cargoShipped,
    };
  }

  // 4. Quantum
  let nextQuantum = mg.quantum;
  if (unlocked.includes('quantum')) {
    const qMetrics = getQuantumMetrics(mg.quantum);
    let qProg = mg.quantum.experimentProgress + qMetrics.progressPerSec * dt;
    let qRp = mg.quantum.researchPoints + qMetrics.passiveRpPerSec * dt;
    let qCompleted = mg.quantum.experimentsCompleted;
    let qTarget = mg.quantum.targetWave;
    let qTuned = mg.quantum.tunedWave;

    if (qProg >= 1) {
      qProg -= 1;
      qRp += qMetrics.experimentRewardRp;
      qCompleted += 1;
      qTarget = computeNextTargetWave(qCompleted + 1);
      if (mg.quantum.autoTunerUnlocked) {
        qTuned = [...qTarget] as [number, number, number];
      }
    }
    nextQuantum = {
      ...mg.quantum,
      experimentProgress: Math.min(0.999, Math.max(0, qProg)),
      researchPoints: qRp,
      experimentsCompleted: qCompleted,
      targetWave: qTarget,
      tunedWave: qTuned,
    };
  }

  // 5. Solar
  let nextSolar = mg.solar;
  if (unlocked.includes('solar')) {
    const sMetrics = getSolarMetrics(mg.solar);
    nextSolar = {
      ...mg.solar,
      totalPowerGW: mg.solar.totalPowerGW + sMetrics.gwPerSec * dt,
      pulseCharge: Math.min(100, mg.solar.pulseCharge + 5 * dt),
      orbitalAngle: mg.solar.autoTrackerUnlocked ? mg.solar.optimalAngle : mg.solar.orbitalAngle,
    };
  }

  // 6. BioDome
  let nextBio = mg.bio;
  if (unlocked.includes('bio')) {
    const bMetrics = getBioMetrics(mg.bio);
    const humDrift = mg.bio.climateRegLevel > 0 ? 0.4 * dt : 1.1 * dt;
    const nextHum = Math.max(25, Math.min(85, mg.bio.humidity - humDrift));
    nextBio = {
      ...mg.bio,
      totalBiomass: mg.bio.totalBiomass + bMetrics.baseBioPerSec * dt,
      humidity: mg.bio.climateRegLevel >= 3 ? Math.max(55, nextHum) : nextHum,
    };
  }

  // 7. Collider
  let nextCol = mg.collider;
  if (unlocked.includes('collider')) {
    const cMetrics = getColliderMetrics(mg.collider);
    nextCol = {
      ...mg.collider,
      totalCollisions: mg.collider.totalCollisions + cMetrics.tevPerSec * dt,
      luminosity: Math.min(100, mg.collider.luminosity + cMetrics.lumRatePerSec * dt),
    };
  }

  const updatedMg: MinigamesState = {
    totalMoneyInvested: mg.totalMoneyInvested,
    unlockedMilestoneIds: mg.unlockedMilestoneIds || [],
    unlockedGameIds: unlocked,
    mine: nextMine,
    reactor: nextReactor,
    shipyard: nextShipyard,
    quantum: nextQuantum,
    solar: nextSolar,
    bio: nextBio,
    collider: nextCol,
  };

  return evaluateMinigameMilestones(updatedMg).minigames;
}
