import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Gamepad2,
  HelpCircle,
  MapPin,
  Route,
  TreeDeciduous,
  X,
} from 'lucide-react';
import { GameState } from '../game/types';

export const TUTORIAL_DONE_STORAGE_KEY = 'ROAD_INC_TUTORIAL_DONE_V1';

interface TutorialGuideProps {
  gameState: GameState;
  stepIndex: number;
  onStepChange: (nextStep: number) => void;
  onComplete: () => void;
}

interface TutorialStepDef {
  id: string;
  title: string;
  description: string;
  hint: string;
  icon: React.ReactNode;
}

const STEPS: TutorialStepDef[] = [
  {
    id: 'seed',
    title: '1. 첫 출발 노드 선택',
    description:
      '지도 위 빛나는 도로·철도 교차점을 한 번 클릭(터치)해 시작 거점을 지정하세요.',
    hint: '어느 교차점이든 자유롭게 첫 거점으로 고를 수 있습니다.',
    icon: <MapPin className="w-4 h-4 text-amber-400" />,
  },
  {
    id: 'link',
    title: '2. 실제 노선 따라 연결하기',
    description:
      '시점 노드를 누른 뒤 원하는 목표 노드를 클릭하면 실제 도로·철도를 따라 자동 연결됩니다.',
    hint: '자금이 부족하면 상단(모바일 우하단) "운행 배차" 버튼으로 바로 벌 수 있어요.',
    icon: <Route className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'study_town',
    title: '3. 연구 트리와 타운 게임 병행',
    description:
      '노선이 길어질수록 건설비가 오릅니다. 하단 "연구"로 건설비를 낮추고 "타운" 미니게임으로 수익 배수를 키우세요.',
    hint: '연구와 타운 게임 마일스톤이 함께 성장해야 대도시 확장 속도가 붙습니다.',
    icon: <TreeDeciduous className="w-4 h-4 text-sky-400" />,
  },
  {
    id: 'expand',
    title: '4. 인접 행정구역 세계 확장',
    description:
      '자금을 모아 "세계 확장" 탭 또는 지도 위 지역 카드로 인접 행정구역(카운티·시·군·구)을 해금하고 노선을 이어가세요!',
    hint: '저장 슬롯 창에서 자금 밸런스 조정 및 클라우드 백업도 언제든 가능합니다.',
    icon: <Compass className="w-4 h-4 text-indigo-400" />,
  },
];

export const TutorialGuide: React.FC<TutorialGuideProps> = ({
  gameState,
  stepIndex,
  onStepChange,
  onComplete,
}) => {
  const safeIndex = Math.max(0, Math.min(STEPS.length - 1, stepIndex));
  const step = STEPS[safeIndex];
  const isLast = safeIndex === STEPS.length - 1;

  const hasSeed =
    gameState.stats.connectedOsmNodes > 0 && (gameState.pendingSeedRegionIds || []).length === 0;
  const hasBuiltEdge = gameState.stats.totalOsmEdgesBuilt > 0;
  const hasSkillOrMinigame =
    gameState.skills.some((s) => s.level > 0) ||
    gameState.minigames.unlockedMilestoneIds.length > 0;

  const stepDone =
    (safeIndex === 0 && hasSeed) ||
    (safeIndex === 1 && hasBuiltEdge) ||
    (safeIndex === 2 && hasSkillOrMinigame);

  return (
    <aside
      data-testid="onboarding-tutorial"
      aria-label="초보자 가이드"
      className="fixed top-[136px] sm:top-[152px] right-2 sm:right-3 z-30 w-[min(330px,calc(100vw-16px))] rounded-2xl ui-glass border-sky-400/35 shadow-2xl p-3.5 text-slate-100 pointer-events-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#10182b] border border-white/[0.09] flex items-center justify-center shrink-0">
            {step.icon}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-sky-400 flex items-center gap-1">
              <HelpCircle className="w-3 h-3" />
              플레이 가이드 ({safeIndex + 1}/{STEPS.length})
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-white truncate">{step.title}</h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onComplete}
          aria-label="튜토리얼 닫기"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer shrink-0 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-slate-200 leading-relaxed mt-2.5">{step.description}</p>
      <p className="text-[11px] text-slate-400 leading-snug mt-2 bg-[#070b14]/80 border border-white/[0.06] rounded-lg px-2.5 py-2">
        {step.hint}
      </p>

      {/* Progress segments */}
      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-1">
          {STEPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStepChange(idx)}
              aria-label={`${idx + 1}단계로 이동`}
              className={`h-1 rounded-full transition-all cursor-pointer ${
                idx === safeIndex
                  ? 'w-5 bg-sky-400'
                  : idx < safeIndex
                  ? 'w-2.5 bg-emerald-400'
                  : 'w-2.5 bg-white/[0.15]'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onComplete}
            className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 text-[11px] font-medium cursor-pointer transition-colors"
          >
            건너뛰기
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onComplete}
              className="min-h-[32px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              완료
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStepChange(safeIndex + 1)}
              className={`min-h-[32px] px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                stepDone
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
              }`}
            >
              <span>{stepDone ? '다음 (달성!)' : '다음'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {safeIndex === 2 && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
          <span>하단 메뉴의 &ldquo;연구&rdquo;와 &ldquo;타운&rdquo; 버튼을 눌러 확인해 보세요.</span>
        </div>
      )}
    </aside>
  );
};
