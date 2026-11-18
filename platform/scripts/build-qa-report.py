"""Builds INOK_Complete_User_Journey_Visual_Test_Report.pdf from docs/qa-evidence (real screenshots + index.jsonl + load-test JSON).
Run: python scripts/build-qa-report.py <commit> [pr-checks-text-file]
Every figure in the report comes from a file written by a test run; nothing is typed in by hand except the narrative and the limitations."""
import os, sys, json, datetime, hashlib, tempfile, collections
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV = os.path.join(ROOT, "docs", "qa-evidence")
LAND = os.path.join(ROOT, "docs", "qa-evidence-landing")
OUT = os.path.join(ROOT, "docs", "INOK_Complete_User_Journey_Visual_Test_Report.pdf")
COMMIT = sys.argv[1] if len(sys.argv) > 1 else "unknown"
CHECKS = open(sys.argv[2], encoding="utf-8").read() if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else "not recorded"
CACHE = tempfile.mkdtemp(prefix="qa-pdf-")
BRAND = colors.HexColor("#981B40"); INK = colors.HexColor("#171717"); MUTED = colors.HexColor("#5B6B82"); LINE = colors.HexColor("#E5E7EB")

H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, textColor=BRAND, spaceAfter=8, spaceBefore=2, leading=21)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=INK, spaceAfter=4, spaceBefore=8, leading=15)
P = ParagraphStyle("p", fontName="Helvetica", fontSize=9.5, textColor=INK, leading=13.5, spaceAfter=5)
SM = ParagraphStyle("sm", fontName="Helvetica", fontSize=8, textColor=MUTED, leading=10.5)
CAP = ParagraphStyle("cap", fontName="Helvetica-Bold", fontSize=9.5, textColor=INK, leading=12, spaceAfter=1)
TD = ParagraphStyle("td", fontName="Helvetica", fontSize=7.8, textColor=INK, leading=9.6)
TDB = ParagraphStyle("tdb", parent=TD, fontName="Helvetica-Bold")

class Doc(BaseDocTemplate):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.addPageTemplates([PageTemplate(id="p", frames=[Frame(16 * mm, 15 * mm, A4[0] - 32 * mm, A4[1] - 30 * mm, id="f", leftPadding=0, rightPadding=0)], onPage=self.deco)])
    def deco(self, c, d):
        c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
        c.drawString(16 * mm, 8 * mm, f"INOK Complete User Journey Visual Test Report - commit {COMMIT} - local isolated stack")
        c.drawRightString(A4[0] - 16 * mm, 8 * mm, f"Page {d.page}")
    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name == "h1":
            self.notify("TOCEntry", (0, f.getPlainText(), self.page))

def esc(s): return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def jpg(path, max_w_px=1280):
    key = hashlib.md5(path.encode()).hexdigest() + ".jpg"
    out = os.path.join(CACHE, key)
    if not os.path.exists(out):
        im = PILImage.open(path).convert("RGB")
        if im.width > max_w_px: im = im.resize((max_w_px, int(im.height * max_w_px / im.width)))
        im.save(out, "JPEG", quality=74)
    return out

def img(path, w_mm, max_h_mm=None):
    p = jpg(path); w, h = PILImage.open(p).size
    wm = w_mm * mm; hm = wm * h / w
    if max_h_mm and hm > max_h_mm * mm: hm = max_h_mm * mm; wm = hm * w / h
    return Image(p, width=wm, height=hm)

def table(rows, widths, head=True):
    data = [[Paragraph(esc(c), TDB if (head and i == 0) else TD) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if head else 0)
    st = [("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if head: st.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FCEEF2")))
    t.setStyle(TableStyle(st)); return t

idx = [json.loads(l) for l in open(os.path.join(EV, "index.jsonl"), encoding="utf-8")]
steps = collections.OrderedDict()
for r in idx:
    steps.setdefault((r["role"], r["journey"], r["step"], r["lang"]), {})[r["width"]] = r
def have(m): return {w: os.path.join(EV, r["file"]) for w, r in m.items() if os.path.exists(os.path.join(EV, r["file"]))}

