#!/usr/bin/env node
// Generates packages/domain/src/rpcRoutes.ts from the single source of truth
// for the action -> domain mapping, supabase/functions/_shared/rpc/actions.ts.
//
// Run via `npm run generate:rpc-routes` after changing the action lists in
// actions.ts. packages/domain/src/rpcRoutes.test.ts independently re-parses
// actions.ts and fails `npm run test:node` if the committed rpcRoutes.ts has
// drifted from what this script would produce, so a forgotten regeneration
// (or a hand edit) is caught by the test suite rather than discovered at a
// misrouted runtime call.
//
// Deliberately plain JS: it only needs to run under `node`, no bundler or
// type stripping required.

import fs from 'node:fs';

import { ACTIONS_SOURCE_PATH, RPC_ROUTES_OUTPUT_PATH, buildRpcRoutes, renderRpcRoutesModule } from './rpc-routes-lib.mjs';

// Optional output-path override (argv[2]), used only by
// packages/domain/src/rpcRoutes.test.ts's idempotency check so it can run
// this exact CLI twice against a scratch file without ever writing to the
// tracked packages/domain/src/rpcRoutes.ts. `npm run generate:rpc-routes`
// passes no argument and always writes the real committed path.
const outputPath = process.argv[2] ?? RPC_ROUTES_OUTPUT_PATH;

const actionsSource = fs.readFileSync(ACTIONS_SOURCE_PATH, 'utf8');
const { rpcRoutes } = buildRpcRoutes(actionsSource);
const output = renderRpcRoutesModule({ rpcRoutes });

fs.writeFileSync(outputPath, output, 'utf8');

console.log(`generate-rpc-routes: wrote ${Object.keys(rpcRoutes).length} action route(s) to ${outputPath}`);
