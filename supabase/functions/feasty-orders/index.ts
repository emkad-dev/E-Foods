/// <reference path="../_shared/edge-runtime.d.ts" />

// feasty-orders — the customer order-lifecycle RPC endpoint (ORDER_ACTIONS in
// _shared/rpc/actions.ts: browsing favourites, placing/paying/cancelling an
// order, the customer side of support). One of five domain-scoped functions
// that split app-rpc's single 59-action dispatcher apart; see app-rpc/index.ts
// for why app-rpc itself still exists alongside these.
//
// This function registers only the orders domain. An action belonging to any
// other domain is not registered here, so it falls through to the same 501
// "not implemented" response app-rpc gives for an unknown action — that is
// intentional, not a bug: clients are taught which function owns which action
// in a later task, not this one.

import { ordersDomain } from '../_shared/domains/orders.ts';
import { buildDispatcher } from '../_shared/rpc/registry.ts';
import { serveRpcFunction } from '../_shared/rpc/serve.ts';

serveRpcFunction('feasty-orders', buildDispatcher([ordersDomain]));
