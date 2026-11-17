import React from 'react';
import { Globe, RotateCw, TrendingUp, X } from 'lucide-react';
import { GameState } from '../game/types';
import {
  calculateMultipliers,
  calculatePrestigeGain,
  GLOBAL_OSM_NODE_TARGET,
} from '../game/rules';

interface PrestigePanelProps {
  gameState: GameState;
  onClose: () => void;
  onExecutePrestige: () => void;
}

export const PrestigePanel: React.FC<PrestigePanelProps> = ({
  gameState,
  onClose,
  onExecutePrestige,
}) => {
  const TARGET_KM = 30_000_000;
  const kmProgress = Math.min(100, (gameState.stats.totalNetworkKm / TARGET_KM) * 100);
  const nodeProgress = Math.min(
    100,
    (gameState.stats.totalScaledNodes / GLOBAL_OSM_NODE_TARGET) * 100
  );
  const mults = calculateMultipliers(gameState);
  const gain = calculatePrestigeGain(gameState.totalLifetimeEarnings, mults.prestigeBonusMult);
  const nextMultiplier = Number((gameState.prestigeMultiplier + gain).toFixed(2));
  const canPrestige = gain > 0;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4 bg-black/65"
    >
      <div className="w-full max-w-2xl h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[82vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0d1424] border-t sm:border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Globe className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                세계 확장 & 글로벌 마스터 환생
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                수천 시간 여정 · 4억 5천만 OSM 노드와 3,000만 km 지구 교통망을 향해 확장하세요.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* 450,000,000 Global OSM Node Goal Progress */}
          <div className="p-3.5 sm:p-4 rounded-xl border border-indigo-500/30 bg-slate-900/60 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-indigo-200 font-semibold">
                전 세계 OSM 4억 5천만 노드 개척률
              </span>
              <span className="font-mono-numbers text-indigo-300 font-bold shrink-0">
                {nodeProgress.toFixed(4)}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${Math.max(1, nodeProgress)}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-1 text-xs font-mono-numbers text-slate-400">
              <span>스케일 노드: {gameState.stats.totalScaledNodes.toLocaleString()}</span>
              <span>연결 교차점: {gameState.stats.connectedOsmNodes.toLocaleString()}</span>
            </div>
          </div>

          {/* 30,000,000 km Global Goal Progress */}
          <div className="p-3.5 sm:p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300 font-semibold">
                지구 750바퀴 (30,000,000 km) 목표
              </span>
              <span className="font-mono-numbers text-sky-400 font-bold shrink-0">
                {kmProgress.toFixed(2)}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${Math.max(1, kmProgress)}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-1 text-xs font-mono-numbers text-slate-400">
              <span>총 네트워크: {gameState.stats.totalNetworkKm.toLocaleString()} km</span>
              <span>1:1 실측: {gameState.stats.mapped1to1Km.toLocaleString()} km</span>
            </div>
          </div>

          {/* Prestige Multiplier Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">현재 영구 배수</div>
              <div className="text-xl font-bold font-mono-numbers text-indigo-400 mt-1">
                ×{gameState.prestigeMultiplier.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                확장 횟수 {gameState.stats.prestigeCount}회
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">이번 회차 누적 수익</div>
              <div className="text-xl font-bold font-mono-numbers text-emerald-400 mt-1">
                ${Math.floor(gameState.totalLifetimeEarnings).toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">기준: $50,000 이상</div>
            </div>

            <div className="p-3.5 rounded-xl border border-indigo-500/40 bg-indigo-950/20">
              <div className="text-xs text-indigo-300">환생 후 영구 배수</div>
              <div className="text-xl font-bold font-mono-numbers text-white mt-1 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                ×{nextMultiplier.toFixed(2)}
              </div>
              <div className="text-[11px] text-indigo-300 mt-0.5">
                +{gain.toFixed(2)}x 추가 및 시작 +2 SP
              </div>
            </div>
          </div>

          {/* Explanation & Execute Button */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <h3 className="text-sm font-bold text-white">세계 확장(환생) 안내</h3>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>현재 건설된 OSM 도로·업그레이드·보유 자금이 초기화되고 초기 거점부터 새로 건설합니다.</li>
              <li>
                대신 영구 수익 배수(+{gain.toFixed(2)}x)와 회차당 기본 스킬 포인트(+2 SP)가 영구적으로 누적되어 수억 개 노드 개척 속도가 기하급수적으로 빨라집니다. (타운 미니게임 마일스톤 부스트 ×{mults.minigameIncomeMult.toFixed(2)}도 유지됩니다.)
              </li>
              <li>
                환생 실행은 이번 회차 누적 수익이{' '}
                <span className="font-mono-numbers text-emerald-400">$50,000</span> 이상일 때 활성화됩니다.
              </li>
            </ul>

            <button
              disabled={!canPrestige}
              onClick={onExecutePrestige}
              className={`w-full min-h-[48px] py-3 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                canPrestige
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <RotateCw className="w-4 h-4" />
              {canPrestige
                ? `글로벌 확장 실행 (+${gain.toFixed(2)}x 영구 배수 획득)`
                : `누적 수익 $50,000 달성 시 활성화 (현재 $${Math.floor(
                    gameState.totalLifetimeEarnings
                  ).toLocaleString()})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

