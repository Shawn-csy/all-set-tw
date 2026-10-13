export type HealthStatus = {
  status: "ok" | "error";
  ready: boolean;
  d1: boolean;
};

export async function checkHealth(db: D1Database): Promise<HealthStatus> {
  try {
    await db.prepare("SELECT 1").first();
    return { status: "ok", ready: true, d1: true };
  } catch {
    return { status: "error", ready: false, d1: false };
  }
}
