import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { createWorld,type World,type TestUser } from '../src/world';
let w:World,org:string,store:string,employee:TestUser,other:TestUser,manager:TestUser;
beforeAll(async()=>{
 w=await createWorld();org=randomUUID();store=randomUUID();
 await w.db.query("insert into public.organizations(id,name) values($1,'Waste isolated tests')",[org]);
 await w.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Waste fixture','WASTE','America/Los_Angeles')",[store,org]);
 employee=await w.user('waste-employee',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 other=await w.user('waste-other',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 manager=await w.user('waste-manager',{org:{id:org,role:'member'},stores:[{id:store,role:'manager'}]});
});afterAll(()=>w?.close());
async function product(){const id=randomUUID();await w.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'$5 Waste bowl','Waste','Fruit','Bowl')",[id,org]);await w.db.query("insert into public.production_items(organization_id,store_id,product_id,section,par,category,product_type,updated_by) values($1,$2,$3,'fruit_mobile',5,'$5 bowls','Bowl',$4)",[org,store,id,manager.id]);return id;}
const read=(actor=employee,day?:string,period='day')=>w.service.rpc('production_operations_read',{p_actor:actor.id,p_store:store,p_day:day,p_period:period});
const record=(body:Record<string,unknown>,actor=employee,key=randomUUID())=>w.service.rpc('production_waste_record',{p_actor:actor.id,p_store:store,p_body:body as never,p_key:key});
const body=(id:string,day?:string)=>({action:'record',product_id:id,quantity:5,reason:'expired',...(day?{business_date:day}:{})});
it('rejects direct browser writes, forged actors and cross-organization reads',async()=>{
 expect((await employee.client.from('production_waste_events').select('*')).error?.code).toBe('42501');
 expect((await employee.client.rpc('production_operations_read',{p_actor:manager.id,p_store:store})).error?.code).toBe('42501');
 expect((await employee.client.rpc('production_waste_record',{p_actor:manager.id,p_store:store,p_body:{},p_key:randomUUID()})).error?.code).toBe('42501');
 expect((await read(w.users.adminB)).error?.message).toBe('NOT_FOUND');
 const flags=await w.db.query("select relrowsecurity from pg_class where oid='public.production_waste_events'::regclass");expect(flags.rows[0].relrowsecurity).toBe(true);
});
it('concurrent retry creates one event; snapshots survive renaming; history is append-only',async()=>{
 const id=await product(),key=randomUUID();const before=(await w.db.query('select count(*)::int n from public.production_prep_events where store_id=$1',[store])).rows[0].n;
 const [a,b]=await Promise.all([record(body(id),employee,key),record(body(id),employee,key)]);
 expect(a.error).toBeNull();expect(b.data).toEqual(a.data);
 const entries=(a.data as any).entries.filter((e:any)=>e.product_id===id);expect(entries).toHaveLength(1);
 await w.db.query("update public.products set name='Renamed bowl' where id=$1",[id]);
 expect((await read()).data).toBeTruthy();expect(((await read()).data as any).entries.find((e:any)=>e.id===entries[0].id).product_name).toBe('$5 Waste bowl');
 await expect(w.db.query('update public.production_waste_events set quantity=1 where id=$1',[entries[0].id])).rejects.toThrow('IMMUTABLE');
 await expect(w.db.query('delete from public.production_waste_events where id=$1',[entries[0].id])).rejects.toThrow('IMMUTABLE');
 expect((await record({...body(id),quantity:2},employee,key)).error?.message).toBe('CONFLICT');
 expect((await w.db.query('select count(*)::int n from public.production_prep_events where store_id=$1',[store])).rows[0].n).toBe(before);
});
it('undo permits owner or manager, retains original and prevents double reversal',async()=>{
 const id=await product();const saved=await record(body(id));const entry=(saved.data as any).entries.find((e:any)=>e.product_id===id);
 expect((await record({action:'void',entry_id:entry.id},other)).error?.message).toBe('FORBIDDEN');
 const key=randomUUID();const undone=await record({action:'void',entry_id:entry.id},manager,key);expect(undone.error).toBeNull();
 expect((undone.data as any).products.find((p:any)=>p.product_id===id).wasted).toBe(0);
 expect((undone.data as any).entries.find((e:any)=>e.id===entry.id).voided).toBe(true);
 expect((await record({action:'void',entry_id:entry.id},manager,key)).data).toEqual(undone.data);
 expect((await record({action:'void',entry_id:entry.id})).error?.message).toBe('CONFLICT');
});
it('calendar reports use local midnight, Sunday weeks and calendar months without counting prep twice',async()=>{
 const id=await product();
 for(const [at,qty] of [['2026-09-14T06:59:59Z',9],['2026-09-14T07:00:00Z',13],['2026-10-01T07:00:00Z',7]] as const)await w.db.query('insert into public.production_prep_events(organization_id,store_id,product_id,quantity,actor_id,created_at) values($1,$2,$3,$4,$5,$6)',[org,store,id,qty,employee.id,at]);
 expect((await record(body(id,'2026-09-13'))).error).toBeNull();expect((await record({...body(id,'2026-09-14'),quantity:2})).error).toBeNull();
 const day=(await read(employee,'2026-09-13')).data as any;expect(day.products.find((p:any)=>p.product_id===id)).toMatchObject({made:9,wasted:5});
 const week=(await read(employee,'2026-09-14','week')).data as any;expect(week.start_date).toBe('2026-09-13');expect(week.end_date).toBe('2026-09-19');expect(week.products.find((p:any)=>p.product_id===id)).toMatchObject({made:22,wasted:7});
 const month=(await read(employee,'2026-09-14','month')).data as any;expect(month.start_date).toBe('2026-09-01');expect(month.end_date).toBe('2026-09-30');expect(month.products.find((p:any)=>p.product_id===id).made).toBe(22);
});
it('rejects invalid quantities, future dates, unknown products and injected totals',async()=>{
 const id=await product();for(const invalid of [{quantity:0},{quantity:1.5},{quantity:10000},{business_date:'2099-01-01'},{made:100},{reason:'invalid'}])expect((await record({...body(id),...invalid})).error).not.toBeNull();
 expect((await record(body(randomUUID()))).error?.message).toBe('NOT_FOUND');
 expect((await read(employee,'2099-01-01')).error?.message).toBe('VALIDATION_FAILED');
});
it('revoking live membership immediately blocks reads and writes',async()=>{
 await w.db.query('update public.store_memberships set active=false where user_id=$1 and store_id=$2',[other.id,store]);
 expect((await read(other)).error?.message).toBe('NOT_FOUND');expect((await record(body(await product()),other)).error?.message).toBe('NOT_FOUND');
});
it('edit voids and re-records atomically, keeps the day, and reports daily and reason totals',async()=>{
 const id=await product();const saved=await record(body(id,'2026-09-15'));const entry=(saved.data as any).entries.find((e:any)=>e.product_id===id);
 const edit={action:'edit',entry_id:entry.id,quantity:3,reason:'quality',note:'Bruised'};
 const peer=await w.user('waste-peer',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 expect((await record(edit,peer)).error?.message).toBe('FORBIDDEN');
 for(const invalid of [{quantity:0},{quantity:1.5},{reason:'invalid'},{product_id:id},{business_date:'2026-09-16'}])expect((await record({...edit,...invalid})).error).not.toBeNull();
 const key=randomUUID();const edited=await record(edit,manager,key);expect(edited.error).toBeNull();
 const data=edited.data as any;expect(data.business_date).toBe('2026-09-15');expect(data.products.find((p:any)=>p.product_id===id).wasted).toBe(3);
 expect(data.entries.find((e:any)=>e.id===entry.id)).toMatchObject({voided:true,edited:true,can_void:false});
 expect(data.entries.find((e:any)=>e.product_id===id&&!e.voided)).toMatchObject({quantity:3,reason:'quality',note:'Bruised',edited:false});
 expect((await record(edit,manager,key)).data).toEqual(edited.data);
 expect((await record(edit,manager)).error?.message).toBe('CONFLICT');
 const current=data.entries.find((e:any)=>e.product_id===id&&!e.voided);
 const unchanged=await record({action:'edit',entry_id:current.id,quantity:3,reason:'quality',note:'Bruised'},manager);
 expect((unchanged.data as any).entries.find((e:any)=>e.id===current.id).voided).toBe(false);
 const week=(await read(employee,'2026-09-15','week')).data as any;
 expect(week.days).toHaveLength(7);expect(week.days.map((d:any)=>d.date)[0]).toBe('2026-09-13');
 expect(week.days.find((d:any)=>d.date==='2026-09-15').wasted).toBe(3);
 expect(week.days.reduce((n:number,d:any)=>n+Number(d.wasted),0)).toBe(Number(week.wasted));
 expect(week.reasons.find((r:any)=>r.reason==='quality').wasted).toBeGreaterThanOrEqual(3);
 expect(week.reasons.every((r:any)=>Number(r.wasted)!==0)).toBe(true);
});
