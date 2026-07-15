import { extname } from "node:path";
import type { Config } from "./config.js";
import type { SelectExcludeType, SelectIncludeType, SelectType } from "./select.js";
import { SCHEMA_CONTRACT_VERSION, type SchemaResponse } from "./schema-contract.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function mimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

type RemoteConfig = Config & { payloadUrl: string; apiKey: string };

export interface PaginatedResponse<T = Record<string, unknown>> {
  docs: T[];
  totalDocs: number;
  limit: number;
  totalPages: number;
  page: number;
  hasNextPage: boolean;
  nextPage: number | null;
}

export class PayloadApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public responseBody: string,
  ) {
    super(`Payload API error ${status} on ${path}: ${responseBody}`);
    this.name = "PayloadApiError";
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

// Hotfix for payloadcms/payload#16670: when ?select projects filename/
// mimeType/sizes out of the response doc, plugin-cloud-storage's
// afterChange hook (which reads those keys from the projected doc) silently
// skips the S3 upload. Until that lands upstream, keep those keys in the
// select for any upload-bound request. The filesize key is included for
// symmetry with the variants the hook also needs.
const CLOUD_STORAGE_REQUIRED_SELECT_KEYS = ["filename", "mimeType", "filesize", "sizes"] as const;

function preserveUploadFieldsInSelect(select: SelectType | undefined): SelectType | undefined {
  if (!select) return select;
  const values = Object.values(select);
  const isExcludeMode = values.length > 0 && values.every((v) => v === false);

  if (isExcludeMode) {
    const next: Record<string, false | SelectExcludeType> = {};
    for (const [key, value] of Object.entries(select)) {
      if ((CLOUD_STORAGE_REQUIRED_SELECT_KEYS as readonly string[]).includes(key)) continue;
      next[key] = value as false | SelectExcludeType;
    }
    return next as SelectType;
  }

  const next: Record<string, true | SelectIncludeType> = {
    ...(select as Record<string, true | SelectIncludeType>),
  };
  for (const key of CLOUD_STORAGE_REQUIRED_SELECT_KEYS) {
    if (next[key] === undefined) next[key] = true;
  }
  return next as SelectType;
}

function flattenToQueryParams(prefix: string, obj: unknown): Record<string, string> {
  const params: Record<string, string> = {};
  if (obj === null || obj === undefined) return params;
  if (typeof obj !== "object") {
    params[prefix] = String(obj);
    return params;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    Object.assign(params, flattenToQueryParams(`${prefix}[${key}]`, value));
  }
  return params;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Network error codes where the request never reached the server, so
// retrying can't duplicate a mutation.
const NEVER_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

function requestNeverSent(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return typeof cause?.code === "string" && NEVER_SENT_CODES.has(cause.code);
}

export class PayloadClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: RemoteConfig) {
    this.baseUrl = `${config.payloadUrl.replace(/\/$/, "")}/api`;
    this.headers = {
      Authorization: `${config.authCollection} API-Key ${config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    path: string,
    options?: {
      params?: Record<string, string>;
      method?: string;
      body?: unknown;
      formData?: FormData;
    },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    const method = options?.method ?? "GET";
    // Mutations are only retried when we know they were not applied: the
    // connection was never established, or the server rejected with 429
    // before executing. A GET can always be retried.
    const isIdempotent = method === "GET";
    let lastError: PayloadApiError | Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      try {
        let fetchBody: string | FormData | undefined;
        const headers = { ...this.headers };
        if (options?.formData) {
          fetchBody = options.formData;
          delete headers["Content-Type"];
        } else if (options?.body) {
          fetchBody = JSON.stringify(options.body);
        }

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: fetchBody,
        });

        if (!response.ok) {
          const body = await response.text();
          const apiError = new PayloadApiError(response.status, path, body);

          const retryStatus = isIdempotent ? apiError.isRetryable : apiError.status === 429;
          if (retryStatus && attempt < MAX_RETRIES) {
            lastError = apiError;
            continue;
          }

          throw apiError;
        }

        return response.json() as Promise<T>;
      } catch (err) {
        if (err instanceof PayloadApiError) throw err;

        // Network errors — retry, unless a mutation may already have been
        // applied (the request could have reached the server).
        if (attempt < MAX_RETRIES && (isIdempotent || requestNeverSent(err))) {
          lastError = err as Error;
          continue;
        }

        const msg = (err as Error).message;
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
          throw new Error(`Cannot connect to Payload at ${this.baseUrl}. Is the server running?`);
        }
        throw err;
      }
    }

    throw lastError ?? new Error("Unexpected retry exhaustion");
  }

  private addCommonParams(
    params: Record<string, string>,
    options?: {
      depth?: number;
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      select?: SelectType;
      populate?: Record<string, unknown>;
      joins?: Record<string, unknown>;
      trash?: boolean;
    },
  ): void {
    if (!options) return;
    if (options.draft) params.draft = "true";
    if (options.depth !== undefined) params.depth = String(options.depth);
    if (options.locale !== undefined) params.locale = options.locale;
    if (options.fallbackLocale !== undefined) params["fallback-locale"] = options.fallbackLocale;
    if (options.trash) params.trash = "true";
    if (options.select) {
      Object.assign(params, flattenToQueryParams("select", options.select));
    }
    if (options.populate) {
      Object.assign(params, flattenToQueryParams("populate", options.populate));
    }
    if (options.joins) {
      Object.assign(params, flattenToQueryParams("joins", options.joins));
    }
  }

  private addPaginationParams(
    params: Record<string, string>,
    options?: {
      limit?: number;
      page?: number;
      sort?: string;
      pagination?: boolean;
      where?: Record<string, unknown>;
    },
  ): void {
    if (!options) return;
    if (options.limit !== undefined) params.limit = String(options.limit);
    if (options.page !== undefined) params.page = String(options.page);
    if (options.sort !== undefined) params.sort = options.sort;
    if (options.pagination === false) params.pagination = "false";
    if (options.where) {
      Object.assign(params, flattenToQueryParams("where", options.where));
    }
  }

  private addPublishParams(
    params: Record<string, string>,
    options?: {
      autosave?: boolean;
      publishSpecificLocale?: string;
      publishAllLocales?: boolean;
      unpublishAllLocales?: boolean;
    },
  ): void {
    if (!options) return;
    if (options.autosave) params.autosave = "true";
    if (options.publishSpecificLocale) params.publishSpecificLocale = options.publishSpecificLocale;
    if (options.publishAllLocales) params.publishAllLocales = "true";
    if (options.unpublishAllLocales) params.unpublishAllLocales = "true";
  }

  async rawGet(apiPath: string): Promise<unknown> {
    return this.request<unknown>(`/${apiPath.replace(/^\//, "")}`);
  }

  async rawPost(apiPath: string, body: unknown): Promise<unknown> {
    return this.request<unknown>(`/${apiPath.replace(/^\//, "")}`, {
      method: "POST",
      body,
    });
  }

  async rawPatch(apiPath: string, body: unknown): Promise<unknown> {
    return this.request<unknown>(`/${apiPath.replace(/^\//, "")}`, {
      method: "PATCH",
      body,
    });
  }

  async rawDelete(apiPath: string): Promise<unknown> {
    return this.request<unknown>(`/${apiPath.replace(/^\//, "")}`, {
      method: "DELETE",
    });
  }

  async deleteDoc(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      overrideLock?: boolean;
      trash?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    if (options?.overrideLock !== undefined) params.overrideLock = String(options.overrideLock);
    return this.request<Record<string, unknown>>(`/${slug}/${id}`, {
      method: "DELETE",
      params,
    });
  }

  async deleteDocs(
    slug: string,
    where: Record<string, unknown>,
    options?: {
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      overrideLock?: boolean;
      trash?: boolean;
    },
  ): Promise<unknown> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    if (options?.overrideLock !== undefined) params.overrideLock = String(options.overrideLock);
    Object.assign(params, flattenToQueryParams("where", where));
    return this.request<unknown>(`/${slug}`, {
      method: "DELETE",
      params,
    });
  }

  async countDocs(
    slug: string,
    where?: Record<string, unknown>,
    options?: { trash?: boolean },
  ): Promise<number> {
    const params: Record<string, string> = { limit: "0" };
    if (options?.trash) params.trash = "true";
    if (where) Object.assign(params, flattenToQueryParams("where", where));
    const result = await this.request<PaginatedResponse>(`/${slug}`, {
      params,
    });
    return result.totalDocs;
  }

  async getMe(authCollection: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.request<{
        user: Record<string, unknown> | null;
      }>(`/${authCollection}/me`);
      return result.user;
    } catch (err) {
      if (err instanceof PayloadApiError && err.isNotFound) {
        throw new Error(
          `Auth collection "${authCollection}" not found at ${this.baseUrl}/${authCollection}/me.\n\n` +
            `Set PAYLOAD_AUTH_COLLECTION to the slug of your auth-enabled collection (default: "api-keys").`,
        );
      }
      throw err;
    }
  }

  async getAccess(): Promise<{
    collections: string[];
    globals: string[];
  }> {
    const INTERNAL_COLLECTIONS = new Set([
      "payload-locked-documents",
      "payload-preferences",
      "payload-migrations",
    ]);

    const data = await this.request<{
      collections?: Record<string, { read?: boolean }>;
      globals?: Record<string, { read?: boolean }>;
    }>("/access");

    // Only include collections/globals where read is explicitly true.
    // Payload lists auth collections (users, api-keys) even when the key
    // can only authenticate — those have fields but no read: true.
    const collections = Object.entries(data.collections ?? {})
      .filter(([slug, perms]) => perms.read === true && !INTERNAL_COLLECTIONS.has(slug))
      .map(([slug]) => slug);

    const globals = Object.entries(data.globals ?? {})
      .filter(([, perms]) => perms.read === true)
      .map(([slug]) => slug);

    return { collections, globals };
  }

  async getSchema(): Promise<SchemaResponse | null> {
    try {
      const schema = await this.request<SchemaResponse>("/content-cli/schema");
      if (schema.version !== SCHEMA_CONTRACT_VERSION) {
        console.warn(
          `Warning: the installed content-cli plugin speaks schema contract version ${schema.version ?? "<none>"}, ` +
            `but this CLI expects version ${SCHEMA_CONTRACT_VERSION}. ` +
            `Update ${schema.version === undefined || (schema.version ?? 0) < SCHEMA_CONTRACT_VERSION ? "the plugin" : "the CLI"} to the matching release — schema metadata may be incomplete.`,
        );
      }
      return schema;
    } catch (err) {
      if (err instanceof PayloadApiError && err.isNotFound) {
        return null;
      }
      throw err;
    }
  }

  async getCollectionDocs(
    slug: string,
    options?: {
      limit?: number;
      page?: number;
      depth?: number;
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      where?: Record<string, unknown>;
      sort?: string;
      select?: SelectType;
      populate?: Record<string, unknown>;
      joins?: Record<string, unknown>;
      pagination?: boolean;
      trash?: boolean;
    },
  ): Promise<PaginatedResponse> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    this.addPaginationParams(params, options);

    return this.request<PaginatedResponse>(`/${slug}`, { params });
  }

  async getAllCollectionDocs(
    slug: string,
    options?: {
      depth?: number;
      pageSize?: number;
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      where?: Record<string, unknown>;
      joins?: Record<string, unknown>;
      populate?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>[]> {
    const pageSize = options?.pageSize ?? 100;
    const allDocs: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getCollectionDocs(slug, {
        limit: pageSize,
        page,
        depth: options?.depth,
        locale: options?.locale,
        fallbackLocale: options?.fallbackLocale,
        draft: options?.draft,
        where: options?.where,
        joins: options?.joins,
        populate: options?.populate,
      });
      allDocs.push(...response.docs);
      hasMore = response.hasNextPage;
      page++;
    }

    return allDocs;
  }

  async getGlobal(
    slug: string,
    options?: {
      depth?: number;
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      select?: SelectType;
      populate?: Record<string, unknown>;
      joins?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);

    return this.request<Record<string, unknown>>(`/globals/${slug}`, {
      params,
    });
  }

  async getDoc(
    slug: string,
    id: string,
    options?: {
      draft?: boolean;
      locale?: string;
      fallbackLocale?: string;
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      joins?: Record<string, unknown>;
      trash?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    return this.request<Record<string, unknown>>(`/${slug}/${id}`, { params });
  }

  async createDoc(
    slug: string,
    data: Record<string, unknown>,
    options?: {
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      autosave?: boolean;
      publishSpecificLocale?: string;
      publishAllLocales?: boolean;
      /** Set when `data` triggers a server-side file fetch (url + filename) so
       *  upload-required keys are preserved in `select`. */
      uploadFromUrl?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, {
      ...options,
      select: options?.uploadFromUrl
        ? preserveUploadFieldsInSelect(options?.select)
        : options?.select,
    });
    this.addPublishParams(params, options);
    const body = options?.draft ? { ...data, _status: "draft" } : data;
    const result = await this.request<{ doc: Record<string, unknown> }>(`/${slug}`, {
      method: "POST",
      body,
      params,
    });
    return result.doc;
  }

  async uploadDoc(
    slug: string,
    file: { data: Uint8Array | Blob; filename: string },
    data?: Record<string, unknown>,
    options?: {
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      autosave?: boolean;
      publishSpecificLocale?: string;
      publishAllLocales?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, {
      ...options,
      select: preserveUploadFieldsInSelect(options?.select),
    });
    this.addPublishParams(params, options);

    const formData = new FormData();
    const blob =
      file.data instanceof Blob
        ? file.data
        : new Blob([new Uint8Array(file.data)], {
            type: mimeFromFilename(file.filename),
          });
    formData.append("file", blob, file.filename);

    const docData = options?.draft ? { ...data, _status: "draft" } : data;
    if (docData && Object.keys(docData).length > 0) {
      formData.append("_payload", JSON.stringify(docData));
    }

    const result = await this.request<{ doc: Record<string, unknown> }>(`/${slug}`, {
      method: "POST",
      formData,
      params,
    });
    return result.doc;
  }

  async updateDoc(
    slug: string,
    id: string,
    data: Record<string, unknown>,
    options?: {
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      trash?: boolean;
      autosave?: boolean;
      overrideLock?: boolean;
      publishSpecificLocale?: string;
      publishAllLocales?: boolean;
      unpublishAllLocales?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    this.addPublishParams(params, options);
    if (options?.overrideLock !== undefined) params.overrideLock = String(options.overrideLock);
    const body = options?.draft ? { ...data, _status: "draft" } : data;
    const result = await this.request<{ doc: Record<string, unknown> }>(`/${slug}/${id}`, {
      method: "PATCH",
      body,
      params,
    });
    return result.doc;
  }

  async getVersions(
    slug: string,
    options?: {
      where?: Record<string, unknown>;
      limit?: number;
      page?: number;
      sort?: string;
      depth?: number;
      locale?: string;
      fallbackLocale?: string;
      select?: SelectType;
      populate?: Record<string, unknown>;
      pagination?: boolean;
      trash?: boolean;
    },
  ): Promise<PaginatedResponse> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    this.addPaginationParams(params, options);
    return this.request<PaginatedResponse>(`/${slug}/versions`, { params });
  }

  async getVersion(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      trash?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    return this.request<Record<string, unknown>>(`/${slug}/versions/${id}`, {
      params,
    });
  }

  async restoreVersion(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      draft?: boolean;
      populate?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    if (options?.depth !== undefined) params.depth = String(options.depth);
    if (options?.draft) params.draft = "true";
    if (options?.populate) {
      Object.assign(params, flattenToQueryParams("populate", options.populate));
    }
    return this.request<Record<string, unknown>>(`/${slug}/versions/${id}`, {
      method: "POST",
      params,
    });
  }

  async getGlobalVersions(
    slug: string,
    options?: {
      where?: Record<string, unknown>;
      limit?: number;
      page?: number;
      sort?: string;
      depth?: number;
      locale?: string;
      fallbackLocale?: string;
      select?: SelectType;
      populate?: Record<string, unknown>;
      pagination?: boolean;
    },
  ): Promise<PaginatedResponse> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    this.addPaginationParams(params, options);
    return this.request<PaginatedResponse>(`/globals/${slug}/versions`, {
      params,
    });
  }

  async getGlobalVersion(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    return this.request<Record<string, unknown>>(`/globals/${slug}/versions/${id}`, { params });
  }

  async restoreGlobalVersion(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      draft?: boolean;
      populate?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    if (options?.depth !== undefined) params.depth = String(options.depth);
    if (options?.draft) params.draft = "true";
    if (options?.populate) {
      Object.assign(params, flattenToQueryParams("populate", options.populate));
    }
    return this.request<Record<string, unknown>>(`/globals/${slug}/versions/${id}`, {
      method: "POST",
      params,
    });
  }

  async duplicateDoc(
    slug: string,
    id: string,
    options?: {
      depth?: number;
      draft?: boolean;
      select?: SelectType;
      populate?: Record<string, unknown>;
      locale?: string;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    if (options?.draft !== undefined) params.draft = String(options.draft);
    const result = await this.request<{ doc: Record<string, unknown> }>(
      `/${slug}/${id}/duplicate`,
      { method: "POST", params },
    );
    return result.doc;
  }

  async updateGlobal(
    slug: string,
    data: Record<string, unknown>,
    options?: {
      locale?: string;
      fallbackLocale?: string;
      draft?: boolean;
      depth?: number;
      select?: SelectType;
      populate?: Record<string, unknown>;
      autosave?: boolean;
      publishSpecificLocale?: string;
      publishAllLocales?: boolean;
      unpublishAllLocales?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    this.addCommonParams(params, options);
    this.addPublishParams(params, options);
    const body = options?.draft ? { ...data, _status: "draft" } : data;
    return this.request<Record<string, unknown>>(`/globals/${slug}`, {
      method: "POST",
      body,
      params,
    });
  }
}
