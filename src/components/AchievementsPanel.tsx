import React, { useState } from 'react';
import { Award, CheckCircle2, Circle, X } from 'lucide-react';
import { AchievementCategory, GameState } from '../game/types';

interface AchievementsPanelProps {
  gameState: GameState;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<'all' | AchievementCategory, string> = {
  all: '전체',
  osm: 'OSM 노드',
  line: '노선 완공',
  town: '도시 마스터',
  scale: '네트워크 규모',
};

export const AchievementsPanel: React.FC<AchievementsPanelProps> = ({
  gameState,
  onClose,
}) => {
  const [filter, setFilter] = useState<'all' | AchievementCategory>('all');

  const unlockedList = gameState.achievements.filter((a) => a.unlocked);
  const totalBonusPct = unlockedList.reduce((sum, a) => sum + a.bonusIncomePct, 0);

  const visibleAchievements = [...gameState.achievements]
    .filter((a) => (filter === 'all' ? true : a.category === filter))
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked));

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
              <Award className="w-5 h-5 text-yellow-400 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                  노선·도시 완성 업적
                </h2>
                <p className="text-xs text-slate-400">
                  달성 {unlockedList.length}/{gameState.achievements.length} · 누적 보너스{' '}
                  <span className="text-emerald-400 font-semibold font-mono-numbers">
                    +{totalBonusPct}%
                  </span>
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

          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 overflow-x-auto no-scrollbar w-full sm:w-auto">
              {(Object.keys(CATEGORY_LABELS) as ('all' | AchievementCategory)[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`min-h-[36px] px-2.5 py-1 text-xs rounded-md font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    filter === cat ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
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

        {/* Achievements List */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleAchievements.map((ach) => (
            <div
              key={ach.id}
              className={`p-3.5 sm:p-4 rounded-xl border flex items-start gap-3 ${
                ach.unlocked
                  ? 'border-yellow-500/40 bg-yellow-950/15'
                  : 'border-slate-800 bg-slate-900/45'
              }`}
            >
              {ach.unlocked ? (
                <CheckCircle2 className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white truncate">{ach.title}</h3>
                  <span
                    className={`text-[11px] font-semibold shrink-0 ${
                      ach.unlocked ? 'text-yellow-300' : 'text-slate-500'
                    }`}
                  >
                    {ach.unlocked ? '달성 완료' : CATEGORY_LABELS[ach.category]}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{ach.description}</p>
                <div className="text-xs font-medium text-amber-400 pt-1">
                  보상: {ach.rewardText}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
