import { createContext, type RouterContextProvider } from "react-router";

export interface CloudflareEnv {
  env: Env;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareEnv>();

export function getCloudflare(context: Readonly<RouterContextProvider>): CloudflareEnv {
  return context.get(cloudflareContext);
}
