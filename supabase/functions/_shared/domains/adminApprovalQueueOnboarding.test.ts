// adminGetApprovalQueue must hand each pending partner application its
// onboarding review block (KYC + payout summary + short-lived signed document
// URLs). The admin web's PartnerOnboardingReview renders it, but the server
// half was lost when app-rpc was split into domain functions, so admins saw a
// partner's basic details and none of the KYC or bank details they submitted.
//
// Calls the REAL handler out of adminDomain.handlers; see
// adminSetRestaurantPublished.test.ts for why env vars are set before a
// dynamic import and why this runs in the --no-check deno invocation.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { adminDomain } = await import('./admin.ts');
const { serviceClient } = await import('../client.ts');

const expect = (condition: boolean, label: string) => {
  if (!condition) {
    throw new Error(label);
  }
};

const handler = adminDomain.handlers.adminGetApprovalQueue;
if (typeof handler !== 'function') {
  throw new Error('adminDomain.handlers.adminGetApprovalQueue is not registered.');
}

const ADMIN_CONTEXT = {
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid',
  userProfile: { uid: 'admin-uid', email: 'admin@example.test', role: 'admin', accountDisabled: false },
};

const partnerApplication = (uid: string) => ({
  id: uid,
  uid,
  email: `${uid}@example.test`,
  contactName: 'Ada Obi',
  phoneNumber: '+2348000000000',
  restaurantName: 'Ada Kitchen',
  cuisine: 'Nigerian',
  address: '1 Allen Avenue, Ikeja',
  description: null,
  logoImage: null,
  latitude: 6.6,
  longitude: 3.35,
  deliveryTime: '30-45 min',
  status: 'pending',
  restaurantId: `rest-${uid}`,
  submittedAt: '2026-11-01T10:00:00.000Z',
  reviewedAt: null,
  approvedByUid: null,
  rejectionReason: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
});

type Tables = Record<string, unknown[]>;

/** Chainable stand-in for a PostgREST query that resolves to the table's rows. */
const queryFor = (rows: unknown[]) => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order']) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
};

const installMocks = (tables: Tables) => {
  const queried: string[] = [];
  const signed: string[] = [];
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    queried.push(table);
    return queryFor(tables[table] ?? []);
  };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).storage = {
    from: (bucket: string) => ({
      createSignedUrl: (path: string, ttl: number) => {
        signed.push(`${bucket}:${path}:${ttl}`);
        return Promise.resolve({ data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null });
      },
    }),
  };
  return { queried, signed };
};

const callQueue = async () => {
  // deno-lint-ignore no-explicit-any
  const response = (await (handler as any)({ context: ADMIN_CONTEXT, data: {}, request: new Request('https://x.test') })) as Response;
  const body = await response.json();
  return body.data as { partnerApplications: Array<Record<string, unknown>> };
};

Deno.test('pending partner applications carry their KYC, payout and signed document links', async () => {
  const mocks = installMocks({
    PartnerApplicationRecord: [partnerApplication('partner-1')],
    RestaurantKyc: [
      {
        uid: 'partner-1',
        legalName: 'Ada Obi Enterprises',
        ninLast4: '4321',
        ninFrontPath: 'partner-verification-documents/partner-1/front.jpg',
        ninBackPath: 'partner-verification-documents/partner-1/back.jpg',
        verification: 'manual',
        verifiedAt: null,
      },
    ],
    RestaurantPayout: [
      {
        uid: 'partner-1',
        bankName: 'GTBank',
        accountLast4: '6789',
        resolvedAccountName: 'ADA OBI ENTERPRISES',
        paystackSubaccountCode: null,
        status: 'resolved',
      },
    ],
  });

  const { partnerApplications } = await callQueue();
  const onboarding = partnerApplications[0].onboarding as Record<string, Record<string, unknown>>;

  expect(onboarding !== null && onboarding !== undefined, 'onboarding block is missing');
  expect(onboarding.kyc.legalName === 'Ada Obi Enterprises', 'kyc.legalName');
  expect(onboarding.kyc.documentLast4 === '4321', 'kyc.documentLast4');
  expect(onboarding.kyc.status === 'manual', 'kyc.status');
  expect(onboarding.payout.bankName === 'GTBank', 'payout.bankName');
  expect(onboarding.payout.accountLast4 === '6789', 'payout.accountLast4');
  expect(onboarding.payout.resolvedAccountName === 'ADA OBI ENTERPRISES', 'payout.resolvedAccountName');
  expect(onboarding.payout.status === 'resolved', 'payout.status');
  expect(
    onboarding.documents.frontUrl === 'https://signed.test/partner-verification-documents/partner-1/front.jpg',
    `documents.frontUrl was ${onboarding.documents.frontUrl}`
  );
  expect(
    onboarding.documents.backUrl === 'https://signed.test/partner-verification-documents/partner-1/back.jpg',
    'documents.backUrl'
  );
  // Signed URLs are short-lived and minted against the bucket-relative path.
  expect(
    mocks.signed.includes('partner-verification-documents:partner-1/front.jpg:300'),
    `signed calls were ${JSON.stringify(mocks.signed)}`
  );
});

Deno.test('a legacy application with no onboarding rows gets onboarding: null', async () => {
  installMocks({ PartnerApplicationRecord: [partnerApplication('legacy-1')] });

  const { partnerApplications } = await callQueue();

  expect(partnerApplications.length === 1, 'application still listed');
  expect(partnerApplications[0].onboarding === null, `onboarding was ${JSON.stringify(partnerApplications[0].onboarding)}`);
});

Deno.test('no pending partners means no KYC or payout reads', async () => {
  const mocks = installMocks({});

  await callQueue();

  expect(!mocks.queried.includes('RestaurantKyc'), 'RestaurantKyc should not be read');
  expect(!mocks.queried.includes('RestaurantPayout'), 'RestaurantPayout should not be read');
});
