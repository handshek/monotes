/*
 * TEST-ONLY overlay. scripts/collab-e2e.sh copies this over convex/auth.ts
 * inside a temporary copy of the app that runs against an isolated local
 * Convex backend. It adds password sign-in so browser tests can get a real
 * session. It is never used by the application source or any deployment.
 */
import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Password],
});
