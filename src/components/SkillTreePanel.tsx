import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Compass,
  Cpu,
  Lock,
  Maximize2,
  RotateCcw,
  Sparkles,
  Train,
  TreeDeciduous,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { GameState, SkillBranch, SkillNode } from '../game/types';
import {
  areSkillRequirementsMet,
  canUnlockSkill,
  getSkillMaxAffordable,
  getSkillMoneyCost,
  getSkillTotalInvestedCost,
} from '../game/rules';
import { formatMoneyCompact } from '../game/format';
import { ModalShell } from './ui/ModalShell';

export { formatMoneyCompact };

interface SkillTreePanelProps {
  gameState: GameState;
  onClose: () => void;
  onUnlockSkill: (skillId: string) => void;
  onBuyMaxSkill: (skillId: string) => void;
  onBuyAllSkills: () => void;
  onResetSkillTree: () => void;
}

const TREE_WIDTH = 1600;
const TREE_HEIGHT = 2160;

const BRANCH_META: Record<
  SkillBranch,
  { stroke: string; fillBg: string; glow: string; label: string; badgeText: string }
> = {
  core: {
    stroke: '#38bdf8',
    fillBg: 'rgba(14, 116, 144, 0.25)',
    glow: 'rgba(56, 189, 248, 0.45)',
    label: '통합 코어',
    badgeText: 'text-sky-300',
  },
  infra: {
    stroke: '#f59e0b',
    fillBg: 'rgba(180, 83, 9, 0.25)',
    glow: 'rgba(245, 158, 11, 0.45)',
    label: '토목·도로',
    badgeText: 'text-amber-300',
  },
  speed: {
    stroke: '#06b6d4',
    fillBg: 'rgba(8, 145, 178, 0.25)',
    glow: 'rgba(6, 182, 212, 0.45)',
    label: '고속·철도',
    badgeText: 'text-cyan-300',
  },
  realestate: {
    stroke: '#10b981',
    fillBg: 'rgba(5, 150, 105, 0.25)',
    glow: 'rgba(16, 185, 129, 0.45)',
    label: '상권·물류',
    badgeText: 'text-emerald-300',
  },
};

function getNodeIcon(branch: SkillBranch) {
  switch (branch) {
    case 'infra':
      return Cpu;
    case 'speed':
      return Train;
    case 'realestate':
      return Building2;
    default:
      return Sparkles;
  }
}

/**
 * Clean Antimatter Dimensions-style stepped/angled connector from parent (bottom) -> child (top).
 */
function buildAdConnectorPath(parent: SkillNode, child: SkillNode): string {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  if (Math.abs(dx) < 6) {
    return `M ${parent.x} ${parent.y} L ${child.x} ${child.y}`;
  }
  const midY = parent.y + dy * 0.5;
  return `M ${parent.x} ${parent.y} L ${parent.x} ${midY} L ${child.x} ${midY} L ${child.x} ${child.y}`;
}

