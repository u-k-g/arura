export default {
  providers: [
    {
      type: "customJwt" as const,
      applicationID: "arura",
      issuer: process.env.ARURA_AUTH_ISSUER!,
      jwks: process.env.ARURA_JWKS!,
      algorithm: "RS256" as const,
    },
  ],
};
