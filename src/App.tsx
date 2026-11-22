import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Award } from 'lucide-react';
import { User } from 'firebase/auth';
import { TitleScreen } from './components/TitleScreen';
import { WorldMap } from './components/WorldMap';
import { HUD, ModalTab } from './components/HUD';
import { LinesPanel } from './components/LinesPanel';
import { SkillTreePanel } from './components/SkillTreePanel';
import { AchievementsPanel } from './components/AchievementsPanel';
import { PrestigePanel } from './components/PrestigePanel';
import { TownArcadePanel } from './components/TownArcadePanel';
import { AccountViewInfo, SaveSlotsModal } from './components/SaveSlotsModal';
import { SaveConflictModal } from './components/SaveConflictModal';
import { TutorialGuide, TUTORIAL_DONE_STORAGE_KEY } from './components/TutorialGuide';
import { signInWithGoogle, signOutUser, subscribeToAuth } from './firebase';
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
  fetchProvincialRegionInfo,
  generateCustomCityNetwork,
  hydrateProvincialRegionsFromCache,
  parseChunkKeyCoords,
  readCachedOsmTilesForKeys,
} from './game/osmService';
import {
  applyRestoredGraphMarks,
  clearCloudSyncBaseline,
  countUnhydratedGraphMarks,
  deleteLocalSlotGameState,
  getActiveSlotId,
  getCloudSyncBaselineMap,
  getLocalSlotBuiltSkeleton,
  getLocalSlotGraphMarks,
  hydrateLocalSlotGraphFromIndexedDb,
  listLocalSlotSummaries,
  loadLocalSlotGameState,
  mergeSlotSummaries,
  renameLocalSlot,
  RestoredGraphMarks,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  saveLocalSlotGameState,
  setActiveSlotId,
  setCloudSyncBaseline,
  slotIndexFromId,
  updateLocalSlotTimestamp,
} from './game/saveSlots';
import { BuiltSkeletonTuple, ViewportBounds } from './game/osmOverview';
import {
  CloudDownloadResult,
  deleteCloudSlot,
  downloadCloudSlot,
  ensureUserProfile,
  fetchCloudSlotSummaries,
  formatCloudSyncError,
  renameCloudSlot,
  updateCloudActiveSlot,
  uploadSlotToCloud,
} from './game/cloudSync';
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
  const [cloudSlots, setCloudSlots] = useState<Partial<Record<SaveSlotId, SaveSlotSummary>>>({});
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  const [busySlotId, setBusySlotId] = useState<SaveSlotId | null>(null);
  const [syncBaseMap, setSyncBaseMap] = useState<Partial<Record<SaveSlotId, number>>>(() =>
    getCloudSyncBaselineMap()
  );
  const [conflictSlotId, setConflictSlotId] = useState<SaveSlotId | null>(null);
  const [conflictAction, setConflictAction] = useState<'load' | 'save' | 'sync'>('load');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

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
  const firebaseUserRef = useRef<User | null>(firebaseUser);
  firebaseUserRef.current = firebaseUser;
  const conflictSlotIdRef = useRef<SaveSlotId | null>(conflictSlotId);
  conflictSlotIdRef.current = conflictSlotId;
  const promptedConflictSigRef = useRef<Record<string, string>>({});
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
  const attemptedChunkKeysRef = useRef<Set<string>>(new Set());
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

  const mergedSlots = useMemo(
    () => mergeSlotSummaries(localSlots, cloudSlots, syncBaseMap),
    [localSlots, cloudSlots, syncBaseMap]
  );

  const localSlotsRef = useRef(localSlots);
  localSlotsRef.current = localSlots;
  const cloudSlotsRef = useRef(cloudSlots);
  cloudSlotsRef.current = cloudSlots;
  const mergedSlotsRef = useRef(mergedSlots);
  mergedSlotsRef.current = mergedSlots;

  const accountInfo = useMemo<AccountViewInfo | null>(() => {
    if (!firebaseUser) return null;
    return {
      uid: firebaseUser.uid,
      displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || '플레이어',
      email: firebaseUser.email || '',
      photoURL: firebaseUser.photoURL || '',
    };
  }, [firebaseUser]);

  const openConflictModal = useCallback(
    (slotId: SaveSlotId, action: 'load' | 'save' | 'sync' = 'load') => {
      setConflictAction(action);
      setConflictError(null);
      setConflictSlotId(slotId);
    },
    []
  );

  const refreshCloudForUser = useCallback(async (user: User, options?: { promptConflict?: boolean }) => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const cloudActive = await ensureUserProfile(user, activeSlotIdRef.current);
      const summaries = await fetchCloudSlotSummaries(user.uid);
      const freshLocal = listLocalSlotSummaries();
      const freshBase = getCloudSyncBaselineMap();
      setLocalSlots(freshLocal);
      setSyncBaseMap(freshBase);
      setCloudSlots(summaries);
      setLastCloudSyncAt(Date.now());
      if (Object.keys(freshLocal).length === 0 && summaries[cloudActive]) {
        setActiveSlotIdState(cloudActive);
        setActiveSlotId(cloudActive);
      }

      if (options?.promptConflict !== false && !conflictSlotIdRef.current) {
        const nextMerged = mergeSlotSummaries(freshLocal, summaries, freshBase);
        const checkOrder: SaveSlotId[] = [
          activeSlotIdRef.current,
          ...SAVE_SLOT_IDS.filter((id) => id !== activeSlotIdRef.current),
        ];
        const firstConflict = checkOrder.find((id) => nextMerged[id]?.hasConflict);
        if (firstConflict && freshLocal[firstConflict] && summaries[firstConflict]) {
          const sig = `${freshLocal[firstConflict]!.clientSavedAt}_${summaries[firstConflict]!.clientSavedAt}`;
          if (promptedConflictSigRef.current[firstConflict] !== sig) {
            promptedConflictSigRef.current[firstConflict] = sig;
            setConflictAction('load');
            setConflictError(null);
            setConflictSlotId(firstConflict);
          }
        }
      }
    } catch (err) {
      setSyncError(
        formatCloudSyncError(err, '클라우드 저장 목록을 불러오지 못했습니다.')
      );
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      if (user) {
        void refreshCloudForUser(user, { promptConflict: true });
      } else {
        setCloudSlots({});
        setConflictSlotId(null);
        setSyncError(null);
      }
    });
    return () => unsubscribe();
  }, [refreshCloudForUser]);

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
      const merged = mergeOsmChunksBatch(prev, entries, { skipAutoSeed });
      return applyRestoredGraphMarks(merged, pendingRestoredMarksRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (chunkFlushTimerRef.current) {
        clearTimeout(chunkFlushTimerRef.current);
        chunkFlushTimerRef.current = null;
      }
      pendingChunkQueueRef.current = [];
    };
  }, []);

  // Load OpenStreetMap dense street/rail chunk around coordinates (only for unlocked regions)
  const handleLoadOsmChunk = useCallback(
    async (lat: number, lng: number) => {
      const curState = stateRef.current;
      let owningRegionId: string | undefined;
      if (curState) {
        const regions = curState.provincialRegions || [];
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
        if (!unlockedMatch && regions.some((r) => r.unlocked)) {
          return;
        }
        owningRegionId = unlockedMatch?.regionId;
      }

      const key = chunkKeyForCoords(lat, lng);
      if (inFlightChunkKeysRef.current.has(key) || attemptedChunkKeysRef.current.has(key)) return;
      inFlightChunkKeysRef.current.add(key);
      setIsLoadingOsm(true);
      try {
        const chunk = await fetchOsmRoadChunk(lat, lng, { allowStarterFallback: false });
        attemptedChunkKeysRef.current.add(key);
        if (chunk.osmNodes.length > 0 || chunk.osmEdges.length > 0) {
          pendingChunkQueueRef.current.push({
            chunkKey: chunk.chunkKey,
            osmNodes: chunk.osmNodes,
            osmEdges: chunk.osmEdges,
            owningRegionId,
          });
          if (pendingChunkQueueRef.current.length >= 6) {
            flushPendingOsmChunks();
          } else if (!chunkFlushTimerRef.current) {
            chunkFlushTimerRef.current = setTimeout(flushPendingOsmChunks, 65);
          }
        }
      } finally {
        inFlightChunkKeysRef.current.delete(key);
        setIsLoadingOsm(inFlightChunkKeysRef.current.size > 0);
      }
    },
    [flushPendingOsmChunks]
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
    setIsLoadingOsm(true);
    try {
      const targetReg = stateRef.current?.provincialRegions.find((r) => r.regionId === targetRegionId);
      const regionData = await fetchOsmProvincialRegion(
        lat,
        lng,
        targetReg?.regionName,
        targetRegionId
      );
      let chunkKey = regionData.chunkKey;
      let osmNodes = regionData.osmNodes;
      let osmEdges = regionData.osmEdges;
      let totalNodeCount = regionData.totalNodeCount ?? osmNodes.length;

      if (osmNodes.length === 0) {
        const fallback = await fetchOsmRoadChunk(lat, lng);
        chunkKey = fallback.chunkKey;
        osmNodes = fallback.osmNodes;
        osmEdges = fallback.osmEdges;
        totalNodeCount = Math.max(totalNodeCount, osmNodes.length);
      }

      if (osmNodes.length > 0 || osmEdges.length > 0) {
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
    } finally {
      setIsLoadingOsm(false);
    }
  }, []);

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

  const syncSlotToCloud = useCallback(
    async (
      user: User,
      slotId: SaveSlotId,
      state: GameState,
      customName?: string,
      options?: { forceGraphSync?: boolean; fixedTimestamp?: number }
    ): Promise<SaveSlotSummary | null> => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        if (pendingRestoredMarksRef.current) {
          const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(
            state,
            pendingRestoredMarksRef.current
          );
          if (unhydratedNodes === 0 && unhydratedEdges === 0) {
            pendingRestoredMarksRef.current = null;
          }
        }
        const syncTs = options?.fixedTimestamp ?? Date.now();
        const syncedSummary = await uploadSlotToCloud(user, slotId, state, {
          slotName: customName,
          clientSavedAt: syncTs,
          forceGraphSync: options?.forceGraphSync,
          pendingMarks: pendingRestoredMarksRef.current,
        });
        updateLocalSlotTimestamp(slotId, syncTs, {
          source: 'synced',
          cloudSavedAt: syncTs,
        });
        setCloudSyncBaseline(slotId, syncTs);
        setSyncBaseMap(getCloudSyncBaselineMap());
        setLocalSlots(listLocalSlotSummaries());
        setCloudSlots((prev) => ({ ...prev, [slotId]: syncedSummary }));
        setLastCloudSyncAt(Date.now());
        return syncedSummary;
      } catch (err) {
        setSyncError(
          formatCloudSyncError(err, '클라우드 동기화 저장 중 오류가 발생했습니다.')
        );
        return null;
      } finally {
        setIsSyncing(false);
      }
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
      attemptedChunkKeysRef.current.clear();
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

      // Fast IndexedDB cache check (<15ms) so revisited starting cities open pre-populated
      const startTileKey = chunkKeyForCoords(city.lat, city.lng);
      const cachedTiles = await readCachedOsmTilesForKeys([startTileKey]).catch(() => new Map());
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
      clearCloudSyncBaseline(targetSlotId);
      setSyncBaseMap(getCloudSyncBaselineMap());
      setGameState(fresh);
      const slotName = `슬롯 ${slotIndexFromId(targetSlotId)} · ${city.name}`;
      const startTs = persistCurrentSlotLocally(fresh, targetSlotId, slotName);
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

      const user = firebaseUserRef.current;
      if (user) {
        void syncSlotToCloud(user, targetSlotId, fresh, slotName, {
          forceGraphSync: true,
          fixedTimestamp: startTs,
        });
        void updateCloudActiveSlot(user.uid, targetSlotId, user).catch(() => undefined);
      }

      // Stream full administrative region & OSM street/rail network in background
      void (async () => {
        setIsLoadingOsm(true);
        try {
          const startGuessName = city.name.split(' ')[0];
          const [fullCityData, startRegionInfo] = await Promise.all([
            fetchOsmProvincialRegion(city.lat, city.lng, startGuessName),
            fetchProvincialRegionInfo(city.lat, city.lng, undefined, startGuessName).catch(
              () => null
            ),
          ]);
          if (loadingSessionRef.current !== sessionId) return;
          updateLoadingSession(sessionId, 75, `${city.name} 교차로·철도 병합 중`);

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
                boundaryGeoJson: fullCityData.boundaryGeoJson || startRegionInfo?.boundaryGeoJson,
                totalNodeCount:
                  fullCityData.totalNodeCount > 0 ? fullCityData.totalNodeCount : initialNodes.length,
              });
            }
            return next;
          });

          void discoverNearbyProvinces(city.lat, city.lng);
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
      syncSlotToCloud,
      updateLoadingSession,
    ]
  );

  const launchLoadedSlotState = useCallback(
    (loaded: GameState, slotId: SaveSlotId, skeleton?: BuiltSkeletonTuple[]) => {
      checkedProvinceCellsRef.current.clear();
      inFlightProvinceCellsRef.current.clear();
      inFlightChunkKeysRef.current.clear();
      attemptedChunkKeysRef.current.clear();
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
    },
    []
  );

  // Helper: preserve live capital/ticks/skills accumulated since immediate entry when applying background graph hydration
  const mergeHydratedGraphPreservingLiveProgress = useCallback(
    (prev: GameState, hydrated: GameState): GameState => {
      const mergedRegions = (prev.provincialRegions || []).map((r) => {
        const fromHydrated = (hydrated.provincialRegions || []).find((h) => h.regionId === r.regionId);
        if (!fromHydrated) return r;
        return {
          ...r,
          boundaryGeoJson: r.boundaryGeoJson || fromHydrated.boundaryGeoJson,
          hasRealOsmBoundary: Boolean(r.hasRealOsmBoundary || fromHydrated.hasRealOsmBoundary),
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

  // Load any of the 5 slots: conflict check -> instant map entry (<300ms) + IndexedDB & viewport-priority background streaming
  const handleLoadSlot = useCallback(
    async (
      slotId: SaveSlotId,
      forceSource?: 'local' | 'cloud',
      preloadedCloud?: CloudDownloadResult,
      skipLocalReupload?: boolean
    ) => {
      if (busySlotId) return;
      const summary = mergedSlotsRef.current[slotId];
      const hasLocalSummary = Boolean(localSlotsRef.current[slotId]);
      const hasCloudSummary = Boolean(cloudSlotsRef.current[slotId]);
      const localState = loadLocalSlotGameState(slotId);
      const user = firebaseUserRef.current;

      if (!forceSource && summary?.hasConflict && hasLocalSummary && hasCloudSummary) {
        openConflictModal(slotId, 'load');
        return;
      }

      const shouldDownloadCloud =
        forceSource === 'cloud'
          ? Boolean(user)
          : forceSource === 'local'
          ? false
          : Boolean(user) &&
            Boolean(summary) &&
            (summary?.source === 'cloud' || Boolean(summary?.hasNewerCloud) || !localState);

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
          const results = await Promise.allSettled(
            slice.map((pt) => fetchOsmRoadChunk(pt.lat, pt.lng, { allowStarterFallback: false }))
          );
          if (loadingSessionRef.current !== sessionId) return;

          const payloads: Array<{
            chunkKey: string;
            osmNodes: GameState['osmNodes'];
            osmEdges: GameState['osmEdges'];
          }> = [];

          for (let j = 0; j < results.length; j++) {
            const res = results[j];
            const pt = slice[j];
            if (res.status === 'fulfilled' && res.value.osmNodes.length > 0) {
              if (res.value.usedLiveOverpass || !allowRetryQueue) {
                payloads.push({
                  chunkKey: res.value.chunkKey,
                  osmNodes: res.value.osmNodes,
                  osmEdges: res.value.osmEdges,
                });
              } else {
                retryQueue.push(pt);
              }
            } else if (allowRetryQueue) {
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

        for (let i = 0; i < chunkCoords.length; i += 4) {
          if (loadingSessionRef.current !== sessionId) return;
          const slice = chunkCoords.slice(i, i + 4);
          await runBatch(slice, true);
          done += slice.length;
          const frac = Math.min(1, done / Math.max(1, total));
          const pct = startPct + Math.round(frac * (endPct - startPct));
          updateLoadingSession(sessionId, pct, `${labelPrefix} (${Math.min(done, total)}/${total})`);
        }

        if (retryQueue.length > 0 && loadingSessionRef.current === sessionId) {
          await new Promise((r) => setTimeout(r, 650));
          for (let i = 0; i < retryQueue.length; i += 2) {
            if (loadingSessionRef.current !== sessionId) return;
            const slice = retryQueue.slice(i, i + 2);
            await runBatch(slice, false);
          }
        }
      };

      if (!shouldDownloadCloud) {
        if (!localState) return;
        if (forceSource === 'local' && user && !skipLocalReupload) {
          setBusySlotId(slotId);
          const localMarks = getLocalSlotGraphMarks(slotId);
          const synced = await uploadSlotToCloud(user, slotId, localState, {
            slotName: localSlotsRef.current[slotId]?.slotName,
            clientSavedAt: Date.now(),
            forceGraphSync: true,
            pendingMarks: localMarks,
          }).catch((err) => {
            setSyncError(formatCloudSyncError(err, '로컬 저장본을 클라우드에 업로드하지 못했습니다.'));
            return null;
          });
          if (synced) {
            updateLocalSlotTimestamp(slotId, synced.clientSavedAt, {
              source: 'synced',
              cloudSavedAt: synced.clientSavedAt,
            });
            setCloudSyncBaseline(slotId, synced.clientSavedAt);
            setSyncBaseMap(getCloudSyncBaselineMap());
            setLocalSlots(listLocalSlotSummaries());
            setCloudSlots((prev) => ({ ...prev, [slotId]: synced }));
            setLastCloudSyncAt(Date.now());
          }
          setBusySlotId(null);
        }

        const localMarks = getLocalSlotGraphMarks(slotId);
        const connectedLocal = (localState.osmNodes || []).filter((n) => n.connected).length;
        pendingRestoredMarksRef.current =
          localMarks && localMarks.connectedNodeIds.size > connectedLocal ? localMarks : null;
        const skeleton = getLocalSlotBuiltSkeleton(slotId);
        launchLoadedSlotState(localState, slotId, skeleton);
        if (user) {
          void updateCloudActiveSlot(user.uid, slotId, user).catch(() => undefined);
        }

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

            const cachedTilesMap =
              missingTileKeys.length > 0
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

            // Stream any still-missing chunks (e.g. partial save or evicted IDB cache)
            const refLat = vpBounds
              ? (vpBounds.minLat + vpBounds.maxLat) / 2
              : workingState.startingCity.lat;
            const refLng = vpBounds
              ? (vpBounds.minLng + vpBounds.maxLng) / 2
              : workingState.startingCity.lng;

            const uncachedMissingCoords = missingTileKeys
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
            if (afterCacheState && (afterCacheState.osmNodes || []).length === 0) {
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
              if (pendingRestoredMarksRef.current) {
                const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(
                  finalState,
                  pendingRestoredMarksRef.current
                );
                if (unhydratedNodes === 0 && unhydratedEdges === 0) {
                  pendingRestoredMarksRef.current = null;
                }
              }
              saveLocalSlotGameState(slotId, finalState, {
                pendingMarks: pendingRestoredMarksRef.current,
              });
              setLocalSlots(listLocalSlotSummaries());
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
        return;
      }

      if (!user) return;
      const sessionId = beginLoadingSession('클라우드 저장본 내려받는 중', 8);
      setBusySlotId(slotId);
      setSyncError(null);
      try {
        const downloaded = preloadedCloud ?? (await downloadCloudSlot(user.uid, slotId));
        if (!downloaded) {
          if (localState) {
            pendingRestoredMarksRef.current = null;
            const sk = getLocalSlotBuiltSkeleton(slotId);
            launchLoadedSlotState(localState, slotId, sk);
            completeLoadingSession(sessionId);
          } else {
            setLoadingProgress(null);
          }
          return;
        }

        updateLoadingSession(sessionId, 25, '개척 노선 즉시 지도 진입 중');
        pendingRestoredMarksRef.current = downloaded.marks;

        // Build instant skeleton from cloud customBridgeEdges + summary stats preserved cleanly
        const cloudSkeleton: BuiltSkeletonTuple[] = downloaded.marks.customBridgeEdges
          .filter((e) => e.built && e.coordinates.length >= 2)
          .slice(0, 1500)
          .map((e) => [
            e.coordinates[0][0],
            e.coordinates[0][1],
            e.coordinates[e.coordinates.length - 1][0],
            e.coordinates[e.coordinates.length - 1][1],
            e.mode === 'rail' ? 1 : 0,
          ]);

        const initialCloudState: GameState = {
          ...downloaded.baseState,
          stats: {
            ...downloaded.baseState.stats,
            connectedOsmNodes: Math.max(
              downloaded.baseState.stats.connectedOsmNodes,
              downloaded.summary.connectedOsmNodes
            ),
            totalOsmEdgesBuilt: Math.max(
              downloaded.baseState.stats.totalOsmEdgesBuilt,
              downloaded.summary.totalOsmEdgesBuilt
            ),
            mapped1to1Km: Math.max(
              downloaded.baseState.stats.mapped1to1Km,
              downloaded.summary.mapped1to1Km
            ),
          },
        };

        // Persist cloud snapshot & sync baseline locally immediately so reloading mid-stream never creates false divergence
        saveLocalSlotGameState(slotId, initialCloudState, {
          slotName: downloaded.summary.slotName,
          savedAt: downloaded.summary.clientSavedAt,
          pendingMarks: downloaded.marks,
        });
        setCloudSyncBaseline(slotId, downloaded.summary.clientSavedAt);
        setSyncBaseMap(getCloudSyncBaselineMap());
        setLocalSlots(listLocalSlotSummaries());

        // Enter 'playing' IMMEDIATELY without blocking on Overpass network!
        launchLoadedSlotState(initialCloudState, slotId, cloudSkeleton);
        setCloudSlots((prev) => ({ ...prev, [slotId]: downloaded.summary }));
        void updateCloudActiveSlot(user.uid, slotId, user).catch(() => undefined);
        setBusySlotId(null);

        // Background progressive cloud hydration (IndexedDB hits first -> ALL missing chunks streamed)
        void (async () => {
          setIsLoadingOsm(true);
          try {
            updateLoadingSession(sessionId, 32, 'IndexedDB 캐시 타일 대조 중');
            const unlockedRegions = initialCloudState.provincialRegions.filter((r) => r.unlocked);
            const allCandidateKeys = new Set<string>(downloaded.pendingChunkKeys || []);
            for (const ce of downloaded.marks.customBridgeEdges) {
              if (ce.coordinates.length >= 2) {
                allCandidateKeys.add(chunkKeyForCoords(ce.coordinates[0][0], ce.coordinates[0][1]));
                allCandidateKeys.add(
                  chunkKeyForCoords(
                    ce.coordinates[ce.coordinates.length - 1][0],
                    ce.coordinates[ce.coordinates.length - 1][1]
                  )
                );
              }
            }
            const vpBounds = viewportBoundsRef.current;
            if (vpBounds) {
              for (const vt of enumerateChunkKeysForBounds(vpBounds, 12)) {
                allCandidateKeys.add(vt.key);
              }
            }
            const cityChunkKey = chunkKeyForCoords(
              initialCloudState.startingCity.lat,
              initialCloudState.startingCity.lng
            );
            allCandidateKeys.add(cityChunkKey);

            const [cachedBoundaries, cachedTilesMap] = await Promise.all([
              hydrateProvincialRegionsFromCache(initialCloudState.provincialRegions || []),
              readCachedOsmTilesForKeys(Array.from(allCandidateKeys)),
            ]);
            if (loadingSessionRef.current !== sessionId) return;

            if (cachedBoundaries.size > 0 || cachedTilesMap.size > 0) {
              updateLoadingSession(sessionId, 46, `로컬 타일 캐시 ${cachedTilesMap.size}개 복원 중`);
              const cachedTilePayloads = Array.from(cachedTilesMap.values()).map((t) => ({
                chunkKey: t.tileKey,
                osmNodes: t.osmNodes,
                osmEdges: t.osmEdges,
              }));
              const bMap = new Map<
                string,
                { boundaryGeoJson?: GeoJsonBoundary; totalNodeCount?: number }
              >();
              for (const [rid, meta] of cachedBoundaries.entries()) {
                bMap.set(rid, { boundaryGeoJson: meta.boundaryGeoJson });
              }
              setGameState((prev) => {
                if (!prev || loadingSessionRef.current !== sessionId) return prev;
                const batched = mergeOsmChunksBatch(prev, cachedTilePayloads, {
                  skipAutoSeed: true,
                  boundaryMap: bMap,
                });
                return applyRestoredGraphMarks(batched, pendingRestoredMarksRef.current);
              });
            }

            // Stream remaining uncached unlocked regions + ALL remaining uncached chunk tiles
            const missingRegions = (stateRef.current?.provincialRegions || unlockedRegions)
              .filter(
                (r) =>
                  r.unlocked &&
                  (!r.hasRealOsmBoundary ||
                    !(stateRef.current?.loadedOsmRegions || []).includes(r.regionId))
              )
              .slice(0, 6);

            const refLat = vpBounds
              ? (vpBounds.minLat + vpBounds.maxLat) / 2
              : initialCloudState.startingCity.lat;
            const refLng = vpBounds
              ? (vpBounds.minLng + vpBounds.maxLng) / 2
              : initialCloudState.startingCity.lng;

            const remainingChunkCoords = Array.from(allCandidateKeys)
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

            const totalUnits = Math.max(1, missingRegions.length + remainingChunkCoords.length);
            const regionSharePct = Math.round(
              (missingRegions.length / totalUnits) * 48
            );
            const regionEndPct = 48 + Math.max(0, regionSharePct);

            // Stream missing unlocked regions in batches of 2
            for (let i = 0; i < missingRegions.length; i += 2) {
              if (loadingSessionRef.current !== sessionId) return;
              const slice = missingRegions.slice(i, i + 2);
              const results = await Promise.allSettled(
                slice.map((r) =>
                  fetchOsmProvincialRegion(r.centerLat, r.centerLng, r.regionName, r.regionId).then(
                    (payload) => ({
                      regionId: r.regionId,
                      payload,
                    })
                  )
                )
              );
              if (loadingSessionRef.current !== sessionId) return;

              const payloads: Array<{
                chunkKey: string;
                osmNodes: typeof initialCloudState.osmNodes;
                osmEdges: typeof initialCloudState.osmEdges;
                regionId?: string;
                boundaryGeoJson?: GeoJsonBoundary;
                totalNodeCount?: number;
              }> = [];
              const bMap = new Map<
                string,
                { boundaryGeoJson?: GeoJsonBoundary; totalNodeCount?: number }
              >();
              for (const res of results) {
                if (res.status === 'fulfilled' && res.value.payload.osmNodes.length > 0) {
                  payloads.push({
                    chunkKey: res.value.payload.chunkKey,
                    osmNodes: res.value.payload.osmNodes,
                    osmEdges: res.value.payload.osmEdges,
                    regionId: res.value.regionId,
                    boundaryGeoJson: res.value.payload.boundaryGeoJson,
                    totalNodeCount: res.value.payload.totalNodeCount,
                  });
                  if (res.value.payload.boundaryGeoJson) {
                    bMap.set(res.value.regionId, {
                      boundaryGeoJson: res.value.payload.boundaryGeoJson,
                      totalNodeCount: res.value.payload.totalNodeCount,
                    });
                  }
                }
              }
              if (payloads.length > 0) {
                setGameState((prev) => {
                  if (!prev || loadingSessionRef.current !== sessionId) return prev;
                  const batched = mergeOsmChunksBatch(prev, payloads, {
                    skipAutoSeed: true,
                    boundaryMap: bMap,
                  });
                  return applyRestoredGraphMarks(batched, pendingRestoredMarksRef.current);
                });
              }
              const regPct =
                48 +
                Math.round(
                  (Math.min(i + slice.length, missingRegions.length) / Math.max(1, missingRegions.length)) *
                    Math.max(1, regionEndPct - 48)
                );
              updateLoadingSession(
                sessionId,
                regPct,
                `행정구역 도로망 스트리밍 (${Math.min(i + slice.length, missingRegions.length)}/${missingRegions.length})`
              );
            }

            // Stream ALL remaining uncached chunk tiles without truncation
            await streamMissingChunksProgressive(
              sessionId,
              remainingChunkCoords,
              regionEndPct,
              98,
              '주변 도로 타일 수신 중'
            );

            const finalState = stateRef.current;
            if (finalState && loadingSessionRef.current === sessionId) {
              if (pendingRestoredMarksRef.current) {
                const { unhydratedNodes, unhydratedEdges } = countUnhydratedGraphMarks(
                  finalState,
                  pendingRestoredMarksRef.current
                );
                if (unhydratedNodes === 0 && unhydratedEdges === 0) {
                  pendingRestoredMarksRef.current = null;
                }
              }
              saveLocalSlotGameState(slotId, finalState, {
                slotName: downloaded.summary.slotName,
                savedAt: downloaded.summary.clientSavedAt,
                pendingMarks: pendingRestoredMarksRef.current,
              });
              setCloudSyncBaseline(slotId, downloaded.summary.clientSavedAt);
              setSyncBaseMap(getCloudSyncBaselineMap());
              setLocalSlots(listLocalSlotSummaries());
              void discoverNearbyProvinces(
                finalState.startingCity.lat,
                finalState.startingCity.lng
              );
            }
            completeLoadingSession(sessionId, '클라우드 복원 완료');
          } catch {
            completeLoadingSession(sessionId, '도로망 복원 완료');
          } finally {
            setIsLoadingOsm(false);
          }
        })();
      } catch (err) {
        const msg = formatCloudSyncError(err, '클라우드 슬롯을 불러오지 못했습니다.');
        setSyncError(msg);
        if (localState && forceSource !== 'cloud') {
          const sk = getLocalSlotBuiltSkeleton(slotId);
          launchLoadedSlotState(localState, slotId, sk);
          completeLoadingSession(sessionId);
        } else {
          setLoadingProgress(null);
        }
        setBusySlotId(null);
      }
    },
    [
      beginLoadingSession,
      busySlotId,
      completeLoadingSession,
      discoverNearbyProvinces,
      launchLoadedSlotState,
      mergeHydratedGraphPreservingLiveProgress,
      openConflictModal,
      updateLoadingSession,
    ]
  );

  const handleSaveToSlot = useCallback(
    async (slotId: SaveSlotId) => {
      const current = stateRef.current;
      if (!current) return;
      const user = firebaseUserRef.current;
      if (
        user &&
        mergedSlotsRef.current[slotId]?.hasConflict &&
        localSlotsRef.current[slotId] &&
        cloudSlotsRef.current[slotId]
      ) {
        openConflictModal(slotId, 'save');
        return;
      }
      setBusySlotId(slotId);
      setActiveSlotIdState(slotId);
      setActiveSlotId(slotId);
      const existingSummary = mergedSlotsRef.current[slotId];
      const preservedName =
        existingSummary && existingSummary.cityId === current.startingCity.id
          ? existingSummary.slotName
          : undefined;
      const savedTs = persistCurrentSlotLocally(current, slotId, preservedName);
      if (user) {
        await syncSlotToCloud(user, slotId, current, preservedName, {
          fixedTimestamp: savedTs,
        });
        void updateCloudActiveSlot(user.uid, slotId, user).catch(() => undefined);
      }
      setBusySlotId(null);
    },
    [openConflictModal, persistCurrentSlotLocally, syncSlotToCloud]
  );

  const handleUploadLocalSlotToCloud = useCallback(
    async (slotId: SaveSlotId) => {
      const user = firebaseUserRef.current;
      if (!user) return;
      if (
        mergedSlotsRef.current[slotId]?.hasConflict &&
        localSlotsRef.current[slotId] &&
        cloudSlotsRef.current[slotId]
      ) {
        openConflictModal(slotId, 'sync');
        return;
      }
      const localState = loadLocalSlotGameState(slotId);
      if (!localState) return;
      setBusySlotId(slotId);
      await syncSlotToCloud(user, slotId, localState, mergedSlotsRef.current[slotId]?.slotName, {
        forceGraphSync: true,
        fixedTimestamp: Date.now(),
      });
      setBusySlotId(null);
    },
    [openConflictModal, syncSlotToCloud]
  );

  const handleResolveConflictLocal = useCallback(async () => {
    const slotId = conflictSlotIdRef.current;
    const user = firebaseUserRef.current;
    if (!slotId || !user) return;

    const useLiveState = screenState === 'playing' && activeSlotIdRef.current === slotId && stateRef.current;
    const localMarks = useLiveState ? pendingRestoredMarksRef.current : getLocalSlotGraphMarks(slotId);
    const localState = useLiveState ? stateRef.current! : loadLocalSlotGameState(slotId);
    if (!localState) {
      setConflictError('로컬 저장 데이터를 불러올 수 없습니다.');
      return;
    }

    setIsResolvingConflict(true);
    setConflictError(null);
    try {
      const slotName =
        localSlotsRef.current[slotId]?.slotName ||
        cloudSlotsRef.current[slotId]?.slotName;
      const syncTs = Date.now();
      const uploaded = await uploadSlotToCloud(user, slotId, localState, {
        slotName,
        clientSavedAt: syncTs,
        forceGraphSync: true,
        pendingMarks: localMarks,
      });

      saveLocalSlotGameState(slotId, localState, {
        slotName: uploaded.slotName,
        savedAt: syncTs,
        pendingMarks: localMarks,
      });
      setCloudSyncBaseline(slotId, syncTs);
      setSyncBaseMap(getCloudSyncBaselineMap());
      setLocalSlots(listLocalSlotSummaries());
      setCloudSlots((prev) => ({ ...prev, [slotId]: uploaded }));
      setLastCloudSyncAt(Date.now());
      void updateCloudActiveSlot(user.uid, slotId, user).catch(() => undefined);

      setConflictSlotId(null);
      if (conflictAction === 'load') {
        await handleLoadSlot(slotId, 'local', undefined, true);
      }
    } catch (err) {
      setConflictError(
        formatCloudSyncError(err, '로컬 저장본을 클라우드에 저장하지 못했습니다.')
      );
    } finally {
      setIsResolvingConflict(false);
    }
  }, [conflictAction, handleLoadSlot, screenState]);

  const handleResolveConflictCloud = useCallback(async () => {
    const slotId = conflictSlotIdRef.current;
    const user = firebaseUserRef.current;
    if (!slotId || !user) return;

    setIsResolvingConflict(true);
    setConflictError(null);
    try {
      const downloaded = await downloadCloudSlot(user.uid, slotId);
      if (!downloaded) {
        setConflictError('클라우드에서 저장본을 찾지 못했습니다.');
        return;
      }

      saveLocalSlotGameState(slotId, downloaded.baseState, {
        slotName: downloaded.summary.slotName,
        savedAt: downloaded.summary.clientSavedAt,
        pendingMarks: downloaded.marks,
      });
      setCloudSyncBaseline(slotId, downloaded.summary.clientSavedAt);
      setSyncBaseMap(getCloudSyncBaselineMap());
      setLocalSlots(listLocalSlotSummaries());
      setCloudSlots((prev) => ({ ...prev, [slotId]: downloaded.summary }));
      setLastCloudSyncAt(Date.now());
      setConflictSlotId(null);
      await handleLoadSlot(slotId, 'cloud', downloaded);
    } catch (err) {
      setConflictError(
        formatCloudSyncError(err, '클라우드 저장본을 불러오지 못했습니다.')
      );
    } finally {
      setIsResolvingConflict(false);
    }
  }, [handleLoadSlot]);

  const handleRenameSlot = useCallback(
    async (slotId: SaveSlotId, newName: string) => {
      const trimmed = newName.trim().slice(0, 60);
      if (!trimmed) return;
      renameLocalSlot(slotId, trimmed);
      setLocalSlots(listLocalSlotSummaries());
      const user = firebaseUserRef.current;
      if (user && cloudSlotsRef.current[slotId]) {
        setBusySlotId(slotId);
        try {
          await renameCloudSlot(user.uid, slotId, trimmed);
          setCloudSlots((prev) =>
            prev[slotId] ? { ...prev, [slotId]: { ...prev[slotId]!, slotName: trimmed } } : prev
          );
        } catch (err) {
          setSyncError(formatCloudSyncError(err, '슬롯 이름 변경에 실패했습니다.'));
        } finally {
          setBusySlotId(null);
        }
      }
    },
    []
  );

  const handleDeleteSlot = useCallback(
    async (slotId: SaveSlotId) => {
      setBusySlotId(slotId);
      deleteLocalSlotGameState(slotId);
      clearCloudSyncBaseline(slotId);
      setSyncBaseMap(getCloudSyncBaselineMap());
      setLocalSlots(listLocalSlotSummaries());
      const user = firebaseUserRef.current;
      if (user && cloudSlotsRef.current[slotId]) {
        try {
          await deleteCloudSlot(user.uid, slotId);
          setCloudSlots((prev) => {
            const next = { ...prev };
            delete next[slotId];
            return next;
          });
        } catch (err) {
          setSyncError(formatCloudSyncError(err, '클라우드 슬롯 삭제에 실패했습니다.'));
        }
      }
      setBusySlotId(null);
    },
    []
  );

  const handleSignIn = useCallback(async () => {
    setSyncError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      if (code === 'auth/popup-blocked') {
        setSyncError('브라우저에서 로그인 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
      } else if (code === 'auth/unauthorized-domain') {
        setSyncError('현재 도메인이 Google 로그인 허용 목록에 등록되어 있지 않습니다.');
      } else if (code === 'auth/network-request-failed') {
        setSyncError('네트워크 연결 오류로 Google 로그인에 실패했습니다.');
      } else {
        setSyncError(
          formatCloudSyncError(err, 'Google 로그인에 실패했습니다. 팝업 차단을 해제한 뒤 다시 시도해 주세요.')
        );
      }
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOutUser();
  }, []);

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
        if (!loadedSet.has(ck) && !attemptedChunkKeysRef.current.has(ck) && !chunkSeen.has(ck)) {
          chunkSeen.set(ck, [n.lat, n.lng]);
        }
      }

      provSeen.forEach(([lat, lng]) => {
        void handleAutoLoadProvince(lat, lng);
      });
      chunkSeen.forEach(([lat, lng]) => {
        void handleLoadOsmChunk(lat, lng);
      });

      const proximityChunks = getProximityAdjacentChunksToLoad(cur, 5);
      for (let i = 0; i < proximityChunks.length; i++) {
        const c = proximityChunks[i];
        if (!attemptedChunkKeysRef.current.has(c.key)) {
          void handleLoadOsmChunk(c.lat, c.lng);
        }
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
    handleLoadOsmChunk,
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
          !r.hasRealOsmBoundary &&
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

    const items = allPending.slice(0, 2);

    void (async () => {
      let needsNextPass = allPending.length > items.length;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (cancelled) return;
        const attempts = hydrateAttemptsRef.current.get(item.regionId) || 0;
        hydrateAttemptsRef.current.set(item.regionId, attempts + 1);
        try {
          const info = await fetchProvincialRegionInfo(
            item.lat,
            item.lng,
            item.regionId,
            item.regionName
          );
          if (cancelled) return;
          if (
            info &&
            info.boundaryGeoJson &&
            !isSyntheticFallbackRegion(info.regionId, info.regionName, info)
          ) {
            hydratedRegionIdsRef.current.add(item.regionId);
            setGameState((prev) => {
              if (!prev) return prev;
              return registerDiscoveredProvincialRegion(prev, {
                ...info,
                regionName: info.regionName || item.regionName,
              });
            });
          } else if (attempts + 1 < 6) {
            needsNextPass = true;
          }
        } catch {
          if (attempts + 1 < 6) {
            needsNextPass = true;
          }
        }
        if (i < items.length - 1 && !cancelled) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
      if (needsNextPass && !cancelled) {
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            setBoundaryRetryTick((t) => t + 1);
          }
        }, 900);
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

  // Auto-save locally every 8 seconds + background cloud sync every 30s while signed in (skips conflicted slots)
  useEffect(() => {
    if (screenState !== 'playing') return;
    const persistState = () => {
      if (!stateRef.current) return;
      persistCurrentSlotLocally(stateRef.current, activeSlotIdRef.current);
    };
    const syncCloudIfSignedIn = () => {
      if (!stateRef.current || !firebaseUserRef.current) return;
      const slotId = activeSlotIdRef.current;
      if (conflictSlotIdRef.current === slotId) return;
      if (mergedSlotsRef.current[slotId]?.hasConflict) return;
      const ts = persistCurrentSlotLocally(stateRef.current, slotId);
      void syncSlotToCloud(firebaseUserRef.current, slotId, stateRef.current, undefined, {
        fixedTimestamp: ts,
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistState();
      }
    };
    const localTimer = setInterval(persistState, 8000);
    const cloudTimer = setInterval(syncCloudIfSignedIn, 30000);
    window.addEventListener('pagehide', persistState);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(localTimer);
      clearInterval(cloudTimer);
      window.removeEventListener('pagehide', persistState);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [screenState, persistCurrentSlotLocally, syncSlotToCloud]);

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
      const slotId = activeSlotIdRef.current;
      const savedTs = persistCurrentSlotLocally(stateRef.current, slotId);
      if (
        firebaseUserRef.current &&
        !mergedSlotsRef.current[slotId]?.hasConflict
      ) {
        void syncSlotToCloud(
          firebaseUserRef.current,
          slotId,
          stateRef.current,
          undefined,
          { fixedTimestamp: savedTs }
        );
      }
    }
    setActiveModal(null);
    setScreenState('title');
  }, [persistCurrentSlotLocally, syncSlotToCloud]);

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
      try {
        let regionData = await fetchOsmProvincialRegion(
          target.centerLat,
          target.centerLng,
          target.regionName,
          target.regionId,
          { allowStarterFallback: false }
        );
        if (regionData.osmNodes.length === 0 && !regionData.usedLiveOverpass) {
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
              zoom: 14,
              ts: Date.now(),
            });
          }
        }
      } finally {
        unlockingRegionRef.current = null;
        setUnlockingRegionId(null);
      }
    },
    [discoverNearbyProvinces]
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
        const slotId = activeSlotIdRef.current;
        const savedTs = persistCurrentSlotLocally(cur, slotId);
        if (firebaseUserRef.current && !mergedSlotsRef.current[slotId]?.hasConflict) {
          void syncSlotToCloud(
            firebaseUserRef.current,
            slotId,
            cur,
            undefined,
            { fixedTimestamp: savedTs }
          );
        }
      });
    },
    [persistCurrentSlotLocally, syncSlotToCloud]
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
    void loadFullStartingCityIntoState(cur.startingCity.lat, cur.startingCity.lng);
  }, [loadFullStartingCityIntoState]);

  const handleOpenExpansionTab = useCallback(() => {
    setActiveModal('prestige');
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
    <div className="w-full h-[100dvh] bg-[#090d16] text-slate-100 overflow-hidden select-none">
      {screenState === 'title' && (
        <TitleScreen
          account={accountInfo}
          authLoading={authLoading}
          isSyncing={isSyncing}
          syncError={syncError}
          activeSlotId={activeSlotId}
          slots={mergedSlots}
          busySlotId={busySlotId}
          loadingProgress={loadingProgress}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onRefreshCloud={async () => {
            if (firebaseUserRef.current) {
              await refreshCloudForUser(firebaseUserRef.current, { promptConflict: true });
            }
          }}
          onStartWithCity={handleStartWithCity}
          onLoadSlot={handleLoadSlot}
          onResolveConflict={(slotId) => openConflictModal(slotId, 'load')}
          onRenameSlot={handleRenameSlot}
          onDeleteSlot={handleDeleteSlot}
          onUploadLocalSlotToCloud={handleUploadLocalSlotToCloud}
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
            isSignedIn={Boolean(firebaseUser)}
            isSyncing={isSyncing}
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
              account={accountInfo}
              authLoading={authLoading}
              isSyncing={isSyncing}
              syncError={syncError}
              lastCloudSyncAt={lastCloudSyncAt}
              activeSlotId={activeSlotId}
              slots={mergedSlots}
              busySlotId={busySlotId}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              onRefreshCloud={async () => {
                if (firebaseUserRef.current) {
                  await refreshCloudForUser(firebaseUserRef.current, { promptConflict: true });
                }
              }}
              onSyncNow={async () => {
                const user = firebaseUserRef.current;
                const slotId = activeSlotIdRef.current;
                if (!user || !stateRef.current) return;
                if (
                  mergedSlotsRef.current[slotId]?.hasConflict &&
                  localSlotsRef.current[slotId] &&
                  cloudSlotsRef.current[slotId]
                ) {
                  openConflictModal(slotId, 'sync');
                  return;
                }
                const savedTs = persistCurrentSlotLocally(stateRef.current, slotId);
                await syncSlotToCloud(user, slotId, stateRef.current, undefined, {
                  forceGraphSync: true,
                  fixedTimestamp: savedTs,
                });
              }}
              onSaveToSlot={handleSaveToSlot}
              onLoadSlot={handleLoadSlot}
              onResolveConflict={(slotId) => openConflictModal(slotId, 'sync')}
              onRenameSlot={handleRenameSlot}
              onDeleteSlot={handleDeleteSlot}
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
              onUnlockRegion={handleUnlockRegion}
              unlockingRegionId={unlockingRegionId}
              onFocusMap={handleFocusMap}
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
                  className="p-3.5 rounded-xl border shadow-2xl flex items-start gap-2.5 bg-slate-950/95 border-yellow-500/60"
                >
                  <Award className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
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

      {conflictSlotId && (
        <SaveConflictModal
          slotId={conflictSlotId}
          localSummary={localSlots[conflictSlotId] || null}
          cloudSummary={cloudSlots[conflictSlotId] || null}
          onChooseLocal={handleResolveConflictLocal}
          onChooseCloud={handleResolveConflictCloud}
          onClose={() => {
            if (!isResolvingConflict) {
              setConflictError(null);
              setConflictSlotId(null);
            }
          }}
          isBusy={isResolvingConflict}
          errorMessage={conflictError}
        />
      )}
    </div>
  );
}
