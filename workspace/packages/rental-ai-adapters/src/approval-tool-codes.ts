/** Original Rental C05 tool vocabulary. This is not an execution catalogue. */
export const RENTAL_APPROVAL_TOOL_CODES = Object.freeze([
  "rental.order.explain", "rental.catalog.search", "rental.availability.check",
  "membership.customer.resolve", "rental.quote.preview", "rental.order.propose",
  "rental.order.commit", "rental.change.preview", "tenant.opening.diagnose",
  "tenant.config.propose", "tenant.notifications.commit", "membership.profile.propose", "membership.profile.commit", "inspection.draft.extract",
  "operations.risks.list", "platform.category.propose"
] as const);
export type RentalApprovalToolCode = typeof RENTAL_APPROVAL_TOOL_CODES[number];
