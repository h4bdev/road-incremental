import React from 'react';
import {
  Award,
  Gamepad2,
  Globe,
  HelpCircle,
  MapPin,
  MousePointerClick,
  RotateCcw,
  Save,
  TreeDeciduous,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateClickReward,
  calculateTotalIncomePerSec,
  getNodeTierRank,
} from '../game/rules';
import { formatIncomeRateCompact, formatMoneyCompact } from '../game/format';
import { getMinigameIncomeBoost } from '../game/minigames';
import { TierEmblem } from './ui/TierEmblem';

export type ModalTab =
  | 'lines'
  | 'skills'
  | 'achievements'
  | 'arcade'
  | 'prestige'
  | 'saves'
  | null;

interface HUDProps {
  gameState: GameState;
  activeModal: ModalTab;
  hasMapBottomCard?: boolean;
  activeSlotIndex: number;
  tutorialOpen?: boolean;
  onSelectModal: (tab: ModalTab) => void;
  onDispatchClick: () => void;
  onToggleSound: () => void;
  onToggleTutorial?: () => void;
  onOpenCityReset: () => void;
}

const HUDComponent: React.FC<HUDProps> = ({
  gameState,
  activeModal,
  hasMapBottomCard = false,
  activeSlotIndex,
  tutorialOpen = false,
  onSelectModal,
  onDispatchClick,
  onToggleSound,
  onToggleTutorial,
  onOpenCityReset,
}) => {
  const incomePerSec = calculateTotalIncomePerSec(gameState);
  const clickReward = calculateClickReward(gameState);
  const unlockedAchCount = gameState.achievements.filter((a) => a.unlocked).length;
  const mgBoost = getMinigameIncomeBoost(gameState.minigames);
  const rank = getNodeTierRank(gameState.stats.connectedOsmNodes);
  const hasLegacyInflatedCapital = gameState.capital >= 1e13;

  const toggleTab = (tab: Exclude<ModalTab, null>) => {
    onSelectModal(activeModal === tab ? null : tab);
  };

  const dockBtnBase =
    'min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap border';
  const dockBtnIdle =
    'text-slate-300 border-transparent hover:bg-white/[0.06] hover:text-white';
  const dockBtnActive =
    'bg-sky-500/18 text-white border-sky-400/45 shadow-sm';

  return (
    <>
      {/* TOP BAR */}
      <header className="fixed top-0 left-0 right-0 z-30 pointer-events-none px-1.5 pt-1.5 sm:p-3 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Core Metrics */}
        <div className="pointer-events-auto flex-1 sm:flex-initial flex items-center justify-between sm:justify-start gap-1.5 sm:gap-4 ui-glass rounded-xl px-2 sm:px-4 py-1.5 sm:py-2 shadow-xl min-w-0 overflow-hidden">
          <div className="flex flex-col min-w-0 shrink-0">
            <span className="text-[9px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              보유 자금
            </span>
            <span
              data-testid="hud-capital"
              className="text-xs sm:text-base md:text-lg font-bold text-emerald-400 font-mono-numbers leading-tight whitespace-nowrap"
            >
              {formatMoneyCompact(gameState.capital)}
            </span>
            <span
              data-testid="hud-income-rate"
              className="text-[9px] sm:text-xs text-emerald-400/85 font-semibold font-mono-numbers leading-tight whitespace-nowrap"
            >
              {formatIncomeRateCompact(incomePerSec)}
            </span>
          </div>

          <div className="hidden sm:block w-px h-8 bg-white/[0.08] shrink-0" />

          <div className="hidden sm:flex flex-col shrink-0">
            <span className="text-[11px] text-slate-400 font-medium">1:1 네트워크</span>
            <div className="flex items-baseline gap-1.5 font-mono-numbers">
              <span className="text-sm md:text-base font-bold text-sky-400 tabular-nums">
                {gameState.stats.mapped1to1Km.toLocaleString()} km
              </span>
            </div>
          </div>

          <div className="w-px h-7 sm:h-8 bg-white/[0.08] shrink-0" />

          <div className="flex flex-col shrink-0">
            <span className="text-[9px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              연결 노드
            </span>
            <div className="flex items-baseline gap-1 font-mono-numbers">
              <span
                data-testid="hud-connected-nodes"
                className="text-xs sm:text-sm md:text-base font-bold text-indigo-300 tabular-nums whitespace-nowrap"
              >
                {gameState.stats.connectedOsmNodes.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="w-px h-7 sm:h-8 bg-white/[0.08] shrink-0" />

          <button
            type="button"
            onClick={() => toggleTab('prestige')}
            title="클릭하여 티어 등급 및 1:1 네트워크 통계 보기"
            className="flex-1 min-w-0 sm:flex-initial sm:shrink-0 flex items-center gap-1.5 sm:gap-2 text-left rounded-lg px-1 py-0.5 hover:bg-white/[0.06] transition-colors cursor-pointer overflow-hidden"
          >
            <TierEmblem
              tierOrLabel={rank.label}
              color={rank.color}
              size="sm"
              className="!w-6 !h-6 sm:!w-7 sm:!h-7"
            />
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <span className="text-[9px] sm:text-[11px] text-slate-400 font-medium leading-tight truncate">
                티어 등급
              </span>
              <span
                data-testid="hud-tier-rank"
                className="text-[11px] sm:text-sm md:text-base font-bold font-mono-numbers truncate leading-tight block"
                style={{ color: rank.color }}
              >
                {rank.label}
              </span>
            </div>
          </button>

          <button
            onClick={onDispatchClick}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-slate-950 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>운행 배차 +{formatMoneyCompact(clickReward)}</span>
          </button>
        </div>

        {/* Right Utilities */}
        <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 ui-glass rounded-xl p-1 shadow-xl shrink-0">
          <button
            data-testid="hud-save-slots-button"
            onClick={() => toggleTab('saves')}
            aria-label="저장 슬롯 및 내보내기/가져오기"
            title={
              hasLegacyInflatedCapital
                ? '저장 슬롯 · 자금 밸런스 조정 권장'
                : '저장 슬롯 (1~5) · 내보내기 / 가져오기 · 자금 조정'
            }
            className={`min-w-[32px] min-h-[34px] sm:min-w-0 sm:min-h-[34px] px-1.5 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
              activeModal === 'saves'
                ? 'bg-sky-500/20 text-white border-sky-400/45'
                : hasLegacyInflatedCapital
                ? 'bg-amber-500/10 text-amber-200 border-amber-400/45 hover:bg-amber-500/20'
                : 'text-slate-200 border-transparent hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Save className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${hasLegacyInflatedCapital ? 'text-amber-400' : 'text-sky-400'}`} />
            <span className="hidden md:inline">슬롯 {activeSlotIndex}</span>
          </button>
          {onToggleTutorial && (
            <button
              data-testid="hud-tutorial-button"
              onClick={onToggleTutorial}
              aria-label="초보자 가이드"
              title="플레이 튜토리얼 보기"
              className={`min-w-[32px] min-h-[34px] sm:min-w-[34px] sm:min-h-[34px] p-1 sm:p-1.5 rounded-lg flex items-center justify-center transition-colors cursor-pointer border ${
                tutorialOpen
                  ? 'bg-sky-500/20 text-white border-sky-400/45'
                  : 'text-slate-300 border-transparent hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <HelpCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            </button>
          )}
          <button
            onClick={onOpenCityReset}
            aria-label="메인 메뉴 · 시작 도시 변경"
            title="메인 메뉴 및 시작 도시 변경"
            className="min-w-[32px] min-h-[34px] sm:min-w-0 sm:min-h-[34px] px-1.5 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/[0.06] flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            <span className="hidden lg:inline">메인 메뉴</span>
          </button>
          <button
            onClick={onToggleSound}
            aria-label={gameState.settings.soundEnabled ? '음소거' : '사운드 켜기'}
            className="min-w-[32px] min-h-[34px] sm:min-w-[34px] sm:min-h-[34px] p-1 sm:p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer"
          >
            {gameState.settings.soundEnabled ? (
              <Volume2 className="w-4 h-4 text-sky-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Dispatch Click Floating Button */}
      {!activeModal && !hasMapBottomCard && (
        <button
          data-testid="mobile-dispatch-fab"
          onClick={onDispatchClick}
          className="sm:hidden fixed bottom-[76px] right-2.5 z-20 min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 active:scale-[0.98] text-slate-950 text-xs font-bold shadow-xl cursor-pointer"
        >
          <MousePointerClick className="w-4 h-4" />
          <span>배차 +{formatMoneyCompact(clickReward)}</span>
        </button>
      )}

      {/* BOTTOM ACTION DOCK (5 tabs — upgrades merged into Study Tree) */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none px-1.5 sm:px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] sm:pb-3 flex justify-center">
        <nav
          aria-label="주요 메뉴"
          className="pointer-events-auto w-full sm:w-auto grid grid-cols-5 sm:flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 ui-glass rounded-2xl shadow-2xl"
        >
          <button
            data-testid="dock-lines"
            onClick={() => toggleTab('lines')}
            className={`${dockBtnBase} ${activeModal === 'lines' ? dockBtnActive : dockBtnIdle}`}
          >
            <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="sm:hidden">지역</span>
            <span className="hidden sm:inline">지역 현황</span>
          </button>

          <button
            data-testid="dock-skills"
            onClick={() => toggleTab('skills')}
            className={`${dockBtnBase} ${activeModal === 'skills' ? dockBtnActive : dockBtnIdle}`}
          >
            <TreeDeciduous className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="sm:hidden">연구</span>
            <span className="hidden sm:inline">연구 트리</span>
          </button>

          <button
            data-testid="dock-achievements"
            onClick={() => toggleTab('achievements')}
            className={`${dockBtnBase} ${
              activeModal === 'achievements' ? dockBtnActive : dockBtnIdle
            }`}
          >
            <Award className="w-4 h-4 text-yellow-400 shrink-0" />
            <span className="sm:hidden">업적</span>
            <span className="hidden sm:inline font-mono-numbers">
              업적 ({unlockedAchCount}/{gameState.achievements.length})
            </span>
          </button>

          <button
            data-testid="dock-arcade"
            onClick={() => toggleTab('arcade')}
            className={`${dockBtnBase} ${activeModal === 'arcade' ? dockBtnActive : dockBtnIdle}`}
          >
            <Gamepad2 className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="sm:hidden">타운</span>
            <span className="hidden sm:inline">
              {mgBoost.boostPct > 0 ? `타운 게임 (+${mgBoost.boostPct}%)` : '타운 게임'}
            </span>
          </button>

          <button
            data-testid="dock-prestige"
            onClick={() => toggleTab('prestige')}
            className={`${dockBtnBase} ${
              activeModal === 'prestige' ? dockBtnActive : dockBtnIdle
            }`}
          >
            <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="sm:hidden">확장</span>
            <span className="hidden sm:inline">세계 확장</span>
          </button>
        </nav>
      </footer>
    </>
  );
};

export const HUD = React.memo(HUDComponent);

