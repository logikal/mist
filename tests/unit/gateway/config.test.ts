import { describe, expect, it } from "vitest";
import { loadGatewayConfig } from "../../../gateway/config";

describe("gateway config", () => {
  it("defaults identity enforcement to off", () => {
    const config = loadGatewayConfig({
      MIST_UPSTREAM_ORIGIN: "https://mist.example.com",
    });

    expect(config.requireIdentity).toBe(false);
  });

  it("enables identity enforcement with MIST_REQUIRE_IDENTITY=true", () => {
    const config = loadGatewayConfig({
      MIST_UPSTREAM_ORIGIN: "https://mist.example.com",
      MIST_REQUIRE_IDENTITY: "true",
    });

    expect(config.requireIdentity).toBe(true);
  });
});
