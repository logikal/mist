import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";

export { default as DocumentAgent } from "../agents/document";
export { default as DocumentIndexAgent } from "../agents/document-index";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    // routeAgentRequest will route to available agents using the
    // /agents/:agent/:name pattern, otherwise hand off to react-router
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Create context provider with cloudflare bindings for middleware mode
    const contextProvider = new RouterContextProvider();
    contextProvider.set(cloudflareContext, { env, ctx });

    return requestHandler(request, contextProvider);
  },
} satisfies ExportedHandler<Env>;
