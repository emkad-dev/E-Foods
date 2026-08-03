/// <reference path="../_shared/edge-runtime.d.ts" />

// feasty-admin — the platform-admin RPC endpoint (ADMIN_ACTIONS in
// _shared/rpc/actions.ts: approval queue, application review, dashboard and
// access overviews, support inbox, broadcast and promo management, plus
// bootstrapFirstAdmin). One of five domain-scoped functions that split
// app-rpc's single 59-action dispatcher apart; see app-rpc/index.ts for why
// app-rpc itself still exists alongside these.
//
// This function registers only the admin domain — including its one
// pre-auth action, bootstrapFirstAdmin (see _shared/rpc/actions.ts's
// ANONYMOUS_ACTIONS and _shared/rpc/context.ts's bootstrap context). An
// action belonging to any other domain is not registered here, so it falls
// through to the same 501 "not implemented" response app-rpc gives for an
// unknown action — that is intentional, not a bug: clients are taught which
// function owns which action in a later task, not this one.

import { adminDomain } from '../_shared/domains/admin.ts';
import { buildDispatcher } from '../_shared/rpc/registry.ts';
import { serveRpcFunction } from '../_shared/rpc/serve.ts';

serveRpcFunction('feasty-admin', buildDispatcher([adminDomain]));
