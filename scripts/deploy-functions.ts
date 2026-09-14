import "dotenv/config";
import { join, resolve } from "node:path";
import { identity, issuer } from "../server/identity.ts";

export async function deployFunctions(
  env: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const target =
    env.CONVEX_SELF_HOSTED_URL ?? Deno.env.get("CONVEX_SELF_HOSTED_URL");
  const admin =
    env.CONVEX_SELF_HOSTED_ADMIN_KEY ??
    Deno.env.get("CONVEX_SELF_HOSTED_ADMIN_KEY");
  if (!target || !admin)
    throw new Error(
      "Set CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY for your own instance.",
    );
  const root = Deno.cwd();
  const scratch = await Deno.makeTempDir({
    dir: "/var/tmp",
    prefix: "arura-functions-",
  });
  async function copy(source: string, destination: string) {
    await Deno.mkdir(destination, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      const from = join(source, entry.name),
        to = join(destination, entry.name);
      if (entry.isDirectory) await copy(from, to);
      else if (entry.isFile) await Deno.copyFile(from, to);
    }
  }
  try {
    for (const name of ["convex", "shared"])
      await copy(name, join(scratch, name));
    for (const name of ["package.json", "deno.json", "deno.lock"])
      await Deno.copyFile(name, join(scratch, name));
    await Deno.symlink(
      resolve(root, "node_modules"),
      join(scratch, "node_modules"),
    );
    const keys = await identity();
    const auth = join(scratch, "auth.env");
    await Deno.writeTextFile(
      auth,
      `ARURA_AUTH_ISSUER=${issuer}\nARURA_JWKS=data:application/json;base64,${btoa(JSON.stringify(keys.jwks))}\n`,
      { mode: 0o600 },
    );
    for (const args of [
      ["env", "set", "--from-file", auth],
      ["dev", "--once", "--typecheck", "disable", "--codegen", "disable"],
    ]) {
      signal?.throwIfAborted();
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "npm:convex", ...args],
        cwd: scratch,
        env: {
          ...env,
          CONVEX_SELF_HOSTED_URL: target,
          CONVEX_SELF_HOSTED_ADMIN_KEY: admin,
        },
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      const abort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* Already stopped. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (!(await child.status).success)
          throw new Error("Convex function deployment failed");
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

if (Reflect.get(import.meta, "main")) await deployFunctions();
