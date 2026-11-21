import React from 'react';
import { Award, Compass, Globe, Loader2, Lock, MapPin, Unlock, X } from 'lucide-react';
import { GameState } from '../game/types';
import {
  getExpandableProvincialRegions,
  getNodeTierRank,
  getRegionProgressStats,
  getRegionUnlockCost,
} from '../game/rules';
import { formatMoneyCompact } from '../game/format';

interface PrestigePanelProps {
  gameState: GameState;
  onClose: () => void;
  onUnlockRegion: (regionId: string) => void;
  unlockingRegionId?: string | null;
  onFocusMap?: (lat: number, lng: number, zoom: number) => void;
}

export const PrestigePanel: React.FC<PrestigePanelProps> = ({
  gameState,
  onClose,
  onUnlockRegion,
  unlockingRegionId = null,
  onFocusMap,
}) => {
  const rank = getNodeTierRank(gameState.stats.connectedOsmNodes);
  const regions = gameState.provincialRegions || [];
  const unlockedRegions = regions.filter((r) => r.unlocked);
  const pendingSeedSet = new Set(gameState.pendingSeedRegionIds || []);
  const expandableRegions = getExpandableProvincialRegions(gameState);
  const totalLockedCount = regions.filter((r) => !r.unlocked).length;
  const futureLockedCount = Math.max(0, totalLockedCount - expandableRegions.length);

  const lockedRegions = expandableRegions
    .map((r) => ({
      region: r,
      cost: getRegionUnlockCost(gameState, r),
    }))
    .sort((a, b) => {
      if (a.region.isIsolated !== b.region.isIsolated) {
        return a.region.isIsolated ? 1 : -1;
      }
      return a.cost - b.cost;
    });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4 bg-black/65"
    >
      <div className="w-full max-w-3xl h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[86vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0d1424] border-t sm:border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Globe className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                세계 확장 & 도·주(State/Province) 광역 행정구역 해금
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                각 도·주(State/Province)별 전체 노드 개척 진행률을 확인하고 자금으로 인접 지역을 잠금 해제하세요.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Node Tier Rank Card */}
          <div
            data-testid="expansion-tier-card"
            className="p-4 rounded-xl border border-slate-700/80 bg-slate-900/75 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: `${rank.color}66`,
                    backgroundColor: `${rank.color}18`,
                  }}
                >
                  <Award className="w-5 h-5" style={{ color: rank.color }} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-400 font-medium">
                    개척 노드 티어 등급
                  </div>
                  <div
                    className="text-lg sm:text-xl font-extrabold font-mono-numbers tracking-tight"
                    style={{ color: rank.color }}
                  >
                    {rank.label}
                  </div>
                </div>
              </div>

              <div className="text-right font-mono-numbers shrink-0">
                <div className="text-xs font-bold text-slate-200 tabular-nums">
                  {gameState.stats.connectedOsmNodes.toLocaleString()}
                  {rank.nextTargetNodes ? ` / ${rank.nextTargetNodes.toLocaleString()} 노드` : ' 노드 (MAX)'}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {rank.nextTargetNodes
                    ? `다음 등급까지 ${(rank.nextTargetNodes - gameState.stats.connectedOsmNodes).toLocaleString()}개`
                    : '최고 티어 달성'}
                </div>
              </div>
            </div>

            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(2, rank.progressPct))}%`,
                  backgroundColor: rank.color,
                }}
              />
            </div>
          </div>

          {/* 1:1 Authentic Network Summary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="p-3.5 sm:p-4 rounded-xl border border-indigo-500/35 bg-slate-900/65">
              <div className="text-xs text-slate-400 font-medium">연결 교차점(실제 노드 수)</div>
              <div
                data-testid="expansion-real-nodes"
                className="text-xl sm:text-2xl font-bold font-mono-numbers text-indigo-300 tabular-nums mt-1"
              >
                {gameState.stats.connectedOsmNodes.toLocaleString()}개
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono-numbers tabular-nums">
                실측 구간 {gameState.stats.totalOsmEdgesBuilt.toLocaleString()}개 연결됨
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl border border-sky-500/35 bg-slate-900/65">
              <div className="text-xs text-slate-400 font-medium">1:1 실측</div>
              <div
                data-testid="expansion-real-km"
                className="text-xl sm:text-2xl font-bold font-mono-numbers text-sky-400 tabular-nums mt-1"
              >
                {gameState.stats.mapped1to1Km.toLocaleString()} km
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                실제 지구 지도 1:1 거리 합산
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl border border-emerald-500/35 bg-slate-900/65">
              <div className="text-xs text-slate-400 font-medium">해금된 도·주 행정구역</div>
              <div className="text-xl sm:text-2xl font-bold font-mono-numbers text-emerald-400 tabular-nums mt-1">
                {unlockedRegions.length} / {regions.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono-numbers tabular-nums">
                보유 자금 {formatMoneyCompact(gameState.capital)}
              </div>
            </div>
          </div>

          {/* Unlocked Regions with Real Node % */}
          <div className="p-3.5 sm:p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <Unlock className="w-4 h-4 text-emerald-400 shrink-0" />
                개척 중인 도·주 ({unlockedRegions.length})
              </h3>
              <span className="text-[11px] text-slate-400">도·주 전체 노드 대비 개척 진척도</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {unlockedRegions.map((region) => {
                const isPendingSeed = pendingSeedSet.has(region.regionId);
                const progress = getRegionProgressStats(gameState, region.regionId);
                const pctDisplay = progress.pct.toFixed(2);
                const barWidth = Math.min(100, progress.pct > 0 ? Math.max(1.5, progress.pct) : 0);

                return (
                  <div
                    key={region.regionId}
                    data-testid={`unlocked-region-${region.regionId}`}
                    className={`p-3 rounded-xl border space-y-2 ${
                      isPendingSeed
                        ? 'border-amber-500/50 bg-amber-950/20'
                        : 'border-slate-800 bg-slate-950/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-white truncate">
                          {region.regionName}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {region.isStartingRegion
                            ? '시작 도·주 · 개척 활성'
                            : isPendingSeed
                            ? '고립 도·주 · 지도에서 출발 노드 선택 대기'
                            : region.isIsolated
                            ? '고립(섬) 도·주 · 개척 활성'
                            : '인접 도·주 · 경계 교차점 연결 가능'}
                        </div>
                      </div>
                      {onFocusMap && (
                        <button
                          onClick={() => {
                            onFocusMap(region.centerLat, region.centerLng, 14);
                            onClose();
                          }}
                          className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                            isPendingSeed
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                              : 'bg-slate-800 hover:bg-slate-700 text-sky-300'
                          }`}
                        >
                          <Compass className="w-3.5 h-3.5" />
                          {isPendingSeed ? '노드 선택' : '이동'}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-numbers text-slate-300 tabular-nums">
                        <span>
                          {progress.connectedCount.toLocaleString()} /{' '}
                          {progress.totalNodes.toLocaleString()} 노드
                        </span>
                        <span className="font-bold text-emerald-400">{pctDisplay}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all duration-300"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Locked Expandable Neighboring Provinces */}
          <div className="p-3.5 sm:p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                개척 가능한 인접 도·주 ({lockedRegions.length})
              </h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                현재 개척된 지역과 맞닿은 인접 도·주(State/Province)만 순서대로 개척할 수 있습니다. (섬·해협 지역에서도 가장 가까운 국내 인접 지역부터 해금하며, 미개척 지역에는 노드를 연결할 수 없습니다.)
              </p>
            </div>

            {lockedRegions.length === 0 ? (
              <div className="text-xs text-emerald-400 font-medium py-3 text-center">
                현재 인접해 개척 가능한 도·주가 모두 해금되었습니다! 지도에서 새로운 지역을 탐색하세요.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {lockedRegions.map(({ region, cost }) => {
                  const canAfford = gameState.capital >= cost;
                  const isBusy = unlockingRegionId === region.regionId;
                  const disabled = !canAfford || Boolean(unlockingRegionId);

                  return (
                    <div
                      key={region.regionId}
                      data-testid={`locked-region-${region.regionId}`}
                      className="p-3 rounded-xl border border-slate-800 bg-slate-950/65 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <MapPin
                            className={`w-3.5 h-3.5 shrink-0 ${
                              region.isIsolated ? 'text-amber-400' : 'text-sky-400'
                            }`}
                          />
                          <span className="text-xs sm:text-sm font-bold text-white truncate">
                            {region.regionName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {region.isIsolated
                            ? '고립(섬/원거리 인접) · 새 출발 노드 직접 선택'
                            : '인접 도·주 · 기존 개척 노드와 경계 연결'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {onFocusMap && (
                          <button
                            type="button"
                            onClick={() => {
                              onFocusMap(region.centerLat, region.centerLng, 11);
                              onClose();
                            }}
                            className="min-h-[42px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <Compass className="w-3.5 h-3.5" />
                            <span>위치</span>
                          </button>
                        )}
                        <button
                          disabled={disabled}
                          onClick={() => onUnlockRegion(region.regionId)}
                          className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-bold font-mono-numbers tabular-nums flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                            !disabled
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>도·주 전체 노드 로드 중...</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              <span>잠금 해제 ({formatMoneyCompact(cost)})</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {futureLockedCount > 0 && (
              <div className="text-[11px] text-slate-400 pt-1">
                인접 도·주를 해금하면 그 너머 {futureLockedCount}개 지역이 순차적으로 열립니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
