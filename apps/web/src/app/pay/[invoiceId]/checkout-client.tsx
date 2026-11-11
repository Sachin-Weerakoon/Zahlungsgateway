'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CHAIN_NAMES, EXPLORER_URLS, InvoiceStatus as InvoiceStatuses } from '@cryptopay/shared';
import type { InvoiceStatus, PublicInvoice, SupportedChainId } from '@cryptopay/shared';
import { paymentProcessorAbi, testUsdcAbi } from '@cryptopay/shared/abi';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  type Hex,
  type Address,
  type Chain,
  type Hash,
} from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';

type InjectedProvider = Parameters<typeof custom>[0] & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const CHAINS: Partial<Record<number, Chain>> = {
  [baseSepolia.id]: baseSepolia,
  [sepolia.id]: sepolia,
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const VALID_STATUSES = new Set<string>(Object.values(InvoiceStatuses));

type InvoicePayload = { invoice?: PublicInvoice; error?: { message?: string } };

function chainFor(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported payment network (${chainId}).`);
  return chain;
}

function publicClientFor(chain: Chain) {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];
  if (!rpcUrl) throw new Error('No public RPC endpoint is configured for this network.');
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function invoiceParameters(invoice: PublicInvoice) {
  if (
    !isAddress(invoice.token.address, { strict: false }) ||
    !isAddress(invoice.contractAddress, { strict: false }) ||
    !isAddress(invoice.merchant.payoutAddress, { strict: false }) ||
    !isHex(invoice.invoiceRef) ||
    invoice.invoiceRef.length !== 66
  ) {
    throw new Error('The invoice contains invalid payment details.');
  }
  if (!invoice.salt || !isHex(invoice.salt) || invoice.salt.length !== 66) {
    throw new Error(
      'This invoice was created before payment binding and cannot be paid. Ask the merchant for a new invoice.',
    );
  }

  const token = getAddress(invoice.token.address);
  const payout = getAddress(invoice.merchant.payoutAddress);
  const amount = BigInt(invoice.amount);
  const salt = invoice.salt as Hex;
  const expectedRef = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [payout, token, amount, salt],
    ),
  );
  if (expectedRef.toLowerCase() !== invoice.invoiceRef.toLowerCase()) {
    throw new Error('The invoice payment details do not match its reference.');
  }

  return {
    token,
    processor: getAddress(invoice.contractAddress),
    payout,
    invoiceRef: invoice.invoiceRef,
    salt,
    amount,
  };
}

function messageFrom(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'shortMessage' in error) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === 'string') return shortMessage;
  }
  return error instanceof Error ? error.message : 'The wallet request could not be completed.';
}

function statusLabel(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatuses.CREATED:
      return 'Awaiting payment';
    case InvoiceStatuses.PENDING:
      return 'Transaction submitted';
    case InvoiceStatuses.CONFIRMING:
      return 'Confirming on-chain';
    case InvoiceStatuses.PAID:
      return 'Payment complete';
    case InvoiceStatuses.UNDERPAID:
      return 'Payment amount is short';
    case InvoiceStatuses.OVERPAID:
      return 'Payment received in excess';
    case InvoiceStatuses.EXPIRED:
      return 'Invoice expired';
    case InvoiceStatuses.CANCELLED:
      return 'Invoice cancelled';
    case InvoiceStatuses.REFUNDED:
      return 'Payment refunded';
  }
}

export default function CheckoutClient({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [status, setStatus] = useState<InvoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [busy, setBusy] = useState<'connect' | 'approve' | 'pay' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let events: EventSource | null = null;

    async function loadInvoice() {
      setLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`/api/public/invoices/${encodeURIComponent(invoiceId)}`, {
          cache: 'no-store',
        });
        const payload = (await response.json()) as InvoicePayload;
        if (!response.ok || !payload.invoice) {
          throw new Error(payload.error?.message ?? 'This invoice could not be loaded.');
        }
        if (!active) return;

        setInvoice(payload.invoice);
        setStatus(payload.invoice.status);
        events = new EventSource(`/api/public/invoices/${encodeURIComponent(invoiceId)}/events`);
        events.addEventListener('status', (event) => {
          try {
            const update = JSON.parse((event as MessageEvent<string>).data) as {
              status?: string;
            };
            if (update.status && VALID_STATUSES.has(update.status)) {
              setStatus(update.status as InvoiceStatus);
            }
          } catch {
            setNotice('Live status update was unreadable. Reconnecting…');
          }
        });
      } catch (error) {
        if (active) setLoadError(messageFrom(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadInvoice();
    return () => {
      active = false;
      events?.close();
    };
  }, [invoiceId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshTokenState(currentInvoice: PublicInvoice, currentAccount: Address) {
    const chain = chainFor(currentInvoice.chainId);
    const { token, processor } = invoiceParameters(currentInvoice);
    const client = publicClientFor(chain);
    const [currentBalance, currentAllowance] = await Promise.all([
      client.readContract({
        address: token,
        abi: testUsdcAbi,
        functionName: 'balanceOf',
        args: [currentAccount],
      }),
      client.readContract({
        address: token,
        abi: testUsdcAbi,
        functionName: 'allowance',
        args: [currentAccount, processor],
      }),
    ]);
    setBalance(currentBalance);
    setAllowance(currentAllowance);
  }

  async function connectWallet() {
    if (!invoice) return;
    setBusy('connect');
    setActionError('');
    setNotice('');
    try {
      const provider = window.ethereum;
      if (!provider) throw new Error('Install or open an EVM wallet to continue.');

      const chain = chainFor(invoice.chainId);
      const wallet = createWalletClient({ chain, transport: custom(provider) });
      const [address] = await wallet.requestAddresses();
      if (!address) throw new Error('No wallet account was selected.');
      setAccount(address);

      let connectedChainId = await wallet.getChainId();
      if (connectedChainId !== invoice.chainId) {
        await wallet.switchChain({ id: invoice.chainId });
        connectedChainId = await wallet.getChainId();
      }
      setWalletChainId(connectedChainId);
      if (connectedChainId === invoice.chainId) {
        await refreshTokenState(invoice, address);
      }
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }

  async function switchNetwork() {
    if (!invoice || !window.ethereum) return;
    setBusy('connect');
    setActionError('');
    try {
      const chain = chainFor(invoice.chainId);
      const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
      await wallet.switchChain({ id: invoice.chainId });
      const connectedChainId = await wallet.getChainId();
      setWalletChainId(connectedChainId);
      if (account && connectedChainId === invoice.chainId) {
        await refreshTokenState(invoice, account);
      }
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }

  async function approveAmount() {
    if (!invoice || !account || !window.ethereum) return;
    setBusy('approve');
    setActionError('');
    setNotice('');
    try {
      const chain = chainFor(invoice.chainId);
      const { token, processor, amount } = invoiceParameters(invoice);
      const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
      const hash = await wallet.writeContract({
        account,
        address: token,
        abi: testUsdcAbi,
        functionName: 'approve',
        args: [processor, amount],
      });
      const receipt = await publicClientFor(chain).waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Token approval was reverted.');
      await refreshTokenState(invoice, account);
      setNotice('Exact amount approved. Your payment is ready.');
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }

  async function payInvoice() {
    if (!invoice || !account || !window.ethereum) return;
    setBusy('pay');
    setActionError('');
    setNotice('');
    try {
      const chain = chainFor(invoice.chainId);
      const { token, processor, payout, salt, amount } = invoiceParameters(invoice);
      if (payout.toLowerCase() === ZERO_ADDRESS) {
        throw new Error('The merchant has not configured a payout address.');
      }

      const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
      const hash = await wallet.writeContract({
        account,
        address: processor,
        abi: paymentProcessorAbi,
        functionName: 'pay',
        args: [salt, payout, token, amount],
      });
      setTxHash(hash);
      setNotice('Transaction submitted. Waiting for the network receipt.');

      const receipt = await publicClientFor(chain).waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Payment transaction was reverted.');

      try {
        const response = await fetch(`/api/public/invoices/${encodeURIComponent(invoice.id)}/tx`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txHash: hash }),
        });
        if (!response.ok) throw new Error('Transaction status report was rejected.');
        setNotice('Transaction received. Waiting for on-chain payment verification.');
      } catch {
        setNotice('Transaction confirmed. The indexer will update the invoice shortly.');
      }

      await refreshTokenState(invoice, account).catch(() => undefined);
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6">
        Loading invoice…
      </main>
    );
  }

  if (loadError || !invoice || !status) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-3 px-6">
        <p className="text-sm font-semibold text-slate-500">CryptoPay checkout</p>
        <h1 className="text-2xl font-semibold">Invoice unavailable</h1>
        <p role="alert" className="text-sm text-rose-700">
          {loadError || 'This invoice could not be found.'}
        </p>
      </main>
    );
  }

  const chain = CHAINS[invoice.chainId];
  const isExpired = now > 0 && Date.parse(invoice.expiresAt) <= now;
  const isPayable = status === InvoiceStatuses.CREATED && !isExpired;
  const amount = BigInt(invoice.amount);
  const amountText = formatUnits(amount, invoice.token.decimals);
  const chainName = CHAIN_NAMES[invoice.chainId as SupportedChainId] ?? `Chain ${invoice.chainId}`;
  const addressReady =
    isAddress(invoice.contractAddress, { strict: false }) &&
    isAddress(invoice.token.address, { strict: false }) &&
    isAddress(invoice.merchant.payoutAddress, { strict: false }) &&
    invoice.merchant.payoutAddress.toLowerCase() !== ZERO_ADDRESS;
  const onCorrectNetwork = walletChainId === invoice.chainId;
  const enoughBalance = balance !== null && balance >= amount;
  const needsApproval = allowance === null || allowance < amount;
  const canStartPayment =
    isPayable && addressReady && account !== null && onCorrectNetwork && enoughBalance;
  const explorerUrl = EXPLORER_URLS[invoice.chainId as SupportedChainId];
  const expiryText = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(invoice.expiresAt));

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <Link className="text-sm font-semibold tracking-wide text-slate-800" href="/">
            CryptoPay
          </Link>
          <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
            Testnet only
          </span>
        </header>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Pay {invoice.merchant.name}</p>
                <h1 className="mt-2 break-all text-3xl font-semibold tracking-tight sm:text-4xl">
                  {amountText}{' '}
                  <span className="text-xl text-slate-500">{invoice.token.symbol}</span>
                </h1>
                {invoice.description && (
                  <p className="mt-3 max-w-xl text-sm text-slate-600">{invoice.description}</p>
                )}
              </div>
              <span
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  status === InvoiceStatuses.PAID
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : status === InvoiceStatuses.EXPIRED || status === InvoiceStatuses.CANCELLED
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
                aria-live="polite"
              >
                {statusLabel(status)}
              </span>
            </div>

            <dl className="mt-8 grid gap-x-8 gap-y-5 border-t border-slate-200 pt-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase text-slate-500">Network</dt>
                <dd className="mt-1 text-sm font-medium">{chainName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-slate-500">Expires (UTC)</dt>
                <dd className="mt-1 text-sm font-medium">{expiryText}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase text-slate-500">Payout address</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                  {invoice.merchant.payoutAddress}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase text-slate-500">Payment token</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                  {invoice.token.address}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-slate-200 bg-slate-50/70 p-6 sm:p-8">
            <h2 className="text-base font-semibold">Wallet payment</h2>
            <p className="mt-1 text-sm text-slate-600">
              Funds move from your wallet directly to the merchant through the payment contract.
            </p>

            {account ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-slate-700">
                  {account.slice(0, 6)}…{account.slice(-4)}
                </span>
                {onCorrectNetwork ? (
                  <span className="text-emerald-800">Connected to {chainName}</span>
                ) : (
                  <button
                    type="button"
                    onClick={switchNetwork}
                    disabled={busy !== null || !chain}
                    className="font-medium text-indigo-700 underline underline-offset-4 disabled:opacity-50"
                  >
                    Switch to {chainName}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={connectWallet}
                disabled={!isPayable || busy !== null || !chain}
                className="mt-5 min-h-11 w-full rounded-md bg-indigo-700 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
              >
                {busy === 'connect' ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}

            {account && onCorrectNetwork && balance !== null && (
              <p className="mt-4 text-sm text-slate-600">
                Available: {formatUnits(balance, invoice.token.decimals)} {invoice.token.symbol}
              </p>
            )}

            {isExpired && <p className="mt-4 text-sm text-rose-700">This invoice has expired.</p>}
            {!isExpired && !isPayable && status !== InvoiceStatuses.PAID && (
              <p className="mt-4 text-sm text-slate-600">
                This invoice is no longer accepting payments.
              </p>
            )}
            {account && onCorrectNetwork && balance !== null && !enoughBalance && isPayable && (
              <p className="mt-4 text-sm text-rose-700">
                Your wallet balance is below the exact invoice amount.
              </p>
            )}
            {!addressReady && isPayable && (
              <p className="mt-4 text-sm text-rose-700">
                Payment contract or merchant payout is not configured.
              </p>
            )}

            {account && onCorrectNetwork && isPayable && addressReady && (
              <button
                type="button"
                onClick={needsApproval ? approveAmount : payInvoice}
                disabled={!canStartPayment || busy !== null || allowance === null}
                className="mt-5 min-h-11 w-full rounded-md bg-indigo-700 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
              >
                {busy === 'approve'
                  ? 'Approving exact amount…'
                  : busy === 'pay'
                    ? 'Waiting for wallet…'
                    : allowance === null
                      ? 'Checking token allowance…'
                      : needsApproval
                        ? `Approve ${invoice.token.symbol}`
                        : `Pay ${amountText} ${invoice.token.symbol}`}
              </button>
            )}

            {actionError && (
              <p role="alert" className="mt-4 text-sm text-rose-700">
                {actionError}
              </p>
            )}
            {notice && (
              <p role="status" className="mt-4 text-sm text-slate-600">
                {notice}
              </p>
            )}
            {txHash && explorerUrl && (
              <p className="mt-3 text-sm">
                <a
                  className="font-medium text-indigo-700 underline underline-offset-4"
                  href={`${explorerUrl}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View transaction
                </a>
              </p>
            )}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
          <span>Test tokens have no monetary value.</span>
          <span>Invoice {invoice.id}</span>
        </footer>
      </div>
    </main>
  );
}
