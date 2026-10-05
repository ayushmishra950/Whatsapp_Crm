import { AuditLog } from '../models/index.js';

export async function audit(req, action, { targetType, targetId, meta, tenantId } = {}) {
  try {
    await AuditLog.create({
      tenantId: tenantId ?? req.tenantId ?? undefined,
      actorId: req.user?._id,
      actorRole: req.user?.role,
      impersonatedBy: req.impersonatedBy || undefined,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      meta,
      ip: req.ip,
    });
  } catch (err) {
    // Audit failure must never break the main request
    console.error('[audit] failed to write log', err.message);
  }
}
