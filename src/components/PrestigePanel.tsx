import React from 'react';
import { Globe } from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateMultipliers,
  calculateTotalIncomePerSec,
  getNodeTierRank,
} from '../game/rules';
import { formatIncomeRateCompact, formatMoneyCompact } from '../game/format';
import { ModalShell } from './ui/ModalShell';
import { TierEmblem } from './ui/TierEmblem';

interface PrestigePanelProps {
  gameState: GameState;
  onClose: () => void;
}

export const PrestigePanel: React.FC<PrestigePanelProps> = ({
  gameState,
  onClose,
}) => {
  const rank = getNodeTierRank(gameState.stats.connectedOsmNodes);
  const mults = calculateMultipliers(gameState);
  const incomePerSec = calculateTotalIncomePerSec(gameState);

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel="티어 성장 및 네트워크 확장"
      maxWidthClass="max-w-2xl"
      heightClass="h-auto max-h-[84vh]"
      icon={<Globe className="w-4 h-4 text-indigo-400" />}
      title="티어 성장 · 세계 교통망 통계"
      subtitle="연결된 실제 교차점과 1:1 실측 네트워크 규모에 따라 티어 등급과 수익 효율이 성장합니다."
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {/* Node Tier Rank Card */}
        <div
          data-testid="expansion-tier-card"
          className="p-4 sm:p-5 rounded-xl border border-white/[0.09] bg-[#10182b] space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <TierEmblem tierOrLabel={rank.label} color={rank.color} size="xl" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 font-medium">
                  개척 노드 티어 등급
                </div>
                <div
                  className="text-xl sm:text-2xl font-extrabold font-mono-numbers tracking-tight truncate"
                  style={{ color: rank.color }}
                >
                  {rank.label}
                </div>
              </div>
            </div>

            <div className="text-right font-mono-numbers shrink-0">
              <div className="text-xs sm:text-sm font-bold text-slate-200 tabular-nums">
                {gameState.stats.connectedOsmNodes.toLocaleString()}
                {rank.nextTargetNodes
                  ? ` / ${rank.nextTargetNodes.toLocaleString()} 노드`
                  : ' 노드 (MAX)'}
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                {rank.nextTargetNodes
                  ? `다음 등급까지 ${(rank.nextTargetNodes - gameState.stats.connectedOsmNodes).toLocaleString()}개`
                  : '최고 티어 달성'}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono-numbers text-slate-400 tabular-nums">
              <span>현재 티어 진척도</span>
              <span className="font-bold text-slate-200">
                {rank.progressPct.toFixed(3)}%
              </span>
            </div>
            <div className="w-full h-2 bg-[#070b14] border border-white/[0.05] rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(2, rank.progressPct))}%`,
                  backgroundColor: rank.color,
                }}
              />
            </div>
          </div>
        </div>

        {/* 1:1 Authentic Network Summary Metrics (Zero Region Content) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#10182b]">
            <div className="text-xs text-slate-400 font-medium">연결 교차점(실제 노드)</div>
            <div
              data-testid="expansion-real-nodes"
              className="text-xl font-bold font-mono-numbers text-indigo-300 tabular-nums mt-1"
            >
              {gameState.stats.connectedOsmNodes.toLocaleString()}개
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono-numbers tabular-nums">
              실측 구간 {gameState.stats.totalOsmEdgesBuilt.toLocaleString()}개 연결됨
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#10182b]">
            <div className="text-xs text-slate-400 font-medium">1:1 실측 거리</div>
            <div
              data-testid="expansion-real-km"
              className="text-xl font-bold font-mono-numbers text-sky-400 tabular-nums mt-1"
            >
              {gameState.stats.mapped1to1Km.toLocaleString()} km
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              실제 지구 지도 1:1 거리 합산
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#10182b]">
            <div className="text-xs text-slate-400 font-medium">초당 네트워크 수익</div>
            <div className="text-xl font-bold font-mono-numbers text-emerald-400 tabular-nums mt-1">
              {formatIncomeRateCompact(incomePerSec)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono-numbers tabular-nums">
              수익 배율 ×{mults.globalIncomeMult.toFixed(2)} · 누적 {formatMoneyCompact(gameState.totalLifetimeEarnings)}
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
