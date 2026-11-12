# Phase 3 / Phase 4 shared contract

**Contract version:** `p3p4-contract/1.2` (1.0 plus sections 10 and 11, additive only; nothing in sections 1 to 9 changed meaning) (reconciled against the real Phase 1/2 schema at `adc8c96` and against the implemented Phase 3 migrations; this supersedes the *proposed* contract in `02_Phase3_Phase4_Shared_Contract.md` where they differ)
**Status:** Implemented locally and tested (see `phase3-report.md`). **Not yet acknowledged by Codex** and not applied to hosted staging. Codex should acknowledge by writing the version above and the commit SHA of this file into its own plan.
**Migration owner (shared entities):** Claude (Phase 3). Codex writes P4 migrations only after the P3 migrations below exist locally, as separate files with later version prefixes.
**Migration files:** `20260701000012_p3_directory_schema.sql`, `…013_p3_listing_rpcs.sql`, `…014_p3_request_rpcs.sql`, (1.1) `…000100_p3_request_board.sql`, `…000101_p3_ms_language.sql`, `…000102_p3_portfolio_fields.sql`, and (1.2) `…000105_p3p4_referral_handoff.sql`. **Phase 4 migrations are numbered `…000103_p4_schema.sql` and `…000104_p4_workflows.sql`** (this supersedes the earlier `000015`-`000099` range; see section 11).

## 1. What P3 owns and what P4 may rely on

| Thing | Owner | Notes |
|---|---|---|
| `business_listings`, `business_services`, `business_portfolio`, `listing_events` | P3 | public read only through RPCs |
| `buyer_requests`, `buyer_request_private`, `request_seller_matches` | P3 | request id is stable for the whole life of the job |
| `enquiries` (identity, participants, origin, request link, opening note) | **P3** | decision: P3 creates the row; P4 never creates a second conversation identity |
| `enquiry_messages`, quotes, lead stages, reviews, referrals | P4 | reference `enquiries.id` |
| `content_reports` | P3 | P4 may add `target_type`s later via its own migration |

## 2. Reconciliation with the proposed contract (differences)

1. `business_listings.org_id` references `business_profiles(org_id)` (as proposed). Live public content is a **snapshot** (`live_*` columns plus `business_services`/`business_portfolio`), separate from the editable `draft` jsonb, so profile edits never alter the approved listing. Statuses are split into `live_status` (`unpublished|published|suspended`) and `review_status` (`editing|pending_review|changes_requested|rejected|approved`) instead of one `published_status`.
2. `contact_policy` is replaced by `live_show_phone` / `live_show_email` (explicit owner consent per channel). In-app enquiry is always available.
3. `service_area_states text[]` lives on `business_services.areas` (+ `nationwide`), because one business can serve different areas per service. `business_profiles.state/district` remain the premises location.
4. `request_seller_matches.match_type` is `status`: `candidate|invited|interested|question|declined|expired|withdrawn`. A candidate is **not** an invitation and is invisible to the seller.
5. `buyer_requests.visibility` exists but only `private_invite` is allowed in P3. `public_redacted` is reserved (no public board in P3; recorded deliberate decision).
6. `buyer_requests.status` adds `removed` (moderation). `enquiries` adds `opening_note`, `topic`, `opened_by_org_id` so a P3 enquiry is never empty. P4 may render them as the first message.
7. Portfolio items are text only in P3 (no public image bucket yet; images need scanning and moderation storage).

## 3. Tables (authoritative: the migration files)

### enquiries (the seam)
```
id uuid pk
buyer_org_id uuid -> organisations   (immutable)
seller_org_id uuid -> organisations  (immutable)  check buyer_org_id <> seller_org_id
buyer_request_id uuid null -> buyer_requests (immutable)
origin enquiry_origin: listing | request_invitation | referral   (immutable)
status enquiry_status: open | awaiting_buyer | awaiting_seller | closed | blocked   (P4 drives transitions)
topic text 3..200, opening_note text <=1000 null, opened_by_org_id (buyer or seller org)
created_by uuid, created_at, updated_at, version integer
unique (buyer_org_id, seller_org_id, coalesce(buyer_request_id, nil-uuid)) where status <> 'closed'
```
A trigger rejects UPDATE of the immutable columns. `request_seller_matches.enquiry_id` points back to it.
RLS: select for active members of the buyer org or the seller org. No direct insert/update/delete for `authenticated`.

