import CheckoutClient from './checkout-client';

export default async function PayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <CheckoutClient invoiceId={invoiceId} />;
}