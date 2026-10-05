import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { createHarness,type Harness,type ApiUser,SEED } from '../src/harness';
let h:Harness,org:string,store:string,product:string,employee:ApiUser,other:ApiUser,manager:ApiUser,outsider:ApiUser;
beforeAll(async()=>{
 h=await createHarness();org=randomUUID();store=randomUUID();product=randomUUID();
 await h.db.query("insert into public.organizations(id,name) values($1,'Waste HTTP isolated')",[org]);
 await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Waste HTTP','WH','America/Los_Angeles')",[store,org]);
 await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'$5 Watermelon','Watermelon','Fruit','Bowl')",[product,org]);
 manager=await h.user('waste-http-manager',{org:{id:org,role:'member'},stores:[{id:store,role:'manager'}]});
 employee=await h.user('waste-http-employee',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 other=await h.user('waste-http-other',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 outsider=await h.user('waste-http-outside',{org:{id:SEED.orgB,role:'admin'}});
 await h.db.query("insert into public.production_items(organization_id,store_id,product_id,section,par,category,product_type,updated_by) values($1,$2,$3,'fruit_mobile',5,'$5 bowls','Bowl',$4)",[org,store,product,manager.id]);
});afterAll(()=>h?.close());
const payload=()=>({action:'record',product_id:product,quantity:5,reason:'expired',business_date:'2026-09-13'});
const post=(user:ApiUser,body:unknown,key=randomUUID())=>h.api(`/api/v1/waste/${store}`,{method:'POST',token:user.token,body,headers:{'Idempotency-Key':key}});
const get=(user:ApiUser,query='day=2026-09-13&period=day')=>h.api(`/api/v1/operations/${store}?${query}`,{token:user.token});
it('requires verified identity and hides stores across organizations',async()=>{
 expect((await h.api(`/api/v1/operations/${store}`)).status).toBe(401);
 expect((await get(outsider)).status).toBe(404);expect((await post(outsider,payload())).status).toBe(404);
});
it('strict validation rejects forged totals/actors, fractions, future dates and missing keys',async()=>{
 for(const extra of [{actor_id:manager.id},{quantity:1.5},{quantity:0},{made:100},{business_date:'2099-01-01'},{reason:'unknown'}])expect((await post(employee,{...payload(),...extra})).status).toBe(422);
 expect((await h.api(`/api/v1/waste/${store}`,{method:'POST',token:employee.token,body:payload()})).status).toBe(422);
 expect((await get(employee,'period=year')).status).toBe(422);
});
it('records once, shows local day/week/month totals and hides PAR',async()=>{
 const key=randomUUID();const first=await post(employee,payload(),key);expect(first.status).toBe(200);expect(first.json.data.wasted).toBe(5);
 expect((await post(employee,payload(),key)).json.data).toEqual(first.json.data);
 for(const period of ['day','week','month']){const response=await get(employee,`day=2026-09-13&period=${period}`);expect(response.status).toBe(200);expect(response.json.data.wasted).toBe(5);expect(response.json.data.made).toBe(0);expect(JSON.stringify(response.json.data)).not.toContain('"par"');expect(response.json.data.products).toHaveLength(1);}
 const week=(await get(employee,'day=2026-09-13&period=week')).json.data;expect(week.start_date).toBe('2026-09-13');expect(week.end_date).toBe('2026-09-19');
});
it('only owner/manager can undo, with immutable visible original and replay protection',async()=>{
 const entry=(await get(employee)).json.data.entries[0];
 expect((await post(other,{action:'void',entry_id:entry.id})).status).toBe(403);
 const key=randomUUID();const undone=await post(manager,{action:'void',entry_id:entry.id},key);expect(undone.status).toBe(200);expect(undone.json.data.wasted).toBe(0);expect(undone.json.data.entries[0].voided).toBe(true);
 expect((await post(manager,{action:'void',entry_id:entry.id},key)).json.data).toEqual(undone.json.data);
 expect((await post(manager,{action:'void',entry_id:entry.id})).status).toBe(409);
});
it('live-token revocation blocks reporting and recording on the next request',async()=>{
 await h.db.query('update public.store_memberships set active=false where store_id=$1 and user_id=$2',[store,employee.id]);
 expect((await get(employee)).status).toBe(404);expect((await post(employee,payload())).status).toBe(404);
});
