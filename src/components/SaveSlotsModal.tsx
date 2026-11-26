import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  HardDrive,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DecodedImportPreview,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  slotIndexFromId,
} from '../game/saveSlots';
import { formatMoneyCompact } from '../game/format';
import { SaveTransferPanel } from './SaveTransferPanel';
import { ModalShell, SegmentedControl } from './ui/ModalShell';
import { TierEmblem } from './ui/TierEmblem';

interface SaveSlotsModalProps {
  onClose: () => void;
  activeSlotId: SaveSlotId;
  slots: Record<SaveSlotId, SaveSlotSummary | null>;
  busySlotId: SaveSlotId | null;
  onSaveToSlot: (slotId: SaveSlotId) => Promise<void>;
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
  activeSlotId,
  slots,
  busySlotId,
  onSaveToSlot,
  onLoadSlot,
  onRenameSlot,
  onDeleteSlot,
  onExportSlot,
  onImportSave,
  currentCapital,
  recommendedCapital,
  onAdjustCapital,
}) => {
  const [activeTab, setActiveTab] = useState<'slots' | 'transfer'>('slots');
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
    <ModalShell
      onClose={onClose}
      ariaLabel="저장 슬롯 및 세이브 내보내기/가져오기"
      maxWidthClass="sm:max-w-2xl"
      heightClass="max-h-[88dvh]"
      zIndexClass="z-[55]"
      backdropClassName="sm:p-4"
      icon={<Save className="w-4 h-4 text-sky-400" />}
      title="저장 관리 · Export / Import"
      subtitle="5개 로컬 슬롯에 즉시 저장하고, 세이브 코드나 파일로 손실 없이 백업·복원할 수 있습니다."
      subHeader={
        <div className="px-4 sm:px-5 py-2.5 border-b border-white/[0.07] bg-[#080d18]/60 shrink-0">
          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                id: 'slots',
                testId: 'saves-modal-tab-slots',
                label: (
                  <>
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>저장 슬롯 (1~5)</span>
                  </>
                ),
              },
              {
                id: 'transfer',
                testId: 'saves-modal-tab-transfer',
                label: (
                  <>
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>내보내기 · 가져오기</span>
                  </>
                ),
              },
            ]}
          />
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {activeTab === 'transfer' ? (
          <SaveTransferPanel
            slots={slots}
            defaultSlotId={activeSlotId}
            initialMode="export"
            isPlayingActiveSlot={true}
            onExportSlot={onExportSlot}
            onImportSave={onImportSave}
          />
        ) : (
          <>
            {typeof currentCapital === 'number' && onAdjustCapital && (
              <div
                data-testid="capital-balance-adjust-card"
                className={`rounded-xl border p-3.5 space-y-2.5 ${
                  currentCapital >= 1e12
                    ? 'bg-amber-950/20 border-amber-400/45'
                    : 'bg-[#10182b] border-white/[0.08]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-white">자금 밸런스 조정</h3>
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
                  <div className="rounded-lg bg-amber-500/12 border border-amber-400/30 px-2.5 py-1.5 text-[11px] text-amber-200">
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
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
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
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
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
                    className="w-24 min-h-[34px] px-2.5 py-1 rounded-lg bg-[#070b14] border border-white/[0.1] text-xs font-mono-numbers text-white focus:outline-none focus:border-sky-400"
                  />
                  <select
                    aria-label="자금 단위 선택"
                    data-testid="adjust-capital-unit-select"
                    value={customCapUnit}
                    onChange={(e) =>
                      setCustomCapUnit(e.target.value as '1' | 'K' | 'M' | 'B' | 'T')
                    }
                    className="min-h-[34px] px-2 py-1 rounded-lg bg-[#070b14] border border-white/[0.1] text-xs font-mono-numbers text-slate-200 focus:outline-none focus:border-sky-400"
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
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition-colors"
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

            {/* 5 Local Save Slots */}
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
                    className={`rounded-xl border p-3.5 transition-colors ${
                      isActive
                        ? 'bg-sky-500/[0.08] border-sky-400/50'
                        : 'bg-[#10182b] border-white/[0.08]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-slate-200">슬롯 {idx}</span>
                          {isActive && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="font-semibold text-sky-300">현재 플레이 중</span>
                            </>
                          )}
                          {summary && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-400 flex items-center gap-1">
                                <HardDrive className="w-3 h-3" />
                                로컬 저장
                              </span>
                            </>
                          )}
                        </div>

                        {summary ? (
                          <div className="mt-1">
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
                                  className="flex-1 min-w-0 min-h-[32px] px-2 py-1 rounded-lg bg-[#070b14] border border-sky-400 text-xs text-white focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => void commitRename(slotId)}
                                  className="min-h-[32px] px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
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
                                  className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 cursor-pointer"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            <div className="text-xs text-slate-300 font-mono-numbers mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>{summary.cityName}</span>
                              <span className="text-slate-600">·</span>
                              <span className="text-sky-400">
                                {summary.mapped1to1Km.toLocaleString()} km
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="text-indigo-300">
                                노드 {summary.connectedOsmNodes.toLocaleString()}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="inline-flex items-center gap-1 text-slate-200">
                                <TierEmblem tierOrLabel={summary.tierLabel} size="xs" />
                                <span>{summary.tierLabel}</span>
                              </span>
                              <span className="text-slate-600">·</span>
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
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                            불러오기
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
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              덮어쓰기 확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmOverwriteSlot(null)}
                              className="min-h-[36px] px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 text-xs cursor-pointer whitespace-nowrap"
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
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
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
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                              >
                                삭제 확인
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSlot(null)}
                                className="min-h-[36px] px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 text-xs cursor-pointer whitespace-nowrap"
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
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-rose-950/70 hover:text-rose-300 border border-white/[0.08] text-slate-400 text-xs flex items-center gap-1 cursor-pointer transition-colors"
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
          </>
        )}
      </div>
    </ModalShell>
  );
};
