import { mainnet, anvil, type Chain } from "viem/chains";
import { createTransport, fallback } from "viem";
import { createConfig, http, injected, type Transport } from "wagmi";
import { getChainRpcUrl, isLocalNode, RPC_FALLBACK_URLS, RPC_URL } from "../constants/config";
import { getResolvedRpcBaseUrl } from "../utils/rpc-runtime";

export { getChainRpcUrl };

export const supportedChains: readonly [Chain, ...Chain[]] = isLocalNode ? [mainnet, anvil] : [mainnet];

type ChainId = (typeof supportedChains)[number]["id"];
type TransportsMap = Record<ChainId, Transport>;

/** Bound every RPC transport so a stalled endpoint cannot hold a request open. */
const RPC_TRANSPORT_TIMEOUT_MS = 2_000;

/**
 * Returns the base URLs that should back a chain transport: the primary alone in
 * local-node mode (Anvil does not serve chain paths), otherwise the primary followed
 * by the configured public fallbacks with duplicates removed.
 */
export function getRpcTransportUrls(
  chain: Chain,
  {
    fallbackUrls = RPC_FALLBACK_URLS,
    localNode = isLocalNode,
    rpcUrl = RPC_URL,
  }: {
    fallbackUrls?: readonly string[];
    localNode?: boolean;
    rpcUrl?: string;
  } = {}
): string[] {
  const rpcUrls = localNode ? [rpcUrl] : [rpcUrl, ...fallbackUrls];
  return [...new Set(rpcUrls.map((currentRpcUrl) => getChainRpcUrl(currentRpcUrl, chain.id, localNode)))];
}

function createRpcTransport(rpcUrl: string): Transport {
  return http(rpcUrl, {
    batch: !isLocalNode,
    timeout: RPC_TRANSPORT_TIMEOUT_MS,
  });
}

/**
 * Resolves the selected RPC endpoint dynamically on each request rather than only
 * once when the transport factory or client is constructed. Wagmi memoizes the client
 * per chain, so deferring resolution to the request handler ensures that background
 * health checks updating the resolved RPC base URL take immediate effect.
 *
 * @param createTransport - Callback producing the array of transport factories for the chain.
 * @returns A viem Transport function with per-request dynamic resolution.
 */
export function dynamicRpcTransport(createTransportFactory: () => Transport[]): Transport {
  return (params) => {
    return createTransport({
      key: "dynamicRpc",
      name: "Dynamic RPC",
      async request(args) {
        const transports = createTransportFactory();
        const [primary, ...rest] = transports;
        if (!primary) throw new Error("No RPC transport URL is available");
        const activeTransport =
          rest.length === 0 ? primary(params) : fallback([primary, ...rest], { rank: false })(params);
        return activeTransport.request(args);
      },
      retryCount: 3,
      retryDelay: 150,
      timeout: RPC_TRANSPORT_TIMEOUT_MS,
      type: "dynamicRpc",
    });
  };
}

// Anvil doesn't support URLs like http://localhost:8545/31337
const transports = supportedChains.reduce<TransportsMap>((acc, chain) => {
  acc[chain.id] = dynamicRpcTransport(() =>
    getRpcTransportUrls(chain, { rpcUrl: getResolvedRpcBaseUrl() || RPC_URL }).map((rpcUrl) => createRpcTransport(rpcUrl))
  );
  return acc;
}, {} as TransportsMap);

export const wagmiConfig = createConfig({
  chains: supportedChains,
  transports,
  connectors: [injected()],
  batch: {
    multicall: false, // Disabled because rpc.ubq.fi already uses multicall
  },
});
