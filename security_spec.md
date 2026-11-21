# Road Incremental Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Owner Isolation (PII & Game Saves)**: A document under `/users/{userId}` (including `slots/{slotId}`, `core/{docId}`, and `chunks/{chunkId}`) can ONLY be read, listed, created, updated, or deleted by `request.auth.uid == userId` with a verified email (`request.auth.token.email_verified == true`).
2. **Bounded Slot Identifiers**: Save slot documents MUST have `slotId` matching `^slot_[1-5]$` and `slotIndex` between `1` and `5`.
3. **Immutable Ownership & Creation Timestamps**: `uid` / `ownerUid` and `createdAt` cannot be modified after creation. All `createdAt` (on create) and `updatedAt` (on create & update) MUST equal `request.time`.
4. **Master Gate Relational Sync**: `core/{docId}` (`docId == 'state'`) and `chunks/{chunkId}` (`^graph_[0-9]{1,3}$`) cannot exist without a valid parent `slots/{slotId}` owned by `request.auth.uid` (verified via `getAfter`).
5. **Volumetric & Schema Guarding**: No shadow/ghost keys allowed (`keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update). All strings enforce `.size()` limits, and all arrays enforce bounded `.size()` limits plus first-element type validation.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write** to `/users/uid1/slots/slot_1` (`auth == null`).
2. **Unverified email write** (`auth.token.email_verified == false`) to `/users/uid1`.
3. **Cross-user PII read** (`auth.uid == 'uid2'` reading `/users/uid1`).
4. **Cross-user slot list/write** (`auth.uid == 'uid2'` listing `/users/uid1/slots`).
5. **Identity spoofing on create**: Writing `ownerUid: 'other_user'` inside `/users/uid1/slots/slot_1`.
6. **Slot boundary overflow**: Creating `/users/uid1/slots/slot_6` (`slotIndex: 6`) outside `slot_1..slot_5`.
7. **Shadow/ghost field injection**: Including `{ isAdmin: true }` on `/users/uid1` or `/users/uid1/slots/slot_1`.
8. **Immutable field mutation**: Updating `createdAt` or `ownerUid` on an existing `SaveSlotMeta`.
9. **Client timestamp forgery**: Sending `updatedAt: new Date(0)` instead of `serverTimestamp()` (`request.time`).
10. **Oversized ID / string poisoning**: `slotName` with 500 characters (`> 60`) or invalid document ID `slot_1$bad`.
11. **Unbounded array resource exhaustion**: Writing `nodeIds` with 2,500 items (`> 2000`) or invalid first element type `[123]` in `SaveSlotGraphChunk`.
12. **Orphaned child write**: Creating `/users/uid1/slots/slot_2/core/state` when `/users/uid1/slots/slot_2` does not exist and is not created in the same atomic batch.
