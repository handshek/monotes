import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { agentRequest } from "./agentHttp";

const http = httpRouter();

auth.addHttpRoutes(http);

for (const method of ["GET", "PATCH", "POST", "PUT", "DELETE"] as const) {
  http.route({ pathPrefix: "/agent/v1/", method, handler: agentRequest });
}

export default http;
