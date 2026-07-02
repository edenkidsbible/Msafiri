import { db, auditLogsTable, adminNotificationsTable } from "@workspace/db";

export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

export async function logAudit(params: {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: object;
}): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId:    params.actor.id,
      actorName:  params.actor.name,
      actorRole:  params.actor.role,
      action:     params.action,
      targetType: params.targetType ?? null,
      targetId:   params.targetId ?? null,
      details:    params.details ? JSON.stringify(params.details) : null,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function createNotification(params: {
  title:   string;
  message: string;
  type?:   "info" | "warning" | "error" | "success";
}): Promise<void> {
  try {
    await db.insert(adminNotificationsTable).values({
      title:   params.title,
      message: params.message,
      type:    params.type ?? "info",
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}
