import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Building2,
  Check,
  Compass,
  Cpu,
  Lock,
  Maximize2,
  Sparkles,
  Train,
  TreeDeciduous,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { GameState, SkillBranch, SkillNode } from '../game/types';
import {
  calculateMultipliers,
  canUnlockSkill,
  getSkillMoneyCost,
} from '../game/rules';

interface SkillTreePanelProps {
  gameState: GameState;
  onClose: () => void;
  onUnlockSkill: (skillId: string) => void;
}

const TREE_WIDTH = 1600;
const TREE_HEIGHT = 1200;

const BRANCH_COLORS: Record<
  SkillBranch,
  { stroke: string; glow: string; label: string; badgeText: string }
> = {
  core: {
    stroke: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.5)',
    label: '세계수 중심 축',
    badgeText: 'text-sky-300',
  },
  infra: {
    stroke: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.5)',
    label: '토목·도로 공학 가지',
    badgeText: 'text-amber-300',
  },
  speed: {
    stroke: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.5)',
    label: '고속 수송·배차 가지',
    badgeText: 'text-cyan-300',
  },
  realestate: {
    stroke: '#10b981',
    glow: 'rgba(16, 185, 129, 0.5)',
    label: '역세권·상권 가지',
    badgeText: 'text-emerald-300',
  },
  automation: {
    stroke: '#818cf8',
    glow: 'rgba(129, 140, 248, 0.5)',
    label: '자율 시공·봇 가지',
    badgeText: 'text-indigo-300',
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
    case 'automation':
      return Bot;
    default:
      return Sparkles;
  }
}

/**
 * Generates an organic curved cubic-bezier SVG path radiating outward from the tree's center origin.
 */
function buildOrganicBranchPath(parent: SkillNode, child: SkillNode): string {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const len = Math.hypot(dx, dy) || 1;
  // Subtle organic curve perpendicular to the branch vector
  const nx = -dy / len;
  const ny = dx / len;
  const bend = Math.min(34, len * 0.14) * (child.x >= 800 ? 1 : -1);
  const cx1 = parent.x + dx * 0.32 + nx * bend;
  const cy1 = parent.y + dy * 0.32 + ny * bend;
  const cx2 = parent.x + dx * 0.68 - nx * bend * 0.45;
  const cy2 = parent.y + dy * 0.68 - ny * bend * 0.45;
  return `M ${parent.x} ${parent.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${child.x} ${child.y}`;
}

