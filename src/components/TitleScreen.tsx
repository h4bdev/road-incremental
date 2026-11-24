import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  Globe,
  HardDrive,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Search,
  TrainTrack,
  Trash2,
  X,
} from 'lucide-react';
import { StartingCity } from '../game/types';
import { PRESET_CITIES } from '../game/worldCatalog';
import { searchCityNominatim } from '../game/osmService';
import { searchLocalCityCatalog } from '../game/cityCatalog';
import {
  DecodedImportPreview,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  slotIndexFromId,
} from '../game/saveSlots';
import { formatSlotTime } from './SaveSlotsModal';
import { SaveTransferPanel } from './SaveTransferPanel';
import { formatMoneyCompact } from '../game/format';

interface TitleScreenProps {
  activeSlotId: SaveSlotId;
  slots: Record<SaveSlotId, SaveSlotSummary | null>;
  busySlotId: SaveSlotId | null;
  loadingProgress?: { active: boolean; percent: number; label: string } | null;
  onStartWithCity: (city: StartingCity, slotId: SaveSlotId) => Promise<void>;
  onLoadSlot: (slotId: SaveSlotId) => Promise<void>;
  onRenameSlot: (slotId: SaveSlotId, newName: string) => Promise<void>;
  onDeleteSlot: (slotId: SaveSlotId) => Promise<void>;
  onExportSlot: (slotId: SaveSlotId) => Promise<{
    code: string;
    summary: SaveSlotSummary;
    fileName: string;
  }>;
  onImportSave: (
    targetSlotId: SaveSlotId,
    preview: DecodedImportPreview,
    launchNow: boolean
  ) => Promise<void>;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  activeSlotId,
  slots,
  busySlotId,
  loadingProgress,
  onStartWithCity,
  onLoadSlot,
  onRenameSlot,
  onDeleteSlot,
  onExportSlot,
  onImportSave,
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
  const [transferModalOpen, setTransferModalOpen] = useState(false);

  const savedSlotsList = useMemo(
    () => SAVE_SLOT_IDS.map((id) => slots[id]).filter((s): s is SaveSlotSummary => Boolean(s)),
    [slots]
  );
  const preferredResumeSlot = slots[activeSlotId] || savedSlotsList[0] || null;
  const hasAnySavedGame = savedSlotsList.length > 0;