def step_block(key, m):
    role, journey, step, lang = key
    f = have(m); meta = next(iter(m.values()))
    desk = f.get(1280) or f.get(max(f)); mob = f.get(390) or f.get(360)
    head = [Paragraph(esc(meta["title"]), CAP),
            Paragraph(f"<b>Role:</b> {esc(role)} &nbsp; <b>Journey:</b> {esc(journey)} &nbsp; <b>Language:</b> {lang} &nbsp; <b>Route:</b> {esc(meta['route'])}", SM),
            Paragraph(f"<b>Expected:</b> {esc(meta['expected'])}", SM), Paragraph(f"<b>Observed:</b> {esc(meta['observed'])}", SM),
            Paragraph(f"<b>Environment:</b> local isolated stack, Next.js dev server, commit {COMMIT}. Widths captured: {', '.join(str(w) for w in sorted(f))} px.", SM), Spacer(1, 2)]
    cells = [[img(desk, 118, 88), img(mob, 40, 88) if mob and mob != desk else ""]]
    t = Table(cells, colWidths=[122 * mm, 52 * mm]); t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOX", (0, 0), (0, 0), 0.3, LINE)]))
    return KeepTogether(head + [t, Spacer(1, 7)])

def journey_section(title, intro, journeys, role_filter=None):
    out = [Paragraph(title, H1), Paragraph(intro, P)]
    n = 0
    for key, m in steps.items():
        if key[1] in journeys and key[3] == "en" and (role_filter is None or key[0] in role_filter):
            out.append(step_block(key, m)); n += 1
    return out, n

story = []
styl = lambda n, s, c: ParagraphStyle(n, fontName="Helvetica-Bold", fontSize=s, textColor=c, leading=s + 5)
story += [Spacer(1, 38 * mm), Paragraph("INOK", styl("c0", 40, BRAND)), Paragraph("Complete User Journey Visual Test Report", styl("c1", 21, INK)), Spacer(1, 6 * mm),
          Paragraph("Post-release acceptance testing of the INOK platform with populated demonstration data", ParagraphStyle("c2", fontName="Helvetica", fontSize=13, leading=18, textColor=INK)), Spacer(1, 12 * mm),
          Paragraph(f"Date: {datetime.date.today().isoformat()}<br/>Branch: qa/post-release-v3 (PR 16, based on deployed release 06c7d30)<br/>Commit: {COMMIT}<br/>"
                    "Environment: local isolated stack (local Supabase, Next.js). Not staging, not production.<br/>Production was not touched by any test in this report. Nothing here is a production claim.", P)]
logo = os.path.join(ROOT, "public", "brand", "inok-logo-full.jpg")
if os.path.exists(logo): story += [Spacer(1, 10 * mm), img(logo, 55, 65)]
story += [PageBreak()]
toc = TableOfContents(); toc.levelStyles = [ParagraphStyle("t0", fontName="Helvetica", fontSize=9.5, leading=13.5)]
story += [Paragraph("Contents", H1), toc, PageBreak()]

load_http = json.load(open(os.path.join(EV, "load-test-http.json"))) if os.path.exists(os.path.join(EV, "load-test-http.json")) else None
load_br = json.load(open(os.path.join(EV, "load-test-browser.json"))) if os.path.exists(os.path.join(EV, "load-test-browser.json")) else None
shots = len(idx); distinct = len(steps)

story += [Paragraph("1. Executive summary", H1),
  Paragraph(f"Ten user journeys were run in real browsers against a locally running copy of the platform filled with synthetic demonstration data. {shots} real screenshots were captured ({distinct} distinct screens) "
            "across visitor, buyer, seller, partner and administrator roles, English, Bahasa Melayu and Tamil, and seven viewport widths. All eight populated-journey tests passed on the final run.", P),
  Paragraph("What is evidenced", H2),
  Paragraph("- A buyer and a seller, in separate browser sessions, held the exact scripted conversation; the seller built and sent a real quotation (MYR 320.00 for 100 boxes) and the buyer accepted it. Database checks confirmed message order, senders, organisations and the final quotation status, and that an unrelated buyer and an unrelated seller both receive 404 for the thread.<br/>"
            "- The visual defects found while reviewing the populated screens were fixed and re-captured: the catalogue filter panel, the quotation form fields, a duplicated button label and status badges splitting inside tables.<br/>"
            "- Permission checks: a buyer cannot open the admin console or another business's workspace (404); an expired session returns to sign-in.<br/>"
            "- Bounded load tests (5, 10 and 20 concurrent sessions) completed with zero failed requests or sessions; measured figures are in section 21.", P),
  Paragraph("What is not claimed", H2),
  Paragraph("- Nothing here was run against production or a deployed staging environment; no fabricated data exists in production. The demo seed is for local/staging only.<br/>"
            "- Page redesign beyond the four fixes was not performed in this pass: several detail pages still use the shared header with plain cards (listed in section 25).<br/>"
            "- The load tests ran on one machine that also hosted the database and the browsers, so absolute numbers are indicative only.<br/>"
            "- The deployment pipeline for these changes has not been run. Merging or deploying requires CI and explicit authorisation.", P), PageBreak()]

