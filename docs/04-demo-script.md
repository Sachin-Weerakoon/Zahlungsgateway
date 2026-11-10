# Demo script (must pass three times in a row)

Prerequisites: staging deployed on Base Sepolia, tUSDC minted to the customer wallet, merchant
wallet funded with test ETH, webhook receiver running over HTTPS.

1. **Merchant login** — open the app, connect the merchant wallet, sign the SIWE message.
   Expect a session and the dashboard overview.
2. **Configure** — confirm the payout address, create an API key (copy it once), set the webhook URL
   and copy the signing secret.
3. **Create invoice** — `POST /api/v1/invoices` with amount `25000000` (25 tUSDC), token tUSDC,
   reference `ORDER-1042`, expiry 30 minutes. Expect a checkout URL.
4. **Checkout** — open `/pay/{id}` in a clean browser. Verify merchant name, amount, payout address,
   contract address, expiry countdown and testnet banner.
5. **Pay** — connect the customer wallet, switch to Base Sepolia, approve the exact amount, call
   `pay`. Expect the transaction hash and explorer link within 5 seconds.
6. **Confirm** — expect `CONFIRMING` within 10 seconds of mining and `PAID` after 5 confirmations,
   with no manual refresh.
7. **Webhook** — the receiver verifies `X-Signature`, logs `invoice.confirming` and `invoice.paid`
   in order with increasing `sequence` values.
8. **Dashboard** — the invoice timeline shows every status change with transaction links; gross,
   fee (1%) and net are correct (25.00 / 0.25 / 24.75 tUSDC).
9. **Refund** — sign a 10 tUSDC refund, then 14.75 tUSDC. Expect the invoice to become `REFUNDED`.
   Attempting 24.76 reverts.
10. **Reports** — settlement totals match the payment; CSV export opens with UTF-8 headers and
    ISO 8601 UTC timestamps.
11. **Failure path** — stop the webhook receiver, create and pay another invoice, confirm retries are
    scheduled, restart the receiver and confirm the next attempt succeeds.
12. **Admin** — set the fee to 250 bps, pay a new invoice, confirm 2.5% is charged; verify the audit
    log contains the fee change.

Record the run number, timestamp, chain, contract address and any deviation.
