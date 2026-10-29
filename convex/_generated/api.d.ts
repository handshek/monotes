/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agentApi from "../agentApi.js";
import type * as agentHttp from "../agentHttp.js";
import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as collab from "../collab.js";
import type * as http from "../http.js";
import type * as lib_agentAuth from "../lib/agentAuth.js";
import type * as lib_boundedBody from "../lib/boundedBody.js";
import type * as lib_collabCore from "../lib/collabCore.js";
import type * as lib_history from "../lib/history.js";
import type * as notes from "../notes.js";
import type * as pairing from "../pairing.js";
import type * as user from "../user.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  agentApi: typeof agentApi;
  agentHttp: typeof agentHttp;
  agents: typeof agents;
  auth: typeof auth;
  collab: typeof collab;
  http: typeof http;
  "lib/agentAuth": typeof lib_agentAuth;
  "lib/boundedBody": typeof lib_boundedBody;
  "lib/collabCore": typeof lib_collabCore;
  "lib/history": typeof lib_history;
  notes: typeof notes;
  pairing: typeof pairing;
  user: typeof user;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
