/// <reference path="../_shared/edge-runtime.d.ts" />

// app-rpc — DEPRECATED compatibility shim.
//
// This used to be the single POST endpoint every FEASTY client talked to. As
// of the parity backend split (task A2), its 59 actions now also live
// behind five domain-scoped functions (feasty-orders, feasty-dispatch,
// feasty-partner, feasty-admin, feasty-account — see supabase/functions/ and
// _shared/domains/*). app-rpc itself is kept, unchanged, routing all 59
// actions exactly as before: already-installed mobile builds hardcode this
// URL and cannot be updated by a deploy, so this stays live as their
// compatibility shim until the next mobile release lets clients move to the
// split functions (task A3). Remove this directory once that release ships
// and no client still calls it.
//
// The actual HTTP wiring (parse, backpressure, dispatch, respond, observe) is
// shared with the five split functions via _shared/rpc/serve.ts — this file
// only supplies app-rpc's identity (its own name, for observability and
// backpressure-key attribution) and its domain list (all five, since it must
// keep routing everything).

import { accountDomain } from '../_shared/domains/account.ts';
import { adminDomain } from '../_shared/domains/admin.ts';
import { dispatchDomain } from '../_shared/domains/dispatch.ts';
import { ordersDomain } from '../_shared/domains/orders.ts';
import { partnerDomain } from '../_shared/domains/partner.ts';
import { buildDispatcher } from '../_shared/rpc/registry.ts';
import { serveRpcFunction } from '../_shared/rpc/serve.ts';

const dispatcher = buildDispatcher([
  ordersDomain,
  dispatchDomain,
  partnerDomain,
  adminDomain,
  accountDomain,
]);

serveRpcFunction('app-rpc', dispatcher);
