import React, { useState } from 'react';
import {
  ArrowRight,
  Atom,
  CheckCircle2,
  Cpu,
  Flame,
  Gamepad2,
  Hammer,
  Layers,
  Pickaxe,
  Rocket,
  ShieldAlert,
  Snowflake,
  Trash2,
  Trophy,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { GameState, MinigameId, ReactorCellType } from '../game/types';
import {
  calculateExchangePreview,
  getMineMetrics,
  getMineUpgradeCost,
  getMinigameMilestoneSummary,
  getQuantumMetrics,
  getQuantumUpgradeCost,
  getReactorMetrics,
  getReactorUpgradeCost,
  getShipyardMetrics,
  getShipyardUnitCost,
  MINIGAME_META,
  MINIGAME_ORDER,
  MineUpgradeKind,
  QuantumUpgradeKind,
  REACTOR_CELL_COST,
  ReactorUpgradeKind,
  ShipyardUnitKind,
} from '../game/minigames';

interface TownArcadePanelProps {
  gameState: GameState;
  onClose: () => void;
  onExchangeMoney: (gameId: MinigameId, moneyAmount: number) => void;
  onDigMine: () => void;
  onBuyMineUpgrade: (kind: MineUpgradeKind) => void;
  onPlaceReactorCell: (cellIndex: number, cellType: ReactorCellType) => void;
  onVentReactor: () => void;
  onBuyReactorUpgrade: (kind: ReactorUpgradeKind) => void;
  onBoostShipyard: () => void;
  onBuyShipyardUnit: (kind: ShipyardUnitKind) => void;
  onPrestigeShipyard: () => void;
  onTuneQuantumWave: (channelIndex: 0 | 1 | 2, value: number) => void;
  onPulseQuantum: () => void;
  onBuyQuantumUpgrade: (kind: QuantumUpgradeKind) => void;
}

function formatNum(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
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
  onDigMine,
  onBuyMineUpgrade,
  onPlaceReactorCell,
  onVentReactor,
  onBuyReactorUpgrade,
  onBoostShipyard,
  onBuyShipyardUnit,
  onPrestigeShipyard,
  onTuneQuantumWave,
  onPulseQuantum,
  onBuyQuantumUpgrade,
}) => {
  const [activeGame, setActiveGame] = useState<MinigameId>('mine');
  const [reactorBrush, setReactorBrush] = useState<ReactorCellType>('fuel');

  const mg = gameState.minigames;
  const meta = MINIGAME_META[activeGame];

  // Exchange preset batches (strictly one-way & exclusive: Money $ -> Unique Currency)
  const quarterCapital = Math.floor(gameState.capital * 0.25);
  const exchangePresets = [
    { label: `$${meta.moneyPerBatch.toLocaleString()}`, amount: meta.moneyPerBatch },
    { label: `$${(meta.moneyPerBatch * 10).toLocaleString()}`, amount: meta.moneyPerBatch * 10 },
    { label: `$${(meta.moneyPerBatch * 100).toLocaleString()}`, amount: meta.moneyPerBatch * 100 },
    {
      label: `자금 25% ($${quarterCapital.toLocaleString()})`,
      amount: quarterCapital,
    },
  ];

  const getCurrencyBalance = (id: MinigameId): number => {
    if (id === 'mine') return mg.mine.ore;
    if (id === 'reactor') return mg.reactor.plasma;
    if (id === 'shipyard') return mg.shipyard.darkmatter;
    return mg.quantum.qubits;
  };

  const mineMetrics = getMineMetrics(mg.mine);
  const reactorMetrics = getReactorMetrics(mg.reactor);
  const shipyardMetrics = getShipyardMetrics(mg.shipyard);
  const quantumMetrics = getQuantumMetrics(mg.quantum);
  const milestoneSummary = getMinigameMilestoneSummary(mg, activeGame);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:px-4 sm:pt-16 sm:pb-20 pb-[calc(env(safe-area-inset-bottom)+68px)] bg-black/70"
    >
      <div
        data-testid="town-arcade-modal"
        className="w-full max-w-5xl h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[calc(100dvh-152px)] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0d1424] border-t sm:border border-slate-800 shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Gamepad2 className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                  타운 미니게임 허브
                </h2>
                <p className="hidden sm:block text-xs text-slate-400">
                  화폐는 돈($) 환전으로만 획득 · 마일스톤 달성 시 메인 자금 수익 영구 부스트
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="sm:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4">
            <div className="flex items-center gap-3 text-xs font-mono-numbers overflow-x-auto no-scrollbar">
              <span className="text-amber-300 whitespace-nowrap">
                ◈ {formatNum(mg.mine.ore)}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-cyan-300 whitespace-nowrap">
                ⚡ {formatNum(mg.reactor.plasma)}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-indigo-300 whitespace-nowrap">
                ✦ {formatNum(mg.shipyard.darkmatter)}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-emerald-300 whitespace-nowrap">
                ⚛ {formatNum(mg.quantum.qubits)}
              </span>
            </div>

            <div className="text-right font-mono-numbers shrink-0">
              <div className="text-[10px] text-slate-400">메인 자금</div>
              <div className="text-xs sm:text-sm font-bold text-emerald-400">
                ${Math.floor(gameState.capital).toLocaleString()}
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="닫기"
              className="hidden sm:flex min-w-[38px] min-h-[38px] items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Game Switcher Tabs */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/50 overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-1.5">
            {MINIGAME_ORDER.map((id) => {
              const m = MINIGAME_META[id];
              const isActive = activeGame === id;
              const bal = getCurrencyBalance(id);
              return (
                <button
                  key={id}
                  data-testid={`minigame-tab-${id}`}
                  onClick={() => setActiveGame(id)}
                  className={`min-h-[40px] flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-slate-800 text-white border border-slate-600'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <span style={{ color: m.accentColor }} className="font-mono-numbers font-bold">
                    {m.currencySymbol}
                  </span>
                  <span>{m.name}</span>
                  <span className="text-[11px] font-mono-numbers text-slate-400">
                    {formatNum(bal)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            data-testid="milestone-boost-badge"
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs font-mono-numbers shrink-0"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-300">
              마일스톤 {milestoneSummary.unlockedCount}/{milestoneSummary.totalCount}
            </span>
            <span className="text-emerald-400 font-bold">
              메인 수익 ×{milestoneSummary.incomeMult.toFixed(2)} (+{milestoneSummary.totalBoostPct}%)
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5">
          {/* Mobile Milestone Boost Summary */}
          <div className="md:hidden p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between text-xs font-mono-numbers">
            <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>
                마일스톤 {milestoneSummary.unlockedCount}/{milestoneSummary.totalCount}
              </span>
            </span>
            <span className="text-emerald-400 font-bold">
              메인 수익 ×{milestoneSummary.incomeMult.toFixed(2)} (+{milestoneSummary.totalBoostPct}%)
            </span>
          </div>

          {/* Strictly One-Way & Exclusive Exchange Strip */}
          <section
            data-testid="oneway-exchange-bar"
            className="p-3.5 sm:p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
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
                {meta.currencySymbol} · 미니게임 화폐는 오직 돈($) 환전으로만 획득 (직접 채굴·역환전 불가)
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
                    className={`min-h-[42px] px-3 py-1.5 rounded-lg text-xs font-mono-numbers font-semibold transition-colors cursor-pointer whitespace-nowrap flex flex-col items-center justify-center ${
                      canAfford
                        ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-600'
                        : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
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
              {/* Arena */}
              <div className="lg:col-span-6 p-4 sm:p-5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between gap-4">
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
                    <span aria-hidden="true">·</span>
                    <span className={mg.mine.isGemVein ? 'text-amber-300 font-semibold' : ''}>
                      {mg.mine.isGemVein ? '희귀 보석 맥 (관통 피해 1.5×)' : '일반 현무암층'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>돌파 층수 {formatNum(mg.mine.layersCleared)}층</span>
                  </div>
                </div>

                {/* Stratum HP Bar */}
                <div className="space-y-2 py-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">암반 내구도</span>
                    <span className="text-white font-semibold">
                      {formatNum(mg.mine.layerHp)} / {formatNum(mg.mine.layerMaxHp)} HP
                    </span>
                  </div>
                  <div className="w-full h-4 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
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
                    <span>수동 타격력: {formatNum(mineMetrics.clickDamage)} DMG</span>
                    <span>자동 드릴: {formatNum(mineMetrics.autoDps)} DPS</span>
                  </div>
                </div>

                <button
                  data-testid="mine-dig-btn"
                  onClick={onDigMine}
                  className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Hammer className="w-4 h-4" />
                  <span>암반 굴착하기 (-{formatNum(mineMetrics.clickDamage)} HP)</span>
                </button>
              </div>

              {/* Mine Upgrades */}
              <div className="lg:col-span-6 space-y-2.5">
                {(
                  [
                    {
                      kind: 'drill' as const,
                      title: '충격 드릴 헤드',
                      desc: '클릭 굴착 타격력을 증폭해 다음 깊이 마일스톤을 빠르게 돌파합니다.',
                      level: mg.mine.drillLevel,
                    },
                    {
                      kind: 'autoDriller' as const,
                      title: '무인 자동 채굴기',
                      desc: '초당 자동 암반 피해를 입혀 깊이 Lv을 지속적으로 확장합니다.',
                      level: mg.mine.autoDrillerLevel,
                    },
                    {
                      kind: 'laser' as const,
                      title: '지질 관통 레이저',
                      desc: '수동·자동 굴착 관통 효율을 +45%씩 높여 심부 돌파를 가속합니다.',
                      level: mg.mine.laserLevel,
                    },
                    {
                      kind: 'blast' as const,
                      title: '심부 코어 폭약',
                      desc: '수동 타격과 자동 드릴 피해량을 동시에 +35%씩 증폭합니다.',
                      level: mg.mine.blastLevel,
                    },
                  ] as const
                ).map((item) => {
                  const cost = getMineUpgradeCost(mg.mine, item.kind);
                  const affordable = mg.mine.ore >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {item.title}{' '}
                          <span className="text-xs font-mono-numbers text-amber-300 font-semibold">
                            Lv.{item.level}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyMineUpgrade(item.kind)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          affordable
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {formatNum(cost)} ◈
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GAME 2: FUSION POWER PLANT */}
          {activeGame === 'reactor' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 3x3 Grid & Heat */}
              <div className="lg:col-span-7 p-4 sm:p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      <span>3×3 원자로 코어 매트릭스</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      연료봉 옆에 발전기를 두면 출력 +55%, 냉각 벤트는 안정화 +25%
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-cyan-300">
                      {formatNum(mg.reactor.totalEnergyMWh, 1)} MWh
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{reactorMetrics.effectiveEnergyPerSec.toFixed(1)} MWh/s · 보유 {formatNum(mg.reactor.plasma)} ⚡
                    </div>
                  </div>
                </div>

                {/* Brush Palette */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {(
                    [
                      { id: 'fuel' as const, label: `연료봉 (${REACTOR_CELL_COST.fuel}⚡)`, Icon: Flame },
                      {
                        id: 'generator' as const,
                        label: `발전기 (${REACTOR_CELL_COST.generator}⚡)`,
                        Icon: Zap,
                      },
                      {
                        id: 'coolant' as const,
                        label: `냉각기 (${REACTOR_CELL_COST.coolant}⚡)`,
                        Icon: Snowflake,
                      },
                      { id: 'empty' as const, label: '철거 (비우기)', Icon: Trash2 },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setReactorBrush(id)}
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                        reactorBrush === id
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {/* 3x3 Matrix */}
                <div className="grid grid-cols-3 gap-2">
                  {mg.reactor.grid.map((cell, idx) => {
                    const label =
                      cell === 'fuel'
                        ? '연료봉'
                        : cell === 'generator'
                        ? '터보 발전기'
                        : cell === 'coolant'
                        ? '냉각 벤트'
                        : '빈 슬롯';
                    const colorClass =
                      cell === 'fuel'
                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                        : cell === 'generator'
                        ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
                        : cell === 'coolant'
                        ? 'bg-sky-950/60 border-sky-400/50 text-sky-200'
                        : 'bg-slate-950/70 border-slate-800 text-slate-500 hover:border-slate-600';
                    return (
                      <button
                        key={idx}
                        data-testid={`reactor-cell-${idx}`}
                        onClick={() => onPlaceReactorCell(idx, reactorBrush)}
                        className={`min-h-[56px] p-1.5 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-xs font-semibold cursor-pointer transition-colors ${colorClass}`}
                      >
                        {cell === 'fuel' && <Flame className="w-4 h-4" />}
                        {cell === 'generator' && <Zap className="w-4 h-4" />}
                        {cell === 'coolant' && <Snowflake className="w-4 h-4" />}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Heat Meter */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      {mg.reactor.overheated && (
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      )}
                      <span>
                        노심 온도 {mg.reactor.heat.toFixed(0)}%{' '}
                        {mg.reactor.overheated
                          ? '(과열 정지 · 냉각 중)'
                          : reactorMetrics.isOverclockZone
                          ? '(최적 과클럭 ×1.6)'
                          : '(안정 구간)'}
                      </span>
                    </span>
                    <span className="text-slate-400">
                      {reactorMetrics.netHeatPerSec >= 0 ? '+' : ''}
                      {reactorMetrics.netHeatPerSec.toFixed(1)}%/s
                    </span>
                  </div>
                  <div className="relative w-full h-3.5 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-emerald-500/20 border-x border-emerald-500/40"
                      style={{ left: '45%', width: '43%' }}
                    />
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
                    className="w-full min-h-[42px] px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold cursor-pointer flex items-center justify-center gap-2 transition-colors"
                  >
                    <Wind className="w-4 h-4" />
                    <span>긴급 냉각 배기 (-35% 온도)</span>
                  </button>
                </div>
              </div>

              {/* Reactor Tech Upgrades */}
              <div className="lg:col-span-5 space-y-2.5">
                {(
                  [
                    {
                      kind: 'efficiency' as const,
                      title: '고밀도 노심 튜닝',
                      desc: '모든 연료봉의 전력(MWh) 발전량을 +32%씩 복리 증폭합니다.',
                      levelText: `Lv.${mg.reactor.coreEfficiencyLevel}`,
                      maxed: false,
                    },
                    {
                      kind: 'coolantTech' as const,
                      title: '초전도 냉각 순환',
                      desc: '설치된 모든 냉각 벤트의 방열 성능을 크게 높입니다.',
                      levelText: `Lv.${mg.reactor.coolantTechLevel}`,
                      maxed: false,
                    },
                    {
                      kind: 'autoVent' as const,
                      title: '자동 안전 배기 밸브',
                      desc: '노심 온도 92% 도달 시 과열 없이 자동으로 열을 배출합니다.',
                      levelText: mg.reactor.autoVentUnlocked ? '해금됨' : '미해금',
                      maxed: mg.reactor.autoVentUnlocked,
                    },
                  ] as const
                ).map((item) => {
                  const cost = getReactorUpgradeCost(mg.reactor, item.kind);
                  const affordable = !item.maxed && mg.reactor.plasma >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {item.title}{' '}
                          <span className="text-xs font-mono-numbers text-cyan-300 font-semibold">
                            {item.levelText}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyReactorUpgrade(item.kind)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          item.maxed
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50 cursor-default'
                            : affordable
                            ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
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

          {/* GAME 3: ORBITAL SHIPYARD & FACTORY */}
          {activeGame === 'shipyard' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-indigo-400" />
                    <span>3단 궤도 물류 생산 라인</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-numbers mt-0.5">
                    <span>함대 등급 Lv.{mg.shipyard.fleetPrestigeLevel}</span>
                    <span aria-hidden="true">·</span>
                    <span>생산 배율 ×{mg.shipyard.fleetMultiplier.toFixed(2)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-white font-semibold">
                      누적 수송 {formatNum(mg.shipyard.totalCargoShipped, 1)} t
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-indigo-300 font-semibold">
                      보유 {formatNum(mg.shipyard.darkmatter)} ✦
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onBoostShipyard}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold cursor-pointer whitespace-nowrap transition-colors"
                  >
                    공정 수동 가속
                  </button>
                  <button
                    disabled={mg.shipyard.totalCargoShipped < shipyardMetrics.prestigeReq}
                    onClick={onPrestigeShipyard}
                    className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap cursor-pointer transition-colors ${
                      mg.shipyard.totalCargoShipped >= shipyardMetrics.prestigeReq
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    함대 도약 ({formatNum(mg.shipyard.totalCargoShipped)}/{formatNum(shipyardMetrics.prestigeReq)} t)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(
                  [
                    {
                      kind: 'drone' as const,
                      step: '1단계 · 채굴/조립',
                      title: '궤도 조립 드론',
                      count: mg.shipyard.droneCount,
                      stockLabel: '합금 부품',
                      stockVal: formatNum(mg.shipyard.alloyParts, 1),
                      rateText: `+${shipyardMetrics.alloyPerSec.toFixed(1)}/s 생산`,
                    },
                    {
                      kind: 'refinery' as const,
                      step: '2단계 · 정제',
                      title: '반물질 제련소',
                      count: mg.shipyard.refineryCount,
                      stockLabel: '반물질 연료',
                      stockVal: formatNum(mg.shipyard.antimatter, 1),
                      rateText: `최대 +${shipyardMetrics.antimatterPerSecCap.toFixed(1)}/s 전환`,
                    },
                    {
                      kind: 'freighter' as const,
                      step: '3단계 · 성간 출하',
                      title: '성간 화물선',
                      count: mg.shipyard.freighterCount,
                      stockLabel: '누적 수송 화물',
                      stockVal: `${formatNum(mg.shipyard.totalCargoShipped, 1)} t`,
                      rateText: `최대 +${shipyardMetrics.cargoPerSecCap.toFixed(1)} t/s 수송`,
                    },
                  ] as const
                ).map((stage) => {
                  const cost = getShipyardUnitCost(mg.shipyard, stage.kind);
                  const affordable = mg.shipyard.darkmatter >= cost;
                  return (
                    <div
                      key={stage.kind}
                      className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="text-[11px] text-slate-400 font-medium">{stage.step}</div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">{stage.title}</span>
                          <span className="text-xs font-mono-numbers text-indigo-300 font-bold">
                            {stage.count}대
                          </span>
                        </div>
                        <div className="pt-2 border-t border-slate-800/80 space-y-1 font-mono-numbers">
                          <div className="text-xs text-slate-400 flex justify-between">
                            <span>{stage.stockLabel}</span>
                            <span className="text-white font-semibold">{stage.stockVal}</span>
                          </div>
                          <div className="text-[11px] text-indigo-300">{stage.rateText}</div>
                        </div>
                      </div>

                      <button
                        disabled={!affordable}
                        onClick={() => onBuyShipyardUnit(stage.kind)}
                        className={`w-full min-h-[42px] px-3 py-2 rounded-lg text-xs font-mono-numbers font-bold cursor-pointer transition-colors ${
                          affordable
                            ? 'bg-indigo-500 hover:bg-indigo-400 text-white'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        +1기 증설 ({formatNum(cost)} ✦)
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
              <div className="lg:col-span-7 p-4 sm:p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Atom className="w-4 h-4 text-emerald-400" />
                      <span>파형 공명 튜너</span>
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono-numbers mt-0.5">
                      <span>완료 실험 {mg.quantum.experimentsCompleted}회</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-300 font-semibold">
                        일치 {quantumMetrics.matchedChannels}/3 · 속도 ×{quantumMetrics.resonanceMult.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono-numbers">
                    <div className="text-sm font-bold text-emerald-300">
                      {formatNum(mg.quantum.researchPoints, 1)} RP
                    </div>
                    <div className="text-[11px] text-slate-400">
                      +{quantumMetrics.passiveRpPerSec.toFixed(1)} RP/s · 보유 {formatNum(mg.quantum.qubits)} ⚛
                    </div>
                  </div>
                </div>

                {/* 3 Harmonic Channels */}
                <div className="space-y-2.5">
                  {(['Alpha 채널', 'Beta 채널', 'Gamma 채널'] as const).map((label, idx) => {
                    const chIdx = idx as 0 | 1 | 2;
                    const target = mg.quantum.targetWave[chIdx];
                    const current = mg.quantum.tunedWave[chIdx];
                    const matched = target === current;
                    return (
                      <div
                        key={label}
                        className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="flex items-center justify-between sm:justify-start gap-2.5">
                          <span className="text-xs font-semibold text-white">{label}</span>
                          <span
                            className={`text-xs font-mono-numbers ${
                              matched ? 'text-emerald-400 font-bold' : 'text-slate-400'
                            }`}
                          >
                            목표 주파수 {target} {matched ? '· 공명 중' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3, 4, 5].map((val) => (
                            <button
                              key={val}
                              onClick={() => onTuneQuantumWave(chIdx, val)}
                              className={`min-w-[40px] min-h-[38px] rounded-lg text-xs font-mono-numbers font-bold cursor-pointer transition-colors ${
                                current === val
                                  ? matched
                                    ? 'bg-emerald-500 text-slate-950'
                                    : 'bg-sky-600 text-white'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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

                {/* Experiment Progress */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-300">양자 연구 사이클 진행도</span>
                    <span className="text-emerald-300 font-semibold">
                      {(mg.quantum.experimentProgress * 100).toFixed(0)}% · 완료 +{formatNum(quantumMetrics.experimentRewardRp)} RP
                    </span>
                  </div>
                  <div className="w-full h-3.5 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-100"
                      style={{
                        width: `${Math.min(100, Math.max(2, mg.quantum.experimentProgress * 100))}%`,
                      }}
                    />
                  </div>
                  <button
                    data-testid="quantum-pulse-btn"
                    onClick={onPulseQuantum}
                    className="w-full min-h-[44px] px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer flex items-center justify-center gap-2 transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span>양자 펄스 주입 (+24% 진행)</span>
                  </button>
                </div>
              </div>

              {/* Lab Upgrades */}
              <div className="lg:col-span-5 space-y-2.5">
                {(
                  [
                    {
                      kind: 'accelerator' as const,
                      title: '입자 가속기 코일',
                      desc: '실험 사이클 속도를 +45%씩 가속해 연구 달성 속도를 높입니다.',
                      level: mg.quantum.acceleratorLevel,
                    },
                    {
                      kind: 'amplifier' as const,
                      title: '양자 데이터 증폭기',
                      desc: '실험 완료 시 축적하는 연구 점수(RP)를 크게 높입니다.',
                      level: mg.quantum.amplifierLevel,
                    },
                    {
                      kind: 'entanglement' as const,
                      title: '양자 얽힘 관측기',
                      desc: '대기 중에도 초당 양자 연구 점수(RP)를 자동으로 지속 축적합니다.',
                      level: mg.quantum.entanglementLevel,
                    },
                  ] as const
                ).map((item) => {
                  const cost = getQuantumUpgradeCost(mg.quantum, item.kind);
                  const affordable = mg.quantum.qubits >= cost;
                  return (
                    <div
                      key={item.kind}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {item.title}{' '}
                          <span className="text-xs font-mono-numbers text-emerald-300 font-semibold">
                            Lv.{item.level}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        disabled={!affordable}
                        onClick={() => onBuyQuantumUpgrade(item.kind)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-mono-numbers font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          affordable
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {formatNum(cost)} ⚛
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* MILESTONE PROGRESSION TRACK FOR ACTIVE MINIGAME */}
          <section
            data-testid="minigame-milestones"
            className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">
                  {meta.shortName} 마일스톤 보상 (달성 시 메인 자금 수익 영구 부스트)
                </h3>
              </div>
              <span className="text-xs font-mono-numbers text-emerald-400 font-semibold">
                전체 미니게임 보너스 +{milestoneSummary.totalBoostPct}% (×{milestoneSummary.incomeMult.toFixed(2)})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {milestoneSummary.statuses.map((ms) => (
                <div
                  key={ms.def.id}
                  data-testid={`milestone-card-${ms.def.id}`}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-2 ${
                    ms.achieved
                      ? 'bg-emerald-950/30 border-emerald-500/50'
                      : 'bg-slate-950/70 border-slate-800'
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
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-150 ${
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

          {/* Footer Isolation & Milestone Note */}
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono-numbers">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <span>화폐는 $ → 화폐 단방향 환전 전용 · 마일스톤 달성 시 메인 자금($) 수익 부스트 적용</span>
            </span>
            <span>누적 환전 투자액: ${Math.floor(mg.totalMoneyInvested).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
