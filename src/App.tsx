import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Award } from 'lucide-react';
import { TitleScreen } from './components/TitleScreen';
import { WorldMap } from './components/WorldMap';
import { HUD, ModalTab } from './components/HUD';
import { LinesPanel } from './components/LinesPanel';
import { SkillTreePanel } from './components/SkillTreePanel';
import { AchievementsPanel } from './components/AchievementsPanel';
import { PrestigePanel } from './components/PrestigePanel';
import { TownArcadePanel } from './components/TownArcadePanel';
import { SaveSlotsModal } from './components/SaveSlotsModal';
import { TutorialGuide, TUTORIAL_DONE_STORAGE_KEY } from './components/TutorialGuide';
import {
  Achievement,
  GameState,
  GeoJsonBoundary,
  MinigameId,
  MinigameMilestoneDef,
  MinigamesState,
  ReactorCellType,
  StartingCity,
} from './game/types';
import {
  backfillMinigamesState,
  BioUpgradeKind,
  boostShipyardChain,
  buyBioUpgrade,
  buyColliderUpgrade,
  buyMineUpgrade,
  buyQuantumUpgrade,
  buyReactorUpgrade,
  buyShipyardUnit,
  buySolarUpgrade,
  ColliderUpgradeKind,
  collideParticles,
  cultivateBioDome,
  digMineLayer,
  evaluateMinigameMilestones,
  evolveBioDome,
  exchangeMoneyToMinigameCurrency,
  leapQuantumDimension,
  MineUpgradeKind,
  mistBioHumidity,
  placeReactorCell,
  prestigeShipyardFleet,
  pulseQuantumExperiment,
  pulseSolarArray,
  QuantumUpgradeKind,
  ReactorUpgradeKind,
  setSolarOrbitalAngle,
  ShipyardUnitKind,
  SolarUpgradeKind,
  triggerColliderBurst,
  triggerMineSeismicBlast,
  tuneQuantumWave,
  unlockMinigame,
  ventReactorHeat,
} from './game/minigames';
import {
  adjustGameCapital,
  advanceTick,
  buyAllAffordableSkills,
  buyMaxSkill,
  calculateMultipliers,
  calculateTotalIncomePerSec,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  evaluateLinesAndAchievements,
  getExpandableProvincialRegions,
  getProximityAdjacentChunksToLoad,
  getRecommendedBalancedCapital,
  getRegionUnlockCost,
  BatchOsmChunkInput,
  isNodeInUnlockedRegion,
  isSyntheticFallbackRegion,
  mergeOsmChunk,
  mergeOsmChunksBatch,
  registerDiscoveredProvincialRegion,
  registerStartingProvincialRegion,
  resetSkillTree,
  scopeGameStateToStartingCity,
  selectIsolatedRegionSeed,
  unlockProvincialRegion,
  unlockSkill,
} from './game/rules';
import {
  chunkKeyForCoords,
  enumerateChunkKeysForBounds,
  fetchNearbyProvincialRegions,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  fetchOsmRoadChunksBatch,
  fetchProvincialRegionInfo,
  generateCustomCityNetwork,
  hydrateProvincialRegionsFromCache,
  parseChunkKeyCoords,
  readCachedOsmTilesForKeys,
} from './game/osmService';
import { EXACT_BOUNDARY_CACHE_VERSION } from './game/osmTileCache';
import {
  applyRestoredGraphMarks,
  buildSummaryFromState,
  countUnhydratedGraphMarks,
  DecodedImportPreview,
  deleteLocalSlotGameState,
  exportSaveToString,
  getActiveSlotId,
  getLocalSlotBuiltSkeleton,
  getLocalSlotGraphMarks,
  hydrateLocalSlotGraphFromIndexedDb,
  importDecodedSaveIntoSlot,
  listLocalSlotSummaries,
  loadLocalSlotGameState,
  renameLocalSlot,
  RestoredGraphMarks,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  saveLocalSlotGameState,
  saveLocalSlotGraphToIndexedDb,
  setActiveSlotId,
  slotIndexFromId,
} from './game/saveSlots';
import { BuiltSkeletonTuple, ViewportBounds } from './game/osmOverview';
import { PRESET_CITIES } from './game/worldCatalog';
import { soundManager } from './game/audio';

interface LoadingProgressState {
  active: boolean;
  percent: number;
  label: string;
}

interface ToastNotification {
  id: string;
  kind: 'achievement';
  title: string;
  subtitle: string;
}

