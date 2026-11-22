import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DehydratedCloudSlot,
  dehydrateGameStateForCloud,
  estimateFirestoreDocBytes,
  isSaveSlotId,
  rehydrateGameStateFromCloudPayload,
  RestoredGraphMarks,
  SAVE_SLOT_IDS,
  SaveSlotId,
  SaveSlotSummary,
  slotIndexFromId,
} from './saveSlots';
import { GameState } from './types';

export interface CloudDownloadResult {
  summary: SaveSlotSummary;
  baseState: GameState;
  marks: RestoredGraphMarks;
  chunkCoordCenters: Array<{ lat: number; lng: number }>;
  pendingChunkKeys: string[];
}

const MAX_META_CORE_BATCH_BYTES = 950 * 1024;
const MAX_WRITE_BATCH_BYTES = 450 * 1024;
const MAX_WRITE_BATCH_OPS = 100;

const VALID_CLOUD_CORE_KEYS = new Set([
  'ownerUid',
  'slotId',
  'version',
  'capital',
  'totalLifetimeEarnings',
  'lastTickTimestamp',
  'startingCity',
  'stats',
  'settings',
  'skillsMap',
  'unlockedAchievementIds',
  'loadedOsmChunks',
  'loadedOsmRegions',
  'pendingSeedRegionIds',
  'completedOsmWays',
  'regions',
  'customBridgeEdges',
  'minigames',
  'createdAt',
  'updatedAt',
]);

const ensuredProfilesInSession = new Set<string>();

export function formatCloudSyncError(
  error: unknown,
  fallback = '클라우드 동기화 중 오류가 발생했습니다.'
): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  let parsedError = raw;
  let op = '';
  try {
    if (raw.trim().startsWith('{')) {
      const info = JSON.parse(raw) as { error?: string; operationType?: string };
      if (info.error) parsedError = String(info.error);
      if (info.operationType) op = String(info.operationType);
    }
  } catch {
    // Keep raw string
  }
  const lower = parsedError.toLowerCase();
  if (raw.includes('CLOUD_CORE_MISSING')) {
    return '클라우드 슬롯의 본문 데이터가 비어 있거나 손상되었습니다. 로컬 저장본으로 덮어쓰기 저장해 복구할 수 있습니다.';
  }
  if (lower.includes('permission-denied') || lower.includes('insufficient permissions')) {
    return op === 'get' || op === 'list'
      ? '클라우드 데이터를 읽을 권한이 없습니다. Google 계정으로 다시 로그인해 주세요.'
      : '클라우드 저장 권한이 거부되었습니다. 다시 Google 로그인 후 동기화를 시도해 주세요.';
  }
  if (lower.includes('unauthenticated')) {
    return '로그인 세션이 만료되었습니다. Google 계정으로 다시 로그인해 주세요.';
  }
  if (lower.includes('not-found') || lower.includes('no document to update')) {
    return '클라우드 슬롯 문서를 찾지 못했습니다. 새로고침 후 다시 저장해 주세요.';
  }
  if (lower.includes('quota exceeded') || lower.includes('resource-exhausted')) {
    return '클라우드 데이터베이스 일일 무료 사용량 한도를 초과했습니다. 내일 다시 시도하거나 업그레이드해 주세요.';
  }
  if (
    lower.includes('client is offline') ||
    lower.includes('unavailable') ||
    lower.includes('network') ||
    lower.includes('failed to fetch')
  ) {
    return '네트워크 연결이 불안정하여 클라우드 서버에 접속할 수 없습니다.';
  }
  if (lower.includes('invalid-argument') || lower.includes('exceeds the maximum allowed size')) {
    return '저장 데이터 크기가 클라우드 허용 한도를 초과했습니다.';
  }
  return parsedError ? `${fallback} (${parsedError.slice(0, 120)})` : fallback;
}

function isValidExistingDocShape(
  data: Record<string, unknown> | undefined,
  uid: string,
  requiredTimestampKey = 'createdAt'
): boolean {
  if (!data) return false;
  if (data.ownerUid !== uid && data.uid !== uid) return false;
  const ts = data[requiredTimestampKey];
  if (!ts || typeof ts !== 'object') return false;
  return true;
}

