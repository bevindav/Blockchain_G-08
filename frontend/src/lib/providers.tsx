'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserProvider, Contract, JsonRpcSigner, toBeHex, type InterfaceAbi } from 'ethers';
import { api } from './api';
import { contracts, explainError, readProvider } from './chain';
import type { AppConfig } from './types';

declare global {
  interface Window { ethereum?: any; snap?: any }
}

// ------------------------------------------------------------------ config

const ConfigCtx = createContext<AppConfig | null>(null);
export const useConfig = () => {
  const c = useContext(ConfigCtx);
  if (!c) throw new Error('Config belum dimuat');
  return c;
};

// ------------------------------------------------------------------ wallet

export type Roles = { admin: boolean; ngo: boolean; verifier: boolean; oracle: boolean; approver: boolean; recipient: boolean };
const NO_ROLES: Roles = { admin: false, ngo: false, verifier: false, oracle: false, approver: false, recipient: false };

type WalletState = {
  account: string | null; chainId: number | null; correctChain: boolean; hasMetaMask: boolean; roles: Roles;
  connect: () => Promise<void>; switchNetwork: () => Promise<void>; getSigner: () => Promise<JsonRpcSigner>;
  refreshRoles: () => void; addTokenToWallet: () => Promise<void>;
};
const WalletCtx = createContext<WalletState | null>(null);
export const useWallet = () => useContext(WalletCtx)!;

function WalletProvider({ cfg, children }: { cfg: AppConfig; children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [roles, setRoles] = useState<Roles>(NO_ROLES);
  const [hasMetaMask, setHasMetaMask] = useState(false);
  const [rolesNonce, setRolesNonce] = useState(0);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    setHasMetaMask(true);
    eth.request({ method: 'eth_accounts' }).then((a: string[]) => setAccount(a[0] ?? null)).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((c: string) => setChainId(Number(c))).catch(() => {});
    const onAcc = (a: string[]) => setAccount(a[0] ?? null);
    const onChain = (c: string) => setChainId(Number(c));
    eth.on?.('accountsChanged', onAcc);
    eth.on?.('chainChanged', onChain);
    return () => { eth.removeListener?.('accountsChanged', onAcc); eth.removeListener?.('chainChanged', onChain); };
  }, []);

  // Role dibaca langsung dari smart contract (AccessControl) - bukan dari backend.
  useEffect(() => {
    if (!account) { setRoles(NO_ROLES); return; }
    const { factory, token } = contracts(cfg);
    (async () => {
      const [ngoRole, verRole, orRole, admRole] = await Promise.all([
        factory.NGO_ROLE(), factory.VERIFIER_ROLE(), factory.ORACLE_ROLE(), factory.DEFAULT_ADMIN_ROLE()]);
      const [ngo, verifier, oracle, admin, approvers, recipient, pauser] = await Promise.all([
        factory.hasRole(ngoRole, account), factory.hasRole(verRole, account), factory.hasRole(orRole, account),
        factory.hasRole(admRole, account), factory.getApprovers(), factory.isRecipient(account),
        token.hasRole(await token.PAUSER_ROLE(), account)]);
      setRoles({ ngo, verifier, oracle, admin: admin || pauser, recipient,
        approver: approvers.some((a: string) => a.toLowerCase() === account.toLowerCase()) });
    })().catch(() => setRoles(NO_ROLES));
  }, [account, cfg, rolesNonce]);

  const switchNetwork = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error('MetaMask tidak terpasang');
    const hex = toBeHex(cfg.chainId);
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    } catch (e: any) {
      if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: hex, chainName: 'DonasiChain (Besu QBFT)', rpcUrls: [cfg.rpcUrl],
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }] });
    }
  }, [cfg]);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) { window.open('https://metamask.io/download/', '_blank'); return; }
    const accs: string[] = await eth.request({ method: 'eth_requestAccounts' });
    setAccount(accs[0] ?? null);
    const c = Number(await eth.request({ method: 'eth_chainId' }));
    setChainId(c);
    if (c !== cfg.chainId) await switchNetwork();
    // Pastikan wallet baru punya saldo gas (private chain, faucet backend)
    if (accs[0]) api('/faucet', { method: 'POST', json: { address: accs[0] } }).catch(() => {});
  }, [cfg, switchNetwork]);

  const getSigner = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error('MetaMask tidak terpasang');
    if (Number(await eth.request({ method: 'eth_chainId' })) !== cfg.chainId) await switchNetwork();
    return new BrowserProvider(eth).getSigner();
  }, [cfg, switchNetwork]);

  const addTokenToWallet = useCallback(async () => {
    await window.ethereum?.request({ method: 'wallet_watchAsset', params: {
      type: 'ERC20', options: { address: cfg.contracts.token, symbol: 'dIDR', decimals: 0 } } });
  }, [cfg]);

  const value = useMemo<WalletState>(() => ({
    account, chainId, correctChain: chainId === cfg.chainId, hasMetaMask, roles, connect, switchNetwork, getSigner,
    refreshRoles: () => setRolesNonce(n => n + 1), addTokenToWallet,
  }), [account, chainId, cfg, hasMetaMask, roles, connect, switchNetwork, getSigner, addTokenToWallet]);
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