export default function App() {
  const [activeSlotId, setActiveSlotIdState] = useState<SaveSlotId>(() => getActiveSlotId());
  const [localSlots, setLocalSlots] = useState<Partial<Record<SaveSlotId, SaveSlotSummary>>>(() =>
    listLocalSlotSummaries()
  );
  const [busySlotId, setBusySlotId] = useState<SaveSlotId | null>(null);

  const [screenState, setScreenState] = useState<'title' | 'playing'>('title');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeModal, setActiveModal] = useState<ModalTab>(null);
  const [hasMapBottomCard, setHasMapBottomCard] = useState(false);
  const [isLoadingOsm, setIsLoadingOsm] = useState(false);
  const [unlockingRegionId, setUnlockingRegionId] = useState<string | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{
    lat: number;
    lng: number;
    zoom: number;
    ts: number;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [builtSkeleton, setBuiltSkeleton] = useState<BuiltSkeletonTuple[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgressState | null>(null);

  const stateRef = useRef<GameState | null>(null);
  stateRef.current = gameState;
  const activeSlotIdRef = useRef<SaveSlotId>(activeSlotId);
  activeSlotIdRef.current = activeSlotId;
  const busySlotIdRef = useRef<SaveSlotId | null>(busySlotId);
  busySlotIdRef.current = busySlotId;
  const setBusySlot = useCallback((id: SaveSlotId | null) => {
    busySlotIdRef.current = id;
    setBusySlotId(id);
  }, []);
  const pendingRestoredMarksRef = useRef<RestoredGraphMarks | null>(null);
  const viewportBoundsRef = useRef<ViewportBounds | null>(null);
  const loadingSessionRef = useRef(0);
  const loadingHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginLoadingSession = useCallback((label: string, initialPercent = 8): number => {
    if (loadingHideTimerRef.current) {
      clearTimeout(loadingHideTimerRef.current);
      loadingHideTimerRef.current = null;
    }
    const nextId = ++loadingSessionRef.current;
    const pct = Math.max(1, Math.min(99, Math.round(initialPercent)));
    setLoadingProgress({ active: true, percent: pct, label });
    return nextId;
  }, []);

  const updateLoadingSession = useCallback(
    (sessionId: number, percent: number, label?: string) => {
      if (loadingSessionRef.current !== sessionId) return;
      const clamped = Math.max(1, Math.min(99, Math.round(percent)));
      setLoadingProgress((prev) => ({
        active: true,
        percent: prev && prev.active ? Math.max(prev.percent, clamped) : clamped,
        label: label ?? prev?.label ?? '지도 데이터 불러오는 중',
      }));
    },
    []
  );

  const completeLoadingSession = useCallback(
    (sessionId: number, label = '지도 데이터 준비 완료') => {
      if (loadingSessionRef.current !== sessionId) return;
      setLoadingProgress({ active: true, percent: 100, label });
      if (loadingHideTimerRef.current) {
        clearTimeout(loadingHideTimerRef.current);
      }
      loadingHideTimerRef.current = setTimeout(() => {
        if (loadingSessionRef.current === sessionId) {
          setLoadingProgress(null);
        }
      }, 650);
    },
    []
  );

  const handleViewportChange = useCallback((bounds: ViewportBounds) => {
    viewportBoundsRef.current = bounds;
  }, []);

  const unlockingRegionRef = useRef<string | null>(null);
  const checkedProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightChunkKeysRef = useRef<Set<string>>(new Set());
  const settledEmptyChunkKeysRef = useRef<Set<string>>(new Set());
  const chunkRetryCooldownRef = useRef<Map<string, { fails: number; retryAfter: number }>>(new Map());
  const queuedBatchCoordsRef = useRef<
    Map<
      string,
      { key: string; lat: number; lng: number; owningRegionId?: string; bypassCache?: boolean }
    >
  >(new Map());
  const batchDispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChunkQueueRef = useRef<
    Array<{
      chunkKey: string;
      osmNodes: GameState['osmNodes'];
      osmEdges: GameState['osmEdges'];
      owningRegionId?: string;
    }>
  >([]);
  const chunkFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRegionIdsRef = useRef<Set<string>>(new Set());
  const hydrateAttemptsRef = useRef<Map<string, number>>(new Map());
  const [boundaryRetryTick, setBoundaryRetryTick] = useState(0);
  const autoStartedRef = useRef(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const slotsRecord = useMemo<Record<SaveSlotId, SaveSlotSummary | null>>(() => {
    const out: Record<SaveSlotId, SaveSlotSummary | null> = {
      slot_1: null,
      slot_2: null,
      slot_3: null,
      slot_4: null,
      slot_5: null,
    };
    for (const id of SAVE_SLOT_IDS) {
      out[id] = localSlots[id] || null;
    }
    return out;
  }, [localSlots]);

  const localSlotsRef = useRef(localSlots);
  localSlotsRef.current = localSlots;

  useEffect(() => {
    document.body.dataset.state = screenState;
  }, [screenState]);

  // Strict Rule: ONLY achievement notifications appear on screen
  const pushToast = useCallback((kind: string, title: string, subtitle: string) => {
    if (kind !== 'achievement') return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind: 'achievement', title, subtitle }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const announceMilestones = useCallback(
    (milestones: MinigameMilestoneDef[]) => {
      if (milestones.length === 0) return;
      soundManager.playUpgradeUnlocked();
      milestones.forEach((ms) => {
        pushToast(
          'achievement',
          `업적 달성: ${ms.title}`,
          `${ms.description} · 메인 자금 수익 +${ms.incomeBoostPct}% 부스트!`
        );
      });
    },
    [pushToast]
  );

  const announceAchievements = useCallback(
    (achievements: Achievement[]) => {
      if (achievements.length === 0) return;
      soundManager.playRouteBuilt();
      try {
        confetti({
          particleCount: 45,
          spread: 65,
          origin: { y: 0.75 },
        });
      } catch {
        // Ignore confetti failures in headless/constrained environments
      }
      achievements.forEach((ach) => {
        pushToast('achievement', `업적 달성: ${ach.title}`, ach.rewardText);
      });
    },
    [pushToast]
  );

  const discoverNearbyProvinces = useCallback(async (lat: number, lng: number) => {
    const nearby = await fetchNearbyProvincialRegions(lat, lng).catch(() => []);
    if (nearby.length === 0) return;
    setGameState((prev) => {
      if (!prev) return prev;
      let next = prev;
      for (const meta of nearby) {
        next = registerDiscoveredProvincialRegion(next, meta);
      }
      return next;
    });
  }, []);

  const flushPendingOsmChunks = useCallback(() => {
    if (chunkFlushTimerRef.current) {
      clearTimeout(chunkFlushTimerRef.current);
      chunkFlushTimerRef.current = null;
    }
    const batch = pendingChunkQueueRef.current.splice(0, pendingChunkQueueRef.current.length);
    if (batch.length === 0) return;

    setGameState((prev) => {
      if (!prev) return prev;
      const pendingSeeds = new Set(prev.pendingSeedRegionIds || []);
      const entries: BatchOsmChunkInput[] = [];
      let skipAutoSeed = false;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const filteredNodes = item.osmNodes.filter((n) => isNodeInUnlockedRegion(prev, n));
        const allowedIds = new Set<string>();
        for (let j = 0; j < filteredNodes.length; j++) {
          allowedIds.add(filteredNodes[j].id);
        }
        const filteredEdges = item.osmEdges.filter(
          (e) => allowedIds.has(e.fromNodeId) && allowedIds.has(e.toNodeId)
        );
        if (item.owningRegionId && pendingSeeds.has(item.owningRegionId)) {
          skipAutoSeed = true;
        }
        entries.push({
          chunkKey: item.chunkKey,
          osmNodes: filteredNodes,
          osmEdges: filteredEdges,
          regionId: item.owningRegionId,
        });
      }
      const skipEvaluate =
        prev.stats.connectedOsmNodes > 0 && !skipAutoSeed && !pendingRestoredMarksRef.current;
      const merged = mergeOsmChunksBatch(prev, entries, { skipAutoSeed, skipEvaluate });
      return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (chunkFlushTimerRef.current) {
        clearTimeout(chunkFlushTimerRef.current);
        chunkFlushTimerRef.current = null;
      }
      if (batchDispatchTimerRef.current) {
        clearTimeout(batchDispatchTimerRef.current);
        batchDispatchTimerRef.current = null;
      }
      queuedBatchCoordsRef.current.clear();
      pendingChunkQueueRef.current = [];
    };
  }, []);

  const dispatchQueuedOsmBatch = useCallback(async () => {
    if (batchDispatchTimerRef.current) {
      clearTimeout(batchDispatchTimerRef.current);
      batchDispatchTimerRef.current = null;
    }
    const items = Array.from(queuedBatchCoordsRef.current.values());
    queuedBatchCoordsRef.current.clear();
    if (items.length === 0) return;

    const runSubQueue = async (
      subItems: Array<{
        key: string;
        lat: number;
        lng: number;
        owningRegionId?: string;
        bypassCache?: boolean;
      }>,
      bypassCache: boolean
    ) => {
      const WAVE_SIZE = 16;
      for (let i = 0; i < subItems.length; i += WAVE_SIZE) {
        const curState = stateRef.current;
        const loadedSet = new Set(curState?.loadedOsmChunks || []);
        const now = Date.now();
        const wave = subItems.slice(i, i + WAVE_SIZE).filter((item) => {
          if (inFlightChunkKeysRef.current.has(item.key)) return false;
          if (!bypassCache) {
            if (settledEmptyChunkKeysRef.current.has(item.key)) return false;
            if (loadedSet.has(item.key)) return false;
            const cd = chunkRetryCooldownRef.current.get(item.key);
            if (cd && cd.retryAfter > now) return false;
          }
          return true;
        });
        if (wave.length === 0) continue;

        for (const item of wave) {
          inFlightChunkKeysRef.current.add(item.key);
        }
        setIsLoadingOsm(true);
        try {
          const fetched = await fetchOsmRoadChunksBatch(
            wave.map((w) => ({ key: w.key, lat: w.lat, lng: w.lng })),
            { allowStarterFallback: false, bypassCache }
          );
          const byKey = new Map(fetched.map((c) => [c.chunkKey, c]));
          let queuedAny = false;
          for (const item of wave) {
            const chunk = byKey.get(item.key);
            if (chunk && (chunk.osmNodes.length > 0 || chunk.osmEdges.length > 0)) {
              chunkRetryCooldownRef.current.delete(item.key);
              pendingChunkQueueRef.current.push({
                chunkKey: chunk.chunkKey,
                osmNodes: chunk.osmNodes,
                osmEdges: chunk.osmEdges,
                owningRegionId: item.owningRegionId,
              });
              queuedAny = true;
            } else if (chunk && chunk.usedLiveOverpass) {
              chunkRetryCooldownRef.current.delete(item.key);
              settledEmptyChunkKeysRef.current.add(item.key);
            } else {
              const prevCd = chunkRetryCooldownRef.current.get(item.key);
              const fails = (prevCd?.fails || 0) + 1;
              const delayMs = 3000 * Math.min(8, Math.pow(2, fails - 1));
              chunkRetryCooldownRef.current.set(item.key, {
                fails,
                retryAfter: Date.now() + delayMs,
              });
            }
          }
          if (queuedAny) {
            flushPendingOsmChunks();
          }
        } catch {
          const retryAt = Date.now() + 4000;
          for (const item of wave) {
            const prevCd = chunkRetryCooldownRef.current.get(item.key);
            const fails = (prevCd?.fails || 0) + 1;
            chunkRetryCooldownRef.current.set(item.key, {
              fails,
              retryAfter: Math.max(retryAt, Date.now() + 3000 * Math.min(8, Math.pow(2, fails - 1))),
            });
          }
        } finally {
          for (const item of wave) {
            inFlightChunkKeysRef.current.delete(item.key);
          }
          setIsLoadingOsm(inFlightChunkKeysRef.current.size > 0);
        }
      }
    };

    const bypassItems = items.filter((it) => it.bypassCache);
    const normalItems = items.filter((it) => !it.bypassCache);
    if (bypassItems.length > 0) {
      await runSubQueue(bypassItems, true);
    }
    if (normalItems.length > 0) {
      await runSubQueue(normalItems, false);
    }
  }, [flushPendingOsmChunks]);

  const handleLoadOsmChunksBatch = useCallback(
    (
      coords: Array<{ lat: number; lng: number }>,
      options?: { force?: boolean; bypassCache?: boolean }
    ) => {
      if (!coords || coords.length === 0) return;
      const curState = stateRef.current;
      const regions = curState?.provincialRegions || [];
      const hasUnlockedRegion = regions.some((r) => r.unlocked);
      const loadedSet = new Set(curState?.loadedOsmChunks || []);
      const now = Date.now();
      const force = Boolean(options?.force || options?.bypassCache);
      const bypassCache = Boolean(options?.bypassCache);

      let added = 0;
      for (let i = 0; i < coords.length; i++) {
        const { lat, lng } = coords[i];
        let owningRegionId: string | undefined;
        if (curState) {
          const unlockedMatches = regions
            .filter(
              (r) =>
                r.unlocked &&
                lat >= r.bbox[0] - 0.002 &&
                lat <= r.bbox[2] + 0.002 &&
                lng >= r.bbox[1] - 0.002 &&
                lng <= r.bbox[3] + 0.002
            )
            .sort(
              (a, b) =>
                (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) -
                (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
            );
          const unlockedMatch = unlockedMatches[0];
          if (!unlockedMatch && hasUnlockedRegion) continue;
          owningRegionId = unlockedMatch?.regionId;
        }

        const key = chunkKeyForCoords(lat, lng);
        if (inFlightChunkKeysRef.current.has(key)) continue;

        if (force) {
          settledEmptyChunkKeysRef.current.delete(key);
          chunkRetryCooldownRef.current.delete(key);
        } else {
          if (
            loadedSet.has(key) ||
            settledEmptyChunkKeysRef.current.has(key) ||
            queuedBatchCoordsRef.current.has(key)
          ) {
            continue;
          }
          const cd = chunkRetryCooldownRef.current.get(key);
          if (cd && cd.retryAfter > now) continue;
        }

        const existingQueued = queuedBatchCoordsRef.current.get(key);
        queuedBatchCoordsRef.current.set(key, {
          key,
          lat,
          lng,
          owningRegionId,
          bypassCache: bypassCache || Boolean(existingQueued?.bypassCache),
        });
        added++;
      }

      if (added === 0) return;
      if (force || queuedBatchCoordsRef.current.size >= 12) {
        void dispatchQueuedOsmBatch();
      } else if (!batchDispatchTimerRef.current) {
        batchDispatchTimerRef.current = setTimeout(() => {
          void dispatchQueuedOsmBatch();
        }, 55);
      }
    },
    [dispatchQueuedOsmBatch]
  );

  // Load OpenStreetMap dense street/rail chunk around coordinates (delegates to coalesced batch loader)
  const handleLoadOsmChunk = useCallback(
    async (lat: number, lng: number) => {
      handleLoadOsmChunksBatch([{ lat, lng }]);
    },
    [handleLoadOsmChunksBatch]
  );

  // Discover adjacent cities & auto-load ALL nodes/edges once for unlocked cities
  const handleAutoLoadProvince = useCallback(async (lat: number, lng: number) => {
    const cellKey = `${(Math.round(lat * 25) / 25).toFixed(3)}_${(
      Math.round(lng * 25) / 25
    ).toFixed(3)}`;
    if (
      checkedProvinceCellsRef.current.has(cellKey) ||
      inFlightProvinceCellsRef.current.has(cellKey)
    ) {
      return;
    }
    inFlightProvinceCellsRef.current.add(cellKey);
    try {
      const [info, nearby] = await Promise.all([
        fetchProvincialRegionInfo(lat, lng).catch(() => null),
        fetchNearbyProvincialRegions(lat, lng).catch(() => []),
      ]);
      checkedProvinceCellsRef.current.add(cellKey);

      const cur = stateRef.current;
      if (!cur) return;

      setGameState((prev) => {
        if (!prev) return prev;
        let next = prev;
        if (info && !isSyntheticFallbackRegion(info.regionId, info.regionName)) {
          next = registerDiscoveredProvincialRegion(next, info);
        }
        for (const meta of nearby) {
          if (!isSyntheticFallbackRegion(meta.regionId, meta.regionName)) {
            next = registerDiscoveredProvincialRegion(next, meta);
          }
        }
        return next;
      });

      const latestRegions = stateRef.current?.provincialRegions || [];
      const matchedUnlocked = info
        ? latestRegions.find((r) => r.regionId === info.regionId && r.unlocked)
        : latestRegions.find(
            (r) =>
              r.unlocked &&
              lat >= r.bbox[0] &&
              lat <= r.bbox[2] &&
              lng >= r.bbox[1] &&
              lng <= r.bbox[3]
          );

      if (
        matchedUnlocked &&
        !(stateRef.current?.loadedOsmRegions || []).includes(matchedUnlocked.regionId)
      ) {
        const region = await fetchOsmProvincialRegion(
          lat,
          lng,
          matchedUnlocked.regionName,
          matchedUnlocked.regionId
        );
        if (region.osmNodes.length > 0) {
          setGameState((prev) => {
            if (!prev) return prev;
            const isUnlockedNow = (prev.provincialRegions || []).some(
              (r) => r.regionId === matchedUnlocked.regionId && r.unlocked
            );
            if (!isUnlockedNow) return prev;
            const merged = mergeOsmChunk(
              prev,
              region.chunkKey,
              region.osmNodes,
              region.osmEdges,
              matchedUnlocked.regionId,
              {
                boundaryGeoJson: region.boundaryGeoJson,
                totalNodeCount: region.totalNodeCount ?? region.osmNodes.length,
              }
            );
            return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
          });
        }
      }
    } finally {
      inFlightProvinceCellsRef.current.delete(cellKey);
    }
  }, []);

  // Load ALL nodes of a city in one pass (with local starter fallback if Overpass is empty)
  const loadFullStartingCityIntoState = useCallback(async (lat: number, lng: number, targetRegionId?: string) => {
    const targetReg = stateRef.current?.provincialRegions.find((r) => r.regionId === targetRegionId);
    const regionLabel = targetReg?.regionName || stateRef.current?.startingCity.name || '지역';
    const sessionId = beginLoadingSession(`${regionLabel} 도로망 로드 중`, 12);
    setIsLoadingOsm(true);
    try {
      const regionData = await fetchOsmProvincialRegion(
        lat,
        lng,
        targetReg?.regionName,
        targetRegionId,
        {
          onProgress: (pct, lbl) => {
            updateLoadingSession(sessionId, Math.max(12, Math.min(95, pct)), lbl);
          },
        }
      );
      let chunkKey = regionData.chunkKey;
      let osmNodes = regionData.osmNodes;
      let osmEdges = regionData.osmEdges;
      let totalNodeCount = regionData.totalNodeCount ?? osmNodes.length;

      if (osmNodes.length === 0) {
        updateLoadingSession(sessionId, 88, `${regionLabel} 보조 도로 확인 중`);
        const fallback = await fetchOsmRoadChunk(lat, lng);
        chunkKey = fallback.chunkKey;
        osmNodes = fallback.osmNodes;
        osmEdges = fallback.osmEdges;
        totalNodeCount = Math.max(totalNodeCount, osmNodes.length);
      }

      if (osmNodes.length > 0 || osmEdges.length > 0) {
        updateLoadingSession(sessionId, 96, `${regionLabel} 노드 연결 중`);
        setGameState((prev) => {
          if (!prev) return prev;
          const rid =
            targetRegionId ||
            prev.provincialRegions.find((r) => r.isStartingRegion)?.regionId ||
            regionData.regionId;
          const merged = mergeOsmChunk(prev, chunkKey, osmNodes, osmEdges, rid, {
            boundaryGeoJson: regionData.boundaryGeoJson,
            totalNodeCount,
          });
          return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
        });
      }
      completeLoadingSession(sessionId, `${regionLabel} 로드 완료`);
    } catch {
      completeLoadingSession(sessionId, `${regionLabel} 로드 완료`);
    } finally {
      setIsLoadingOsm(false);
    }
  }, [beginLoadingSession, completeLoadingSession, updateLoadingSession]);

  const persistCurrentSlotLocally = useCallback(
    (state: GameState, slotId: SaveSlotId, customName?: string, savedAt?: number): number => {
      if (pendingRestoredMarksRef.current) {
        const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(
          state,
          pendingRestoredMarksRef.current
        );
        if (unhydratedNodes === 0 && unhydratedEdges === 0) {
          pendingRestoredMarksRef.current = null;
        }
      }
      const ts = savedAt ?? Date.now();
      saveLocalSlotGameState(slotId, state, {
        slotName: customName,
        savedAt: ts,
        pendingMarks: pendingRestoredMarksRef.current,
      });
      setLocalSlots(listLocalSlotSummaries());
      return ts;
    },
    []
  );

  // Start new game immediately (<300ms) with selected city, then stream full region/roads in background
  const handleStartWithCity = useCallback(
    async (city: StartingCity, targetSlotId: SaveSlotId = activeSlotIdRef.current) => {
      const sessionId = beginLoadingSession(`${city.name} 지도 여는 중`, 15);
      checkedProvinceCellsRef.current.clear();
      inFlightProvinceCellsRef.current.clear();
      inFlightChunkKeysRef.current.clear();
      settledEmptyChunkKeysRef.current.clear();
      chunkRetryCooldownRef.current.clear();
      if (batchDispatchTimerRef.current) {
        clearTimeout(batchDispatchTimerRef.current);
        batchDispatchTimerRef.current = null;
      }
      queuedBatchCoordsRef.current.clear();
      if (chunkFlushTimerRef.current) {
        clearTimeout(chunkFlushTimerRef.current);
        chunkFlushTimerRef.current = null;
      }
      pendingChunkQueueRef.current = [];
      hydratedRegionIdsRef.current.clear();
      hydrateAttemptsRef.current.clear();
      pendingRestoredMarksRef.current = null;
      setBuiltSkeleton([]);

      const customNetwork = city.isCustom
        ? await generateCustomCityNetwork(city)
        : undefined;
      let fresh = createInitialGameState(city, customNetwork);

      // Fast IndexedDB cache check (<15ms) so revisited starting cities open pre-populated with real boundaries
      const startTileKey = chunkKeyForCoords(city.lat, city.lng);
      const [cachedTiles, cachedInitBoundaries] = await Promise.all([
        readCachedOsmTilesForKeys([startTileKey]).catch(() => new Map()),
        hydrateProvincialRegionsFromCache(fresh.provincialRegions).catch(() => new Map()),
      ]);
      if (cachedInitBoundaries.size > 0) {
        let withCachedBoundaries = fresh;
        for (const meta of cachedInitBoundaries.values()) {
          if (meta.regionId === fresh.provincialRegions.find((r) => r.isStartingRegion)?.regionId) {
            withCachedBoundaries = registerStartingProvincialRegion(withCachedBoundaries, {
              ...meta,
              exactBoundaryVersion: EXACT_BOUNDARY_CACHE_VERSION,
            });
          } else {
            withCachedBoundaries = registerDiscoveredProvincialRegion(withCachedBoundaries, {
              ...meta,
              exactBoundaryVersion: EXACT_BOUNDARY_CACHE_VERSION,
            });
          }
        }
        fresh = withCachedBoundaries;
      }
      const cachedStartTile = cachedTiles.get(startTileKey);
      if (cachedStartTile && cachedStartTile.osmNodes.length > 0) {
        fresh = mergeOsmChunk(
          fresh,
          cachedStartTile.tileKey,
          cachedStartTile.osmNodes,
          cachedStartTile.osmEdges,
          undefined,
          { skipAutoSeed: true }
        );
      }

      soundManager.enabled = fresh.settings.soundEnabled;
      setActiveSlotIdState(targetSlotId);
      setActiveSlotId(targetSlotId);
      setGameState(fresh);
      const slotName = `슬롯 ${slotIndexFromId(targetSlotId)} · ${city.name}`;
      persistCurrentSlotLocally(fresh, targetSlotId, slotName);
      setFlyToTarget(null);
      setActiveModal(null);
      setScreenState('playing');
      updateLoadingSession(sessionId, 40, `${city.name} 도로망 수신 중`);

      try {
        if (localStorage.getItem(TUTORIAL_DONE_STORAGE_KEY) !== '1') {
          setTutorialStep(0);
          setTutorialOpen(true);
        }
      } catch {
        setTutorialStep(0);
        setTutorialOpen(true);
      }

      // Immediately resolve starting & neighboring administrative boundaries in parallel, without blocking on full road download
      void (async () => {
        setIsLoadingOsm(true);
        try {
          const initStartRegion = fresh.provincialRegions.find((r) => r.isStartingRegion);
          const startGuessName = initStartRegion?.regionName || city.name.split(' ')[0];
          const startKnownId =
            initStartRegion?.regionId &&
            (initStartRegion.regionId.startsWith('curated_') ||
              initStartRegion.regionId.startsWith('osm_rel_'))
              ? initStartRegion.regionId
              : undefined;

          void discoverNearbyProvinces(city.lat, city.lng);

          let resolvedStartBoundary: Awaited<ReturnType<typeof fetchProvincialRegionInfo>> = null;
          const startRegionInfoPromise = fetchProvincialRegionInfo(
            city.lat,
            city.lng,
            startKnownId,
            startGuessName
          )
            .then((info) => {
              resolvedStartBoundary = info;
              if (
                info &&
                loadingSessionRef.current === sessionId &&
                !isSyntheticFallbackRegion(info.regionId, info.regionName, info)
              ) {
                setGameState((prev) => {
                  if (!prev || loadingSessionRef.current !== sessionId) return prev;
                  let next = registerStartingProvincialRegion(prev, {
                    ...info,
                    exactBoundaryVersion:
                      info.exactBoundaryVersion ||
                      (info.boundaryGeoJson ? EXACT_BOUNDARY_CACHE_VERSION : undefined),
                  });
                  const hasUserSeeded =
                    next.stats.connectedOsmNodes > 0 &&
                    (next.pendingSeedRegionIds || []).length === 0;
                  const sId = next.provincialRegions.find((r) => r.isStartingRegion)?.regionId;
                  if (sId && !hasUserSeeded) {
                    next = {
                      ...next,
                      pendingSeedRegionIds: Array.from(
                        new Set([...(next.pendingSeedRegionIds || []), sId])
                      ),
                    };
                  }
                  return next;
                });
              }
              return info;
            })
            .catch(() => null);

          const fullCityData = await fetchOsmProvincialRegion(
            city.lat,
            city.lng,
            startGuessName,
            startKnownId,
            {
              onProgress: (pct, lbl) => {
                updateLoadingSession(
                  sessionId,
                  Math.max(40, Math.min(92, Math.round(35 + pct * 0.58))),
                  lbl || `${city.name} 도로망 수신 중`
                );
              },
            }
          );
          if (loadingSessionRef.current !== sessionId) return;
          updateLoadingSession(sessionId, 94, `${city.name} 교차로·철도 병합 중`);

          const startRegionInfo = resolvedStartBoundary || (await Promise.race([
            startRegionInfoPromise,
            new Promise<null>((r) => setTimeout(() => r(null), 150)),
          ]));

          let initialNodes = fullCityData.osmNodes;
          let initialEdges = fullCityData.osmEdges;
          let initialChunkKey = fullCityData.chunkKey;

          if (initialNodes.length === 0) {
            const starterChunk = await fetchOsmRoadChunk(city.lat, city.lng);
            if (loadingSessionRef.current !== sessionId) return;
            initialNodes = starterChunk.osmNodes;
            initialEdges = starterChunk.osmEdges;
            initialChunkKey = starterChunk.chunkKey;
          }

          setGameState((prev) => {
            if (!prev || loadingSessionRef.current !== sessionId) return prev;
            let next = prev;
            const regionMeta = startRegionInfo || {
              regionId: fullCityData.regionId,
              regionName: fullCityData.regionName || startGuessName,
              adminLevel: fullCityData.adminLevel,
              bbox: fullCityData.bbox,
              boundaryGeoJson: fullCityData.boundaryGeoJson,
              exactBoundaryVersion: fullCityData.boundaryGeoJson
                ? EXACT_BOUNDARY_CACHE_VERSION
                : undefined,
              centerLat: city.lat,
              centerLng: city.lng,
              totalNodeCount: fullCityData.totalNodeCount ?? initialNodes.length,
            };
            const hasUserSeeded =
              next.stats.connectedOsmNodes > 0 &&
              (next.pendingSeedRegionIds || []).length === 0;

            if (
              regionMeta.regionId &&
              !isSyntheticFallbackRegion(regionMeta.regionId, regionMeta.regionName, regionMeta)
            ) {
              next = registerStartingProvincialRegion(next, {
                ...regionMeta,
                boundaryGeoJson: regionMeta.boundaryGeoJson || fullCityData.boundaryGeoJson,
                exactBoundaryVersion:
                  regionMeta.exactBoundaryVersion ||
                  (regionMeta.boundaryGeoJson || fullCityData.boundaryGeoJson
                    ? EXACT_BOUNDARY_CACHE_VERSION
                    : undefined),
                totalNodeCount:
                  fullCityData.totalNodeCount > 0 ? fullCityData.totalNodeCount : initialNodes.length,
              });
            }

            const startRegionId = next.provincialRegions.find((r) => r.isStartingRegion)?.regionId;
            if (startRegionId && !hasUserSeeded) {
              next = {
                ...next,
                pendingSeedRegionIds: Array.from(
                  new Set([...(next.pendingSeedRegionIds || []), startRegionId])
                ),
              };
            }

            if (initialNodes.length > 0 || initialEdges.length > 0) {
              next = mergeOsmChunk(next, initialChunkKey, initialNodes, initialEdges, startRegionId, {
                skipAutoSeed: !hasUserSeeded,
                boundaryGeoJson: startRegionInfo?.boundaryGeoJson || fullCityData.boundaryGeoJson,
                totalNodeCount:
                  fullCityData.totalNodeCount > 0 ? fullCityData.totalNodeCount : initialNodes.length,
              });
            }
            return next;
          });

          completeLoadingSession(sessionId, `${city.name} 준비 완료`);
        } catch {
          completeLoadingSession(sessionId, '도로망 로드 완료');
        } finally {
          setIsLoadingOsm(false);
        }
      })();
    },
    [
      beginLoadingSession,
      completeLoadingSession,
      discoverNearbyProvinces,
      persistCurrentSlotLocally,
      updateLoadingSession,
    ]
  );

  const launchLoadedSlotState = useCallback(
    (loaded: GameState, slotId: SaveSlotId, skeleton?: BuiltSkeletonTuple[]) => {
      checkedProvinceCellsRef.current.clear();
      inFlightProvinceCellsRef.current.clear();
      inFlightChunkKeysRef.current.clear();
      settledEmptyChunkKeysRef.current.clear();
      chunkRetryCooldownRef.current.clear();
      if (batchDispatchTimerRef.current) {
        clearTimeout(batchDispatchTimerRef.current);
        batchDispatchTimerRef.current = null;
      }
      queuedBatchCoordsRef.current.clear();
      if (chunkFlushTimerRef.current) {
        clearTimeout(chunkFlushTimerRef.current);
        chunkFlushTimerRef.current = null;
      }
      pendingChunkQueueRef.current = [];
      hydratedRegionIdsRef.current.clear();
      hydrateAttemptsRef.current.clear();

      if (skeleton) {
        setBuiltSkeleton(skeleton);
      } else {
        setBuiltSkeleton(getLocalSlotBuiltSkeleton(slotId));
      }

      const mults = calculateMultipliers(loaded);
      const elapsedSec = Math.max(
        0,
        Math.min(7200, (Date.now() - (loaded.lastTickTimestamp || Date.now())) / 1000)
      );
      const incomeRate = calculateTotalIncomePerSec(loaded);
      const offlineEarned =
        elapsedSec > 10 ? Math.floor(incomeRate * elapsedSec * mults.offlineEfficiencyMult) : 0;

      const resumed: GameState = {
        ...loaded,
        capital: loaded.capital + offlineEarned,
        totalLifetimeEarnings: loaded.totalLifetimeEarnings + offlineEarned,
        lastTickTimestamp: Date.now(),
      };

      soundManager.enabled = resumed.settings.soundEnabled;
      setActiveSlotIdState(slotId);
      setActiveSlotId(slotId);
      setGameState(resumed);
      setFlyToTarget({
        lat: resumed.startingCity.lat,
        lng: resumed.startingCity.lng,
        zoom: resumed.startingCity.zoom,
        ts: Date.now(),
      });
      setActiveModal(null);
      setScreenState('playing');
      try {
        if (
          resumed.stats.totalOsmEdgesBuilt === 0 &&
          localStorage.getItem(TUTORIAL_DONE_STORAGE_KEY) !== '1'
        ) {
          const hasSeed =
            resumed.stats.connectedOsmNodes > 0 &&
            (resumed.pendingSeedRegionIds || []).length === 0;
          setTutorialStep(hasSeed ? 1 : 0);
          setTutorialOpen(true);
        }
      } catch {
        // Ignore storage errors
      }

      // Immediately hydrate missing real administrative boundaries from IndexedDB + live discovery
      const missingBoundaryRegions = (resumed.provincialRegions || []).filter(
        (r) =>
          !r.hasRealOsmBoundary ||
          !r.boundaryGeoJson ||
          (r.exactBoundaryVersion || 0) < EXACT_BOUNDARY_CACHE_VERSION
      );
      if (missingBoundaryRegions.length > 0) {
        void hydrateProvincialRegionsFromCache(missingBoundaryRegions)
          .then((cached) => {
            if (cached.size === 0) return;
            setGameState((prev) => {
              if (!prev) return prev;
              let next = prev;
              for (const meta of cached.values()) {
                next = registerDiscoveredProvincialRegion(next, {
                  ...meta,
                  exactBoundaryVersion: EXACT_BOUNDARY_CACHE_VERSION,
                });
              }
              return next;
            });
          })
          .catch(() => undefined);
      }
      const exactCount = (resumed.provincialRegions || []).filter(
        (r) => r.hasRealOsmBoundary && r.boundaryGeoJson
      ).length;
      if (exactCount < 4) {
        void discoverNearbyProvinces(resumed.startingCity.lat, resumed.startingCity.lng);
      }
    },
    [discoverNearbyProvinces]
  );

  // Helper: preserve live capital/ticks/skills accumulated since immediate entry when applying background graph hydration
  const mergeHydratedGraphPreservingLiveProgress = useCallback(
    (prev: GameState, hydrated: GameState): GameState => {
      const mergedRegions = (prev.provincialRegions || []).map((r) => {
        const fromHydrated = (hydrated.provincialRegions || []).find((h) => h.regionId === r.regionId);
        if (!fromHydrated) return r;
        const upgradeGeom = (fromHydrated.exactBoundaryVersion || 0) > (r.exactBoundaryVersion || 0);
        return {
          ...r,
          boundaryGeoJson: upgradeGeom
            ? fromHydrated.boundaryGeoJson || r.boundaryGeoJson
            : r.boundaryGeoJson || fromHydrated.boundaryGeoJson,
          hasRealOsmBoundary: Boolean(r.hasRealOsmBoundary || fromHydrated.hasRealOsmBoundary),
          exactBoundaryVersion:
            Math.max(r.exactBoundaryVersion || 0, fromHydrated.exactBoundaryVersion || 0) || undefined,
          totalNodeCount: Math.max(r.totalNodeCount || 0, fromHydrated.totalNodeCount || 0) || undefined,
        };
      });
      const prevRegionIds = new Set(mergedRegions.map((r) => r.regionId));
      for (const h of hydrated.provincialRegions || []) {
        if (!prevRegionIds.has(h.regionId)) mergedRegions.push(h);
      }

      const next: GameState = {
        ...prev,
        provincialRegions: mergedRegions,
        loadedOsmChunks: Array.from(
          new Set([...(hydrated.loadedOsmChunks || []), ...(prev.loadedOsmChunks || [])])
        ),
        loadedOsmRegions: Array.from(
          new Set([...(hydrated.loadedOsmRegions || []), ...(prev.loadedOsmRegions || [])])
        ),
        osmNodes: hydrated.osmNodes.length > 0 ? hydrated.osmNodes : prev.osmNodes,
        osmEdges: hydrated.osmEdges.length > 0 ? hydrated.osmEdges : prev.osmEdges,
      };
      return scopeGameStateToStartingCity(next, { trustedV2: true });
    },
    []
  );

  // Load any of the 5 local slots: instant map entry (<300ms) + IndexedDB & viewport-priority background streaming
  const handleLoadSlot = useCallback(
    async (slotId: SaveSlotId) => {
      if (busySlotIdRef.current) return;
      const localState = loadLocalSlotGameState(slotId);
      if (!localState) return;

      const streamMissingChunksProgressive = async (
        sessionId: number,
        chunkCoords: Array<{ key: string; lat: number; lng: number }>,
        startPct: number,
        endPct: number,
        labelPrefix: string
      ) => {
        if (chunkCoords.length === 0) return;
        const retryQueue: Array<{ key: string; lat: number; lng: number }> = [];
        const total = chunkCoords.length;
        let done = 0;

        const runBatch = async (
          slice: Array<{ key: string; lat: number; lng: number }>,
          allowRetryQueue: boolean
        ) => {
          const batchResults = await fetchOsmRoadChunksBatch(slice, {
            allowStarterFallback: false,
          });
          if (loadingSessionRef.current !== sessionId) return;

          const byKey = new Map(batchResults.map((r) => [r.chunkKey, r]));
          const payloads: Array<{
            chunkKey: string;
            osmNodes: GameState['osmNodes'];
            osmEdges: GameState['osmEdges'];
          }> = [];

          for (let j = 0; j < slice.length; j++) {
            const pt = slice[j];
            const res = byKey.get(pt.key);
            if (res && res.osmNodes.length > 0) {
              if (res.usedLiveOverpass || !allowRetryQueue) {
                payloads.push({
                  chunkKey: res.chunkKey,
                  osmNodes: res.osmNodes,
                  osmEdges: res.osmEdges,
                });
              } else {
                retryQueue.push(pt);
              }
            } else if (allowRetryQueue && (!res || !res.usedLiveOverpass)) {
              retryQueue.push(pt);
            }
          }

          if (payloads.length > 0) {
            setGameState((prev) => {
              if (!prev || loadingSessionRef.current !== sessionId) return prev;
              const batched = mergeOsmChunksBatch(prev, payloads, { skipAutoSeed: true });
              const applied = applyRestoredGraphMarks(batched, pendingRestoredMarksRef.current);
              if (pendingRestoredMarksRef.current) {
                const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(
                  applied,
                  pendingRestoredMarksRef.current
                );
                if (unhydratedNodes === 0 && unhydratedEdges === 0) {
                  pendingRestoredMarksRef.current = null;
                }
              }
              return applied;
            });
          }
        };

        for (let i = 0; i < chunkCoords.length; i += 24) {
          if (loadingSessionRef.current !== sessionId) return;
          const slice = chunkCoords.slice(i, i + 24);
          await runBatch(slice, true);
          done += slice.length;
          const frac = Math.min(1, done / Math.max(1, total));
          const pct = startPct + Math.round(frac * (endPct - startPct));
          updateLoadingSession(sessionId, pct, `${labelPrefix} (${Math.min(done, total)}/${total})`);
        }

        if (retryQueue.length > 0 && loadingSessionRef.current === sessionId) {
          await new Promise((r) => setTimeout(r, 200));
          for (let i = 0; i < retryQueue.length; i += 12) {
            if (loadingSessionRef.current !== sessionId) return;
            const slice = retryQueue.slice(i, i + 12);
            await runBatch(slice, false);
          }
        }
      };

      const localMarks = getLocalSlotGraphMarks(slotId);
      const connectedLocal = (localState.osmNodes || []).filter((n) => n.connected).length;
      const builtLocal = (localState.osmEdges || []).filter((e) => e.built).length;
      pendingRestoredMarksRef.current =
        localMarks &&
        (localMarks.connectedNodeIds.size > connectedLocal ||
          localMarks.builtEdgeIds.size > builtLocal)
          ? localMarks
          : null;
      const skeleton = getLocalSlotBuiltSkeleton(slotId);
      launchLoadedSlotState(localState, slotId, skeleton);

      const sessionId = beginLoadingSession('캐시 도로망 복원 중', 20);
      void (async () => {
        try {
          let workingState = stateRef.current || localState;
          const idbHydrated = await hydrateLocalSlotGraphFromIndexedDb(slotId, workingState);
          if (loadingSessionRef.current !== sessionId) return;

          if (idbHydrated) {
            updateLoadingSession(sessionId, 45, '저장된 도로·철도 그래프 복원 완료');
            workingState = idbHydrated;
            setGameState((prev) => {
              if (!prev) return prev;
              const merged = mergeHydratedGraphPreservingLiveProgress(prev, idbHydrated);
              return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
            });
          } else {
            updateLoadingSession(sessionId, 38, '지역 타일 캐시 확인 중');
          }

          // Hydrate any missing administrative boundary GeoJSONs from IndexedDB
          const cachedBoundaries = await hydrateProvincialRegionsFromCache(
            workingState.provincialRegions || []
          );
          if (loadingSessionRef.current !== sessionId) return;

          // Collect ALL expected chunk keys from loadedOsmChunks + customBridgeEdges + viewport + city center
          const targetKeys = new Set<string>(workingState.loadedOsmChunks || []);
          if (localMarks) {
            for (const ce of localMarks.customBridgeEdges) {
              if (ce.coordinates.length >= 2) {
                targetKeys.add(chunkKeyForCoords(ce.coordinates[0][0], ce.coordinates[0][1]));
                targetKeys.add(
                  chunkKeyForCoords(
                    ce.coordinates[ce.coordinates.length - 1][0],
                    ce.coordinates[ce.coordinates.length - 1][1]
                  )
                );
              }
            }
          }
          targetKeys.add(
            chunkKeyForCoords(workingState.startingCity.lat, workingState.startingCity.lng)
          );
          const vpBounds = viewportBoundsRef.current;
          if (vpBounds) {
            for (const vt of enumerateChunkKeysForBounds(vpBounds, 12)) {
              targetKeys.add(vt.key);
            }
          }

          const representedChunks = new Set<string>();
          for (const n of workingState.osmNodes || []) {
            representedChunks.add(chunkKeyForCoords(n.lat, n.lng));
          }
          const missingTileKeys = Array.from(targetKeys).filter((k) => !representedChunks.has(k));

          const remainingMarks = pendingRestoredMarksRef.current
            ? countUnhydratedGraphMarks(workingState, pendingRestoredMarksRef.current)
            : { unhydratedNodes: 0, unhydratedEdges: 0 };
          const isGraphAlreadyComplete =
            (workingState.osmNodes || []).length > 0 &&
            remainingMarks.unhydratedNodes === 0 &&
            remainingMarks.unhydratedEdges === 0;

          const cachedTilesMap =
            missingTileKeys.length > 0 && !isGraphAlreadyComplete
              ? await readCachedOsmTilesForKeys(missingTileKeys)
              : new Map();
          if (loadingSessionRef.current !== sessionId) return;

          if (cachedBoundaries.size > 0 || cachedTilesMap.size > 0) {
            updateLoadingSession(sessionId, 60, '행정경계·타일 캐시 적용 중');
            const tilePayloads = Array.from(cachedTilesMap.values()).map((t) => ({
              chunkKey: t.tileKey,
              osmNodes: t.osmNodes,
              osmEdges: t.osmEdges,
            }));
            const boundaryMap = new Map<
              string,
              { boundaryGeoJson?: GeoJsonBoundary; totalNodeCount?: number }
            >();
            for (const [rid, meta] of cachedBoundaries.entries()) {
              boundaryMap.set(rid, { boundaryGeoJson: meta.boundaryGeoJson });
            }
            setGameState((prev) => {
              if (!prev || loadingSessionRef.current !== sessionId) return prev;
              const batched = mergeOsmChunksBatch(prev, tilePayloads, {
                skipAutoSeed: prev.stats.connectedOsmNodes > 0,
                boundaryMap,
              });
              return applyRestoredGraphMarks(batched, pendingRestoredMarksRef.current);
            });
          }

          // Stream any still-missing chunks only when graph nodes/marks are incomplete
          const refLat = vpBounds
            ? (vpBounds.minLat + vpBounds.maxLat) / 2
            : workingState.startingCity.lat;
          const refLng = vpBounds
            ? (vpBounds.minLng + vpBounds.maxLng) / 2
            : workingState.startingCity.lng;

          const uncachedMissingCoords = isGraphAlreadyComplete
            ? []
            : missingTileKeys
                .filter((k) => !cachedTilesMap.has(k))
                .map((k) => {
                  const parsed = parseChunkKeyCoords(k);
                  return parsed ? { key: k, ...parsed } : null;
                })
                .filter((pt): pt is { key: string; lat: number; lng: number } => Boolean(pt))
                .sort((a, b) => {
                  const da = (a.lat - refLat) ** 2 + (a.lng - refLng) ** 2;
                  const db = (b.lat - refLat) ** 2 + (b.lng - refLng) ** 2;
                  return da - db;
                });

          if (uncachedMissingCoords.length > 0) {
            setIsLoadingOsm(true);
            await streamMissingChunksProgressive(
              sessionId,
              uncachedMissingCoords,
              62,
              96,
              '누락 도로 타일 복원 중'
            );
          }

          // Safety net if still 0 OSM nodes after tile streaming
          const afterCacheState = stateRef.current;
          if (
            afterCacheState &&
            (afterCacheState.osmNodes || []).length === 0 &&
            (workingState.osmNodes || []).length === 0
          ) {
            updateLoadingSession(sessionId, 82, '화면 주변 도로 데이터 수신 중');
            setIsLoadingOsm(true);
            const startRegion = afterCacheState.provincialRegions.find((r) => r.isStartingRegion);
            const regionData = await fetchOsmProvincialRegion(
              afterCacheState.startingCity.lat,
              afterCacheState.startingCity.lng,
              startRegion?.regionName,
              startRegion?.regionId
            );
            let finalChunkKey = regionData.chunkKey;
            let finalNodes = regionData.osmNodes;
            let finalEdges = regionData.osmEdges;
            let finalTotal = regionData.totalNodeCount ?? finalNodes.length;
            if (finalNodes.length === 0 && !regionData.usedLiveOverpass) {
              const fallbackChunk = await fetchOsmRoadChunk(
                afterCacheState.startingCity.lat,
                afterCacheState.startingCity.lng,
                { allowStarterFallback: true }
              );
              finalChunkKey = fallbackChunk.chunkKey;
              finalNodes = fallbackChunk.osmNodes;
              finalEdges = fallbackChunk.osmEdges;
              finalTotal = Math.max(finalTotal, finalNodes.length);
            }
            if (loadingSessionRef.current === sessionId && (finalNodes.length > 0 || finalEdges.length > 0)) {
              setGameState((prev) => {
                if (!prev || loadingSessionRef.current !== sessionId) return prev;
                const merged = mergeOsmChunk(
                  prev,
                  finalChunkKey,
                  finalNodes,
                  finalEdges,
                  startRegion?.regionId || regionData.regionId,
                  {
                    skipAutoSeed: prev.stats.connectedOsmNodes > 0,
                    boundaryGeoJson: regionData.boundaryGeoJson,
                    totalNodeCount: finalTotal,
                  }
                );
                return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
              });
            }
          }

          const finalState = stateRef.current;
          if (finalState && loadingSessionRef.current === sessionId) {
            const hadPendingMarks = Boolean(pendingRestoredMarksRef.current);
            const healed = hadPendingMarks
              ? applyRestoredGraphMarks(
                  finalState,
                  pendingRestoredMarksRef.current,
                  { healGaps: true }
                )
              : finalState;
            pendingRestoredMarksRef.current = null;
            if (healed !== finalState) {
              setGameState(healed);
              saveLocalSlotGameState(slotId, healed, {
                pendingMarks: null,
              });
              void saveLocalSlotGraphToIndexedDb(slotId, healed).catch(() => undefined);
              setLocalSlots(listLocalSlotSummaries());
            }
          }
          const curCity = stateRef.current?.startingCity || localState.startingCity;
          void discoverNearbyProvinces(curCity.lat, curCity.lng);
          completeLoadingSession(sessionId, '도로망 복원 완료');
        } catch {
          completeLoadingSession(sessionId, '도로망 복원 완료');
        } finally {
          setIsLoadingOsm(false);
        }
      })();
    },
    [
      beginLoadingSession,
      completeLoadingSession,
      discoverNearbyProvinces,
      launchLoadedSlotState,
      mergeHydratedGraphPreservingLiveProgress,
      updateLoadingSession,
    ]
  );

  const handleSaveToSlot = useCallback(
    async (slotId: SaveSlotId) => {
      const current = stateRef.current;
      if (!current) return;
      setBusySlot(slotId);
      try {
        setActiveSlotIdState(slotId);
        setActiveSlotId(slotId);
        const existingSummary = localSlotsRef.current[slotId];
        const preservedName =
          existingSummary && existingSummary.cityId === current.startingCity.id
            ? existingSummary.slotName
            : undefined;
        persistCurrentSlotLocally(current, slotId, preservedName);
      } finally {
        setBusySlot(null);
      }
    },
    [persistCurrentSlotLocally, setBusySlot]
  );

  const handleRenameSlot = useCallback(async (slotId: SaveSlotId, newName: string) => {
    const trimmed = newName.trim().slice(0, 60);
    if (!trimmed) return;
    renameLocalSlot(slotId, trimmed);
    setLocalSlots(listLocalSlotSummaries());
  }, []);

  const handleDeleteSlot = useCallback(
    async (slotId: SaveSlotId) => {
      setBusySlot(slotId);
      try {
        deleteLocalSlotGameState(slotId);
        setLocalSlots(listLocalSlotSummaries());
      } finally {
        setBusySlot(null);
      }
    },
    [setBusySlot]
  );

  const handleExportSlot = useCallback(
    async (slotId: SaveSlotId) => {
      const useLiveState =
        screenState === 'playing' && activeSlotIdRef.current === slotId && stateRef.current;

      let exportState: GameState | null = useLiveState
        ? stateRef.current!
        : loadLocalSlotGameState(slotId);

      if (!exportState) {
        throw new Error('내보낼 슬롯 데이터가 비어 있습니다.');
      }

      if (!useLiveState && typeof indexedDB !== 'undefined') {
        try {
          const idbHydrated = await hydrateLocalSlotGraphFromIndexedDb(slotId, exportState);
          if (idbHydrated) exportState = idbHydrated;
        } catch {
          // Keep core state fallback
        }
      }

      const existingSummary = localSlotsRef.current[slotId];
      const slotName =
        existingSummary?.slotName ||
        `슬롯 ${slotIndexFromId(slotId)} · ${exportState.startingCity.name}`;
      const savedAt = Date.now();
      const pendingMarks = useLiveState
        ? pendingRestoredMarksRef.current
        : getLocalSlotGraphMarks(slotId);

      if (useLiveState) {
        persistCurrentSlotLocally(exportState, slotId, slotName, savedAt);
      }

      const code = await exportSaveToString(exportState, {
        slotName,
        savedAt,
        pendingMarks,
      });
      const summary = buildSummaryFromState(slotId, exportState, {
        slotName,
        clientSavedAt: savedAt,
        source: 'local',
      });
      const safeCity =
        (exportState.startingCity.name || 'city').replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'city';
      const fileName = `road-incremental-slot${slotIndexFromId(slotId)}-${safeCity}.txt`;

      return { code, summary, fileName };
    },
    [persistCurrentSlotLocally, screenState]
  );

  const handleImportSave = useCallback(
    async (targetSlotId: SaveSlotId, preview: DecodedImportPreview, launchNow: boolean) => {
      setBusySlot(targetSlotId);
      try {
        await importDecodedSaveIntoSlot(targetSlotId, preview, {
          slotName: preview.slotName,
        });
        setLocalSlots(listLocalSlotSummaries());

        if (launchNow) {
          pendingRestoredMarksRef.current = null;
          const skeleton = getLocalSlotBuiltSkeleton(targetSlotId);
          launchLoadedSlotState(preview.state, targetSlotId, skeleton);
          void discoverNearbyProvinces(
            preview.state.startingCity.lat,
            preview.state.startingCity.lng
          );
        }
      } finally {
        setBusySlot(null);
      }
    },
    [discoverNearbyProvinces, launchLoadedSlotState, setBusySlot]
  );

  // Support ?autostart=1 URL query param for instant entry
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      autoStartedRef.current = true;
      const slotId = activeSlotIdRef.current;
      const saved = loadLocalSlotGameState(slotId);
      if (saved) {
        launchLoadedSlotState(saved, slotId);
        return;
      }
      const seoul = PRESET_CITIES.find((c) => c.id === 'seoul') || PRESET_CITIES[0];
      if (seoul) {
        void handleStartWithCity(seoul, slotId);
      }
    }
  }, [handleStartWithCity, launchLoadedSlotState]);

  // Background-schedule province discovery & adjacent chunk streaming off the click render path
  useEffect(() => {
    if (screenState !== 'playing') return;
    const timer = setTimeout(() => {
      const cur = stateRef.current;
      if (!cur) return;

      const provSeen = new Map<string, [number, number]>();
      const chunkSeen = new Map<string, [number, number]>();
      const loadedSet = new Set(cur.loadedOsmChunks || []);
      const nodes = cur.osmNodes || [];

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!n.connected) continue;

        const cellKey = `${(Math.round(n.lat * 25) / 25).toFixed(3)}_${(
          Math.round(n.lng * 25) / 25
        ).toFixed(3)}`;
        if (
          !checkedProvinceCellsRef.current.has(cellKey) &&
          !inFlightProvinceCellsRef.current.has(cellKey) &&
          !provSeen.has(cellKey)
        ) {
          provSeen.set(cellKey, [n.lat, n.lng]);
        }

        const ck = chunkKeyForCoords(n.lat, n.lng);
        const cd = chunkRetryCooldownRef.current.get(ck);
        if (
          !loadedSet.has(ck) &&
          !settledEmptyChunkKeysRef.current.has(ck) &&
          (!cd || cd.retryAfter <= Date.now()) &&
          !chunkSeen.has(ck)
        ) {
          chunkSeen.set(ck, [n.lat, n.lng]);
        }
      }

      provSeen.forEach(([lat, lng]) => {
        void handleAutoLoadProvince(lat, lng);
      });

      const batchCoords: Array<{ lat: number; lng: number }> = [];
      chunkSeen.forEach(([lat, lng]) => {
        batchCoords.push({ lat, lng });
      });

      const proximityChunks = getProximityAdjacentChunksToLoad(cur, 12);
      const now = Date.now();
      for (let i = 0; i < proximityChunks.length; i++) {
        const c = proximityChunks[i];
        const cd = chunkRetryCooldownRef.current.get(c.key);
        if (
          !settledEmptyChunkKeysRef.current.has(c.key) &&
          !chunkSeen.has(c.key) &&
          (!cd || cd.retryAfter <= now)
        ) {
          chunkSeen.set(c.key, [c.lat, c.lng]);
          batchCoords.push({ lat: c.lat, lng: c.lng });
        }
      }
      if (batchCoords.length > 0) {
        handleLoadOsmChunksBatch(batchCoords);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [
    screenState,
    gameState?.stats.connectedOsmNodes,
    gameState?.stats.totalOsmEdgesBuilt,
    gameState?.loadedOsmChunks,
    gameState?.provincialRegions,
    handleAutoLoadProvince,
    handleLoadOsmChunksBatch,
  ]);

  // Safety net: if playing with 0 OSM nodes and no active loader, retry loading starting city automatically
  const hasAnyOsmNodes = (gameState?.osmNodes || []).length > 0;
  const isLoadingSessionActive = Boolean(loadingProgress?.active);
  useEffect(() => {
    if (screenState !== 'playing' || !gameState || hasAnyOsmNodes || isLoadingSessionActive) {
      return;
    }
    const { lat, lng } = gameState.startingCity;
    handleLoadOsmChunk(lat, lng);
    const timer = setInterval(() => {
      handleLoadOsmChunk(lat, lng);
    }, 3500);
    return () => clearInterval(timer);
  }, [
    screenState,
    hasAnyOsmNodes,
    isLoadingSessionActive,
    gameState?.startingCity.id,
    handleLoadOsmChunk,
  ]);

  // Lazily hydrate real OSM administrative boundaries for ALL regions (unlocked -> expandable -> remaining provinces)
  const regionBoundaryMissingSig = useMemo(() => {
    if (screenState !== 'playing' || !gameState) return '';
    const allRegions = gameState.provincialRegions || [];
    const unlocked = allRegions.filter((r) => r.unlocked);
    const expandable = getExpandableProvincialRegions(gameState);
    const expandableIds = new Set(expandable.map((r) => r.regionId));
    const remaining = allRegions.filter(
      (r) => !r.unlocked && !expandableIds.has(r.regionId)
    );
    return [...unlocked, ...expandable, ...remaining]
      .filter(
        (r) =>
          (!r.hasRealOsmBoundary ||
            !r.boundaryGeoJson ||
            (r.exactBoundaryVersion || 0) < EXACT_BOUNDARY_CACHE_VERSION) &&
          !hydratedRegionIdsRef.current.has(r.regionId) &&
          (hydrateAttemptsRef.current.get(r.regionId) || 0) < 6
      )
      .map(
        (r) =>
          `${r.regionId}::${r.regionName}::${r.centerLat.toFixed(4)},${r.centerLng.toFixed(4)}`
      )
      .join('|');
  }, [screenState, gameState?.provincialRegions, boundaryRetryTick]);

  useEffect(() => {
    if (screenState !== 'playing' || !regionBoundaryMissingSig) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const allPending = regionBoundaryMissingSig
      .split('|')
      .map((entry) => {
        const parts = entry.split('::');
        if (parts.length < 3) return null;
        const regionId = parts[0];
        const regionName = parts.slice(1, -1).join('::');
        const [latStr, lngStr] = parts[parts.length - 1].split(',');
        const lat = Number(latStr);
        const lng = Number(lngStr);
        if (!regionId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { regionId, regionName, lat, lng };
      })
      .filter((x): x is { regionId: string; regionName: string; lat: number; lng: number } => Boolean(x));

    void (async () => {
      // Fast IndexedDB cache pass across all pending regions before issuing network calls
      const currentRegions = stateRef.current?.provincialRegions || [];
      const pendingSet = new Set(allPending.map((p) => p.regionId));
      const pendingTargets = currentRegions.filter((r) => pendingSet.has(r.regionId));
      const idbHits =
        pendingTargets.length > 0
          ? await hydrateProvincialRegionsFromCache(pendingTargets).catch(() => new Map())
          : new Map();
      if (cancelled) return;

      if (idbHits.size > 0) {
        for (const rid of idbHits.keys()) {
          hydratedRegionIdsRef.current.add(rid);
        }
        setGameState((prev) => {
          if (!prev) return prev;
          let next = prev;
          for (const meta of idbHits.values()) {
            next = registerDiscoveredProvincialRegion(next, {
              ...meta,
              exactBoundaryVersion: EXACT_BOUNDARY_CACHE_VERSION,
            });
          }
          return next;
        });
      }

      const netPending = allPending.filter((p) => !idbHits.has(p.regionId));
      const items = netPending.slice(0, 4);
      let needsNextPass = netPending.length > items.length;

      if (items.length > 0) {
        const results = await Promise.allSettled(
          items.map(async (item) => {
            const attempts = hydrateAttemptsRef.current.get(item.regionId) || 0;
            hydrateAttemptsRef.current.set(item.regionId, attempts + 1);
            const info = await fetchProvincialRegionInfo(
              item.lat,
              item.lng,
              item.regionId,
              item.regionName
            );
            return { item, attempts, info };
          })
        );
        if (cancelled) return;

        const validUpdates: Array<{
          item: { regionId: string; regionName: string };
          info: NonNullable<Awaited<ReturnType<typeof fetchProvincialRegionInfo>>>;
        }> = [];
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { item, attempts, info } = r.value;
            if (
              info &&
              info.boundaryGeoJson &&
              !isSyntheticFallbackRegion(info.regionId, info.regionName, info)
            ) {
              hydratedRegionIdsRef.current.add(item.regionId);
              validUpdates.push({ item, info });
            } else if (attempts + 1 < 6) {
              needsNextPass = true;
            }
          } else {
            needsNextPass = true;
          }
        }

        if (validUpdates.length > 0) {
          setGameState((prev) => {
            if (!prev) return prev;
            let next = prev;
            for (const { item, info } of validUpdates) {
              next = registerDiscoveredProvincialRegion(next, {
                ...info,
                exactBoundaryVersion: info.exactBoundaryVersion || EXACT_BOUNDARY_CACHE_VERSION,
                regionName: info.regionName || item.regionName,
              });
            }
            return next;
          });
        }
      }

      if (needsNextPass && !cancelled) {
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            setBoundaryRetryTick((t) => t + 1);
          }
        }, 350);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [screenState, regionBoundaryMissingSig]);

  // Simulation loop (~10Hz state tick via requestAnimationFrame)
  useEffect(() => {
    if (screenState !== 'playing') return;

    let rafId = 0;
    let lastTime = performance.now();
    let accSec = 0;

    const frame = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      accSec += delta;

      if (accSec >= 0.1) {
        const step = Math.min(accSec, 0.25);
        accSec = 0;

        setGameState((prev) => {
          if (!prev) return prev;
          const res = advanceTick(prev, step);
          if (res.newlyUnlockedAchievements.length > 0) {
            queueMicrotask(() => {
              announceAchievements(res.newlyUnlockedAchievements);
            });
          }
          if (res.newlyUnlockedMilestones.length > 0) {
            queueMicrotask(() => {
              announceMilestones(res.newlyUnlockedMilestones);
            });
          }
          return res.newState;
        });
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [screenState, announceAchievements, announceMilestones]);

  // Auto-save locally every 8 seconds and on page hide / tab background
  useEffect(() => {
    if (screenState !== 'playing') return;
    const persistState = () => {
      if (!stateRef.current) return;
      persistCurrentSlotLocally(stateRef.current, activeSlotIdRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistState();
      }
    };
    const localTimer = setInterval(persistState, 8000);
    window.addEventListener('pagehide', persistState);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(localTimer);
      window.removeEventListener('pagehide', persistState);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [screenState, persistCurrentSlotLocally]);

  // Game Actions (Strictly Node-to-Node Linking on Map)
  const handleConnectOsmPath = useCallback(
    (fromId: string, toId: string) => {
      setGameState((prev) => {
        if (!prev) return prev;
        const res = connectOsmPath(prev, fromId, toId);
        if (!res.success) return prev;
        soundManager.playBlip();
        if (res.newlyUnlockedAchievements.length > 0) {
          queueMicrotask(() => {
            announceAchievements(res.newlyUnlockedAchievements);
          });
        }
        return res.newState;
      });
    },
    [announceAchievements]
  );

  const handleUnlockSkill = useCallback(
    (skillId: string) => {
      setGameState((prev) => {
        if (!prev) return prev;
        const res = unlockSkill(prev, skillId);
        if (!res.success) return prev;
        soundManager.playUpgradeUnlocked();
        if (res.newlyUnlockedAchievements.length > 0) {
          queueMicrotask(() => {
            announceAchievements(res.newlyUnlockedAchievements);
          });
        }
        return res.newState;
      });
    },
    [announceAchievements]
  );

  const handleBuyMaxSkill = useCallback(
    (skillId: string) => {
      setGameState((prev) => {
        if (!prev) return prev;
        const res = buyMaxSkill(prev, skillId);
        if (!res.success) return prev;
        soundManager.playUpgradeUnlocked();
        if (res.newlyUnlockedAchievements.length > 0) {
          queueMicrotask(() => {
            announceAchievements(res.newlyUnlockedAchievements);
          });
        }
        return res.newState;
      });
    },
    [announceAchievements]
  );

  const handleBuyAllSkills = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const res = buyAllAffordableSkills(prev);
      if (!res.success) return prev;
      soundManager.playUpgradeUnlocked();
      if (res.newlyUnlockedAchievements.length > 0) {
        queueMicrotask(() => {
          announceAchievements(res.newlyUnlockedAchievements);
        });
      }
      return res.newState;
    });
  }, [announceAchievements]);

  const handleResetSkillTree = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const res = resetSkillTree(prev);
      if (!res.success) return prev;
      soundManager.playBlip();
      return res.newState;
    });
  }, []);

  const handleDispatchClick = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const res = dispatchClickBonus(prev);
      soundManager.playCashRegister();
      return res.newState;
    });
  }, []);

  const handleToggleSound = useCallback(() => {
    setGameState((prev) => {
      if (!prev) return prev;
      const nextEnabled = !prev.settings.soundEnabled;
      soundManager.enabled = nextEnabled;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          soundEnabled: nextEnabled,
        },
      };
    });
  }, []);

  const handleOpenCityReset = useCallback(() => {
    if (stateRef.current) {
      persistCurrentSlotLocally(stateRef.current, activeSlotIdRef.current);
    }
    setActiveModal(null);
    setScreenState('title');
  }, [persistCurrentSlotLocally]);

  const handleFocusMap = useCallback((lat: number, lng: number, zoom: number) => {
    setFlyToTarget({ lat, lng, zoom, ts: Date.now() });
  }, []);

  const handleUnlockRegion = useCallback(
    async (regionId: string) => {
      if (unlockingRegionRef.current) return;
      const current = stateRef.current;
      if (!current) return;
      const target = (current.provincialRegions || []).find((r) => r.regionId === regionId);
      if (!target || target.unlocked) return;

      const cost = getRegionUnlockCost(current, target);
      if (current.capital < cost) return;

      unlockingRegionRef.current = regionId;
      setUnlockingRegionId(regionId);
      setIsLoadingOsm(true);
      const sessionId = beginLoadingSession(`${target.regionName} 도로망 로드 중`, 12);
      try {
        let regionData = await fetchOsmProvincialRegion(
          target.centerLat,
          target.centerLng,
          target.regionName,
          target.regionId,
          {
            allowStarterFallback: false,
            onProgress: (pct, lbl) => {
              updateLoadingSession(
                sessionId,
                Math.max(12, Math.min(94, pct)),
                lbl || `${target.regionName} 로드 중`
              );
            },
          }
        );
        if (regionData.osmNodes.length === 0 && !regionData.usedLiveOverpass) {
          updateLoadingSession(sessionId, 86, `${target.regionName} 보조 도로 확인 중`);
          const fallbackChunk = await fetchOsmRoadChunk(target.centerLat, target.centerLng, {
            allowStarterFallback: false,
          });
          regionData = {
            ...regionData,
            chunkKey: fallbackChunk.chunkKey,
            osmNodes: fallbackChunk.osmNodes,
            osmEdges: fallbackChunk.osmEdges,
            usedLiveOverpass: fallbackChunk.usedLiveOverpass,
            totalNodeCount: Math.max(regionData.totalNodeCount || 0, fallbackChunk.osmNodes.length),
          };
        }

        updateLoadingSession(sessionId, 96, `${target.regionName} 노드 연결 중`);
        let unlockSuccess = false;
        let wasIsolated = target.isIsolated;

        setGameState((prev) => {
          if (!prev) return prev;
          const res = unlockProvincialRegion(prev, regionId, {
            chunkKey: regionData.chunkKey,
            osmNodes: regionData.osmNodes,
            osmEdges: regionData.osmEdges,
            bbox: regionData.bbox || target.bbox,
            boundaryGeoJson: regionData.boundaryGeoJson,
            totalNodeCount: regionData.totalNodeCount ?? regionData.osmNodes.length,
            regionName: target.regionName,
          });
          if (!res.success) return prev;
          unlockSuccess = true;
          wasIsolated = res.isIsolated;
          return res.newState;
        });

        if (unlockSuccess) {
          soundManager.playUpgradeUnlocked();
          discoverNearbyProvinces(target.centerLat, target.centerLng);
          if (wasIsolated) {
            setActiveModal(null);
            setFlyToTarget({
              lat: target.centerLat,
              lng: target.centerLng,
              zoom: 15,
              ts: Date.now(),
            });
          }
          completeLoadingSession(sessionId, `${target.regionName} 해금 완료`);
        } else {
          completeLoadingSession(sessionId, `${target.regionName} 로드 완료`);
        }
      } catch {
        completeLoadingSession(sessionId, `${target.regionName} 로드 완료`);
      } finally {
        setIsLoadingOsm(false);
        unlockingRegionRef.current = null;
        setUnlockingRegionId(null);
      }
    },
    [beginLoadingSession, completeLoadingSession, discoverNearbyProvinces, updateLoadingSession]
  );

  const handleSelectIsolatedSeed = useCallback((nodeId: string) => {
    setGameState((prev) => {
      if (!prev) return prev;
      const res = selectIsolatedRegionSeed(prev, nodeId);
      if (!res.success) return prev;
      soundManager.playRouteBuilt();
      return res.newState;
    });
  }, []);

  const handleAdjustCapital = useCallback(
    (nextCapital: number, clampLifetime = true) => {
      let updated: GameState | null = null;
      setGameState((prev) => {
        if (!prev) return prev;
        updated = adjustGameCapital(prev, nextCapital, { clampLifetime });
        return updated;
      });
      queueMicrotask(() => {
        const cur = updated || stateRef.current;
        if (!cur) return;
        persistCurrentSlotLocally(cur, activeSlotIdRef.current);
      });
    },
    [persistCurrentSlotLocally]
  );

  const handleCompleteTutorial = useCallback(() => {
    setTutorialOpen(false);
    try {
      localStorage.setItem(TUTORIAL_DONE_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures
    }
  }, []);

  const handleToggleTutorial = useCallback(() => {
    setTutorialOpen((open) => !open);
  }, []);

  const handleReloadOsm = useCallback(() => {
    const cur = stateRef.current;
    if (!cur) return;
    settledEmptyChunkKeysRef.current.clear();
    chunkRetryCooldownRef.current.clear();
    void loadFullStartingCityIntoState(cur.startingCity.lat, cur.startingCity.lng);
  }, [loadFullStartingCityIntoState]);

  const handleOpenExpansionTab = useCallback(() => {
    setActiveModal('lines');
  }, []);

  useEffect(() => {
    if (!tutorialOpen || !gameState) return;
    const hasSeed =
      gameState.stats.connectedOsmNodes > 0 &&
      (gameState.pendingSeedRegionIds || []).length === 0;
    if (tutorialStep === 0 && hasSeed) {
      setTutorialStep(1);
    } else if (tutorialStep === 1 && gameState.stats.totalOsmEdgesBuilt > 0) {
      setTutorialStep(2);
    }
  }, [
    tutorialOpen,
    tutorialStep,
    gameState?.stats.connectedOsmNodes,
    gameState?.stats.totalOsmEdgesBuilt,
    gameState?.pendingSeedRegionIds,
  ]);

  const recommendedCapital = useMemo(
    () => (gameState ? getRecommendedBalancedCapital(gameState) : 1200),
    [
      gameState?.stats.connectedOsmNodes,
      gameState?.stats.totalOsmEdgesBuilt,
      gameState?.skills,
      gameState?.minigames.unlockedMilestoneIds.length,
    ]
  );

  return (
    <div className="w-full h-[100dvh] bg-[#080d18] text-slate-100 overflow-hidden select-none">
      {screenState === 'title' && (
        <TitleScreen
          activeSlotId={activeSlotId}
          slots={slotsRecord}
          busySlotId={busySlotId}
          loadingProgress={loadingProgress}
          onStartWithCity={handleStartWithCity}
          onLoadSlot={handleLoadSlot}
          onRenameSlot={handleRenameSlot}
          onDeleteSlot={handleDeleteSlot}
          onExportSlot={handleExportSlot}
          onImportSave={handleImportSave}
        />
      )}

      {screenState === 'playing' && gameState && (
        <>
          <WorldMap
            gameState={gameState}
            flyToTarget={flyToTarget}
            builtSkeleton={builtSkeleton}
            loadingProgress={loadingProgress}
            isLoadingOsm={isLoadingOsm}
            onReloadOsm={handleReloadOsm}
            onLoadOsmChunk={handleLoadOsmChunk}
            onLoadOsmChunksBatch={handleLoadOsmChunksBatch}
            onViewportChange={handleViewportChange}
            onConnectOsmPath={handleConnectOsmPath}
            onSelectIsolatedSeed={handleSelectIsolatedSeed}
            onUnlockRegion={handleUnlockRegion}
            unlockingRegionId={unlockingRegionId}
            onOpenExpansionTab={handleOpenExpansionTab}
            onBottomCardChange={setHasMapBottomCard}
          />

          <HUD
            gameState={gameState}
            activeModal={activeModal}
            hasMapBottomCard={hasMapBottomCard}
            activeSlotIndex={slotIndexFromId(activeSlotId)}
            tutorialOpen={tutorialOpen}
            onSelectModal={setActiveModal}
            onDispatchClick={handleDispatchClick}
            onToggleSound={handleToggleSound}
            onToggleTutorial={handleToggleTutorial}
            onOpenCityReset={handleOpenCityReset}
          />

          {tutorialOpen && !activeModal && (
            <TutorialGuide
              gameState={gameState}
              stepIndex={tutorialStep}
              onStepChange={setTutorialStep}
              onComplete={handleCompleteTutorial}
            />
          )}

          {activeModal === 'saves' && (
            <SaveSlotsModal
              onClose={() => setActiveModal(null)}
              activeSlotId={activeSlotId}
              slots={slotsRecord}
              busySlotId={busySlotId}
              onSaveToSlot={handleSaveToSlot}
              onLoadSlot={handleLoadSlot}
              onRenameSlot={handleRenameSlot}
              onDeleteSlot={handleDeleteSlot}
              onExportSlot={handleExportSlot}
              onImportSave={handleImportSave}
              currentCapital={gameState.capital}
              recommendedCapital={recommendedCapital}
              onAdjustCapital={handleAdjustCapital}
            />
          )}

          {activeModal === 'lines' && (
            <LinesPanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onFocusMap={handleFocusMap}
              onUnlockRegion={handleUnlockRegion}
              unlockingRegionId={unlockingRegionId}
              unlockProgressPct={loadingProgress?.active ? loadingProgress.percent : null}
            />
          )}

          {activeModal === 'skills' && (
            <SkillTreePanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onUnlockSkill={handleUnlockSkill}
              onBuyMaxSkill={handleBuyMaxSkill}
              onBuyAllSkills={handleBuyAllSkills}
              onResetSkillTree={handleResetSkillTree}
            />
          )}

          {activeModal === 'achievements' && (
            <AchievementsPanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
            />
          )}

          {activeModal === 'prestige' && (
            <PrestigePanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
            />
          )}

          {activeModal === 'arcade' && (
            <TownArcadePanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onUnlockMinigame={(gameId: MinigameId) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = unlockMinigame(prev, gameId);
                  if (!res.success) return prev;
                  soundManager.playRouteBuilt();
                  return res.newState;
                });
              }}
              onExchangeMoney={(gameId: MinigameId, moneyAmount: number) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = exchangeMoneyToMinigameCurrency(prev, gameId, moneyAmount);
                  if (!res.success) return prev;
                  soundManager.playCashRegister();
                  return res.newState;
                });
              }}
              onDigMine={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const nextMg: MinigamesState = {
                    ...prev.minigames,
                    mine: digMineLayer(prev.minigames.mine),
                  };
                  const evaluated = evaluateMinigameMilestones(nextMg);
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onTriggerMineSeismic={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const nextMine = triggerMineSeismicBlast(prev.minigames.mine);
                  if (nextMine === prev.minigames.mine) return prev;
                  soundManager.playRouteBuilt();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    mine: nextMine,
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onBuyMineUpgrade={(kind: MineUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyMineUpgrade(prev.minigames.mine, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, mine: res.mine } };
                });
              }}
              onPlaceReactorCell={(cellIndex: number, cellType: ReactorCellType) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = placeReactorCell(prev.minigames.reactor, cellIndex, cellType);
                  if (!res.success) return prev;
                  soundManager.playBlip();
                  return { ...prev, minigames: { ...prev.minigames, reactor: res.reactor } };
                });
              }}
              onVentReactor={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  return {
                    ...prev,
                    minigames: {
                      ...prev.minigames,
                      reactor: ventReactorHeat(prev.minigames.reactor),
                    },
                  };
                });
              }}
              onBuyReactorUpgrade={(kind: ReactorUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyReactorUpgrade(prev.minigames.reactor, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, reactor: res.reactor } };
                });
              }}
              onBoostShipyard={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    shipyard: boostShipyardChain(prev.minigames.shipyard),
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onBuyShipyardUnit={(kind: ShipyardUnitKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyShipyardUnit(prev.minigames.shipyard, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, shipyard: res.shipyard } };
                });
              }}
              onPrestigeShipyard={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = prestigeShipyardFleet(prev.minigames.shipyard);
                  if (!res.success) return prev;
                  soundManager.playRouteBuilt();
                  return { ...prev, minigames: { ...prev.minigames, shipyard: res.shipyard } };
                });
              }}
              onTuneQuantumWave={(channelIndex: 0 | 1 | 2, value: number) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  return {
                    ...prev,
                    minigames: {
                      ...prev.minigames,
                      quantum: tuneQuantumWave(prev.minigames.quantum, channelIndex, value),
                    },
                  };
                });
              }}
              onPulseQuantum={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    quantum: pulseQuantumExperiment(prev.minigames.quantum),
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onLeapQuantum={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = leapQuantumDimension(prev.minigames.quantum);
                  if (!res.success) return prev;
                  soundManager.playRouteBuilt();
                  return { ...prev, minigames: { ...prev.minigames, quantum: res.quantum } };
                });
              }}
              onBuyQuantumUpgrade={(kind: QuantumUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyQuantumUpgrade(prev.minigames.quantum, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, quantum: res.quantum } };
                });
              }}
              onSetSolarAngle={(angle: number) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  return {
                    ...prev,
                    minigames: {
                      ...prev.minigames,
                      solar: setSolarOrbitalAngle(prev.minigames.solar, angle),
                    },
                  };
                });
              }}
              onPulseSolar={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    solar: pulseSolarArray(prev.minigames.solar),
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onBuySolarUpgrade={(kind: SolarUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buySolarUpgrade(prev.minigames.solar, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, solar: res.solar } };
                });
              }}
              onCultivateBio={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    bio: cultivateBioDome(prev.minigames.bio),
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onMistBio={(delta: number) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  return {
                    ...prev,
                    minigames: {
                      ...prev.minigames,
                      bio: mistBioHumidity(prev.minigames.bio, delta),
                    },
                  };
                });
              }}
              onEvolveBio={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = evolveBioDome(prev.minigames.bio);
                  if (!res.success) return prev;
                  soundManager.playRouteBuilt();
                  return { ...prev, minigames: { ...prev.minigames, bio: res.bio } };
                });
              }}
              onBuyBioUpgrade={(kind: BioUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyBioUpgrade(prev.minigames.bio, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, bio: res.bio } };
                });
              }}
              onCollideParticles={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    collider: collideParticles(prev.minigames.collider),
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onBurstCollider={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const nextCol = triggerColliderBurst(prev.minigames.collider);
                  if (nextCol === prev.minigames.collider) return prev;
                  soundManager.playRouteBuilt();
                  const evaluated = evaluateMinigameMilestones({
                    ...prev.minigames,
                    collider: nextCol,
                  });
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return { ...prev, minigames: evaluated.minigames };
                });
              }}
              onBuyColliderUpgrade={(kind: ColliderUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyColliderUpgrade(prev.minigames.collider, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return { ...prev, minigames: { ...prev.minigames, collider: res.collider } };
                });
              }}
            />
          )}

          {/* Strictly Achievement-only Toast Notifications */}
          {toasts.length > 0 && (
            <div
              data-testid="achievement-toast-stack"
              className="fixed top-[116px] sm:top-auto sm:bottom-20 left-2 right-2 sm:left-auto sm:right-3 z-50 flex flex-col gap-2 sm:w-80 pointer-events-none"
              aria-live="polite"
            >
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  className="p-3.5 rounded-xl ui-glass border-amber-400/45 shadow-2xl flex items-start gap-2.5"
                >
                  <Award className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white leading-snug">{toast.title}</div>
                    <div className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                      {toast.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
