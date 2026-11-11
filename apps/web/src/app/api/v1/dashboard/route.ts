import { prisma } from '@cryptopay/db';
import { EXPLORER_URLS, type SupportedChainId } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { getServerEnv } from '@/lib/env';
import { jsonOk, route } from '@/lib/http';
import { getMerchantProfile } from '@/lib/merchants';
import { dashboardMetrics, listPayments } from '@/lib/reports';
import { listInvoices } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const [merchant, metrics, invoices, payments] = await Promise.all([
    getMerchantProfile(auth),
    dashboardMetrics(auth),
    listInvoices(auth, { limit: 5 }),
    listPayments(auth, { limit: 5 }),
  ]);
  const invoiceTokenAddresses = [...new Set(invoices.data.map((invoice) => invoice.tokenAddress))];
  const invoiceTokens = await prisma.token.findMany({
    where: { address: { in: invoiceTokenAddresses } },
    select: { address: true, symbol: true, decimals: true },
  });
  const tokenMap = new Map(invoiceTokens.map((token) => [token.address.toLowerCase(), token]));
  const chainId = getServerEnv().CHAIN_ID;

  return jsonOk({
    merchant,
    isAdmin: auth.isAdmin,
    explorerUrl: EXPLORER_URLS[chainId as SupportedChainId] ?? null,
    ...metrics,
    recentInvoices: invoices.data.map((invoice) => {
      const token = tokenMap.get(invoice.tokenAddress.toLowerCase());
      return {
        ...invoice,
        tokenSymbol: token?.symbol ?? 'UNKNOWN',
        tokenDecimals: token?.decimals ?? 18,
      };
    }),
    recentPayments: payments.data,
  });
});