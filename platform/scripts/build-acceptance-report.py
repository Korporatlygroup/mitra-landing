"""Builds the visual acceptance PDF from the screenshots in docs/. Run: python scripts/build-acceptance-report.py <commit> """
import os, sys, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
SHOTS = os.path.join(DOCS, "redesign-screenshots")
JOUR = os.path.join(DOCS, "journey-evidence")
OUT = os.path.join(DOCS, "INOK_Premium_Redesign_V3_Visual_Acceptance_Report.pdf")
COMMIT = sys.argv[1] if len(sys.argv) > 1 else "unknown"
BRAND = colors.HexColor("#981B40")
INK = colors.HexColor("#171717")
MUTED = colors.HexColor("#5B6B82")

H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=18, textColor=BRAND, spaceAfter=8, spaceBefore=4, leading=22)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12.5, textColor=INK, spaceAfter=4, spaceBefore=8, leading=16)
P = ParagraphStyle("p", fontName="Helvetica", fontSize=9.5, textColor=INK, leading=13.5, spaceAfter=5)
SM = ParagraphStyle("sm", fontName="Helvetica", fontSize=8, textColor=MUTED, leading=11)
CAP = ParagraphStyle("cap", fontName="Helvetica-Bold", fontSize=9, textColor=INK, leading=12, spaceAfter=1)

class Doc(BaseDocTemplate):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        fr = Frame(18 * mm, 16 * mm, A4[0] - 36 * mm, A4[1] - 32 * mm, id="f")
        self.addPageTemplates([PageTemplate(id="p", frames=[fr], onPage=self.deco)])
    def deco(self, c, d):
        c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
        c.drawString(18 * mm, 9 * mm, f"INOK Premium Redesign V3 - Visual Acceptance Report - commit {COMMIT}")
        c.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {d.page}")
    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ("h1",):
            self.notify("TOCEntry", (0, f.getPlainText(), self.page))

def img(path, max_w, max_h):
    w, h = PILImage.open(path).size
    r = min(max_w / w, max_h / h)
    return Image(path, width=w * r, height=h * r)

def shot_block(title, role, note, desk, mob=None):
    """Desktop capture at full width, mobile capture beside a caption."""
    parts = [Paragraph(title, CAP), Paragraph(f"Role: {role}. {note}", SM), Spacer(1, 2)]
    parts.append(img(desk, 174 * mm, 108 * mm))
    if mob and os.path.exists(mob):
        parts += [Spacer(1, 3), Paragraph("Same screen at 390 px (phone):", SM), img(mob, 52 * mm, 95 * mm)]
    return KeepTogether(parts)

def pair(rel, name):
    return os.path.join(SHOTS, f"{rel}-1280.png"), os.path.join(SHOTS, f"{rel}-390.png")

story = []
# cover
story += [Spacer(1, 40 * mm), Paragraph("INOK", ParagraphStyle("c0", fontName="Helvetica-Bold", fontSize=40, textColor=BRAND, leading=44)),
          Paragraph("Premium Redesign V3", ParagraphStyle("c1", fontName="Helvetica-Bold", fontSize=22, textColor=INK, leading=28)),
          Spacer(1, 6 * mm),
          Paragraph("Complete Platform User Journey &amp; Visual Acceptance Report", ParagraphStyle("c2", fontName="Helvetica", fontSize=14, textColor=INK, leading=19)),
          Spacer(1, 14 * mm),
          Paragraph(f"Date: {datetime.date.today().isoformat()}<br/>Branch: redesign/premium-v3 (PR #15, draft)<br/>Commit: {COMMIT}<br/>"
                    "Environment: local isolated stack (Supabase local, Next.js dev server). Not staging, not production.<br/>"
                    "Release candidate: NOT released. Nothing in this report has been deployed.", P)]
if os.path.exists(os.path.join(DOCS, "..", "public", "brand", "inok-logo-full.jpg")):
    story += [Spacer(1, 10 * mm), img(os.path.join(DOCS, "..", "public", "brand", "inok-logo-full.jpg"), 60 * mm, 70 * mm)]
story += [PageBreak()]

toc = TableOfContents(); toc.levelStyles = [ParagraphStyle("t0", fontName="Helvetica", fontSize=10, leading=15)]
story += [Paragraph("Contents", H1), toc, PageBreak()]

