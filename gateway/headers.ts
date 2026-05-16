export interface AccessTokenConfig {
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

const STRIPPED_HEADER_PREFIXES = ["x-mist-", "tailscale-"];
const STRIPPED_HEADER_NAMES = new Set([
  "cf-access-client-id",
  "cf-access-client-secret",
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function cleanHeaderValue(value: string | null): string | null {
  const decoded = value ? decodeTailscaleHeaderValue(value) : "";
  const trimmed = decoded.trim();
  return trimmed ? trimmed : null;
}

export function decodeTailscaleHeaderValue(value: string): string {
  const match = value.match(/^=\?utf-8\?q\?(.+)\?=$/i);
  if (!match) {
    return value;
  }

  const bytes: number[] = [];
  const encoded = match[1].replaceAll("_", " ");
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "=" && /^[0-9a-f]{2}$/i.test(encoded.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function normalizeTailscaleIdentityHeaders(source: Headers): Headers {
  const target = new Headers();
  const login = cleanHeaderValue(source.get("tailscale-user-login"));
  const name = cleanHeaderValue(source.get("tailscale-user-name"));

  if (login) {
    target.set("x-mist-user-id", login);
    target.set("x-mist-user-login", login);
  }

  if (name) {
    target.set("x-mist-user-name", name);
  }

  return target;
}

function shouldStripHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    STRIPPED_HEADER_NAMES.has(lower) ||
    STRIPPED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function buildUpstreamHeaders(
  source: Headers,
  config: AccessTokenConfig,
): Headers {
  const target = new Headers();

  for (const [name, value] of source) {
    if (!shouldStripHeader(name)) {
      target.set(name, value);
    }
  }

  for (const [name, value] of normalizeTailscaleIdentityHeaders(source)) {
    target.set(name, value);
  }

  if (config.cfAccessClientId && config.cfAccessClientSecret) {
    target.set("CF-Access-Client-Id", config.cfAccessClientId);
    target.set("CF-Access-Client-Secret", config.cfAccessClientSecret);
  }

  return target;
}
