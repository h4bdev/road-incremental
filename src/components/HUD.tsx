import React from 'react';
import {
  Award,
  Gamepad2,
  Globe,
  MousePointerClick,
  RotateCcw,
  Route,
  SlidersHorizontal,
  TreeDeciduous,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { GameState } from '../game/types';
import { calculateClickReward, calculateTotalIncomePerSec } from '../game/rules';
import { getMinigameIncomeBoost } from '../game/minigames';

export type ModalTab =
  | 'lines'
  | 'upgrades'
  | 'skills'
  | 'achievements'
  | 'arcade'
  | 'prestige'
  | null;

interface HUDProps {
  gameState: GameState;
  activeModal: ModalTab;
  hasMapBottomCard?: boolean;
  onSelectModal: (tab: ModalTab) => void;
  onDispatchClick: () => void;
  onToggleSound: () => void;
  onOpenCityReset: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  gameState,
  activeModal,
  hasMapBottomCard = false,
  onSelectModal,
  onDispatchClick,
  onToggleSound,
  onOpenCityReset,
}) => {
  const incomePerSec = calculateTotalIncomePerSec(gameState);
  const clickReward = calculateClickReward(gameState);
  const unlockedAchCount = gameState.achievements.filter((a) => a.unlocked).length;
  const mgBoost = getMinigameIncomeBoost(gameState.minigames);

  const toggleTab = (tab: Exclude<ModalTab, null>) => {
    onSelectModal(activeModal === tab ? null : tab);
  };

  return (
    <>
      {/* TOP BAR */}
      <header className="fixed top-0 left-0 right-0 z-30 pointer-events-none px-1.5 pt-1.5 sm:p-3 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Core Metrics */}
        <div className="pointer-events-auto flex-1 sm:flex-initial flex items-center justify-between sm:justify-start gap-2 sm:gap-4 bg-slate-950/95 border border-slate-800 rounded-xl px-2.5 sm:px-4 py-1.5 sm:py-2 shadow-xl min-w-0">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              보유 자금
            </span>
            <div className="flex items-baseline gap-1 font-mono-numbers">
              <span className="text-xs sm:text-base md:text-lg font-bold text-emerald-400 truncate">
                ${Math.floor(gameState.capital).toLocaleString()}
              </span>
              <span className="text-[10px] sm:text-xs text-emerald-500 font-semibold shrink-0">
                +${incomePerSec.toLocaleString()}/s
              </span>
            </div>
          </div>

          <div className="hidden sm:block w-px h-7 bg-slate-800 shrink-0" />

          <div className="hidden sm:flex flex-col shrink-0">
            <span className="text-[11px] text-slate-400 font-medium">네트워크</span>
            <div className="flex items-baseline gap-1.5 font-mono-numbers">
              <span className="text-sm md:text-base font-bold text-sky-400">
                {gameState.stats.totalNetworkKm.toLocaleString()} km
              </span>
              <span className="hidden lg:inline text-[11px] text-slate-400">
                (실측 {gameState.stats.mapped1to1Km.toLocaleString()} km)
              </span>
            </div>
          </div>

          <div className="w-px h-6 sm:h-7 bg-slate-800 shrink-0" />

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              연결 노드
            </span>
            <div className="flex items-baseline gap-1 font-mono-numbers">
              <span className="text-xs sm:text-sm md:text-base font-bold text-indigo-300">
                {gameState.stats.totalScaledNodes.toLocaleString()}
              </span>
              <span className="hidden md:inline text-[11px] text-slate-400">
                (실측 {gameState.stats.connectedOsmNodes} / 4.5억)
              </span>
            </div>
          </div>

          <div className="w-px h-6 sm:h-7 bg-slate-800 shrink-0" />

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
              SP
            </span>
            <span className="text-xs sm:text-sm md:text-base font-bold font-mono-numbers text-amber-400">
              {gameState.skillPoints} SP
            </span>
          </div>

          <button
            onClick={onDispatchClick}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>운행 배차 +${clickReward.toLocaleString()}</span>
          </button>
        </div>

        {/* Right Utilities */}
        <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 bg-slate-950/95 border border-slate-800 rounded-xl p-1 shadow-xl shrink-0">
          <button
            onClick={onOpenCityReset}
            aria-label="시작 도시 변경"
            title="시작 도시 다시 선택"
            className="min-w-[38px] min-h-[38px] sm:min-w-0 sm:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400" />
            <span className="hidden md:inline">시작 도시 변경</span>
          </button>
          <button
            onClick={onToggleSound}
            aria-label={gameState.settings.soundEnabled ? '음소거' : '사운드 켜기'}
            className="min-w-[38px] min-h-[38px] sm:min-w-0 sm:min-h-0 p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            {gameState.settings.soundEnabled ? (
              <Volume2 className="w-4 h-4 text-sky-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Dispatch Click Floating Button (auto-hides when bottom card or modal is open to avoid overlap) */}
      {!activeModal && !hasMapBottomCard && (
        <button
          data-testid="mobile-dispatch-fab"
          onClick={onDispatchClick}
          className="sm:hidden fixed bottom-[76px] right-2.5 z-20 min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 active:scale-95 text-slate-950 text-xs font-bold shadow-xl cursor-pointer"
        >
          <MousePointerClick className="w-4 h-4" />
          <span>배차 +${clickReward.toLocaleString()}</span>
        </button>
      )}

      {/* BOTTOM ACTION DOCK */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none px-1.5 sm:px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] sm:pb-3 flex justify-center">
        <nav
          aria-label="주요 메뉴"
          className="pointer-events-auto w-full sm:w-auto grid grid-cols-6 sm:flex items-center gap-0.5 sm:gap-1.5 p-1 sm:p-1.5 bg-slate-950/95 border border-slate-800 rounded-2xl shadow-2xl"
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
            data-testid="dock-upgrades"
            onClick={() => toggleTab('upgrades')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'upgrades'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="sm:hidden">강화</span>
            <span className="hidden sm:inline">업그레이드</span>
          </button>

          <button
            data-testid="dock-skills"
            onClick={() => toggleTab('skills')}
            className={`min-h-[48px] sm:min-h-[38px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeModal === 'skills'
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <TreeDeciduous className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="sm:hidden">스킬</span>
            <span className="hidden sm:inline">스킬 트리</span>
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
