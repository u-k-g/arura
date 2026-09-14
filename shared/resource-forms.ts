type RecordValue = Record<string, unknown>;

const jobFields = [
  "name",
  "prompt",
  "schedule",
  "model",
  "provider",
  "deliver",
  "deliver_chat_id",
  "skills",
  "repeat",
  "reasoning_effort",
];

export function editableJob(row: RecordValue): RecordValue {
  return Object.fromEntries(
    jobFields.filter((key) => key in row).map((key) => [key, row[key]]),
  );
}

export function jobPatch(
  values: RecordValue,
  original: RecordValue,
): RecordValue {
  return Object.fromEntries(
    Object.entries(editableJob(values)).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key]),
    ),
  );
}

export function endpointBody(values: RecordValue): RecordValue {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !((key === "api_key" || key === "id") && value === ""),
    ),
  );
}

export function pairingRows(data: {
  pending?: RecordValue[];
  approved?: RecordValue[];
}): RecordValue[] {
  return [
    ...(data?.pending ?? []).map((row) => ({
      ...row,
      accessStatus: "pending",
    })),
    ...(data?.approved ?? []).map((row) => ({
      ...row,
      accessStatus: "approved",
    })),
  ];
}

export function platformBody(values: RecordValue): RecordValue {
  const env = values.env as Record<string, string>;
  return {
    enabled: values.enabled,
    env: Object.fromEntries(
      Object.entries(env ?? {}).filter(([, value]) => value !== ""),
    ),
    clear_env: values.clear_env ?? [],
  };
}

export function mcpBody(values: RecordValue): RecordValue {
  const command = String(values.command ?? "").trim();
  const url = String(values.url ?? "").trim();
  if (Boolean(command) === Boolean(url))
    throw new Error("Choose either a host command or a server URL.");
  const name = String(values.name ?? "").trim();
  if (!name) throw new Error("Name is required");
  if (command) {
    const env = JSON.parse(String(values.env ?? "").trim() || "{}");
    if (
      !env ||
      Array.isArray(env) ||
      typeof env !== "object" ||
      Object.values(env).some((value) => typeof value !== "string")
    )
      throw new Error("Environment must be a JSON object with string values.");
    return {
      name,
      command,
      args: String(values.args ?? "")
        .split("\n")
        .filter(Boolean),
      env,
    };
  }
  const auth = String(values.auth || "none");
  if (!["none", "oauth", "header"].includes(auth))
    throw new Error("Authentication must be none, oauth, or header.");
  const bearer = String(values.bearer_token ?? "");
  if (auth === "header" && !bearer)
    throw new Error("Header authentication requires a bearer token.");
  return {
    name,
    url,
    auth,
    ...(auth === "header" ? { bearer_token: bearer } : {}),
  };
}
