/**
 * Shared injected-wallet plumbing for plan checkout: the browser's EIP-1193
 * provider and the Base chain guard. Both checkout surfaces (modal and
 * embedded) must behave identically when the wallet is on the wrong chain.
 */

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Base mainnet chain id in the hex form the wallet RPC uses. */
const BASE_CHAIN_ID_HEX = "0x2105";

export function getInjectedWalletProvider(): EthereumProvider {
  const win = window as Window & { ethereum?: EthereumProvider };
  if (!win.ethereum) {
    throw new Error("Please install MetaMask or another Ethereum wallet");
  }
  return win.ethereum;
}

/**
 * Switch the wallet to Base, adding the chain when the wallet doesn't know it
 * (4902). Any other switch error means the user declined; it propagates.
 */
export async function ensureBaseChain(provider: EthereumProvider): Promise<void> {
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId === BASE_CHAIN_ID_HEX) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if ((error as { code?: unknown })?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_CHAIN_ID_HEX,
          chainName: "Base",
          nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        },
      ],
    });
  }
}
