import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createHarness, adminBaseUrl, type Harness, type ApiUser, SEED } from "../src/harness";
let h: Harness, owner: ApiUser, peer: ApiUser, other: ApiUser;
let display: string, version: string, jpeg: Buffer;
const whole = { x: 0, y: 0, width: 1, height: 1 };
const post = (path: string, body: unknown, key = randomUUID(), user = owner) => h.api(path, { method: "POST", token: user.token, body, headers: { "idempotency-key": key } });
async function create(key = randomUUID()) {
 const r = await post('/api/v1/scans', { display_id: display, source: 'photo', expected_pog_version_id: version }, key);
 expect(r.status,r.text).toBe(201); return r.json.data;
}
async function upload(id: string, bytes = jpeg, user = owner, mime = 'image/jpeg') {
 return fetch(`${adminBaseUrl()}/api/v1/scans/${id}/image`, { method: 'PUT', headers: { authorization: `Bearer ${user.token}`, 'content-type': mime }, body: new Uint8Array(bytes) });
}
beforeAll(async () => {
 h = await createHarness(); const org = randomUUID(), store = randomUUID(), product = randomUUID(), pog = randomUUID(); version = randomUUID(); display = randomUUID();
 await h.db.query("insert into public.organizations(id,name) values($1,'Photo synthetic')",[org]);
 await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Photo','PHOTO','UTC')",[store,org]);
 owner = await h.user('photo-owner',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 peer = await h.user('photo-peer',{org:{id:org,role:'admin'},stores:[{id:store,role:'employee'}]});
 other = await h.user('photo-other',{org:{id:SEED.orgB,role:'admin'}});
 await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic','Syn','fixture','tub')",[product,org]);
 await h.db.query("insert into public.pogs(id,organization_id,name) values($1,$2,'Synthetic')",[pog,org]);
 await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,1,$4,400,200,now(),false)",[version,org,pog,`${org}/${pog}/fixture.jpg`]);
 await h.db.query("insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,sort_order) values($1,$2,'A1',$3,0,0,1,1,5,0)",[org,version,product]);
 const published = await h.service.rpc('publish_pog_version',{p_actor:peer.id,p_version_id:version,p_expected_revision:1}); if(published.error)throw published.error;
 await h.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values($1,$2,$3,'Photo',$4)",[display,org,store,version]);
 jpeg = await sharp({create:{width:400,height:200,channels:3,background:'#aa3322'}}).withMetadata({orientation:6}).jpeg().toBuffer();
});
afterAll(()=>h?.close());
it('pins POG, atomically replays concurrent create/finalize, stores upright private immutable crop with one job',async()=>{
 const key = randomUUID(); const [a,b] = await Promise.all([create(key),create(key)]); expect(a.scan.scan_id).toBe(b.scan.scan_id); expect(a.scan.pog_version_id).toBe(version); expect(a.analysis_available).toBe(true);
 const id = a.scan.scan_id; expect((await upload(id,jpeg,owner,'text/plain')).status).toBe(200); expect((await upload(id)).status).toBe(200);
 const body={expected_revision:1,crop:{x:0,y:0.5,width:1,height:0.5}}, finalKey=randomUUID();
 const results=await Promise.all([post(`/api/v1/scans/${id}/finalize-upload`,body,finalKey),post(`/api/v1/scans/${id}/finalize-upload`,body,finalKey)]);
 for(const r of results)expect(r.status,r.text).toBe(200);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,body,finalKey)).headers.get('idempotent-replayed')).toBe('true');
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{...body,crop:whole},finalKey)).status).toBe(409);
 expect((await h.db.query('select * from public.scan_jobs where scan_id=$1',[id])).rows).toHaveLength(1);
 const s=(await h.db.query('select * from public.scans where id=$1',[id])).rows[0]; expect(s.status).toBe('queued'); expect(s.crop_json.upright_source).toEqual({width:200,height:400});
 const bytes=await h.service.storage.from('display-scans').download(s.image_path); expect(bytes.error).toBeNull(); const meta=await sharp(Buffer.from(await bytes.data!.arrayBuffer())).metadata(); expect([meta.width,meta.height]).toEqual([200,200]); expect(meta.exif).toBeUndefined();
 expect((await h.api(`/api/v1/scans/${id}/image`,{token:owner.token})).status).toBe(200); expect((await h.api(`/api/v1/scans/${id}/image`)).status).toBe(401); expect((await h.api(`/api/v1/scans/${id}/image`,{token:other.token})).status).toBe(404);
 const access=await h.api(`/api/v1/scans/${id}/image`,{token:owner.token}); expect(Date.parse(access.json.data.expires_at)-Date.now()).toBeLessThanOrEqual(300000); expect((await fetch(access.json.data.url)).ok).toBe(true);
 expect((await post(`/api/v1/scans/${id}/renew-upload`,{})).status).toBe(409);
});
it('denies cross-tenant, peer writes, arbitrary fields/paths, malformed dimensions/bytes and oversized uploads',async()=>{
 const s=await create(), id=s.scan.scan_id;
 expect((await upload(id,jpeg,peer)).status).toBe(403); expect((await upload(id,jpeg,other)).status).toBe(404);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:whole,path:'https://evil.example/x'})).status).toBe(422);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:{...whole,x:0.2}})).status).toBe(422);
 for(const bytes of [Buffer.from('invalid'),Buffer.from([255,216,255,0,7]),Buffer.alloc(10485761),await sharp({create:{width:4100,height:64,channels:3,background:'red'}}).jpeg().toBuffer()]) expect((await upload(id,bytes)).status).toBe(422);
 expect((await h.db.query('select * from public.scan_jobs where scan_id=$1',[id])).rows).toHaveLength(0);
 expect((await ownerClientRpc()).error).not.toBeNull();
 async function ownerClientRpc(){const {createClient}=await import('@supabase/supabase-js'); const {localSupabase}=await import('../../db/src/env');const e=localSupabase();return createClient(e.apiUrl,e.publishableKey,{global:{headers:{Authorization:`Bearer ${owner.token}`}}}).rpc('photo_scan_workflow',{p_actor:owner.id,p_action:'authorize',p_resource:id,p_input:{}});}
});
it('recovers expired intent and lost upload/finalize response without replacing bytes or duplicate jobs',async()=>{
 const s=await create(),id=s.scan.scan_id;
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:whole})).status).toBe(503);
 await h.db.query("update public.upload_intents set expires_at=now()-interval '1 second',created_at=now()-interval '20 minutes' where resource_id=$1",[id]);
 expect((await upload(id)).status).toBe(409); expect((await post(`/api/v1/scans/${id}/renew-upload`,{})).status).toBe(200);
 expect((await upload(id)).status).toBe(200);
 const different=await sharp({create:{width:100,height:100,channels:3,background:'blue'}}).jpeg().toBuffer();expect((await upload(id,different)).status).toBe(409);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:2,crop:whole})).status).toBe(409);
 const key=randomUUID(),body={expected_revision:1,crop:whole};expect((await post(`/api/v1/scans/${id}/finalize-upload`,body,key)).status).toBe(200);
 await h.db.query("update public.upload_intents set expires_at=now()-interval '1 second',created_at=now()-interval '20 minutes' where resource_id=$1",[id]);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,body,key)).status).toBe(200);
 await h.db.query('update public.organization_memberships set active=false where user_id=$1',[owner.id]);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,body,key)).status).toBe(403);
 await h.db.query('update public.organization_memberships set active=true where user_id=$1',[owner.id]);
});
it('revalidates privileged malformed staging uploads, deletes rejected bytes and never queues them',async()=>{
 const s=await create(),id=s.scan.scan_id;
 const intent=(await h.db.query('select * from public.upload_intents where resource_id=$1',[id])).rows[0];
 const inserted=await h.service.storage.from('display-scans').upload(intent.object_path,Buffer.from([255,216,255,7,0]),{contentType:'image/jpeg'});expect(inserted.error).toBeNull();
 const res=await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:whole});expect(res.status,res.text).toBe(422);
 expect((await h.db.query('select state from public.upload_intents where resource_id=$1',[id])).rows[0].state).toBe('rejected');
 expect((await h.service.storage.from('display-scans').download(intent.object_path)).error).not.toBeNull();
 expect((await h.db.query('select * from public.scan_jobs where scan_id=$1',[id])).rows).toHaveLength(0);
});
it('different keys racing finalization commit only one crop; validated geometry and path cannot change',async()=>{
 const s=await create(),id=s.scan.scan_id;expect((await upload(id)).status).toBe(200);
 expect((await post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:{x:0,y:0,width:0.01,height:1}})).status).toBe(422);
 const results=await Promise.all([post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:whole}),post(`/api/v1/scans/${id}/finalize-upload`,{expected_revision:1,crop:{x:0,y:0,width:1,height:0.5}})]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await h.db.query('select * from public.scan_jobs where scan_id=$1',[id])).rows).toHaveLength(1);
 await expect(h.db.query("update public.scans set crop_json='{}' where id=$1",[id])).rejects.toThrow('IMMUTABLE');
 const bad=await fetch(`${adminBaseUrl()}/api/v1/scans/${id}/image`,{method:'PUT',headers:{authorization:'Bearer expired.invalid.token'},body:new Uint8Array(jpeg)});expect(bad.status).toBe(401);
});
it('limits new scans while preserving idempotent replay and rejecting missing pinned POG',async()=>{
 const store=(await h.db.query('select store_id,organization_id from public.displays where id=$1',[display])).rows[0];
 const limited=await h.user('photo-limited',{org:{id:store.organization_id,role:'member'},stores:[{id:store.store_id,role:'employee'}]});
 const body={display_id:display,source:'photo',expected_pog_version_id:version},key=randomUUID();
 const first=await post('/api/v1/scans',body,key,limited);expect(first.status).toBe(201);
 for(let i=0;i<9;i++)expect((await post('/api/v1/scans',body,randomUUID(),limited)).status).toBe(201);
 const rate=await post('/api/v1/scans',body,randomUUID(),limited);expect(rate.status,rate.text).toBe(429);expect(rate.headers.get('retry-after')).toBe('60');
 expect((await post('/api/v1/scans',body,key,limited)).json.data.scan.scan_id).toBe(first.json.data.scan.scan_id);
 expect((await post('/api/v1/scans',{display_id:display,source:'photo'})).status).toBe(422);
 expect((await post('/api/v1/scans',{...body,expected_pog_version_id:randomUUID()})).json.error.code).toBe('POG_CHANGED');
});