export async function ensureUserProfile(
  user: User,
  preferredSlotId: SaveSlotId
): Promise<SaveSlotId> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const rawEmail = user.email || (user.providerData?.[0]?.email ?? '');
  const email = (rawEmail || `${user.uid}@player.google.com`).slice(0, 254);
  const isGoogle = user.providerData?.some((p) => p.providerId === 'google.com');
  if (!user.emailVerified && !isGoogle) {
    return preferredSlotId;
  }
  const displayName = (user.displayName || 'Player').slice(0, 120);
  const photoURL = (user.photoURL || '').slice(0, 1024);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        email,
        photoURL,
        activeSlotId: preferredSlotId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ensuredProfilesInSession.add(user.uid);
      return preferredSlotId;
    }

    const data = snap.data();
    const existingActiveSlot = isSaveSlotId(data?.activeSlotId)
      ? data.activeSlotId
      : preferredSlotId;

    const unchanged =
      data?.uid === user.uid &&
      data?.displayName === displayName &&
      data?.email === email &&
      data?.photoURL === photoURL &&
      data?.activeSlotId === existingActiveSlot &&
      Boolean(data?.createdAt);

    if (unchanged) {
      ensuredProfilesInSession.add(user.uid);
      return existingActiveSlot;
    }

    try {
      await updateDoc(userRef, {
        displayName,
        email,
        photoURL,
        activeSlotId: existingActiveSlot,
        updatedAt: serverTimestamp(),
      });
    } catch (updateErr) {
      // If existing user doc satisfies ownership, allow cloud reads to proceed rather than failing all slot queries
      if (data?.uid === user.uid) {
        console.warn('User profile metadata refresh skipped:', updateErr);
      } else {
        throw updateErr;
      }
    }
    ensuredProfilesInSession.add(user.uid);
    return existingActiveSlot;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateCloudActiveSlot(
  uid: string,
  slotId: SaveSlotId,
  user?: User | null
): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    if (!ensuredProfilesInSession.has(uid)) {
      if (user && user.uid === uid) {
        await ensureUserProfile(user, slotId);
      } else {
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        ensuredProfilesInSession.add(uid);
      }
    }
    await updateDoc(userRef, {
      activeSlotId: slotId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function fetchCloudSlotSummaries(
  uid: string
): Promise<Partial<Record<SaveSlotId, SaveSlotSummary>>> {
  const slotsPath = `users/${uid}/slots`;
  try {
    const q = query(
      collection(db, 'users', uid, 'slots'),
      where('ownerUid', '==', uid)
    );
    const snap = await getDocs(q);
    const result: Partial<Record<SaveSlotId, SaveSlotSummary>> = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (!isSaveSlotId(docSnap.id)) return;
      const slotId = docSnap.id;
      result[slotId] = {
        slotId,
        slotIndex: Number(data.slotIndex) || slotIndexFromId(slotId),
        slotName: String(data.slotName || `슬롯 ${slotIndexFromId(slotId)}`),
        cityId: String(data.cityId || 'seoul'),
        cityName: String(data.cityName || '서울'),
        cityCountry: String(data.cityCountry || ''),
        cityLat: Number(data.cityLat) || 37.5665,
        cityLng: Number(data.cityLng) || 126.978,
        cityZoom: Number(data.cityZoom) || 14,
        cityDescription: String(data.cityDescription || ''),
        cityIsCustom: Boolean(data.cityIsCustom),
        capital: Number(data.capital) || 0,
        mapped1to1Km: Number(data.mapped1to1Km) || 0,
        connectedOsmNodes: Number(data.connectedOsmNodes) || 0,
        totalOsmEdgesBuilt: Number(data.totalOsmEdgesBuilt) || 0,
        tierLabel: String(data.tierLabel || 'Bronze I'),
        clientSavedAt: Number(data.clientSavedAt) || 0,
        source: 'cloud',
        cloudSavedAt: Number(data.clientSavedAt) || 0,
      };
    });
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, slotsPath);
  }
}

const lastUploadedGraphSig = new Map<
  string,
  { sig: string; chunkCount: number }
>();

function fnv1aHashUpdate(hash: number, str: string): number {
  let h = hash >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= 0xff;
  return Math.imul(h, 0x01000193) >>> 0;
}

