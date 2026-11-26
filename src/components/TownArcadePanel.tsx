import React, { useState } from 'react';
import {
  ArrowRight,
  Atom,
  CheckCircle2,
  Cpu,
  Droplets,
  Flame,
  Gamepad2,
  Hammer,
  Layers,
  Lock,
  Orbit,
  Pickaxe,
  Rocket,
  ShieldAlert,
  Snowflake,
  Sparkles,
  Sprout,
  Sun,
  Trash2,
  Trophy,
  Wind,
  Zap,
} from 'lucide-react';
import { GameState, MinigameId, ReactorCellType } from '../game/types';
import { ModalShell } from './ui/ModalShell';
import {
  BioUpgradeKind,
  calculateExchangePreview,
  ColliderUpgradeKind,
  getBioMetrics,
  getBioUpgradeCost,
  getColliderMetrics,
  getColliderUpgradeCost,
  getMineMetrics,
  getMineUpgradeCost,
  getMinigameMilestoneSummary,
  getMinigameUnlockCost,
  isMinigameUnlocked,
  getQuantumMetrics,
  getQuantumUpgradeCost,
  getReactorMetrics,
  getReactorUpgradeCost,
  getShipyardMetrics,
  getShipyardUnitCost,
  getSolarMetrics,
  getSolarUpgradeCost,
  MINIGAME_META,
  MINIGAME_ORDER,
  MineUpgradeKind,
  QuantumUpgradeKind,
  REACTOR_CELL_COST,
  ReactorUpgradeKind,
  ShipyardUnitKind,
  SolarUpgradeKind,
} from '../game/minigames';

interface TownArcadePanelProps {
  gameState: GameState;
  onClose: () => void;
  onExchangeMoney: (gameId: MinigameId, moneyAmount: number) => void;
  onUnlockMinigame: (gameId: MinigameId) => void;
  // 1. Mine
  onDigMine: () => void;
  onTriggerMineSeismic: () => void;
  onBuyMineUpgrade: (kind: MineUpgradeKind) => void;
  // 2. Reactor (4x4)
  onPlaceReactorCell: (cellIndex: number, cellType: ReactorCellType) => void;
  onVentReactor: () => void;
  onBuyReactorUpgrade: (kind: ReactorUpgradeKind) => void;
  // 3. Shipyard
  onBoostShipyard: () => void;
  onBuyShipyardUnit: (kind: ShipyardUnitKind) => void;
  onPrestigeShipyard: () => void;
  // 4. Quantum
  onTuneQuantumWave: (channelIndex: 0 | 1 | 2, value: number) => void;
  onPulseQuantum: () => void;
  onLeapQuantum: () => void;
  onBuyQuantumUpgrade: (kind: QuantumUpgradeKind) => void;
  // 5. Solar
  onSetSolarAngle: (angle: number) => void;
  onPulseSolar: () => void;
  onBuySolarUpgrade: (kind: SolarUpgradeKind) => void;
  // 6. BioDome
  onCultivateBio: () => void;
  onMistBio: (delta: number) => void;
  onEvolveBio: () => void;
  onBuyBioUpgrade: (kind: BioUpgradeKind) => void;
  // 7. Collider
  onCollideParticles: () => void;
  onBurstCollider: () => void;
  onBuyColliderUpgrade: (kind: ColliderUpgradeKind) => void;
}

function formatNum(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '0';
  const suffixes = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc'];
  if (Math.abs(value) >= 1_000_000) {
    const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
    if (tier < suffixes.length) {
      return `${(value / Math.pow(10, tier * 3)).toFixed(2)}${suffixes[tier]}`;
    }
    return value.toExponential(2).replace('+', '');
  }
  if (decimals > 0 && value < 1000) {
    return value.toFixed(decimals);
  }
  return Math.floor(value).toLocaleString();
}