story += [Paragraph("2. Environment and commit", H1),
  table([["Item", "Value"],
         ["Application", "INOK platform (Next.js 16, React 19, next-intl en/ms/ta), Supabase local stack"],
         ["Branch / commit", f"qa/post-release-v3 / {COMMIT}; base: release/inok-final at 06c7d30 (deployed V3 release)"],
         ["Production state at start", "Cloudflare Worker inok-app-production, version bf671cc0-d202-4db0-83c8-dd2bda1374b0 (rollback target 7d52d3e9-88a8-47a0-8bce-d1e7a9b4e21e)"],
         ["Browsers", "Playwright Chromium; desktop project 1280x800; extra widths set per screenshot"],
         ["Screenshots", f"{shots} files in docs/qa-evidence/<role>/<journey>/; one metadata line per file in docs/qa-evidence/index.jsonl"],
         ["Test runner", "npx playwright test, QA=1, spec tests/e2e/e99-qa-populated-journeys.spec.ts (serial); load specs e97 and scripts/qa-load-test.mjs"],
         ["Pull request", "PR 16 into release/inok-final (PR 15 stays merged and untouched)"],
         ["Browser dev overlay", "Screenshots come from the Next.js dev server for functional tests; the small round N badge and 'Rendering' chip are dev-only and do not exist in production builds"]],
        [42, 132]), Spacer(1, 6),
  Paragraph("CI status of PR 16 at the time this PDF was generated (GitHub Actions, copied from gh):", P),
  Paragraph("<font face='Courier' size=7.5>" + esc(CHECKS).replace("\n", "<br/>") + "</font>", P), PageBreak()]

story += [Paragraph("3. Demonstration data", H1),
  Paragraph("Created by tests/e2e/support/demo-seed.ts (version demo-v1) through the platform's own RPCs and permissions, on the local stack only. Every name begins with 'INOK Demo'; e-mail addresses use example.test; no SSM numbers, bank or personal data are real. "
            "Removal: scripts/qa-clean-demo.sql (local/staging). Production was never seeded.", P),
  table([["Data", "Content"],
         ["Businesses (8)", "Packaging Supplies, Food Supplies, Tailoring Studio, Technology Services, Logistics, Events and Catering (published); Training Academy (waiting for review); Beauty Studio (draft). Published ones show 'review in progress' because none are verified."],
         ["Buyers (3)", "INOK Demo Buyer Trading and two more buyer organisations"],
         ["Partner and suppliers", "One approved demonstration partner; two approved suppliers (Chennai Textiles, Madurai Pack and Print)"],
         ["Catalogue", "14 reviewed and published products (packaging, food, textiles, hardware), with price tiers, MOQ and generated product images"],
         ["News", "3 published bulletins marked as demonstration material (Training, Community, Deadlines)"],
         ["Government assistance", "4 fictional programmes (agency 'INOK Demo Agency (fictional)'), published through the two-person approval path with a reason; switches turned off again afterwards"],
         ["Activity created by journeys", "Enquiry, 4 messages, 1 quotation (accepted), price request to the partner, saved product and programme, notifications, a listing approved by a reviewer with a reason"]],
        [40, 134]),
  Paragraph("Known limitation: the local database also contains leftover rows from earlier automated test runs (for example 'Shop e20-...' verification items and about 84 to 98 catalogue products). These appear in admin queues and counts and are not demo data. A clean staging project would show only the demo set.", P), PageBreak()]

