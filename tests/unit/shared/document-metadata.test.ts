import { describe, expect, it } from "vitest";
import {
  createDocumentMetadata,
  forwardMistIdentityHeaders,
  getOwnerFromHeaders,
  hasOwnerIdentity,
  isExpired,
  normalizeRetention,
  ownerMatchesIdentity,
} from "~/shared/document-metadata";

describe("document metadata helpers", () => {
  it("returns null owner fields when identity headers are missing", () => {
    expect(getOwnerFromHeaders(new Headers())).toEqual({
      id: null,
      login: null,
      name: null,
    });
  });

  it("extracts owner identity from normalized gateway headers", () => {
    const headers = new Headers({
      "x-mist-user-id": "u-123",
      "x-mist-user-login": "sean@example.com",
      "x-mist-user-name": "Sean",
    });

    expect(getOwnerFromHeaders(headers)).toEqual({
      id: "u-123",
      login: "sean@example.com",
      name: "Sean",
    });
  });

  it("trims empty identity header values to null", () => {
    const headers = new Headers({
      "x-mist-user-id": " ",
      "x-mist-user-login": "\t",
      "x-mist-user-name": "  Sean  ",
    });

    expect(getOwnerFromHeaders(headers)).toEqual({
      id: null,
      login: null,
      name: "Sean",
    });
  });

  it("defaults missing retention input to persistent", () => {
    expect(normalizeRetention(undefined, 1_000)).toEqual({ mode: "persistent" });
  });

  it("accepts explicit persistent retention", () => {
    expect(normalizeRetention({ mode: "persistent" }, 1_000)).toEqual({
      mode: "persistent",
    });
  });

  it("normalizes ttl retention from expiresAt", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: 5_000 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 5_000,
    });
  });

  it("normalizes ttl retention from ttlMs", () => {
    expect(normalizeRetention({ mode: "ttl", ttlMs: 4_000 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 5_000,
    });
  });

  it("accepts ttl retention that is already expired", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: 500 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 500,
    });
  });

  it("falls back to persistent for invalid ttl input", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: Number.NaN }, 1_000)).toEqual({
      mode: "persistent",
    });
    expect(normalizeRetention({ mode: "ttl", ttlMs: 0 }, 1_000)).toEqual({
      mode: "persistent",
    });
  });

  it("creates document metadata from id, owner, and retention", () => {
    const metadata = createDocumentMetadata({
      id: "abcd1234",
      now: 10_000,
      owner: { id: "u-1", login: "s@example.com", name: "Sean" },
      retention: { mode: "persistent" },
    });

    expect(metadata).toEqual({
      id: "abcd1234",
      createdAt: 10_000,
      updatedAt: 10_000,
      owner: { id: "u-1", login: "s@example.com", name: "Sean" },
      retention: { mode: "persistent" },
    });
  });

  it("only reports ttl documents as expired", () => {
    expect(isExpired({ mode: "persistent" }, 10_000)).toBe(false);
    expect(isExpired({ mode: "ttl", expiresAt: 9_999 }, 10_000)).toBe(true);
    expect(isExpired({ mode: "ttl", expiresAt: 10_001 }, 10_000)).toBe(false);
  });

  it("forwards only normalized mist identity headers", () => {
    const source = new Headers({
      "x-mist-user-id": "u-123",
      "x-mist-user-login": "sean@example.com",
      "x-mist-user-name": "Sean",
      "x-mist-admin": "spoof",
      authorization: "secret",
    });
    const target = new Headers({ "content-type": "application/json" });

    forwardMistIdentityHeaders(target, source);

    expect(target.get("content-type")).toBe("application/json");
    expect(target.get("x-mist-user-id")).toBe("u-123");
    expect(target.get("x-mist-user-login")).toBe("sean@example.com");
    expect(target.get("x-mist-user-name")).toBe("Sean");
    expect(target.get("x-mist-admin")).toBeNull();
    expect(target.get("authorization")).toBeNull();
  });

  it("reports whether an owner has any identity value", () => {
    expect(hasOwnerIdentity({ id: null, login: null, name: null })).toBe(false);
    expect(hasOwnerIdentity({ id: null, login: "sean@example.com", name: null }))
      .toBe(true);
  });

  it("matches owners by stable identity before display name", () => {
    const owner = {
      id: "u-123",
      login: "sean@example.com",
      name: "Sean",
    };

    expect(ownerMatchesIdentity(owner, {
      id: null,
      login: "sean@example.com",
      name: null,
    })).toBe(true);
    expect(ownerMatchesIdentity(owner, {
      id: null,
      login: null,
      name: "Sean",
    })).toBe(false);
  });

  it("falls back to display name only for name-only owners", () => {
    expect(ownerMatchesIdentity(
      { id: null, login: null, name: "Sean" },
      { id: null, login: null, name: "Sean" },
    )).toBe(true);
  });
});
