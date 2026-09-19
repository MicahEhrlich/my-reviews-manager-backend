import type { Account, LocalPost, Location, Review, Tone } from '@prisma/client';

export interface ExternalReview {
  googleReviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface GoogleBusinessProvider {
  listReviews(account: Account, location: Location): Promise<ExternalReview[]>;
  replyToReview(account: Account, location: Location, review: Review, reply: string): Promise<{ googleReplyId?: string }>;
  createPost(account: Account, location: Location, post: LocalPost): Promise<{ googlePostId: string }>;
}
export interface ReplyInput { businessName: string; businessCategory: string; reviewerName: string; rating: number; reviewText: string; tone: Tone }
export interface ReviewReplyGenerator { generate(input: ReplyInput): Promise<string> }
export interface NotificationInput { locationId: string; reviewId: string; destination: string; locationName: string; reviewerName: string; rating: number; dashboardUrl: string }
export interface WhatsAppNotifier { send(input: NotificationInput): Promise<{ providerId: string }> }
export interface Providers { google: GoogleBusinessProvider; replies: ReviewReplyGenerator; whatsapp: WhatsAppNotifier }