### buyer_requests / request_seller_matches
Request: `draft -> open -> closed | expired | withdrawn | removed`. Edits only while `draft`; an open request is immutable (withdraw and repost). `version` increments per draft save. Match: `candidate -> invited -> interested | question | declined`; `invited -> expired | withdrawn` when the request ends. Responding is only from `invited`.

## 4. Interfaces P4 consumes

| Operation | Kind | Rule |
|---|---|---|
| `public.open_listing_enquiry(p_buyer_org, p_slug, p_topic, p_note)` | RPC | buyer org member with `request:post`; seller listing published and accepting; idempotent per open pair |
| `public.respond_to_invitation(p_request, p_seller_org, p_response, p_note)` | RPC | `interested`/`question` open (or reuse) the enquiry; `declined` does not |
| `private.is_enquiry_member(p_enquiry uuid)` | SQL helper (security definer) | true for an active member of either participant org; use it in P4 RLS |
| `public.enquiry_parties(p_enquiry uuid)` | RPC, returns jsonb | `{buyer_name, seller_name, seller_slug, you_are}`; participants only (organisation rows are private) |
| `public.respond_to_invitation(...)` result | jsonb | `{status, enquiry_id}`; `enquiry_id` is null for `declined` |
| `public.open_listing_enquiry(...)` result | jsonb | `{id, created}`; `created=false` when an open enquiry for the pair already existed |
| `enquiries` select | table, RLS | participant orgs only |
| Permissions | `role_permissions` | `request:post`, `request:respond` (owner, manager, staff) |
| Notifications | `notifications.kind` | `request.invited`, `request.interested`, `request.question`, `request.declined`, `enquiry.opened`. P4 adds `enquiry.*`/`quote.*` kinds in its own migration |

P4 rules: never insert into `enquiries`; call the RPCs above. Add status transitions with your own RPCs and bump `enquiries.version`. Seller internal notes and buyer contact details stay out of anything P4 exposes to the other side. `buyer_request_private` is buyer-org-only and is revealed to a seller only by `get_request_for_seller` after the seller responds *and* the buyer consented.

## 5. Permissions (added to `role_permissions`; mirrored in `src/lib/permissions.ts`, checked by a unit test)

| Permission | Roles |
|---|---|
| `listing:publish` (submit, unpublish, republish) | owner, manager |
| `request:post` | owner, manager, staff |
| `request:respond` | owner, manager, staff |
| `listing:review` (approve/reject/suspend, handle listing reports) | admin_review, admin_super |
| `request:moderate` (remove request, handle request reports) | admin_support, admin_super |

Drafting a listing uses the existing `business:edit`. A reviewer who has ever been a member of, or edited, the organisation under review cannot decide on it (`has_org_involvement`, same rule as Phase 2).

## 6. Error vocabulary
Standard `PT401/403/404/409/422/429`. P3 adds keys: `listing_incomplete`, `listing_under_review`, `listing_not_pending`, `listing_not_live`, `request_incomplete`, `request_not_open`, `request_not_editable`, `duplicate_request`, `contact_required`, `request_limit_reached`, `draft_limit_reached`, `invite_limit_reached`, `not_a_candidate`, `seller_not_available`, `already_responded`, `invalid_response`, `seller_not_accepting`, `same_organisation`, `already_reported`, `report_not_open`.

## 7. Contract-freeze checklist
- [x] Enum and status vocabulary written down above and in the migrations.
- [x] One owner for `enquiries` and migrations: Claude (P3).
- [x] Foreign keys anchored to the real Phase 2 tables (`business_profiles`, `business_categories`, `organisations`).
- [ ] Codex acknowledges this version and file SHA in writing.
- [ ] P4 quote/version model reviewed against section 4.

## 8. Answers to Codex's proposal v1 (`phase3-phase4-proposal-v1.md`, five requested decisions)

