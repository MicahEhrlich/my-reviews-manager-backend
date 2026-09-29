import Anthropic from '@anthropic-ai/sdk';
import { OAuth2Client } from 'google-auth-library';
import type { Account, PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { decryptToken, encryptToken, parseKeyRing } from '../lib/encryption.js';
import { ProviderError } from '../lib/errors.js';
import { buildHebrewPostPrompt, buildHebrewReplyPrompt } from './prompt.js';
import type { ExternalReview, GoogleBusinessProvider, NotificationInput, PostCopyGenerator, PostCopyInput, ReplyInput, ReviewReplyGenerator, WhatsAppNotifier } from './types.js';

const GOOGLE_ROOT = 'https://mybusiness.googleapis.com/v4';
function ratingValue(value: string): number { return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[value] ?? 1; }
export function buildGooglePostPayload(post: Parameters<GoogleBusinessProvider['createPost']>[2]) {
  return { languageCode: 'he', summary: post.summaryText, topicType: post.topicType, ...(post.structuredPayload && typeof post.structuredPayload === 'object' ? post.structuredPayload : {}), ...(post.imageUrl ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: post.imageUrl }] } : {}) };
}
export function buildAnthropicPostContent(input: PostCopyInput): string | Anthropic.Messages.ContentBlockParam[] {
  const prompt = buildHebrewPostPrompt(input);
  return input.imageUrl ? [{ type: 'image', source: { type: 'url', url: input.imageUrl } }, { type: 'text', text: prompt }] : prompt;
}

export class LiveGoogleProvider implements GoogleBusinessProvider {
  private ring;
  constructor(private db: PrismaClient, private config: Config) { this.ring = parseKeyRing(config.TOKEN_ENCRYPTION_KEYS); }
  private async client(account: Account) {
    const client = new OAuth2Client(this.config.GOOGLE_CLIENT_ID, this.config.GOOGLE_CLIENT_SECRET, this.config.GOOGLE_BUSINESS_REDIRECT_URI);
    client.setCredentials({ refresh_token: account.encryptedRefreshToken ? decryptToken(account.encryptedRefreshToken, this.ring) : undefined, access_token: account.encryptedAccessToken ? decryptToken(account.encryptedAccessToken, this.ring) : undefined, expiry_date: account.tokenExpiresAt?.getTime() });
    client.on('tokens', async (tokens) => { await this.db.account.update({ where: { id: account.id }, data: { encryptedAccessToken: tokens.access_token ? encryptToken(tokens.access_token, this.ring) : undefined, encryptedRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token, this.ring) : undefined, tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined } }); });
    return client;
  }
  private async request<T>(account: Account, url: string, init?: RequestInit): Promise<T> {
    try {
      const client = await this.client(account);
      const headers = await client.getRequestHeaders(url);
      const response = await fetch(url, { ...init, headers: { ...Object.fromEntries(headers), 'content-type': 'application/json', ...init?.headers } });
      if (response.status === 401 || response.status === 403) await this.db.account.update({ where: { id: account.id }, data: { status: 'REAUTH_REQUIRED' } });
      if (!response.ok) throw new ProviderError(`Google request failed (${response.status})`, response.status === 429 || response.status >= 500, `GOOGLE_${response.status}`);
      return await response.json() as T;
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError(String(error), true); }
  }
  async listReviews(account: Account, location: Parameters<GoogleBusinessProvider['listReviews']>[1]): Promise<ExternalReview[]> {
    const result: ExternalReview[] = []; let token: string | undefined;
    do {
      const suffix = token ? `?pageToken=${encodeURIComponent(token)}` : '';
      const data = await this.request<{ reviews?: Array<{ reviewId: string; reviewer?: { displayName?: string }; starRating: string; comment?: string; createTime: string; updateTime: string }>; nextPageToken?: string }>(account, `${GOOGLE_ROOT}/accounts/${account.googleAccountId}/locations/${location.googleLocationId}/reviews${suffix}`);
      for (const review of data.reviews ?? []) result.push({ googleReviewId: review.reviewId, reviewerName: review.reviewer?.displayName ?? 'לקוח Google', starRating: ratingValue(review.starRating), comment: review.comment ?? '', createdAt: new Date(review.createTime), updatedAt: new Date(review.updateTime) });
      token = data.nextPageToken;
    } while (token);
    return result;
  }
  async replyToReview(account: Account, location: Parameters<GoogleBusinessProvider['replyToReview']>[1], review: Parameters<GoogleBusinessProvider['replyToReview']>[2], reply: string) {
    await this.request(account, `${GOOGLE_ROOT}/accounts/${account.googleAccountId}/locations/${location.googleLocationId}/reviews/${review.googleReviewId}/reply`, { method: 'PUT', body: JSON.stringify({ comment: reply }) });
    return {};
  }
  async createPost(account: Account, location: Parameters<GoogleBusinessProvider['createPost']>[1], post: Parameters<GoogleBusinessProvider['createPost']>[2]) {
    const result = await this.request<{ name: string }>(account, `${GOOGLE_ROOT}/accounts/${account.googleAccountId}/locations/${location.googleLocationId}/localPosts`, { method: 'POST', body: JSON.stringify(buildGooglePostPayload(post)) });
    return { googlePostId: result.name };
  }
}

