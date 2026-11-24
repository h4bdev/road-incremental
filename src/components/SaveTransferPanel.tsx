import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileUp,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react';
import {
  DecodedImportPreview,
  decodeImportedSaveString,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  slotIndexFromId,
} from '../game/saveSlots';
import { formatMoneyCompact } from '../game/format';

export interface SaveTransferPanelProps {
  slots: Record<SaveSlotId, SaveSlotSummary | null>;
  defaultSlotId: SaveSlotId;
  initialMode?: 'export' | 'import';
  isPlayingActiveSlot?: boolean;
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

function formatAbsoluteSaveTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '알 수 없음';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export const SaveTransferPanel: React.FC<SaveTransferPanelProps> = ({
  slots,
  defaultSlotId,
  initialMode = 'export',
  isPlayingActiveSlot = false,
  onExportSlot,
  onImportSave,
}) => {
  const populatedSlots = useMemo(
    () => SAVE_SLOT_IDS.filter((id) => Boolean(slots[id])),
    [slots]
  );

  const firstEmptySlot = useMemo(
    () => SAVE_SLOT_IDS.find((id) => !slots[id]) || defaultSlotId,
    [slots, defaultSlotId]
  );

  const [mode, setMode] = useState<'export' | 'import'>(
    initialMode === 'export' && populatedSlots.length === 0 && !isPlayingActiveSlot
      ? 'import'
      : initialMode
  );

  // Export state
  const [exportSlotId, setExportSlotId] = useState<SaveSlotId>(() => {
    if (isPlayingActiveSlot || slots[defaultSlotId]) return defaultSlotId;
    return populatedSlots[0] || defaultSlotId;
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{
    slotId: SaveSlotId;
    code: string;
    summary: SaveSlotSummary;
    fileName: string;
  } | null>(null);
  const LARGE_TEXTAREA_DISPLAY_LIMIT = 24000;
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Import state
  const [importText, setImportText] = useState('');
  const [importDisplayIsTruncated, setImportDisplayIsTruncated] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DecodedImportPreview | null>(null);
  const [targetImportSlotId, setTargetImportSlotId] = useState<SaveSlotId>(firstEmptySlot);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const decodeSeqRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const canExportSelected =
    Boolean(slots[exportSlotId]) || (isPlayingActiveSlot && exportSlotId === defaultSlotId);

  const handleGenerateExport = useCallback(
    async (slotToExport: SaveSlotId = exportSlotId) => {
      setIsExporting(true);
      setExportError(null);
      setCopied(false);
      try {
        const res = await onExportSlot(slotToExport);
        setExportResult({ slotId: slotToExport, ...res });
      } catch (err) {
        setExportError(
          err instanceof Error ? err.message : '세이브 코드를 생성하지 못했습니다.'
        );
      } finally {
        setIsExporting(false);
      }
    },
    [exportSlotId, onExportSlot]
  );

  // Auto-generate export code when entering Export mode with an available slot
  useEffect(() => {
    if (mode !== 'export') return;
    if (!canExportSelected) return;
    if (exportResult && exportResult.slotId === exportSlotId) return;
    void handleGenerateExport(exportSlotId);
  }, [mode, canExportSelected, exportSlotId, exportResult, handleGenerateExport]);

  const handleCopyCode = async () => {
    if (!exportResult?.code) return;
    let success = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(exportResult.code);
        success = true;
      }
    } catch {
      success = false;
    }
    if (!success) {
      let tempTextarea: HTMLTextAreaElement | null = null;
      try {
        tempTextarea = document.createElement('textarea');
        tempTextarea.value = exportResult.code;
        tempTextarea.setAttribute('readonly', '');
        tempTextarea.style.position = 'fixed';
        tempTextarea.style.left = '-9999px';
        tempTextarea.style.top = '0';
        document.body.appendChild(tempTextarea);
        tempTextarea.focus();
        tempTextarea.select();
        success = document.execCommand('copy');
      } catch {
        success = false;
      } finally {
        if (tempTextarea && tempTextarea.parentNode) {
          tempTextarea.parentNode.removeChild(tempTextarea);
        }
      }
    }
    if (success) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2500);
    } else {
      setExportError('클립보드 자동 복사가 차단되었습니다. .txt 파일로 저장해 이용해 주세요.');
    }
  };

  const handleDownloadFile = () => {
    if (!exportResult?.code) return;
    const blob = new Blob([exportResult.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportResult.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const runDecode = useCallback(async (raw: string) => {
    const seq = ++decodeSeqRef.current;
    setImportSuccess(null);
    if (!raw.trim()) {
      setIsDecoding(false);
      setDecodeError(null);
      setPreview(null);
      return;
    }
    setIsDecoding(true);
    setDecodeError(null);
    try {
      const decoded = await decodeImportedSaveString(raw);
      if (decodeSeqRef.current !== seq) return;
      setPreview(decoded);
      setDecodeError(null);
    } catch (err) {
      if (decodeSeqRef.current !== seq) return;
      setPreview(null);
      setDecodeError(
        err instanceof Error ? err.message : '세이브 코드를 해석할 수 없습니다.'
      );
    } finally {
      if (decodeSeqRef.current === seq) {
        setIsDecoding(false);
      }
    }
  }, []);

  useEffect(() => {
    if (mode !== 'import') return;
    const timer = setTimeout(() => {
      void runDecode(importText);
    }, 100);
    return () => clearTimeout(timer);
  }, [importText, mode, runDecode]);

  const setLargeOrSmallImportText = useCallback((text: string) => {
    setImportText(text);
    setImportDisplayIsTruncated(text.length > LARGE_TEXTAREA_DISPLAY_LIMIT);
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setLargeOrSmallImportText(text);
      await runDecode(text);
    } catch {
      setDecodeError('선택한 파일을 읽지 못했습니다.');
    }
  };

  const handleApplyImport = async (launchNow: boolean) => {
    if (!preview || isApplyingImport) return;
    setIsApplyingImport(true);
    setDecodeError(null);
    setImportSuccess(null);
    try {
      await onImportSave(targetImportSlotId, preview, launchNow);
      if (!launchNow) {
        setImportSuccess(
          `슬롯 ${slotIndexFromId(targetImportSlotId)}에 "${preview.cityName}" 세이브를 저장했습니다.`
        );
      }
    } catch (err) {
      setDecodeError(
        err instanceof Error ? err.message : '세이브를 슬롯에 저장하지 못했습니다.'
      );
    } finally {
      setIsApplyingImport(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800">
        <button
          type="button"
          data-testid="transfer-tab-export"
          onClick={() => setMode('export')}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
            mode === 'export'
              ? 'bg-sky-600 text-white shadow'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>세이브 내보내기 (Export)</span>
        </button>
        <button
          type="button"
          data-testid="transfer-tab-import"
          onClick={() => setMode('import')}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
            mode === 'import'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
          }`}
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span>세이브 가져오기 (Import)</span>
        </button>
      </div>

      {mode === 'export' ? (
        <div className="space-y-3" data-testid="export-panel">
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  내보낼 슬롯 선택
                </h3>
                <p className="text-[11px] text-slate-400">
                  도로망, 자금, 연구, 지역 경계, 타운 게임 진행도를 하나의 압축 코드 또는 .txt 파일로 백업합니다.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="내보낼 저장 슬롯"
                  data-testid="export-slot-select"
                  value={exportSlotId}
                  onChange={(e) => {
                    const nextId = e.target.value as SaveSlotId;
                    setExportSlotId(nextId);
                    setExportResult(null);
                    setExportError(null);
                    setCopied(false);
                  }}
                  className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  {SAVE_SLOT_IDS.map((slotId) => {
                    const s = slots[slotId];
                    const idx = slotIndexFromId(slotId);
                    const isLive = isPlayingActiveSlot && slotId === defaultSlotId;
                    return (
                      <option key={slotId} value={slotId} disabled={!s && !isLive}>
                        슬롯 {idx}
                        {isLive
                          ? ` (현재 플레이 · ${s?.cityName || '진행 중'})`
                          : s
                          ? ` · ${s.cityName} (${formatMoneyCompact(s.capital)})`
                          : ' (비어 있음)'}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  data-testid="export-generate-btn"
                  disabled={!canExportSelected || isExporting}
                  onClick={() => void handleGenerateExport(exportSlotId)}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isExporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  코드 생성
                </button>
              </div>
            </div>

            {!canExportSelected && (
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-400">
                저장된 슬롯이 없습니다. 먼저 게임을 시작하거나 &ldquo;세이브 가져오기&rdquo; 탭에서 백업 코드를 불러오세요.
              </div>
            )}

            {exportError && (
              <div
                role="alert"
                className="rounded-lg bg-rose-950/60 border border-rose-500/40 px-3 py-2 text-xs text-rose-200 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{exportError}</span>
              </div>
            )}

            {exportResult && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 font-mono-numbers">
                  <span>
                    <strong className="text-white">{exportResult.summary.cityName}</strong> ·{' '}
                    {formatMoneyCompact(exportResult.summary.capital)} · 노드{' '}
                    {exportResult.summary.connectedOsmNodes.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-400 tabular-nums">
                    {(exportResult.code.length / 1024).toFixed(1)} KB (
                    {exportResult.code.length.toLocaleString()}자)
                  </span>
                </div>

                <textarea
                  data-testid="export-save-textarea"
                  data-full-length={exportResult.code.length}
                  readOnly
                  rows={5}
                  value={
                    exportResult.code.length > LARGE_TEXTAREA_DISPLAY_LIMIT
                      ? `${exportResult.code
                          .slice(0, 800)
                          .replace(/(.{72})/g, '$1\n')}\n...\n[전체 ${exportResult.code.length.toLocaleString()}자 중 일부 미리보기 — 아래 "클립보드 복사" 또는 ".txt 파일로 저장"으로 전체를 백업하세요]`
                      : exportResult.code
                  }
                  onClick={(e) => {
                    if (exportResult.code.length <= LARGE_TEXTAREA_DISPLAY_LIMIT) {
                      e.currentTarget.select();
                    }
                  }}
                  aria-label="내보낸 세이브 코드"
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] leading-relaxed font-mono text-sky-200 focus:outline-none focus:border-sky-500 resize-none break-all"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="export-copy-btn"
                    onClick={() => void handleCopyCode()}
                    className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-sky-600 hover:bg-sky-500 text-white'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>클립보드 복사</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="export-download-btn"
                    onClick={handleDownloadFile}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 text-sky-400" />
                    <span>.txt 파일로 저장</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="import-panel">
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  세이브 코드 붙여넣기 또는 파일 업로드
                </h3>
                <p className="text-[11px] text-slate-400">
                  <code className="text-sky-300">TERRALINE1:</code> 세이브 코드나 내보낸{' '}
                  <code className="text-sky-300">.txt</code> / <code className="text-sky-300">.json</code> 파일을 불러와 원하는 슬롯에 복원합니다.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  data-testid="import-file-input"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  data-testid="import-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FileUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>파일 선택</span>
                </button>
              </div>
            </div>

            <textarea
              data-testid="import-save-textarea"
              rows={5}
              readOnly={importDisplayIsTruncated}
              value={
                importDisplayIsTruncated
                  ? `${importText
                      .slice(0, 800)
                      .replace(/(.{72})/g, '$1\n')}\n...\n[대용량 세이브 코드 ${importText.length.toLocaleString()}자 로드됨 — 새로 입력하려면 아래 "지우기"를 누르세요]`
                  : importText
              }
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text');
                if (pasted && pasted.length > LARGE_TEXTAREA_DISPLAY_LIMIT) {
                  e.preventDefault();
                  setLargeOrSmallImportText(pasted);
                }
              }}
              onChange={(e) => {
                if (importDisplayIsTruncated) return;
                setLargeOrSmallImportText(e.target.value);
              }}
              placeholder="TERRALINE1:... 형식의 세이브 코드를 여기에 붙여넣으세요."
              aria-label="가져올 세이브 코드 입력"
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] leading-relaxed font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 resize-y"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="import-validate-btn"
                  disabled={!importText.trim() || isDecoding}
                  onClick={() => void runDecode(importText)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {isDecoding ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  ) : null}
                  <span>코드 확인</span>
                </button>
                {importText && (
                  <button
                    type="button"
                    data-testid="import-clear-btn"
                    onClick={() => {
                      setImportText('');
                      setImportDisplayIsTruncated(false);
                      setPreview(null);
                      setDecodeError(null);
                      setImportSuccess(null);
                    }}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs cursor-pointer"
                  >
                    지우기
                  </button>
                )}
              </div>
              {importText.trim() && (
                <span className="text-[11px] text-slate-500 font-mono-numbers">
                  입력 길이 {importText.trim().length.toLocaleString()}자
                </span>
              )}
            </div>

            {decodeError && (
              <div
                role="alert"
                data-testid="import-error-alert"
                className="rounded-lg bg-rose-950/60 border border-rose-500/40 px-3 py-2 text-xs text-rose-200 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{decodeError}</span>
              </div>
            )}

            {importSuccess && (
              <div
                data-testid="import-success-banner"
                className="rounded-lg bg-emerald-950/50 border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 flex items-center gap-2"
              >
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{importSuccess}</span>
              </div>
            )}

            {preview && (
              <div
                data-testid="import-preview-card"
                className="rounded-xl bg-slate-950 border border-emerald-500/40 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{preview.cityName}</span>
                      {preview.cityCountry && (
                        <span className="text-xs font-normal text-slate-400">
                          {preview.cityCountry}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      저장 시각: {formatAbsoluteSaveTime(preview.savedAt)} · 등급 {preview.tierLabel}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400">
                    유효한 세이브 확인됨
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-numbers">
                  <div className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2">
                    <div className="text-[10px] text-slate-400">보유 자금</div>
                    <div className="font-bold text-emerald-400 mt-0.5 tabular-nums">
                      {formatMoneyCompact(preview.capital)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2">
                    <div className="text-[10px] text-slate-400">연결 노드</div>
                    <div className="font-bold text-indigo-300 mt-0.5 tabular-nums">
                      {preview.connectedOsmNodes.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2">
                    <div className="text-[10px] text-slate-400">건설 구간</div>
                    <div className="font-bold text-sky-400 mt-0.5 tabular-nums">
                      {preview.totalOsmEdgesBuilt.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2">
                    <div className="text-[10px] text-slate-400">1:1 도로망</div>
                    <div className="font-bold text-slate-200 mt-0.5 tabular-nums">
                      {preview.mapped1to1Km.toLocaleString()} km
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono-numbers">
                  포함 스냅샷: 전체 노드 {preview.totalNodesInSnapshot.toLocaleString()}개 · 구간{' '}
                  {preview.totalEdgesInSnapshot.toLocaleString()}개
                </div>

                <div className="pt-2.5 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <label
                      htmlFor="import-target-slot"
                      className="text-xs font-semibold text-slate-300 whitespace-nowrap shrink-0"
                    >
                      저장 위치:
                    </label>
                    <select
                      id="import-target-slot"
                      data-testid="import-target-slot-select"
                      value={targetImportSlotId}
                      onChange={(e) => setTargetImportSlotId(e.target.value as SaveSlotId)}
                      className="min-h-[40px] w-full sm:max-w-[260px] min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      {SAVE_SLOT_IDS.map((slotId) => {
                        const existing = slots[slotId];
                        const idx = slotIndexFromId(slotId);
                        return (
                          <option key={slotId} value={slotId}>
                            슬롯 {idx}
                            {existing
                              ? ` · 기존 ${existing.cityName} (${formatMoneyCompact(existing.capital)}) 덮어쓰기`
                              : ' (빈 슬롯)'}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex items-center justify-end gap-2 shrink-0 flex-wrap sm:flex-nowrap">
                    <button
                      type="button"
                      data-testid="import-apply-only-btn"
                      disabled={isApplyingImport}
                      onClick={() => void handleApplyImport(false)}
                      className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5 text-sky-400" />
                      <span>슬롯에만 저장</span>
                    </button>
                    <button
                      type="button"
                      data-testid="import-apply-play-btn"
                      disabled={isApplyingImport}
                      onClick={() => void handleApplyImport(true)}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      {isApplyingImport ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>저장 후 바로 시작</span>
                    </button>
                  </div>
                </div>

                {slots[targetImportSlotId] && (
                  <div className="text-[11px] text-amber-300">
                    주의: 슬롯 {slotIndexFromId(targetImportSlotId)}에 저장된 기존{' '}
                    {slots[targetImportSlotId]!.cityName} 진행도는 덮어써집니다.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
