'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InvoiceStatus as InvoiceStatuses, INVOICE_STATUSES } from '@cryptopay/shared';
import type { InvoiceStatus } from '@cryptopay/shared';
import { formatUnits, parseUnits } from 'viem';

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS ?? '';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PAGE_SIZE = 20;

interface InvoiceRow {
  id: string;
  invoiceRef: string;
  status: InvoiceStatus;
  amount: string;
  tokenAddress: string;
  description: string | null;
  merchantReference: string | null;
  expiresAt: string;
  createdAt: string;
}

interface InvoicePage {
  data: InvoiceRow[];
  nextCursor: string | null;
}

interface ApiError {
  error?: { message?: string };
}

interface CreateInvoiceResponse extends ApiError {
  invoice?: InvoiceRow;
  checkoutUrl?: string;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
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

export default function InvoicesClient() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [merchantReference, setMerchantReference] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('30');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdCheckoutUrl, setCreatedCheckoutUrl] = useState('');

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (statusFilter !== 'ALL') query.set('status', statusFilter);

    void fetch(`/api/v1/invoices?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as InvoicePage & ApiError;
        if (!response.ok) throw new Error(payload.error?.message ?? 'Invoices could not be loaded.');
        if (!active) return;
        setInvoices(payload.data);
        setNextCursor(payload.nextCursor);
        setListError('');
      })
      .catch((error: unknown) => {
        if (active) setListError(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [statusFilter, refreshKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: nextCursor });
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      const response = await fetch(`/api/v1/invoices?${query}`, { cache: 'no-store' });
      const payload = (await response.json()) as InvoicePage & ApiError;
      if (!response.ok) throw new Error(payload.error?.message ?? 'More invoices could not be loaded.');
      setInvoices((current) => [...current, ...payload.data]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    setCreatedCheckoutUrl('');

    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(TOKEN_ADDRESS) || TOKEN_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
        throw new Error('The test token is not configured for this environment.');
      }
      const baseUnits = parseUnits(amount, 6);
      if (baseUnits <= 0n) throw new Error('Enter an amount greater than zero.');
      const requestKey = idempotencyKey ?? crypto.randomUUID();
      setIdempotencyKey(requestKey);

      const response = await fetch('/api/v1/invoices', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': requestKey,
        },
        body: JSON.stringify({
          amount: baseUnits.toString(),
          tokenAddress: TOKEN_ADDRESS,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(merchantReference.trim() ? { merchantReference: merchantReference.trim() } : {}),
          expiresInMinutes: Number(expiresInMinutes),
        }),
      });
      const payload = (await response.json()) as CreateInvoiceResponse;
      if (!response.ok || !payload.invoice || !payload.checkoutUrl) {
        throw new Error(payload.error?.message ?? 'Invoice could not be created.');
      }

      setCreatedCheckoutUrl(payload.checkoutUrl);
      setAmount('');
      setDescription('');
      setMerchantReference('');
      setIdempotencyKey(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      setCreating(false);
    }
  }

  const tokenConfigured =
    /^0x[0-9a-fA-F]{40}$/.test(TOKEN_ADDRESS) && TOKEN_ADDRESS.toLowerCase() !== ZERO_ADDRESS;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link className="text-sm font-semibold tracking-wide text-slate-800" href="/dashboard">
              CryptoPay
            </Link>
            <Link className="text-sm font-medium text-slate-600 hover:text-slate-900" href="/dashboard">
              Overview
            </Link>
            <span className="text-sm font-semibold text-indigo-700">Invoices</span>
          </div>
          <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
            Testnet only
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Merchant workspace</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h1>
          </div>
          <button
            className="min-h-10 rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
            onClick={() => {
              setShowCreateForm((open) => !open);
              setCreateError('');
            }}
            type="button"
          >
            {showCreateForm ? 'Close form' : 'New invoice'}
          </button>
        </div>

        {showCreateForm && (
          <section aria-labelledby="create-invoice-heading" className="mb-8 border border-slate-200 bg-white p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold" id="create-invoice-heading">Create invoice</h2>
              <p className="mt-1 text-sm text-slate-500">Payments are accepted in tUSDC on the configured test network.</p>
            </div>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={createInvoice}>
              <label className="text-sm font-medium text-slate-700">
                Amount (tUSDC)
                <input
                  className="mt-1.5 min-h-10 w-full rounded border border-slate-300 px-3 text-sm font-normal text-slate-900"
                  inputMode="decimal"
                  min="0.000001"
                  onChange={(event) => {
                    setIdempotencyKey(null);
                    setAmount(event.target.value);
                  }}
                  placeholder="25.00"
                  required
                  step="0.000001"
                  type="number"
                  value={amount}
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Expires after
                <select
                  className="mt-1.5 min-h-10 w-full rounded border border-slate-300 px-3 text-sm font-normal text-slate-900"
                  onChange={(event) => {
                    setIdempotencyKey(null);
                    setExpiresInMinutes(event.target.value);
                  }}
                  value={expiresInMinutes}
                >
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="1440">24 hours</option>
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                Merchant reference <span className="font-normal text-slate-500">(optional)</span>
                <input
                  className="mt-1.5 min-h-10 w-full rounded border border-slate-300 px-3 text-sm font-normal text-slate-900"
                  maxLength={255}
                  onChange={(event) => {
                    setIdempotencyKey(null);
                    setMerchantReference(event.target.value);
                  }}
                  value={merchantReference}
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Description <span className="font-normal text-slate-500">(optional)</span>
                <input
                  className="mt-1.5 min-h-10 w-full rounded border border-slate-300 px-3 text-sm font-normal text-slate-900"
                  maxLength={500}
                  onChange={(event) => {
                    setIdempotencyKey(null);
                    setDescription(event.target.value);
                  }}
                  value={description}
                />
              </label>
              {!tokenConfigured && (
                <p className="text-sm text-rose-700 sm:col-span-2" role="alert">
                  The test token is not configured for this environment.
                </p>
              )}
              {createError && (
                <p className="text-sm text-rose-700 sm:col-span-2" role="alert">{createError}</p>
              )}
              {createdCheckoutUrl && (
                <p className="text-sm text-emerald-800 sm:col-span-2" role="status">
                  Invoice created.{' '}
                  <a className="font-medium underline underline-offset-4" href={createdCheckoutUrl}>
                    Open checkout
                  </a>
                </p>
              )}
              <div className="sm:col-span-2">
                <button
                  className="min-h-10 rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={creating || !tokenConfigured}
                  type="submit"
                >
                  {creating ? 'Creating…' : 'Create invoice'}
                </button>
              </div>
            </form>
          </section>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Invoice amounts are shown in tUSDC base-unit precision.</p>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Status
            <select
              className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
              onChange={(event) => {
                setLoading(true);
                setStatusFilter(event.target.value as InvoiceStatus | 'ALL');
              }}
              value={statusFilter}
            >
              <option value="ALL">All</option>
              {INVOICE_STATUSES.map((status) => (
                <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </label>
        </div>

        {listError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm text-rose-800" role="alert">{listError}</p>
            <Link className="text-sm font-medium text-indigo-700 underline underline-offset-4" href="/login">
              Sign in again
            </Link>
          </div>
        )}

        {loading ? (
          <p className="border-y border-slate-200 py-6 text-sm text-slate-500">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="border-y border-slate-200 py-6 text-sm text-slate-500">No invoices match this filter.</p>
        ) : (
          <div className="overflow-x-auto border-y border-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Invoice</th>
                  <th className="py-3 pr-4 font-medium">Amount</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Created (UTC)</th>
                  <th className="py-3 font-medium">Expires (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="py-3 pr-4">
                      <Link
                        className="font-mono text-xs text-indigo-700 underline underline-offset-4"
                        href={`/pay/${invoice.id}`}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        {invoice.merchantReference || `${invoice.invoiceRef.slice(0, 10)}…`}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 font-medium tabular-nums">
                      {formatUnits(BigInt(invoice.amount), 6)} tUSDC
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${statusStyle(invoice.status)}`}>
                        {invoice.status.toLowerCase().replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-xs text-slate-500">{displayDate(invoice.createdAt)}</td>
                    <td className="whitespace-nowrap py-3 text-xs text-slate-500">{displayDate(invoice.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextCursor && (
          <button
            className="mt-4 min-h-9 text-sm font-medium text-indigo-700 underline underline-offset-4 disabled:opacity-50"
            disabled={loadingMore}
            onClick={loadMore}
            type="button"
          >
            {loadingMore ? 'Loading…' : 'Load more invoices'}
          </button>
        )}
      </div>
    </main>
  );
}