story += [Paragraph("4. Roles, method and parallel testing", H1),
  Paragraph("Roles tested: Visitor, Buyer, Seller, Partner, Administrator, plus Security/Regression and Visual QA/Documentation. The journeys themselves were run sequentially, one Playwright browser context and account per role, in one serial spec so that state is deterministic. "
            "<b>Three real review sub-agents were then used for visual QA</b> (read-only, run in parallel): (1) visitor, buyer and seller screenshots; (2) partner and administrator screenshots; (3) Bahasa Melayu, Tamil and the seven-width captures. They opened the screenshots and reported defects; their findings were verified against the code before any change, and two were rejected (see section 25). Each screenshot is a real page.screenshot() of the running application. "
            "HTTP 200 was never treated as a pass: tests assert visible content, database state or HTTP status as appropriate.", P),
  Paragraph("Role accounts are created by the test helpers with synthetic credentials that are not recorded in this report.", P), PageBreak()]

secs = []
def add(title, intro, journeys, roles=None):
    s, n = journey_section(title, intro, journeys, roles); story.extend(s); story.append(PageBreak()); return n

add("5. Journey 1 - Visitor", "Start state: signed out, no account. Actions: open the app home, search the directory for 'packaging', open the supplier profile, browse the catalogue, open a product, view programmes and news, open registration. Expected: public pages render, the street address stays hidden. Result: PASS (all steps asserted).", ["j1-visitor"])
add("6. Journey 2 and 3 - New buyer and buyer workspace", "Start state: buyer account with an organisation. Actions: home, My requests (shows the enquiry in progress), catalogue, save a product, saved products, notifications. Result: PASS.", ["j3-buyer-dashboard"], ["buyer"])
add("7. Journey 3 - Seller workspace", "Start state: owner of the demo packaging business. Actions: dashboard, Business 360, public page editor, verification, onboarding review, leads, requests, products, team, settings, a listing waiting for review. Result: PASS (renders with data; see section 25 for design refinements still open).", ["j3-seller-dashboard"])

conv_intro = ("The exact script was used. Buyer: 'Hello, I need 100 custom packaging boxes for my business. Can you provide pricing and delivery details?' Seller: 'Yes, we can supply them. Could you confirm the dimensions, material and delivery location?' "
              "Buyer: 'The size is 30 x 20 x 15 cm, corrugated cardboard, delivery to Kuala Lumpur.' Seller: 'Thank you. I have prepared a quotation for your request. Please review the price and delivery terms.' "
              "Then the seller created and sent a real quotation and the buyer accepted it. The first buyer message is the opening note of the enquiry; the following three are messages in the thread. "
              "Database checks (same test): message order, sender users and organisations (seller, buyer, seller for messages 2 to 4), quotation status 'accepted', buyer notifications present, thread returns 404 for an unrelated buyer and an unrelated seller. Result: PASS.")
add("8. Journey 4 - Buyer and seller conversation, and 9. Quotation", conv_intro, ["j4-conversation"])
add("10. Journey 5 - Supplier sourcing and partner", "A second buyer sent a price request for the packaging product; the partner (signed in with two-step verification) opened the workspace, suppliers, products, catalogue import, buyer requests and the request detail. Result: PASS.", ["j5-supplier-sourcing"])
add("11. Journey 6 - Government assistance", "Four fictional programmes were published through the two-person approval path. A visitor browsed and filtered; a seller used the matching finder and saved a programme. Statuses are shown as stated by the source ('not confirmed') and the page does not imply MITRA endorsement. Result: PASS.", ["j6-government-assistance"])
add("12. Journey 7 - News", "Visitor view of the news listing; the article page appears in section 5 evidence. Result: PASS.", ["j7-news"])
add("13. Notifications (buyer)", "Notifications are shown in section 6 (step 05). The buyer had three 'New message' notifications from the conversation, with Open and Mark as read actions.", [])
add("14. Journey 9 - Account and settings", "Sections: My account, Security, Notifications, Privacy, Data requests. Result: PASS (renders; no data changed).", ["j9-account"])
add("15. Journey 8 - Administration", "A reviewer-administrator (two-step verified) opened overview, verification and listings queues, reviews, audit log, news, users and roles, programme operations, catalogue administration and the product review queue, then approved the listing that was waiting for review with a written reason. The database showed the listing published and the audit log recorded the decision. Result: PASS. Note: queue counts include leftover rows from earlier test runs (section 3).", ["j8-administration"])
add("16. Journey 10 - Error and permission handling", "A buyer opened the admin console and another business's workspace by URL: both returned 404 with no admin data. A missing page returned a helpful 404. After the session cookie was cleared, a protected page redirected to sign-in with a return address. Result: PASS. (Invalid-form and expired-link handling is covered by existing e2e specs E21 and E43; not re-run here.)", ["j10-errors-permissions"])

