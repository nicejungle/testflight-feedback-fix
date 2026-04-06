import { createPrivateKey, sign } from 'node:crypto';

import { z } from 'zod';

const defaultBaseUrl = 'https://api.appstoreconnect.apple.com/v1';
const tokenLifetimeSeconds = 15 * 60;
const createdAtKeys = ['submittedDate', 'createdDate', 'lastModifiedDate'] as const;
const titleKeys = ['title', 'headline', 'subject'] as const;
const bodyKeys = ['feedbackText', 'comment', 'body', 'text', 'message', 'description', 'notes'] as const;

const appStoreConnectEnvSchema = z.object({
  ASC_KEY_ID: z.string().trim().min(1),
  ASC_ISSUER_ID: z.string().trim().min(1),
  ASC_PRIVATE_KEY: z.string().trim().min(1),
  ASC_APP_ID: z.string().trim().regex(/^\d+$/),
  ASC_API_BASE_URL: z.string().trim().url().optional()
});

export type FeedbackSource = 'customerReview' | 'betaFeedbackScreenshot' | 'betaFeedbackCrash';

export type AppStoreConnectResourceAttributes = Record<string, unknown>;

export type AppStoreConnectDocument<T extends AppStoreConnectResourceAttributes = AppStoreConnectResourceAttributes> =
  {
    id: string;
    type: string;
    attributes?: T | null;
  };

type AppStoreConnectCollectionResponse<
  T extends AppStoreConnectResourceAttributes = AppStoreConnectResourceAttributes
> = {
  data: AppStoreConnectDocument<T>[];
  links?: {
    self?: string;
    next?: string;
    first?: string;
  };
  meta?: Record<string, unknown>;
};

export type AppStoreConnectEnv = {
  keyId: string;
  issuerId: string;
  privateKey: string;
  appId: string;
  baseUrl: string;
};

export type CustomerReviewSummaryItem = {
  id: string;
  source: 'customerReview';
  createdAt: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  reviewerNickname: string | null;
  summary: string | null;
  rawAttributes: AppStoreConnectResourceAttributes;
};

export type BetaFeedbackSummaryItem = {
  id: string;
  source: 'betaFeedbackScreenshot' | 'betaFeedbackCrash';
  createdAt: string | null;
  summary: string | null;
  rawAttributes: AppStoreConnectResourceAttributes;
};

export type AppStoreFeedbackItem = CustomerReviewSummaryItem | BetaFeedbackSummaryItem;

export type AppStoreFeedbackSummary = {
  fetchedAt: string;
  appId: string;
  customerReviews: CustomerReviewSummaryItem[];
  betaFeedbackScreenshots: BetaFeedbackSummaryItem[];
  betaFeedbackCrashes: BetaFeedbackSummaryItem[];
  combined: AppStoreFeedbackItem[];
};

type FetchImplementation = typeof fetch;

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function asAttributes(value: unknown): AppStoreConnectResourceAttributes {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as AppStoreConnectResourceAttributes;
}

function getString(attributes: AppStoreConnectResourceAttributes, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return null;
}

