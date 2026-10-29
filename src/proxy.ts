import {
  convexAuthNextjsMiddleware as convexAuthNextjsProxy,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
// Only protect settings/admin routes - allow anonymous access to notes
const isProtectedRoute = createRouteMatcher(["/admin"]);

export default convexAuthNextjsProxy(
  async (request, { convexAuth }) => {
    // Redirect authenticated users away from sign-in page
    if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/");
    }
    // Only protect settings/admin routes - allow anonymous users to access notes
    if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/signin");
    }
  },
  {
    cookieConfig: { maxAge: 60 * 60 * 24 * 30 },
  },
);

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  // The agent API under /api/agent authenticates with agent keys only, so it
  // is excluded and never receives or sets browser session cookies.
  matcher: ["/((?!.*\\..*|_next|api/agent/).*)", "/", "/api/((?!agent/).*)", "/trpc(.*)"],
};