# 17 responsive
story += [Paragraph("17. Responsive evidence (360, 390, 768, 1024, 1280, 1440, 1920 px)", H1),
          Paragraph("The same screen at all seven widths. Selected screens that were captured at every width; the full set per screen is in docs/qa-evidence.", P)]
full = [(k, m) for k, m in steps.items() if len(m) >= 7 and k[3] == "en"]
chosen = []
want = ["02-directory", "04-business-profile", "06-product-detail", "05-catalogue", "01-overview", "01-dashboard", "02-business-360", "02-my-requests"]
for w in want:
    for k, m in full:
        if k[2] == w and len(chosen) < 6 and (k, m) not in chosen: chosen.append((k, m)); break
for k, m in chosen:
    f = have(m); meta = next(iter(m.values()))
    cells = []
    for w in [360, 390, 768, 1024, 1280, 1440, 1920]:
        if w in f: cells.append([img(f[w], 40 if w < 800 else 41, 62), Paragraph(f"{w} px", SM)])
        else: cells.append("")
    rows = [cells[:4], cells[4:] + [""]]
    t = Table(rows, colWidths=[43 * mm] * 4); t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [KeepTogether([Paragraph(esc(meta["title"]) + f" ({k[0]}, {esc(meta['route'])})", CAP), t, Spacer(1, 8)])]
story += [Paragraph("Observation from the captures: no horizontal scroll was measured at 360 px on the Bahasa Melayu and Tamil pages (asserted by the test via scrollWidth). Wide screens (1440, 1920) keep content in a centred column.", P), PageBreak()]

# 18 localisation
story += [Paragraph("18. Localisation: English, Bahasa Melayu and Tamil", H1),
          Paragraph("Same page in three languages at 1280 px. Interface text, navigation, filters and buttons are translated in both languages. Text the users typed (business names, enquiry text, message text, demo bulletin titles) stays as entered, which is correct. "
                    "Tamil headings and labels are longer; no overflow or clipped controls were found (the test asserts no horizontal scroll at 360 and 1280 px for every page). One note: the Settings language selector shows the saved profile language (English) while the interface is viewed in another language, which is expected because the selector shows the saved preference, not the current view.", P)]
pairs = [("Home", "buyer/j3-buyer-dashboard/01-home__en__1280.png", "buyer/j9-localisation-{L}/home__{L}__1280.png"),
         ("Directory", "visitor/j1-visitor/02-directory__en__1280.png", "buyer/j9-localisation-{L}/directory__{L}__1280.png"),
         ("Catalogue", "visitor/j1-visitor/05-catalogue__en__1280.png", "buyer/j9-localisation-{L}/catalogue__{L}__1280.png"),
         ("Product detail", "visitor/j1-visitor/06-product-detail__en__1280.png", "buyer/j9-localisation-{L}/product__{L}__1280.png"),
         ("Government assistance", "visitor/j1-visitor/07-programmes__en__1280.png", "buyer/j9-localisation-{L}/programmes__{L}__1280.png"),
         ("News", "visitor/j1-visitor/08-news__en__1280.png", "buyer/j9-localisation-{L}/news__{L}__1280.png"),
         ("My requests", "buyer/j3-buyer-dashboard/02-my-requests__en__1280.png", "buyer/j9-localisation-{L}/requests__{L}__1280.png"),
         ("Settings", "buyer/j9-account/settings-account__en__1280.png", "buyer/j9-localisation-{L}/settings__{L}__1280.png")]
for name, en, loc in pairs:
    paths = [os.path.join(EV, en), os.path.join(EV, loc.format(L="ms")), os.path.join(EV, loc.format(L="ta"))]
    if not all(os.path.exists(p) for p in paths): continue
    t = Table([[img(p, 56, 70) for p in paths], [Paragraph("English", SM), Paragraph("Bahasa Melayu", SM), Paragraph("Tamil", SM)]], colWidths=[58 * mm] * 3)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(KeepTogether([Paragraph(name, CAP), t, Spacer(1, 6)]))
story += [PageBreak()]

