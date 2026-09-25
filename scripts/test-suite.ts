export {};

const entries = [];
for await (const entry of Deno.readDir("tests")) {
  if (entry.isFile && entry.name.endsWith("_test.ts")) {
    entries.push(`tests/${entry.name}`);
  }
}
entries.sort();
const browser = entries.filter(
  (path) =>
    path.startsWith("tests/browser_") &&
    (!Deno.args.length || Deno.args.includes(path)),
);
const unit = entries.filter((path) => !path.startsWith("tests/browser_"));

async function run(args: string[]) {
  const status = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success)
    throw new Error(`Test command failed: ${args.join(" ")}`);
}

if (!Deno.args.length) await run(["test", "-A", ...unit]);
for (const path of browser) {
  console.log(`Browser fixture: ${path}`);
  await run(["run", "-A", "scripts/test-stack.ts", path]);
}