export class AnthropicPostCopyGenerator implements PostCopyGenerator {
  private client; constructor(private config: Config) { this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }); }
  async generate(input: PostCopyInput) {
    const response = await this.client.messages.create({
      model: this.config.ANTHROPIC_MODEL,
      max_tokens: 700,
      temperature: 0.5,
      messages: [{ role: 'user', content: buildAnthropicPostContent(input) }],
    });
    const text = response.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ').trim();
    if (!text) throw new ProviderError('Anthropic returned empty post copy', true, 'EMPTY_AI_POST');
    if (text.length > 1_500) throw new ProviderError('Anthropic post copy exceeded 1500 characters', true, 'AI_POST_TOO_LONG');
    return text;
  }
}

export class AnthropicReplyGenerator implements ReviewReplyGenerator {
  private client; constructor(private config: Config) { this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }); }
  async generate(input: ReplyInput) {
    const response = await this.client.messages.create({ model: this.config.ANTHROPIC_MODEL, max_tokens: 350, temperature: 0.3, messages: [{ role: 'user', content: buildHebrewReplyPrompt(input) }] });
    const text = response.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ').trim();
    if (!text) throw new ProviderError('Anthropic returned an empty reply', true, 'EMPTY_AI_REPLY');
    return text;
  }
}

export class MetaWhatsAppNotifier implements WhatsAppNotifier {
  constructor(private config: Config) {}
  async send(input: NotificationInput) {
    if (!/^\+[1-9]\d{7,14}$/.test(input.destination)) throw new ProviderError('WhatsApp destination must be E.164', false, 'INVALID_PHONE');
    const response = await fetch(`https://graph.facebook.com/${this.config.META_GRAPH_API_VERSION}/${this.config.META_WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: 'POST', headers: { authorization: `Bearer ${this.config.META_WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: input.destination, type: 'template', template: { name: this.config.META_WHATSAPP_TEMPLATE_NAME, language: { code: this.config.META_WHATSAPP_TEMPLATE_LANGUAGE }, components: [{ type: 'body', parameters: [input.locationName, input.reviewerName, String(input.rating), input.dashboardUrl].map((text) => ({ type: 'text', text })) }] } }) });
    if (!response.ok) throw new ProviderError(`Meta request failed (${response.status})`, response.status === 429 || response.status >= 500, `META_${response.status}`);
    const result = await response.json() as { messages?: Array<{ id: string }> };
    return { providerId: result.messages?.[0]?.id ?? 'unknown' };
  }
}
