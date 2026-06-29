'use strict';

import { WidgetError, ERRORS } from './errors.js';
import { CHAINS } from './contracts.js';

// ── EIP-6963 multi-wallet discovery ───────────────────────────────────────────
//
// Modern wallets announce themselves by dispatching 'eip6963:announceProvider'
// instead of (or as well as) racing to set window.ethereum. Listening for that
// event lets us see every installed wallet — MetaMask, Coinbase Wallet, Rabby,
// etc. — rather than only whichever extension happened to win window.ethereum.
//
// We listen once at module load and keep listening for the lifetime of the
// page, since a slow-loading extension can announce itself after this module
// has already run. We also fire a single 'eip6963:requestProvider' so wallets
// that only announce in response to a request (rather than proactively on
// load) still get picked up.
//
// Spec: https://eips.ethereum.org/EIPS/eip-6963

const discovered  = new Map();  // uuid -> { uuid, name, icon, rdns, provider }
const subscribers = new Set();

// Returns every EIP-6963 wallet discovered so far, in announcement order.
// Each entry is { uuid, name, icon, rdns, provider }.
export function getDiscoveredProviders() {
  return Array.from(discovered.values());
}

// Subscribes to new wallet announcements (e.g. an extension that finishes
// loading after the widget has already rendered). Returns an unsubscribe fn.
export function onProvidersChanged(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function handleAnnouncement(event) {
  const { info, provider } = event.detail ?? {};
  if (!info?.uuid || !provider) return;

  discovered.set(info.uuid, {
    uuid: info.uuid,
    name: info.name,
    icon: info.icon,
    rdns: info.rdns,
    provider,
  });

  const list = getDiscoveredProviders();
  subscribers.forEach((cb) => cb(list));
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', handleAnnouncement);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

// ── Wallet detection ──────────────────────────────────────────────────────────

// Returns a single injected provider for callers that don't need multi-wallet
// selection: the first EIP-6963 wallet discovered, if any, otherwise whatever
// (if anything) has claimed window.ethereum. Wallets that predate EIP-6963
// only ever show up via this window.ethereum fallback.
export function detectInjectedProvider() {
  const [first] = getDiscoveredProviders();
  if (first) return first.provider;

  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

export function isWalletAvailable() {
  return getDiscoveredProviders().length > 0 || !!detectInjectedProvider();
}

// ── Connection ────────────────────────────────────────────────────────────────

// Requests wallet accounts and returns the first connected address.
export async function connectWallet(provider) {
  if (!provider) throw new WidgetError(ERRORS.WALLET_NOT_FOUND, 'No wallet detected. Install MetaMask or another EVM wallet.');

  let accounts;
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    if (err?.code === 4001) throw new WidgetError(ERRORS.WALLET_CONNECTION_REJECTED, 'Wallet connection rejected.');
    throw err;
  }

  if (!accounts?.length) throw new WidgetError(ERRORS.WALLET_CONNECTION_REJECTED, 'No accounts returned from wallet.');
  return accounts[0];
}

// ── Chain management ──────────────────────────────────────────────────────────

// Returns the currently active chain ID from the wallet (as a number).
export async function getCurrentChainId(provider) {
  const hex = await provider.request({ method: 'eth_chainId' });
  return parseInt(hex, 16);
}

// Ensures the wallet is on the expected chain. Requests a switch if not.
// Throws CHAIN_SWITCH_REJECTED if the user declines.
export async function ensureCorrectChain(provider, network) {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`Unknown network: ${network}`);

  const currentChainId = await getCurrentChainId(provider);
  if (currentChainId === chain.id) return; // already on the right chain

  const targetHex = `0x${chain.id.toString(16)}`;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetHex }],
    });
  } catch (switchErr) {
    // Error code 4902: chain not added to wallet yet — try adding it first
    if (switchErr?.code === 4902) {
      await addChainToWallet(provider, chain);
      return;
    }
    if (switchErr?.code === 4001) {
      throw new WidgetError(ERRORS.CHAIN_SWITCH_REJECTED, `Please switch your wallet to ${chain.name} to continue.`);
    }
    throw switchErr;
  }
}

// Adds a chain to the wallet (needed if the user has never added Base before).
async function addChainToWallet(provider, chain) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId:         `0x${chain.id.toString(16)}`,
      chainName:       chain.name,
      nativeCurrency:  chain.nativeCurrency,
      rpcUrls:         chain.rpcUrls.default.http,
      blockExplorerUrls: chain.blockExplorers?.default
        ? [chain.blockExplorers.default.url]
        : [],
    }],
  });
}

// Registers a one-time listener for chain changes while the widget is mounted.
// Returns a cleanup function to remove the listener.
export function onChainChanged(provider, callback) {
  const handler = () => callback();
  provider.on('chainChanged', handler);
  return () => provider.removeListener('chainChanged', handler);
}

// Registers a one-time listener for account changes.
export function onAccountsChanged(provider, callback) {
  const handler = (accounts) => callback(accounts[0] ?? null);
  provider.on('accountsChanged', handler);
  return () => provider.removeListener('accountsChanged', handler);
}
