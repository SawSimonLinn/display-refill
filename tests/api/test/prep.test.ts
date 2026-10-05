import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createHarness,type Harness,type ApiUser,SEED} from '../src/harness';
let h:Harness,org:string,store:string,product:string,manager:ApiUser,employee:ApiUser,peer:ApiUser,outsider:ApiUser;
type Item={id:string;backup_required:boolean};
type Check={id:string;revision:number;items:Item[]};
const post=(user:ApiUser,body:unknown,key=randomUUID())=>h.api(`/api/v1/production/${store}`,{method:'POST',token:user.token,body,headers:{'Idempotency-Key':key}});
const board=(user=employee)=>h.api(`/api/v1/prep/${store}`,{token:user.token});
const record=(body:unknown,key=randomUUID(),user=employee)=>h.api(`/api/v1/prep/${store}`,{method:'POST',token:user.token,body,headers:{'Idempotency-Key':key}});
const current=async()=>{const r=await board();expect(r.status).toBe(200);return r.json.data.items[0];};
async function start(section:string):Promise<Check>{const r=await post(employee,{action:'start',section});expect(r.status).toBe(200);return r.json.data;}
async function count(section:string,have:number,backup?:number){let c=await start(section);const s=await post(employee,{action:'counts',check_id:c.id,expected_revision:c.revision,items:c.items.map(i=>({id:i.id,have,...(i.backup_required?{backup}: {})}))});expect(s.status).toBe(200);c=s.json.data;const f=await post(employee,{action:'finish',check_id:c.id,expected_revision:c.revision});expect(f.status).toBe(200);return f.json.data;}
beforeAll(async()=>{
 h=await createHarness();org=randomUUID();store=randomUUID();product=randomUUID();
 await h.db.query("insert into public.organizations(id,name) values($1,'Prep HTTP')",[org]);
 await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Prep fixture','PREP','UTC')",[store,org]);
 await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Shared watermelon','Watermelon','Fruit','Bowl')",[product,org]);
 manager=await h.user('prep-manager',{org:{id:org,role:'member'},stores:[{id:store,role:'manager'}]});
 employee=await h.user('prep-employee',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 peer=await h.user('prep-peer',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 outsider=await h.user('prep-outside',{org:{id:SEED.orgB,role:'admin'}});
 for(const [section,par] of [['fruit_mobile',10],['fruit_case',36]])expect((await post(manager,{action:'configure',product_id:product,section,par,category:'Fruit',product_type:'Bowl',sort_order:0,active:true})).status).toBe(200);
});
afterAll(()=>h?.close());
it('requires authentication/store membership, hides PAR, and waits for both shared locations',async()=>{
 expect((await h.api(`/api/v1/prep/${store}`)).status).toBe(401);
 expect((await board(outsider)).status).toBe(404);
 await count('fruit_mobile',5,0);expect((await current()).ready).toBe(false);
 await count('fruit_case',16);const b=await board();expect(b.json.data.items).toHaveLength(1);expect(b.json.data.items[0]).toMatchObject({ready:true,needed:25,made:0,remaining:25});
 expect(JSON.stringify(b.json.data)).not.toContain('par');
});
it('partial preparation is shared, audited and idempotent; conflicting retry cannot add again',async()=>{
 const row=await current();const body={product_id:product,expected_revision:row.revision,quantity:20};const key=randomUUID();
 const a=await record(body,key);expect(a.status).toBe(200);expect(a.json.data.items[0]).toMatchObject({made:20,remaining:5});
 expect((await record(body,key)).json.data).toEqual(a.json.data);
 expect((await record({...body,quantity:19},key)).status).toBe(409);
 expect((await board(peer)).json.data.items[0]).toMatchObject({made:20,remaining:5});
 const events=await h.db.query('select quantity,actor_id,created_at from public.production_prep_events where store_id=$1',[store]);expect(events.rows).toHaveLength(1);expect(events.rows[0].quantity).toBe(20);expect(events.rows[0].actor_id).toBe(employee.id);
 expect(a.json.data.items[0].activity[0].quantity).toBe(20);
 await expect(h.db.query('update public.production_prep_events set quantity=1 where store_id=$1',[store])).rejects.toThrow('IMMUTABLE');
});
it('strict validation rejects unknown fields, fractions, negatives, over-remaining and stale Done',async()=>{
 const row=await current();const base={product_id:product,expected_revision:row.revision};
 for(const body of [{...base,quantity:-1},{...base,quantity:1.5},{...base,quantity:0},{...base,quantity:6},{...base,quantity:2,done:true},{...base,quantity:1,actor_id:manager.id},{...base}])expect((await record(body)).status).toBe(422);
 const results=await Promise.all([record({...base,quantity:2}),record({...base,done:true},randomUUID(),peer)]);
 expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>r.status===409)).toHaveLength(1);
 const fresh=await current();if(fresh.remaining>0)expect((await record({product_id:product,expected_revision:fresh.revision,done:true})).status).toBe(200);
 expect((await current()).remaining).toBe(0);
});
it('recount includes prepared stock once; mixed baselines block prep until both locations counted',async()=>{
 await count('fruit_mobile',10,0);let row=await current();expect(row.ready).toBe(false);expect(row.remaining).toBeNull();
 expect((await record({product_id:product,expected_revision:row.revision,quantity:1})).status).toBe(409);
 // 25 made, moved to the displays. Physical total 46 => no further production.
 await count('fruit_case',36);row=await current();expect(row).toMatchObject({ready:true,needed:0,made:0,remaining:0});
 // Five sales reflected by a later count, not by subtracting past production again.
 await count('fruit_mobile',5,0);expect((await current()).ready).toBe(false);await count('fruit_case',36);expect(await current()).toMatchObject({needed:5,made:0,remaining:5});
});
it('prep during a draft prevents stale publication; restart is atomic, blank and replay-safe',async()=>{
 let draft=await start('fruit_mobile');
 const saved=await post(employee,{action:'counts',check_id:draft.id,expected_revision:draft.revision,items:[{id:draft.items[0]!.id,have:5,backup:0}]});expect(saved.status).toBe(200);draft=saved.json.data;
 const row=await current();expect((await record({product_id:product,expected_revision:row.revision,quantity:2})).status).toBe(200);
 expect((await post(employee,{action:'finish',check_id:draft.id,expected_revision:draft.revision})).status).toBe(409);
 const body={action:'restart',check_id:draft.id,expected_revision:draft.revision};const key=randomUUID();
 expect((await post(peer,body)).status).toBe(403);
 const fresh=await post(employee,body,key);expect(fresh.status).toBe(200);expect(fresh.json.data.id).not.toBe(draft.id);expect(fresh.json.data.items[0].have).toBeNull();
 expect((await post(employee,body,key)).json.data).toEqual(fresh.json.data);
 expect((await h.db.query('select status from public.production_checks where id=$1',[draft.id])).rows[0].status).toBe('abandoned');
 await count('fruit_mobile',7,0);await count('fruit_case',36);expect(await current()).toMatchObject({needed:3,made:0,remaining:3});
});
it('quick stock update publishes all product locations atomically without deducting prior prep again',async()=>{
 const row=await current();
 const stock=(body:unknown,key=randomUUID(),user=employee)=>h.api(`/api/v1/stock/${store}`,{method:'POST',token:user.token,body,headers:{'Idempotency-Key':key}});
 const body={product_id:product,expected_revision:row.revision,counts:[{section:'fruit_mobile',have:10,backup:0},{section:'fruit_case',have:31}]};const key=randomUUID();
 expect((await stock(body,randomUUID(),outsider)).status).toBe(404);
 expect((await stock({...body,counts:[body.counts[0]]})).status).toBe(422);
 const saved=await stock(body,key);expect(saved.status).toBe(200);expect(saved.json.data.items[0]).toMatchObject({ready:true,needed:5,made:0,remaining:5});
 expect((await stock(body,key)).json.data).toEqual(saved.json.data);
 expect((await stock(body)).status).toBe(409);
 const next=saved.json.data.items[0];expect(next.locations.map((l:{have:number})=>l.have)).toEqual([10,31]);
 expect((await record({product_id:product,expected_revision:next.revision,quantity:2})).status).toBe(200);
 const newer=await current();
 // Move backup to display; same physical total remains 43 (46 PAR - 3).
 const moved=await stock({product_id:product,expected_revision:newer.revision,counts:[{section:'fruit_mobile',have:10,backup:0},{section:'fruit_case',have:33}]});expect(moved.status).toBe(200);expect(moved.json.data.items[0]).toMatchObject({ready:true,made:0,remaining:3});
 const audits=await h.db.query("select after_value from public.production_events where store_id=$1 and after_value->>'scope'='product_recount'",[store]);expect(audits.rows).toHaveLength(4);
});
it('a newer product update prevents an older open full-section count from overwriting it',async()=>{
 const c=await start('fruit_mobile');const saved=await post(employee,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:1,backup:0}]});expect(saved.status).toBe(200);
 const row=await current();const r=await h.api(`/api/v1/stock/${store}`,{method:'POST',token:peer.token,headers:{'Idempotency-Key':randomUUID()},body:{product_id:product,expected_revision:row.revision,counts:[{section:'fruit_mobile',have:10,backup:0},{section:'fruit_case',have:33}]}});expect(r.status).toBe(200);
 expect((await post(employee,{action:'finish',check_id:c.id,expected_revision:saved.json.data.revision})).status).toBe(409);
 expect((await current()).remaining).toBe(3);
});
it('membership revocation denies reads, writes and exact idempotent replays',async()=>{
 const row=await current();const body={product_id:product,expected_revision:row.revision,quantity:1};const key=randomUUID();expect((await record(body,key)).status).toBe(200);
 await h.db.query('update public.store_memberships set active=false where store_id=$1 and user_id=$2',[store,employee.id]);
 expect((await board()).status).toBe(404);expect((await record(body,key)).status).toBe(404);
 expect((await record(body,randomUUID(),outsider)).status).toBe(404);
});
