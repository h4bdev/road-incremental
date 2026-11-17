import React, { useEffect, useState } from 'react';
import { Globe, MapPin, Play, Search, TrainTrack, Loader2 } from 'lucide-react';
import { StartingCity } from '../game/types';
import { PRESET_CITIES } from '../game/worldCatalog';
import { searchCityNominatim } from '../game/osmService';

interface TitleScreenProps {
  onStartWithCity: (city: StartingCity) => Promise<void>;
  hasSavedGame: boolean;
  onResumeSavedGame: () => void;
  savedCityName?: string;
  savedKm?: number;
  savedCapital?: number;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onStartWithCity,
  hasSavedGame,
  onResumeSavedGame,
  savedCityName,
  savedKm,
  savedCapital,
}) => {
  const [selectedCity, setSelectedCity] = useState<StartingCity>(PRESET_CITIES[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StartingCity[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const handleLaunch = async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await onStartWithCity(selectedCity);
    } finally {
      setIsStarting(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      if (hasSavedGame) {
        onResumeSavedGame();
      } else {
        onStartWithCity(PRESET_CITIES[0]);
      }
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not hijack Enter if typing in the city search box
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (hasSavedGame) {
          onResumeSavedGame();
        } else {
          handleLaunch();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasSavedGame, selectedCity]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    const results = await searchCityNominatim(searchQuery);
    setIsSearching(false);
    if (results.length === 0) {
      setSearchError('검색 결과가 없습니다. 도시 이름(예: 대전, 수원, Osaka, Munich)을 입력해 보세요.');
    } else {
      setSearchResults(results);
      setSelectedCity(results[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start sm:justify-between px-3 py-3 sm:p-8 bg-[#090d16] text-slate-100 overflow-y-auto">
      <div className="w-full max-w-4xl flex flex-col items-center sm:my-auto py-1 sm:py-4">
        {/* Emblem */}
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center mb-2.5 sm:mb-4">
          <svg
            className="w-7 h-7 sm:w-9 sm:h-9 text-sky-400"
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

        <h1 className="text-2xl sm:text-3xl md:text-5xl font-extrabold tracking-tight text-white font-heading text-center">
          Terra<span className="text-sky-400">Line</span>
        </h1>
        <p className="text-slate-300 text-xs sm:text-sm md:text-base text-center max-w-xl mt-1.5 sm:mt-2 mb-3.5 sm:mb-6 leading-relaxed">
          1:1 실제 세계 지도 위에서 정해진 도로와 철도 노선을 연결하고, 스킬 트리로 수천만 킬로미터의 글로벌 네트워크를 완성하는 인크리멘탈 방치형 게임.
        </p>

        {/* Resume Saved Game Banner if exists */}
        {hasSavedGame && (
          <div className="w-full max-w-2xl mb-3.5 sm:mb-5 p-3 sm:p-4 rounded-xl bg-slate-900 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
            <div className="text-left">
              <div className="text-xs text-emerald-400 font-semibold">저장된 네트워크 이어하기</div>
              <div className="text-xs sm:text-sm text-slate-200 font-mono-numbers mt-0.5">
                {savedCityName} · {savedKm?.toLocaleString()} km 연결 · 보유 자금 ${Math.floor(savedCapital || 0).toLocaleString()}
              </div>
            </div>
            <button
              data-start="true"
              onClick={onResumeSavedGame}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4 fill-current" />
              이어하기
            </button>
          </div>
        )}

        {/* Starting City Selector Box */}
        <div className="w-full max-w-3xl p-3.5 sm:p-5 rounded-2xl bg-[#101829] border border-slate-800 space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100">시작 도시·마을 선택</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                주요 대도시를 고르거나 전 세계 원하는 도시·마을 이름을 직접 검색해 시작할 수 있습니다.
              </p>
            </div>
            <div className="text-xs text-sky-400 font-medium whitespace-nowrap">
              선택됨: {selectedCity.name}
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
                    <span className="text-[10px] sm:text-[11px] text-slate-400 shrink-0">{city.country}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                    {city.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Custom OSM City Search */}
          <form onSubmit={handleSearch} className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row gap-2">
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
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4 text-sky-400" />}
              도시 찾기
            </button>
          </form>

          {searchError && (
            <div className="text-xs text-amber-400">{searchError}</div>
          )}

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
                노선 완성 업적 & 광역 네트워크
              </span>
            </div>

            <button
              data-start={hasSavedGame ? undefined : 'true'}
              disabled={isStarting}
              onClick={handleLaunch}
              className="w-full sm:w-auto min-h-[48px] px-7 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  1:1 지도 데이터 불러오는 중...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  {hasSavedGame ? `${selectedCity.name}에서 새로 시작` : `${selectedCity.name}에서 시작하기`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Flat Control Hint Footer */}
      <div className="text-slate-500 text-xs font-mono tracking-wide text-center pt-3 pb-[env(safe-area-inset-bottom)]">
        <span className="sm:hidden">지도를 두 손가락으로 확대 · 도로·철도 노드를 차례로 터치해 연결</span>
        <span className="hidden sm:inline">지도 드래그·확대로 세계 탐색 · 도로·철도 노드를 차례로 클릭해 연결 · Enter 또는 Space로 시작</span>
      </div>
    </div>
  );
};