story += [Paragraph("1. Executive summary", H1),
  Paragraph("This report documents what was verified in real browser sessions against the local test stack at the commit above. "
            "It separates what was rebuilt, what was only restyled, what passed and what is still open. It does not claim production readiness.", P),
  Paragraph("What is evidenced", H2),
  Paragraph("- A real buyer and a real seller, in two separate browser sessions, exchanged four messages, the seller sent a quotation, the buyer viewed and accepted it. "
            "Message order, sender and organisation were checked in the database, and an unrelated third user received a 404 for the same thread (section 4).<br/>"
            "- Rebuilt screens: Home, My Requests, request detail, quotation comparison, Business 360, Government assistance (list, find, detail header), Settings, Notifications, "
            "Messages, directory cards, Onboarding review step, admin queues, role-aware sidebar, header workspace menu, INOK logo and favicon.", P),
  Paragraph("What is NOT evidenced or not finished", H2),
  Paragraph("- Many pages only received the shared header and flat cards (see platform/docs/redesign-v3-route-inventory.md).<br/>"
            "- Partner pages beyond the home page were not seen with data (a partner organisation must be approved first).<br/>"
            "- Tamil and Malay layouts were not screenshotted; only strings were verified by tests.<br/>"
            "- Populated screenshots exist for the conversation journey; most other screens show the empty state of a fresh test account.<br/>"
            "- 360 px, 768 px, 1024 px, 1440 px and 1920 px captures exist for the main screen set only; the journey uses 390 px and 1280 px.<br/>"
            "- No deployment was performed and no production smoke test was run.", P),
  PageBreak()]

story += [Paragraph("2. Design system", H1),
  Paragraph("Brand: white #FFFFFF, application background #F8FAFC, burgundy #981B40 (hover #7B1534, tint #FCEEF2), action yellow #F5A623, text #171717, "
            "secondary text #5B6B82 (slightly darker than the #64748B in the brief so that it passes AA contrast on grey panels), border #E5E7EB. "
            "Fonts: Plus Jakarta Sans for headings, Geist for interface text, Noto Sans Tamil fallback. Shared components: PageHeader, TabsNav, StatusBadge, EmptyState, "
            "DataTable, MetricCard, ProgrammeCard, FilterSheet, ConversationFilter. The INOK shop-and-arrow mark is used as logo and favicon.", P)]
h, m = pair("home", "Home")
story += [shot_block("Home (signed-in seller)", "Seller", "Discovery cards, search, organisation list, assistance and listing summary. Account has no activity yet.", h, m), PageBreak()]

story += [Paragraph("3. Buyer and discovery screens", H1)]
for rel, title, role, note in [
    ("directory", "Business directory", "Visitor/buyer", "Cards link to public profiles. Fixture data."),
    ("profile", "Public business profile", "Visitor/buyer", "Cover, identity, tabs. The fixture business has no services, so the service cards are not shown."),
    ("products", "Products from India", "Buyer", "Catalogue with the phone Filters disclosure."),
    ("requests", "My Requests", "Buyer", "Empty state for a brand-new account; metrics and tabs appear once requests exist."),
    ("news", "News and bulletins", "All", "Fixture bulletins."),
    ("assistance", "Government assistance", "Business", "Search, type filter, tabs with counts, programme cards. Programme status shown as stated (not confirmed where unknown)."),
]:
    d, mm_ = pair(rel, title)
    story.append(shot_block(title, role, note, d, mm_))
story.append(PageBreak())

story += [Paragraph("4. Real buyer-seller conversation and quotation", H1),
  Paragraph("Produced by tests/e2e/e98-conversation-evidence.spec.ts (SHOTS=1). Two separate browser contexts: the buyer (INOK Demo Buyer Trading) and the seller (a demo business). "
            "All names are fictional demonstration data. The messages are the example conversation from the brief, sent through the platform's own message box.", P),
  Paragraph("Database assertions made by the same test: exactly four messages in order; sender organisations buyer, seller, buyer, seller; sender users match; the quotation row ends 'accepted'; "
            "a third, unrelated signed-in user opening the same URL receives HTTP 404 and sees neither the messages nor the amount.", P)]
steps = [
    ("01-messages-list__buyer", "Step 1 - Buyer: messages list", "Buyer"),
    ("02-buyer-writes-first-message__buyer", "Step 2 - Buyer writes the first message", "Buyer"),
    ("03-buyer-message-sent__buyer", "Step 3 - Buyer message sent", "Buyer"),
    ("04-seller-messages-list__seller", "Step 4 - Seller: messages list", "Seller"),
    ("05-seller-reads-buyer-message__seller", "Step 5 - Seller reads the buyer's message", "Seller"),
    ("06-seller-replies__seller", "Step 6 - Seller replies", "Seller"),
    ("07-buyer-sees-seller-reply__buyer", "Step 7 - Buyer sees the seller's reply", "Buyer"),
    ("08-seller-prepares-quotation__seller", "Step 8 - Seller prepares the quotation", "Seller"),
    ("09-seller-sent-quotation__seller", "Step 9 - Seller sent the quotation", "Seller"),
    ("10-buyer-views-quotation__buyer", "Step 10 - Buyer views the quotation", "Buyer"),
    ("11-buyer-accepts-quotation__buyer", "Step 11 - Buyer accepts the quotation", "Buyer"),
    ("12-buyer-conversation-list__buyer", "Step 12 - Buyer: conversation list after acceptance", "Buyer"),
    ("13-seller-leads__seller", "Step 13 - Seller: leads page", "Seller"),
]
for stem, title, role in steps:
    d = os.path.join(JOUR, stem + "__1280.png"); mo = os.path.join(JOUR, stem + "__390.png")
    if os.path.exists(d):
        story.append(shot_block(title, role, "Real authenticated browser session.", d, mo))