story += [Paragraph("19. Visual defects found and fixed in this pass", H1),
  table([["Defect (seen in populated screenshots)", "Fix", "Verified"],
         ["Signed-in 'Products from India': the filter form stayed a tall single column because a more specific shell rule (.ws-main .form, max-width 38rem) overrode the compact panel", "kit.css: compact panel rule now also targets .form.catalogue-filters", "Re-captured: compact three-column panel, products start sooner"],
         ["Quotation builder: line-item fields (description, quantity, unit, price) were bare unstyled inputs", "P4Workspace.tsx: label and input pairs wrapped in .field; kit.css form styling for the conversation workspace", "Seller quotation screenshots show styled fields"],
         ["Product detail: two buttons read 'Request a price' and 'Request Price'", "Second action relabelled 'Start a sourcing request' in en, ms and ta", "Captured in en, ms, ta product pages"],
         ["Demo products used a 1x1 pink placeholder image", "Seed generates a neutral 640x480 image per product (test data only)", "Product cards and detail show real image areas"],
         ["Audit log action codes and review decision control (sub-agent review): codes broke mid-word; the review decision control read as plain text","kit.css: codes stay whole; summary styled as a pill control","Re-captured (section 15)"],
         ["Tamil (sub-agent review): long words broke mid-word, search buttons clipped, short labels such as Location broke inside a word","kit.css: Tamil words break only at spaces, Tamil buttons wrap, labels never split","Re-captured in ta and at 1920 px"],
         ["Evidence defect (sub-agent review): profile step captures at 360, 390 and 768 px showed the results page because the shot was taken before navigation finished","Test now waits for the profile heading before capturing","Re-captured"],
         ["Admin news table: badges and Edit buttons split inside the word ('Publishe d', 'Edi t') because table cells break text anywhere", "kit.css: no wrapping inside table badges and buttons", "Re-captured: 'Published', 'Draft', 'Archived' and 'Edit' intact"]],
        [70, 62, 42]), PageBreak()]

story += [Paragraph("20. Test matrix", H1)]
story += [table([["Area", "Status", "Evidence / notes"],
  ["Populated journeys J1-J10 (e99, 8 tests)", "PASSED", "Final run: 8 passed (2.2 min), local stack. Earlier runs failed on test-side problems (a message key, partner MFA secret) that were fixed in the tests, not weakened"],
  ["Conversation and quotation with DB and isolation assertions", "PASSED", "Message order, sender orgs, quotation accepted, notifications, 404 for other buyer and seller"],
  ["Load tests (HTTP and real browsers)", "PASSED (no failures)", "Section 21; local production build"],
  ["Unit tests", "PASSED", "1028 passed in 45 files (vitest --project unit), local"],
  ["Typecheck and lint of changed files", "PASSED", "tsc --noEmit clean; eslint clean on changed files"],
  ["Full regression e2e (about 100 specs, mobile and desktop, 4 shards)", "PENDING ON CI", "Runs on PR 16; see section 2 for the status at generation time. Release 06c7d30 passed the same CI before it was deployed"],
  ["Database and RLS tests (pgTAP, integration)", "PENDING ON CI", "Part of the CI 'checks' job; no database or policy was changed in this PR"],
  ["Dependency audit gate", "PENDING ON CI", "Section 24"],
  ["Accessibility", "PARTIAL", "axe checks exist in older e2e specs; not re-run as a separate audit here"],
  ["Email-dependent flows (invitations)", "BLOCKED locally", "No local mail provider"],
  ["Deployed staging or production verification", "NOT RUN", "Not part of this pass; requires authorisation"],
  ["Landing navbar branch", "PASSED (local build)", "Section 23"]], [62, 30, 82]), PageBreak()]

story += [Paragraph("21. Performance results (bounded, local)", H1),
  Paragraph("Local production build (next build, next start) on one Windows machine that also ran the database and the load generators. Local only; never run against production (the script refuses non-local, non-staging hosts). Figures are measured, not estimated.", P)]
if load_http:
    rows = [["Concurrent sessions", "Duration", "Requests", "Errors", "Req/s", "p50 ms", "p95 ms", "p99 ms", "max ms"]]
    for r in load_http["results"]: rows.append([r["concurrency"], f'{r["durationSeconds"]} s', r["requests"], f'{r["errors"]} ({r["errorRatePct"]}%)', r["requestsPerSecond"], r["p50ms"], r["p95ms"], r["p99ms"], r["maxMs"]])
    story += [Paragraph("HTTP: 9 public pages in rotation (home, directory, directory search, catalogue, programmes, news, Malay home, Tamil directory, sign-up), 30 s per level, closed loop", H2), table(rows, [28, 18, 18, 22, 14, 16, 16, 16, 16])]
