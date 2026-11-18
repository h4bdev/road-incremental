import React, { useMemo, useState } from 'react';
import { CheckCircle2, MapPin, Route, TrainTrack, Truck, X } from 'lucide-react';
import { GameState } from '../game/types';
import { calculateMultipliers, CUSTOM_BRIDGE_WAY_NAMES } from '../game/rules';

interface LinesPanelProps {
  gameState: GameState;
  onClose: () => void;
  onFocusMap: (lat: number, lng: number, zoom: number) => void;
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
}

export const LinesPanel: React.FC<LinesPanelProps> = ({
  gameState,
  onClose,
  onFocusMap,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'road' | 'rail' | 'completed'>('all');
  const mults = calculateMultipliers(gameState);

  const osmWays = useMemo<OsmWaySummary[]>(() => {
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
      .map(([key, g]) => ({
        key,
        wayName: g.wayName,
        mode: g.mode,
        builtCount: g.builtCount,
        totalCount: g.totalCount,
        totalMeters: Math.max(1, Math.round(g.totalKm * 1000)),
        incomePerSec: Math.round(g.incomePerSec * 10) / 10,
        focusLat: g.sumLat / g.totalCount,
        focusLng: g.sumLng / g.totalCount,
        completed: g.totalCount >= 2 && g.builtCount === g.totalCount,
      }))
      .sort((a, b) => {
        const aInProg = a.builtCount > 0 && !a.completed ? 0 : a.completed ? 1 : 2;
        const bInProg = b.builtCount > 0 && !b.completed ? 0 : b.completed ? 1 : 2;
        if (aInProg !== bInProg) return aInProg - bInProg;
        return b.totalCount - a.totalCount;
      })
      .slice(0, 80);
  }, [gameState.osmEdges, mults]);

  const visibleWays = useMemo(() => {
    return osmWays.filter((w) => {
      if (filterMode === 'road') return w.mode === 'road';
      if (filterMode === 'rail') return w.mode === 'rail';
      if (filterMode === 'completed') return w.completed;
      return true;
    });
  }, [osmWays, filterMode]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4 bg-black/65"
    >
      <div className="w-full max-w-4xl h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0d1424] border-t sm:border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Route className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                  실제 도로·철도 노선 현황
                </h2>
                <p className="hidden sm:block text-xs text-slate-400">
                  해금된 도시의 1:1 실제 OSM 도로·철도 구간을 연결해 통행 수익과 완공 보너스를 얻으세요.
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

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 overflow-x-auto no-scrollbar w-full sm:w-auto">
              {(
                [
                  { id: 'all', label: `전체 (${osmWays.length})` },
                  { id: 'road', label: '도로' },
                  { id: 'rail', label: '철도' },
                  { id: 'completed', label: '완공' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterMode(tab.id)}
                  className={`min-h-[36px] px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap cursor-pointer ${
                    filterMode === tab.id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="hidden sm:flex min-w-[38px] min-h-[38px] items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs sm:text-sm font-bold text-slate-200">
              도시 내 실제 OSM 도로·철도 노선
            </h3>
            <span className="text-xs text-slate-400 font-mono-numbers shrink-0">
              완공 {(gameState.completedOsmWays || []).length}개
            </span>
          </div>

          {visibleWays.length === 0 ? (
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400">
              표시할 실제 도로·철도 노선이 없습니다. 지도에서 도로를 불러오거나 다른 필터를 선택하세요.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {visibleWays.map((way) => {
                const pct =
                  way.totalCount > 0 ? Math.round((way.builtCount / way.totalCount) * 100) : 0;
                const isRail = way.mode === 'rail';
                return (
                  <div
                    key={way.key}
                    className={`p-3.5 rounded-xl border space-y-2 ${
                      way.completed
                        ? 'border-emerald-500/40 bg-emerald-950/15'
                        : 'border-slate-800 bg-slate-900/50'
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
                          <span className="text-xs font-bold text-white truncate">
                            {way.wayName}
                          </span>
                          {way.completed && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-numbers mt-0.5">
                          {isRail ? '철도' : '도로'} · {way.totalMeters.toLocaleString()}m · +$
                          {way.incomePerSec.toLocaleString()}/s
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          onFocusMap(way.focusLat, way.focusLng, 17);
                          onClose();
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        노드 잇기
                      </button>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-numbers text-slate-400">
                        <span>
                          {way.builtCount} / {way.totalCount} 노드 구간 연결
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
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
          )}
        </div>
      </div>
    </div>
  );
};
