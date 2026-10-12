const baseUrl = (
  process.env.LOCAL_PRODUCTION_URL || "http://127.0.0.1:8787"
).replace(/\/$/, "");

const runtime = await getJson("/api/runtime");
if (
  runtime.deploymentMode !== "local-primary" ||
  runtime.cloudBackup !== false
) {
  throw new Error(
    `unexpected runtime mode: ${JSON.stringify({ deploymentMode: runtime.deploymentMode, cloudBackup: runtime.cloudBackup })}`,
  );
}

const readiness = await getJson("/api/ready");
if (readiness.ready !== true || readiness.d1 !== true) {
  throw new Error(`runtime is not ready: ${JSON.stringify(readiness)}`);
}

const response = await fetch(`${baseUrl}/`, {
  signal: AbortSignal.timeout(5_000),
});
if (!response.ok) {
  throw new Error(`worker assets returned HTTP ${response.status}`);
}

console.log(
  `[runtime-smoke] ok: ${baseUrl}, mode=${runtime.deploymentMode}, d1=${readiness.d1}`,
);

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}
