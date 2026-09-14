import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
export const stateDir = resolve(process.env.ARURA_STATE_DIR || ".state");
export const issuer = process.env.ARURA_AUTH_ISSUER || "http://localhost:4100";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomSecret = () => randomBytes(32).toString("base64url");
export function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export async function identity() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = resolve(stateDir, "signing-key.json");
  let privateJwk: import("jose").JWK;
  try {
    privateJwk = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateJwk = {
      ...(await exportJWK(pair.privateKey)),
      kid: randomSecret(),
      alg: "RS256",
      use: "sig",
    };
    await writeFile(path, JSON.stringify(privateJwk), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const { d, p, q, dp, dq, qi, ...publicJwk } = privateJwk;
  const key = await importJWK(privateJwk, "RS256");
  return {
    jwks: { keys: [publicJwk] },
    sign: async (subject: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: privateJwk.kid, typ: "JWT" })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience("arura")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key),
  };
}
