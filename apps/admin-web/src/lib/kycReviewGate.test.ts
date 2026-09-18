/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/kycReviewGate.test.ts
 *
 * The two cases worth pinning are the ones a careless tightening would break:
 * an application with no documents must stay approvable (otherwise the console
 * has a partner it can never let in), and the reason string must never claim
 * the documents were read.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requiredKycDocuments, resolveKycGate } from './kycReviewGate.ts';

const BOTH = { backUrl: 'https://signed/back', frontUrl: 'https://signed/front' };

test('only documents with a link are required', () => {
  assert.deepEqual(requiredKycDocuments(BOTH), ['front', 'back']);
  assert.deepEqual(requiredKycDocuments({ backUrl: null, frontUrl: 'https://signed/front' }), ['front']);
  assert.deepEqual(requiredKycDocuments({ backUrl: null, frontUrl: null }), []);
  assert.deepEqual(requiredKycDocuments(undefined), []);
});

test('approve is blocked until every document that exists has been opened', () => {
  assert.match(resolveKycGate(BOTH, []).blockedReason ?? '', /front and back/);
  assert.match(resolveKycGate(BOTH, ['front']).blockedReason ?? '', /\(back\)/);
  assert.equal(resolveKycGate(BOTH, ['front', 'back']).blockedReason, undefined);
});

test('a one-sided application needs only the document it has', () => {
  const oneSided = { backUrl: null, frontUrl: 'https://signed/front' };
  assert.ok(resolveKycGate(oneSided, []).blockedReason);
  assert.equal(resolveKycGate(oneSided, ['front']).blockedReason, undefined);
});

test('an application with no documents stays approvable and says why', () => {
  const gate = resolveKycGate({ backUrl: null, frontUrl: null }, []);
  assert.equal(gate.blockedReason, undefined);
  assert.match(gate.note, /No KYC documents/);
});

test('no message claims the documents were read or verified', () => {
  const messages = [
    resolveKycGate(BOTH, []),
    resolveKycGate(BOTH, ['front']),
    resolveKycGate(BOTH, ['front', 'back']),
    resolveKycGate(null, []),
  ].flatMap((gate) => [gate.blockedReason ?? '', gate.note]);

  for (const message of messages) {
    assert.doesNotMatch(
      message,
      /\b(read|reviewed|verified|checked)\b/i,
      `"${message}" claims more than a click can prove; this gate only knows a link was opened`
    );
  }
});
