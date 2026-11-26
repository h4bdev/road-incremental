import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Loader2,
  Lock,
  MapPin,
  Route,
  Search,
  TrainTrack,
  Truck,
  Unlock,
  X,
} from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateMultipliers,
  CUSTOM_BRIDGE_WAY_NAMES,
  getExpandableProvincialRegions,
  getRegionProgressStats,
  getRegionUnlockCost,
} from '../game/rules';
import { formatIncomeRateCompact, formatMoneyCompact } from '../game/format';
import { ModalShell, SegmentedControl } from './ui/ModalShell';

interface LinesPanelProps {
  gameState: GameState;
  onClose: () => void;
  onFocusMap: (lat: number, lng: number, zoom: number) => void;
  onUnlockRegion?: (regionId: string) => void;
  unlockingRegionId?: string | null;
  unlockProgressPct?: number | null;
}

interface OsmWaySummary {
  key: string;
  wayName: string;
  mode: 'road' | 'rail';
  builtCount: number;
  totalCount: number;
  totalMeters: number;
  incomePerSec: number;
  focusLat: number;
  focusLng: number;
  completed: boolean;
  inProgress: boolean;
}

const PAGE_STEP = 80;

export const LinesPanel: React.FC<LinesPanelProps> = ({
  gameState,
  onClose,
  onFocusMap,
  onUnlockRegion,
  unlockingRegionId = null,
  unlockProgressPct = null,
}) => {
  const [filterMode, setFilterMode] = useState<
    'all' | 'in_progress' | 'completed' | 'road' | 'rail'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(PAGE_STEP);
  const mults = calculateMultipliers(gameState);

  const regionProgressData = useMemo(() => {
    const pendingSet = new Set(gameState.pendingSeedRegionIds || []);
    const allRegions = gameState.provincialRegions || [];
    const unlocked = allRegions.filter((r) => r.unlocked);
    const items = unlocked
      .map((region) => ({
        region,
        stats: getRegionProgressStats(gameState, region.regionId),
        isPendingSeed: pendingSet.has(region.regionId),
      }))
      .sort((a, b) => {
        if (a.region.isStartingRegion !== b.region.isStartingRegion) {
          return a.region.isStartingRegion ? -1 : 1;
        }
        if (b.stats.connectedCount !== a.stats.connectedCount) {
          return b.stats.connectedCount - a.stats.connectedCount;
        }
        return a.region.regionName.localeCompare(b.region.regionName);
      });

    let totalConnected = 0;
    let totalNodes = 0;
    for (const item of items) {
      totalConnected += item.stats.connectedCount;
      totalNodes += item.stats.totalNodes;
    }
    const totalPct =
      totalNodes > 0 ? Math.min(100, Math.round((totalConnected / totalNodes) * 10000) / 100) : 0;

    const expandable = getExpandableProvincialRegions(gameState)
      .map((r) => ({ region: r, cost: getRegionUnlockCost(gameState, r) }))
      .sort((a, b) => {
        if (a.region.isIsolated !== b.region.isIsolated) {
          return a.region.isIsolated ? 1 : -1;
        }
        return a.cost - b.cost;
      });
    const totalLockedCount = allRegions.filter((r) => !r.unlocked).length;
    const futureLockedCount = Math.max(0, totalLockedCount - expandable.length);

    return {
      items,
      totalRegions: allRegions.length,
      totalConnected,
      totalNodes,
      totalPct,
      expandable,
      futureLockedCount,
    };
  }, [gameState]);

  const allOsmWays = useMemo<OsmWaySummary[]>(() => {
    const completedWaySet = new Set(gameState.completedOsmWays || []);
    const groups = new Map<
      string,
      {
        wayName: string;
        mode: 'road' | 'rail';
        builtCount: number;
        totalCount: number;
        totalKm: number;
        incomePerSec: number;
        sumLat: number;
        sumLng: number;
      }
    >();

    for (const edge of gameState.osmEdges || []) {
      if (!edge.wayName || CUSTOM_BRIDGE_WAY_NAMES.has(edge.wayName)) continue;
      const key = `${edge.mode}::${edge.wayName}`;
      const prev = groups.get(key) || {
        wayName: edge.wayName,
        mode: edge.mode,
        builtCount: 0,
        totalCount: 0,
        totalKm: 0,
        incomePerSec: 0,
        sumLat: 0,
        sumLng: 0,
      };
      prev.totalCount += 1;
      if (edge.built) prev.builtCount += 1;
      prev.totalKm += edge.distanceKm;
      const modeMult = edge.mode === 'rail' ? mults.railIncomeMult : mults.roadIncomeMult;
      prev.incomePerSec += edge.baseIncomePerSec * modeMult * mults.osmNodeIncomeMult;
      prev.sumLat += edge.coordinates[0][0];
      prev.sumLng += edge.coordinates[0][1];
      groups.set(key, prev);
    }

    return Array.from(groups.entries())
      .map(([key, g]) => {
        const completed =
          (g.totalCount >= 2 && g.builtCount === g.totalCount) || completedWaySet.has(key);
        const inProgress = g.builtCount > 0 && !completed;
        return {
          key,
          wayName: g.wayName,
          mode: g.mode,
          builtCount: g.builtCount,
          totalCount: g.totalCount,
          totalMeters: Math.max(1, Math.round(g.totalKm * 1000)),
          incomePerSec: Math.round(g.incomePerSec * 10) / 10,
          focusLat: g.sumLat / g.totalCount,
          focusLng: g.sumLng / g.totalCount,
          completed,
          inProgress,
        };
      })
      .sort((a, b) => {
        const aRank = a.inProgress ? 0 : a.completed ? 1 : 2;
        const bRank = b.inProgress ? 0 : b.completed ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        if (a.builtCount !== b.builtCount) return b.builtCount - a.builtCount;
        return b.totalCount - a.totalCount;
      });
  }, [gameState.osmEdges, gameState.completedOsmWays, mults]);

  const counts = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    let road = 0;
    let rail = 0;
    for (const w of allOsmWays) {
      if (w.inProgress) inProgress += 1;
      if (w.completed) completed += 1;
      if (w.mode === 'road') road += 1;
      else rail += 1;
    }
    return {
      all: allOsmWays.length,
      inProgress,
      completed,
      road,
      rail,
    };
  }, [allOsmWays]);

  const filteredWays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allOsmWays.filter((w) => {
      if (filterMode === 'in_progress' && !w.inProgress) return false;
      if (filterMode === 'completed' && !w.completed) return false;
      if (filterMode === 'road' && w.mode !== 'road') return false;
      if (filterMode === 'rail' && w.mode !== 'rail') return false;
      if (q && !w.wayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allOsmWays, filterMode, searchQuery]);

  const visibleWays = useMemo(
    () => filteredWays.slice(0, displayLimit),
    [filteredWays, displayLimit]
  );

  const handleFilterChange = (next: 'all' | 'in_progress' | 'completed' | 'road' | 'rail') => {
    setFilterMode(next);
    setDisplayLimit(PAGE_STEP);
  };

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel="지역 및 노선 개척 현황"
      icon={<Route className="w-4 h-4 text-amber-400" />}
      title="지역 · 노선 현황"
      subtitle="해금된 행정구역별 개척 진행도와 인접 카운티 해금, 실제 OSM 도로·철도 노선 프로그래스를 확인하세요."
      subHeader={
        <div className="px-4 sm:px-5 py-2.5 border-b border-white/[0.07] bg-[#080d18]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="overflow-x-auto no-scrollbar">
            <SegmentedControl
              value={filterMode}
              onChange={handleFilterChange}
              options={[
                {
                  id: 'all',
                  testId: 'lines-filter-all',
                  label: `전체 (${counts.all.toLocaleString()})`,
                },
                {
                  id: 'in_progress',
                  testId: 'lines-filter-in-progress',
                  label: `개척 중 (${counts.inProgress.toLocaleString()})`,
                },
                {
                  id: 'completed',
                  testId: 'lines-filter-completed',
                  label: `완공 (${counts.completed.toLocaleString()})`,
                },
                {
                  id: 'road',
                  testId: 'lines-filter-road',
                  label: `도로 (${counts.road.toLocaleString()})`,
                },
                {
                  id: 'rail',
                  testId: 'lines-filter-rail',
                  label: `철도 (${counts.rail.toLocaleString()})`,
                },
              ]}
            />
          </div>

          <div className="relative sm:w-52 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setDisplayLimit(PAGE_STEP);
              }}
              placeholder="노선 이름 검색..."
              aria-label="노선 이름 검색"
              className="w-full min-h-[34px] pl-8 pr-7 py-1 rounded-lg bg-[#070b14] border border-white/[0.09] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {/* Section 1: Region Progress */}
        <section data-testid="regions-progress-section" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              지역 개척 프로그래스 ({regionProgressData.items.length} / {regionProgressData.totalRegions}개 해금)
            </h3>
            <div
              data-testid="regions-progress-summary"
              className="text-xs text-slate-300 font-mono-numbers tabular-nums flex items-center gap-2 shrink-0"
            >
              <span>
                {regionProgressData.totalConnected.toLocaleString()} /{' '}
                {regionProgressData.totalNodes.toLocaleString()} 노드
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-bold">
                {regionProgressData.totalPct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {regionProgressData.items.map(({ region, stats, isPendingSeed }) => {
              const pctDisplay = stats.pct.toFixed(2);
              const barWidth = Math.min(100, stats.pct > 0 ? Math.max(1.5, stats.pct) : 0);
              return (
                <div
                  key={region.regionId}
                  data-testid={`region-progress-${region.regionId}`}
                  className={`p-3.5 rounded-xl border space-y-2 ${
                    isPendingSeed
                      ? 'border-amber-400/45 bg-amber-950/20'
                      : 'border-white/[0.08] bg-[#10182b]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-white truncate">
                        {region.regionName}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {region.isStartingRegion
                          ? '시작 지역 · 개척 활성'
                          : isPendingSeed
                          ? '출발 노드 선택 대기'
                          : region.isIsolated
                          ? '고립(섬) 지역 · 개척 활성'
                          : '인접 지역 · 개척 활성'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onFocusMap(region.centerLat, region.centerLng, 15);
                        onClose();
                      }}
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                        isPendingSeed
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] text-sky-300'
                      }`}
                    >
                      <Compass className="w-3.5 h-3.5" />
                      {isPendingSeed ? '노드 선택' : '지도 이동'}
                    </button>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono-numbers text-slate-300 tabular-nums">
                      <span>
                        {stats.connectedCount.toLocaleString()} /{' '}
                        {stats.totalNodes.toLocaleString()} 노드
                      </span>
                      <span className="font-bold text-emerald-400">{pctDisplay}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#070b14] border border-white/[0.05] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-300 rounded-full"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Expandable Neighboring Regions */}
        {onUnlockRegion && (regionProgressData.expandable.length > 0 || regionProgressData.futureLockedCount > 0) && (
          <section data-testid="expandable-regions-section" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                개척 가능한 인접 지역 ({regionProgressData.expandable.length})
              </h3>
              <span className="text-[11px] text-slate-400 font-mono-numbers tabular-nums">
                보유 자금 {formatMoneyCompact(gameState.capital)}
              </span>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
              {regionProgressData.expandable.map(({ region, cost }) => {
                const canAfford = gameState.capital >= cost;
                const isBusy = unlockingRegionId === region.regionId;
                const disabled = !canAfford || Boolean(unlockingRegionId);

                return (
                  <div
                    key={region.regionId}
                    data-testid={`locked-region-${region.regionId}`}
                    className="p-3 rounded-xl border border-white/[0.08] bg-[#10182b] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
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
                          : '인접 행정구역 · 기존 개척 노드와 경계 연결'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onFocusMap(region.centerLat, region.centerLng, 12);
                          onClose();
                        }}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] text-sky-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>위치</span>
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onUnlockRegion(region.regionId)}
                        className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold font-mono-numbers tabular-nums flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                          !disabled
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              로드 중 {typeof unlockProgressPct === 'number' ? `${unlockProgressPct}%` : '...'}
                            </span>
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

            {regionProgressData.futureLockedCount > 0 && (
              <div className="text-[11px] text-slate-400 pt-0.5">
                인접 지역을 해금하면 그 너머 {regionProgressData.futureLockedCount}개 지역이 순차적으로 열립니다.
              </div>
            )}
          </section>
        )}

        {/* Section 3: Line/Way Progress */}
        <section data-testid="lines-progress-section" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <Route className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              노선 개척 프로그래스 (실제 도로·철도)
            </h3>
            <div
              data-testid="lines-real-summary"
              className="text-xs text-slate-400 font-mono-numbers flex items-center gap-2 shrink-0 tabular-nums"
            >
              <span>전체 {counts.all.toLocaleString()}</span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-300 font-semibold">
                개척 중 {counts.inProgress.toLocaleString()}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-semibold">
                완공 {counts.completed.toLocaleString()}
              </span>
            </div>
          </div>

        {visibleWays.length === 0 ? (
          <div className="p-5 rounded-xl border border-white/[0.07] bg-[#10182b]/60 text-xs text-slate-400 text-center">
            표시할 실제 도로·철도 노선이 없습니다. 지도에서 도로를 불러오거나 다른 필터를 선택하세요.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {visibleWays.map((way) => {
                const pct =
                  way.totalCount > 0 ? Math.round((way.builtCount / way.totalCount) * 100) : 0;
                const isRail = way.mode === 'rail';
                return (
                  <div
                    key={way.key}
                    className={`p-3.5 rounded-xl border space-y-2.5 transition-colors ${
                      way.completed
                        ? 'border-emerald-500/35 bg-emerald-950/20'
                        : way.inProgress
                        ? 'border-amber-400/35 bg-amber-950/15'
                        : 'border-white/[0.08] bg-[#10182b]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isRail ? (
                            <TrainTrack className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          ) : (
                            <Truck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className="text-xs sm:text-sm font-bold text-white truncate">
                            {way.wayName}
                          </span>
                          {way.completed && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-numbers mt-0.5 tabular-nums">
                          {isRail ? '철도' : '도로'} · {way.totalMeters.toLocaleString()}m ·{' '}
                          {formatIncomeRateCompact(way.incomePerSec)}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          onFocusMap(way.focusLat, way.focusLng, 17);
                          onClose();
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] text-xs font-semibold text-sky-300 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        노드 잇기
                      </button>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-numbers text-slate-400 tabular-nums">
                        <span>
                          {way.builtCount} / {way.totalCount} 구간
                        </span>
                        <span className="font-semibold text-slate-300">{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#070b14] border border-white/[0.05] rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-300 rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: way.completed
                              ? '#10b981'
                              : isRail
                              ? '#22d3ee'
                              : '#f59e0b',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredWays.length > visibleWays.length && (
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setDisplayLimit((prev) => prev + 100)}
                  className="min-h-[38px] px-4 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.1] text-xs font-semibold text-slate-200 cursor-pointer transition-colors tabular-nums"
                >
                  노선 더 보기 ({visibleWays.length.toLocaleString()} /{' '}
                  {filteredWays.length.toLocaleString()})
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayLimit(filteredWays.length)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
                >
                  전체 펼치기
                </button>
              </div>
            )}
          </>
        )}
        </section>
      </div>
    </ModalShell>
  );
};
