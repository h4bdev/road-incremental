import React, { useState } from 'react';
import {
  Check,
  Cloud,
  CloudOff,
  CloudUpload,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { SAVE_SLOT_IDS, SaveSlotId, SaveSlotSummary, slotIndexFromId } from '../game/saveSlots';
import { formatMoneyCompact } from '../game/format';

export interface AccountViewInfo {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface SaveSlotsModalProps {
  onClose: () => void;
  account: AccountViewInfo | null;
  authLoading: boolean;
  isSyncing: boolean;
  syncError: string | null;
  lastCloudSyncAt: number | null;
  activeSlotId: SaveSlotId;
  slots: Record<SaveSlotId, SaveSlotSummary | null>;
  busySlotId: SaveSlotId | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefreshCloud: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onSaveToSlot: (slotId: SaveSlotId) => Promise<void>;
  onLoadSlot: (slotId: SaveSlotId) => Promise<void>;
  onRenameSlot: (slotId: SaveSlotId, newName: string) => Promise<void>;
  onDeleteSlot: (slotId: SaveSlotId) => Promise<void>;
  currentCapital?: number;
  recommendedCapital?: number;
  onAdjustCapital?: (nextCapital: number, clampLifetime?: boolean) => void;
}

export function formatSlotTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

export const SaveSlotsModal: React.FC<SaveSlotsModalProps> = ({
  onClose,
  account,
  authLoading,
  isSyncing,
  syncError,
  lastCloudSyncAt,
  activeSlotId,
  slots,
  busySlotId,
  onSignIn,
  onSignOut,
  onRefreshCloud,
  onSyncNow,
  onSaveToSlot,
  onLoadSlot,
  onRenameSlot,
  onDeleteSlot,
  currentCapital,
  recommendedCapital,
  onAdjustCapital,
}) => {
  const [editingSlot, setEditingSlot] = useState<SaveSlotId | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteSlot, setConfirmDeleteSlot] = useState<SaveSlotId | null>(null);
  const [confirmOverwriteSlot, setConfirmOverwriteSlot] = useState<SaveSlotId | null>(null);
  const [customCapValue, setCustomCapValue] = useState('10');
  const [customCapUnit, setCustomCapUnit] = useState<'1' | 'K' | 'M' | 'B' | 'T'>('K');
  const [capitalFeedback, setCapitalFeedback] = useState<string | null>(null);

  const beginRename = (slotId: SaveSlotId, currentName: string) => {
    setEditingSlot(slotId);
    setDraftName(currentName);
    setConfirmDeleteSlot(null);
    setConfirmOverwriteSlot(null);
  };

  const commitRename = async (slotId: SaveSlotId) => {
    const trimmed = draftName.trim();
    if (trimmed) {
      await onRenameSlot(slotId, trimmed);
    }
    setEditingSlot(null);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-label="계정 및 저장 슬롯 관리"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[88dvh] bg-[#0b1220] border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-950/70">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Save className="w-4 h-4 text-sky-400" />
              저장 슬롯 & 클라우드 계정 동기화
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              최대 5개 슬롯에 저장하고 Google 계정으로 어느 기기에서나 이어할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-4">
          {/* Account Card */}
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {authLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                계정 상태 확인 중...
              </div>
            ) : account ? (
              <>
                <div className="flex items-center gap-3 min-w-0">
                  {account.photoURL ? (
                    <img
                      src={account.photoURL}
                      alt={account.displayName}
                      className="w-10 h-10 rounded-full border border-slate-700 shrink-0 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-sky-600/30 border border-sky-500/40 flex items-center justify-center text-sm font-bold text-sky-300 shrink-0">
                      {account.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white truncate">
                        {account.displayName}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                        클라우드 연결
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{account.email}</div>
                    {lastCloudSyncAt && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        최근 동기화: {formatSlotTime(lastCloudSyncAt)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={onSyncNow}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSyncing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    지금 동기화
                  </button>
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={onRefreshCloud}
                    title="클라우드 목록 새로고침"
                    className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    로그아웃
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                    <CloudOff className="w-4 h-4 text-slate-400" />
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm font-semibold text-slate-200">
                      현재 로컬 브라우저에만 저장 중
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Google 로그인 시 5개 슬롯을 클라우드에 안전하게 백업하고 동기화합니다.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-4 h-4" />
                  Google 로그인
                </button>
              </>
            )}
          </div>

          {syncError && (
            <div className="rounded-lg bg-rose-950/60 border border-rose-500/40 px-3 py-2 text-xs text-rose-200">
              {syncError}
            </div>
          )}

          {typeof currentCapital === 'number' && onAdjustCapital && (
            <div
              data-testid="capital-balance-adjust-card"
              className={`rounded-xl border p-3.5 space-y-2.5 ${
                currentCapital >= 1e12
                  ? 'bg-amber-950/25 border-amber-500/50'
                  : 'bg-slate-900/80 border-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      자금 밸런스 조정
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      도로·연구·지역 진행도는 유지하고 보유 자금만 리셋하거나 원하는 금액으로 맞춥니다.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono-numbers font-bold text-emerald-400">
                  현재 {formatMoneyCompact(currentCapital)}
                </span>
              </div>

              {currentCapital >= 1e12 && (
                <div className="rounded-lg bg-amber-500/15 border border-amber-500/35 px-2.5 py-1.5 text-[11px] text-amber-200">
                  밸런스 패치 이전의 폭증 자금이 감지되었습니다. 아래 버튼으로 네트워크 규모에 맞게 조정하거나 초기화할 수 있습니다.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {typeof recommendedCapital === 'number' && (
                  <button
                    type="button"
                    data-testid="adjust-capital-recommended-btn"
                    onClick={() => {
                      onAdjustCapital(recommendedCapital, true);
                      setCapitalFeedback(
                        `현재 네트워크에 맞춰 ${formatMoneyCompact(recommendedCapital)}으로 조정했습니다.`
                      );
                    }}
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    네트워크 맞춤 조정 ({formatMoneyCompact(recommendedCapital)})
                  </button>
                )}
                <button
                  type="button"
                  data-testid="adjust-capital-reset-btn"
                  onClick={() => {
                    onAdjustCapital(1200, true);
                    setCapitalFeedback('보유 자금을 초기 자금($1,200)으로 리셋했습니다.');
                  }}
                  className="min-h-[34px] px-3 py-1 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  초기 자금 리셋 ($1,200)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] text-slate-400 mr-1">직접 입력:</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  data-testid="adjust-capital-custom-input"
                  value={customCapValue}
                  onChange={(e) => setCustomCapValue(e.target.value)}
                  className="w-24 min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono-numbers text-white focus:outline-none focus:border-sky-500"
                />
                <select
                  aria-label="자금 단위 선택"
                  data-testid="adjust-capital-unit-select"
                  value={customCapUnit}
                  onChange={(e) =>
                    setCustomCapUnit(e.target.value as '1' | 'K' | 'M' | 'B' | 'T')
                  }
                  className="min-h-[34px] px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono-numbers text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="1">$1 (원단위)</option>
                  <option value="K">K (천)</option>
                  <option value="M">M (백만)</option>
                  <option value="B">B (십억)</option>
                  <option value="T">T (조)</option>
                </select>
                <button
                  type="button"
                  data-testid="adjust-capital-custom-apply"
                  onClick={() => {
                    const num = Number(customCapValue);
                    if (!Number.isFinite(num) || num < 0) return;
                    const mult =
                      customCapUnit === 'K'
                        ? 1e3
                        : customCapUnit === 'M'
                        ? 1e6
                        : customCapUnit === 'B'
                        ? 1e9
                        : customCapUnit === 'T'
                        ? 1e12
                        : 1;
                    const next = Math.floor(num * mult);
                    onAdjustCapital(next, next < currentCapital);
                    setCapitalFeedback(
                      `보유 자금을 ${formatMoneyCompact(next)}으로 설정했습니다.`
                    );
                  }}
                  className="min-h-[34px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  적용
                </button>
              </div>

              {capitalFeedback && (
                <div
                  data-testid="adjust-capital-feedback"
                  className="text-[11px] text-emerald-300 font-medium"
                >
                  {capitalFeedback}
                </div>
              )}
            </div>
          )}

          {/* 5 Save Slots */}
          <div className="space-y-2.5">
            {SAVE_SLOT_IDS.map((slotId) => {
              const summary = slots[slotId];
              const idx = slotIndexFromId(slotId);
              const isActive = activeSlotId === slotId;
              const isBusy = busySlotId === slotId;
              const isEditing = editingSlot === slotId;
              const confirmingDelete = confirmDeleteSlot === slotId;
              const confirmingOverwrite = confirmOverwriteSlot === slotId;

              return (
                <div
                  key={slotId}
                  data-testid={`save-slot-${slotId}`}
                  className={`rounded-xl border p-3 sm:p-3.5 transition-colors ${
                    isActive
                      ? 'bg-sky-950/25 border-sky-500/60'
                      : 'bg-slate-900/75 border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                          슬롯 {idx}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40">
                            현재 플레이 중
                          </span>
                        )}
                        {summary && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                              summary.source === 'synced'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : summary.source === 'cloud' || summary.hasNewerCloud
                                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {summary.source === 'local' ? (
                              <HardDrive className="w-3 h-3" />
                            ) : (
                              <Cloud className="w-3 h-3" />
                            )}
                            {summary.source === 'synced'
                              ? '동기화됨'
                              : summary.hasNewerCloud
                              ? '클라우드 최신본'
                              : summary.source === 'cloud'
                              ? '클라우드 저장'
                              : '로컬 저장'}
                          </span>
                        )}
                      </div>

                      {summary ? (
                        <div className="mt-1.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 max-w-xs">
                              <input
                                type="text"
                                value={draftName}
                                maxLength={40}
                                onChange={(e) => setDraftName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename(slotId);
                                  if (e.key === 'Escape') setEditingSlot(null);
                                }}
                                autoFocus
                                className="flex-1 min-h-[32px] px-2 py-1 rounded bg-slate-950 border border-sky-500 text-xs text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void commitRename(slotId)}
                                className="min-h-[32px] px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-white truncate">
                                {summary.slotName}
                              </span>
                              <button
                                type="button"
                                onClick={() => beginRename(slotId, summary.slotName)}
                                aria-label="슬롯 이름 변경"
                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <div className="text-xs text-slate-300 font-mono-numbers mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                            <span>{summary.cityName}</span>
                            <span>·</span>
                            <span className="text-sky-400">{summary.mapped1to1Km.toLocaleString()} km</span>
                            <span>·</span>
                            <span className="text-indigo-300">
                              노드 {summary.connectedOsmNodes.toLocaleString()}
                            </span>
                            <span>·</span>
                            <span className="text-emerald-400">
                              {formatMoneyCompact(summary.capital)}
                            </span>
                            <span className="text-slate-500">
                              ({formatSlotTime(summary.clientSavedAt)})
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1.5 text-xs text-slate-500">
                          빈 슬롯 — 현재 진행 중인 게임을 여기에 저장할 수 있습니다.
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {summary && !isActive && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onLoadSlot(slotId)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          불러오기
                        </button>
                      )}

                      {summary && isActive && summary.hasNewerCloud && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onLoadSlot(slotId)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Cloud className="w-3.5 h-3.5" />
                          )}
                          클라우드 덮어쓰기 받기
                        </button>
                      )}

                      {confirmingOverwrite ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setConfirmOverwriteSlot(null);
                              await onSaveToSlot(slotId);
                            }}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
                          >
                            덮어쓰기 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmOverwriteSlot(null)}
                            className="min-h-[36px] px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            if (summary && !isActive) {
                              setConfirmOverwriteSlot(slotId);
                              setConfirmDeleteSlot(null);
                            } else {
                              void onSaveToSlot(slotId);
                            }
                          }}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          {isBusy && !summary ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          {isActive ? '지금 저장' : summary ? '여기에 저장' : '새로 저장'}
                        </button>
                      )}

                      {summary &&
                        (confirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                setConfirmDeleteSlot(null);
                                await onDeleteSlot(slotId);
                              }}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                            >
                              삭제 확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSlot(null)}
                              className="min-h-[36px] px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmDeleteSlot(slotId);
                              setConfirmOverwriteSlot(null);
                            }}
                            aria-label={`슬롯 ${idx} 삭제`}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-300 text-slate-400 text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
