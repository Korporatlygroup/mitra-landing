import { afterAll, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createConfirmedUser, serviceClient, signIn, sql, uniq } from './helpers';

afterAll(cleanupUsers);

it('erases referral participants without orphaned conversations or exposed author identities', async () => {
  const [buyer, buyerColleague, referrer, recipient, outsider] = await Promise.all([
    createConfirmedUser('erase-buyer'), createConfirmedUser('erase-colleague'),
    createConfirmedUser('erase-referrer'), createConfirmedUser('erase_recipient'),
    createConfirmedUser('erase-outsider'),
  ]);
  const name = uniq('Erase');
  const [b, s, r] = await sql<{ id: string }>(
    `insert into public.organisations(type,name,created_by) values
       ('buyer',$1,$4),('business',$2,$5),('business',$3,$6) returning id`,
    [name + ' Buyer', name + ' Seller', name + ' Recipient', buyer.id, referrer.id, recipient.id],
  );
  const buyerOrg = b!.id, referrerOrg = s!.id, recipientOrg = r!.id;
  await sql(
    `insert into public.memberships(org_id,user_id,role) values
      ($1,$4,'owner'),($1,$5,'staff'),($2,$6,'owner'),($3,$7,'owner')`,
    [buyerOrg, referrerOrg, recipientOrg, buyer.id, buyerColleague.id, referrer.id, recipient.id],
  );
  const [source, opened] = await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
       values ($1,$2,'listing','Synthetic referral source',$1,$4),
              ($1,$3,'referral','Synthetic recipient enquiry',$3,$5) returning id`,
    [buyerOrg, referrerOrg, recipientOrg, buyer.id, recipient.id],
  );
  const [referral] = await sql<{ id: string }>(
    `insert into public.referral_suggestions
      (enquiry_id,referrer_seller_org_id,proposed_seller_org_id,buyer_org_id,status,buyer_consented_at,recipient_accepted_at,created_by)
      values ($1,$2,$3,$4,'recipient_accepted',now(),now(),$5) returning id`,
    [source!.id, referrerOrg, recipientOrg, buyerOrg, referrer.id],
  );
  await sql('insert into public.referral_handoffs(referral_id,enquiry_id,opened_by) values ($1,$2,$3)',
    [referral!.id, opened!.id, recipient.id]);
  await sql(`insert into public.enquiry_messages(enquiry_id,sender_user_id,sender_org_id,body)
    values ($1,$2,$3,'Synthetic commercial conversation')`, [opened!.id, recipient.id, recipientOrg]);
  await sql(`insert into public.quotations(enquiry_id,seller_org_id,buyer_org_id,created_by)
    values ($1,$2,$3,$4)`, [opened!.id, recipientOrg, buyerOrg, recipient.id]);
  await sql(`insert into public.lead_activities(enquiry_id,seller_org_id,actor_user_id,stage,note)
    values ($1,$2,$3,'contacted','Synthetic follow-up')`, [opened!.id, recipientOrg, recipient.id]);
  await sql(`insert into public.business_reviews(enquiry_id,buyer_org_id,seller_org_id,author_user_id,rating,review_text)
    values ($1,$2,$3,$4,4,'Synthetic buyer review text')`, [opened!.id, buyerOrg, recipientOrg, buyer.id]);
  await sql(`insert into public.audit_log(actor_user_id,org_id,action,entity_type,entity_id,details)
    values ($1,$2,'erasure.test','referral',$3,jsonb_build_object('user_id',$1::uuid::text,'email',$4::text))`,
    [recipient.id, recipientOrg, referral!.id, recipient.email]);
  await sql(`insert into public.audit_log(actor_user_id,org_id,action,entity_type,entity_id,details)
    values ($1,$2,'erasure.cross_org','referral',$3,jsonb_build_object('seller_org_id',$4::uuid::text))`,
    [buyerColleague.id, buyerOrg, referral!.id, referrerOrg]);
  const nearEmail = recipient.email.replace('_', 'x');
  await sql(`insert into public.audit_log(actor_user_id,org_id,action,entity_type,entity_id,details)
    values ($1,$2,'erasure.neighbour','referral',$3,jsonb_build_object('email',$4::text))`,
    [buyerColleague.id, buyerOrg, referral!.id, nearEmail]);
  await sql(`insert into public.listing_events(org_id,actor_user_id,event,details)
    values ($1,$2,'submitted',jsonb_build_object('email',$3::text))`,
    [recipientOrg, recipient.id, recipient.email]);
  await sql(`insert into public.verification_events(claim_id,org_id,actor_user_id,event,details)
    values (gen_random_uuid(),$1,$2,'claim_created',jsonb_build_object('email',$3::text))`,
    [recipientOrg, recipient.id, recipient.email]);

  for (const user of [referrer, recipient, buyer]) {
    const deleted = await serviceClient().auth.admin.deleteUser(user.id);
    expect(deleted.error, `deleting ${user.id}`).toBeNull();
  }
  const authorIds = await sql<{
    enquiry_creator: string | null; sender: string | null; quote_creator: string | null;
    lead_actor: string | null; review_author: string | null; referral_creator: string | null; handoff_opener: string | null;
  }>(
    `select e.created_by enquiry_creator,m.sender_user_id sender,q.created_by quote_creator,
            l.actor_user_id lead_actor,v.author_user_id review_author,
            f.created_by referral_creator,h.opened_by handoff_opener
       from public.enquiries e join public.enquiry_messages m on m.enquiry_id=e.id
       join public.quotations q on q.enquiry_id=e.id
       join public.lead_activities l on l.enquiry_id=e.id
       join public.business_reviews v on v.enquiry_id=e.id
       join public.referral_handoffs h on h.enquiry_id=e.id
       join public.referral_suggestions f on f.id=h.referral_id where e.id=$1`,
    [opened!.id],
  );
  expect(Object.values(authorIds[0]!)).toEqual(Array(7).fill(null));
  const audit = await sql<{ action: string; at: string; actor_user_id: string | null; details: unknown }>(
    `select action,at,actor_user_id,details from public.audit_log where action='erasure.test' and entity_id=$1`, [referral!.id],
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ action: 'erasure.test', actor_user_id: null, details: {} });
  const neighbour = await sql<{ details: { email: string } }>(
    `select details from public.audit_log where action='erasure.neighbour' and entity_id=$1`, [referral!.id]);
  expect(neighbour[0]!.details.email).toBe(nearEmail);
  for (const table of ['listing_events', 'verification_events']) {
    const events = await sql<{ actor_user_id: string | null; details: unknown }>(
      `select actor_user_id,details from public.${table} where org_id=$1`, [recipientOrg]);
    expect(events.some((row) => row.actor_user_id === recipient.id)).toBe(false);
    expect(events.some((row) => JSON.stringify(row.details).includes(recipient.email))).toBe(false);
  }
  await expect(sql('update public.audit_log set action=action where action=$1', ['erasure.test'])).rejects.toMatchObject({ code: '42501' });

  const colleague = await signIn(buyerColleague);
  const outsiderClient = await signIn(outsider);
  expect((await colleague.client.from('enquiries').select('id').eq('id', opened!.id)).data).toHaveLength(1);
  expect((await outsiderClient.client.from('enquiries').select('id').eq('id', opened!.id)).data).toEqual([]);
  await sql('delete from public.organisations where id=$1', [referrerOrg]);
  const crossOrgAudit = await sql<{ org_id: string; actor_user_id: string; details: unknown }>(
    `select org_id,actor_user_id,details from public.audit_log
      where action='erasure.cross_org' and entity_id=$1`, [referral!.id]);
  expect(crossOrgAudit[0]).toMatchObject({ org_id: buyerOrg, actor_user_id: buyerColleague.id, details: {} });
  expect((await sql('select id from public.referral_suggestions where id=$1', [referral!.id]))).toHaveLength(0);
  expect((await sql('select referral_id from public.referral_handoffs where referral_id=$1', [referral!.id]))).toHaveLength(0);
  expect((await sql('select id from public.enquiries where id=$1', [opened!.id]))).toHaveLength(1);
  await sql('delete from public.organisations where id=$1', [recipientOrg]);
  expect((await sql('select id from public.enquiries where id=$1', [opened!.id]))).toHaveLength(0);
  expect((await sql('select id from public.quotations where enquiry_id=$1', [opened!.id]))).toHaveLength(0);
  expect((await sql('select id from public.enquiry_messages where enquiry_id=$1', [opened!.id]))).toHaveLength(0);
  expect((await colleague.client.from('enquiries').select('id').eq('id', opened!.id)).data).toEqual([]);
  const auditAfterOrgDelete = await sql<{ at: string; org_id: string | null; details: unknown }>(
    `select at,org_id,details from public.audit_log where action='erasure.test' and entity_id=$1`, [referral!.id],
  );
  expect(auditAfterOrgDelete[0]).toMatchObject({ org_id: null, details: {} });
  await sql('delete from public.organisations where id=$1', [buyerOrg]);
  await anonClient().auth.signOut();
});

it('deleting a buyer organization cascades an accepted referral, opened enquiry and immutable quote history', async () => {
  const [buyer, referrer, recipient] = await Promise.all([
    createConfirmedUser('erase2-buyer'), createConfirmedUser('erase2-referrer'), createConfirmedUser('erase2-recipient'),
  ]);
  const [b] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['buyer', uniq('Erase buyer'), buyer.id]);
  const [s] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['business', uniq('Erase seller'), referrer.id]);
  const [r] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['business', uniq('Erase recipient'), recipient.id]);
  const [source] = await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
       values ($1,$2,'listing','Synthetic erasure source',$1,$3) returning id`, [b!.id,s!.id,buyer.id]);
  const [opened] = await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
       values ($1,$2,'referral','Synthetic erasure recipient',$2,$3) returning id`, [b!.id,r!.id,recipient.id]);
  const [referral] = await sql<{ id: string }>(
    `insert into public.referral_suggestions
       (enquiry_id,referrer_seller_org_id,proposed_seller_org_id,buyer_org_id,status,buyer_consented_at,recipient_accepted_at,created_by)
       values ($1,$2,$3,$4,'recipient_accepted',now(),now(),$5) returning id`,
    [source!.id,s!.id,r!.id,b!.id,referrer.id]);
  await sql('insert into public.referral_handoffs(referral_id,enquiry_id,opened_by) values ($1,$2,$3)',
    [referral!.id,opened!.id,recipient.id]);
  const [quote] = await sql<{ id: string }>(
    `insert into public.quotations(enquiry_id,seller_org_id,buyer_org_id,status,created_by)
       values ($1,$2,$3,'sent',$4) returning id`, [opened!.id,r!.id,b!.id,recipient.id]);
  const [version] = await sql<{ id: string }>(
    `insert into public.quotation_versions
       (quotation_id,version_number,currency,scope_text,tax_treatment,delivery_timing,valid_until,subtotal,delivery_fee,tax_amount,total)
       values ($1,1,'MYR','Synthetic goods','Tax included','Within 30 days',now()+interval '7 days',12.00,0,0,12.00) returning id`, [quote!.id]);
  await sql(`insert into public.quotation_line_items
    (quote_version_id,description,quantity,unit,unit_price,line_total,sort_order)
    values ($1,'Synthetic good',1,'piece',12.00,12.00,0)`, [version!.id]);
  await sql('update public.quotations set current_version_id=$2 where id=$1', [quote!.id,version!.id]);

  await sql('delete from public.organisations where id=$1', [b!.id]);
  for (const [table,column,id] of [
    ['enquiries','id',source!.id], ['enquiries','id',opened!.id],
    ['referral_suggestions','id',referral!.id], ['referral_handoffs','referral_id',referral!.id],
    ['quotations','id',quote!.id], ['quotation_versions','id',version!.id],
  ]) {
    expect(await sql(`select 1 from public.${table} where ${column}=$1`, [id]), `${table} ${id}`).toHaveLength(0);
  }
  await sql('delete from public.organisations where id in ($1,$2)', [s!.id,r!.id]);
});

it('deleting the receiving seller removes its active handoff without deleting the original conversation', async () => {
  const [buyer, referrer, recipient] = await Promise.all([
    createConfirmedUser('erase3-buyer'), createConfirmedUser('erase3-referrer'), createConfirmedUser('erase3-recipient'),
  ]);
  const [b] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['buyer',uniq('Receiving buyer'),buyer.id]);
  const [s] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['business',uniq('Original seller'),referrer.id]);
  const [r] = await sql<{ id: string }>('insert into public.organisations(type,name,created_by) values ($1,$2,$3) returning id',
    ['business',uniq('Receiving seller'),recipient.id]);
  const [source] = await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Synthetic original conversation',$1,$3) returning id`, [b!.id,s!.id,buyer.id]);
  const [opened] = await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'referral','Synthetic recipient conversation',$2,$3) returning id`, [b!.id,r!.id,recipient.id]);
  const [referral] = await sql<{ id: string }>(
    `insert into public.referral_suggestions
     (enquiry_id,referrer_seller_org_id,proposed_seller_org_id,buyer_org_id,status,buyer_consented_at,recipient_accepted_at,created_by)
     values($1,$2,$3,$4,'recipient_accepted',now(),now(),$5) returning id`,
    [source!.id,s!.id,r!.id,b!.id,referrer.id]);
  await sql('insert into public.referral_handoffs(referral_id,enquiry_id,opened_by) values ($1,$2,$3)',
    [referral!.id,opened!.id,recipient.id]);
  const [claim] = await sql<{ id: string }>(
    `insert into public.verification_claims(org_id,claim_type,status)
      values($1,'business_registration','submitted') returning id`, [r!.id]);
  const [document] = await sql<{ id: string }>(
    `insert into public.verification_documents
      (org_id,claim_id,doc_type,display_name,mime_type,size_bytes,sha256,storage_path,scan_status,uploaded_by)
      values($1,$2,'other','Synthetic evidence.pdf','application/pdf',20,$3,$4,'clean',$5) returning id`,
    [r!.id,claim!.id,'a'.repeat(64),`synthetic/${uniq('erasure')}.pdf`,recipient.id]);
  await sql('insert into public.verification_claim_documents(claim_id,version,document_id) values($1,1,$2)',
    [claim!.id,document!.id]);
  await sql('delete from public.organisations where id=$1', [r!.id]);
  expect(await sql('select id from public.referral_suggestions where id=$1',[referral!.id])).toHaveLength(0);
  expect(await sql('select referral_id from public.referral_handoffs where referral_id=$1',[referral!.id])).toHaveLength(0);
  expect(await sql('select id from public.enquiries where id=$1',[opened!.id])).toHaveLength(0);
  expect(await sql('select id from public.enquiries where id=$1',[source!.id])).toHaveLength(1);
  expect(await sql('select id from public.verification_documents where id=$1',[document!.id])).toHaveLength(0);
  await sql('delete from public.organisations where id in ($1,$2)',[b!.id,s!.id]);
});