export const TownArcadePanel: React.FC<TownArcadePanelProps> = ({
  gameState,
  onClose,
  onExchangeMoney,
  onUnlockMinigame,
  onDigMine,
  onTriggerMineSeismic,
  onBuyMineUpgrade,
  onPlaceReactorCell,
  onVentReactor,
  onBuyReactorUpgrade,
  onBoostShipyard,
  onBuyShipyardUnit,
  onPrestigeShipyard,
  onTuneQuantumWave,
  onPulseQuantum,
  onLeapQuantum,
  onBuyQuantumUpgrade,
  onSetSolarAngle,
  onPulseSolar,
  onBuySolarUpgrade,
  onCultivateBio,
  onMistBio,
  onEvolveBio,
  onBuyBioUpgrade,
  onCollideParticles,
  onBurstCollider,
  onBuyColliderUpgrade,
}) => {
  const [activeGame, setActiveGame] = useState<MinigameId>('mine');
  const [reactorBrush, setReactorBrush] = useState<ReactorCellType>('fuel');

  const mg = gameState.minigames;
  const isCurrentUnlocked = isMinigameUnlocked(mg, activeGame);
  const unlockCost = getMinigameUnlockCost(mg);
  const canAffordUnlock = gameState.capital >= unlockCost;
  const meta = MINIGAME_META[activeGame];

  const quarterCapital = Math.floor(gameState.capital * 0.25);
  const exchangePresets = [
    { label: `$${meta.moneyPerBatch.toLocaleString()}`, amount: meta.moneyPerBatch },
    { label: `$${(meta.moneyPerBatch * 10).toLocaleString()}`, amount: meta.moneyPerBatch * 10 },
    { label: `$${(meta.moneyPerBatch * 100).toLocaleString()}`, amount: meta.moneyPerBatch * 100 },
    {
      label: `자금 25% ($${formatNum(quarterCapital)})`,
      amount: quarterCapital,
    },
  ];

  const getCurrencyBalance = (id: MinigameId): number => {
    switch (id) {
      case 'mine':
        return mg.mine.ore;
      case 'reactor':
        return mg.reactor.plasma;
      case 'shipyard':
        return mg.shipyard.darkmatter;
      case 'quantum':
        return mg.quantum.qubits;
      case 'solar':
        return mg.solar?.photons || 0;
      case 'bio':
        return mg.bio?.spores || 0;
      case 'collider':
        return mg.collider?.beamCurrency || 0;
    }
  };

  const mineMetrics = getMineMetrics(mg.mine);
  const reactorMetrics = getReactorMetrics(mg.reactor);
  const shipyardMetrics = getShipyardMetrics(mg.shipyard);
  const quantumMetrics = getQuantumMetrics(mg.quantum);
  const solarMetrics = getSolarMetrics(mg.solar);
  const bioMetrics = getBioMetrics(mg.bio);
  const colliderMetrics = getColliderMetrics(mg.collider);
  const milestoneSummary = getMinigameMilestoneSummary(mg, activeGame);

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel="타운 미니게임 허브"
      testId="town-arcade-modal"
      maxWidthClass="max-w-5xl"
      heightClass="h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[calc(100dvh-148px)]"
      backdropClassName="p-0 sm:px-4 sm:pt-16 sm:pb-20 pb-[calc(env(safe-area-inset-bottom)+68px)]"
      icon={<Gamepad2 className="w-4 h-4 text-amber-400" />}
      title="타운 미니게임 허브 (7종 · 56 마일스톤)"
      subtitle="화폐는 돈($) 환전으로만 획득 · 각 게임 8단계 마일스톤 달성 시 메인 자금 수익 영구 부스트"
      headerRight={
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5 text-xs font-mono-numbers overflow-x-auto no-scrollbar">
            {MINIGAME_ORDER.map((id) => (
              <span
                key={id}
                style={{ color: MINIGAME_META[id].accentColor }}
                className="whitespace-nowrap"
              >
                {MINIGAME_META[id].currencySymbol} {formatNum(getCurrencyBalance(id))}
              </span>
            ))}
          </div>

          <div className="text-right font-mono-numbers shrink-0 pl-2 border-l border-white/[0.08]">
            <div className="text-[10px] text-slate-400">메인 자금</div>
            <div className="text-xs sm:text-sm font-bold text-emerald-400">
              ${formatNum(gameState.capital)}
            </div>
          </div>
        </div>
      }
      subHeader={
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-2 border-b border-white/[0.07] bg-[#080d18]/60 overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#070b14] border border-white/[0.08]">
            {MINIGAME_ORDER.map((id) => {
              const m = MINIGAME_META[id];
              const isActive = activeGame === id;
              const isUnlocked = isMinigameUnlocked(mg, id);
              const bal = getCurrencyBalance(id);
              return (
                <button
                  key={id}
                  data-testid={`minigame-tab-${id}`}
                  onClick={() => setActiveGame(id)}
                  className={`min-h-[34px] flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-sky-500/20 text-white border border-sky-400/45'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  {!isUnlocked ? (
                    <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                  ) : (
                    <span style={{ color: m.accentColor }} className="font-mono-numbers font-bold">
                      {m.currencySymbol}
                    </span>
                  )}
                  <span>{m.shortName}</span>
                  {isUnlocked && (
                    <span className="text-[11px] font-mono-numbers text-slate-400">
                      {formatNum(bal)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            data-testid="milestone-boost-badge"
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/35 border border-emerald-500/35 text-xs font-mono-numbers shrink-0"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-300">
              마일스톤 {milestoneSummary.unlockedCount}/{milestoneSummary.totalCount}
            </span>
            <span className="text-emerald-400 font-bold">
              ×{milestoneSummary.incomeMult.toFixed(2)} (+{milestoneSummary.totalBoostPct}%)
            </span>
          </div>
        </div>
      }
    >
      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {!isCurrentUnlocked ? (
          <div
            data-testid="locked-minigame-view"
            className="p-6 sm:p-8 rounded-2xl bg-[#10182b] border border-amber-400/30 flex flex-col items-center justify-center text-center space-y-4"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Lock className="w-7 h-7" />
            </div>
            <div className="max-w-lg space-y-2">
              <div className="text-xs font-semibold text-slate-400">
                미해금 미니게임 ·{' '}
                <span className="text-amber-400 font-mono-numbers">
                  현재 해금 {(mg.unlockedGameIds || []).length}/7
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white flex items-center justify-center gap-2 font-heading">
                <span style={{ color: meta.accentColor }}>{meta.currencySymbol}</span>
                <span>{meta.name}</span>
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
                {meta.subtitle}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                이 미니게임을 자금($)으로 잠금 해제하면 전용 화폐 환전 및 특화 성장 루프가 열립니다.
                8단계 마일스톤을 달성할 때마다 메인 자금 수익에 영구 배수 보너스가 부여됩니다.
                (미니게임을 하나 해금할 때마다 다음 미니게임의 잠금 해제 비용이 증가합니다)
              </p>
            </div>

            <div className="pt-1 flex flex-col items-center gap-2">
              <button
                data-testid="unlock-minigame-btn"
                disabled={!canAffordUnlock}
                onClick={() => onUnlockMinigame(activeGame)}
                className={`min-h-[44px] px-6 py-2.5 rounded-xl font-bold text-sm transition-colors cursor-pointer flex items-center gap-2 ${
                  canAffordUnlock
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                }`}
              >
                <Lock className="w-4 h-4" />
                <span>{meta.shortName} 잠금 해제 (${formatNum(unlockCost)})</span>
              </button>
              {!canAffordUnlock && (
                <span className="text-xs text-rose-400 font-mono-numbers">
                  보유 자금 부족 (필요: ${formatNum(unlockCost)} / 보유: ${formatNum(gameState.capital)})
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Strictly One-Way & Exclusive Exchange Strip */}
            <section
              data-testid="oneway-exchange-bar"
              className="p-3.5 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col lg:flex-row lg:items-center justify-between gap-3"
            >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span>메인 자금</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span style={{ color: meta.accentColor }}>
                  {meta.currencyName} ({meta.currencySymbol}) 유일 획득 경로
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                환전 비율 ${meta.moneyPerBatch.toLocaleString()}당 {meta.currencyPerBatch}{' '}
                {meta.currencySymbol} · 미니게임 화폐는 오직 돈($) 환전으로만 획득
              </p>
            </div>

            <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
              {exchangePresets.map((preset, idx) => {
                const gained = calculateExchangePreview(activeGame, preset.amount);
                const canAfford = gameState.capital >= preset.amount && gained > 0;
                return (
                  <button
                    key={idx}
                    data-testid={`exchange-btn-${idx}`}
                    disabled={!canAfford}
                    onClick={() => onExchangeMoney(activeGame, preset.amount)}
                    className={`min-h-[40px] px-3 py-1 rounded-lg text-xs font-mono-numbers font-semibold transition-colors cursor-pointer whitespace-nowrap flex flex-col items-center justify-center ${
                      canAfford
                        ? 'bg-white/[0.06] hover:bg-white/[0.11] text-white border border-white/[0.12]'
                        : 'bg-white/[0.03] text-slate-600 border border-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    <span>{preset.label}</span>
                    <span style={{ color: canAfford ? meta.accentColor : undefined }} className="text-[10px]">
                      +{formatNum(gained)} {meta.currencySymbol}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* GAME 1: DEEP CORE MINE */}
          {activeGame === 'mine' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Pickaxe className="w-4 h-4 text-amber-400" />
                      <span>{meta.name}</span>
                    </h3>
                    <span className="text-sm font-mono-numbers font-bold text-amber-300">
                      보유 {formatNum(mg.mine.ore)} ◈
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-numbers">
                    <span className="text-white font-semibold">지하 깊이 Lv.{mg.mine.depth}</span>
                    <span>·</span>
                    <span className={mg.mine.isGemVein ? 'text-amber-300 font-semibold' : ''}>
                      {mg.mine.isGemVein ? '희귀 보석 맥 (관통 피해 1.55×)' : '일반 현무암층'}
                    </span>
                    <span>·</span>
                    <span>돌파 {formatNum(mg.mine.layersCleared)}층</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">암반 내구도</span>
                    <span className="text-white font-semibold">
                      {formatNum(mg.mine.layerHp)} / {formatNum(mg.mine.layerMaxHp)} HP
                    </span>
                  </div>
                  <div className="w-full h-3.5 rounded-lg bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-100"
                      style={{
                        width: `${Math.max(
                          2,
                          Math.min(100, (mg.mine.layerHp / Math.max(1, mg.mine.layerMaxHp)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono-numbers">
                    <span>수동 타격: {formatNum(mineMetrics.clickDamage)} DMG</span>
                    <span>자동 드릴: {formatNum(mineMetrics.autoDps)} DPS</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono-numbers text-amber-300">
                    <span>지진파 발파 충전 ({Math.floor(mg.mine.seismicCharge || 0)}%)</span>
                    <span>충전 완료 시 {formatNum(mineMetrics.seismicBurstDamage)} DMG</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all duration-100"
                      style={{ width: `${Math.min(100, mg.mine.seismicCharge || 0)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      data-testid="mine-dig-btn"
                      onClick={onDigMine}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Hammer className="w-4 h-4" />
                      <span>암반 굴착 (-{formatNum(mineMetrics.clickDamage)})</span>
                    </button>
                    <button
                      disabled={(mg.mine.seismicCharge || 0) < 100}
                      onClick={onTriggerMineSeismic}
                      className={`min-h-[44px] px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors ${
                        (mg.mine.seismicCharge || 0) >= 100
                          ? 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                          : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                      }`}
                    >
                      <Flame className="w-4 h-4" />
                      <span>지진파 발파</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    { kind: 'drill' as const, title: '충격 드릴 헤드', desc: '수동 굴착 피해량 대폭 상승', level: mg.mine.drillLevel },
                    { kind: 'autoDriller' as const, title: '무인 자동 채굴기', desc: '초당 자동 암반 시추 DPS', level: mg.mine.autoDrillerLevel },
                    { kind: 'laser' as const, title: '지질 관통 레이저', desc: '수동·자동 관통 효율 +48%', level: mg.mine.laserLevel },
                    { kind: 'blast' as const, title: '심부 코어 폭약', desc: '모든 굴착 피해 +38% 복리', level: mg.mine.blastLevel },
                    { kind: 'excavator' as const, title: '거대 터널 굴착기', desc: '굴착 장비 총출력 ×1.6', level: mg.mine.excavatorLevel || 0 },
                    { kind: 'seismic' as const, title: '초음파 지진 공명기', desc: '지진파 충전 속도·위력 증폭', level: mg.mine.seismicLevel || 0 },
                  ] as const
                ).map((item) => {
                  const cost = getMineUpgradeCost(mg.mine, item.kind);
                  const affordable = mg.mine.ore >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-white flex items-center justify-between">
                          <span>{item.title}</span>
                          <span className="font-mono-numbers text-amber-300">Lv.{item.level}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyMineUpgrade(item.kind)}
                        className={`w-full min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer transition-colors ${
                          affordable
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        강화 ({formatNum(cost)} ◈)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 2: FUSION POWER PLANT (4x4 GRID + TURBINE) */}
          {activeGame === 'reactor' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      <span>4×4 원자로 코어 매트릭스</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      연료봉 인접 터빈(+105%)·발전기(+60%)·냉각 벤트(+25%) 시너지 배치
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-cyan-300">
                      {formatNum(mg.reactor.totalEnergyMWh, 1)} MWh
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{reactorMetrics.effectiveEnergyPerSec.toFixed(1)} MWh/s · {formatNum(mg.reactor.plasma)} ⚡
                    </div>
                  </div>
                </div>

                {/* Brush Palette */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {(
                    [
                      { id: 'fuel' as const, label: `연료봉(${REACTOR_CELL_COST.fuel}⚡)`, Icon: Flame },
                      { id: 'generator' as const, label: `발전기(${REACTOR_CELL_COST.generator}⚡)`, Icon: Zap },
                      { id: 'coolant' as const, label: `냉각(${REACTOR_CELL_COST.coolant}⚡)`, Icon: Snowflake },
                      { id: 'turbine' as const, label: `터빈(${REACTOR_CELL_COST.turbine}⚡)`, Icon: Orbit },
                      { id: 'empty' as const, label: '철거', Icon: Trash2 },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setReactorBrush(id)}
                      className={`min-h-[38px] px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                        reactorBrush === id
                          ? 'bg-cyan-600 text-white border border-cyan-400/50'
                          : 'bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {/* 4x4 Matrix */}
                <div className="grid grid-cols-4 gap-2">
                  {mg.reactor.grid.map((cell, idx) => {
                    const label =
                      cell === 'fuel'
                        ? '연료봉'
                        : cell === 'generator'
                        ? '발전기'
                        : cell === 'coolant'
                        ? '냉각기'
                        : cell === 'turbine'
                        ? '증기터빈'
                        : '빈 슬롯';
                    const colorClass =
                      cell === 'fuel'
                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                        : cell === 'generator'
                        ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
                        : cell === 'coolant'
                        ? 'bg-sky-950/60 border-sky-400/50 text-sky-200'
                        : cell === 'turbine'
                        ? 'bg-emerald-950/60 border-emerald-400/50 text-emerald-300'
                        : 'bg-slate-950/70 border-slate-800 text-slate-500 hover:border-slate-600';
                    return (
                      <button
                        key={idx}
                        data-testid={`reactor-cell-${idx}`}
                        onClick={() => onPlaceReactorCell(idx, reactorBrush)}
                        className={`min-h-[50px] p-1 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer ${colorClass}`}
                      >
                        {cell === 'fuel' && <Flame className="w-3.5 h-3.5" />}
                        {cell === 'generator' && <Zap className="w-3.5 h-3.5" />}
                        {cell === 'coolant' && <Snowflake className="w-3.5 h-3.5" />}
                        {cell === 'turbine' && <Orbit className="w-3.5 h-3.5" />}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Heat Meter */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      {mg.reactor.overheated && <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                      <span>
                        노심 온도 {mg.reactor.heat.toFixed(0)}%{' '}
                        {mg.reactor.overheated
                          ? '(과열 정지)'
                          : reactorMetrics.isOverclockZone
                          ? '(과클럭 활성)'
                          : '(안정 구간)'}
                      </span>
                    </span>
                    <span className="text-slate-400">
                      {reactorMetrics.netHeatPerSec >= 0 ? '+' : ''}
                      {reactorMetrics.netHeatPerSec.toFixed(1)}%/s
                    </span>
                  </div>
                  <div className="relative w-full h-3 rounded-lg bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-100 ${
                        mg.reactor.overheated
                          ? 'bg-rose-500'
                          : reactorMetrics.isOverclockZone
                          ? 'bg-emerald-400'
                          : 'bg-cyan-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, mg.reactor.heat))}%` }}
                    />
                  </div>
                  <button
                    onClick={onVentReactor}
                    className="w-full min-h-[40px] px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-cyan-300 text-xs font-bold cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Wind className="w-4 h-4" />
                    <span>긴급 냉각 배기 (-38% 온도)</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-2">
                {(
                  [
                    { kind: 'efficiency' as const, title: '고밀도 노심 튜닝', desc: '연료봉 발전량 +36% 복리', levelText: `Lv.${mg.reactor.coreEfficiencyLevel}`, maxed: false },
                    { kind: 'coolantTech' as const, title: '초전도 냉각 순환', desc: '냉각 벤트 방열 성능 강화', levelText: `Lv.${mg.reactor.coolantTechLevel}`, maxed: false },
                    { kind: 'turbineTech' as const, title: '초임계 증기 터빈', desc: '터빈 인접 발전 시너지 +40%', levelText: `Lv.${mg.reactor.turbineTechLevel || 0}`, maxed: false },
                    { kind: 'overclockShield' as const, title: '고열 과클럭 차폐막', desc: '과클럭 허용 온도 & 배수 상승', levelText: `Lv.${mg.reactor.overclockShieldLevel || 0}`, maxed: false },
                    { kind: 'autoVent' as const, title: '자동 안전 배기 밸브', desc: '과열 전 자동 열 배출', levelText: mg.reactor.autoVentUnlocked ? '해금됨' : '미해금', maxed: mg.reactor.autoVentUnlocked },
                  ] as const
                ).map((item) => {
                  const cost = getReactorUpgradeCost(mg.reactor, item.kind);
                  const affordable = !item.maxed && mg.reactor.plasma >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white">
                          {item.title}{' '}
                          <span className="font-mono-numbers text-cyan-300">{item.levelText}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyReactorUpgrade(item.kind)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                          item.maxed
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50 cursor-default'
                            : affordable
                            ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        {item.maxed ? '완료' : `${formatNum(cost)} ⚡`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 3: ORBITAL SHIPYARD (5 UNITS) */}
          {activeGame === 'shipyard' && (
            <div className="space-y-3.5">
              <div className="p-4 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-indigo-400" />
                    <span>심우주 5단계 물류 공방</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-numbers mt-0.5">
                    <span>함대 Lv.{mg.shipyard.fleetPrestigeLevel}</span>
                    <span>·</span>
                    <span>배율 ×{mg.shipyard.fleetMultiplier.toFixed(2)}</span>
                    <span>·</span>
                    <span className="text-white font-semibold">
                      누적 수송 {formatNum(mg.shipyard.totalCargoShipped, 1)} t
                    </span>
                    <span>·</span>
                    <span className="text-indigo-300 font-semibold">
                      보유 {formatNum(mg.shipyard.darkmatter)} ✦
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onBoostShipyard}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    공정 가속
                  </button>
                  <button
                    disabled={mg.shipyard.totalCargoShipped < shipyardMetrics.prestigeReq}
                    onClick={onPrestigeShipyard}
                    className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap cursor-pointer ${
                      mg.shipyard.totalCargoShipped >= shipyardMetrics.prestigeReq
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    함대 도약 ({formatNum(mg.shipyard.totalCargoShipped)}/{formatNum(shipyardMetrics.prestigeReq)} t)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {(
                  [
                    { kind: 'drone' as const, step: '1단계 · 채굴', title: '궤도 조립 드론', count: `${mg.shipyard.droneCount}대`, stat: `합금 ${formatNum(mg.shipyard.alloyParts, 1)} (+${shipyardMetrics.alloyPerSec.toFixed(1)}/s)` },
                    { kind: 'refinery' as const, step: '2단계 · 정제', title: '반물질 제련소', count: `${mg.shipyard.refineryCount}기`, stat: `연료 ${formatNum(mg.shipyard.antimatter, 1)}` },
                    { kind: 'freighter' as const, step: '3단계 · 수송', title: '성간 화물선', count: `${mg.shipyard.freighterCount}척`, stat: `출하 ${shipyardMetrics.cargoPerSecCap.toFixed(1)} t/s` },
                    { kind: 'orbitalHub' as const, step: '4단계 · 허브', title: '궤도 릴레이 허브', count: `${mg.shipyard.orbitalHubCount || 0}기`, stat: `전공정 ×${shipyardMetrics.hubMult.toFixed(2)}` },
                    { kind: 'warpDrive' as const, step: '5단계 · 워프', title: '초광속 워프 코어', count: `Lv.${mg.shipyard.warpDriveLevel || 0}`, stat: `출력 ×${shipyardMetrics.warpMult.toFixed(2)}` },
                  ] as const
                ).map((stage) => {
                  const cost = getShipyardUnitCost(mg.shipyard, stage.kind);
                  const affordable = mg.shipyard.darkmatter >= cost;
                  return (
                    <div
                      key={stage.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-400">{stage.step}</div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-white truncate">{stage.title}</span>
                          <span className="text-xs font-mono-numbers text-indigo-300 font-bold shrink-0">
                            {stage.count}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-numbers text-slate-300 pt-1">
                          {stage.stat}
                        </div>
                      </div>

                      <button
                        disabled={!affordable}
                        onClick={() => onBuyShipyardUnit(stage.kind)}
                        className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                          affordable
                            ? 'bg-indigo-500 hover:bg-indigo-400 text-white'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        증설 ({formatNum(cost)} ✦)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 4: QUANTUM RESEARCH LAB */}
          {activeGame === 'quantum' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Atom className="w-4 h-4 text-emerald-400" />
                      <span>파형 공명 튜너 & 차원 도약</span>
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono-numbers mt-0.5">
                      <span>도약 Lv.{mg.quantum.leapCount || 0} (×{quantumMetrics.leapMult.toFixed(1)})</span>
                      <span>·</span>
                      <span className="text-emerald-300 font-semibold">
                        일치 {quantumMetrics.matchedChannels}/3 · ×{quantumMetrics.resonanceMult.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-emerald-300">
                      {formatNum(mg.quantum.researchPoints, 1)} RP
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{quantumMetrics.passiveRpPerSec.toFixed(1)} RP/s · {formatNum(mg.quantum.qubits)} ⚛
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {(['Alpha 채널', 'Beta 채널', 'Gamma 채널'] as const).map((label, idx) => {
                    const chIdx = idx as 0 | 1 | 2;
                    const target = mg.quantum.targetWave[chIdx];
                    const current = mg.quantum.tunedWave[chIdx];
                    const matched = target === current;
                    return (
                      <div
                        key={label}
                        className="p-2.5 rounded-lg bg-[#070b14] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="flex items-center justify-between sm:justify-start gap-2">
                          <span className="text-xs font-semibold text-white">{label}</span>
                          <span className={`text-xs font-mono-numbers ${matched ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                            목표 {target} {matched ? '· 공명 중' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3, 4, 5].map((val) => (
                            <button
                              key={val}
                              onClick={() => onTuneQuantumWave(chIdx, val)}
                              className={`min-w-[36px] min-h-[34px] rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                                current === val
                                  ? matched
                                    ? 'bg-emerald-500 text-slate-950'
                                    : 'bg-sky-600 text-white'
                                  : 'bg-white/[0.05] text-slate-300 border border-white/[0.08] hover:bg-white/[0.1]'
                              }`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">사이클 ({mg.quantum.experimentsCompleted}회 완료)</span>
                    <span className="text-emerald-300 font-semibold">
                      {(mg.quantum.experimentProgress * 100).toFixed(0)}% · +{formatNum(quantumMetrics.experimentRewardRp)} RP
                    </span>
                  </div>
                  <div className="w-full h-3 rounded-lg bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-100"
                      style={{ width: `${Math.min(100, Math.max(2, mg.quantum.experimentProgress * 100))}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      data-testid="quantum-pulse-btn"
                      onClick={onPulseQuantum}
                      className="min-h-[42px] px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Layers className="w-4 h-4" />
                      <span>양자 펄스 (+25%)</span>
                    </button>
                    <button
                      disabled={mg.quantum.experimentsCompleted < quantumMetrics.leapReq}
                      onClick={onLeapQuantum}
                      className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-mono-numbers font-bold flex items-center justify-center gap-1.5 ${
                        mg.quantum.experimentsCompleted >= quantumMetrics.leapReq
                          ? 'bg-indigo-500 hover:bg-indigo-400 text-white cursor-pointer'
                          : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                      }`}
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>차원 도약 ({mg.quantum.experimentsCompleted}/{quantumMetrics.leapReq})</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-2">
                {(
                  [
                    { kind: 'accelerator' as const, title: '입자 가속기 코일', desc: '실험 사이클 속도 +50%', levelText: `Lv.${mg.quantum.acceleratorLevel}`, maxed: false },
                    { kind: 'amplifier' as const, title: '양자 데이터 증폭기', desc: '실험 완료 RP 보상 증가', levelText: `Lv.${mg.quantum.amplifierLevel}`, maxed: false },
                    { kind: 'entanglement' as const, title: '양자 얽힘 관측기', desc: '초당 자동 RP 축적', levelText: `Lv.${mg.quantum.entanglementLevel}`, maxed: false },
                    { kind: 'cryo' as const, title: '극저온 초전도 챔버', desc: '전체 RP 획득량 ×1.38', levelText: `Lv.${mg.quantum.cryoLevel || 0}`, maxed: false },
                    { kind: 'autoTuner' as const, title: '자동 공명 오토튜너', desc: '목표 파형 자동 동기화', levelText: mg.quantum.autoTunerUnlocked ? '해금됨' : '미해금', maxed: Boolean(mg.quantum.autoTunerUnlocked) },
                  ] as const
                ).map((item) => {
                  const cost = getQuantumUpgradeCost(mg.quantum, item.kind);
                  const affordable = !item.maxed && mg.quantum.qubits >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white">
                          {item.title}{' '}
                          <span className="font-mono-numbers text-emerald-300">{item.levelText}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyQuantumUpgrade(item.kind)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                          item.maxed
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50 cursor-default'
                            : affordable
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        {item.maxed ? '완료' : `${formatNum(cost)} ⚛`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 5: ORBITAL SOLAR ARRAY */}
          {activeGame === 'solar' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Sun className="w-4 h-4 text-yellow-400" />
                      <span>{meta.name}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      최적 궤도각 {mg.solar.optimalAngle} 일치 시 발전 출력 ×3.0 배율!
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-yellow-300">
                      {formatNum(mg.solar.totalPowerGW, 1)} GW
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{solarMetrics.gwPerSec.toFixed(1)} GW/s · {formatNum(mg.solar.photons)} ☀
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#070b14] border border-white/[0.07] space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">
                      현재 궤도 거울각: <strong className="text-white">{mg.solar.orbitalAngle}</strong> (목표 {mg.solar.optimalAngle})
                    </span>
                    <span className="text-yellow-300 font-bold">
                      정렬 배율 ×{solarMetrics.alignmentMult.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((ang) => {
                      const isCur = mg.solar.orbitalAngle === ang;
                      const isOpt = mg.solar.optimalAngle === ang;
                      return (
                        <button
                          key={ang}
                          onClick={() => onSetSolarAngle(ang)}
                          className={`min-h-[36px] rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                            isCur && isOpt
                              ? 'bg-yellow-400 text-slate-950'
                              : isCur
                              ? 'bg-sky-600 text-white'
                              : isOpt
                              ? 'bg-white/[0.06] border border-amber-400/60 text-amber-300'
                              : 'bg-[#070b14] border border-white/[0.07] text-slate-400 hover:bg-white/[0.06]'
                          }`}
                        >
                          {ang}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers text-slate-300">
                    <span>태양풍 펄스 충전 ({Math.floor(mg.solar.pulseCharge)}%)</span>
                    <span className="text-yellow-300">+{formatNum(solarMetrics.pulseGw)} GW</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-yellow-400 transition-all duration-100"
                      style={{ width: `${Math.min(100, mg.solar.pulseCharge)}%` }}
                    />
                  </div>
                  <button
                    data-testid="solar-pulse-btn"
                    onClick={onPulseSolar}
                    className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-bold text-xs cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Sun className="w-4 h-4" />
                    <span>태양광 집중 펄스 (+{formatNum(solarMetrics.pulseGw)} GW)</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    { kind: 'mirror' as const, title: '궤도 집광 거울', desc: '기초 발전량 기하급수 상승', levelText: `${mg.solar.mirrorCount}기`, maxed: false },
                    { kind: 'collector' as const, title: '광전 변환 수신기', desc: '거울당 출력 +65% 증폭', levelText: `${mg.solar.collectorCount}기`, maxed: false },
                    { kind: 'tracker' as const, title: '정밀 자이로 추적기', desc: '송전 효율 +45% / 레벨', levelText: `Lv.${mg.solar.trackerLevel}`, maxed: false },
                    { kind: 'flare' as const, title: '코로나 플레어 수집기', desc: '집광 출력 ×1.38 복리', levelText: `Lv.${mg.solar.solarFlareLevel}`, maxed: false },
                    { kind: 'concentrator' as const, title: '라그랑주 초집속 렌즈', desc: '전체 발전 ×1.50 배율', levelText: `Lv.${mg.solar.concentratorLevel}`, maxed: false },
                    { kind: 'autoTracker' as const, title: '자동 궤도 추적 AI', desc: '최적 궤도각 영구 고정', levelText: mg.solar.autoTrackerUnlocked ? '해금됨' : '미해금', maxed: mg.solar.autoTrackerUnlocked },
                  ] as const
                ).map((item) => {
                  const cost = getSolarUpgradeCost(mg.solar, item.kind);
                  const affordable = !item.maxed && mg.solar.photons >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-white flex items-center justify-between">
                          <span>{item.title}</span>
                          <span className="font-mono-numbers text-yellow-300">{item.levelText}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuySolarUpgrade(item.kind)}
                        className={`w-full min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                          item.maxed
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50 cursor-default'
                            : affordable
                            ? 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        {item.maxed ? '완료' : `강화 (${formatNum(cost)} ☀)`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 6: TERRA BIODOME */}
          {activeGame === 'bio' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Sprout className="w-4 h-4 text-green-400" />
                      <span>{meta.name}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      진화 Lv.{mg.bio.evolutionLevel} (×{(mg.bio.evolutionMultiplier || 1).toFixed(2)}) · 습도 45~75% 유지 시 ×{bioMetrics.climateMult.toFixed(1)}
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-green-300">
                      {formatNum(mg.bio.totalBiomass, 1)} Bio
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{bioMetrics.baseBioPerSec.toFixed(1)} Bio/s · {formatNum(mg.bio.spores)} ✿
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#070b14] border border-white/[0.07] space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300 flex items-center gap-1">
                      <Droplets className="w-3.5 h-3.5 text-sky-400" />
                      둠 내부 습도 {mg.bio.humidity.toFixed(0)}%
                    </span>
                    <span className={bioMetrics.isOptimalHumidity ? 'text-green-400 font-bold' : 'text-amber-400'}>
                      {bioMetrics.isOptimalHumidity ? '최적 광합성 구간 (45~75%)' : '습도 조절 필요'}
                    </span>
                  </div>
                  <div className="relative w-full h-3 rounded-lg bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-green-500/20 border-x border-green-500/40"
                      style={{ left: '45%', width: '30%' }}
                    />
                    <div
                      className={`h-full transition-all duration-100 ${
                        bioMetrics.isOptimalHumidity ? 'bg-green-400' : 'bg-amber-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, mg.bio.humidity))}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onMistBio(10)}
                      className="min-h-[36px] rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-sky-300 text-xs font-bold cursor-pointer"
                    >
                      가습 분사 (+10%)
                    </button>
                    <button
                      onClick={() => onMistBio(-10)}
                      className="min-h-[36px] rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-amber-300 text-xs font-bold cursor-pointer"
                    >
                      환기 제습 (-10%)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    data-testid="bio-cultivate-btn"
                    onClick={onCultivateBio}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-slate-950 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Sprout className="w-4 h-4" />
                    <span>생태 배양 촉진</span>
                  </button>
                  <button
                    disabled={mg.bio.totalBiomass < bioMetrics.evolveReq}
                    onClick={onEvolveBio}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-mono-numbers font-bold flex items-center justify-center gap-1.5 ${
                      mg.bio.totalBiomass >= bioMetrics.evolveReq
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                        : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    <span>생태계 진화 ({formatNum(mg.bio.totalBiomass)}/{formatNum(bioMetrics.evolveReq)})</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    { kind: 'algae' as const, title: '광합성 조류 탱크', desc: '초당 기초 바이오매스 생산', levelText: `${mg.bio.algaeCount}기` },
                    { kind: 'forest' as const, title: '아열대 원시림 돔', desc: '강력한 2단계 산림 생산', levelText: `${mg.bio.forestCount}기` },
                    { kind: 'biosphere' as const, title: '자립 생물권 모듈', desc: '초고밀도 생태계 클러스터', levelText: `${mg.bio.biosphereCount}기` },
                    { kind: 'enzyme' as const, title: '유전자 촉매 효소', desc: '모든 바이오 생산량 ×1.36', levelText: `Lv.${mg.bio.enzymeLevel}` },
                    { kind: 'climateReg' as const, title: '자동 기후 제어망', desc: '최적 습도 보너스 & 안정화', levelText: `Lv.${mg.bio.climateRegLevel}` },
                  ] as const
                ).map((item) => {
                  const cost = getBioUpgradeCost(mg.bio, item.kind);
                  const affordable = mg.bio.spores >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-white flex items-center justify-between">
                          <span>{item.title}</span>
                          <span className="font-mono-numbers text-green-300">{item.levelText}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyBioUpgrade(item.kind)}
                        className={`w-full min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                          affordable
                            ? 'bg-green-500 hover:bg-green-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        배양 ({formatNum(cost)} ✿)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 7: SUPERCONDUCTING COLLIDER */}
          {activeGame === 'collider' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 p-4 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Orbit className="w-4 h-4 text-pink-400" />
                      <span>{meta.name}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      희귀 입자 {mg.collider.exoticParticles}개 보유 (충돌 에너지 ×{colliderMetrics.exoticMult.toFixed(2)})
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-pink-300">
                      {formatNum(mg.collider.totalCollisions, 1)} TeV
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{colliderMetrics.tevPerSec.toFixed(1)} TeV/s · {formatNum(mg.collider.beamCurrency)} ⊕
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">빔 광도(Luminosity) 충전 ({Math.floor(mg.collider.luminosity)}%)</span>
                    <span className="text-pink-300">폭주 +{formatNum(colliderMetrics.burstDamageTeV)} TeV</span>
                  </div>
                  <div className="w-full h-3.5 rounded-lg bg-[#070b14] border border-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-pink-500 transition-all duration-100"
                      style={{ width: `${Math.min(100, mg.collider.luminosity)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    data-testid="collider-collide-btn"
                    onClick={onCollideParticles}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-400 text-slate-950 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Atom className="w-4 h-4" />
                    <span>양성자 빔 가속·충돌</span>
                  </button>
                  <button
                    disabled={mg.collider.luminosity < 100}
                    onClick={onBurstCollider}
                    className={`min-h-[44px] px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 ${
                      mg.collider.luminosity >= 100
                        ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white cursor-pointer'
                        : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>초고에너지 빔 폭주</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    { kind: 'magnet' as const, title: '초전도 쌍극자 자석', desc: '초당 충돌 에너지 기초 상승', level: mg.collider.magnetLevel },
                    { kind: 'vacuum' as const, title: '극고진공 빔 파이프', desc: '가속기 빔 순도 +48%', level: mg.collider.vacuumLevel },
                    { kind: 'detector' as const, title: '다중 입자 검출기', desc: 'TeV 포집 효율 +55%', level: mg.collider.detectorLevel },
                    { kind: 'superCoil' as const, title: '니오븀 초전도 코일', desc: '전체 충돌 에너지 ×1.42', level: mg.collider.superCoilLevel },
                    { kind: 'injector' as const, title: '고출력 선형 인젝터', desc: '광도 충전 속도 대폭 증가', level: mg.collider.injectorLevel },
                    { kind: 'resonanceBurst' as const, title: '특이점 공명 폭주관', desc: '빔 폭주 TeV & 희귀 입자 증가', level: mg.collider.resonanceBurstLevel },
                  ] as const
                ).map((item) => {
                  const cost = getColliderUpgradeCost(mg.collider, item.kind);
                  const affordable = mg.collider.beamCurrency >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-white flex items-center justify-between">
                          <span>{item.title}</span>
                          <span className="font-mono-numbers text-pink-300">Lv.{item.level}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyColliderUpgrade(item.kind)}
                        className={`w-full min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer ${
                          affordable
                            ? 'bg-pink-500 hover:bg-pink-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        증설 ({formatNum(cost)} ⊕)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* MILESTONE PROGRESSION TRACK FOR ACTIVE MINIGAME (8 Tiers per game) */}
          <section
            data-testid="minigame-milestones"
            className="pt-4 border-t border-white/[0.07] space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">
                  {meta.shortName} 마일스톤 8단계 (달성 시 메인 자금 수익 영구 부스트)
                </h3>
              </div>
              <span className="text-xs font-mono-numbers text-emerald-400 font-semibold">
                전체 미니게임 보너스 +{milestoneSummary.totalBoostPct}% (×{milestoneSummary.incomeMult.toFixed(2)})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {milestoneSummary.statuses.map((ms) => (
                <div
                  key={ms.def.id}
                  data-testid={`milestone-card-${ms.def.id}`}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-2 ${
                    ms.achieved
                      ? 'bg-emerald-950/25 border-emerald-500/40'
                      : 'bg-[#10182b] border-white/[0.08]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[11px] font-mono-numbers">
                      <span className={ms.achieved ? 'text-emerald-300 font-bold' : 'text-slate-400'}>
                        Tier {ms.def.tier}
                      </span>
                      <span className="text-amber-300 font-bold">
                        메인 수익 +{ms.def.incomeBoostPct}%
                      </span>
                    </div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      {ms.achieved && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className="truncate">{ms.def.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{ms.def.description}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="w-full h-1.5 rounded-full bg-[#070b14] border border-white/[0.05] overflow-hidden">
                      <div
                        className={`h-full transition-all duration-150 rounded-full ${
                          ms.achieved ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                        style={{ width: `${ms.progressPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono-numbers text-slate-400">
                      <span>
                        {formatNum(ms.currentValue)} / {formatNum(ms.def.targetValue)} {ms.def.unitLabel}
                      </span>
                      <span className={ms.achieved ? 'text-emerald-400 font-bold' : ''}>
                        {ms.achieved ? '달성' : `${ms.progressPct.toFixed(0)}%`}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono-numbers">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <span>화폐는 $ → 화폐 단방향 환전 전용 · 마일스톤 달성 시 메인 자금($) 수익 부스트 적용</span>
            </span>
            <span>누적 환전 투자액: ${formatNum(mg.totalMoneyInvested)}</span>
          </div>
      </div>
    </ModalShell>
  );
};