function getNumber(attributes: AppStoreConnectResourceAttributes, key: string): number | null {
  const value = attributes[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function extractCreatedAt(attributes: AppStoreConnectResourceAttributes): string | null {
  return getString(attributes, createdAtKeys);
}

function extractSummary(attributes: AppStoreConnectResourceAttributes): string | null {
  const parts: string[] = [];

  for (const key of [...titleKeys, ...bodyKeys]) {
    const value = attributes[key];
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value.trim();
    if (normalized.length === 0 || parts.includes(normalized)) {
      continue;
    }

    parts.push(normalized);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function compareByCreatedAtDesc(left: { createdAt: string | null }, right: { createdAt: string | null }): number {
  const leftValue = left.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
  const rightValue = right.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;

  return rightValue - leftValue;
}

function buildCollectionUrl(baseUrl: string, path: string, limit: number): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path}`);
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

function buildAbsoluteUrl(baseUrl: string, url: string): string {
  return new URL(url, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

async function parseCollectionResponse<T extends AppStoreConnectResourceAttributes>(
  response: Response
): Promise<AppStoreConnectCollectionResponse<T>> {
  if (response.ok) {
    return (await response.json()) as AppStoreConnectCollectionResponse<T>;
  }

  const detail = (await response.text()).trim();
  const statusText = response.statusText || 'Request failed';
  const suffix = detail.length > 0 ? `: ${detail}` : '';
  throw new Error(`App Store Connect request failed (${response.status} ${statusText})${suffix}`);
}

function normalizeCustomerReview(document: AppStoreConnectDocument): CustomerReviewSummaryItem {
  const rawAttributes = asAttributes(document.attributes);

  return {
    id: document.id,
    source: 'customerReview',
    createdAt: extractCreatedAt(rawAttributes),
    rating: getNumber(rawAttributes, 'rating'),
    title: getString(rawAttributes, ['title']),
    body: getString(rawAttributes, ['body']),
    reviewerNickname: getString(rawAttributes, ['reviewerNickname']),
    summary: extractSummary(rawAttributes),
    rawAttributes
  };
}

function normalizeBetaFeedback(
  document: AppStoreConnectDocument,
  source: BetaFeedbackSummaryItem['source']
): BetaFeedbackSummaryItem {
  const rawAttributes = asAttributes(document.attributes);

  return {
    id: document.id,
    source,
    createdAt: extractCreatedAt(rawAttributes),
    summary: extractSummary(rawAttributes),
    rawAttributes
  };
}

export function loadAppStoreConnectEnv(env: NodeJS.ProcessEnv): AppStoreConnectEnv {
  const parsed = appStoreConnectEnvSchema.parse(env);

  return {
    keyId: parsed.ASC_KEY_ID,
    issuerId: parsed.ASC_ISSUER_ID,
    privateKey: normalizePrivateKey(parsed.ASC_PRIVATE_KEY),
    appId: parsed.ASC_APP_ID,
    baseUrl: parsed.ASC_API_BASE_URL ?? defaultBaseUrl
  };
}

export function createAppStoreConnectToken(env: AppStoreConnectEnv, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = {
    alg: 'ES256',
    kid: env.keyId,
    typ: 'JWT'
  };
  const payload = {
    iss: env.issuerId,
    aud: 'appstoreconnect-v1',
    iat: issuedAt,
    exp: issuedAt + tokenLifetimeSeconds
  };
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
    JSON.stringify(payload)
  )}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(env.privateKey),
    dsaEncoding: 'ieee-p1363'
  });

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

export function createAppStoreConnectClient(options: {
  env: AppStoreConnectEnv;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
}) {
  const { env, fetchImpl = fetch, now = () => new Date() } = options;

  async function fetchCollectionByUrl(url: string): Promise<AppStoreConnectCollectionResponse> {
    const token = createAppStoreConnectToken(env, now());
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    return parseCollectionResponse(response);
  }

  async function fetchCollection(path: string, limit: number): Promise<AppStoreConnectCollectionResponse> {
    return fetchCollectionByUrl(buildCollectionUrl(env.baseUrl, path, limit));
  }

  async function fetchAllCollection(path: string, pageSize: number): Promise<AppStoreConnectDocument[]> {
    const documents: AppStoreConnectDocument[] = [];
    let nextUrl: string | null = buildCollectionUrl(env.baseUrl, path, pageSize);

    while (nextUrl) {
      const response = await fetchCollectionByUrl(nextUrl);
      documents.push(...response.data);
      nextUrl = response.links?.next ? buildAbsoluteUrl(env.baseUrl, response.links.next) : null;
    }

    return documents;
  }

  return {
    listCustomerReviews(limit: number) {
      return fetchCollection(`apps/${env.appId}/customerReviews`, limit);
    },
    listAllCustomerReviews(pageSize: number) {
      return fetchAllCollection(`apps/${env.appId}/customerReviews`, pageSize);
    },
    listBetaFeedbackScreenshots(limit: number) {
      return fetchCollection(`apps/${env.appId}/betaFeedbackScreenshotSubmissions`, limit);
    },
    listAllBetaFeedbackScreenshots(pageSize: number) {
      return fetchAllCollection(`apps/${env.appId}/betaFeedbackScreenshotSubmissions`, pageSize);
    },
    listBetaFeedbackCrashes(limit: number) {
      return fetchCollection(`apps/${env.appId}/betaFeedbackCrashSubmissions`, limit);
    },
    listAllBetaFeedbackCrashes(pageSize: number) {
      return fetchAllCollection(`apps/${env.appId}/betaFeedbackCrashSubmissions`, pageSize);
    }
  };
}

function buildFeedbackSummary(options: {
  appId: string;
  fetchedAt: string;
  customerReviewDocuments: AppStoreConnectDocument[];
  betaFeedbackScreenshotDocuments: AppStoreConnectDocument[];
  betaFeedbackCrashDocuments: AppStoreConnectDocument[];
}): AppStoreFeedbackSummary {
  const customerReviews = options.customerReviewDocuments
    .map((document) => normalizeCustomerReview(document))
    .sort(compareByCreatedAtDesc);
  const betaFeedbackScreenshots = options.betaFeedbackScreenshotDocuments
    .map((document) => normalizeBetaFeedback(document, 'betaFeedbackScreenshot'))
    .sort(compareByCreatedAtDesc);
  const betaFeedbackCrashes = options.betaFeedbackCrashDocuments
    .map((document) => normalizeBetaFeedback(document, 'betaFeedbackCrash'))
    .sort(compareByCreatedAtDesc);

  return {
    fetchedAt: options.fetchedAt,
    appId: options.appId,
    customerReviews,
    betaFeedbackScreenshots,
    betaFeedbackCrashes,
    combined: [...customerReviews, ...betaFeedbackScreenshots, ...betaFeedbackCrashes].sort(
      compareByCreatedAtDesc
    )
  };
}

export async function fetchAppStoreFeedbackSummary(options: {
  env: AppStoreConnectEnv;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  limit?: number;
}): Promise<AppStoreFeedbackSummary> {
  const { env, fetchImpl, now = () => new Date(), limit = 10 } = options;
  const client = createAppStoreConnectClient({
    env,
    fetchImpl,
    now
  });
  const fetchedAt = now().toISOString();
  const [reviewsResponse, screenshotsResponse, crashesResponse] = await Promise.all([
    client.listCustomerReviews(limit),
    client.listBetaFeedbackScreenshots(limit),
    client.listBetaFeedbackCrashes(limit)
  ]);
  return buildFeedbackSummary({
    appId: env.appId,
    fetchedAt,
    customerReviewDocuments: reviewsResponse.data,
    betaFeedbackScreenshotDocuments: screenshotsResponse.data,
    betaFeedbackCrashDocuments: crashesResponse.data
  });
}

export async function fetchAllAppStoreFeedbackSummary(options: {
  env: AppStoreConnectEnv;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  pageSize?: number;
}): Promise<AppStoreFeedbackSummary> {
  const { env, fetchImpl, now = () => new Date(), pageSize = 200 } = options;
  const client = createAppStoreConnectClient({
    env,
    fetchImpl,
    now
  });
  const fetchedAt = now().toISOString();
  const [customerReviewDocuments, betaFeedbackScreenshotDocuments, betaFeedbackCrashDocuments] =
    await Promise.all([
      client.listAllCustomerReviews(pageSize),
      client.listAllBetaFeedbackScreenshots(pageSize),
      client.listAllBetaFeedbackCrashes(pageSize)
    ]);

  return buildFeedbackSummary({
    appId: env.appId,
    fetchedAt,
    customerReviewDocuments,
    betaFeedbackScreenshotDocuments,
    betaFeedbackCrashDocuments
  });
}
