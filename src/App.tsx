import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  Achievement,
  GameState,
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
  advanceTick,
  buyAllAffordableSkills,
  buyMaxSkill,
  calculateMultipliers,
  calculateTotalIncomePerSec,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  getRegionUnlockCost,
  isNodeInUnlockedRegion,
  mergeOsmChunk,
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
  fetchNearbyProvincialRegions,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  fetchProvincialRegionInfo,
  generateCustomCityNetwork,
} from './game/osmService';
import { PRESET_CITIES } from './game/worldCatalog';
import { soundManager } from './game/audio';

const SAVE_KEY = 'TERRALINE_SAVE_V4';

interface ToastNotification {
  id: string;
  kind: 'achievement';
  title: string;
  subtitle: string;
}

function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || !parsed.startingCity) {
      return null;
    }

    return scopeGameStateToStartingCity({
      ...parsed,
      osmNodes: Array.isArray(parsed.osmNodes) ? parsed.osmNodes : [],
      osmEdges: Array.isArray(parsed.osmEdges) ? parsed.osmEdges : [],
      loadedOsmChunks: Array.isArray(parsed.loadedOsmChunks) ? parsed.loadedOsmChunks : [],
      loadedOsmRegions: Array.isArray(parsed.loadedOsmRegions) ? parsed.loadedOsmRegions : [],
      provincialRegions: Array.isArray(parsed.provincialRegions) ? parsed.provincialRegions : [],
      pendingSeedRegionIds: Array.isArray(parsed.pendingSeedRegionIds)
        ? parsed.pendingSeedRegionIds
        : [],
      completedOsmWays: Array.isArray(parsed.completedOsmWays) ? parsed.completedOsmWays : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      upgrades: [],
      minigames: backfillMinigamesState(parsed.minigames),
      stats: {
        totalSegmentsBuilt: parsed.stats?.totalSegmentsBuilt || 0,
        totalOsmEdgesBuilt: parsed.stats?.totalOsmEdgesBuilt || 0,
        connectedOsmNodes: parsed.stats?.connectedOsmNodes || 0,
        totalScaledNodes: parsed.stats?.totalScaledNodes || 0,
        totalLinesCompleted: 0,
        totalTownsCompleted: 0,
        totalClicks: parsed.stats?.totalClicks || 0,
        mapped1to1Km: parsed.stats?.mapped1to1Km || 0,
        totalNetworkKm: parsed.stats?.totalNetworkKm || 0,
        prestigeCount: 0,
      },
    });
  } catch {
    return null;
  }
}