function computeGraphChunksSig(
  chunks: DehydratedCloudSlot['graphChunks']
): string {
  let hash = 0x811c9dc5;
  let totalNodes = 0;
  let totalEdges = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    totalNodes += c.nodeIds.length;
    totalEdges += c.edgeIds.length;
    hash = fnv1aHashUpdate(hash, `c:${c.chunkIndex}:${c.nodeIds.length}:${c.edgeIds.length}`);
    for (let j = 0; j < c.nodeIds.length; j++) {
      hash = fnv1aHashUpdate(hash, c.nodeIds[j]);
    }
    for (let j = 0; j < c.edgeIds.length; j++) {
      hash = fnv1aHashUpdate(hash, c.edgeIds[j]);
    }
  }
  return `${chunks.length}:${totalNodes}:${totalEdges}:${hash.toString(16)}`;
}

export async function uploadSlotToCloud(
  user: User,
  slotId: SaveSlotId,
  state: GameState,
  options?: {
    slotName?: string;
    clientSavedAt?: number;
    forceGraphSync?: boolean;
    pendingMarks?: RestoredGraphMarks | null;
  }
): Promise<SaveSlotSummary> {
  if (!SAVE_SLOT_IDS.includes(slotId)) {
    throw new Error(`Invalid save slot id: ${slotId}`);
  }
  const uid = user.uid;
  const userRef = doc(db, 'users', uid);
  if (!ensuredProfilesInSession.has(uid)) {
    await ensureUserProfile(user, slotId);
  }

  const slotPath = `users/${uid}/slots/${slotId}`;
  const slotRef = doc(db, 'users', uid, 'slots', slotId);
  const coreRef = doc(db, 'users', uid, 'slots', slotId, 'core', 'state');
  const chunksCol = collection(db, 'users', uid, 'slots', slotId, 'chunks');

  try {
    const dehydrated = dehydrateGameStateForCloud(slotId, state, {
      slotName: options?.slotName,
      clientSavedAt: options?.clientSavedAt,
      pendingMarks: options?.pendingMarks,
    });
    const nextGraphSig = computeGraphChunksSig(dehydrated.graphChunks);
    const cacheKey = `${uid}:${slotId}`;
    const prevGraphCached = lastUploadedGraphSig.get(cacheKey);

    let slotSnap = await getDoc(slotRef);
    let slotExists = slotSnap.exists();
    if (!slotExists) {
      // Double-check parent user profile exists so relational create rule never fails
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        ensuredProfilesInSession.delete(uid);
        await ensureUserProfile(user, slotId);
      }
    }

    let coreSnap = slotExists ? await getDoc(coreRef) : null;
    const slotData = slotExists ? (slotSnap.data() as Record<string, unknown>) : undefined;
    const coreData = coreSnap?.exists() ? (coreSnap.data() as Record<string, unknown>) : undefined;

    // Self-heal corrupted or legacy docs that would fail strict update rules (e.g. missing createdAt or extra keys)
    const isSlotUpdateSafe =
      slotExists &&
      isValidExistingDocShape(slotData, uid) &&
      slotData?.slotId === slotId &&
      Number(slotData?.slotIndex) === slotIndexFromId(slotId);
    const isCoreUpdateSafe =
      Boolean(coreSnap?.exists()) &&
      isValidExistingDocShape(coreData, uid) &&
      coreData?.slotId === slotId &&
      Object.keys(coreData || {}).every((k) => VALID_CLOUD_CORE_KEYS.has(k));

    if (slotExists && (!isSlotUpdateSafe || (coreSnap?.exists() && !isCoreUpdateSafe))) {
      await deleteCloudSlot(uid, slotId);
      slotExists = false;
      coreSnap = null;
      lastUploadedGraphSig.delete(cacheKey);
    }

    const canSkipChunks =
      !options?.forceGraphSync &&
      slotExists &&
      Boolean(coreSnap?.exists()) &&
      Number(slotData?.graphChunkCount) === dehydrated.graphChunks.length &&
      Boolean(prevGraphCached) &&
      prevGraphCached!.sig === nextGraphSig;

    const existingChunksSnap =
      slotExists && !canSkipChunks
        ? await getDocs(query(chunksCol, where('ownerUid', '==', uid)))
        : null;

    const existingSlotName = slotExists
      ? String(slotSnap.data()?.slotName || '').trim()
      : undefined;
    const resolvedName = (
      options?.slotName?.trim() ||
      (existingSlotName && slotSnap.data()?.cityId === state.startingCity.id
        ? existingSlotName
        : undefined) ||
      dehydrated.metaFields.slotName
    ).slice(0, 60);
    if (resolvedName && resolvedName !== dehydrated.metaFields.slotName) {
      dehydrated.metaFields.slotName = resolvedName;
    }

    const metaPayload = slotExists
      ? {
          slotName: dehydrated.metaFields.slotName,
          cityId: dehydrated.metaFields.cityId,
          cityName: dehydrated.metaFields.cityName,
          cityCountry: dehydrated.metaFields.cityCountry,
          cityLat: dehydrated.metaFields.cityLat,
          cityLng: dehydrated.metaFields.cityLng,
          cityZoom: dehydrated.metaFields.cityZoom,
          cityDescription: dehydrated.metaFields.cityDescription,
          cityIsCustom: dehydrated.metaFields.cityIsCustom,
          capital: dehydrated.metaFields.capital,
          mapped1to1Km: dehydrated.metaFields.mapped1to1Km,
          connectedOsmNodes: dehydrated.metaFields.connectedOsmNodes,
          totalOsmEdgesBuilt: dehydrated.metaFields.totalOsmEdgesBuilt,
          tierLabel: dehydrated.metaFields.tierLabel,
          graphChunkCount: dehydrated.metaFields.graphChunkCount,
          clientSavedAt: dehydrated.metaFields.clientSavedAt,
          updatedAt: serverTimestamp(),
        }
      : {
          ...dehydrated.metaFields,
          ownerUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

    const corePayload =
      coreSnap && coreSnap.exists()
        ? {
            ...dehydrated.coreFields,
            updatedAt: serverTimestamp(),
          }
        : {
            ...dehydrated.coreFields,
            ownerUid: uid,
            slotId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

    const metaBytes = estimateFirestoreDocBytes(metaPayload as unknown as Record<string, unknown>);
    const coreBytes = estimateFirestoreDocBytes(corePayload as unknown as Record<string, unknown>);

    // Commit slot meta and core atomically in one batch (WriteBatch limit is 10 MiB; meta+core <= 950KB)
    const metaCoreBatch = writeBatch(db);
    if (slotExists) {
      metaCoreBatch.update(slotRef, metaPayload);
    } else {
      metaCoreBatch.set(slotRef, metaPayload);
    }

    if (metaBytes + coreBytes <= MAX_META_CORE_BATCH_BYTES) {
      if (coreSnap && coreSnap.exists()) {
        metaCoreBatch.update(coreRef, corePayload);
      } else {
        metaCoreBatch.set(coreRef, corePayload);
      }
      await metaCoreBatch.commit();
    } else {
      // Fallback only if ever near 1MB, still create core first only when slot already existed
      if (slotExists) {
        const coreBatch = writeBatch(db);
        if (coreSnap && coreSnap.exists()) {
          coreBatch.update(coreRef, corePayload);
        } else {
          coreBatch.set(coreRef, corePayload);
        }
        await coreBatch.commit();
        await metaCoreBatch.commit();
      } else {
        if (coreSnap && coreSnap.exists()) {
          metaCoreBatch.update(coreRef, corePayload);
        } else {
          metaCoreBatch.set(coreRef, corePayload);
        }
        await metaCoreBatch.commit();
      }
    }

    if (!canSkipChunks || !slotExists) {
      const existingChunksById = new Map<string, Record<string, unknown>>();
      if (existingChunksSnap) {
        existingChunksSnap.forEach((d) =>
          existingChunksById.set(d.id, d.data() as Record<string, unknown>)
        );
      }

      const nextChunkIds = new Set<string>();
      let chunkBatch = writeBatch(db);
      let batchOps = 0;
      let batchBytes = 0;

      const flushChunkBatch = async () => {
        if (batchOps === 0) return;
        await chunkBatch.commit();
        chunkBatch = writeBatch(db);
        batchOps = 0;
        batchBytes = 0;
      };

      for (const chunk of dehydrated.graphChunks) {
        const chunkId = `graph_${chunk.chunkIndex}`;
        nextChunkIds.add(chunkId);
        const chunkRef = doc(db, 'users', uid, 'slots', slotId, 'chunks', chunkId);
        const prevChunkData = existingChunksById.get(chunkId);
        const canUpdateChunk =
          Boolean(prevChunkData) &&
          isValidExistingDocShape(prevChunkData, uid) &&
          prevChunkData?.slotId === slotId &&
          Number(prevChunkData?.chunkIndex) === chunk.chunkIndex;

        const chunkPayload = canUpdateChunk
          ? {
              nodeIds: chunk.nodeIds,
              edgeIds: chunk.edgeIds,
              updatedAt: serverTimestamp(),
            }
          : {
              ownerUid: uid,
              slotId,
              chunkIndex: chunk.chunkIndex,
              nodeIds: chunk.nodeIds,
              edgeIds: chunk.edgeIds,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
        const opBytes = estimateFirestoreDocBytes(chunkPayload as unknown as Record<string, unknown>);

        if (
          batchOps > 0 &&
          (batchOps >= MAX_WRITE_BATCH_OPS || batchBytes + opBytes > MAX_WRITE_BATCH_BYTES)
        ) {
          await flushChunkBatch();
        }

        if (prevChunkData && !canUpdateChunk) {
          chunkBatch.delete(chunkRef);
          batchOps++;
          batchBytes += 256;
          if (batchOps >= MAX_WRITE_BATCH_OPS || batchBytes + opBytes > MAX_WRITE_BATCH_BYTES) {
            await flushChunkBatch();
          }
        }

        if (canUpdateChunk) {
          chunkBatch.update(chunkRef, chunkPayload);
        } else {
          chunkBatch.set(chunkRef, chunkPayload);
        }
        batchOps++;
        batchBytes += opBytes;
      }

      for (const oldChunkId of existingChunksById.keys()) {
        if (!nextChunkIds.has(oldChunkId)) {
          if (batchOps >= MAX_WRITE_BATCH_OPS || batchBytes + 256 > MAX_WRITE_BATCH_BYTES) {
            await flushChunkBatch();
          }
          chunkBatch.delete(doc(db, 'users', uid, 'slots', slotId, 'chunks', oldChunkId));
          batchOps++;
          batchBytes += 256;
        }
      }

      await flushChunkBatch();
      lastUploadedGraphSig.set(cacheKey, {
        sig: nextGraphSig,
        chunkCount: dehydrated.graphChunks.length,
      });
    }

    return {
      ...dehydrated.metaFields,
      source: 'synced',
      cloudSavedAt: dehydrated.metaFields.clientSavedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, slotPath);
  }
}

export async function downloadCloudSlot(
  uid: string,
  slotId: SaveSlotId
): Promise<CloudDownloadResult | null> {
  const slotPath = `users/${uid}/slots/${slotId}`;
  const slotRef = doc(db, 'users', uid, 'slots', slotId);
  const coreRef = doc(db, 'users', uid, 'slots', slotId, 'core', 'state');
  const chunksCol = collection(db, 'users', uid, 'slots', slotId, 'chunks');

  try {
    const slotSnap = await getDoc(slotRef);
    if (!slotSnap.exists()) {
      return null;
    }

    const [coreSnap, chunksSnap] = await Promise.all([
      getDoc(coreRef),
      getDocs(query(chunksCol, where('ownerUid', '==', uid))),
    ]);

    if (!coreSnap.exists()) {
      throw new Error('CLOUD_CORE_MISSING');
    }

    const metaData = slotSnap.data();
    const coreData = coreSnap.data() as unknown as DehydratedCloudSlot['coreFields'];
    const graphChunks: Array<{ chunkIndex: number; nodeIds: string[]; edgeIds: string[] }> = [];
    chunksSnap.forEach((docSnap) => {
      const c = docSnap.data();
      graphChunks.push({
        chunkIndex: Number(c.chunkIndex) || 0,
        nodeIds: Array.isArray(c.nodeIds) ? (c.nodeIds as string[]) : [],
        edgeIds: Array.isArray(c.edgeIds) ? (c.edgeIds as string[]) : [],
      });
    });

    const { baseState, marks } = rehydrateGameStateFromCloudPayload(coreData, graphChunks);
    const chunkCoordCenters: Array<{ lat: number; lng: number }> = [];
    const seen = new Set<string>();
    for (const key of coreData.loadedOsmChunks || []) {
      const parts = String(key).split('_');
      if (parts.length !== 2) continue;
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const bucket = `${(Math.round(lat * 50) / 50).toFixed(2)}_${(
        Math.round(lng * 50) / 50
      ).toFixed(2)}`;
      if (!seen.has(bucket)) {
        seen.add(bucket);
        chunkCoordCenters.push({ lat, lng });
      }
    }

    const summary: SaveSlotSummary = {
      slotId,
      slotIndex: Number(metaData.slotIndex) || slotIndexFromId(slotId),
      slotName: String(metaData.slotName || `슬롯 ${slotIndexFromId(slotId)}`),
      cityId: String(metaData.cityId || baseState.startingCity.id),
      cityName: String(metaData.cityName || baseState.startingCity.name),
      cityCountry: String(metaData.cityCountry || baseState.startingCity.country),
      cityLat: Number(metaData.cityLat) || baseState.startingCity.lat,
      cityLng: Number(metaData.cityLng) || baseState.startingCity.lng,
      cityZoom: Number(metaData.cityZoom) || baseState.startingCity.zoom,
      cityDescription: String(metaData.cityDescription || baseState.startingCity.description),
      cityIsCustom: Boolean(metaData.cityIsCustom),
      capital: Number(metaData.capital) || baseState.capital,
      mapped1to1Km: Number(metaData.mapped1to1Km) || 0,
      connectedOsmNodes: Number(metaData.connectedOsmNodes) || 0,
      totalOsmEdgesBuilt: Number(metaData.totalOsmEdgesBuilt) || 0,
      tierLabel: String(metaData.tierLabel || 'Bronze I'),
      clientSavedAt: Number(metaData.clientSavedAt) || 0,
      source: 'synced',
      cloudSavedAt: Number(metaData.clientSavedAt) || 0,
    };

    const pendingChunkKeys = Array.from(
      new Set((coreData.loadedOsmChunks || []).map((k) => String(k || '').trim()).filter(Boolean))
    );

    return {
      summary,
      baseState,
      marks,
      chunkCoordCenters,
      pendingChunkKeys,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, slotPath);
  }
}

export async function renameCloudSlot(
  uid: string,
  slotId: SaveSlotId,
  newName: string
): Promise<void> {
  const slotPath = `users/${uid}/slots/${slotId}`;
  const trimmed = newName.trim().slice(0, 60);
  if (!trimmed) return;
  try {
    await updateDoc(doc(db, 'users', uid, 'slots', slotId), {
      slotName: trimmed,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, slotPath);
  }
}

export async function deleteCloudSlot(uid: string, slotId: SaveSlotId): Promise<void> {
  const slotPath = `users/${uid}/slots/${slotId}`;
  const slotRef = doc(db, 'users', uid, 'slots', slotId);
  const coreRef = doc(db, 'users', uid, 'slots', slotId, 'core', 'state');
  const chunksCol = collection(db, 'users', uid, 'slots', slotId, 'chunks');

  try {
    const slotSnap = await getDoc(slotRef);
    if (!slotSnap.exists()) {
      return;
    }
    const chunksSnap = await getDocs(query(chunksCol, where('ownerUid', '==', uid)));
    const chunkRefs = chunksSnap.docs.map((d) => d.ref);
    for (let i = 0; i < chunkRefs.length; i += MAX_WRITE_BATCH_OPS) {
      const delBatch = writeBatch(db);
      const slice = chunkRefs.slice(i, i + MAX_WRITE_BATCH_OPS);
      for (const ref of slice) {
        delBatch.delete(ref);
      }
      await delBatch.commit();
    }
    const finalBatch = writeBatch(db);
    finalBatch.delete(coreRef);
    finalBatch.delete(slotRef);
    await finalBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, slotPath);
  }
}
