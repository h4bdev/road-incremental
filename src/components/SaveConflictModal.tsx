import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Coins,
  HardDrive,
  Loader2,
  MapPin,
  Route,
  X,
} from 'lucide-react';
import { formatMoneyCompact } from '../game/format';
import { SaveSlotId, SaveSlotSummary } from '../game/saveSlots';
import { formatSlotTime } from './SaveSlotsModal';

export interface SaveConflictModalProps {
  slotId: SaveSlotId;
  localSummary: SaveSlotSummary | null;
  cloudSummary: SaveSlotSummary | null;
  onChooseLocal: () => Promise<void>;
  onChooseCloud: () => Promise<void>;
  onClose: () => void;
  isBusy?: boolean;
  errorMessage?: string | null;
}

function formatExactDate(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '기록 없음';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${y}.${m}.${day} ${h}:${min}:${sec}`;
}

export const SaveConflictModal: React.FC<SaveConflictModalProps> = ({
  slotId,
  localSummary,
  cloudSummary,
  onChooseLocal,
  onChooseCloud,
  onClose,
  isBusy = false,
  errorMessage = null,
}) => {
  const slotNum = slotId.replace('slot_', '');

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isBusy, onClose]);

  const isLocalNewer =
    (localSummary?.clientSavedAt || 0) > (cloudSummary?.clientSavedAt || 0);
  const isCloudNewer =
    (cloudSummary?.clientSavedAt || 0) > (localSummary?.clientSavedAt || 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      data-testid="save-conflict-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-2xl bg-[#0b1220] border border-amber-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-4 sm:px-5 py-4 border-b border-amber-500/30 bg-amber-950/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2
                id="conflict-dialog-title"
                className="text-base sm:text-lg font-bold text-white flex items-center gap-2"
              >
                저장 데이터 충돌 감지 · 슬롯 {slotNum}
              </h2>
              <p className="text-xs text-amber-200/80 mt-0.5">
                로컬 저장본과 클라우드 저장본의 내용이 서로 다릅니다. 어느 데이터를 유지할지 선택하세요.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="닫기"
            className="min-w-[36px] min-h-[36px] rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content Comparison */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Card 1: Local */}
            <div
              className={`rounded-xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${
                isLocalNewer
                  ? 'bg-sky-950/30 border-sky-500/60 shadow-lg shadow-sky-950/50'
                  : 'bg-slate-900/80 border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
                      <HardDrive className="w-4 h-4 text-sky-400" />
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-white">
                      로컬 저장본 (이 기기)
                    </span>
                  </div>
                  {isLocalNewer ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      최신 저장본
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      이전 저장본
                    </span>
                  )}
                </div>

                {localSummary ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-sky-400" /> 도시
                      </span>
                      <span className="font-semibold text-white">
                        {localSummary.cityName}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Route className="w-3.5 h-3.5 text-indigo-400" /> 연결 노드
                      </span>
                      <span className="font-bold text-indigo-300 font-mono-numbers">
                        {localSummary.connectedOsmNodes.toLocaleString()}개 ({localSummary.mapped1to1Km.toLocaleString()} km)
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-emerald-400" /> 보유 자금
                      </span>
                      <span className="font-bold text-emerald-400 font-mono-numbers">
                        {formatMoneyCompact(localSummary.capital)}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-0.5">
                      <div>
                        저장 시각: <span className="text-slate-200 font-medium">{formatExactDate(localSummary.clientSavedAt)}</span>
                      </div>
                      <div className="text-slate-500">
                        상태: {formatSlotTime(localSummary.clientSavedAt)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-slate-500 italic py-6 text-center">
                    로컬에 저장된 데이터가 없습니다.
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid="conflict-choose-local"
                disabled={isBusy || !localSummary}
                onClick={onChooseLocal}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-[0.98]"
              >
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4 shrink-0" />
                )}
                <span>로컬 선택 → 클라우드에 덮어쓰기 저장</span>
              </button>
            </div>

            {/* Card 2: Cloud */}
            <div
              className={`rounded-xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${
                isCloudNewer
                  ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-950/50'
                  : 'bg-slate-900/80 border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                      <Cloud className="w-4 h-4 text-indigo-400" />
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-white">
                      클라우드 저장본 (Google Cloud)
                    </span>
                  </div>
                  {isCloudNewer ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      최신 저장본
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      이전 저장본
                    </span>
                  )}
                </div>

                {cloudSummary ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-sky-400" /> 도시
                      </span>
                      <span className="font-semibold text-white">
                        {cloudSummary.cityName}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Route className="w-3.5 h-3.5 text-indigo-400" /> 연결 노드
                      </span>
                      <span className="font-bold text-indigo-300 font-mono-numbers">
                        {cloudSummary.connectedOsmNodes.toLocaleString()}개 ({cloudSummary.mapped1to1Km.toLocaleString()} km)
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-emerald-400" /> 보유 자금
                      </span>
                      <span className="font-bold text-emerald-400 font-mono-numbers">
                        {formatMoneyCompact(cloudSummary.capital)}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-0.5">
                      <div>
                        저장 시각: <span className="text-slate-200 font-medium">{formatExactDate(cloudSummary.clientSavedAt)}</span>
                      </div>
                      <div className="text-slate-500">
                        상태: {formatSlotTime(cloudSummary.clientSavedAt)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-slate-500 italic py-6 text-center">
                    클라우드에 저장된 데이터가 없습니다.
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid="conflict-choose-cloud"
                disabled={isBusy || !cloudSummary}
                onClick={onChooseCloud}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-[0.98]"
              >
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4 shrink-0" />
                )}
                <span>클라우드 선택 → 로컬에 덮어쓰기 불러오기</span>
              </button>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl bg-rose-950/70 border border-rose-500/50 px-3.5 py-2.5 text-xs text-rose-200"
            >
              {errorMessage}
            </div>
          )}

          <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 text-[11px] text-slate-400 flex items-start gap-2">
            <span className="font-bold text-amber-400 shrink-0">안내:</span>
            <span>
              선택한 저장본이 기준이 되며, 반대편 저장소(클라우드 또는 로컬)의 데이터가 선택한 버전으로 통일되어 저장됩니다. 계속하기 전에 도시·연결 노드·자금을 확인하세요.
            </span>
          </div>
        </div>

        {/* Footer */}
        <footer className="px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[38px] px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer transition-colors"
          >
            취소 (나중에 결정)
          </button>
        </footer>
      </div>
    </div>
  );
};
