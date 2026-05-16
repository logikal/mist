export const MIST_PUBLIC_ORIGIN_HEADER = "x-mist-public-origin";

function parseHttpOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicOrigin(request: Request): string {
  return (
    parseHttpOrigin(request.headers.get(MIST_PUBLIC_ORIGIN_HEADER)) ??
    new URL(request.url).origin
  );
}
