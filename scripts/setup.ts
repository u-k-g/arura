import "dotenv/config";
import {
  identity,
  issuer,
  randomSecret,
  stateDir,
} from "../server/identity.ts";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const keys = await identity();
try {
  await readFile(".env");
  console.log("Existing .env retained.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  await writeFile(
    ".env",
    `ARURA_PUBLIC_URL=http://localhost:5173\nARURA_AUTH_ISSUER=${issuer}\nARURA_ACCESS_KEY=${randomSecret()}\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_PUBLIC_URL=http://localhost:3210\nHERMES_URL=http://127.0.0.1:9119\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("Created .env with a private device authorization key.");
}
await writeFile(
  join(stateDir, "convex-auth.env"),
  `ARURA_AUTH_ISSUER=${issuer}\nARURA_JWKS=data:application/json;base64,${
    Buffer.from(
      JSON.stringify(keys.jwks),
    ).toString("base64")
  }\n`,
  { mode: 0o600 },
);
console.log(
  "Signing keys ready. Configure the values from convex-auth.env in the state directory on your self-hosted Convex instance before deploying functions.",
);