  useEffect(() => {
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
      if (document.activeElement?.tagName === 'TEXTAREA') return;
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

  const instantSuggestions = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 1) return [];
    return searchLocalCityCatalog(trimmed, 6);
  }, [searchQuery]);

  const executeSearch = async (queryText: string) => {
    const target = queryText.trim();
    if (!target) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      let results = await searchCityNominatim(target);
      if (results.length === 0) {
        results = searchLocalCityCatalog(target, 6);
      }
      if (results.length === 0) {
        setSearchError(
          `‘${target}’ 검색 결과가 없습니다. 아래 추천 도시를 선택하거나 다른 도시·마을 이름을 입력해 보세요.`
        );
      } else {
        setSearchResults(results);
        setSelectedCity(results[0]);
      }
    } catch {
      const fallbackResults = searchLocalCityCatalog(target, 6);
      if (fallbackResults.length > 0) {
        setSearchResults(fallbackResults);
        setSelectedCity(fallbackResults[0]);
      } else {
        setSearchError('도시 검색 중 오류가 발생했습니다. 아래 추천 도시를 선택해 보세요.');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSearch(searchQuery);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start px-3 py-3 sm:p-6 bg-[#090d16] text-slate-100 overflow-y-auto">
      <div className="w-full max-w-4xl flex flex-col items-center py-2 sm:py-4">
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
        <p className="text-slate-300 text-xs sm:text-sm text-center max-w-xl mt-1.5 mb-4 sm:mb-5 leading-relaxed">
          1:1 실제 세계 지도 위에서 도로와 철도 노드를 연결하고, 자금을 모아 광역 행정구역을 개척하며 세계 교통망을 넓혀가는 인크리멘탈 게임.
        </p>

        {/* 5 Local Save Slots Box */}
        <div
          data-testid="title-save-slots"
          className="w-full max-w-3xl mb-3.5 sm:mb-4 p-3 sm:p-4 rounded-2xl bg-[#101829] border border-slate-800 space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100">
                저장 슬롯 ({savedSlotsList.length}/5 사용 중)
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                로컬 슬롯을 바로 이어하거나, 세이브 코드·파일로 다른 기기 데이터를 가져올 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                data-testid="title-transfer-button"
                onClick={() => setTransferModalOpen(true)}
                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
                <span>세이브 가져오기 / 내보내기</span>
              </button>

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
                    isSelectedTarget
                      ? 'bg-sky-500/10 border-sky-400/70'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span>슬롯 {idx}</span>
                        {isSelectedTarget && (
                          <span className="text-sky-300 font-semibold">· 선택됨</span>
                        )}
                      </span>
                      {summary && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <HardDrive className="w-2.5 h-2.5" />
                          로컬
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
          <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
            <form
              onSubmit={handleSearch}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (searchError) setSearchError(null);
                  }}
                  placeholder="도시·마을 검색 (예: 대전, 수원, 제주시, Osaka, Munich)..."
                  aria-label="시작 도시 검색"
                  className="w-full min-h-[44px] pl-9 pr-9 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                      setSearchError(null);
                    }}
                    aria-label="검색어 지우기"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="min-h-[44px] px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>도시 검색 중...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 text-sky-200" />
                    <span>도시 찾기</span>
                  </>
                )}
              </button>
            </form>

            {/* Instant Suggestions when typing */}
            {searchQuery.trim().length >= 1 && searchResults.length === 0 && instantSuggestions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                  <span>실시간 도시 추천 (클릭 시 즉시 선택):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {instantSuggestions.map((sug) => {
                    const isSelected = selectedCity.id === sug.id;
                    return (
                      <button
                        key={sug.id}
                        type="button"
                        onClick={() => {
                          setSelectedCity(sug);
                          setSearchQuery(sug.name);
                          setSearchResults([sug]);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <MapPin className="w-3 h-3 text-sky-400" />
                        <span>{sug.name}</span>
                        <span className="text-[10px] text-slate-500">({sug.country})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error Message + Quick-Pick Chips */}
            {searchError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="text-xs text-amber-300">{searchError}</div>
                <div className="text-[11px] text-slate-400">추천 도시 바로 선택:</div>
                <div className="flex flex-wrap gap-1.5">
                  {['대전', '수원', '대구', '제주', '오사카', 'Munich', 'Berlin', 'San Francisco'].map(
                    (quickCity) => (
                      <button
                        key={quickCity}
                        type="button"
                        onClick={() => {
                          setSearchQuery(quickCity);
                          void executeSearch(quickCity);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-200 hover:border-sky-400 hover:text-white cursor-pointer transition-colors"
                      >
                        {quickCity}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Search Results List */}
            {searchResults.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>OpenStreetMap 검색 결과 ({searchResults.length}건):</span>
                  <span className="text-[11px] text-sky-400">원하는 도시를 클릭하여 선택하세요</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {searchResults.map((res) => {
                    const isSelected = selectedCity.id === res.id;
                    return (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => setSelectedCity(res)}
                        className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs sm:text-sm truncate">
                              {res.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                              {res.country}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            GPS {res.lat.toFixed(4)}°, {res.lng.toFixed(4)}°
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected Custom City Banner */}
            {selectedCity.isCustom && (
              <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4 text-sky-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{selectedCity.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/20 text-sky-300 font-semibold">
                        {selectedCity.country}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        GPS {selectedCity.lat.toFixed(4)}°, {selectedCity.lng.toFixed(4)}°
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">{selectedCity.description}</p>
                  </div>
                </div>
                <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1 shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  시작 도시로 지정됨
                </div>
              </div>
            )}
          </div>

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

      {/* Title Screen Export / Import Modal */}
      {transferModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs sm:p-4"
          onClick={() => setTransferModalOpen(false)}
        >
          <section
            role="dialog"
            data-testid="title-transfer-modal"
            aria-label="세이브 가져오기 및 내보내기"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl max-h-[88dvh] bg-[#0b1220] border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <header className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-950/70">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-sky-400" />
                  세이브 가져오기 · 내보내기
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  세이브 코드나 파일(.txt / .json)을 불러와 원하는 슬롯에 복원하거나 현재 슬롯을 백업합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTransferModalOpen(false)}
                aria-label="닫기"
                className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-4">
              <SaveTransferPanel
                slots={slots}
                defaultSlotId={activeSlotId}
                initialMode="import"
                isPlayingActiveSlot={false}
                onExportSlot={onExportSlot}
                onImportSave={async (targetSlotId, preview, launchNow) => {
                  await onImportSave(targetSlotId, preview, launchNow);
                  if (launchNow) {
                    setTransferModalOpen(false);
                  }
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
