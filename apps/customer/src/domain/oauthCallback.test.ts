import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_OAUTH_DESTINATION,
  resolveOAuthCallback,
  resolveOAuthDestination,
} from './oauthCallback.ts';

describe('resolveOAuthCallback', () => {
  it('exchanges when a code came back', () => {
    assert.deepEqual(resolveOAuthCallback({ code: 'abc123' }), { kind: 'exchange', code: 'abc123' });
  });

  it('takes the first value when a param arrives repeated', () => {
    // expo-router hands back `string | string[]`; a repeated query param is
    // the shape that produces the array.
    assert.deepEqual(resolveOAuthCallback({ code: ['abc123', 'later'] }), {
      kind: 'exchange',
      code: 'abc123',
    });
  });

  it('reports the provider refusal INSTEAD of attempting an exchange', () => {
    // Supabase can return both. Trying the code first would replace "you
    // pressed Cancel" with a generic exchange failure -- strictly less useful
    // to the person reading it and to whoever they report it to.
    const outcome = resolveOAuthCallback({
      code: 'stale',
      error: 'access_denied',
      error_description: 'The user denied the request',
    });

    assert.equal(outcome.kind, 'declined');
    assert.match(outcome.kind === 'declined' ? outcome.message : '', /denied/i);
  });

  it('names a plain access_denied as a cancellation', () => {
    const outcome = resolveOAuthCallback({ error: 'access_denied' });

    assert.equal(outcome.kind, 'declined');
    assert.match(outcome.kind === 'declined' ? outcome.message : '', /cancelled/i);
  });

  it('carries an unrecognised provider code through so it can be reported', () => {
    // "Sign-in failed" with no code is unactionable for an operator; the two
    // causes needing completely different fixes look identical without it.
    const outcome = resolveOAuthCallback({ error_code: 'server_error' });

    assert.equal(outcome.kind, 'declined');
    assert.match(outcome.kind === 'declined' ? outcome.message : '', /server_error/);
  });

  it('flattens and caps a long or multi-line provider message', () => {
    const outcome = resolveOAuthCallback({
      error: 'invalid_request',
      error_description: `line one\nline two ${'x'.repeat(400)}`,
    });

    const message = outcome.kind === 'declined' ? outcome.message : '';
    assert.ok(message.length <= 180, `message was ${message.length} chars`);
    assert.ok(!message.includes('\n'), 'newlines must not survive into the layout');
  });

  it('reports an empty return rather than spinning', () => {
    // Opening /auth/callback directly, or a return stripped in transit. No
    // session is coming, so the screen has to say so.
    assert.deepEqual(resolveOAuthCallback({}), { kind: 'empty' });
    assert.deepEqual(resolveOAuthCallback({ code: '   ' }), { kind: 'empty' });
    assert.deepEqual(resolveOAuthCallback({ code: null, error: null }), { kind: 'empty' });
  });
});

describe('resolveOAuthDestination', () => {
  it('honours an ordinary in-app path', () => {
    assert.equal(resolveOAuthDestination('/cart'), '/cart');
    assert.equal(resolveOAuthDestination('/orders/abc?tab=live'), '/orders/abc?tab=live');
  });

  it('falls back to home when there is nothing to honour', () => {
    for (const empty of [undefined, null, '', '   ', []]) {
      assert.equal(resolveOAuthDestination(empty as never), DEFAULT_OAUTH_DESTINATION);
    }
  });

  it('REFUSES an off-site destination — this param is attacker-composable', () => {
    // The open-redirect set. `//evil.com` is the one a bare startsWith('/')
    // check lets through: browsers read it as protocol-relative and send the
    // freshly signed-in visitor to another host.
    for (const hostile of [
      '//evil.com',
      '///evil.com',
      'https://evil.com',
      'http://evil.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/\\evil.com',
      '\\\\evil.com',
      '/path\\..\\evil',
      'evil.com',
    ]) {
      assert.equal(resolveOAuthDestination(hostile), DEFAULT_OAUTH_DESTINATION, `must refuse ${hostile}`);
    }
  });

  it('refuses to land back on an auth screen', () => {
    // Finishing a sign-in on /login is a loop, not a destination.
    for (const loop of ['/login', '/register', '/verify-email', '/reset-password', '/auth/callback']) {
      assert.equal(resolveOAuthDestination(loop), DEFAULT_OAUTH_DESTINATION, `must refuse ${loop}`);
    }
  });

  it('checks the path, not the query string, when deciding it is an auth screen', () => {
    assert.equal(resolveOAuthDestination('/login?next=/cart'), DEFAULT_OAUTH_DESTINATION);
    // ...and does not reject a legitimate path that merely mentions one.
    assert.equal(resolveOAuthDestination('/support?topic=login'), '/support?topic=login');
  });
});