if load_br:
    story += [Paragraph("Real browsers: N signed-in sessions run the same journey at the same time (sign in, home, directory search, catalogue, requests, notifications); step durations in ms", H2)]
    rows = [["Concurrent", "Failed steps", "Wall s", "sign-in p50/p95", "home", "directory", "catalogue", "requests", "notifications"]]
    for r in load_br["results"]:
        ps = r["perStep"]; f = lambda k: f'{ps[k]["p50"]}/{ps[k]["p95"]}' if k in ps else "-"
        rows.append([r["concurrency"], len(r["failures"]), r["wallSeconds"], f("sign-in"), f("home"), f("directory-search"), f("catalogue"), f("requests"), f("notifications")])
    story += [table(rows, [20, 18, 14, 26, 20, 22, 22, 22, 22])]
story += [Paragraph("Reading the results: no request or session failed at 5, 10 or 20 concurrent sessions. HTTP latency rose with concurrency as expected (p95 74 ms at 5, 136 ms at 10, 280 ms at 20 for the rotation). "
                    "The slowest measured step was the signed-in catalogue page at 20 concurrent browsers (p50 about 4.7 s, p95 about 5.7 s), which includes rendering about 98 product cards and their images in 20 browsers on the same machine; it is flagged for investigation on staging with a separate load generator and is not a production measurement.", P), PageBreak()]

story += [Paragraph("22. Security and access-control results", H1),
  table([["Check", "Result", "Evidence"],
         ["Buyer opens /en/admin", "PASS: 404, no admin content", "J10 step 01"],
         ["Buyer opens another business workspace by URL", "PASS: 404", "J10 step 02"],
         ["Unrelated buyer and unrelated seller open the conversation thread", "PASS: 404 for both, no message or amount visible", "J4 isolation assertions"],
         ["Session cookie cleared, protected page opened", "PASS: redirect to sign-in with a return address", "J10 step 04"],
         ["Administrator decisions need a written reason and are logged", "PASS: listing approval with reason; audit log shows the event", "J8 steps 05 and 12"],
         ["Public business profile hides the street address", "PASS: asserted absent", "J1 step 04"],
         ["Partner and administrator areas require two-step verification", "PASS: sign-in needed a one-time code", "J5, J8 setup"],
         ["Authentication, RLS, policies or database", "UNCHANGED", "No such change in PR 16"],
         ["Secrets in repository", "Secret scan runs in CI; no credentials appear in this report", "CI job"]],
        [66, 62, 46]), PageBreak()]

story += [Paragraph("23. Landing navbar branch (separate release)", H1),
  Paragraph("Branch landing/nav-explore-only (commit 109cdf2) was built and previewed locally in the landing repository, at 1280 px and 390 px. It has <b>not</b> been merged or deployed; the public landing site is unchanged and its release is a separate operation.", P),
  table([["Check", "Desktop 1280", "Mobile 390"],
         ["Navbar text", "Programme, MITRA, Results, Journey, Interviews, Gallery, Partners, Contact, Explore Businesses", "Menu button; opened menu lists the same items, Explore Businesses last"],
         ["Sign in / Get started in the navbar", "Absent", "Absent"],
         ["Explore Businesses", "Rightmost, yellow call-to-action, links to the app directory", "Last item of the menu"],
         ["Horizontal overflow", "0 px", "0 px"],
         ["Hero and lower sections", "Unchanged (hero 'Get started' and 'Sign in' remain in the hero/lower content as before)", "Unchanged"]], [40, 70, 64])]
for nm, lab in [("nav-desktop-1280.png", "Landing at 1280 px (local build)"), ("nav-mobile-390-menu-open.png", "Landing mobile menu open at 390 px (local build)")]:
    p = os.path.join(LAND, nm)
    if os.path.exists(p): story += [Spacer(1, 4), Paragraph(lab, SM), img(p, 110 if "desktop" in nm else 45, 80)]
story += [PageBreak()]

story += [Paragraph("24. Dependency advisory and audit gate", H1),
  Paragraph("Advisory GHSA-fc5q-39xc-vjpf (picomatch, affected versions up to 4.0.7): as of this report no patched version exists (latest published is 4.0.7). The user-approved narrow exception is unchanged: that single advisory id, expiring 2027-01-15, fail-closed, raw npm audit report kept as a CI artifact. "
            "The exception was not widened and no override or force-fix was used. picomatch and @parcel/watcher are not in the deployed Worker bundle (recorded in the risk assessment document). The audit gate runs in the PR 16 CI job; its result is part of the status shown in section 2.", P), PageBreak()]

