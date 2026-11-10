import { CHAIN_IDS, CHAIN_NAMES, EXPLORER_URLS } from '@cryptopay/shared';

const chainId = CHAIN_IDS.baseSepolia;
const contractAddress = process.env.NEXT_PUBLIC_PAYMENT_PROCESSOR_ADDRESS;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div
        role="status"
        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <strong>Test network only.</strong> CryptoPay Gateway runs on {CHAIN_NAMES[chainId]}. Test
        tokens have no monetary value.
      </div>

      <header className="space-y-4">
        <p className="text-sm font-semibold tracking-wide text-indigo-600 uppercase">
          CryptoPay Gateway
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Non-custodial stablecoin payments for merchants.
        </h1>
        <p className="text-lg text-slate-600">
          Create an invoice, let your customer pay from their own wallet, and reconcile every
          payment from on-chain events. The platform never holds funds.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['1. Create', 'Merchant creates an invoice with an amount, token and expiry.'],
          ['2. Pay', 'Customer pays directly from their wallet through the contract.'],
          ['3. Confirm', 'The indexer verifies the on-chain event and notifies your server.'],
        ].map(([title, description]) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{description}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-col gap-2 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Network: {CHAIN_NAMES[chainId]} ({chainId})
        </span>
        <a
          className="font-medium text-indigo-600 underline-offset-4 hover:underline"
          href={EXPLORER_URLS[chainId]}
          rel="noreferrer noopener"
          target="_blank"
        >
          Block explorer
        </a>
      </footer>

      {contractAddress ? (
        <p className="text-xs break-all text-slate-400">
          Payment processor: <code>{contractAddress}</code>
        </p>
      ) : (
        <p className="text-xs text-slate-400">
          Payment processor address is not configured for this environment.
        </p>
      )}
    </main>
  );
}
