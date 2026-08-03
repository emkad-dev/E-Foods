/// <reference path="../_shared/edge-runtime.d.ts" />

// feasty-account — the account/identity RPC endpoint (ACCOUNT_ACTIONS in
// _shared/rpc/actions.ts: policy acceptance, staff provisioning, role
// assignment and revocation, access enable/disable, claims sync, account
// deletion, plus promoTrack). One of five domain-scoped functions that split
// app-rpc's single 59-action dispatcher apart; see app-rpc/index.ts for why
// app-rpc itself still exists alongside these.
//
// This function registers only the account domain — including its one
// pre-auth action, promoTrack (see _shared/rpc/actions.ts's
// ANONYMOUS_ACTIONS). An action belonging to any other domain is not
// registered here, so it falls through to the same 501 "not implemented"
// response app-rpc gives for an unknown action — that is intentional, not a
// bug: clients are taught which function owns which action in a later task,
// not this one.

import { accountDomain } from '../_shared/domains/account.ts';
import { buildDispatcher } from '../_shared/rpc/registry.ts';
import { serveRpcFunction } from '../_shared/rpc/serve.ts';

serveRpcFunction('feasty-account', buildDispatcher([accountDomain]));
