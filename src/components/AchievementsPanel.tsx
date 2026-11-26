import React, { useState } from 'react';
import { Award, CheckCircle2, Circle } from 'lucide-react';
import { AchievementCategory, GameState } from '../game/types';
import { ModalShell, SegmentedControl } from './ui/ModalShell';

interface AchievementsPanelProps {
  gameState: GameState;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<'all' | AchievementCategory, string> = {
  all: '전체',
  osm: 'OSM 노드',
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
    <ModalShell
      onClose={onClose}
      ariaLabel="네트워크 개척 업적"
      icon={<Award className="w-4 h-4 text-yellow-400" />}
      title="네트워크 개척 업적"
      subtitle={
        <>
          달성 {unlockedList.length}/{gameState.achievements.length} · 누적 보너스{' '}
          <span className="text-emerald-400 font-semibold font-mono-numbers">
            +{totalBonusPct}%
          </span>
        </>
      }
      headerRight={
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={(Object.keys(CATEGORY_LABELS) as ('all' | AchievementCategory)[]).map((cat) => ({
            id: cat,
            label: CATEGORY_LABELS[cat],
          }))}
        />
      }
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {visibleAchievements.map((ach) => (
          <div
            key={ach.id}
            className={`p-3.5 sm:p-4 rounded-xl border flex items-start gap-3 transition-colors ${
              ach.unlocked
                ? 'border-amber-400/35 bg-amber-950/20'
                : 'border-white/[0.08] bg-[#10182b]'
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
    </ModalShell>
  );
};
