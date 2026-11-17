import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Award, CheckCircle2, Sparkles } from 'lucide-react';
import { TitleScreen } from './components/TitleScreen';
import { WorldMap } from './components/WorldMap';
import { HUD, ModalTab } from './components/HUD';
import { LinesPanel } from './components/LinesPanel';
import { UpgradesPanel } from './components/UpgradesPanel';
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
  TransportLine,
} from './game/types';
import {
  backfillMinigamesState,
  boostShipyardChain,
  buyMineUpgrade,
  buyQuantumUpgrade,
  buyReactorUpgrade,
  buyShipyardUnit,
  digMineLayer,
  evaluateMinigameMilestones,
  exchangeMoneyToMinigameCurrency,
  MINIGAME_META,
  MineUpgradeKind,
  placeReactorCell,
  prestigeShipyardFleet,
  pulseQuantumExperiment,
  QuantumUpgradeKind,
  ReactorUpgradeKind,
  ShipyardUnitKind,
  tuneQuantumWave,
  ventReactorHeat,
} from './game/minigames';
import {
  advanceTick,
  buyUpgrade,
  calculateMultipliers,
  calculatePrestigeGain,
  calculateTotalIncomePerSec,
  CompletedOsmWayEvent,
  connectOsmPath,
  createInitialGameState,
  dispatchClickBonus,
  mergeOsmChunk,
  scopeGameStateToStartingCity,
  unlockSkill,
} from './game/rules';
import {
  chunkKeyForCoords,
  fetchOsmProvincialRegion,
  fetchOsmRoadChunk,
  generateCustomCityNetwork,
} from './game/osmService';
import { INITIAL_SKILLS, INITIAL_UPGRADES } from './game/worldCatalog';
import { soundManager } from './game/audio';

const SAVE_KEY = 'TERRALINE_SAVE_V4';

interface ToastNotification {
  id: string;
  kind: 'line' | 'achievement' | 'info';
  title: string;
  subtitle: string;
}

