export class SetupError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type Credentials = {
  projectUrl: string;
  projectRef: string;
  publicKey: string;
  serviceKey: string;
  accessToken: string;
  siteUrl: string;
};
export function credentials(input: Record<string, unknown>): Credentials {
  const fields = [
    "projectUrl",
    "projectRef",
    "publicKey",
    "serviceKey",
    "accessToken",
    "siteUrl",
  ];
  if (
    !input ||
    fields.some(
      (key) =>
        typeof input[key] !== "string" ||
        !(input[key] as string).trim() ||
        (input[key] as string).length > 4096,
    ) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new SetupError(
      "credentials",
      "Provide the project connection, privileged credentials and website address.",
    );
  const value = Object.fromEntries(
    fields.map((key) => [key, (input[key] as string).trim()]),
  ) as Credentials;
  if (
    !/^[a-z]{20}$/.test(value.projectRef) ||
    value.projectUrl.replace(/\/$/, "") !==
      `https://${value.projectRef}.supabase.co`
  )
    throw new SetupError(
      "project",
      "Use the canonical HTTPS Supabase project URL matching its reference ID.",
    );
  value.projectUrl = value.projectUrl.replace(/\/$/, "");
  const role = (key: string) => {
    try {
      return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
        .role;
    } catch {
      return null;
    }
  };
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publicKey) &&
    role(value.publicKey) !== "anon"
  )
    throw new SetupError(
      "public_key",
      "The browser key must be a publishable key or an anon JWT.",
    );
  if (
    !/^sb_secret_[A-Za-z0-9_-]+$/.test(value.serviceKey) &&
    role(value.serviceKey) !== "service_role"
  )
    throw new SetupError(
      "service_key",
      "Provide a secret key or a service_role JWT for the trusted service only.",
    );
  if (value.accessToken.length < 20 || /\s/.test(value.accessToken))
    throw new SetupError(
      "token",
      "Provide a valid Supabase Management API access token.",
    );
  let site: URL;
  try {
    site = new URL(value.siteUrl);
  } catch {
    throw new SetupError("site", "Provide the website's full base URL.");
  }
  const local =
    site.hostname === "localhost" ||
    site.hostname === "127.0.0.1" ||
    site.hostname.endsWith(".local");
  if (
    !(site.protocol === "https:" || (site.protocol === "http:" && local)) ||
    site.username ||
    site.password ||
    site.search ||
    site.hash
  )
    throw new SetupError(
      "site",
      "Use an HTTPS website URL, or a local HTTP address, without credentials or a query.",
    );
  value.siteUrl = site.href.replace(/\/*$/, "/");
  return value;
}

export class Management {
  config: Credentials;
  fetcher: typeof fetch;
  constructor(config: Credentials, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }
  async request(path: string, method = "GET", body?: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: "Bearer " + this.config.accessToken,
    };
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart)
      headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.supabase.com/v1/projects/${this.config.projectRef}${path}`,
        {
          method,
          headers,
          body:
            body === undefined
              ? undefined
              : multipart
                ? body
                : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
        },
      );
    } catch {
      throw new SetupError(
        "network",
        "Supabase could not be reached. Reconnect or retry; completed steps are preserved.",
        502,
      );
    }
    // Never return provider error bodies: they can include SQL or submitted secrets.
    if (!response.ok)
      throw new SetupError(
        response.status === 403 ? "permission" : "management",
        response.status === 403
          ? "The access token lacks permission for this setup step. Check the selected project and token permissions, then retry."
          : response.status === 401
            ? "Supabase rejected the Management API access token."
            : response.status === 429
              ? "Supabase is rate limiting setup. Wait briefly and retry."
              : "Supabase rejected this setup step (HTTP " +
                response.status +
                "). Completed steps are preserved; check project health and retry.",
        response.status === 401 || response.status === 403
          ? response.status
          : 502,
      );
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new SetupError(
        "response",
        "Supabase returned an unexpected response. Retry this step.",
        502,
      );
    }
  }
  query(query: string, parameters: unknown[] = [], readOnly = false) {
    return this.request("/database/query", "POST", {
      query,
      parameters,
      read_only: readOnly,
    });
  }
}
