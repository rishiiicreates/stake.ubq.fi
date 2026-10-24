import { describe, expect, it } from "bun:test";
import { createClient, custom } from "viem";
import { anvil, mainnet } from "viem/chains";

import { MAINNET_RPC_FALLBACK_URL, RPC_FALLBACK_URLS, RPC_URL } from "../src/constants/config";
import { dynamicRpcTransport, getChainRpcUrl, getRpcTransportUrls } from "../src/wallet/config";

describe("getChainRpcUrl", () => {
  it("appends the chain id to mainnet RPC endpoints", () => {
    expect(getChainRpcUrl("https://rpc.ubq.fi", 1, false)).toBe("https://rpc.ubq.fi/1");
    expect(getChainRpcUrl("https://rpc.ubq.fi/", 1, false)).toBe("https://rpc.ubq.fi/1");
  });

  it("keeps local-node RPC endpoints raw and unsuffixed", () => {
    expect(getChainRpcUrl("http://localhost:8545", 31337, true)).toBe("http://localhost:8545");
    expect(getChainRpcUrl("http://localhost:8545/", 31337, true)).toBe("http://localhost:8545");
  });

  it("keeps query strings after the chain path", () => {
    expect(getChainRpcUrl("https://rpc.example/rpc?key=abc", 1, false)).toBe("https://rpc.example/rpc/1?key=abc");
  });
});

describe("getRpcTransportUrls", () => {
  it("returns the primary and fallback URLs with the chain suffix", () => {
    expect(
      getRpcTransportUrls(mainnet, {
        fallbackUrls: ["https://fallback.example"],
        localNode: false,
        rpcUrl: "https://primary.example",
      })
    ).toEqual(["https://primary.example/1", "https://fallback.example/1"]);
  });

  it("deduplicates a fallback that matches the primary", () => {
    expect(
      getRpcTransportUrls(mainnet, {
        fallbackUrls: [MAINNET_RPC_FALLBACK_URL],
        localNode: false,
        rpcUrl: MAINNET_RPC_FALLBACK_URL,
      })
    ).toEqual([`${MAINNET_RPC_FALLBACK_URL}/1`]);
  });

  it("skips fallback endpoints for local-node transports", () => {
    expect(
      getRpcTransportUrls(anvil, {
        fallbackUrls: [MAINNET_RPC_FALLBACK_URL],
        localNode: true,
        rpcUrl: "http://localhost:8545",
      })
    ).toEqual(["http://localhost:8545"]);
  });

  it("defaults to the resolved config primary and fallbacks", () => {
    const urls = getRpcTransportUrls(mainnet);

    expect(urls[0]).toBe(`${RPC_URL}/1`);
    for (const fallbackUrl of RPC_FALLBACK_URLS) {
      expect(urls).toContain(`${fallbackUrl}/1`);
    }
  });
});

describe("dynamicRpcTransport", () => {
  it("passes unevaluated transport factories to viem fallback and exercises the fallback entry when primary fails", async () => {
    const calls: string[] = [];
    const primaryTransport = custom({
      async request() {
        calls.push("primary");
        throw new Error("primary RPC failed");
      },
    });
    const fallbackTransport = custom({
      async request() {
        calls.push("fallback");
        return "0x1";
      },
    });

    const client = createClient({
      chain: mainnet,
      transport: dynamicRpcTransport(() => [primaryTransport, fallbackTransport]),
    });

    const result = await client.request({ method: "eth_chainId" });
    expect(result).toBe("0x1");
    expect(calls).toEqual(["primary", "fallback"]);
  });

  it("returns primary transport result directly when no fallback exists", async () => {
    const calls: string[] = [];
    const primaryTransport = custom({
      async request() {
        calls.push("primary");
        return "0x1";
      },
    });

    const client = createClient({
      chain: mainnet,
      transport: dynamicRpcTransport(() => [primaryTransport]),
    });

    const result = await client.request({ method: "eth_chainId" });
    expect(result).toBe("0x1");
    expect(calls).toEqual(["primary"]);
  });
});