story.append(PageBreak())

story += [Paragraph("5. Seller and business screens", H1)]
for rel, title, role, note in [
    ("business-360", "Business 360", "Seller", "Identity header, four metrics, grouped readiness, next actions. New business: all zero."),
    ("onboarding-review", "Onboarding - review and finish", "Seller", "Review step added to the existing 5-step wizard."),
    ("messages", "Messages (empty state)", "Seller", "Fresh account. See section 4 for the populated thread."),
]:
    d, mm_ = pair(rel, title)
    story.append(shot_block(title, role, note, d, mm_))
story.append(PageBreak())

story += [Paragraph("6. Account, notifications and administration", H1)]
for rel, title, role, note in [
    ("settings-account", "Settings", "Any user", "Secondary navigation: My account, Security, Notifications, Privacy, Data requests."),
    ("notifications", "Notifications", "Any user", "All/Unread tabs; empty state for a new account."),
    ("admin-verification", "Admin - verification queue", "Administrator", "Status tabs with counts. Queue was empty in this capture."),
    ("admin-listings", "Admin - listings queue", "Administrator", "Two listings waiting from earlier test runs."),
    ("admin-programmes", "Admin - programme operations", "Administrator", "Switches shown Off; none were changed."),
]:
    d, mm_ = pair(rel, title)
    story.append(shot_block(title, role, note, d, mm_))
story.append(PageBreak())

story += [Paragraph("7. Functional testing summary", H1),
  Paragraph("Local runs against the isolated stack (not CI, not staging, not production). Counts are from the runs described; they are not a single full-suite result.", P)]
rows = [["Area", "Result", "Notes"],
        ["Unit tests", "1021 passed", "vitest, tests/unit"],
        ["Typecheck / lint", "clean", "tsc, eslint on changed code"],
        ["Broad e2e (≈100 specs, partner, buyer, catalogue, sourcing, onboarding, legal)", "93 passed, 8 failed (first run)", "Failures then investigated individually below"],
        ["E43 request resubmission", "passed after fix", "Test typed before the page was hydrated; test now waits. No app change."],
        ["E22 onboarding validation", "passed after fix", "Race between a late response and the next typed value; test now settles between rounds."],
        ["E51 partner products (ms)", "passed", "Earlier failure was the missing document-scan stub in the local setup."],
        ["E61 / E62 / E80-sourcing / E81", "passed after test updates", "Tests updated for the organisation requirement, EmptyState heading level, message locator and the opportunities layout."],
        ["E98 buyer-seller conversation", "passed", "New spec; DB and isolation assertions."],
        ["E3 invitations, E29 wording", "BLOCKED", "Need a local email provider; invitation email could not be sent in this setup."],
        ["E24/E25/E41-admin parts, E82", "NOT RUN here", "Need the seeded bootstrap administrator that the repo's own global setup creates."],
        ["Integration / database (RLS) tests", "NOT RUN", "Not run in this session."],
        ["Accessibility", "partial", "axe runs inside several e2e specs; one contrast token fixed. No full audit."],
        ["Malay/Tamil", "strings only", "No visual check of text expansion."]]
t = Table(rows, colWidths=[62 * mm, 40 * mm, 72 * mm])
t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 8), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
                       ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FCEEF2")), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
                       ("VALIGN", (0, 0), (-1, -1), "TOP")]))
story += [t, Spacer(1, 6)]
story += [Paragraph("8. Security and access control", H1),
  Paragraph("Verified in this report: an unrelated buyer cannot open another organisation's enquiry (HTTP 404, no content). Existing e2e specs for role separation (E4, E8, E61) were part of the earlier "
            "local runs. Not re-verified here: RLS database tests, admin permission matrix, file upload security. No authentication, RLS or policy was changed by this redesign.", P),
  Paragraph("9. Deployment", H1),
  Paragraph("NOT DEPLOYED. PR #15 is a draft. The platform CI job and a full e2e run on the final commit have not been confirmed green. No Cloudflare deployment, "
            "staging rollout or production smoke test was performed. Release gates in the brief (full regression, authenticated smoke tests on a deployed candidate) are therefore unmet. "
            "Rollback for a future release: revert the merge commit (frontend only; no migrations are included).", P),
  Paragraph("10. Final assessment", H1),
  Paragraph("Completed: conversation and quotation journey verified end to end; key screens rebuilt; logo and favicon; listed test failures resolved. "
            "Outstanding: remaining pages still on header+cards, populated screenshots for most screens, language and large-screen visual checks, full regression on CI, "
            "email-dependent tests, administrator-seeded specs, deployment. Overall status: release candidate not ready; do not merge or deploy until the open items are closed.", P)]

doc = Doc(OUT, pagesize=A4, title="INOK Premium Redesign V3 - Visual Acceptance Report", author="INOK")
doc.multiBuild(story)
print(OUT, os.path.getsize(OUT))
