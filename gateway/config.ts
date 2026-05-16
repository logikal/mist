export interface GatewayConfig {
  upstreamOrigin: URL;
  publicOrigin?: URL;
  host: string;
  port: number;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  requireIdentity?: boolean;
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

function readBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = readOptional(env, name);
  if (!raw) return false;

  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;

  throw new Error(`${name} must be true or false`);
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

  const rawPublicOrigin = readOptional(env, "MIST_PUBLIC_ORIGIN");
  const publicOrigin = rawPublicOrigin ? new URL(rawPublicOrigin) : undefined;
  if (
    publicOrigin &&
    publicOrigin.protocol !== "http:" &&
    publicOrigin.protocol !== "https:"
  ) {
    throw new Error("MIST_PUBLIC_ORIGIN must use http: or https:");
  }

  return {
    upstreamOrigin,
    publicOrigin,
    host: readOptional(env, "MIST_GATEWAY_HOST") ?? "127.0.0.1",
    port: readPort(env),
    cfAccessClientId: readOptional(env, "CF_ACCESS_CLIENT_ID"),
    cfAccessClientSecret: readOptional(env, "CF_ACCESS_CLIENT_SECRET"),
    requireIdentity: readBoolean(env, "MIST_REQUIRE_IDENTITY"),
  };
}
