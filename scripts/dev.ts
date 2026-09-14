import { config } from "dotenv";
import { join, resolve } from "node:path";

config({ quiet: true });
const setup = await new Deno.Command(Deno.execPath(), {
  args: ["task", "setup"],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!setup.success) throw new Error("Local setup failed");
config({ quiet: true });
const url = new URL(Deno.env.get("CONVEX_URL") ?? "http://127.0.0.1:3210");
if (
  url.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
) {
  throw new Error(
    "Local development starts its own Convex instance. Use deno task dev:external for an existing instance.",
  );
}
const root = Deno.cwd();
const state = resolve(Deno.env.get("ARURA_STATE_DIR") || ".state");
const database = join(state, "convex");
await Deno.mkdir(database, { recursive: true, mode: 0o700 });
const instanceFile = join(database, "instance.json");
let instance: { name: string; secret: string };
try {
  instance = JSON.parse(await Deno.readTextFile(instanceFile));
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  instance = {
    name: "arura-dev",
    secret: Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join(""),
  };
  await Deno.writeTextFile(instanceFile, JSON.stringify(instance), {
    mode: 0o600,
    createNew: true,
  });
}
const executable = Deno.env.get("ARURA_CONVEX_EXECUTABLE") ??
  "convex-local-backend";
const keygen = await new Deno.Command(executable, {
  args: [
    "keygen",
    "admin-key",
    "--instance-name",
    instance.name,
    "--instance-secret",
    instance.secret,
  ],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!keygen.success) {
  throw new Error("Could not generate the local Convex administrator key");
}
const children: Deno.ChildProcess[] = [];
let stopping = false;
const deploymentAbort = new AbortController();
const stop = () => {
  if (stopping) return;
  stopping = true;
  deploymentAbort.abort();
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
};
Deno.addSignalListener("SIGINT", stop);
Deno.addSignalListener("SIGTERM", stop);
function start(exe: string, args: string[], cwd = root) {
  const child = new Deno.Command(exe, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  children.push(child);
  return child;
}
try {
  const portProbe = Deno.listen({
    hostname: "127.0.0.1",
    port: Number(url.port || 3210),
  });
  portProbe.close();
  const backend = start(
    executable,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      url.port || "3210",
      "--site-proxy-port",
      Deno.env.get("ARURA_DEV_CONVEX_SITE_PORT") ?? "3211",
      "--instance-name",
      instance.name,
      "--instance-secret",
      instance.secret,
      "--disable-beacon",
      "--redact-logs-to-client",
    ],
    database,
  );
  let exited = false;
  void backend.status.then(() => {
    exited = true;
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !stopping && !exited; attempt++) {
    try {
      const response = await fetch(new URL("/version", url), {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Backend is starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready || exited || stopping) {
    throw new Error(
      "Local Convex did not start. Check whether its ports are already in use.",
    );
  }
  const { deployFunctions } = await import("./deploy-functions.ts");
  await deployFunctions(
    {
      CONVEX_SELF_HOSTED_URL: url.origin,
      CONVEX_SELF_HOSTED_ADMIN_KEY: new TextDecoder()
        .decode(keygen.stdout)
        .trim(),
    },
    deploymentAbort.signal,
  );
  if (!stopping) {
    start(Deno.execPath(), [
      "run",
      "--watch",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "server/index.ts",
    ]);
    start(Deno.execPath(), ["run", "-A", "npm:vite", "--host", "127.0.0.1"]);
    const result = await Promise.race(children.map((child) => child.status));
    if (!result.success && !stopping) {
      throw new Error("A development service exited unexpectedly");
    }
  }
} finally {
  stop();
  const timeout = setTimeout(() => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* Already stopped. */
      }
    }
  }, 3000);
  await Promise.all(children.map((child) => child.status));
  clearTimeout(timeout);
  Deno.removeSignalListener("SIGINT", stop);
  Deno.removeSignalListener("SIGTERM", stop);
}
