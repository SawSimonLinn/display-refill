import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLogger, finalizeScanPhoto } from "@display-refill/server";
import sharp from "sharp";
import { createWorld } from "../src/world";
import type { TestUser } from "../src/world";
import { runCleanup } from "../../../workers/scan-worker/src/retention";

let w: Awaited<ReturnType<typeof createWorld>>;
const lines: string[] = [];
const logger = createLogger("cleanup-drill", "info", (_, line) => lines.push(line));
let actor: TestUser;
const org=randomUUID(), store=randomUUID(), display=randomUUID(), version=randomUUID(), pog=randomUUID();
const upload=randomUUID();
const reference=`${org}/${pog}/${version}/reference-${upload}-${'a'.repeat(64)}.jpg`;
beforeAll(async () => {
 w = await createWorld();
 await w.db.query("insert into public.organizations(id,name) values($1,'Operations synthetic')",[org]);
 await w.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Operations','OPS','UTC')",[store,org]);
 actor=await w.user('operations-employee',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 const admin=await w.user('operations-admin',{org:{id:org,role:'admin'}});
 const product=randomUUID();
 await w.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic','Syn','fixture','tub')",[product,org]);
 await w.db.query("insert into public.pogs(id,organization_id,name) values($1,$2,'Operations synthetic')",[pog,org]);
 await w.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,1,$4,100,100,now(),false)",[version,org,pog,reference]);
 await w.db.query("insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values($1,$2,'S1',$3,0,0,1,1,4,1,0)",[org,version,product]);
 const bytes=await sharp({create:{width:100,height:100,channels:3,background:'#333333'}}).jpeg().toBuffer();
 expect((await w.service.storage.from('pog-images').upload(reference,bytes,{contentType:'image/jpeg'})).error).toBeNull();
 await w.db.query("insert into public.upload_intents(id,organization_id,actor_id,resource_id,bucket,object_path,expires_at,created_at,expected_type,max_bytes,state) values($1,$2,$3,$4,'pog-images',$5,now()-interval '2 days',now()-interval '3 days','image/jpeg',10485760,'validated')",[upload,org,admin.id,version,`${org}/${pog}/${version}/upload-${upload}.jpg`]);
 expect((await w.service.rpc('publish_pog_version',{p_actor:admin.id,p_version_id:version,p_expected_revision:1})).error).toBeNull();
 await w.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values($1,$2,$3,'Operations display',$4)",[display,org,store,version]);
});
afterAll(async () => { await w.db.query('update public.operation_settings set vision_enabled=true'); await w.close(); });
async function photo(stopAnalysis = true) {
 const r = await w.service.rpc("photo_scan_workflow", { p_actor: actor.id, p_action: "create", p_resource: display,
  p_input: { expected_pog_version_id: version }, p_key: randomUUID() });
 if (r.error) throw r.error;
 const payload = r.data as unknown as {payload: {scan: {id: string}; upload: {object_path: string}}};
 const id = payload.payload.scan.id;
 const jpeg = await sharp({create:{width:100,height:100,channels:3,background:'#999999'}}).jpeg().toBuffer();
 await w.service.storage.from('display-scans').upload(payload.payload.upload.object_path, jpeg, {contentType:'image/jpeg'});
 const done = await finalizeScanPhoto(w.service,actor.id,id,{expected_revision:1,crop:{x:0,y:0,width:1,height:1}},randomUUID(),randomUUID());
 expect(done.ok).toBe(true);
 if (stopAnalysis) await w.db.query("update public.scans set status='failed',failure_code='PROVIDER_UNAVAILABLE' where id=$1",[id]);
 return id;
}
it('service-only operational functions and tables reject real employee and anonymous callers',async()=>{
 for(const client of [w.anon,w.users.employeeA1.client]) {
  expect((await client.rpc('prepare_image_cleanup')).error).toBeTruthy();
  expect((await client.rpc('operations_metrics')).error).toBeTruthy();
  expect((await client.from('operation_settings').update({vision_enabled:false}).eq('singleton',true)).error).toBeTruthy();
 }
});
it('retention deletes eligible bytes, keeps unexpired bytes and metadata, retries failures and recovers interruption',async()=>{
 const old=await photo(), fresh=await photo(), missing=await photo();
 await ageScans([old,missing],91);
 const rows=(await w.db.query('select id,image_path from public.scans where id=any($1::uuid[])',[[old,fresh,missing]])).rows;
 const path=(id:string)=>rows.find(r=>r.id===id).image_path as string;
 await w.service.storage.from('display-scans').remove([path(missing)]);
 // Explicitly labeled Storage-failure simulation over the real cleanup RPCs.
 const failingStorage = new Proxy(w.service, { get(target, key) {
  if (key === 'storage') return { from: () => ({ remove: async () => { throw new Error('credential-SENTINEL https://signed.example'); } }) };
  const value = Reflect.get(target, key);
  return typeof value === 'function' ? value.bind(target) : value;
 } });
 await runCleanup(failingStorage, logger);
 const failure=(await w.db.query('select * from public.image_cleanup_jobs where scan_id=$1',[old])).rows[0];
 expect(failure.last_error_code).toBe('STORAGE_DELETE_FAILED');
 expect(failure.state).toBe('pending');
 await w.db.query('update public.image_cleanup_jobs set available_at=now() where scan_id=any($1::uuid[])',[[old,missing]]);
 const claims=await w.service.rpc('claim_image_cleanup'); expect(claims.error).toBeNull();
 const j=claims.data!.find(j=>j.scan_id===old)!;
 const blocked=await w.service.rpc('scan_analysis_action',{p_actor:actor.id,p_action:'retry',p_scan:old,p_expected_revision:2,p_key:randomUUID(),p_request_id:randomUUID()});
 expect(blocked.error?.message).toBe('IMAGE_UNAVAILABLE');
 // Storage failure is persisted with retry backoff; raw exception is never stored.
 expect((await w.service.rpc('finish_image_cleanup',{p_id:j.id,p_lease:j.lease_token!,p_success:false})).data).toBe(true);
 expect((await w.db.query('select last_error_code from public.image_cleanup_jobs where id=$1',[j.id])).rows[0].last_error_code).toBe('STORAGE_DELETE_FAILED');
 // Simulated process interruption after Storage delete, before DB finish.
 await w.service.storage.from('display-scans').remove([path(old)]);
 await w.db.query("update public.image_cleanup_jobs set available_at=now(),lease_until=now()-interval '1 second' where scan_id=any($1::uuid[]) and state<>'succeeded'",[[old,missing]]);
 await runCleanup(w.service,logger);
 await runCleanup(w.service,logger);
 const retained=(await w.db.query('select id,image_deleted_at from public.scans where id=any($1::uuid[])',[[old,fresh,missing]])).rows;
 expect(retained.find(r=>r.id===old).image_deleted_at).toBeTruthy();
 expect(retained.find(r=>r.id===missing).image_deleted_at).toBeTruthy();
 expect(retained.find(r=>r.id===fresh).image_deleted_at).toBeNull();
 expect((await w.service.storage.from('display-scans').download(path(fresh))).error).toBeNull();
 expect((await w.db.query('select count(*)::int n from public.scan_slots where scan_id=$1',[old])).rows[0].n).toBeGreaterThan(0);
 expect((await w.service.rpc('finish_image_cleanup',{p_id:j.id,p_lease:j.lease_token!,p_success:true})).data).toBe(false);
 expect(lines.join('\n')).not.toMatch(/https?:|sb_secret_|signed|image_path|bytes|SENTINEL/);
});
it('24-hour abandoned upload expires with manual takeover available, and referenced POG objects never enter cleanup',async()=>{
 const r=await w.service.rpc('photo_scan_workflow',{p_actor:actor.id,p_action:'create',p_resource:display,p_input:{expected_pog_version_id:version},p_key:randomUUID()});
 if(r.error)throw r.error;
 const id=(r.data as unknown as {payload:{scan:{id:string}}}).payload.scan.id;
 await ageScans([id],2);
 await w.service.rpc('prepare_image_cleanup');
 const s=(await w.db.query('select * from public.scans where id=$1',[id])).rows[0];
 expect(s.failure_code).toBe('UPLOAD_EXPIRED');
 const takeover=await w.service.rpc('scan_analysis_action',{p_actor:actor.id,p_action:'takeover',p_scan:id,p_expected_revision:s.revision,p_key:randomUUID(),p_request_id:randomUUID()});
 expect(takeover.error).toBeNull();
 expect((await w.db.query("select count(*)::int n from public.image_cleanup_jobs j join public.pog_versions v on j.object_path=v.reference_path where j.bucket='pog-images'")).rows[0].n).toBe(0);
});
it('abandoned staging/orphan outputs are deleted while an actual referenced POG object remains', async () => {
 const created=await w.service.rpc('photo_scan_workflow',{p_actor:actor.id,p_action:'create',p_resource:display,p_input:{expected_pog_version_id:version},p_key:randomUUID()});
 if(created.error)throw created.error;
 const p=(created.data as unknown as {payload:{scan:{id:string};upload:{object_path:string}}}).payload;
 const orphan=p.upload.object_path.replace('capture.jpg',`validated-${'f'.repeat(64)}.jpg`);
 const bytes=await sharp({create:{width:100,height:100,channels:3,background:'#333333'}}).jpeg().toBuffer();
 for(const path of [p.upload.object_path,orphan]) expect((await w.service.storage.from('display-scans').upload(path,bytes,{contentType:'image/jpeg'})).error).toBeNull();
 await ageScans([p.scan.id],2);
 await w.db.query("update public.upload_intents set created_at=now()-interval '3 days',expires_at=now()-interval '2 days' where resource_id=$1",[p.scan.id]);
 await w.db.query("update storage.objects set created_at=now()-interval '3 days' where (bucket_id='display-scans' and name=any($1::text[])) or (bucket_id='pog-images' and name=$2)",[[p.upload.object_path,orphan],reference]);
 await runCleanup(w.service,logger);
 for(const path of [p.upload.object_path,orphan]) expect((await w.service.storage.from('display-scans').download(path)).error).toBeTruthy();
 expect((await w.service.storage.from('pog-images').download(reference)).error).toBeNull();
 // Referenced bytes deliberately remain with retained fixture versions/scans.
});
it('vision switch blocks new enqueues while manual creation and takeover work; shared limits count across callers',async()=>{
 const id=await photo();
 await w.db.query('update public.operation_settings set vision_enabled=false');
 const retry=await w.service.rpc('scan_analysis_action',{p_actor:actor.id,p_action:'retry',p_scan:id,p_expected_revision:2,p_key:randomUUID(),p_request_id:randomUUID()});
 expect(retry.error?.message).toBe('VISION_DISABLED');
 const blocked=await w.service.rpc('photo_scan_workflow',{p_actor:actor.id,p_action:'create',p_resource:display,p_input:{expected_pog_version_id:version},p_key:randomUUID()});
 expect(blocked.error?.message).toBe('VISION_DISABLED');
 const manual=await w.service.rpc('manual_scan_workflow',{p_actor:actor.id,p_action:'create',p_resource:display,p_expected_pog:version,p_key:randomUUID(),p_request_id:randomUUID()});
 expect(manual.error).toBeNull();
 await w.db.query('update public.operation_settings set vision_enabled=true');
 const hash='a'.repeat(64);await w.db.query('delete from public.operation_rate_windows where key_hash=$1',[hash]);
 const results=await Promise.all(Array.from({length:5},()=>w.service.rpc('hit_operation_limit',{p_hash:hash,p_limit:2,p_seconds:60})));
 expect(results.filter(r=>r.data===0)).toHaveLength(2);
 expect(results.filter(r=>Number(r.data)>0)).toHaveLength(3);
 expect((await w.service.rpc('operations_metrics')).data).toMatchObject({vision_enabled:true});
});

