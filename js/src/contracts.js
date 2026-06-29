'use strict';

import {
  createPublicClient,
  createWalletClient,
  custom,
  parseUnits,
  encodeFunctionData,
  http,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { WidgetError, ERRORS } from './errors.js';

// ── Chain config ─────────────────────────────────────────────────────────────

export const CHAINS = {
  'base-mainnet': base,
  'base-sepolia': baseSepolia,
};

// Decimal places for known payment currencies on Base.
// If a currency isn't listed here, we fall back to calling decimals() on-chain.
const KNOWN_DECIMALS = {
  USDC: 6,
  USDT: 6,
};

// ── ABIs ─────────────────────────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs:  [],
    outputs: [{ name: '', type: 'uint8' }],
  },
];

// Minimal swap contract ABI — update if the contract exposes additional
// functions or emits additional events.
export const SWAP_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'customerRef', type: 'bytes32' }],
    outputs: [],
  },
];

// ── Client factories ──────────────────────────────────────────────────────────

export function makePublicClient(network) {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`Unknown network: ${network}`);
  return createPublicClient({ chain, transport: http() });
}

export function makeWalletClient(network, provider) {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`Unknown network: ${network}`);
  return createWalletClient({ chain, transport: custom(provider) });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the decimal count for a payment currency.
// Checks the known table first; falls back to an on-chain decimals() call.
export async function getDecimals(publicClient, tokenAddress, currency) {
  if (KNOWN_DECIMALS[currency] !== undefined) return KNOWN_DECIMALS[currency];

  return await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
}

// Returns the wallet's balance of the payment currency in smallest units.
export async function getBalance(publicClient, tokenAddress, walletAddress) {
  return await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
}

// Returns the existing allowance the wallet has granted to the swap contract.
export async function getAllowance(publicClient, tokenAddress, ownerAddress, spenderAddress) {
  return await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  });
}

// Submits an ERC-20 approve() transaction and waits for it to confirm.
// Skips if the existing allowance is already sufficient.
export async function approveIfNeeded(
  publicClient, walletClient, tokenAddress, spenderAddress,
  humanAmount, decimals, walletAddress
) {
  const required = parseUnits(String(humanAmount), decimals);

  // Check balance first so we surface a clear error rather than a revert
  const balance = await getBalance(publicClient, tokenAddress, walletAddress);
  if (balance < required) {
    throw new WidgetError(
      ERRORS.INSUFFICIENT_BALANCE,
      `Wallet holds ${balance} but ${required} is required.`
    );
  }

  // Skip approval if already sufficient
  const existing = await getAllowance(publicClient, tokenAddress, walletAddress, spenderAddress);
  if (existing >= required) return null;

  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spenderAddress, required],
      account: walletAddress,
    });
  } catch (err) {
    if (isUserRejection(err)) throw new WidgetError(ERRORS.APPROVAL_REJECTED, 'Approval signature rejected.');
    throw new WidgetError(ERRORS.APPROVAL_FAILED, err.message, err);
  }

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// Submits the buy() call on the swap contract and waits for it to confirm.
export async function buyTokens(publicClient, walletClient, swapAddress, customerRef, walletAddress) {
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: swapAddress,
      abi: SWAP_ABI,
      functionName: 'buy',
      args: [customerRef],
      account: walletAddress,
    });
  } catch (err) {
    if (isUserRejection(err)) throw new WidgetError(ERRORS.CONFIRMATION_REJECTED, 'Purchase signature rejected.');
    if (isPriceChanged(err))  throw new WidgetError(ERRORS.PRICE_CHANGED, 'Token price changed before confirmation.');
    throw new WidgetError(ERRORS.TRANSACTION_REVERTED, err.message, err);
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === 'reverted') {
    throw new WidgetError(ERRORS.TRANSACTION_REVERTED, 'The purchase transaction reverted on-chain.');
  }

  return txHash;
}

// ── Error classifiers ─────────────────────────────────────────────────────────

function isUserRejection(err) {
  const msg = err?.message?.toLowerCase() ?? '';
  return (
    err?.code === 4001 ||
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('rejected')
  );
}

function isPriceChanged(err) {
  const msg = err?.message?.toLowerCase() ?? '';
  return msg.includes('price') || msg.includes('price_changed');
}