function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || !parsed.startingCity || !Array.isArray(parsed.segments)) {
      return null;
    }

    // Backfill newly introduced fields if needed
    const skills =
      Array.isArray(parsed.skills) && parsed.skills.length === INITIAL_SKILLS.length
        ? parsed.skills
        : INITIAL_SKILLS.map((sk) => ({ ...sk, requires: [...sk.requires] }));

    const upgrades =
      Array.isArray(parsed.upgrades) && parsed.upgrades.length === INITIAL_UPGRADES.length
        ? parsed.upgrades
        : INITIAL_UPGRADES.map((u) => ({
            ...u,
            unlockRequirement: u.unlockRequirement ? { ...u.unlockRequirement } : undefined,
          }));

    return scopeGameStateToStartingCity({
      ...parsed,
      osmNodes: Array.isArray(parsed.osmNodes) ? parsed.osmNodes : [],
      osmEdges: Array.isArray(parsed.osmEdges) ? parsed.osmEdges : [],
      loadedOsmChunks: Array.isArray(parsed.loadedOsmChunks) ? parsed.loadedOsmChunks : [],
      loadedOsmRegions: Array.isArray(parsed.loadedOsmRegions) ? parsed.loadedOsmRegions : [],
      completedOsmWays: Array.isArray(parsed.completedOsmWays) ? parsed.completedOsmWays : [],
      skills,
      upgrades,
      minigames: backfillMinigamesState(parsed.minigames),
      stats: {
        totalSegmentsBuilt: parsed.stats?.totalSegmentsBuilt || 0,
        totalOsmEdgesBuilt: parsed.stats?.totalOsmEdgesBuilt || 0,
        connectedOsmNodes: parsed.stats?.connectedOsmNodes || 0,
        totalScaledNodes: parsed.stats?.totalScaledNodes || 0,
        totalLinesCompleted: parsed.stats?.totalLinesCompleted || 0,
        totalTownsCompleted: parsed.stats?.totalTownsCompleted || 0,
        totalClicks: parsed.stats?.totalClicks || 0,
        mapped1to1Km: parsed.stats?.mapped1to1Km || 0,
        totalNetworkKm: parsed.stats?.totalNetworkKm || 0,
        prestigeCount: parsed.stats?.prestigeCount || 0,
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
  const [flyToTarget, setFlyToTarget] = useState<{
    lat: number;
    lng: number;
    zoom: number;
    ts: number;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const stateRef = useRef<GameState | null>(null);
  stateRef.current = gameState;

  const checkedProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightProvinceCellsRef = useRef<Set<string>>(new Set());
  const inFlightChunkKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.body.dataset.state = screenState;
  }, [screenState]);

  const pushToast = useCallback(
    (kind: ToastNotification['kind'], title: string, subtitle: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, kind, title, subtitle }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const announceMilestones = useCallback(
    (milestones: MinigameMilestoneDef[]) => {
      if (milestones.length === 0) return;
      soundManager.playUpgradeUnlocked();
      milestones.forEach((ms) => {
        const meta = MINIGAME_META[ms.gameId];
        pushToast(
          'achievement',
          `${meta.shortName} 마일스톤 달성: ${ms.title}`,
          `${ms.description} · 메인 자금 수익 +${ms.incomeBoostPct}% 부스트!`
        );
      });
    },
    [pushToast]
  );

  const announceCompletions = useCallback(
    (
      lines: TransportLine[],
      achievements: Achievement[],
      osmWays: CompletedOsmWayEvent[] = []
    ) => {
      if (lines.length === 0 && achievements.length === 0 && osmWays.length === 0) return;

      soundManager.playRouteBuilt();
      try {
        confetti({
          particleCount: 45,
          spread: 65,
          origin: { y: 0.75 },
        });
      } catch {
        // Ignore confetti failures in constrained environments
      }

      lines.forEach((line) => {
        pushToast(
          'line',
          `노선 완공: ${line.lineCode}`,
          `${line.name} · ${line.completionBonus.label}`
        );
      });

      osmWays.forEach((way) => {
        pushToast(
          'line',
          `실제 ${way.mode === 'rail' ? '철도' : '도로'} 완공: ${way.wayName}`,
          `${way.edgeCount}개 노드 구간 완전 연결 · 보너스 +$${way.bonusCash.toLocaleString()}`
        );
      });

      achievements.forEach((ach) => {
        pushToast('achievement', `업적 달성: ${ach.title}`, ach.rewardText);
      });
    },
    [pushToast]
  );

  // Load OpenStreetMap dense street/rail chunk around coordinates
  const handleLoadOsmChunk = useCallback(
    async (lat: number, lng: number, silent = false) => {
      const key = chunkKeyForCoords(lat, lng);
      if (inFlightChunkKeysRef.current.has(key)) return;
      inFlightChunkKeysRef.current.add(key);
      try {
        const chunk = await fetchOsmRoadChunk(lat, lng);
        setGameState((prev) => {
          if (!prev) return prev;
          return mergeOsmChunk(prev, chunk.chunkKey, chunk.osmNodes, chunk.osmEdges);
        });
        if (!silent && chunk.usedLiveOverpass) {
          pushToast(
            'info',
            '주변 실측 OpenStreetMap 도로 로드 완료',
            `도로·철도 노드 ${chunk.osmNodes.length}개 · ${chunk.osmEdges.length}개 구간이 자동으로 추가되었습니다.`
          );
        }
      } finally {
        inFlightChunkKeysRef.current.delete(key);
      }
    },
    [pushToast]
  );

  // Auto-load entire enclosing OSM provincial region whenever a connected node is owned inside it
  const handleAutoLoadProvince = useCallback(
    async (lat: number, lng: number) => {
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
        const region = await fetchOsmProvincialRegion(lat, lng);
        if (region.osmNodes.length > 0) {
          checkedProvinceCellsRef.current.add(cellKey);
          setGameState((prev) => {
            if (!prev) return prev;
            const isNewRegion = !(prev.loadedOsmRegions || []).includes(region.regionId);
            const merged = mergeOsmChunk(
              prev,
              region.chunkKey,
              region.osmNodes,
              region.osmEdges,
              region.regionId
            );
            if (isNewRegion) {
              queueMicrotask(() =>
                pushToast(
                  'info',
                  `${region.regionName} 광역 노드 자동 로드`,
                  `해당 행정구역의 실측 도로·철도 노드 ${region.osmNodes.length}개를 자동으로 불러왔습니다.`
                )
              );
            }
            return merged;
          });
        }
      } finally {
        inFlightProvinceCellsRef.current.delete(cellKey);
      }
    },
    [pushToast]
  );

  // Start new game with selected preset or OSM-searched custom city
  const handleStartWithCity = useCallback(
    async (city: StartingCity) => {
      let customNetwork;
      if (city.isCustom) {
        customNetwork = await generateCustomCityNetwork(city);
      }

      checkedProvinceCellsRef.current.clear();
      inFlightProvinceCellsRef.current.clear();
      inFlightChunkKeysRef.current.clear();

      const fresh = createInitialGameState(city, customNetwork);
      soundManager.enabled = fresh.settings.soundEnabled;
      setGameState(fresh);
      setSavedSnapshot(fresh);
      localStorage.setItem(SAVE_KEY, JSON.stringify(fresh));
      setFlyToTarget(null);
      setActiveModal(null);
      setScreenState('playing');

      // Immediately stream starting city local dense grid & enclosing OSM provincial region
      handleLoadOsmChunk(city.lat, city.lng, true);
      handleAutoLoadProvince(city.lat, city.lng);

      pushToast(
        'info',
        `${city.name} 거점 개설 완료`,
        '개척된 노드 끝단에서 보이는 미개척 노드(거리 d≤5)를 연결하면 해당 광역 지역의 도로·철도가 자동으로 이어집니다!'
      );
    },
    [handleAutoLoadProvince, handleLoadOsmChunk, pushToast]
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

    if ((resumed.osmNodes || []).length === 0) {
      handleLoadOsmChunk(resumed.startingCity.lat, resumed.startingCity.lng, true);
      handleAutoLoadProvince(resumed.startingCity.lat, resumed.startingCity.lng);
    }

    if (offlineEarned > 0) {
      pushToast(
        'info',
        '오프라인 자동 운행 정산',
        `부재 중 네트워크 수익 +$${offlineEarned.toLocaleString()} 적립되었습니다.`
      );
    }
  }, [handleAutoLoadProvince, handleLoadOsmChunk, pushToast]);

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
          handleLoadOsmChunk(lat, lng, true);
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
          if (
            res.newlyCompletedLines.length > 0 ||
            res.newlyUnlockedAchievements.length > 0 ||
            res.newlyCompletedOsmWays.length > 0
          ) {
            queueMicrotask(() => {
              announceCompletions(
                res.newlyCompletedLines,
                res.newlyUnlockedAchievements,
                res.newlyCompletedOsmWays
              );
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
  }, [screenState, announceCompletions, announceMilestones]);

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
        if (!res.success) {
          if (res.reason) {
            queueMicrotask(() => pushToast('info', '노드 연결 안내', res.reason!));
          }
          return prev;
        }
        soundManager.playBlip();
        if (res.builtCount > 1) {
          queueMicrotask(() =>
            pushToast(
              'info',
              `${res.builtCount}개 도로·철도 구간 연속 연결 완료`,
              '선택한 노드가 새 시점으로 유지되어 계속 노드를 이어 나갈 수 있습니다.'
            )
          );
        }
        if (
          res.newlyCompletedLines.length > 0 ||
          res.newlyUnlockedAchievements.length > 0 ||
          res.newlyCompletedOsmWays.length > 0
        ) {
          queueMicrotask(() => {
            announceCompletions(
              res.newlyCompletedLines,
              res.newlyUnlockedAchievements,
              res.newlyCompletedOsmWays
            );
          });
        }
        return res.newState;
      });
    },
    [announceCompletions, pushToast]
  );

  const handleBuyUpgrade = useCallback((upgradeId: string, count: 1 | 10 | 'max') => {
    setGameState((prev) => {
      if (!prev) return prev;
      const res = buyUpgrade(prev, upgradeId, count);
      if (!res.success) return prev;
      soundManager.playUpgradeUnlocked();
      return res.newState;
    });
  }, []);

  const handleUnlockSkill = useCallback(
    (skillId: string) => {
      setGameState((prev) => {
        if (!prev) return prev;
        const res = unlockSkill(prev, skillId);
        if (!res.success) return prev;
        soundManager.playUpgradeUnlocked();
        if (res.newlyUnlockedAchievements.length > 0) {
          queueMicrotask(() => {
            announceCompletions([], res.newlyUnlockedAchievements);
          });
        }
        return res.newState;
      });
    },
    [announceCompletions]
  );

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

  const handleExecutePrestige = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const mults = calculateMultipliers(current);
    const gain = calculatePrestigeGain(current.totalLifetimeEarnings, mults.prestigeBonusMult);
    if (gain <= 0) return;

    const nextMultiplier = Number((current.prestigeMultiplier + gain).toFixed(2));
    const nextCount = current.stats.prestigeCount + 1;

    let customNet;
    if (current.startingCity.isCustom) {
      customNet = await generateCustomCityNetwork(current.startingCity);
    }

    const prestigedState = createInitialGameState(current.startingCity, customNet, {
      prestigeCount: nextCount,
      prestigeMultiplier: nextMultiplier,
    });
    prestigedState.settings = { ...current.settings };
    prestigedState.minigames = backfillMinigamesState(current.minigames);

    checkedProvinceCellsRef.current.clear();
    inFlightProvinceCellsRef.current.clear();
    inFlightChunkKeysRef.current.clear();

    setGameState(prestigedState);
    localStorage.setItem(SAVE_KEY, JSON.stringify(prestigedState));
    setSavedSnapshot(prestigedState);
    setActiveModal(null);
    soundManager.playRouteBuilt();

    handleLoadOsmChunk(current.startingCity.lat, current.startingCity.lng, true);
    handleAutoLoadProvince(current.startingCity.lat, current.startingCity.lng);

    try {
      confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
    } catch {
      // Ignore
    }
    pushToast(
      'achievement',
      `세계 확장 ${nextCount}회 달성!`,
      `영구 수익 배수가 ×${nextMultiplier.toFixed(2)}로 상승하고 +2 SP를 추가로 받았습니다.`
    );
  }, [handleAutoLoadProvince, handleLoadOsmChunk, pushToast]);

  return (
    <div className="w-full h-[100dvh] bg-[#090d16] text-slate-100 overflow-hidden select-none">
      {screenState === 'title' && (
        <TitleScreen
          onStartWithCity={handleStartWithCity}
          hasSavedGame={Boolean(savedSnapshot)}
          onResumeSavedGame={handleResumeSavedGame}
          savedCityName={savedSnapshot?.startingCity.name}
          savedKm={savedSnapshot?.stats.totalNetworkKm}
          savedCapital={savedSnapshot?.capital}
        />
      )}

      {screenState === 'playing' && gameState && (
        <>
          <WorldMap
            gameState={gameState}
            flyToTarget={flyToTarget}
            onConnectOsmPath={handleConnectOsmPath}
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

          {activeModal === 'upgrades' && (
            <UpgradesPanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onBuyUpgrade={handleBuyUpgrade}
            />
          )}

          {activeModal === 'skills' && (
            <SkillTreePanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onUnlockSkill={handleUnlockSkill}
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
              onExecutePrestige={handleExecutePrestige}
            />
          )}

          {activeModal === 'arcade' && (
            <TownArcadePanel
              gameState={gameState}
              onClose={() => setActiveModal(null)}
              onExchangeMoney={(gameId: MinigameId, moneyAmount: number) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = exchangeMoneyToMinigameCurrency(prev, gameId, moneyAmount);
                  if (!res.success) return prev;
                  soundManager.playCashRegister();
                  const meta = MINIGAME_META[gameId];
                  queueMicrotask(() =>
                    pushToast(
                      'info',
                      `${meta.name} 단방향 환전 완료`,
                      `$${Math.floor(moneyAmount).toLocaleString()} → +${res.gained.toLocaleString()} ${meta.currencySymbol}`
                    )
                  );
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
                  return {
                    ...prev,
                    minigames: evaluated.minigames,
                  };
                });
              }}
              onBuyMineUpgrade={(kind: MineUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyMineUpgrade(prev.minigames.mine, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, mine: res.mine },
                  };
                });
              }}
              onPlaceReactorCell={(cellIndex: number, cellType: ReactorCellType) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = placeReactorCell(prev.minigames.reactor, cellIndex, cellType);
                  if (!res.success) return prev;
                  soundManager.playBlip();
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, reactor: res.reactor },
                  };
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
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, reactor: res.reactor },
                  };
                });
              }}
              onBoostShipyard={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  soundManager.playBlip();
                  const nextMg: MinigamesState = {
                    ...prev.minigames,
                    shipyard: boostShipyardChain(prev.minigames.shipyard),
                  };
                  const evaluated = evaluateMinigameMilestones(nextMg);
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return {
                    ...prev,
                    minigames: evaluated.minigames,
                  };
                });
              }}
              onBuyShipyardUnit={(kind: ShipyardUnitKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyShipyardUnit(prev.minigames.shipyard, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, shipyard: res.shipyard },
                  };
                });
              }}
              onPrestigeShipyard={() => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = prestigeShipyardFleet(prev.minigames.shipyard);
                  if (!res.success) return prev;
                  soundManager.playRouteBuilt();
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, shipyard: res.shipyard },
                  };
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
                  const nextMg: MinigamesState = {
                    ...prev.minigames,
                    quantum: pulseQuantumExperiment(prev.minigames.quantum),
                  };
                  const evaluated = evaluateMinigameMilestones(nextMg);
                  if (evaluated.newlyUnlocked.length > 0) {
                    queueMicrotask(() => announceMilestones(evaluated.newlyUnlocked));
                  }
                  return {
                    ...prev,
                    minigames: evaluated.minigames,
                  };
                });
              }}
              onBuyQuantumUpgrade={(kind: QuantumUpgradeKind) => {
                setGameState((prev) => {
                  if (!prev) return prev;
                  const res = buyQuantumUpgrade(prev.minigames.quantum, kind);
                  if (!res.success) return prev;
                  soundManager.playUpgradeUnlocked();
                  return {
                    ...prev,
                    minigames: { ...prev.minigames, quantum: res.quantum },
                  };
                });
              }}
            />
          )}

          {/* Toast Stack for Line Completions & Achievements */}
          {toasts.length > 0 && (
            <div
              className="fixed top-[116px] sm:top-auto sm:bottom-20 left-2 right-2 sm:left-auto sm:right-3 z-50 flex flex-col gap-2 sm:w-80 pointer-events-none"
              aria-live="polite"
            >
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  className={`p-3.5 rounded-xl border shadow-2xl flex items-start gap-2.5 ${
                    toast.kind === 'achievement'
                      ? 'bg-slate-950/95 border-yellow-500/60'
                      : toast.kind === 'line'
                      ? 'bg-slate-950/95 border-emerald-500/60'
                      : 'bg-slate-950/95 border-sky-500/50'
                  }`}
                >
                  {toast.kind === 'achievement' ? (
                    <Award className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  ) : toast.kind === 'line' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                  )}
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

