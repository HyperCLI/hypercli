import axios from "axios";
import type { AxiosInstance } from "axios";
import { createWalletClient, custom, type WalletClient } from "viem";
import { base } from "viem/chains";
import { wrapAxiosWithPayment, x402Client } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm";
import { CLAW_API_BASE } from "./api";

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

interface WalletState {
  client: WalletClient;
  address: string;
}

let walletState: WalletState | null = null;

function getProvider(): EthereumProvider {
  const win = window as Window & { ethereum?: EthereumProvider };
  if (!win.ethereum) {
    throw new Error("Please install MetaMask or another Ethereum wallet");
  }
  return win.ethereum;
}

export async function connectWallet(): Promise<WalletState> {
  if (walletState) return walletState;

  const provider = getProvider();

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  if (!accounts?.length) throw new Error("No accounts found");

  // Switch to Base if needed
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId !== "0x2105") {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
    } catch (err: any) {
      if (err.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x2105",
              chainName: "Base",
              nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }

  const client = createWalletClient({
    account: accounts[0] as `0x${string}`,
    chain: base,
    transport: custom(provider),
  });

  walletState = { client, address: accounts[0] };
  return walletState;
}

export function getWalletState(): WalletState | null {
  return walletState;
}

// ---------------------------------------------------------------------------
// x402 payment client
// ---------------------------------------------------------------------------

let paymentApi: AxiosInstance | null = null;

function buildPaymentApi(wallet: WalletClient): AxiosInstance {
  // WalletClient satisfies ClientEvmSigner (address + signTypedData)
  const signer = {
    address: wallet.account!.address,
    signTypedData: (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      wallet.signTypedData({
        account: wallet.account!,
        domain: params.domain as any,
        types: params.types as any,
        primaryType: params.primaryType,
        message: params.message as any,
      }),
  };

  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));

  const instance = axios.create({
    baseURL: CLAW_API_BASE,
    headers: { "Content-Type": "application/json" },
  });

  return wrapAxiosWithPayment(instance, client);
}

export async function x402Subscribe(
  planId: string,
  token: string
): Promise<{ ok: boolean; plan_id: string; expires_at: string }> {
  // Ensure wallet is connected
  const wallet = await connectWallet();

  // Build payment API if needed
  if (!paymentApi) {
    paymentApi = buildPaymentApi(wallet.client);
  }

  const res = await paymentApi.post(
    `/x402/${planId}`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}
