const issuer = process.env.ARURA_AUTH_ISSUER;
const jwks = process.env.ARURA_JWKS;
if (!issuer || !jwks) {
  throw new Error(
    "Configure ARURA_AUTH_ISSUER and ARURA_JWKS before deploying authentication",
  );
}
export default {
  providers: [
    {
      type: "customJwt" as const,
      applicationID: "arura",
      issuer: issuer,
      jwks: jwks,
      algorithm: "RS256" as const,
    },
  ],
};
