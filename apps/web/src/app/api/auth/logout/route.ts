import { ApiError, ApiErrorCode, AuditAction } from '@cryptopay/shared';
import { getServerEnv } from '@/lib/env';
import { authenticate } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { jsonOk, route } from '@/lib/http';
import { clearSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** End the session server-side by expiring the cookie (FR-AUTH-3). */
export const POST = route(async (request, context) => {
  const env = getServerEnv();

  try {
    const auth = await authenticate(request);
    await recordAudit({
      actor: auth.walletAddress,
      action: AuditAction.Logout,
      merchantId: auth.merchantId,
      ip: context.ip,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== ApiErrorCode.Unauthorized) throw error;
  }

  return jsonOk({ ok: true }, 200, {
    'set-cookie': clearSessionCookie(env.NODE_ENV === 'production'),
  });
});