export default function App() {
  const [savedSnapshot, setSavedSnapshot] = useState<GameState | null>(() => loadSavedGame());
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

  const stateRef = useRef<GameState | null>(null);
  stateRef.current = gameState;

  const unlockingRegionRef = useRef<string | null>(null);
  const checkedProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightChunkKeysRef = useRef<Set<string>>(new Set());
  const autoStartedRef = useRef(false);

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

  // Load OpenStreetMap dense street/rail chunk around coordinates (only for unlocked regions)
  const handleLoadOsmChunk = useCallback(async (lat: number, lng: number) => {
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
    if (inFlightChunkKeysRef.current.has(key)) return;
    inFlightChunkKeysRef.current.add(key);
    setIsLoadingOsm(true);
    try {
      const chunk = await fetchOsmRoadChunk(lat, lng);
      if (chunk.osmNodes.length > 0 || chunk.osmEdges.length > 0) {
        setGameState((prev) => {
          if (!prev) return prev;
          const filteredNodes = chunk.osmNodes.filter((n) =>
            isNodeInUnlockedRegion(prev, n)
          );
          const allowedIds = new Set(filteredNodes.map((n) => n.id));
          const filteredEdges = chunk.osmEdges.filter(
            (e) => allowedIds.has(e.fromNodeId) && allowedIds.has(e.toNodeId)
          );
          return mergeOsmChunk(prev, chunk.chunkKey, filteredNodes, filteredEdges, owningRegionId);
        });
      }
    } finally {
      inFlightChunkKeysRef.current.delete(key);
      setIsLoadingOsm(inFlightChunkKeysRef.current.size > 0);
    }
  }, []);

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
        if (info) {
          next = registerDiscoveredProvincialRegion(next, info);
        }
        for (const meta of nearby) {
          next = registerDiscoveredProvincialRegion(next, meta);
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
        const region = await fetchOsmProvincialRegion(lat, lng);
        if (region.osmNodes.length > 0) {
          setGameState((prev) => {
            if (!prev) return prev;
            const isUnlockedNow = (prev.provincialRegions || []).some(
              (r) => r.regionId === matchedUnlocked.regionId && r.unlocked
            );
            if (!isUnlockedNow) return prev;
            return mergeOsmChunk(
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
      const regionData = await fetchOsmProvincialRegion(lat, lng);
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
          return mergeOsmChunk(prev, chunkKey, osmNodes, osmEdges, rid, {
            boundaryGeoJson: regionData.boundaryGeoJson,
            totalNodeCount,
          });
        });
      }
    } finally {
      setIsLoadingOsm(false);
    }
  }, []);

  // Start new game with selected preset or OSM-searched custom city
  const handleStartWithCity = useCallback(
    async (city: StartingCity) => {
      checkedProvinceCellsRef.current.clear();
      inFlightProvinceCellsRef.current.clear();
      inFlightChunkKeysRef.current.clear();

      const [customNetwork, fullCityData, startRegionInfo] = await Promise.all([
        city.isCustom ? generateCustomCityNetwork(city) : Promise.resolve(undefined),
        fetchOsmProvincialRegion(city.lat, city.lng),
        fetchProvincialRegionInfo(city.lat, city.lng).catch(() => null),
      ]);

      let fresh = createInitialGameState(city, customNetwork);
      const regionMeta = startRegionInfo || {
        regionId: fullCityData.regionId,
        regionName: fullCityData.regionName || city.name.split(' ')[0],
        adminLevel: fullCityData.adminLevel,
        bbox: fullCityData.bbox,
        boundaryGeoJson: fullCityData.boundaryGeoJson,
        centerLat: city.lat,
        centerLng: city.lng,
        totalNodeCount: fullCityData.totalNodeCount ?? fullCityData.osmNodes.length,
      };
      if (regionMeta.regionId && !regionMeta.regionId.startsWith('osm_prov_')) {
        fresh = registerStartingProvincialRegion(fresh, {
          ...regionMeta,
          boundaryGeoJson: regionMeta.boundaryGeoJson || fullCityData.boundaryGeoJson,
          totalNodeCount: fullCityData.totalNodeCount ?? fullCityData.osmNodes.length,
        });
      }

      const startRegionId = fresh.provincialRegions.find((r) => r.isStartingRegion)?.regionId;
      let initialNodes = fullCityData.osmNodes;
      let initialEdges = fullCityData.osmEdges;
      let initialChunkKey = fullCityData.chunkKey;

      if (initialNodes.length === 0) {
        const starterChunk = await fetchOsmRoadChunk(city.lat, city.lng);
        initialNodes = starterChunk.osmNodes;
        initialEdges = starterChunk.osmEdges;
        initialChunkKey = starterChunk.chunkKey;
      }

      if (initialNodes.length > 0 || initialEdges.length > 0) {
        fresh = mergeOsmChunk(fresh, initialChunkKey, initialNodes, initialEdges, startRegionId, {
          boundaryGeoJson: fullCityData.boundaryGeoJson || startRegionInfo?.boundaryGeoJson,
          totalNodeCount:
            fullCityData.totalNodeCount > 0 ? fullCityData.totalNodeCount : initialNodes.length,
        });
      }

      soundManager.enabled = fresh.settings.soundEnabled;
      setGameState(fresh);
      setSavedSnapshot(fresh);
      localStorage.setItem(SAVE_KEY, JSON.stringify(fresh));
      setFlyToTarget(null);
      setActiveModal(null);
      setScreenState('playing');

      if (fresh.osmNodes.length === 0) {
        handleLoadOsmChunk(city.lat, city.lng);
      }
      discoverNearbyProvinces(city.lat, city.lng);
    },
    [discoverNearbyProvinces, handleLoadOsmChunk]
  );

  // Resume saved game + settle offline idle income (capped at 2 hours)
  const handleResumeSavedGame = useCallback(() => {
    const loaded = loadSavedGame();
    if (!loaded) return;

    checkedProvinceCellsRef.current.clear();
    inFlightProvinceCellsRef.current.clear();
    inFlightChunkKeysRef.current.clear();

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
    setGameState(resumed);
    setFlyToTarget(null);
    setActiveModal(null);
    setScreenState('playing');

    const startRegion = resumed.provincialRegions.find((r) => r.isStartingRegion);
    if (
      (resumed.osmNodes || []).length === 0 ||
      (startRegion && !(resumed.loadedOsmRegions || []).includes(startRegion.regionId))
    ) {
      loadFullStartingCityIntoState(
        resumed.startingCity.lat,
        resumed.startingCity.lng,
        startRegion?.regionId
      );
    }
    discoverNearbyProvinces(resumed.startingCity.lat, resumed.startingCity.lng);
  }, [discoverNearbyProvinces, loadFullStartingCityIntoState]);

  // Support ?autostart=1 URL query param for instant entry
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      autoStartedRef.current = true;
      const seoul = PRESET_CITIES.find((c) => c.id === 'seoul') || PRESET_CITIES[0];
      if (seoul) {
        void handleStartWithCity(seoul);
      }
    }
  }, [handleStartWithCity]);

  // Automatically load OSM provincial region & dense local chunks whenever >= 1 connected node enters them
  const connectedProvinceSig = (() => {
    if (!gameState || screenState !== 'playing') return '';
    const seen = new Map<string, string>();
    for (const n of gameState.osmNodes || []) {
      if (!n.connected) continue;
      const cellKey = `${(Math.round(n.lat * 25) / 25).toFixed(3)}_${(
        Math.round(n.lng * 25) / 25
      ).toFixed(3)}`;
      if (!seen.has(cellKey)) {
        seen.set(cellKey, `${n.lat.toFixed(5)},${n.lng.toFixed(5)}`);
      }
    }
    return Array.from(seen.entries())
      .map(([k, coords]) => `${k}:${coords}`)
      .sort()
      .join('|');
  })();

  const connectedChunkSig = (() => {
    if (!gameState || screenState !== 'playing') return '';
    const loadedSet = new Set(gameState.loadedOsmChunks || []);
    const seen = new Map<string, string>();
    for (const n of gameState.osmNodes || []) {
      if (!n.connected) continue;
      const ck = chunkKeyForCoords(n.lat, n.lng);
      if (!loadedSet.has(ck) && !seen.has(ck)) {
        seen.set(ck, `${n.lat.toFixed(5)},${n.lng.toFixed(5)}`);
      }
    }
    return Array.from(seen.entries())
      .map(([k, coords]) => `${k}:${coords}`)
      .sort()
      .join('|');
  })();

  useEffect(() => {
    if (screenState !== 'playing') return;
    if (connectedProvinceSig) {
      for (const entry of connectedProvinceSig.split('|')) {
        const idx = entry.indexOf(':');
        if (idx < 0) continue;
        const [latStr, lngStr] = entry.slice(idx + 1).split(',');
        const lat = Number(latStr);
        const lng = Number(lngStr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          handleAutoLoadProvince(lat, lng);
        }
      }
    }
    if (connectedChunkSig) {
      for (const entry of connectedChunkSig.split('|')) {
        const idx = entry.indexOf(':');
        if (idx < 0) continue;
        const [latStr, lngStr] = entry.slice(idx + 1).split(',');
        const lat = Number(latStr);
        const lng = Number(lngStr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          handleLoadOsmChunk(lat, lng);
        }
      }
    }
  }, [
    screenState,
    connectedProvinceSig,
    connectedChunkSig,
    handleAutoLoadProvince,
    handleLoadOsmChunk,
  ]);

  // Safety net: if playing with 0 OSM nodes, retry loading starting city automatically
  const hasAnyOsmNodes = (gameState?.osmNodes || []).length > 0;
  useEffect(() => {
    if (screenState !== 'playing' || !gameState || hasAnyOsmNodes) return;
    const { lat, lng } = gameState.startingCity;
    handleLoadOsmChunk(lat, lng);
    const timer = setInterval(() => {
      handleLoadOsmChunk(lat, lng);
    }, 3500);
    return () => clearInterval(timer);
  }, [screenState, hasAnyOsmNodes, gameState?.startingCity.id, handleLoadOsmChunk]);

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
          } else if (res.autoBuiltSomething) {
            soundManager.playBlip();
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

  // Auto-save every 2.5 seconds while playing
  useEffect(() => {
    if (screenState !== 'playing') return;
    const timer = setInterval(() => {
      if (stateRef.current) {
        try {
          localStorage.setItem(SAVE_KEY, JSON.stringify(stateRef.current));
          setSavedSnapshot(stateRef.current);
        } catch {
          // Ignore storage quota issues
        }
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [screenState]);

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
      localStorage.setItem(SAVE_KEY, JSON.stringify(stateRef.current));
      setSavedSnapshot(stateRef.current);
    }
    setActiveModal(null);
    setScreenState('title');
  }, []);

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
        let regionData = await fetchOsmProvincialRegion(target.centerLat, target.centerLng);
        if (regionData.osmNodes.length === 0) {
          const fallbackChunk = await fetchOsmRoadChunk(target.centerLat, target.centerLng);
          regionData = {
            ...regionData,
            chunkKey: fallbackChunk.chunkKey,
            osmNodes: fallbackChunk.osmNodes,
            osmEdges: fallbackChunk.osmEdges,
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

  return (
    <div className="w-full h-[100dvh] bg-[#090d16] text-slate-100 overflow-hidden select-none">
      {screenState === 'title' && (
        <TitleScreen
          onStartWithCity={handleStartWithCity}
          hasSavedGame={Boolean(savedSnapshot)}
          onResumeSavedGame={handleResumeSavedGame}
          savedCityName={savedSnapshot?.startingCity.name}
          savedKm={savedSnapshot?.stats.mapped1to1Km}
          savedCapital={savedSnapshot?.capital}
        />
      )}

      {screenState === 'playing' && gameState && (
        <>
          <WorldMap
            gameState={gameState}
            flyToTarget={flyToTarget}
            isLoadingOsm={isLoadingOsm}
            onReloadOsm={() =>
              loadFullStartingCityIntoState(gameState.startingCity.lat, gameState.startingCity.lng)
            }
            onConnectOsmPath={handleConnectOsmPath}
            onSelectIsolatedSeed={handleSelectIsolatedSeed}
            onUnlockRegion={handleUnlockRegion}
            unlockingRegionId={unlockingRegionId}
            onOpenExpansionTab={() => setActiveModal('prestige')}
            onBottomCardChange={setHasMapBottomCard}
          />

          <HUD
            gameState={gameState}
            activeModal={activeModal}
            hasMapBottomCard={hasMapBottomCard}
            onSelectModal={setActiveModal}
            onDispatchClick={handleDispatchClick}
            onToggleSound={handleToggleSound}
            onOpenCityReset={handleOpenCityReset}
          />

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
    </div>
  );
}
