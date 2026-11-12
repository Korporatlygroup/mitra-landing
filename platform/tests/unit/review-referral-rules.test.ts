import { describe, expect, it } from 'vitest';
import { canSubmitReview, mayShareReferralDetails } from '@/server/services/review-referral-rules';

describe('review eligibility', () => {
  const eligible = { buyerOrgId: 'buyer', sellerOrgId: 'seller', authorOrgId: 'buyer', hasRecordedExchange: true, existingReviewId: null, enquiryClosedOrInteracted: true };
  it('requires a distinct buyer with recorded interaction and no previous review', () => {
    expect(canSubmitReview(eligible)).toBe(true);
    expect(canSubmitReview({ ...eligible, authorOrgId: 'seller' })).toBe(false);
    expect(canSubmitReview({ ...eligible, hasRecordedExchange: false })).toBe(false);
    expect(canSubmitReview({ ...eligible, existingReviewId: 'old' })).toBe(false);
    expect(canSubmitReview({ ...eligible, sellerOrgId: 'buyer' })).toBe(false);
  });
});

describe('referral disclosure', () => {
  const approved = { referrerOrgId: 'seller-a', proposedSellerOrgId: 'seller-b', buyerOrgId: 'buyer', proposedSellerPublished: true, buyerConsented: true, recipientAccepted: true };
  it('requires both permissions and a distinct published recipient', () => {
    expect(mayShareReferralDetails(approved)).toBe(true);
    expect(mayShareReferralDetails({ ...approved, buyerConsented: false })).toBe(false);
    expect(mayShareReferralDetails({ ...approved, recipientAccepted: false })).toBe(false);
    expect(mayShareReferralDetails({ ...approved, proposedSellerPublished: false })).toBe(false);
    expect(mayShareReferralDetails({ ...approved, proposedSellerOrgId: 'seller-a' })).toBe(false);
  });
});
