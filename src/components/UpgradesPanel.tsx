import React, { useState } from 'react';
import {
  Bot,
  Cpu,
  Globe2,
  Lock,
  MousePointerClick,
  SlidersHorizontal,
  TrainTrack,
  X,
} from 'lucide-react';
import { GameState, UpgradeCategory } from '../game/types';
import {
  calculateMultipliers,
  getBulkUpgradeCost,
  getUpgradeCost,
} from '../game/rules';

interface UpgradesPanelProps {
  gameState: GameState;
  onClose: () => void;
  onBuyUpgrade: (upgradeId: string, count: 1 | 10 | 'max') => void;
}

const CATEGORY_TABS: {
  id: 'all' | UpgradeCategory;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'all', label: '전체', Icon: SlidersHorizontal },
  { id: 'road_node', label: '노드·도로 공학', Icon: Cpu },
  { id: 'rail_speed', label: '철도·고속수송', Icon: TrainTrack },
  { id: 'editor_click', label: '배차·노드 편집', Icon: MousePointerClick },
  { id: 'automation', label: '자율 시공·봇', Icon: Bot },
  { id: 'megascale', label: '메가스케일', Icon: Globe2 },
];

export const UpgradesPanel: React.FC<UpgradesPanelProps> = ({
  gameState,
  onClose,
  onBuyUpgrade,
}) => {
  const [category, setCategory] = useState<'all' | UpgradeCategory>('all');
  const [buyCount, setBuyCount] = useState<1 | 10 | 'max'>(1);

  const mults = calculateMultipliers(gameState);
  const totalLevels = gameState.upgrades.reduce((acc, u) => acc + u.level, 0);
  const maxTotalLevels = gameState.upgrades.reduce((acc, u) => acc + u.maxLevel, 0);

  const visibleUpgrades = gameState.upgrades.filter((u) =>
    category === 'all' ? true : u.category === category
  );

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4 bg-black/65"
    >
      <div className="w-full max-w-5xl h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[84vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0d1424] border-t sm:border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <SlidersHorizontal className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                  업그레이드 ({totalLevels}/{maxTotalLevels} Lv)
                </h2>
                <p className="hidden sm:block text-xs text-slate-400">
                  수억 개 OSM 노드 개척과 수천 시간 스케일을 위한 22종 심화 업그레이드
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

          <div className="flex items-center justify-between sm:justify-end gap-3">
            {/* Bulk Buy Toggle */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
              {([1, 10, 'max'] as const).map((qty) => (
                <button
                  key={qty}
                  onClick={() => setBuyCount(qty)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-mono-numbers font-bold rounded-md cursor-pointer transition-colors ${
                    buyCount === qty
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {qty === 'max' ? 'MAX' : `×${qty}`}
                </button>
              ))}
            </div>

            <div className="text-right font-mono-numbers">
              <div className="text-[10px] sm:text-[11px] text-slate-400">보유 자금</div>
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

        {/* Live Multipliers Summary Strip */}
        <div className="px-4 sm:px-5 py-2 bg-slate-900/70 border-b border-slate-800/80 flex items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs font-mono-numbers text-slate-300 overflow-x-auto no-scrollbar sm:flex-wrap shrink-0 whitespace-nowrap">
          <span>
            할인:{' '}
            <strong className="text-amber-400">
              -{Math.round((1 - mults.buildCostMult) * 100)}%
            </strong>
          </span>
          <span>
            노드 배수:{' '}
            <strong className="text-sky-400">×{mults.osmNodeIncomeMult.toFixed(1)}</strong>
          </span>
          <span>
            전체 배수:{' '}
            <strong className="text-emerald-400">×{mults.globalIncomeMult.toFixed(2)}</strong>
          </span>
          <span>
            노드 스케일:{' '}
            <strong className="text-indigo-400">×{mults.nodeScaleMult.toLocaleString()}</strong>
          </span>
          <span>
            병렬 시공:{' '}
            <strong className="text-slate-200">{mults.parallelBuildCount}개/회</strong>
          </span>
        </div>

        {/* Category Filter Tabs */}
        <div className="px-4 sm:px-5 py-2 border-b border-slate-800/80 bg-slate-950/40 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {CATEGORY_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                category === id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Upgrade Grid */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleUpgrades.map((upg) => {
            const isMaxed = upg.level >= upg.maxLevel;
            const reqUpgrade = upg.unlockRequirement
              ? gameState.upgrades.find((u) => u.id === upg.unlockRequirement!.upgradeId)
              : undefined;
            const reqMet =
              !upg.unlockRequirement ||
              (reqUpgrade && reqUpgrade.level >= upg.unlockRequirement.minLevel);

            const bulk = getBulkUpgradeCost(upg, buyCount, gameState.capital);
            const singleCost = getUpgradeCost(upg, 0);
            const canAfford =
              !isMaxed && reqMet && bulk.count > 0 && gameState.capital >= bulk.totalCost;
            const pct = Math.round((upg.level / upg.maxLevel) * 100);

            return (
              <div
                key={upg.id}
                className={`p-3.5 sm:p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  !reqMet
                    ? 'border-slate-800/70 bg-slate-950/35 opacity-75'
                    : upg.level > 0
                    ? 'border-emerald-500/35 bg-slate-900/65'
                    : 'border-slate-800 bg-slate-900/50'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white leading-snug">
                        {upg.name}
                      </h3>
                      <div className="text-xs text-amber-300 font-medium mt-0.5">
                        {upg.effectPerLevelText}
                      </div>
                    </div>
                    <span className="text-xs font-mono-numbers font-bold text-sky-400 shrink-0">
                      Lv.{upg.level}/{upg.maxLevel}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {upg.description}
                  </p>

                  {/* Level Progress Bar */}
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  {!reqMet && reqUpgrade ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        해금 조건: {reqUpgrade.name} Lv.{upg.unlockRequirement?.minLevel}
                      </span>
                    </div>
                  ) : isMaxed ? (
                    <span className="text-xs font-bold text-emerald-400">최고 레벨 달성</span>
                  ) : (
                    <>
                      <div className="text-xs text-slate-400 font-mono-numbers">
                        1단계: ${singleCost.toLocaleString()}
                      </div>
                      <button
                        disabled={!canAfford}
                        onClick={() => onBuyUpgrade(upg.id, buyCount)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-semibold font-mono-numbers whitespace-nowrap cursor-pointer transition-colors ${
                          canAfford
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        +{bulk.count} 강화 (${bulk.totalCost.toLocaleString()})
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
