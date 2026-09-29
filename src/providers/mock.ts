import type { PrismaClient, Tone } from '@prisma/client';
import { ProviderError } from '../lib/errors.js';
import type { Config } from '../config.js';
import type { GoogleBusinessProvider, NotificationInput, PostCopyGenerator, ReplyInput, ReviewReplyGenerator, WhatsAppNotifier } from './types.js';

function maybeFail(mode: Config['MOCK_FAILURE_MODE']) {
  if (mode === 'transient') throw new ProviderError('Simulated transient provider failure', true, 'MOCK_TRANSIENT');
  if (mode === 'permanent') throw new ProviderError('Simulated permanent provider failure', false, 'MOCK_PERMANENT');
}

export class MockGoogleProvider implements GoogleBusinessProvider {
  constructor(private db: PrismaClient, private config: Config) {}
  async listReviews(_account: Parameters<GoogleBusinessProvider['listReviews']>[0], location: Parameters<GoogleBusinessProvider['listReviews']>[1]) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    const now = new Date();
    return [{ googleReviewId: `mock-sync-${location.id}`, reviewerName: 'לקוח מסונכרן', starRating: 5, comment: 'שירות מצוין ומהיר, תודה רבה!', createdAt: now, updatedAt: now }];
  }
  async replyToReview(_account: Parameters<GoogleBusinessProvider['replyToReview']>[0], _location: Parameters<GoogleBusinessProvider['replyToReview']>[1], review: Parameters<GoogleBusinessProvider['replyToReview']>[2], reply: string) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    await this.db.providerEvent.create({ data: { provider: 'mock-google', action: 'review.reply', resourceId: review.googleReviewId, payload: { reply } } });
    return { googleReplyId: `mock-reply-${review.id}` };
  }
  async createPost(_account: Parameters<GoogleBusinessProvider['createPost']>[0], _location: Parameters<GoogleBusinessProvider['createPost']>[1], post: Parameters<GoogleBusinessProvider['createPost']>[2]) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    const googlePostId = `mock-post-${post.id}-${Date.now()}`;
    await this.db.providerEvent.create({ data: { provider: 'mock-google', action: 'post.create', resourceId: googlePostId, payload: { text: post.summaryText, imageUrl: post.imageUrl ?? null } } });
    return { googlePostId };
  }
}

export class MockPostCopyGenerator implements PostCopyGenerator {
  constructor(private config: Config) {}
  async generate(input: Parameters<PostCopyGenerator['generate']>[0]) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    return input.brief ? `חדש אצל ${input.businessName}: ${input.brief}` : `רגע חדש ומיוחד אצל ${input.businessName} — מוזמנים לבקר אותנו.`;
  }
}

const intros: Record<Tone, string> = {
  WARM_PERSONAL: 'תודה רבה על השיתוף',
  PROFESSIONAL: 'תודה שהקדשת זמן לכתוב לנו',
  SHORT_DIRECT: 'תודה על המשוב',
};
export class MockReplyGenerator implements ReviewReplyGenerator {
  constructor(private config: Config) {}
  async generate(input: ReplyInput) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    const ending = input.rating >= 4 ? 'שמחנו לשמוע שנהנית ונשמח לראותך שוב.' : 'אנו מצטערים שזו הייתה החוויה ונשמח לבדוק את הנושא ישירות מולך.';
    return `${intros[input.tone]}. ${ending}`;
  }
}

export class MockWhatsAppNotifier implements WhatsAppNotifier {
  constructor(private db: PrismaClient, private config: Config) {}
  async send(input: NotificationInput) {
    maybeFail(this.config.MOCK_FAILURE_MODE);
    const providerId = `mock-wa-${input.reviewId}`;
    await this.db.notificationLog.create({ data: { locationId: input.locationId, reviewId: input.reviewId, destination: input.destination, templateName: this.config.META_WHATSAPP_TEMPLATE_NAME, payload: { ...input }, status: 'SENT', providerId, sentAt: new Date() } });
    return { providerId };
  }
}
