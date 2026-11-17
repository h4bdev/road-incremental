import React, { useMemo, useState } from 'react';
import { CheckCircle2, MapPin, Route, TrainTrack, Truck, X } from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateMultipliers,
  CUSTOM_BRIDGE_WAY_NAMES,
  getLineNodeProgress,
} from '../game/rules';

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
  const [filterMode, setFilterMode] = useState<'all' | 'osm' | 'milestones'>('all');
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
        // Partially built in-progress ways first, then completed, then unbuilt longest ways
        const aInProg = a.builtCount > 0 && !a.completed ? 0 : a.completed ? 1 : 2;
        const bInProg = b.builtCount > 0 && !b.completed ? 0 : b.completed ? 1 : 2;
        if (aInProg !== bInProg) return aInProg - bInProg;
        return b.totalCount - a.totalCount;
      })
      .slice(0, 60);
  }, [gameState.osmEdges, mults]);

  const sortedLines = useMemo(() => {
    return [...gameState.lines].sort((a, b) => {
      const aLocal = a.cityId === gameState.startingCity.id ? 0 : 1;
      const bLocal = b.cityId === gameState.startingCity.id ? 0 : 1;
      return aLocal - bLocal;
    });
  }, [gameState.lines, gameState.startingCity.id]);

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
                  도로·철도 노선 현황 (노드 연결)
                </h2>
                <p className="hidden sm:block text-xs text-slate-400">
                  모든 도로·철도는 지도의 노드를 두 번 클릭해 직접 이어서만 연결할 수 있습니다.
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
              <button
                onClick={() => setFilterMode('all')}
                className={`min-h-[36px] px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap cursor-pointer ${
                  filterMode === 'all' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                전체
              </button>
              <button
                onClick={() => setFilterMode('osm')}
                className={`min-h-[36px] px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap cursor-pointer ${
                  filterMode === 'osm' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                실제 도로·철도 ({osmWays.length})
              </button>
              <button
                onClick={() => setFilterMode('milestones')}
                className={`min-h-[36px] px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap cursor-pointer ${
                  filterMode === 'milestones'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                노선 마일스톤
              </button>
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
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-5 sm:space-y-6">
          {(filterMode === 'all' || filterMode === 'osm') && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-200">
                  지도 위 실제 OSM 도로·철도 노선
                </h3>
                <span className="text-xs text-slate-400 font-mono-numbers shrink-0">
                  완공 {(gameState.completedOsmWays || []).length}개
                </span>
              </div>

              {osmWays.length === 0 ? (
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400">
                  지도의 &quot;도로 불러오기&quot;를 누르면 실제 도로·철도 노선이 표시됩니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {osmWays.map((way) => {
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
            </section>
          )}

          {(filterMode === 'all' || filterMode === 'milestones') && (
            <section className="space-y-3">
              <h3 className="text-xs sm:text-sm font-bold text-slate-200">
                도시·광역 노선 마일스톤 (연결 노드 수로 자동 달성)
              </h3>

              <div className="space-y-3">
                {sortedLines.map((line) => {
                  const { current, target } = getLineNodeProgress(gameState, line);
                  const pct = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
                  const firstSeg = gameState.segments.find((s) => s.lineId === line.id);
                  const focusLat =
                    firstSeg?.coordinates[0]?.[0] ?? gameState.startingCity.lat;
                  const focusLng =
                    firstSeg?.coordinates[0]?.[1] ?? gameState.startingCity.lng;

                  return (
                    <div
                      key={line.id}
                      className={`p-3.5 sm:p-4 rounded-xl border space-y-2.5 ${
                        line.completed
                          ? 'border-emerald-500/40 bg-emerald-950/15'
                          : 'border-slate-800 bg-slate-900/50'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: line.color }}
                            />
                            <h4 className="text-sm font-bold text-white">{line.name}</h4>
                            <span className="text-xs text-slate-400">· {line.lineCode}</span>
                            <span
                              className={`text-[11px] font-semibold ${
                                line.mode === 'rail' ? 'text-cyan-400' : 'text-amber-400'
                              }`}
                            >
                              ({line.mode === 'rail' ? '철도 노드' : '도로 노드'})
                            </span>
                            {line.completed && (
                              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 완공됨
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {line.description} · 완공 보너스:{' '}
                            <span className="text-amber-400 font-medium">
                              {line.completionBonus.label}
                            </span>
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            onFocusMap(focusLat, focusLng, 16);
                            onClose();
                          }}
                          className="self-start min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <MapPin className="w-3.5 h-3.5 text-sky-400" />
                          지도에서 노드 잇기
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-mono-numbers text-slate-400">
                          <span>
                            {line.mode === 'rail' ? '철도' : '도로'} 연결 노드{' '}
                            {Math.min(current, target).toLocaleString()} /{' '}
                            {target.toLocaleString()}개
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full transition-all duration-300"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: line.completed ? '#10b981' : line.color,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
