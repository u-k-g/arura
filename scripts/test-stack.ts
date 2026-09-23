import { join } from "node:path";

const root = Deno.cwd();
const scratch = await Deno.makeTempDir({
  dir: "/var/tmp",
  prefix: "arura-integration-",
});
const code = join(scratch, "functions");
await Deno.mkdir(code);
async function copy(source: string, target: string) {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name),
      to = join(target, entry.name);
    if (entry.isDirectory) await copy(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
for (const dir of ["convex", "shared"]) {
  await copy(join(root, dir), join(code, dir));
}
for (const file of ["package.json", "deno.json", "deno.lock"]) {
  await Deno.copyFile(join(root, file), join(code, file));
}
await Deno.symlink(join(root, "node_modules"), join(code, "node_modules"));
function port() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = listener.addr.port;
  listener.close();
  return p;
}
const dbPort = port(),
  sitePort = port(),
  appPort = port(),
  hermesPort = port();
const secret = Array.from(
  crypto.getRandomValues(new Uint8Array(32)),
  (n) => n.toString(16).padStart(2, "0"),
).join("");
const backend = Deno.env.get("ARURA_CONVEX_EXECUTABLE") ??
  "convex-local-backend";
const keygen = await new Deno.Command(backend, {
  args: [
    "keygen",
    "admin-key",
    "--instance-name",
    "arura-test",
    "--instance-secret",
    secret,
  ],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!keygen.success) {
  throw new Error("Could not generate the isolated Convex key");
}
const appUrl = `http://localhost:${appPort}`,
  dbUrl = `http://127.0.0.1:${dbPort}`;
const env = {
  ARURA_STATE_DIR: join(scratch, "identity"),
  ARURA_AUTH_ISSUER: appUrl,
  ARURA_PUBLIC_URL: appUrl,
  ARURA_PORT: String(appPort),
  ARURA_ACCESS_KEY: crypto.randomUUID(),
  ARURA_TEST_ADAPTER_PID: "",
  CONVEX_SELF_HOSTED_URL: dbUrl,
  CONVEX_SELF_HOSTED_ADMIN_KEY: new TextDecoder().decode(keygen.stdout).trim(),
  CONVEX_URL: dbUrl,
  CONVEX_PUBLIC_URL: dbUrl,
  HERMES_URL: `http://127.0.0.1:${hermesPort}`,
  HERMES_FIXTURE_PORT: String(hermesPort),
  HERMES_USERNAME: "",
  HERMES_PASSWORD: "",
  HERMES_AUTH_PROVIDER: "",
  HERMES_TOKEN: "",
  ARURA_ACTIONS_FILE: "",
  TMPDIR: scratch,
  ARURA_TEST_URL: appUrl,
  ARURA_TEST_ACCESS_KEY: "",
};
env.ARURA_TEST_ACCESS_KEY = env.ARURA_ACCESS_KEY;
const children: Deno.ChildProcess[] = [],
  logs: Promise<void>[] = [];
async function start(
  name: string,
  exe: string,
  args: string[],
  cwd = root,
  overrides: Record<string, string> = {},
) {
  const child = new Deno.Command(exe, {
    args,
    cwd,
    env: { ...env, ...overrides },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  children.push(child);
  for (
    const [suffix, stream] of [
      ["out", child.stdout],
      ["err", child.stderr],
    ] as const
  ) {
    const file = await Deno.open(join(scratch, `${name}.${suffix}.log`), {
      write: true,
      create: true,
      mode: 0o600,
    });
    logs.push(stream.pipeTo(file.writable));
  }
  return child;
}
async function ready(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(url);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Test service did not start; logs are in ${scratch}`);
}
async function run(args: string[], cwd = root) {
  const status = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(`Test command failed: ${args.slice(0, 3).join(" ")}`);
  }
}
try {
  await start(
    "convex",
    backend,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      String(dbPort),
      "--site-proxy-port",
      String(sitePort),
      "--instance-name",
      "arura-test",
      "--instance-secret",
      secret,
      "--disable-beacon",
    ],
    scratch,
  );
  await ready(`${dbUrl}/version`);
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const { identity, issuer } = await import("../server/identity.ts");
  const keys = await identity();
  await Deno.writeTextFile(
    join(scratch, "auth.env"),
    `ARURA_AUTH_ISSUER=${issuer}\nARURA_JWKS=data:application/json;base64,${
      btoa(
        JSON.stringify(keys.jwks),
      )
    }\n`,
    { mode: 0o600 },
  );
  const packagedDeploy = Deno.env.get("ARURA_DEPLOY_EXECUTABLE");
  if (packagedDeploy) {
    const status = await new Deno.Command(packagedDeploy, {
      cwd: scratch,
      env: { ...env, DENO_DIR: join(scratch, "deploy-deno") },
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) throw new Error("Packaged function deployment failed");
  } else {
    await run(
      [
        "task",
        "convex",
        "env",
        "set",
        "--from-file",
        join(scratch, "auth.env"),
      ],
      code,
    );
    await run(
      [
        "task",
        "convex",
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
      ],
      code,
    );
  }
  await start("hermes", Deno.execPath(), [
    "run",
    "-A",
    "tests/hermes_fixture.ts",
  ]);
  await ready(`${env.HERMES_URL}/api/health`);
  const packaged = Deno.env.get("ARURA_SERVER_EXECUTABLE");
  const adapterProcess = packaged
    ? await start("arura", packaged, [], scratch, {
      DENO_DIR: join(scratch, "runtime-deno"),
    })
    : await start("arura", Deno.execPath(), ["run", "-A", "server/index.ts"]);
  env.ARURA_TEST_ADAPTER_PID = String(adapterProcess.pid);
  await ready(`${appUrl}/api/bootstrap`);
  await run(["test", "-A", ...(Deno.args.length ? Deno.args : ["tests/"])]);
  console.log("Isolated integration tests passed.");
} finally {
  for (const child of children.reverse()) {
    try {
      child.kill("SIGCONT");
      child.kill("SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  const deadline = setTimeout(() => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  }, 3000);
  await Promise.all(children.map((child) => child.status));
  clearTimeout(deadline);
  await Promise.allSettled(logs);
  console.log(`Test artifacts: ${scratch}`);
}
