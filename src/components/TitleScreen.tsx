import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  CloudUpload,
  Globe,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  Play,
  RefreshCw,
  Search,
  TrainTrack,
  Trash2,
} from 'lucide-react';
import { StartingCity } from '../game/types';
import { PRESET_CITIES } from '../game/worldCatalog';
import { searchCityNominatim } from '../game/osmService';
import {
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  slotIndexFromId,
} from '../game/saveSlots';
import { AccountViewInfo, formatSlotTime } from './SaveSlotsModal';
import { formatMoneyCompact } from '../game/format';

interface TitleScreenProps {
  account: AccountViewInfo | null;
  authLoading: boolean;
  isSyncing: boolean;
  syncError: string | null;
  activeSlotId: SaveSlotId;
  slots: Record<SaveSlotId, SaveSlotSummary | null>;
  busySlotId: SaveSlotId | null;
  loadingProgress?: { active: boolean; percent: number; label: string } | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefreshCloud: () => Promise<void>;
  onStartWithCity: (city: StartingCity, slotId: SaveSlotId) => Promise<void>;
  onLoadSlot: (slotId: SaveSlotId) => Promise<void>;
  onResolveConflict?: (slotId: SaveSlotId) => void;
  onRenameSlot: (slotId: SaveSlotId, newName: string) => Promise<void>;
  onDeleteSlot: (slotId: SaveSlotId) => Promise<void>;
  onUploadLocalSlotToCloud: (slotId: SaveSlotId) => Promise<void>;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  account,
  authLoading,
  isSyncing,
  syncError,
  activeSlotId,
  slots,
  busySlotId,
  loadingProgress,
  onSignIn,
  onSignOut,
  onRefreshCloud,
  onStartWithCity,
  onLoadSlot,
  onResolveConflict,
  onRenameSlot,
  onDeleteSlot,
  onUploadLocalSlotToCloud,
}) => {
  const firstEmptySlot = useMemo(
    () => SAVE_SLOT_IDS.find((id) => !slots[id]) || activeSlotId,
    [slots, activeSlotId]
  );

  const [selectedCity, setSelectedCity] = useState<StartingCity>(PRESET_CITIES[0]);
  const [targetNewSlotId, setTargetNewSlotId] = useState<SaveSlotId>(firstEmptySlot);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StartingCity[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SaveSlotId | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteSlot, setConfirmDeleteSlot] = useState<SaveSlotId | null>(null);

  const savedSlotsList = useMemo(
    () => SAVE_SLOT_IDS.map((id) => slots[id]).filter((s): s is SaveSlotSummary => Boolean(s)),
    [slots]
  );
  const preferredResumeSlot = slots[activeSlotId] || savedSlotsList[0] || null;
  const hasAnySavedGame = savedSlotsList.length > 0;

  useEffect(() => {
    // Auto-point new game target to first empty slot if current target got filled externally
    if (slots[targetNewSlotId] && firstEmptySlot !== targetNewSlotId && !slots[firstEmptySlot]) {
      setTargetNewSlotId(firstEmptySlot);
    }
  }, [slots, firstEmptySlot, targetNewSlotId]);

  const handleLaunch = async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await onStartWithCity(selectedCity, targetNewSlotId);
    } finally {
      setIsStarting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (preferredResumeSlot) {
          void onLoadSlot(preferredResumeSlot.slotId);
        } else {
          void handleLaunch();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferredResumeSlot, selectedCity, targetNewSlotId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    const results = await searchCityNominatim(searchQuery);
    setIsSearching(false);
    if (results.length === 0) {
      setSearchError(
        '검색 결과가 없습니다. 도시 이름(예: 대전, 수원, Osaka, Munich)을 입력해 보세요.'
      );
    } else {
      setSearchResults(results);
      setSelectedCity(results[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start px-3 py-3 sm:p-6 bg-[#090d16] text-slate-100 overflow-y-auto">
      <div className="w-full max-w-4xl flex flex-col items-center py-1 sm:py-3">
        {/* Account & Cloud Sync Top Bar */}
        <div
          data-testid="title-account-bar"
          className="w-full mb-3 sm:mb-4 p-2.5 sm:px-4 sm:py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          {authLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              클라우드 계정 확인 중...
            </div>
          ) : account ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                {account.photoURL ? (
                  <img
                    src={account.photoURL}
                    alt={account.displayName}
                    className="w-8 h-8 rounded-full border border-slate-700 shrink-0 object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-sky-600/30 border border-sky-500/40 flex items-center justify-center text-xs font-bold text-sky-300 shrink-0">
                    {account.displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-bold text-white truncate">
                      {account.displayName}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                      클라우드 동기화 활성
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{account.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => void onRefreshCloud()}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  동기화 새로고침
                </button>
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  로그아웃
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <CloudOff className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-300">
                  Google 계정으로 로그인하면 5개 저장 슬롯의 진척도가 클라우드에 자동 동기화됩니다.
                </span>
              </div>
              <button
                type="button"
                data-testid="google-login-button"
                onClick={() => void onSignIn()}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                Google 로그인
              </button>
            </>
          )}
        </div>

        {syncError && (
          <div className="w-full mb-3 rounded-lg bg-rose-950/60 border border-rose-500/40 px-3 py-2 text-xs text-rose-200">
            {syncError}
          </div>
        )}

        {/* Emblem + Brand */}
        <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center mb-2 sm:mb-3">
          <svg
            className="w-6 h-6 sm:w-8 sm:h-8 text-sky-400"
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="32" cy="32" r="26" strokeOpacity="0.45" />
            <ellipse cx="32" cy="32" rx="13" ry="26" strokeOpacity="0.55" />
            <line x1="6" y1="32" x2="58" y2="32" strokeOpacity="0.55" />
            <circle cx="20" cy="24" r="3" fill="#f59e0b" stroke="none" />
            <circle cx="44" cy="38" r="3" fill="#38bdf8" stroke="none" />
            <path d="M20 24 Q32 16 44 38" stroke="#38bdf8" strokeWidth="3" strokeDasharray="4 3" />
          </svg>
        </div>

        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white font-heading text-center">
          Road <span className="text-sky-400">Incremental</span>
        </h1>
        <p className="text-slate-300 text-xs sm:text-sm text-center max-w-xl mt-1.5 mb-3.5 sm:mb-5 leading-relaxed">
          1:1 실제 세계 지도 위에서 도로와 철도 노드를 연결하고, 자금을 모아 광역 행정구역을 개척하며 세계 교통망을 넓혀가는 인크리멘탈 게임.
        </p>

        {/* 5 Save Slots Box */}
        <div
          data-testid="title-save-slots"
          className="w-full max-w-3xl mb-3.5 sm:mb-4 p-3 sm:p-4 rounded-2xl bg-[#101829] border border-slate-800 space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100">
                저장 슬롯 ({savedSlotsList.length}/5 사용 중)
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                저장된 슬롯을 이어하거나, 새 도시를 시작할 슬롯 번호를 선택하세요.
              </p>
            </div>
            {preferredResumeSlot && (
              <button
                type="button"
                data-start="true"
                disabled={busySlotId === preferredResumeSlot.slotId}
                onClick={() => void onLoadSlot(preferredResumeSlot.slotId)}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap tabular-nums"
              >
                {busySlotId === preferredResumeSlot.slotId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {loadingProgress?.active
                      ? `${loadingProgress.label} · ${loadingProgress.percent}%`
                      : `슬롯 ${preferredResumeSlot.slotIndex} 불러오는 중...`}
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    최근 슬롯 {preferredResumeSlot.slotIndex} 바로 이어하기
                  </>
                )}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SAVE_SLOT_IDS.map((slotId) => {
              const summary = slots[slotId];
              const idx = slotIndexFromId(slotId);
              const isSelectedTarget = targetNewSlotId === slotId;
              const isBusy = busySlotId === slotId;
              const isEditing = editingSlot === slotId;
              const confirmingDelete = confirmDeleteSlot === slotId;

              return (
                <div
                  key={slotId}
                  data-testid={`title-slot-${slotId}`}
                  onClick={() => setTargetNewSlotId(slotId)}
                  className={`rounded-xl border p-2.5 transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                    summary?.hasConflict
                      ? 'bg-amber-950/20 border-amber-500/70'
                      : isSelectedTarget
                      ? 'bg-sky-500/10 border-sky-400/70'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                        슬롯 {idx}
                        {isSelectedTarget && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                            선택됨
                          </span>
                        )}
                      </span>
                      {summary && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${
                            summary.hasConflict
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                              : summary.source === 'synced'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : summary.source === 'cloud' || summary.hasNewerCloud
                              ? 'bg-indigo-500/15 text-indigo-300'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {summary.hasConflict ? (
                            <AlertTriangle className="w-2.5 h-2.5" />
                          ) : summary.source === 'local' ? (
                            <HardDrive className="w-2.5 h-2.5" />
                          ) : (
                            <Cloud className="w-2.5 h-2.5" />
                          )}
                          {summary.hasConflict
                            ? '충돌 · 선택'
                            : summary.source === 'synced'
                            ? '동기화'
                            : summary.hasNewerCloud
                            ? '클라우드 최신'
                            : summary.source === 'cloud'
                            ? '클라우드'
                            : '로컬'}
                        </span>
                      )}
                    </div>

                    {summary ? (
                      <div className="mt-1">
                        {isEditing ? (
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={draftName}
                              maxLength={40}
                              onChange={(e) => setDraftName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const trimmed = draftName.trim();
                                  if (trimmed) void onRenameSlot(slotId, trimmed);
                                  setEditingSlot(null);
                                }
                                if (e.key === 'Escape') setEditingSlot(null);
                              }}
                              autoFocus
                              className="flex-1 min-w-0 min-h-[28px] px-2 py-0.5 rounded bg-slate-950 border border-sky-500 text-xs text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const trimmed = draftName.trim();
                                if (trimmed) void onRenameSlot(slotId, trimmed);
                                setEditingSlot(null);
                              }}
                              className="min-h-[28px] px-2 rounded bg-emerald-600 text-white cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-white truncate">
                              {summary.slotName}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSlot(slotId);
                                setDraftName(summary.slotName);
                              }}
                              aria-label="슬롯 이름 변경"
                              className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <div className="text-[11px] text-slate-300 font-mono-numbers mt-0.5 truncate">
                          {summary.cityName} · {summary.mapped1to1Km.toLocaleString()}km ·{' '}
                          {formatMoneyCompact(summary.capital)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          노드 {summary.connectedOsmNodes.toLocaleString()} · {summary.tierLabel} ·{' '}
                          {formatSlotTime(summary.clientSavedAt)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-slate-500">빈 슬롯</div>
                    )}
                  </div>

                  {summary && (
                    <div
                      className="flex items-center gap-1 pt-1 border-t border-slate-800/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {summary.hasConflict ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            if (onResolveConflict) {
                              onResolveConflict(slotId);
                            } else {
                              void onLoadSlot(slotId);
                            }
                          }}
                          className="flex-1 min-h-[32px] px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>충돌 해결</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void onLoadSlot(slotId)}
                            className="flex-1 min-h-[32px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer tabular-nums"
                          >
                            {isBusy ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>
                                  {loadingProgress?.active ? `${loadingProgress.percent}%` : '불러오는 중'}
                                </span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-current" />
                                <span>이어하기</span>
                              </>
                            )}
                          </button>

                          {account && summary.hasNewerLocal && (
                            <button
                              type="button"
                              disabled={isBusy}
                              title="로컬 저장본을 클라우드에 업로드"
                              onClick={() => void onUploadLocalSlotToCloud(slotId)}
                              className="min-h-[32px] px-2 py-1 rounded-lg bg-sky-600/80 hover:bg-sky-500 text-white text-[11px] flex items-center justify-center cursor-pointer"
                            >
                              <CloudUpload className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}

                      {confirmingDelete ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmDeleteSlot(null);
                              void onDeleteSlot(slotId);
                            }}
                            className="min-h-[32px] px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer"
                          >
                            확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSlot(null)}
                            className="min-h-[32px] px-1.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] cursor-pointer"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteSlot(slotId)}
                          aria-label={`슬롯 ${idx} 삭제`}
                          className="min-h-[32px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-300 text-slate-400 text-[11px] flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Starting City Selector Box */}
        <div className="w-full max-w-3xl p-3.5 sm:p-5 rounded-2xl bg-[#101829] border border-slate-800 space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100">시작 도시·마을 선택</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                주요 대도시를 고르거나 전 세계 원하는 도시·마을 이름을 직접 검색해{' '}
                <strong className="text-sky-300">슬롯 {slotIndexFromId(targetNewSlotId)}</strong>에 새 게임을 시작할 수 있습니다.
              </p>
            </div>
            <div className="text-xs text-sky-400 font-medium whitespace-nowrap">
              선택됨: {selectedCity.name} → 슬롯 {slotIndexFromId(targetNewSlotId)}
            </div>
          </div>

          {/* Preset Cities Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
            {PRESET_CITIES.map((city) => {
              const active = selectedCity.id === city.id;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => setSelectedCity(city)}
                  className={`min-h-[60px] sm:min-h-[68px] p-2.5 sm:p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-sky-500/15 border-sky-400 text-white'
                      : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-xs sm:text-sm truncate">{city.name}</span>
                    <span className="text-[10px] sm:text-[11px] text-slate-400 shrink-0">
                      {city.country}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                    {city.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Custom OSM City Search */}
          <form
            onSubmit={handleSearch}
            className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="도시·마을 검색 (예: 대전, 제주시, Munich)..."
                aria-label="시작 도시 검색"
                className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MapPin className="w-4 h-4 text-sky-400" />
              )}
              도시 찾기
            </button>
          </form>

          {searchError && <div className="text-xs text-amber-400">{searchError}</div>}

          {searchResults.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-slate-400">OpenStreetMap 검색 결과:</div>
              <div className="flex flex-wrap gap-2">
                {searchResults.map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => setSelectedCity(res)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      selectedCity.id === res.id
                        ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {res.name} · {res.country}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Start New Network Button */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-400 flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                실제 1:1 OSM 좌표
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <TrainTrack className="w-3.5 h-3.5 text-amber-400" />
                1:1 실측 도로·철도 & 연구 트리
              </span>
            </div>

            <button
              data-start={hasAnySavedGame ? undefined : 'true'}
              disabled={isStarting}
              onClick={handleLaunch}
              className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap tabular-nums"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {loadingProgress?.active
                    ? `${loadingProgress.label} · ${loadingProgress.percent}%`
                    : '1:1 지도 준비 중...'}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  {slots[targetNewSlotId]
                    ? `슬롯 ${slotIndexFromId(targetNewSlotId)} 덮어쓰고 ${selectedCity.name} 시작`
                    : `슬롯 ${slotIndexFromId(targetNewSlotId)}에 ${selectedCity.name} 시작`}
                </>
              )}
            </button>
          </div>
          {loadingProgress?.active && (isStarting || Boolean(busySlotId)) && (
            <div
              data-testid="title-loading-progress"
              className="w-full pt-1 space-y-1.5"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
                <span>{loadingProgress.label}</span>
                <span className="font-mono font-semibold text-sky-300">
                  {loadingProgress.percent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800/90 overflow-hidden">
                <div
                  className="h-full w-full origin-left bg-sky-400 transition-transform duration-200 ease-out"
                  style={{
                    transform: `scaleX(${Math.max(0.02, Math.min(1, loadingProgress.percent / 100))})`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Flat Control Hint Footer */}
      <div className="text-slate-500 text-xs font-mono tracking-wide text-center pt-3 pb-[env(safe-area-inset-bottom)]">
        <span className="sm:hidden">지도를 두 손가락으로 확대 · 도로·철도 노드를 차례로 터치해 연결</span>
        <span className="hidden sm:inline">
          지도 드래그·확대로 세계 탐색 · 도로·철도 노드를 차례로 클릭해 연결 · Enter 또는 Space로 시작
        </span>
      </div>
    </div>
  );
};
