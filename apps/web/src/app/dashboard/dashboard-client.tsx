'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatUnits } from 'viem';
import { InvoiceStatus as InvoiceStatuses } from '@cryptopay/shared';
import type { InvoiceStatus, MerchantProfile } from '@cryptopay/shared';

interface DashboardInvoice {
  id: string;
  invoiceRef: string;
  status: InvoiceStatus;
  amount: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  description: string | null;
  merchantReference: string | null;
  expiresAt: string;
  createdAt: string;
}

interface DashboardPayment {
  id: string;
  txHash: string;
  invoiceRef: string;
  symbol: string;
  decimals: number;
  gross: string;
  confirmations: number;
  createdAt: string;
}

interface DashboardVolume {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  paymentCount: number;
  gross: string;
  fee: string;
  net: string;
}

interface DashboardData {
  merchant: MerchantProfile;
  isAdmin: boolean;
  explorerUrl: string | null;
  totalInvoices: number;
  invoiceCounts: Record<InvoiceStatus, number>;
  currentMonth: {
    from: string;
    to: string;
    paymentCount: number;
    volume: DashboardVolume[];
  };
  recentInvoices: DashboardInvoice[];
  recentPayments: DashboardPayment[];
}

interface ApiErrorPayload {
  error?: { message?: string };
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function statusStyle(status: InvoiceStatus): string {
  if (status === InvoiceStatuses.PAID) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === InvoiceStatuses.EXPIRED || status === InvoiceStatuses.CANCELLED) {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  if (status === InvoiceStatuses.CONFIRMING || status === InvoiceStatuses.PENDING) {
    return 'border-sky-200 bg-sky-50 text-sky-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function statusLabel(status: InvoiceStatus): string {
  return status.toLowerCase().replaceAll('_', ' ');
}

export default function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/dashboard', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as DashboardData & ApiErrorPayload;
        if (!response.ok) {
          const failure = new Error(payload.error?.message ?? 'Dashboard data could not be loaded.');
          Object.assign(failure, { status: response.status });
          throw failure;
        }
        if (active) setData(payload);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setUnauthorized(
          typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 401,
        );
        setError(failure instanceof Error ? failure.message : 'Dashboard data could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not end the merchant session.');
      router.replace('/login');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not end the merchant session.');
      setSigningOut(false);
    }
  }

  if (loading) {
    return <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6">Loading dashboard…</main>;
  }

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
        <p className="text-sm font-semibold text-slate-500">CryptoPay merchant</p>
        <h1 className="text-2xl font-semibold">{unauthorized ? 'Sign in required' : 'Dashboard unavailable'}</h1>
        <p role="alert" className="text-sm text-rose-700">
          {error || 'Dashboard data could not be loaded.'}
        </p>
        {unauthorized ? (
          <Link className="font-medium text-indigo-700 underline underline-offset-4" href="/login">
            Sign in with wallet
          </Link>
        ) : (
          <button
            className="self-start font-medium text-indigo-700 underline underline-offset-4"
            onClick={() => window.location.reload()}
            type="button"
          >
            Try again
          </button>
        )}
      </main>
    );
  }

  const openInvoices =
    data.invoiceCounts[InvoiceStatuses.CREATED] +
    data.invoiceCounts[InvoiceStatuses.PENDING] +
    data.invoiceCounts[InvoiceStatuses.CONFIRMING];
  const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(data.currentMonth.from));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link className="text-sm font-semibold tracking-wide text-slate-800" href="/">
              CryptoPay
            </Link>
            <span className="hidden h-5 border-l border-slate-200 sm:block" />
            <span className="text-sm font-medium text-slate-600">Merchant overview</span>
            <Link
              className="text-sm font-medium text-indigo-700 underline underline-offset-4"
              href="/dashboard/invoices"
            >
              Invoices
            </Link>
          </div>
          <div className="flex items-center gap-4">
            {data.isAdmin && (
              <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
                Admin
              </span>
            )}
            <button
              className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
              disabled={signingOut}
              onClick={signOut}
              type="button"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Merchant account</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {data.merchant.name || 'Overview'}
            </h1>
            <p className="mt-2 font-mono text-xs text-slate-500">{data.merchant.walletAddress}</p>
          </div>
          <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
            Testnet only
          </span>
        </div>

        <section aria-label="Invoice summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['All invoices', data.totalInvoices],
            ['Open invoices', openInvoices],
            ['Paid invoices', data.invoiceCounts[InvoiceStatuses.PAID]],
            [`Payments in ${monthName}`, data.currentMonth.paymentCount],
          ].map(([label, value]) => (
            <div className="border border-slate-200 bg-white p-4" key={label}>
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_1.4fr]">
          <section aria-labelledby="volume-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold" id="volume-heading">Settlement activity</h2>
                <p className="mt-1 text-sm text-slate-500">Gross payment volume for {monthName}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {data.currentMonth.volume.length === 0 ? (
                <p className="py-5 text-sm text-slate-500">No confirmed payments this month.</p>
              ) : (
                data.currentMonth.volume.map((row) => (
                  <div className="flex flex-wrap items-baseline justify-between gap-2 py-4" key={row.tokenAddress}>
                    <div>
                      <p className="font-medium">{row.symbol}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.paymentCount} payments</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatUnits(BigInt(row.gross), row.decimals)} {row.symbol}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section aria-labelledby="invoices-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold" id="invoices-heading">Recent invoices</h2>
                <p className="mt-1 text-sm text-slate-500">Latest five for this merchant</p>
              </div>
              <span className="text-xs text-slate-500">{data.totalInvoices} total</span>
            </div>
            {data.recentInvoices.length === 0 ? (
              <p className="border-y border-slate-200 py-5 text-sm text-slate-500">No invoices yet.</p>
            ) : (
              <div className="overflow-x-auto border-y border-slate-200">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4 font-medium">Invoice</th>
                      <th className="py-3 pr-4 font-medium">Amount</th>
                      <th className="py-3 pr-4 font-medium">Status</th>
                      <th className="py-3 font-medium">Created (UTC)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="py-3 pr-4">
                          <span className="font-mono text-xs text-slate-700">
                            {invoice.merchantReference || `${invoice.invoiceRef.slice(0, 10)}…`}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-medium tabular-nums">
                          {formatUnits(BigInt(invoice.amount), invoice.tokenDecimals)} {invoice.tokenSymbol}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${statusStyle(invoice.status)}`}>
                            {statusLabel(invoice.status)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-3 text-xs text-slate-500">
                          {displayDate(invoice.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section aria-labelledby="payments-heading" className="mt-9">
          <div className="mb-4">
            <h2 className="text-base font-semibold" id="payments-heading">Recent payments</h2>
            <p className="mt-1 text-sm text-slate-500">Latest chain-confirmed activity</p>
          </div>
          {data.recentPayments.length === 0 ? (
            <p className="border-y border-slate-200 py-5 text-sm text-slate-500">No confirmed payments yet.</p>
          ) : (
            <div className="overflow-x-auto border-y border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-3 pr-4 font-medium">Transaction</th>
                    <th className="py-3 pr-4 font-medium">Invoice</th>
                    <th className="py-3 pr-4 font-medium">Gross paid</th>
                    <th className="py-3 pr-4 font-medium">Confirmations</th>
                    <th className="py-3 font-medium">Received (UTC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="py-3 pr-4">
                        {data.explorerUrl ? (
                          <a
                            className="font-mono text-xs text-indigo-700 underline underline-offset-4"
                            href={`${data.explorerUrl}/tx/${payment.txHash}`}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {payment.txHash.slice(0, 10)}…{payment.txHash.slice(-6)}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-slate-600">
                            {payment.txHash.slice(0, 10)}…{payment.txHash.slice(-6)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-600">
                        {payment.invoiceRef.slice(0, 10)}…
                      </td>
                      <td className="py-3 pr-4 font-medium tabular-nums">
                        {formatUnits(BigInt(payment.gross), payment.decimals)} {payment.symbol}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">{payment.confirmations}</td>
                      <td className="whitespace-nowrap py-3 text-xs text-slate-500">
                        {displayDate(payment.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}