// ------------------------------------------------------------------ transactions

export type TxEntry = {
  id: number; label: string; status: 'signing' | 'pending' | 'success' | 'failed';
  hash?: string; block?: number; gasUsed?: string; error?: string; time: number;
};
type TxState = {
  txs: TxEntry[];
  send: (label: string, target: { address: string; abi: InterfaceAbi }, method: string, args: unknown[]) => Promise<boolean>;
  dismiss: (id: number) => void;
};
const TxCtx = createContext<TxState | null>(null);
export const useTx = () => useContext(TxCtx)!;

function TxProvider({ cfg, children }: { cfg: AppConfig; children: ReactNode }) {
  const { getSigner } = useWallet();
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const seq = useRef(0);
  const patch = (id: number, p: Partial<TxEntry>) => setTxs(list => list.map(t => (t.id === id ? { ...t, ...p } : t)));

  /**
   * Alur status transaksi: signing (MetaMask) -> pending (txHash) -> success (block) / failed (alasan).
   * Simulasi (eth_estimateGas) dilakukan dulu lewat RPC read-only sehingga revert langsung terlihat
   * dengan alasan yang jelas sebelum pengguna menandatangani.
   */
  const send = useCallback<TxState['send']>(async (label, target, method, args) => {
    const id = ++seq.current;
    setTxs(list => [{ id, label, status: 'signing', time: Date.now() } as TxEntry, ...list].slice(0, 20));
    try {
      const signer = await getSigner();
      const from = await signer.getAddress();
      const contract = new Contract(target.address, target.abi, signer);
      const data = contract.interface.encodeFunctionData(method, args);
      const gas = await readProvider(cfg).estimateGas({ from, to: target.address, data });
      const tx = await signer.sendTransaction({ to: target.address, data, gasLimit: (gas * 13n) / 10n + 30_000n });
      patch(id, { status: 'pending', hash: tx.hash });
      const rc = await readProvider(cfg).waitForTransaction(tx.hash, 1, 120_000);
      if (!rc || rc.status !== 1) throw new Error('Transaksi revert di blockchain');
      patch(id, { status: 'success', block: rc.blockNumber, gasUsed: rc.gasUsed.toString() });
      return true;
    } catch (e) {
      patch(id, { status: 'failed', error: explainError(e) });
      return false;
    }
  }, [cfg, getSigner]);

  const value = useMemo(() => ({ txs, send, dismiss: (id: number) => setTxs(l => l.filter(t => t.id !== id)) }), [txs, send]);
  return <TxCtx.Provider value={value}>{children}</TxCtx.Provider>;
}

// ------------------------------------------------------------------ root

export function Providers({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => api<AppConfig>('/config').then(c => !stop && setCfg(c)).catch(e => {
      if (stop) return;
      setError(e.message);
      setTimeout(load, 3000); // backend mungkin masih menunggu deploy kontrak
    });
    load();
    return () => { stop = true; };
  }, []);
  if (!cfg) return (
    <div className="flex min-h-screen items-center justify-center p-8 text-center text-slate-500">
      <div>
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
        Memuat konfigurasi blockchain…
        {error && <p className="mt-2 text-xs text-rose-500">Backend belum siap ({error}). Mencoba lagi…</p>}
      </div>
    </div>
  );
  return (
    <ConfigCtx.Provider value={cfg}>
      <WalletProvider cfg={cfg}><TxProvider cfg={cfg}>{children}</TxProvider></WalletProvider>
    </ConfigCtx.Provider>
  );
}
