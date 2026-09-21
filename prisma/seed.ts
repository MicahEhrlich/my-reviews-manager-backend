import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const agencyId = 'agency_local_revu';
await db.agency.upsert({ where: { id: agencyId }, update: { name: 'Revu סוכנות דיגיטל' }, create: { id: agencyId, name: 'Revu סוכנות דיגיטל' } });
await db.user.upsert({ where: { email: 'admin@revu.local' }, update: { agencyId, displayName: 'מנהל מקומי', role: 'ADMIN', isActive: true }, create: { id: 'user_local_admin', agencyId, email: 'admin@revu.local', displayName: 'מנהל מקומי', role: 'ADMIN' } });
await db.user.upsert({ where: { email: 'member@revu.local' }, update: { agencyId, displayName: 'חברת צוות', role: 'MEMBER', isActive: true }, create: { id: 'user_local_member', agencyId, email: 'member@revu.local', displayName: 'חברת צוות', role: 'MEMBER' } });
const account = await db.account.upsert({ where: { googleAccountId: 'mock-account-001' }, update: { agencyId, googleEmail: 'business@revu.local', status: 'CONNECTED' }, create: { id: 'account_local_google', agencyId, googleAccountId: 'mock-account-001', googleEmail: 'business@revu.local', status: 'CONNECTED' } });
const locations = [
  { id: 'eli', googleLocationId: 'mock-location-eli', displayName: 'מספרת אלי', businessCategory: 'מספרה', defaultTone: 'WARM_PERSONAL' as const, whatsappAlertNumber: '+972501111111' },
  { id: 'lock', googleLocationId: 'mock-location-lock', displayName: 'מנעולן אקספרס', businessCategory: 'מנעולן', defaultTone: 'PROFESSIONAL' as const, whatsappAlertNumber: '+972502222222' },
  { id: 'nona', googleLocationId: 'mock-location-nona', displayName: 'מסעדת נונה', businessCategory: 'מסעדה', defaultTone: 'SHORT_DIRECT' as const, whatsappAlertNumber: '+972503333333' },
];
for (const location of locations) await db.location.upsert({ where: { googleLocationId: location.googleLocationId }, update: { ...location, accountId: account.id }, create: { ...location, accountId: account.id, autoReplyEnabled: true } });

const reviews = [
  { id: 'review_eli_5', locationId: 'eli', googleReviewId: 'google-review-eli-5', reviewerName: 'נועה לוי', starRating: 5, comment: 'אלי מקצועי, נעים והתספורת יצאה בדיוק כמו שרציתי.', aiDraftReply: 'נועה, תודה רבה! שמחנו שאהבת את התוצאה ונשמח לראותך שוב.', publishedReply: 'נועה, תודה רבה! שמחנו שאהבת את התוצאה ונשמח לראותך שוב.', status: 'AUTO_SENT' as const },
  { id: 'review_eli_3', locationId: 'eli', googleReviewId: 'google-review-eli-3', reviewerName: 'דניאל כהן', starRating: 3, comment: 'התספורת טובה אבל חיכיתי כמעט חצי שעה.', aiDraftReply: 'דניאל, תודה על המשוב. מצטערים על ההמתנה ונפעל לשפר את ניהול התורים.', status: 'PENDING_APPROVAL' as const },
  { id: 'review_lock_1', locationId: 'lock', googleReviewId: 'google-review-lock-1', reviewerName: 'מיכל אברהם', starRating: 1, comment: 'המחיר היה גבוה ממה שנאמר לי בטלפון.', aiDraftReply: 'מיכל, אנו מצטערים לשמוע. נשמח לבדוק את פרטי הקריאה והמחיר ישירות מולך.', status: 'PENDING_APPROVAL' as const },
  { id: 'review_lock_4', locationId: 'lock', googleReviewId: 'google-review-lock-4', reviewerName: 'יוסי מזרחי', starRating: 4, comment: 'הגיע מהר ופתח את הדלת בלי נזק.', aiDraftReply: 'יוסי, תודה שהקדשת זמן לכתוב לנו. שמחנו לעזור במהירות.', publishedReply: 'יוסי, תודה שהקדשת זמן לכתוב לנו. שמחנו לעזור במהירות.', status: 'AUTO_SENT' as const },
  { id: 'review_nona_5', locationId: 'nona', googleReviewId: 'google-review-nona-5', reviewerName: 'רוני אשכנזי', starRating: 5, comment: 'אוכל נהדר, שירות מקסים ואווירה מעולה.', aiDraftReply: 'רוני, תודה על המשוב. נשמח לארח אותך שוב.', publishedReply: 'רוני, תודה על המשוב. נשמח לארח אותך שוב.', status: 'APPROVED' as const },
  { id: 'review_nona_3', locationId: 'nona', googleReviewId: 'google-review-nona-3', reviewerName: 'אורי בר', starRating: 3, comment: 'האוכל טעים אבל המנות הגיעו לאט.', aiDraftReply: 'אורי, תודה על המשוב. מצטערים על ההמתנה ונבדוק כיצד להשתפר.', status: 'PENDING_APPROVAL' as const },
];
const base = new Date('2026-09-01T10:00:00.000Z');
for (const [index, review] of reviews.entries()) await db.review.upsert({ where: { googleReviewId: review.googleReviewId }, update: review, create: { ...review, googleCreatedAt: new Date(base.getTime() + index * 86_400_000), googleUpdatedAt: new Date(base.getTime() + index * 86_400_000), processedAt: new Date(base.getTime() + index * 86_400_000) } });
await db.localPost.upsert({ where: { id: 'post_eli_active' }, update: {}, create: { id: 'post_eli_active', locationId: 'eli', googlePostId: 'mock-existing-post', topicType: 'STANDARD', summaryText: 'נפתחו תורים חדשים לשבוע הקרוב — מוזמנים לקבוע.', isRecurring: true, frequencyDays: 6, nextPublishAt: new Date('2026-09-25T03:00:00.000Z'), lastPublishedAt: new Date('2026-09-19T03:00:00.000Z'), status: 'ACTIVE' } });
await db.localPost.upsert({ where: { id: 'post_nona_offer' }, update: {}, create: { id: 'post_nona_offer', locationId: 'nona', topicType: 'OFFER', summaryText: 'ארוחה עסקית חדשה בימים א׳–ה׳.', structuredPayload: { offer: { termsConditions: 'בהזמנה מראש' } }, isRecurring: false, frequencyDays: 6, nextPublishAt: new Date('2026-09-20T09:00:00.000Z'), status: 'SCHEDULED' } });
console.log('Seeded deterministic Revu agency, users, locations, reviews, and posts.');
await db.$disconnect();
