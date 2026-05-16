export interface GatewayConfig {
  upstreamOrigin: URL;
  host: string;
  port: number;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

function readOptional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const raw = readOptional(env, "MIST_GATEWAY_PORT");
  if (!raw) return 8788;

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MIST_GATEWAY_PORT must be an integer from 1 to 65535");
  }

  return port;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const upstream = readOptional(env, "MIST_UPSTREAM_ORIGIN");
  if (!upstream) {
    throw new Error("MIST_UPSTREAM_ORIGIN is required");
  }

  const upstreamOrigin = new URL(upstream);
  if (upstreamOrigin.protocol !== "http:" && upstreamOrigin.protocol !== "https:") {
    throw new Error("MIST_UPSTREAM_ORIGIN must use http: or https:");
  }

  return {
    upstreamOrigin,
    host: readOptional(env, "MIST_GATEWAY_HOST") ?? "127.0.0.1",
    port: readPort(env),
    cfAccessClientId: readOptional(env, "CF_ACCESS_CLIENT_ID"),
    cfAccessClientSecret: readOptional(env, "CF_ACCESS_CLIENT_SECRET"),
  };
}