1. **Opening moment.** From a listing: when the buyer sends the first enquiry (`open_listing_enquiry`). From a request: when an *invited* seller replies `interested` or `question` (not at invitation, not on `declined`). Retry safety is the one-open-enquiry-per-(buyer org, seller org, request) unique index, so a retry returns the same row; there is no client idempotency key on enquiries. After an enquiry is `closed`, a new one may be opened for the same pair.
2. **Status.** Vocabulary `open | awaiting_buyer | awaiting_seller | closed | blocked`. P3 only ever writes `open`. P4 owns every later transition (next-respondent semantics are P4's choice) and must guard them itself with `version`. P3 enforces only the immutable identity columns (trigger `enquiries_immutable`).
3. **Business as buyer.** Yes: a business organisation posts requests and sends enquiries under its own organisation (`request:post`: owner, manager, staff). The same organisation can never be both sides (`buyer_org_id <> seller_org_id`, and `same_organisation` error). Sellers respond with `request:respond` (owner, manager, staff). Viewers are read-only.
4. **Read shapes and hidden resources.** The seller-side request read is `get_request_for_seller`, typed as `SellerRequestView` in `src/server/services/directory.ts`. Buyer-side matches come from `list_request_matches`. A hidden or uninvited resource is always `404 not_found`, never `403`; `403` is returned only when the caller names an organisation they do not belong to. The enquiry read is the `enquiries` table (RLS) plus `enquiry_parties`.
5. **Migrations.** P3 owns `20260701000012` to `20260701000014`. P4 migrations should start at `20260701000015` and be separate files. Fixture helpers for pgTAP (`tt.*`: users, orgs, published listings, open requests) are in `supabase/tests/database/10_phase3_directory_requests.test.sql`. Hosted staging still has none of this and its history mismatch is unresolved.

## 9. Behaviours P4 must know (from the independent reviews)

- A request seller sees only requests it was **invited** to (`invited_at` set). Never-invited candidate rows are deleted when a request ends or expires; there is no direct seller access to `request_seller_matches`.
- Buyer name and contact are revealed to a seller only after the seller replies and only if the buyer set `share_contact`. `enquiry_parties` returns `buyer_name = null` to the seller otherwise; render a neutral "Customer".
- `remove_request` needs an open report; `handle_report` applies the conflict-of-interest rule for every action.
- Lock order is request row, then match row. P4 RPCs that touch both must follow it.
- Approving a listing re-publishes one the owner had unpublished (suspended listings stay suspended). Owner-unpublished state is not preserved across an approval.
- Known, accepted limits: anonymous `search_listings` has no DB rate limit (needs an edge limit); a user can create up to 200 draft rows an hour (10 live drafts at a time).
- Buyer name and phone/email are served to a seller only while the request is `open`. After it closes or expires the seller keeps the request text but not the buyer's contact.
- `enquiries.topic` is a copy of the request title taken when the seller replied, so it stays readable to both participants after the request ends. P4 may close the enquiry when it wants.

## 10. Version 1.1: public request board (additive)

**Migration numbering.** Phase 3 addenda use `20260701000100` and above. **Phase 4 keeps `20260701000015` to `20260701000099`.** The addendum `…000100` runs after any P4 migration in that range; it only redefines `get_request_for_seller`, `respond_to_invitation` and `invite_seller` and adds new objects, none of which P4 should redefine. If P4 needs to change one of those three functions, tell Claude first.

**What changed (no new tables, no new enquiry path).**
- `buyer_requests.visibility` now allows `private_invite` (default) and `eligible_sellers`. The value is frozen once the request leaves `draft` (trigger). New RPC `set_request_visibility(request, visibility)` works on drafts only.
- A request with `eligible_sellers` is readable, before any invitation, by a seller organisation that passes `private.board_eligible`: request `open` and not expired, buyer organisation active, seller is an active business with a `published` listing that is `accepting_requests`, and one of its services matches the request category and area (or is nationwide) and is not excluded by minimum order. Anything else is `404 not_found`.
- New RPC `list_board_requests(seller_org, category, state, offset)` (needs `request:respond`) returns `{ total, items }` (20 per page); items carry only public request fields plus `my_status`.
- `get_request_for_seller` has the same output shape plus `from_board: boolean`. For a board request the seller has not answered, `match_status` is the virtual value `invited`, `reason_codes`/`caution_codes` are empty, and no buyer name or contact is returned.
- `respond_to_invitation` creates the `request_seller_matches` row on the first reply to a board request (`invited_by` null) and then behaves exactly as before, including `open_enquiry` with origin `request_invitation`. P4 therefore still sees one enquiry per (buyer org, seller org, request), whichever way it began. Duplicate replies are retry-safe; a different second answer is `409 already_responded`; at most 20 non-declined board replies per request (`409 request_response_limit`); 40 board replies per user per day.
- The invitation cap (10) now counts only invitations the buyer sent.
- The audit entry for a reply has `details.via` = `board` or `invitation`.
- Submitting a board request whose title, description or district contains an email address or a run of nine or more digits is refused with `422 contact_in_public_text` (trigger). Buyer name, phone and email are never part of a board response and follow section 9 after a reply.
- Withdraw, close, expiry and moderator removal take the request off the board at once (the list only returns `open`); sellers that already replied keep their restricted view as before.

## 11. Version 1.2: migration order and the referral hand-off (additive)

**Order (final).** `000012`-`000014` (P3), `000100`-`000102` (P3 addenda), `000103`-`000104` (P4, renamed from `000015`-`000016`; content unchanged), `000105` (P3 integration). Reason: hosted staging must receive versions above every version it already holds, and `000105` reads P4's `referral_suggestions`, so it must come after P4. P4 changes after this point use the next free number above `000105`. P4 still must not redefine `get_request_for_seller`, `respond_to_invitation`, `invite_seller` (section 10).

**New: `public.open_referral_enquiry(p_referral uuid)` returns `{ id, created }`.** This is the only way an accepted P4 referral becomes an `enquiries` row; P4 still never inserts into `enquiries`.
- Caller: an active member of the *proposed* (recipient) organisation with `request:respond` (owner, manager, staff). A non-member, the buyer, the referring business, and any recipient member (viewer included) **before the buyer has consented** get `404 not_found`; after consent a recipient viewer gets `403`.
- Precondition: `referral_suggestions.status = 'recipient_accepted'` with both `buyer_consented_at` and `recipient_accepted_at` set (P4 enforces buyer-first order). Otherwise `409 invalid_referral`.
- Also required: the source enquiry is neither `blocked` nor `closed`, and a reused existing enquiry with the recipient is not `blocked` (`409 invalid_referral`); if it belongs to a request, that request is `open` and not expired (`409 request_not_open`); the buyer organisation is active; the recipient has a `published` listing that is `accepting_requests` in an active organisation (`409 seller_not_available`).
- Effect: opens (or returns) the one open enquiry for (buyer org, recipient, original request or none) through `private.open_enquiry`, `origin = 'referral'`, `opened_by_org_id` = recipient, `topic` = source topic, `opening_note` = null. Nothing else from the source conversation is copied (no messages, quotes, notes, or referrer identity). Buyer name and contact follow section 9 (`share_contact`).
- Idempotency: table `public.referral_handoffs(referral_id pk, enquiry_id, opened_by, created_at)` records one enquiry per referral for ever; a retry, a colleague's click, or a call after the enquiry or request has closed returns the same enquiry with `created = false`. Rows are readable only by participants of that enquiry (RLS); no direct writes.
- Side effects: audit `referral.enquiry_opened` whenever the hand-off row is first written (details: enquiry id and `reused`), notification `enquiry.opened` to the buyer organisation only when a new enquiry was created, rate limit 20 per user per day (`refopen:`).
- Lock order: referral row, then request row (`for share`). It never takes the match row.

**Accepted limits (independent review, medium/low, 2026-11-11).** (1) Buyer consent in P4 has no expiry and no withdrawal; the hand-off is blocked only if the source enquiry is closed or blocked, the request closed, or the recipient unavailable. Needs a P4 withdraw RPC and a consent age limit later. (2) The new enquiry's `topic` is copied from the source enquiry (for a listing enquiry that is the buyer's own words), which the recipient can read; the consent screen should say the topic is shared. (3) `referral_handoffs.opened_by` has no foreign key (survives account erasure). (4) Before the buyer consents, a recipient gets `404` for the referral, including viewers. (5) `referral_handoffs` rows cascade away with their enquiry or referral so that organisation and account erasure keep working; if an enquiry were deleted, a retry could then open a new one (enquiries are only deleted by erasure cascades).
