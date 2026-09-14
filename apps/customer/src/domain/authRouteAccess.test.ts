/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/authRouteAccess.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPublicContentRoute, resolveAuthRouteRedirect } from './authRouteAccess.ts';

const onboardedCustomer = { emailVerified: true, hasPhoneNumber: true, role: 'customer' };

test('a signed-in customer can read the public content routes', () => {
  for (const currentPath of ['/privacy', '/terms']) {
    assert.equal(
      resolveAuthRouteRedirect({
        currentPath,
        policyAccepted: true,
        viewer: onboardedCustomer,
      }),
      null,
      `${currentPath} is public static content, not a sign-in screen`
    );
  }
});

test('a signed-in customer is still bounced off the sign-in screens', () => {
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/login',
      policyAccepted: true,
      viewer: onboardedCustomer,
    }),
    '/home'
  );
});

test('the onboarding gates still win everywhere except the content routes', () => {
  const unverified = { emailVerified: false, hasPhoneNumber: true, role: 'customer' };

  assert.equal(
    resolveAuthRouteRedirect({ currentPath: '/login', policyAccepted: true, viewer: unverified }),
    '/verify-email',
    'the email gate is not weakened by the content-route exemption'
  );
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/accept-policy',
      policyAccepted: true,
      viewer: unverified,
    }),
    '/verify-email',
    'an unverified user cannot sit on a later step of the funnel'
  );
  assert.equal(
    resolveAuthRouteRedirect({ currentPath: '/terms', policyAccepted: true, viewer: unverified }),
    null,
    'an unverified user may still read the Terms -- the only exemption'
  );
});

test('a customer with no phone number is sent to complete-profile', () => {
  const noPhone = { emailVerified: true, hasPhoneNumber: false, role: 'customer' };

  assert.equal(
    resolveAuthRouteRedirect({ currentPath: '/login', policyAccepted: true, viewer: noPhone }),
    '/complete-profile'
  );
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/complete-profile',
      policyAccepted: true,
      viewer: noPhone,
    }),
    null,
    'already on the target: render rather than redirect to self'
  );
  assert.equal(
    resolveAuthRouteRedirect({ currentPath: '/login', policyAccepted: true, viewer: { ...noPhone, role: 'partner' } }),
    '/home',
    'the phone gate is a customer rule only'
  );
});

test('the policy gate does not trap the links on its own screen', () => {
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/accept-policy',
      policyAccepted: false,
      viewer: onboardedCustomer,
    }),
    null
  );
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/terms',
      policyAccepted: false,
      viewer: onboardedCustomer,
    }),
    null,
    'the "Open full Terms page" link on /accept-policy used to bounce straight back'
  );
  assert.equal(
    resolveAuthRouteRedirect({ currentPath: '/login', policyAccepted: false, viewer: onboardedCustomer }),
    '/accept-policy'
  );
});

test('a normalised redirectTo is honoured only after every gate is satisfied', () => {
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/login',
      policyAccepted: true,
      redirectTo: '/cart',
      viewer: onboardedCustomer,
    }),
    '/cart'
  );
  assert.equal(
    resolveAuthRouteRedirect({
      currentPath: '/login',
      policyAccepted: false,
      redirectTo: '/cart',
      viewer: onboardedCustomer,
    }),
    '/accept-policy',
    'a pending gate outranks the requested destination'
  );
});

test('a signed-out visitor is never redirected by this guard', () => {
  for (const currentPath of ['/login', '/register', '/terms', '/privacy', '/accept-policy']) {
    assert.equal(
      resolveAuthRouteRedirect({ currentPath, policyAccepted: false, viewer: null }),
      null,
      `${currentPath} renders for a signed-out visitor exactly as before`
    );
  }
});

test('only the two content paths are public', () => {
  assert.equal(isPublicContentRoute('/terms'), true);
  assert.equal(isPublicContentRoute('/privacy'), true);
  assert.equal(isPublicContentRoute('/terms-of-service'), false, 'exact match, not a prefix');
  assert.equal(isPublicContentRoute('/home'), false);
  assert.equal(isPublicContentRoute(null), false);
  assert.equal(isPublicContentRoute(undefined), false);
});