export const SkillTreePanel: React.FC<SkillTreePanelProps> = ({
  gameState,
  onClose,
  onUnlockSkill,
  onBuyMaxSkill,
  onBuyAllSkills,
  onResetSkillTree,
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string>('sk_root_0');
  const [zoom, setZoom] = useState<number>(0.54);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 20, y: 12 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const hasAutoFitRef = useRef(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const movedDistRef = useRef(0);

  const skillMap = useMemo(
    () => new Map(gameState.skills.map((s) => [s.id, s])),
    [gameState.skills]
  );

  const selectedSkill = skillMap.get(selectedSkillId) || gameState.skills[0];

  const totalTreeLevels = gameState.skills.reduce((sum, s) => sum + s.level, 0);
  const maxTreeLevels = gameState.skills.reduce((sum, s) => sum + s.maxLevel, 0);
  const totalInvested = useMemo(
    () => gameState.skills.reduce((sum, s) => sum + getSkillTotalInvestedCost(s), 0),
    [gameState.skills]
  );
  const anyAffordable = useMemo(
    () => gameState.skills.some((s) => canUnlockSkill(gameState, s)),
    [gameState]
  );

  const fitTopToViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return;
    const padX = w < 640 ? 16 : 36;
    const widthFit = (w - padX) / TREE_WIDTH;
    const nextZoom = Math.max(0.26, Math.min(0.82, Number(widthFit.toFixed(3))));
    const offsetX = Math.round((w - TREE_WIDTH * nextZoom) / 2);
    const offsetY = 16;
    setZoom(nextZoom);
    setPan({ x: offsetX, y: offsetY });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!hasAutoFitRef.current) {
        hasAutoFitRef.current = true;
        fitTopToViewport();
      }
    });
    observer.observe(el);
    fitTopToViewport();
    return () => observer.disconnect();
  }, [fitTopToViewport]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedDistRef.current = 0;

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = activePointersRef.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    movedDistRef.current += Math.hypot(dx, dy);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartDistRef.current && pinchStartDistRef.current > 0) {
        const scale = dist / pinchStartDistRef.current;
        if (Math.abs(scale - 1) > 0.015) {
          setZoom((z) => Math.max(0.22, Math.min(1.4, Number((z * scale).toFixed(3)))));
          pinchStartDistRef.current = dist;
        }
      } else {
        pinchStartDistRef.current = dist;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((prev) => Math.max(0.22, Math.min(1.4, Number((prev + delta).toFixed(2)))));
      return;
    }
    // Natural vertical scroll along AD study tree
    setPan((p) => ({ x: p.x - e.deltaX * 0.65, y: p.y - e.deltaY * 0.85 }));
  };

  // Selected study details
  const selReqMet = selectedSkill ? areSkillRequirementsMet(gameState, selectedSkill) : false;
  const selMoneyCost = selectedSkill ? getSkillMoneyCost(selectedSkill) : 0;
  const selMaxInfo = selectedSkill
    ? getSkillMaxAffordable(gameState, selectedSkill)
    : { count: 0, totalCost: 0 };
  const selAffordable = selectedSkill ? canUnlockSkill(gameState, selectedSkill) : false;
  const selIsMaxed = selectedSkill ? selectedSkill.level >= selectedSkill.maxLevel : false;
  const selReqNames =
    selectedSkill?.requires
      .map((reqId) => {
        const s = skillMap.get(reqId);
        return s ? `[${s.code || s.tier}] ${s.name}` : null;
      })
      .filter(Boolean)
      .join(selectedSkill.id === 'sk_multi_path' ? ' 또는 ' : ', ') || '';

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel="통합 연구 트리"
      testId="study-tree-modal"
      maxWidthClass="max-w-6xl"
      heightClass="h-[calc(100dvh-124px)] sm:h-[87vh]"
      icon={<TreeDeciduous className="w-4 h-4 text-emerald-400" />}
      title={`통합 연구 트리 (${gameState.skills.length}종 · ${totalTreeLevels}/${maxTreeLevels} Lv)`}
      subtitle="자금($)만으로 [11]부터 [161] 특이점까지 모든 전문 분야를 자유롭게 연구하세요."
      headerRight={
        <>
          <div className="font-mono-numbers text-left sm:text-right mr-1">
            <div className="text-[10px] text-slate-400">보유 연구 자금</div>
            <div
              data-testid="study-capital-display"
              className="text-xs sm:text-sm font-bold text-emerald-400"
            >
              {formatMoneyCompact(gameState.capital)}
            </div>
          </div>

          <button
            data-testid="study-buy-all-btn"
            disabled={!anyAffordable}
            onClick={onBuyAllSkills}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              anyAffordable
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
            }`}
          >
            가능한 연구 최대 구매
          </button>

          <button
            data-testid="study-reset-btn"
            disabled={totalInvested <= 0}
            onClick={onResetSkillTree}
            title="투자한 모든 자금을 100% 환불받고 연구 트리를 초기화합니다."
            className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              totalInvested > 0
                ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-500/45'
                : 'bg-white/[0.04] text-slate-600 border border-white/[0.06] cursor-not-allowed'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>트리 초기화 (100% 환불)</span>
          </button>
        </>
      }
    >
      {/* Main Split: Top-to-Bottom AD Study Viewport + Inspector Drawer */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Interactive Pannable / Scrollable AD Study Canvas */}
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          className="relative flex-1 min-h-[220px] overflow-hidden bg-[#070b14] cursor-grab active:cursor-grabbing touch-none"
        >
          {/* Zoom & View Controls */}
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1 p-1 rounded-xl ui-glass shadow-lg">
            <button
              onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
              aria-label="트리 확대"
              className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.22, Number((z - 0.1).toFixed(2))))}
              aria-label="트리 축소"
              className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={fitTopToViewport}
              className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/[0.07] flex items-center gap-1 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
              상단 정렬
            </button>
          </div>

          {/* Tree Navigation Hint */}
          <div className="hidden sm:flex absolute top-2.5 right-2.5 z-20 items-center gap-2 px-3 py-1.5 rounded-xl ui-glass text-[11px] text-slate-300 shadow">
            <span>휠·드래그로 1~16티어 자유 탐색</span>
          </div>

          {/* Transformed AD Study World */}
          <div
            style={{
              width: TREE_WIDTH,
              height: TREE_HEIGHT,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
            className="relative"
          >
            {/* Era & Branch Visual Guides */}
            <div
              style={{ left: 60, top: 645, width: 1480 }}
              className="absolute border-t border-dashed border-white/[0.12] pt-2 flex items-center justify-between text-xs font-bold pointer-events-none"
            >
              <span className="text-amber-400 bg-[#070b14] pr-3">토목 · 도로 분야</span>
              <span className="text-cyan-400 bg-[#070b14] px-3">철도 · 고속배차 분야</span>
              <span className="text-emerald-400 bg-[#070b14] pl-3">상권 · 물류 분야</span>
            </div>

            <div
              style={{ left: 60, top: 1320, width: 1480 }}
              className="absolute border-t border-dashed border-sky-400/35 pt-1.5 text-center text-xs font-bold text-sky-400 pointer-events-none"
            >
              대륙 · 행성 초장거리 시대 (10,000 km ~ 1,000,000+ km)
            </div>

              {/* SVG Connectors */}
              <svg
                width={TREE_WIDTH}
                height={TREE_HEIGHT}
                viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`}
                className="absolute inset-0 pointer-events-none"
              >
                {gameState.skills.map((skill) =>
                  skill.requires.map((reqId) => {
                    const parent = skillMap.get(reqId);
                    if (!parent) return null;

                    const bothUnlocked = parent.level > 0 && skill.level > 0;
                    const ready = parent.level > 0 && skill.level === 0;
                    const branchMeta = BRANCH_META[skill.branch];
                    const pathD = buildAdConnectorPath(parent, skill);

                    return (
                      <g key={`${reqId}->${skill.id}`}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#030712"
                          strokeWidth={bothUnlocked ? 7 : 5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d={pathD}
                          fill="none"
                          stroke={
                            bothUnlocked
                              ? branchMeta.stroke
                              : ready
                              ? '#64748b'
                              : '#1e293b'
                          }
                          strokeWidth={bothUnlocked ? 3.5 : 2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={ready ? '7 5' : undefined}
                          opacity={bothUnlocked ? 0.95 : ready ? 0.85 : 0.65}
                        />
                      </g>
                    );
                  })
                )}
              </svg>

              {/* Antimatter Dimensions-Style Rectangular Study Tiles */}
              {gameState.skills.map((skill) => {
                const Icon = getNodeIcon(skill.branch);
                const branchMeta = BRANCH_META[skill.branch];
                const reqMet = areSkillRequirementsMet(gameState, skill);
                const unlocked = skill.level > 0;
                const isMaxed = skill.level >= skill.maxLevel;
                const affordable = canUnlockSkill(gameState, skill);
                const isSelected = selectedSkill?.id === skill.id;
                const nextCost = getSkillMoneyCost(skill);
                const code = skill.code || `${skill.tier}`;

                return (
                  <button
                    key={skill.id}
                    type="button"
                    data-testid={`study-node-${skill.id}`}
                    onClick={() => {
                      if (movedDistRef.current > 8) return;
                      if (selectedSkillId === skill.id && affordable) {
                        onUnlockSkill(skill.id);
                      } else {
                        setSelectedSkillId(skill.id);
                      }
                    }}
                    style={{
                      left: skill.x,
                      top: skill.y,
                      transform: 'translate(-50%, -50%)',
                      width: skill.id === 'sk_multi_path' || skill.id === 'sk_crown_3' ? 236 : 196,
                      borderColor: isSelected
                        ? '#ffffff'
                        : isMaxed
                        ? '#10b981'
                        : unlocked
                        ? branchMeta.stroke
                        : affordable
                        ? '#fbbf24'
                        : reqMet
                        ? '#475569'
                        : '#1e293b',
                      backgroundColor: unlocked
                        ? branchMeta.fillBg
                        : reqMet
                        ? '#10182b'
                        : '#0b1120',
                      boxShadow: isSelected
                        ? '0 0 0 2px rgba(255,255,255,0.28)'
                        : undefined,
                    }}
                    className="absolute rounded-xl border-2 px-2.5 py-2 text-left transition-transform hover:scale-[1.03] cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono-numbers font-bold">
                        {!reqMet ? (
                          <Lock className="w-3 h-3 text-slate-500" />
                        ) : (
                          <Icon className={`w-3.5 h-3.5 ${branchMeta.badgeText}`} />
                        )}
                        <span className="text-slate-300">[{code}]</span>
                      </span>
                      <span
                        className={`text-[11px] font-mono-numbers font-bold ${
                          isMaxed
                            ? 'text-emerald-400'
                            : unlocked
                            ? 'text-sky-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {skill.level}/{skill.maxLevel}
                      </span>
                    </div>

                    <div className="text-xs font-bold text-white truncate mt-1">
                      {skill.name}
                    </div>

                    <div className="flex items-center justify-between gap-1 mt-1 text-[10px] font-mono-numbers">
                      <span className="text-amber-300/90 truncate">{skill.effectText}</span>
                      {!isMaxed && (
                        <span
                          className={`font-bold shrink-0 ${
                            affordable ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatMoneyCompact(nextCost)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right / Bottom Study Inspector Drawer */}
          {selectedSkill && (
            <aside className="w-full lg:w-84 shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#080d18] p-4 sm:p-5 flex flex-col justify-between gap-3 overflow-y-auto max-h-[44%] lg:max-h-none">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div
                      className={`text-[11px] sm:text-xs font-semibold ${
                        BRANCH_META[selectedSkill.branch].badgeText
                      }`}
                    >
                      [{selectedSkill.code || selectedSkill.tier}] ·{' '}
                      {BRANCH_META[selectedSkill.branch].label} · Tier {selectedSkill.tier}
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-white mt-0.5 leading-snug">
                      {selectedSkill.name}
                    </h3>
                  </div>
                  <span className="text-xs font-mono-numbers font-bold text-sky-400 shrink-0">
                    Lv.{selectedSkill.level}/{selectedSkill.maxLevel}
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedSkill.description}
                </p>

                <div className="p-3 rounded-xl bg-[#10182b] border border-white/[0.08] space-y-1">
                  <div className="text-[10px] sm:text-[11px] text-slate-400">연구 효과</div>
                  <div className="text-xs font-bold text-amber-300">
                    {selectedSkill.effectText}
                  </div>
                </div>

                {!selReqMet && selReqNames && (
                  <div className="flex items-start gap-2 text-xs text-slate-400 p-2.5 rounded-lg bg-[#10182b]/70 border border-white/[0.07]">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
                    <span>선행 연구 필요: {selReqNames}</span>
                  </div>
                )}

                {selectedSkill.requires.length === 0 && (
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400">
                    <Compass className="w-3.5 h-3.5" />
                    <span>연구 트리 시작 코어 [11] · 재클릭 시 즉시 +1 연구</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/[0.07] space-y-2.5">
                {selIsMaxed ? (
                  <div className="min-h-[42px] py-2 rounded-xl bg-emerald-950/35 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5">
                    <Check className="w-4 h-4" />
                    연구 마스터 완료 (최대 레벨)
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs font-mono-numbers text-slate-400">
                      <span>다음 레벨 비용 (자금 전용):</span>
                      <strong
                        className={
                          gameState.capital >= selMoneyCost ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {formatMoneyCompact(selMoneyCost)}
                      </strong>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        data-testid="study-buy-one-btn"
                        disabled={!selAffordable}
                        onClick={() => onUnlockSkill(selectedSkill.id)}
                        className={`min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          selAffordable
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        +1 연구 ({formatMoneyCompact(selMoneyCost)})
                      </button>

                      <button
                        data-testid="study-buy-max-btn"
                        disabled={selMaxInfo.count <= 0}
                        onClick={() => onBuyMaxSkill(selectedSkill.id)}
                        className={`min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          selMaxInfo.count > 0
                            ? 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                        }`}
                      >
                        {selMaxInfo.count > 0
                          ? `최대 +${selMaxInfo.count} (${formatMoneyCompact(selMaxInfo.totalCost)})`
                          : '최대 구매 불가'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </aside>
          )}
      </div>
    </ModalShell>
  );
};
