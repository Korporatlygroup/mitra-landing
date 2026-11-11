/** Domain prechecks. Database constraints and scoped queries must enforce the same rules. */
export type ReviewEligibility = {
  buyerOrgId: string;
  sellerOrgId: string;
  authorOrgId: string;
  hasRecordedExchange: boolean;
  existingReviewId: string | null;
  enquiryClosedOrInteracted: boolean;
};

export function canSubmitReview(input: ReviewEligibility): boolean {
  return input.buyerOrgId !== input.sellerOrgId && input.authorOrgId === input.buyerOrgId &&
    input.hasRecordedExchange && input.enquiryClosedOrInteracted && input.existingReviewId === null;
}

export type ReferralPermission = {
  referrerOrgId: string;
  proposedSellerOrgId: string;
  buyerOrgId: string;
  proposedSellerPublished: boolean;
  buyerConsented: boolean;
  recipientAccepted: boolean;
};

export function mayShareReferralDetails(input: ReferralPermission): boolean {
  return input.referrerOrgId !== input.proposedSellerOrgId &&
    input.buyerOrgId !== input.proposedSellerOrgId &&
    input.buyerOrgId !== input.referrerOrgId &&
    input.proposedSellerPublished && input.buyerConsented && input.recipientAccepted;
}
