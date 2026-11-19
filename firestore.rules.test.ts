import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const rulesText = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const blueprint = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-blueprint.json'), 'utf8'));

test('firestore.rules enforces Eight Pillars baseline and blueprint parity', () => {
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('match /{document=**} {\n      allow read, write: if false;\n    }'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
  assert.ok(rulesText.includes("slotId.matches('^slot_[1-5]$')"));
  assert.ok(rulesText.includes("chunkId.matches('^graph_[0-9]{1,2}$')"));
  assert.ok(rulesText.includes('incoming().createdAt == request.time'));
  assert.ok(rulesText.includes('incoming().updatedAt == request.time'));
  assert.ok(rulesText.includes('incoming().createdAt == existing().createdAt'));
  assert.ok(rulesText.includes('incoming().ownerUid == existing().ownerUid'));
  assert.ok(rulesText.includes('parentSlotExists(userId, slotId)'));

  // Every blueprint path has an explicit match block
  const expectedMatches = [
    'match /users/{userId}',
    'match /slots/{slotId}',
    'match /core/{docId}',
    'match /chunks/{chunkId}',
  ];
  for (const m of expectedMatches) {
    assert.ok(rulesText.includes(m), `Missing rules match block: ${m}`);
  }
  assert.equal(Object.keys(blueprint.firestore).length, 4);
});

test('Dirty Dozen payload guards are present in firestore.rules helpers', () => {
  // 1-4: Unauth, unverified, cross-user PII, cross-user list
  assert.ok(rulesText.includes('allow list: if false;'));
  assert.ok(rulesText.includes('isOwner(userId) && isVerifiedUser()'));
  assert.ok(rulesText.includes('existing().ownerUid == request.auth.uid'));

  // 5-7: Ownership spoofing, slot bounds, shadow fields
  assert.ok(rulesText.includes('data.ownerUid == request.auth.uid'));
  assert.ok(rulesText.includes('data.slotIndex is number && data.slotIndex >= 1 && data.slotIndex <= 5'));
  assert.ok(rulesText.includes('data.keys().hasOnly('));
  assert.ok(rulesText.includes('affectedKeys().hasOnly('));

  // 8-12: Immutable timestamps/owner, server time, string bounds, bounded lists, master gate
  assert.ok(rulesText.includes('data.slotName is string && data.slotName.size() >= 1 && data.slotName.size() <= 60'));
  assert.ok(rulesText.includes('isStringArrayBounded(data.nodeIds, 2000)'));
  assert.ok(rulesText.includes('isStringArrayBounded(data.edgeIds, 2000)'));
  assert.ok(rulesText.includes('existsAfter(/databases/$(database)/documents/users/$(userId)/slots/$(slotId))'));
});
