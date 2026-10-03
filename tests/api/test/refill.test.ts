import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { calculateRefill } from "@display-refill/domain";
import { createHarness, type Harness, type ApiUser, SEED } from "../src/harness";
let h: Harness;
let owner: ApiUser;
let peer: ApiUser;
let manager: ApiUser;
let admin: ApiUser;
let other: ApiUser;
let unassigned: ApiUser;
let display: string;
let org: string;
let product: string;
let version: string;
beforeAll(async () => {
  h = await createHarness();
  org = randomUUID();
  const store = randomUUID();
  product = randomUUID();
  const pog = randomUUID();
  version = randomUUID();
  display = randomUUID();
  await h.db.query("insert into public.organizations(id,name) values ($1,'Refill synthetic')", [org]);
  await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values ($1,$2,'Fixture','REFILL','UTC')", [store, org]);
  owner = await h.user('refill-owner', { org: { id: org, role: 'member' }, stores: [{ id: store, role: 'employee' }] });
  peer = await h.user('refill-peer', { org: { id: org, role: 'member' }, stores: [{ id: store, role: 'employee' }] });
  manager = await h.user('refill-manager', { org: { id: org, role: 'member' }, stores: [{ id: store, role: 'manager' }] });
  admin = await h.user('refill-admin', { org: { id: org, role: 'admin' } });
  unassigned = await h.user('refill-unassigned', { org: { id: org, role: 'member' } });
  other = await h.user('refill-other', { org: { id: SEED.orgB, role: 'admin' } });
  await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values ($1,$2,'Synthetic','Syn','fixture','tub')", [product, org]);
  await h.db.query("insert into public.pogs(id,organization_id,name) values ($1,$2,'Synthetic')", [pog, org]);
  await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values ($1,$2,$3,1,$4,100,100,now(),false)", [version, org, pog, `${org}/${pog}/fixture.jpg`]);
  for (const [index, target, threshold] of [[0, 3, 1], [1, 2, null], [2, 8, 0]] as const) {
    await h.db.query("insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values ($1,$2,$3,$4,$5,0,0.3,0.5,$6,$7,$8)", [org, version, `S${index}`, product, index * .3, target, threshold, index]);
  }
  const published = await h.service.rpc('publish_pog_version', { p_actor: admin.id, p_version_id: version, p_expected_revision: 1 });
  if (published.error)
    throw published.error;
  await h.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values ($1,$2,$3,'Fixture',$4)", [display, org, store, version]);
});
afterAll(() => h?.close());
async function scan() {
  const c = await h.service.rpc('create_scan', { p_actor: owner.id, p_display_id: display, p_source: 'manual' });
  if (c.error)
    throw c.error;
  const id = c.data[0]!.scan_id;
  const read = await h.api(`/api/v1/scans/${id}`, { token: owner.token });
  expect(read.status).toBe(200);
  return read.json.data;
}
function mutate(id: string, action: 'counts' | 'confirm', body: unknown, user = owner, key = randomUUID()) {
  return h.api(`/api/v1/scans/${id}/${action}`, { method: action === 'counts' ? 'PATCH' : 'POST', token: user.token, body, headers: { 'Idempotency-Key': key } });
}
function items(s: Awaited<ReturnType<typeof scan>>, values = [1, 0, 1], verified = true) {
  return s.slots.map((slot: {
    slot_id: string;
  }, i: number) => ({ slot_id: slot.slot_id, quantity: values[i], verified, reason: 'manual_count' }));
}
it('starts unknown, blocks confirmation, returns per-slot provisional calculations and requires verification', async () => {
  const s = await scan();
  expect(s.provisional_total_refill).toBeNull();
  expect(s.display_score).toBeNull();
  expect(s.slots.every((x: {
    accepted_quantity: unknown;
  }) => x.accepted_quantity === null)).toBe(true);
  const failed = await mutate(s.scan_id, 'confirm', { expected_revision: 1 });
  expect(failed.status).toBe(422);
  expect(failed.json.error.code).toBe('UNRESOLVED_COUNTS');
  expect(failed.json.error.field_errors.slot_ids).toHaveLength(3);
  const saved = await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s, undefined, false) });
  expect(saved.status).toBe(200);
  expect(saved.json.data.provisional).toBe(true);
  expect(saved.json.data.provisional_total_refill).toBe(4);
  expect(saved.json.data.total_refill).toBeNull();
  expect(saved.json.data.display_score).toBe(15);
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 2 })).status).toBe(422);
  const verify = await mutate(s.scan_id, 'counts', { expected_revision: 2, items: items(s) });
  expect(verify.status).toBe(200);
  const confirmed = await mutate(s.scan_id, 'confirm', { expected_revision: 3 });
  expect(confirmed.status).toBe(200);
  expect(confirmed.json.data.total_refill).toBe(4);
  expect(confirmed.json.data.provisional).toBe(false);
  const corrections = await h.db.query('select * from public.scan_corrections where scan_id=$1', [s.scan_id]);
  expect(corrections.rows).toHaveLength(6);
  expect(corrections.rows.slice(3).every(x => x.original_ai_quantity === null)).toBe(true);
});
it('rejects invalid inputs, authority injection, duplicate and non-pinned slots without partial changes', async () => {
  const s = await scan();
  const good = items(s);
  for (const expected_revision of [0, -1, 1.5, 2147483648, '1']) {
    expect((await mutate(s.scan_id, 'confirm', { expected_revision })).status).toBe(422);
  }
  for (const quantity of [null, -1, 1.5, 1000, '0'])
    expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: [{ ...good[0], quantity }] })).status).toBe(422);
  for (const body of [{ expected_revision: 1, items: [] }, { expected_revision: 1, items: [good[0], good[0]] }, { expected_revision: 1, items: [{ ...good[0], slot_id: randomUUID() }] }, { expected_revision: 1, items: [{ ...good[0], target: 999 }] }, { expected_revision: 1, items: good, total_refill: 0 }])
    expect((await mutate(s.scan_id, 'counts', body)).status).toBe(422);
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 1, total_refill: 0 })).status).toBe(422);
  const raw = await h.service.rpc('mutate_scan_counts', { p_actor: owner.id, p_scan_id: s.scan_id, p_action: 'counts', p_expected_revision: 1, p_items: [good[0], { ...good[1], slot_id: randomUUID() }], p_key: randomUUID(), p_request_id: randomUUID() });
  expect(raw.error?.message).toBe('VALIDATION_FAILED');
  const read = await h.api(`/api/v1/scans/${s.scan_id}`, { token: owner.token });
  expect(read.json.data.revision).toBe(1);
  expect(read.json.data.provisional_total_refill).toBeNull();
  expect((await h.db.query('select * from public.scan_corrections where scan_id=$1', [s.scan_id])).rows).toHaveLength(0);
  const partial = await mutate(s.scan_id, 'counts', { expected_revision: 1, items: [good[0]] });
  expect(partial.status).toBe(200);
  expect(partial.json.data.slots.filter((x: { accepted_quantity: number | null }) => x.accepted_quantity === null)).toHaveLength(2);
  expect(partial.json.data.provisional_total_refill).toBeNull();
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 2 })).status).toBe(422);
});
it('enforces own/store/org authorization at API, RPC and table boundaries', async () => {
  const s = await scan();
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s) }, peer)).status).toBe(403);
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 1 }, peer)).status).toBe(403);
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s) }, other)).status).toBe(404);
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s) }, unassigned)).status).toBe(404);
  const denied = await h.service.rpc('mutate_scan_counts', { p_actor: peer.id, p_scan_id: s.scan_id, p_action: 'counts', p_expected_revision: 1, p_items: items(s), p_key: randomUUID(), p_request_id: randomUUID() });
  expect(denied.error?.message).toBe('FORBIDDEN');
  const signed = await h.signIn(owner.email, owner.password);
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(h.env.apiUrl, h.env.publishableKey, { global: { headers: { Authorization: `Bearer ${signed.access_token}` } } });
  expect((await client.rpc('mutate_scan_counts', { p_actor: admin.id, p_scan_id: s.scan_id, p_action: 'confirm', p_expected_revision: 1, p_key: randomUUID(), p_items: null, p_request_id: randomUUID() })).error?.code).toBe('42501');
  expect((await client.from('scan_slots').update({ accepted_quantity: 999 }).eq('scan_id', s.scan_id)).error?.code).toBe('42501');
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s) }, manager)).status).toBe(200);
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 2 }, admin)).status).toBe(200);
});
it('commits concurrent confirmation once, replays lost-response retries, rejects changed bodies and freezes history', async () => {
  const s = await scan();
  const key = randomUUID();
  const save = await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s, [999, 0, 1]) }, owner, key);
  expect(save.status).toBe(200);
  const replay = await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s, [999, 0, 1]) }, owner, key);
  expect(replay.json.data).toEqual(save.json.data);
  expect(replay.headers.get('idempotent-replayed')).toBe('true');
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s) }, owner, key)).status).toBe(409);
  const confirmKey = randomUUID();
  const results = await Promise.all([mutate(s.scan_id, 'confirm', { expected_revision: 2 }, owner, confirmKey), mutate(s.scan_id, 'confirm', { expected_revision: 2 }, owner)]);
  expect(results.map(x => x.status).sort()).toEqual([200, 409]);
  const winner = results.find(x => x.status === 200)!;
  expect(winner.json.data.total_refill).toBe(2);
  expect(winner.json.data.display_score).toBe(31);
  // If the other key won, the first is a conflict; retry the actual successful key via a separate same-key race below.
  const record = await h.db.query("select key from public.idempotency_records where resource_id=$1 and route_scope like 'POST%'", [s.scan_id]);
  const retry = await mutate(s.scan_id, 'confirm', { expected_revision: 2 }, owner, record.rows[0].key);
  expect(retry.json.data).toEqual(winner.json.data);
  expect((await mutate(s.scan_id, 'counts', { expected_revision: 3, items: items(s) })).status).toBe(409);
  expect((await h.db.query('select * from public.scan_confirmations where scan_id=$1', [s.scan_id])).rows).toHaveLength(1);
  expect((await h.db.query("select * from public.audit_events where resource_id=$1 and event_type='scan.confirmed'", [s.scan_id])).rows).toHaveLength(1);
  await h.db.query('update public.products set name=$1 where id=$2', ['Renamed synthetic', product]);
  const pinned = await h.service.from('pog_versions').select('pog_id').eq('id', version).single();
  const clone = await h.service.rpc('create_pog_version', { p_actor: admin.id, p_pog_id: pinned.data!.pog_id, p_source_version_id: version });
  if (clone.error)
    throw clone.error;
  await h.db.query('update public.pog_slots set target_quantity=999,refill_threshold=null where pog_version_id=$1', [clone.data.id]);
  const publication = await h.service.rpc('publish_pog_version', { p_actor: admin.id, p_version_id: clone.data.id, p_expected_revision: clone.data.revision });
  if (publication.error)
    throw publication.error;
  await h.db.query('update public.displays set active_pog_version_id=$1 where id=$2', [clone.data.id, display]);
  const read = await h.api(`/api/v1/scans/${s.scan_id}`, { token: owner.token });
  expect(read.json.data).toEqual(winner.json.data);
  await expect(h.db.query('update public.scans set confirmed_at=null where id=$1', [s.scan_id])).rejects.toThrow('IMMUTABLE');
  expect((await h.service.from('scan_slots').update({ refill_quantity: 0 }).eq('scan_id', s.scan_id)).error?.message).toBe('IMMUTABLE');
  const frozen = await h.service.from('scan_slots').select('*').eq('scan_id', s.scan_id).limit(1).single();
  expect((await h.service.from('scan_slots').insert({ ...frozen.data!, id: randomUUID() })).error?.message).toBe('IMMUTABLE');
  await h.db.query('update public.displays set active_pog_version_id=$1 where id=$2', [version, display]);
});
it('serializes same-key and different-key saves, stale revisions and same-key confirmations', async () => {
  const s = await scan();
  const key = randomUUID();
  const body = { expected_revision: 1, items: items(s) };
  const saves = await Promise.all([mutate(s.scan_id, 'counts', body, owner, key), mutate(s.scan_id, 'counts', body, owner, key)]);
  expect(saves.map(x => x.status)).toEqual([200, 200]);
  expect(saves[0].json.data).toEqual(saves[1].json.data);
  const confirms = await Promise.all([mutate(s.scan_id, 'confirm', { expected_revision: 2 }, owner, key), mutate(s.scan_id, 'confirm', { expected_revision: 2 }, owner, key)]);
  expect(confirms.map(x => x.status)).toEqual([200, 200]);
  const second = await scan();
  const races = await Promise.all([mutate(second.scan_id, 'counts', { expected_revision: 1, items: items(second) }), mutate(second.scan_id, 'counts', { expected_revision: 1, items: items(second, [0, 0, 0]) })]);
  expect(races.map(x => x.status).sort()).toEqual([200, 409]);
});
it('SQL finals match the domain engine across supplied fixtures and every threshold boundary', async () => {
  for (const values of [[2, 0, 0], [1, 2, 1], [0, 999, 999], [4, 1, 8], [3, 0, 9]]) {
    const s = await scan();
    const expected = calculateRefill(s.slots.map((x: {
      slot_id: string;
      product_id: string;
      target: number;
      refill_threshold: number | null;
    }, i: number) => ({ slot_id: x.slot_id, product_id: x.product_id, target: x.target, threshold: x.refill_threshold, current: values[i]! })));
    expect((await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s, values) })).status).toBe(200);
    const result = await mutate(s.scan_id, 'confirm', { expected_revision: 2 });
    expect(result.status).toBe(200);
    expect(result.json.data.total_refill).toBe(expected.total_refill);
    expect(result.json.data.display_score).toBe(expected.display_score);
    expect(result.json.data.products).toEqual(expected.products);
    expect(result.json.data.slots.map((x: {
      refill_quantity: number;
    }) => x.refill_quantity)).toEqual(expected.slots.map(x => x.refill_quantity));
  }
});
it('cookie mutations require same origin and retries re-check revoked membership', async () => {
  const s = await scan();
  const { jar } = await h.webSignIn(owner);
  const path = `/api/v1/scans/${s.scan_id}/counts`;
  const body = { expected_revision: 1, items: items(s) };
  const key = randomUUID();
  expect((await h.api(path, { method: 'PATCH', jar, body, headers: { 'Idempotency-Key': key, origin: 'https://foreign.example' } })).status).toBe(403);
  expect((await h.api(path, { method: 'PATCH', jar, body, headers: { 'Idempotency-Key': key, origin: h.base } })).status).toBe(200);
  await h.db.query('update public.organization_memberships set active=false where organization_id=$1 and user_id=$2', [org, owner.id]);
  expect((await mutate(s.scan_id, 'counts', body, owner, key)).status).toBe(403);
  await h.db.query('update public.organization_memberships set active=true where organization_id=$1 and user_id=$2', [org, owner.id]);
});
it('known AI estimates stay provisional until required verification, preserving original evidence', async () => {
  const s = await scan();
  // Synthetic worker-stage evidence only; no provider or correction UI is built here.
  await h.db.query("update public.scans set status='processing',source='photo' where id=$1", [s.scan_id]);
  await h.db.query("update public.scan_slots set ai_quantity=1,accepted_quantity=1,ai_confidence=0.5,ai_flags=array['occluded'] where scan_id=$1", [s.scan_id]);
  await h.db.query("update public.scans set status='needs_review' where id=$1", [s.scan_id]);
  const read = await h.api(`/api/v1/scans/${s.scan_id}`, { token: owner.token });
  expect(read.json.data.provisional_total_refill).toBe(3);
  expect(read.json.data.unresolved_slot_ids).toHaveLength(3);
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 1 })).status).toBe(422);
  const saved = await mutate(s.scan_id, 'counts', { expected_revision: 1, items: items(s, [1, 1, 1]) });
  expect(saved.status).toBe(200);
  expect(saved.json.data.slots.every((x: {
    ai_quantity: number;
    confidence: number;
    flags: string[];
  }) => x.ai_quantity === 1 && x.confidence === 0.5 && x.flags[0] === 'occluded')).toBe(true);
  const corrections = await h.db.query('select original_ai_quantity,previous_quantity,corrected_quantity from public.scan_corrections where scan_id=$1', [s.scan_id]);
  expect(corrections.rows).toEqual(Array(3).fill({ original_ai_quantity: 1, previous_quantity: 1, corrected_quantity: 1 }));
  expect((await mutate(s.scan_id, 'confirm', { expected_revision: 2 })).status).toBe(200);
});
it('known slots without required review may confirm while pending', async () => {
  const s = await scan();
  await h.db.query("update public.scan_slots set accepted_quantity=1,review_required=false where scan_id=$1", [s.scan_id]);
  const result = await mutate(s.scan_id, 'confirm', { expected_revision: 1 });
  expect(result.status).toBe(200);
  expect(result.json.data.slots.every((x: {
    review_state: string;
    final_quantity: number;
  }) => x.review_state === 'pending' && x.final_quantity === 1)).toBe(true);
});