// Fixture clock seeding only, using the loopback-guarded raw test connection.
// Production immutability is unchanged; no trigger is dropped or disabled globally.
async function ageScans(ids: string[], days: number) {
 await w.db.query('begin');
 try {
  await w.db.query("set local session_replication_role='replica'");
  await w.db.query("update public.scans set created_at=now()-make_interval(days=>$2) where id=any($1::uuid[])",[ids,days]);
  await w.db.query('commit');
 } catch(e) { await w.db.query('rollback'); throw e; }
}

it('cleanup rejects null/unbounded batch arguments at the database boundary', async () => {
 for (const sql of [
  'select public.prepare_image_cleanup(90,null)',
  'select public.prepare_image_cleanup(-1,1)',
  'select public.claim_image_cleanup(null)',
  'select public.claim_image_cleanup(1001)',
 ]) await expect(w.db.query(sql)).rejects.toMatchObject({ message: 'INVALID_INPUT' });
});

it('expired queued work is fenced before deletion; retention does not wait indefinitely for an offline worker', async () => {
 const id=await photo(false);
 await ageScans([id],91);
 await runCleanup(w.service,logger);
 const scan=(await w.db.query('select * from public.scans where id=$1',[id])).rows[0];
 expect(scan).toMatchObject({status:'failed',failure_code:'IMAGE_UNAVAILABLE',job_generation:1});
 expect(scan.image_deleted_at).toBeTruthy();
 expect((await w.db.query('select state from public.scan_jobs where scan_id=$1',[id])).rows[0].state).toBe('cancelled');
 expect((await w.db.query("select count(*)::int n from public.audit_events where resource_id=$1 and event_type='scan.retention_expired'",[id])).rows[0].n).toBe(1);
 const manual=await w.service.rpc('scan_analysis_action',{p_actor:actor.id,p_action:'takeover',p_scan:id,p_expected_revision:scan.revision,p_key:randomUUID(),p_request_id:randomUUID()});
 expect(manual.error).toBeNull();
});
