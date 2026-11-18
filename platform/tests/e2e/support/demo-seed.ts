// Reproducible, versioned demonstration data for QA and screenshots. LOCAL/STAGING ONLY: it creates users through the same Supabase admin API
// and RPCs the end-to-end tests use. Everything is clearly synthetic: names start with "INOK Demo", emails are demo-*@example.test, there are no
// real SSM numbers (random 12-digit placeholders) and no real businesses. Never run this against production.
// Remove it again with removeDemo(). Version: bump DEMO_VERSION when the fixture shape changes.
import { crc32, deflateSync } from 'node:zlib';
import { createOrgAs, createUser, serviceClient, sql, type TestUser, type Signed } from './db';
import { makePartner, makeProduct, makeReviewer, makeSupplier, type Partner, type Product, type Supplier } from './p5-buyer';

/** A plain 640x480 PNG (soft two-tone gradient with a burgundy band) so demo product cards have a neutral picture. No text, no logos. */
export function demoPng(seed: number): Buffer {
  const w = 640, h = 480;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const hue = [[241, 245, 249], [252, 238, 242], [254, 247, 230], [236, 244, 240]][seed % 4]!;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = y > h - 70 && y < h - 40;
      const k = 0.82 + 0.18 * (1 - y / h);
      raw[o] = band ? 152 : Math.round(hue[0]! * k);
      raw[o + 1] = band ? 27 : Math.round(hue[1]! * k);
      raw[o + 2] = band ? 64 : Math.round(hue[2]! * k);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const DEMO_VERSION = 'demo-v1';

export interface DemoBusiness {
  name: string;
  category: string;
  state: string;
  district: string;
  headline: string;
  description: string;
  stage: 'published' | 'in_review' | 'draft';
  owner: TestUser;
  orgId: string;
}
export interface DemoBuyer {
  user: TestUser;
  orgId: string;
  orgName: string;
}
export interface DemoData {
  version: string;
  reviewer: Signed;
  reviewerUserId: string;
  businesses: DemoBusiness[];
  buyers: DemoBuyer[];
  partner: Partner;
  suppliers: Supplier[];
  products: Product[];
}

async function asUser(userId: string, body: string, aal = 'aal1') {
  await sql(`do $do$ begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated', 'aal', '${aal}')::text, true);
    set local role authenticated;
    ${body}
  end $do$`);
}

const BUSINESSES: Omit<DemoBusiness, 'owner' | 'orgId'>[] = [
  { name: 'INOK Demo Packaging Supplies', category: 'manufacturing', state: 'Selangor', district: 'Shah Alam', headline: 'Custom corrugated and printed packaging boxes', description: 'We make corrugated boxes, mailer boxes and printed packaging for small food and retail businesses. Minimum order 50 pieces; delivery across the Klang Valley within ten working days.', stage: 'published' },
  { name: 'INOK Demo Food Supplies', category: 'food-beverage', state: 'Johor', district: 'Johor Bahru', headline: 'Fresh spice blends and catering ingredients', description: 'Spice blends, rice and cooking essentials for restaurants and caterers in Johor and Singapore-bound shipments. Weekly deliveries.', stage: 'published' },
  { name: 'INOK Demo Tailoring Studio', category: 'tailoring-apparel', state: 'W.P. Kuala Lumpur', district: 'Brickfields', headline: 'Uniforms, sarees and custom tailoring', description: 'School and company uniforms, blouse stitching and festive wear. Group orders welcome, fittings by appointment.', stage: 'published' },
  { name: 'INOK Demo Technology Services', category: 'tech-digital', state: 'Pulau Pinang', district: 'Georgetown', headline: 'Websites and point-of-sale set-up for small shops', description: 'Simple websites, online ordering and POS set-up for small retailers. Bilingual support in English, Bahasa Melayu and Tamil.', stage: 'published' },
  { name: 'INOK Demo Logistics', category: 'transport-logistics', state: 'Selangor', district: 'Klang', headline: 'Same-day and next-day deliveries in the Klang Valley', description: 'Small-load deliveries, van hire with driver and last-mile delivery for online sellers.', stage: 'published' },
  { name: 'INOK Demo Events and Catering', category: 'events-hospitality', state: 'Perak', district: 'Ipoh', headline: 'Wedding and community event catering', description: 'Vegetarian and non-vegetarian catering for weddings, temple events and company functions, with decoration add-ons.', stage: 'published' },
  { name: 'INOK Demo Training Academy', category: 'education-training', state: 'Negeri Sembilan', district: 'Seremban', headline: 'Digital skills and bookkeeping courses', description: 'Short courses for shop owners in digital marketing and basic bookkeeping.', stage: 'in_review' },
  { name: 'INOK Demo Beauty Studio', category: 'beauty-wellness', state: 'Melaka', district: 'Melaka Tengah', headline: 'Hair and bridal beauty services', description: 'Salon services and bridal packages.', stage: 'draft' },
];

export async function seedDemo(): Promise<DemoData> {
  const reviewer = await makeReviewer();
  const reviewerUserId = reviewer.user.id;
  const businesses: DemoBusiness[] = [];
  for (const [i, b] of BUSINESSES.entries()) {
    const owner = await createUser(`demo-seller-${i + 1}`, { name: `Demo Owner ${i + 1}` });
    const orgId = await createOrgAs(owner, 'business', b.name);
    const ssm = String(Math.floor(Math.random() * 9e11) + 1e11); // placeholder digits, not a real registration
    const profile = {
      business_name: b.name, category_slug: b.category, registration_status: 'registered', ssm_number: ssm, business_type: 'sdn_bhd',
      state: b.state, district: b.district, address_line: '1 Jalan Demo', postcode: '47500', contact_phone: '+60 3 0000 0000', contact_email: 'demo@example.test', description: b.description,
    };
    const draft = {
      headline: b.headline, description: b.description,
      services: [{ name: b.headline, category_slug: b.category, nationwide: i % 2 === 0, areas: [b.state] }],
      portfolio: [], show_phone: false,
    };
    if (b.stage !== 'draft') {
      await asUser(owner.id, `perform public.save_business_profile('${orgId}', $j$${JSON.stringify(profile)}$j$::jsonb);
        perform public.save_listing_draft('${orgId}', $j$${JSON.stringify(draft)}$j$::jsonb, 0);
        perform public.submit_listing('${orgId}', 1);`);
      if (b.stage === 'published') await asUser(reviewerUserId, `perform public.review_listing('${orgId}', 'approve', null, 1);`, 'aal2');
    } else {
      await asUser(owner.id, `perform public.save_business_profile('${orgId}', $j$${JSON.stringify(profile)}$j$::jsonb);`);
    }
    businesses.push({ ...b, owner, orgId });
  }

  const buyers: DemoBuyer[] = [];
  for (const [i, n] of ['INOK Demo Buyer Trading', 'INOK Demo Caterers Buying Group', 'INOK Demo Retail Buyer'].entries()) {
    const user = await createUser(`demo-buyer-${i + 1}`, { name: `Demo Buyer ${i + 1}` });
    buyers.push({ user, orgId: await createOrgAs(user, 'buyer', n), orgName: n });
  }

  const partner = await makePartner('demo-partner');
  const suppliers = [
    await makeSupplier(partner, reviewer, { name: 'INOK Demo Chennai Textiles', country: 'India', stateCity: 'Chennai' }),
    await makeSupplier(partner, reviewer, { name: 'INOK Demo Madurai Pack and Print', country: 'India', stateCity: 'Madurai' }),
  ];
  const specs: { s: number; name: string; category: string; moq: number; mode: 'tiers' | 'fixed' | 'request'; unit?: string; desc: string }[] = [
    { s: 0, name: 'Cotton saree, handloom, 6 m', category: 'textiles-apparel', moq: 20, mode: 'tiers', desc: 'Handloom cotton saree with woven border, six metres.' },
    { s: 0, name: 'School uniform fabric, 100 m roll', category: 'textiles-apparel', moq: 5, mode: 'fixed', desc: 'Poly-cotton uniform fabric in navy and white.' },
    { s: 0, name: 'Silk scarf, hand block printed', category: 'textiles-apparel', moq: 30, mode: 'tiers', desc: 'Block-printed silk scarf in assorted colours.' },
    { s: 0, name: 'Cotton kurta set, men', category: 'textiles-apparel', moq: 25, mode: 'tiers', desc: 'Festive kurta and pyjama set in sizes M to XXL.' },
    { s: 0, name: 'Brass puja lamp, medium', category: 'religious-items-puja', moq: 10, mode: 'request', desc: 'Traditional brass lamp, hand polished.' },
    { s: 0, name: 'Camphor and incense gift pack', category: 'religious-items-puja', moq: 40, mode: 'fixed', desc: 'Gift pack for festivals, sealed packaging.' },
    { s: 1, name: 'Corrugated packaging box, 30 x 20 x 15 cm', category: 'packaging', moq: 100, mode: 'tiers', desc: 'Five-ply corrugated box with optional single-colour logo print.' },
    { s: 1, name: 'Printed paper carry bag, medium', category: 'packaging', moq: 500, mode: 'tiers', desc: 'Kraft paper carry bag with handle, one-colour print.' },
    { s: 1, name: 'Food-grade aluminium foil container', category: 'packaging', moq: 1000, mode: 'fixed', desc: 'Takeaway foil container with lid, 750 ml.' },
    { s: 1, name: 'Mailer box for online sellers', category: 'packaging', moq: 200, mode: 'tiers', desc: 'Flat-pack mailer box, tuck-in lid.' },
    { s: 0, name: 'Stainless steel cooking vessel set', category: 'home-kitchen', moq: 15, mode: 'tiers', desc: 'Set of three vessels with lids.' },
    { s: 0, name: 'Spice grinder, tabletop', category: 'home-kitchen', moq: 10, mode: 'request', desc: 'Stone and steel tabletop grinder.' },
    { s: 1, name: 'Notebook, ruled, 200 pages', category: 'stationery-books', moq: 300, mode: 'fixed', desc: 'Stitched notebook for schools and offices.' },
    { s: 0, name: 'Turmeric powder, 1 kg pack', category: 'spices-condiments', moq: 50, mode: 'tiers', desc: 'Stone-ground turmeric, food grade.' },
  ];
  const products: Product[] = [];
  for (const [pi, sp] of specs.entries()) {
    products.push(await makeProduct(suppliers[sp.s]!, reviewer, { name: sp.name, category: sp.category, moq: sp.moq, mode: sp.mode, currency: 'INR', description: sp.desc, image: true, imageBuffer: demoPng(pi), unitPrice: '120.00' }));
  }

  // Published news (clearly demonstration items; production news is separate)
  await sql(`delete from public.news_posts where title like 'INOK Demo bulletin%'`);
  for (const [i, t] of ['INOK Demo bulletin: small-business digital skills session', 'INOK Demo bulletin: how to prepare for a supplier enquiry', 'INOK Demo bulletin: reminder to keep your listing details current'].entries()) {
    await sql(`insert into public.news_posts (title, summary, body, category, sectors, status, publish_at) values ($1, $2, $3, $5, '{}', 'published', now() - ($4 || ' days')::interval)`,
      [t, 'Demonstration bulletin used for screenshots only; not real news.', `${t}.\n\nThis text is fictional demonstration content for quality assurance. It contains no real announcement, date or deadline.`, String(i), ['training', 'community', 'deadlines'][i]]);
  }
  return { version: DEMO_VERSION, reviewer, reviewerUserId, businesses, buyers, partner, suppliers, products };
}

/** Removes demo users (cascades to their data where the schema cascades) and demo news. Safe to run more than once. */
export async function removeDemo(): Promise<void> {
  await sql(`delete from public.news_posts where title like 'INOK Demo bulletin%'`);
  const svc = serviceClient();
  const users = await sql<{ id: string }>(`select id from auth.users where email like 'demo-%@example.test'`);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}
