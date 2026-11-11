'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createWalletClient, custom, type Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';

type LoginStep = 'idle' | 'connect' | 'sign' | 'verify';
type ApiErrorPayload = { error?: { message?: string } };
type NoncePayload = { nonce?: string; expiresAt?: string; error?: { message?: string } };

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'shortMessage' in error) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === 'string') return shortMessage;
  }
  return error instanceof Error ? error.message : 'Wallet sign-in could not be completed.';
}

export default function LoginClient() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then((response) => {
        if (active && response.ok) router.replace('/dashboard');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function signIn() {
    setStep('connect');
    setError('');

    try {
      const provider = window.ethereum;
      if (!provider) throw new Error('Open this page in a browser with an EVM wallet installed.');

      const wallet = createWalletClient({ transport: custom(provider) });
      const [address] = await wallet.requestAddresses();
      if (!address) throw new Error('No wallet account was selected.');

      const chainId = await wallet.getChainId();
      const nonceResponse = await fetch(
        `/api/auth/nonce?address=${encodeURIComponent(address)}`,
        { cache: 'no-store' },
      );
      const noncePayload = (await nonceResponse.json()) as NoncePayload;
      if (!nonceResponse.ok || !noncePayload.nonce || !noncePayload.expiresAt) {
        throw new Error(noncePayload.error?.message ?? 'Could not start wallet sign-in.');
      }

      const expirationTime = new Date(noncePayload.expiresAt);
      if (Number.isNaN(expirationTime.getTime()) || expirationTime <= new Date()) {
        throw new Error('The sign-in request expired. Please try again.');
      }

      setStep('sign');
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to CryptoPay Gateway. No blockchain transaction will be submitted.',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce: noncePayload.nonce,
        issuedAt: new Date(),
        expirationTime,
      });
      const signature = await wallet.signMessage({ account: address as Address, message });

      setStep('verify');
      const verifyResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      const verifyPayload = (await verifyResponse.json()) as ApiErrorPayload;
      if (!verifyResponse.ok) {
        throw new Error(verifyPayload.error?.message ?? 'Wallet signature could not be verified.');
      }

      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStep('idle');
    }
  }

  const stepText: Record<LoginStep, string> = {
    idle: 'Sign in with wallet',
    connect: 'Connecting wallet…',
    sign: 'Confirm sign-in in your wallet…',
    verify: 'Verifying signature…',
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-md">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link className="text-sm font-semibold tracking-wide text-slate-800" href="/">
            CryptoPay
          </Link>
          <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
            Testnet only
          </span>
        </header>

        <section className="rounded-md border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-slate-500">Merchant access</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to CryptoPay</h1>
          <p className="mt-3 text-sm text-slate-600">
            Your wallet signature creates a session. It does not submit a transaction or spend tokens.
          </p>

          <button
            type="button"
            onClick={signIn}
            disabled={step !== 'idle'}
            className="mt-6 min-h-11 w-full rounded-md bg-indigo-700 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-wait disabled:bg-slate-400"
          >
            {stepText[step]}
          </button>

          {error && (
            <p className="mt-4 text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
        </section>

        <p className="mt-5 text-center text-xs text-slate-500">
          Test tokens have no monetary value. Never use a mainnet wallet for this testnet service.
        </p>
      </div>
    </main>
  );
}