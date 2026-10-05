import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createHarness,type Harness,type ApiUser,SEED} from '../src/harness';
let h:Harness;let org:string;let store:string;let product:string;let manager:ApiUser;let employee:ApiUser;let outsider:ApiUser;
const route=()=>`/api/v1/production/${store}`;
const post=(user:ApiUser,body:unknown,key=randomUUID())=>h.api(route(),{method:'POST',token:user.token,body,headers:{'Idempotency-Key':key}});
const get=(user:ApiUser,view='day')=>h.api(`${route()}?view=${view}`,{token:user.token});
beforeAll(async()=>{
 h=await createHarness();org=randomUUID();store=randomUUID();product=randomUUID();
 await h.db.query("insert into public.organizations(id,name) values($1,'Worksheet HTTP')",[org]);
 await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Fixture','HTTPWORK','UTC')",[store,org]);
 await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Fruit bowl','Fruit','Fruit','Bowl')",[product,org]);
 manager=await h.user('worksheet-manager',{org:{id:org,role:'member'},stores:[{id:store,role:'manager'}]});
 employee=await h.user('worksheet-employee',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 outsider=await h.user('worksheet-outside',{org:{id:SEED.orgB,role:'admin'}});
});
afterAll(()=>h?.close());
const config=()=>({action:'configure',product_id:product,section:'fruit_mobile',par:10,category:'Fruit',product_type:'Bowl',sort_order:0,active:true});
it('requires verified identity and enforces manager/store authority',async()=>{
 expect((await h.api(route())).status).toBe(401);
 expect((await get(outsider)).status).toBe(404);
 expect((await post(employee,config())).status).toBe(403);
 expect((await post(manager,config())).status).toBe(200);
 expect((await get(employee,'events')).status).toBe(403);
 const cfg=await get(employee,'config');expect(cfg.status).toBe(200);expect(cfg.json.data.items[0].par).toBeUndefined();
 expect((await get(manager,'config')).json.data.items[0].par).toBe(10);
});
it('full manual worksheet saves, finishes, replays and replaces latest without PAR disclosure',async()=>{
 const start=await post(employee,{action:'start',section:'fruit_mobile'});expect(start.status).toBe(200);
 const c=start.json.data;expect(c.items[0].have).toBeNull();expect(c.items[0].make).toBeNull();expect(JSON.stringify(c)).not.toContain('par');
 expect((await post(employee,{action:'finish',check_id:c.id,expected_revision:c.revision})).status).toBe(422);
 const body={action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0].id,have:7}]};const key=randomUUID();
 const saved=await post(employee,body,key);expect(saved.status).toBe(200);expect(saved.json.data.total_make).toBe(3);
 expect((await post(employee,body,key)).json.data).toEqual(saved.json.data);
 expect((await post(employee,{...body,items:[{id:c.items[0].id,have:8}]})).status).toBe(409);
 const finished=await post(employee,{action:'finish',check_id:c.id,expected_revision:saved.json.data.revision});expect(finished.status).toBe(200);
 const day=await get(employee);expect(day.json.data.total_make).toBe(3);expect(day.json.data.complete).toBe(false);expect(day.json.data.sections).toHaveLength(4);
 const second=(await post(employee,{action:'start',section:'fruit_mobile'})).json.data;
 const s=(await post(employee,{action:'counts',check_id:second.id,expected_revision:second.revision,items:[{id:second.items[0].id,have:9}]})).json.data;
 expect((await get(employee)).json.data.total_make).toBe(3);
 expect((await post(employee,{action:'finish',check_id:s.id,expected_revision:s.revision})).status).toBe(200);
 expect((await get(employee)).json.data.total_make).toBe(1);
 expect((await get(manager,'events')).json.data.events.some((e:{kind:string})=>e.kind==='count.updated')).toBe(true);
});
it('strict input rejects injected totals, fractions, unknown sections and missing revision',async()=>{
 expect((await post(manager,{...config(),make:999})).status).toBe(422);
 expect((await post(manager,{...config(),par:1.5})).status).toBe(422);
 expect((await post(employee,{action:'start',section:'other'})).status).toBe(422);
 const cfg=(await get(manager,'config')).json.data.items[0];
 expect((await post(manager,{...config(),item_id:cfg.id})).status).toBe(422);
 expect((await h.api(`${route()}?view=check`,{token:employee.token})).status).toBe(422);
});
it('shared product HTTP flow counts displays separately and cooler backup once',async()=>{
 const shared=randomUUID();
 await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Shared test bowl','Shared','Fruit','Bowl')",[shared,org]);
 for(const [section,par] of [['fruit_mobile',10],['fruit_case',36]] as const)expect((await post(manager,{...config(),product_id:shared,section,par})).status).toBe(200);
 let a=(await post(employee,{action:'start',section:'fruit_mobile'})).json.data;
 let b=(await post(employee,{action:'start',section:'fruit_case'})).json.data;
 const ai=a.items.find((i:{product_id:string})=>i.product_id===shared);
 const bi=b.items[0];expect(ai.backup_required).toBe(true);expect(bi.backup_required).toBe(false);
 expect((await post(employee,{action:'counts',check_id:b.id,expected_revision:b.revision,items:[{id:bi.id,have:28,backup:5}]})).status).toBe(422);
 a=(await post(employee,{action:'counts',check_id:a.id,expected_revision:a.revision,items:a.items.map((i:{id:string})=>i.id===ai.id?{id:i.id,have:7,backup:5}:{id:i.id,have:100})})).json.data;
 expect(a.items.find((i:{id:string})=>i.id===ai.id).make).toBe(3); // This section has an immediate shortage before the other section is counted.
 expect((await post(employee,{action:'finish',check_id:a.id,expected_revision:a.revision})).status).toBe(200);
 b=(await post(employee,{action:'counts',check_id:b.id,expected_revision:b.revision,items:[{id:bi.id,have:28}]})).json.data;
 expect((await post(employee,{action:'finish',check_id:b.id,expected_revision:b.revision})).status).toBe(200);
 expect((await get(employee)).json.data.total_make).toBe(6);
});
it('live-token revocation denies all views and mutations immediately',async()=>{
 await h.db.query('update public.store_memberships set active=false where store_id=$1 and user_id=$2',[store,employee.id]);
 for(const view of ['day','config','events'])expect((await get(employee,view)).status).toBe(404);
 expect((await post(employee,{action:'start',section:'fruit_mobile'})).status).toBe(404);
});
