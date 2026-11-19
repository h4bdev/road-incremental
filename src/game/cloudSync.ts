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
}

const ensuredProfilesInSession = new Set<string>();

export async function ensureUserProfile(
  user: User,
  preferredSlotId: SaveSlotId
): Promise<SaveSlotId> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const email = (user.email || '').slice(0, 254);
  if (!email || !user.emailVerified) {
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

    await updateDoc(userRef, {
      displayName,
      email,
      photoURL,
      activeSlotId: existingActiveSlot,
      updatedAt: serverTimestamp(),
    });
    ensuredProfilesInSession.add(user.uid);
    return existingActiveSlot;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateCloudActiveSlot(
  uid: string,
  slotId: SaveSlotId
): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
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

export async function uploadSlotToCloud(
  user: User,
  slotId: SaveSlotId,
  state: GameState,
  options?: { slotName?: string; clientSavedAt?: number }
): Promise<SaveSlotSummary> {
  if (!SAVE_SLOT_IDS.includes(slotId)) {
    throw new Error(`Invalid save slot id: ${slotId}`);
  }
  const uid = user.uid;
  if (!ensuredProfilesInSession.has(uid)) {
    await ensureUserProfile(user, slotId);
  }

  const slotPath = `users/${uid}/slots/${slotId}`;
  const slotRef = doc(db, 'users', uid, 'slots', slotId);
  const coreRef = doc(db, 'users', uid, 'slots', slotId, 'core', 'state');
  const chunksCol = collection(db, 'users', uid, 'slots', slotId, 'chunks');

  try {
    const slotSnap = await getDoc(slotRef);
    const coreSnap = slotSnap.exists() ? await getDoc(coreRef) : null;
    const existingChunksSnap = slotSnap.exists()
      ? await getDocs(query(chunksCol, where('ownerUid', '==', uid))).catch(() => null)
      : null;

    const existingSlotName = slotSnap.exists()
      ? String(slotSnap.data()?.slotName || '')
      : undefined;
    const resolvedName =
      options?.slotName ||
      (existingSlotName && slotSnap.data()?.cityId === state.startingCity.id
        ? existingSlotName
        : undefined);

    const dehydrated = dehydrateGameStateForCloud(slotId, state, {
      slotName: resolvedName,
      clientSavedAt: options?.clientSavedAt,
    });

    const batch = writeBatch(db);

    if (slotSnap.exists()) {
      batch.update(slotRef, {
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
      });
    } else {
      batch.set(slotRef, {
        ...dehydrated.metaFields,
        ownerUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (coreSnap && coreSnap.exists()) {
      batch.update(coreRef, {
        ...dehydrated.coreFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(coreRef, {
        ...dehydrated.coreFields,
        ownerUid: uid,
        slotId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const existingChunkIds = new Set<string>();
    if (existingChunksSnap) {
      existingChunksSnap.forEach((d) => existingChunkIds.add(d.id));
    }

    const nextChunkIds = new Set<string>();
    for (const chunk of dehydrated.graphChunks) {
      const chunkId = `graph_${chunk.chunkIndex}`;
      nextChunkIds.add(chunkId);
      const chunkRef = doc(db, 'users', uid, 'slots', slotId, 'chunks', chunkId);
      if (existingChunkIds.has(chunkId)) {
        batch.update(chunkRef, {
          nodeIds: chunk.nodeIds,
          edgeIds: chunk.edgeIds,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(chunkRef, {
          ownerUid: uid,
          slotId,
          chunkIndex: chunk.chunkIndex,
          nodeIds: chunk.nodeIds,
          edgeIds: chunk.edgeIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const oldChunkId of existingChunkIds) {
      if (!nextChunkIds.has(oldChunkId)) {
        batch.delete(doc(db, 'users', uid, 'slots', slotId, 'chunks', oldChunkId));
      }
    }

    await batch.commit();

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
      return null;
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

    return {
      summary,
      baseState,
      marks,
      chunkCoordCenters,
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
    const chunksSnap = await getDocs(query(chunksCol, where('ownerUid', '==', uid))).catch(
      () => null
    );
    const batch = writeBatch(db);
    if (chunksSnap) {
      chunksSnap.forEach((c) => batch.delete(c.ref));
    }
    batch.delete(coreRef);
    batch.delete(slotRef);
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, slotPath);
  }
}