export const SkillTreePanel: React.FC<SkillTreePanelProps> = ({
  gameState,
  onClose,
  onUnlockSkill,
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string>('sk_root_0');
  const [zoom, setZoom] = useState<number>(0.48);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 20, y: 20 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const hasAutoFitRef = useRef(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const movedDistRef = useRef(0);

  const mults = calculateMultipliers(gameState);
  const autoSkill = gameState.skills.find((s) => s.id === 'sk_auto_1');
  const autoActive = (autoSkill?.level || 0) > 0;

  const skillMap = useMemo(
    () => new Map(gameState.skills.map((s) => [s.id, s])),
    [gameState.skills]
  );

  const selectedSkill =
    skillMap.get(selectedSkillId) || gameState.skills[0];

  const totalTreeLevels = gameState.skills.reduce((sum, s) => sum + s.level, 0);
  const maxTreeLevels = gameState.skills.reduce((sum, s) => sum + s.maxLevel, 0);

  const fitTreeToViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return;
    const padX = w < 640 ? 24 : 56;
    const padY = w < 640 ? 24 : 48;
    const fitZoom = Math.max(
      0.24,
      Math.min(0.9, Number(Math.min((w - padX) / TREE_WIDTH, (h - padY) / TREE_HEIGHT).toFixed(3)))
    );
    const offsetX = Math.round((w - TREE_WIDTH * fitZoom) / 2);
    const offsetY = Math.round((h - TREE_HEIGHT * fitZoom) / 2);
    setZoom(fitZoom);
    setPan({ x: offsetX, y: offsetY });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!hasAutoFitRef.current) {
        hasAutoFitRef.current = true;
        fitTreeToViewport();
      }
    });
    observer.observe(el);
    fitTreeToViewport();
    return () => observer.disconnect();
  }, [fitTreeToViewport]);

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
          setZoom((z) => Math.max(0.24, Math.min(1.4, Number((z * scale).toFixed(3)))));
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
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((prev) => Math.max(0.24, Math.min(1.4, Number((prev + delta).toFixed(2)))));
  };

  const resetTreeView = () => {
    fitTreeToViewport();
  };

  // Compute selected skill state
  const selReqMet =
    selectedSkill?.requires.every((reqId) => (skillMap.get(reqId)?.level || 0) > 0) ??
    false;
  const selMoneyCost = selectedSkill ? getSkillMoneyCost(selectedSkill) : 0;
  const selAffordable = selectedSkill ? canUnlockSkill(gameState, selectedSkill) : false;
  const selIsMaxed = selectedSkill ? selectedSkill.level >= selectedSkill.maxLevel : false;
  const selReqNames =
    selectedSkill?.requires
      .map((reqId) => skillMap.get(reqId)?.name)
      .filter(Boolean)
      .join(', ') || '';

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4 bg-black/70"
    >
      <div className="w-full max-w-6xl h-[calc(100dvh-124px)] sm:h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#09101e] border-t sm:border border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-2 sm:gap-3 px-4 sm:px-5 py-2.5 sm:py-3.5 border-b border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <TreeDeciduous className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                세계수 스킬 트리 ({totalTreeLevels}/{maxTreeLevels} Lv)
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                드래그·확대로 중앙 뿌리에서 사방으로 뻗어 나가는 28개 노드를 연구하세요.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <div className="text-right font-mono-numbers">
              <div className="hidden sm:block text-[11px] text-slate-400">보유 자원</div>
              <div className="text-xs sm:text-sm font-bold text-amber-400">
                {gameState.skillPoints} SP ·{' '}
                <span className="text-emerald-400">
                  ${Math.floor(gameState.capital).toLocaleString()}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Auto-Builder Status Strip */}
        {autoActive && (
          <div className="px-4 sm:px-5 py-1.5 sm:py-2 bg-indigo-950/35 border-b border-indigo-500/30 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-[11px] sm:text-xs text-indigo-200 font-medium min-w-0">
              <Zap className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="truncate">
                자율 시공 드론 (Lv.{autoSkill?.level}) ·{' '}
                {(1 / mults.autoBuilderRatePerSec).toFixed(1)}초당 {mults.parallelBuildCount}구간
              </span>
            </div>
            <div className="w-20 sm:w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-indigo-400 transition-all duration-150"
                style={{
                  width: `${Math.min(100, Math.round(gameState.autoBuilderProgress * 100))}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Main Split: Interactive Tree Viewport + Selected Node Inspector */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Interactive Pannable / Zoomable Organic Tree Canvas */}
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            className="relative flex-1 min-h-[200px] overflow-hidden bg-[#070d19] cursor-grab active:cursor-grabbing touch-none"
          >
            {/* Tree Zoom & Center Controls */}
            <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-slate-800 shadow-lg">
              <button
                onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.12).toFixed(2))))}
                aria-label="트리 확대"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.24, Number((z - 0.12).toFixed(2))))}
                aria-label="트리 축소"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={resetTreeView}
                className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                전체 보기
              </button>
            </div>

            {/* Branch Color Legend */}
            <div className="hidden sm:flex absolute bottom-3 left-3 z-20 items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                인프라
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" />
                고속 수송
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                세계수 코어
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400" />
                자동화 봇
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                역세권·상권
              </span>
            </div>

            {/* Transformed Botanical Tree World */}
            <div
              style={{
                width: TREE_WIDTH,
                height: TREE_HEIGHT,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
              className="relative"
            >
              {/* SVG Radial Tree Silhouette, Canopy Aura, Tier Rings & Outward Branches */}
              <svg
                width={TREE_WIDTH}
                height={TREE_HEIGHT}
                viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`}
                className="absolute inset-0 pointer-events-none"
              >
                <defs>
                  <radialGradient id="canopyAura" cx="50%" cy="50%" r="48%">
                    <stop offset="0%" stopColor="rgba(56, 189, 248, 0.16)" />
                    <stop offset="45%" stopColor="rgba(16, 185, 129, 0.08)" />
                    <stop offset="100%" stopColor="rgba(9, 16, 30, 0)" />
                  </radialGradient>
                </defs>

                {/* Radial Canopy Aura centered at (800, 600) */}
                <circle cx="800" cy="600" r="640" fill="url(#canopyAura)" />

                {/* Concentric Tier Rings around Center Origin (800, 600) */}
                {[180, 340, 500, 650].map((r) => (
                  <circle
                    key={r}
                    cx="800"
                    cy="600"
                    r={r}
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.12)"
                    strokeWidth="1.5"
                    strokeDasharray="6 8"
                  />
                ))}

                {/* Prerequisite Curved Tree Limbs */}
                {gameState.skills.map((skill) =>
                  skill.requires.map((reqId) => {
                    const parent = skillMap.get(reqId);
                    if (!parent) return null;

                    const bothUnlocked = parent.level > 0 && skill.level > 0;
                    const readyToGrow = parent.level > 0 && skill.level === 0;
                    const colorMeta = BRANCH_COLORS[skill.branch];

                    const strokeWidth =
                      skill.role === 'trunk'
                        ? 14
                        : skill.role === 'root'
                        ? 7
                        : skill.role === 'branch'
                        ? 6
                        : 3.5;

                    const pathD = buildOrganicBranchPath(parent, skill);

                    return (
                      <g key={`${reqId}->${skill.id}`}>
                        {/* Outer bark/shadow sheath */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#0f172a"
                          strokeWidth={strokeWidth + 4}
                          strokeLinecap="round"
                        />
                        {/* Living branch / sap line */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={
                            bothUnlocked
                              ? colorMeta.stroke
                              : readyToGrow
                              ? '#64748b'
                              : '#1e293b'
                          }
                          strokeWidth={strokeWidth}
                          strokeLinecap="round"
                          strokeDasharray={readyToGrow ? '8 6' : undefined}
                          opacity={bothUnlocked ? 0.92 : readyToGrow ? 0.85 : 0.65}
                        />
                      </g>
                    );
                  })
                )}
              </svg>

              {/* Interactive Tree Nodes */}
              {gameState.skills.map((skill) => {
                const Icon = getNodeIcon(skill.branch);
                const colorMeta = BRANCH_COLORS[skill.branch];
                const reqMet = skill.requires.every(
                  (reqId) => (skillMap.get(reqId)?.level || 0) > 0
                );
                const unlocked = skill.level > 0;
                const isMaxed = skill.level >= skill.maxLevel;
                const affordable = canUnlockSkill(gameState, skill);
                const isSelected = selectedSkill?.id === skill.id;

                const sizeClass =
                  skill.role === 'root' || skill.role === 'trunk'
                    ? 'w-16 h-16'
                    : skill.role === 'canopy'
                    ? 'w-14 h-14'
                    : 'w-13 h-13';

                const shapeClass =
                  skill.role === 'canopy'
                    ? 'rounded-full'
                    : skill.role === 'root'
                    ? 'rounded-2xl rotate-45'
                    : 'rounded-2xl';

                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => {
                      if (movedDistRef.current > 8) return;
                      setSelectedSkillId(skill.id);
                    }}
                    style={{
                      left: skill.x,
                      top: skill.y,
                      transform: 'translate(-50%, -50%)',
                    }}
                    className="group absolute flex flex-col items-center cursor-pointer focus:outline-none"
                  >
                    <div
                      style={{
                        borderColor: isSelected
                          ? '#ffffff'
                          : unlocked
                          ? colorMeta.stroke
                          : affordable
                          ? '#fbbf24'
                          : reqMet
                          ? '#475569'
                          : '#1e293b',
                        boxShadow: unlocked
                          ? `0 0 22px ${colorMeta.glow}`
                          : affordable
                          ? '0 0 14px rgba(251, 191, 36, 0.35)'
                          : undefined,
                      }}
                      className={`${sizeClass} ${shapeClass} border-2 flex items-center justify-center transition-transform group-hover:scale-110 ${
                        unlocked
                          ? 'bg-slate-900 text-white'
                          : reqMet
                          ? 'bg-slate-900/95 text-slate-200'
                          : 'bg-slate-950/90 text-slate-600'
                      }`}
                    >
                      <div className={skill.role === 'root' ? '-rotate-45' : ''}>
                        {!reqMet ? (
                          <Lock className="w-4 h-4" />
                        ) : (
                          <Icon className={`w-5 h-5 ${unlocked ? colorMeta.badgeText : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* Node Compact Label & Level Tag */}
                    <div
                      className={`mt-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap shadow-md ${
                        isSelected
                          ? 'bg-sky-950 border-white text-white'
                          : unlocked
                          ? 'bg-slate-950/95 border-slate-700 text-slate-100'
                          : reqMet
                          ? 'bg-slate-950/90 border-slate-800 text-slate-300'
                          : 'bg-slate-950/80 border-slate-900 text-slate-500'
                      }`}
                    >
                      <span>{skill.name.split(' (')[0]}</span>{' '}
                      <span
                        className={`font-mono-numbers ${
                          isMaxed
                            ? 'text-emerald-400'
                            : unlocked
                            ? 'text-sky-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {skill.level}/{skill.maxLevel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right / Bottom Node Inspector Drawer */}
          {selectedSkill && (
            <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950/95 p-3.5 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-4 overflow-y-auto max-h-[42%] lg:max-h-none">
              <div className="space-y-2 sm:space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div
                      className={`text-[11px] sm:text-xs font-semibold ${
                        BRANCH_COLORS[selectedSkill.branch].badgeText
                      }`}
                    >
                      {BRANCH_COLORS[selectedSkill.branch].label} · Tier {selectedSkill.tier}
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

                <div className="p-2.5 sm:p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-0.5 sm:space-y-1">
                  <div className="text-[10px] sm:text-[11px] text-slate-400">노드 효과</div>
                  <div className="text-xs font-bold text-amber-300">
                    {selectedSkill.effectText}
                  </div>
                </div>

                {!selReqMet && selReqNames && (
                  <div className="flex items-start gap-2 text-xs text-slate-400 p-2 rounded-lg bg-slate-900/50 border border-slate-800">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
                    <span>선행 가지 연구 필요: {selReqNames}</span>
                  </div>
                )}

                {selectedSkill.requires.length === 0 && (
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400">
                    <Compass className="w-3.5 h-3.5" />
                    <span>세계수 시작 뿌리 노드</span>
                  </div>
                )}
              </div>

              <div className="pt-2.5 sm:pt-3 border-t border-slate-800 space-y-2">
                {selIsMaxed ? (
                  <div className="min-h-[42px] py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5">
                    <Check className="w-4 h-4" />
                    마스터 완료
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs font-mono-numbers text-slate-400">
                      <span>
                        SP:{' '}
                        <strong
                          className={
                            gameState.skillPoints >= selectedSkill.costSP
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }
                        >
                          {selectedSkill.costSP} SP
                        </strong>
                      </span>
                      <span>
                        자금:{' '}
                        <strong
                          className={
                            gameState.capital >= selMoneyCost
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          ${selMoneyCost.toLocaleString()}
                        </strong>
                      </span>
                    </div>
                    <button
                      disabled={!selAffordable}
                      onClick={() => onUnlockSkill(selectedSkill.id)}
                      className={`w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        selAffordable
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {selectedSkill.level === 0 ? '가지 연구하기' : '노드 성장시키기'} (
                      {selectedSkill.costSP} SP / ${selMoneyCost.toLocaleString()})
                    </button>
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