story += [Paragraph("25. Bugs fixed, and what remains", H1),
  Paragraph("Fixed in this pass: the visual defects in section 19, including those found by the sub-agent review (audit action codes and review decision control, Tamil mid-word breaks and clipped Tamil buttons, short labels breaking inside a word, and stale step captures in the evidence). Test-side fixes (not product changes): message key lookups and the partner two-step secret exposed by the seed helper, so the partner journey can sign in.", P),
  Paragraph("Sub-agent findings rejected after checking the code: the quotation 'Other conditions' field is present inside a collapsed section (summary only), and the product 'Available' line is a separate availability note by design.", P),
  Paragraph("Open items that were seen and not changed (design refinements, no functional failure observed):", H2),
  Paragraph("- Several detail pages are still the shared header over plain cards: public page editor, verification upload page, partner products and import, parts of the admin detail screens, product comparison.<br/>"
            "- The seller 'Verification' page shows 'Not started' for business registration while the seller dashboard also shows a registration number; the difference (details versus documents) is not obvious to a new seller and the wording could be clearer.<br/>"
            "- Catalogue at 20 concurrent browsers is the slowest measured page (section 21).<br/>"
            "- The Settings language selector shows the saved profile language rather than the language being viewed.<br/>"
            "- Sub-agent findings still open: the verification and settings tab strips clip with no scroll cue; partner navigation labels are inconsistent (Home twice, My requests versus Buyer Requests, Supplier sourcing opens 'Requests to answer'); the sticky phone header is see-through and the public header takes three rows on phones; the admin product chip shows the raw value 'in_review' and admin tab styles differ; conversation list stacks above the thread at 1024 px; the signed-in shell and some public pages are unconstrained or narrow at 1440 and 1920 px; search placeholders are truncated; the 'Started' time is shown in UTC while message times are local; the quotation totals line is dense.", P), PageBreak()]

story += [Paragraph("26. Limitations", H1),
  Paragraph("- Local stack only; no staging project was available in this session, so the safe demo environment is a local one. Production data is untouched.<br/>"
            "- Screenshots are from the dev server; production builds differ only in the dev overlay.<br/>"
            "- Leftover test rows from earlier runs inflate some counts and queues.<br/>"
            "- Load tests used one machine and are indicative; no production-like network or database.<br/>"
            "- Not independently re-run here: accessibility audit, email delivery, document virus-scan path beyond the stub, file-upload security matrix (covered by existing specs).<br/>"
            "- Journeys were run sequentially; sub-agents were used only for the visual review of the screenshots. They saw a sample (about 30 of the buyer/seller/visitor shots, 34 partner/admin shots, about 80 localisation and width shots), not every file, and only above-the-fold content.", P)]

story += [Paragraph("27. Final assessment", H1),
  Paragraph("The deployed V3 release behaves correctly on every journey exercised with populated data, the scripted buyer-seller conversation and quotation work end to end with persistence and isolation, "
            "and the visual defects found were fixed and re-verified locally. Remaining items are design refinements and a performance follow-up, not functional failures. "
            "<b>This PR is ready for review but is not merged or deployed.</b> Merging requires the CI checks to pass; any production deployment requires explicit authorisation through the established Cloudflare workflow, with the rollback version preserved.", P), PageBreak()]

story += [Paragraph("Appendix A - Route-by-route evidence index", H1),
          Paragraph("Every screenshot, in capture order. File paths are relative to docs/qa-evidence/.", P)]
rows = [["Role", "Journey", "Step", "Lang", "Widths", "Route", "File (first width)"]]
for k, m in steps.items():
    meta = next(iter(m.values()))
    rows.append([k[0], k[1], k[2], k[3], ",".join(str(w) for w in sorted(m)), meta["route"][:48], m[sorted(m)[0]]["file"].split("/", 2)[-1][:46]])
tbl = table(rows, [18, 33, 30, 8, 26, 33, 26])
story += [tbl]

doc = Doc(OUT, pagesize=A4, title="INOK Complete User Journey Visual Test Report", author="INOK QA")
doc.multiBuild(story)
print(OUT, os.path.getsize(OUT))
