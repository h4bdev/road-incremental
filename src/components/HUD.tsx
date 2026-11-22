import React from 'react';
import {
  Award,
  Cloud,
  Gamepad2,
  Globe,
  HelpCircle,
  MousePointerClick,
  RotateCcw,
  Route,
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
  isSignedIn: boolean;
  isSyncing?: boolean;
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
  isSignedIn,
  isSyncing = false,
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

  return (
    <>
      {/* TOP BAR */}
      <header className="fixed top-0 left-0 right-0 z-30 pointer-events-none px-1.5 pt-1.5 sm:p-3 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Core Metrics */}
        <div className="pointer-events-auto flex-1 sm:flex-initial flex items-center justify-between sm:justify-start gap-2 sm:gap-4 bg-slate-950/95 border border-slate-800 rounded-xl px-2.5 sm:px-4 py-1.5 sm:py-2 shadow-xl min-w-0">
          <div className="flex flex-col min-w-0 shrink-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
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
              className="text-[10px] sm:text-xs text-emerald-500 font-semibold font-mono-numbers leading-tight whitespace-nowrap"
            >
              {formatIncomeRateCompact(incomePerSec)}
            </span>
          </div>

          <div className="hidden sm:block w-px h-8 bg-slate-800 shrink-0" />

          <div className="hidden sm:flex flex-col shrink-0">
            <span className="text-[11px] text-slate-400 font-medium">1:1 네트워크</span>
            <div className="flex items-baseline gap-1.5 font-mono-numbers">
              <span className="text-sm md:text-base font-bold text-sky-400 tabular-nums">
                {gameState.stats.mapped1to1Km.toLocaleString()} km
              </span>
            </div>
          </div>

          <div className="w-px h-7 sm:h-8 bg-slate-800 shrink-0" />

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
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

          <div className="w-px h-7 sm:h-8 bg-slate-800 shrink-0" />

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              티어 등급
            </span>
            <span
              data-testid="hud-tier-rank"
              className="text-xs sm:text-sm md:text-base font-bold font-mono-numbers whitespace-nowrap"
              style={{ color: rank.color }}
            >
              {rank.label}
            </span>
          </div>

          <button
            onClick={onDispatchClick}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>운행 배차 +{formatMoneyCompact(clickReward)}</span>
          </button>
        </div>

        {/* Right Utilities */}
        <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 bg-slate-950/95 border border-slate-800 rounded-xl p-1 shadow-xl shrink-0">
          <button
            data-testid="hud-save-slots-button"
            onClick={() => toggleTab('saves')}
            aria-label="저장 슬롯 및 계정"
            title="저장 슬롯 (1~5) · 자금 조정 · 클라우드 동기화"
            className={`relative min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'saves'
                ? 'bg-sky-600 text-white'
                : 'text-slate-200 hover:text-white hover:bg-slate-800'
            }`}
          >
            {isSignedIn ? (
              <Cloud className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isSyncing ? 'animate-pulse text-sky-300' : 'text-emerald-400'}`} />
            ) : (
              <Save className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            )}
            <span className="hidden md:inline">슬롯 {activeSlotIndex}</span>
            {hasLegacyInflatedCapital && (
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full bg-amber-400 absolute top-1 right-1"
              />
            )}
          </button>
          {onToggleTutorial && (
            <button
              data-testid="hud-tutorial-button"
              onClick={onToggleTutorial}
              aria-label="초보자 가이드"
              title="플레이 튜토리얼 보기"
              className={`min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 p-1.5 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                tutorialOpen
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <HelpCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            </button>
          )}
          <button
            onClick={onOpenCityReset}
            aria-label="메인 메뉴 · 시작 도시 변경"
            title="메인 메뉴 및 시작 도시 변경"
            className="min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            <span className="hidden lg:inline">메인 메뉴</span>
          </button>
          <button
            onClick={onToggleSound}
            aria-label={gameState.settings.soundEnabled ? '음소거' : '사운드 켜기'}
            className="min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
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
          className="sm:hidden fixed bottom-[76px] right-2.5 z-20 min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 active:scale-95 text-slate-950 text-xs font-bold shadow-xl cursor-pointer"
        >
          <MousePointerClick className="w-4 h-4" />
          <span>배차 +{formatMoneyCompact(clickReward)}</span>
        </button>
      )}

      {/* BOTTOM ACTION DOCK (5 tabs — upgrades merged into Study Tree) */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none px-1.5 sm:px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] sm:pb-3 flex justify-center">
        <nav
          aria-label="주요 메뉴"
          className="pointer-events-auto w-full sm:w-auto grid grid-cols-5 sm:flex items-center gap-0.5 sm:gap-1.5 p-1 sm:p-1.5 bg-slate-950/95 border border-slate-800 rounded-2xl shadow-2xl"
        >
          <button
            data-testid="dock-lines"
            onClick={() => toggleTab('lines')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'lines'
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Route className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="sm:hidden">노선</span>
            <span className="hidden sm:inline">노선 현황</span>
          </button>

          <button
            data-testid="dock-skills"
            onClick={() => toggleTab('skills')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'skills'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <TreeDeciduous className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="sm:hidden">연구</span>
            <span className="hidden sm:inline">연구 트리</span>
          </button>

          <button
            data-testid="dock-achievements"
            onClick={() => toggleTab('achievements')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'achievements'
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Award className="w-4 h-4 text-yellow-400 shrink-0" />
            <span className="sm:hidden">업적</span>
            <span className="hidden sm:inline">
              업적 ({unlockedAchCount}/{gameState.achievements.length})
            </span>
          </button>

          <button
            data-testid="dock-arcade"
            onClick={() => toggleTab('arcade')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'arcade'
                ? 'bg-amber-600 text-white'
                : 'text-amber-300 hover:bg-slate-800 hover:text-white'
            }`}
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
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'prestige'
                ? 'bg-indigo-600 text-white'
                : 'text-indigo-300 hover:bg-indigo-950/50 hover:text-white'
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

