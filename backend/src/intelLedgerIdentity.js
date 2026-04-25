function normalizeToken(value) {
  const token = String(value || '').trim();
  return token ? token.slice(0, 120) : null;
}

function firstToken(...values) {
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (normalized) return normalized;
  }
  return null;
}

export function resolveIntelLedgerIdentity(req, options = {}) {
  const requireAuthContext = options.requireAuthContext === true;

  const trustedUserId = firstToken(
    req?.user?.id,
    req?.user?.user_id,
    req?.headers?.['x-auth-user-id'],
    req?.headers?.['x-user-id']
  );

  const trustedTenantId = firstToken(
    req?.user?.tenant_id,
    req?.user?.tenantId,
    req?.headers?.['x-auth-tenant-id'],
    req?.headers?.['x-tenant-id']
  );

  const requestedUserId = firstToken(req?.body?.userId, req?.query?.userId);
  const requestedTenantId = firstToken(
    req?.headers?.['x-intelledger-tenant-id'],
    req?.query?.tenantId,
    req?.query?.tenant_id,
    req?.body?.tenantId,
    req?.body?.tenant_id
  );

  const hasTrustedContext = Boolean(trustedUserId || trustedTenantId);
  const authRequiredButMissing = requireAuthContext && !hasTrustedContext;

  const mismatch = {
    user: Boolean(trustedUserId && requestedUserId && trustedUserId !== requestedUserId),
    tenant: Boolean(trustedTenantId && requestedTenantId && trustedTenantId !== requestedTenantId)
  };

  const userId = trustedUserId || (authRequiredButMissing ? null : requestedUserId);
  const tenantId = trustedTenantId || (authRequiredButMissing ? null : requestedTenantId);

  return {
    userId,
    tenantId,
    trustedUserId,
    trustedTenantId,
    requestedUserId,
    requestedTenantId,
    hasTrustedContext,
    authRequiredButMissing,
    mismatch
  };
}
