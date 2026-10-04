import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createWorld, type World, type TestUser } from '../src/world';
import type { Json } from '@display-refill/server';
let w:World; let store:string; let org:string; let product:string; let manager:TestUser; let owner:TestUser; let peer:TestUser;
type Check={id:string;revision:number;status:string;total_make:number|null;items:Array<{id:string;have:number|null;make:number|null}>};
type Config={items:Array<{id:string;revision:number;par?:number}>};
const setup=(extra:Record<string,Json>={})=>({action:'configure',product_id:product,section:'fruit_mobile',par:10,category:'Fruit',product_type:'Bowl',sort_order:0,active:true,...extra});
const mutate=(actor:string,body:Record<string,Json>,key=randomUUID())=>w.service.rpc('production_mutate',{p_actor:actor,p_store:store,p_body:body,p_key:key});
const read=(actor:string,view='day',check?:string)=>w.service.rpc('production_read',{p_actor:actor,p_store:store,p_view:view,p_check:check});
async function success<T>(op:ReturnType<typeof mutate>):Promise<T>{const r=await op;expect(r.error).toBeNull();return r.data as T;}
async function start(){return success<Check>(mutate(owner.id,{action:'start',section:'fruit_mobile'}));}
async function save(c:Check,have:number|null){return success<Check>(mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have}]}));}
async function finish(c:Check){return success<Check>(mutate(owner.id,{action:'finish',check_id:c.id,expected_revision:c.revision}));}
beforeAll(async()=>{
 w=await createWorld();org=randomUUID();store=randomUUID();product=randomUUID();
 await w.db.query("insert into public.organizations(id,name) values ($1,'Worksheet test')",[org]);
 await w.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Worksheet','WORK','America/Los_Angeles')",[store,org]);
 await w.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic fruit bowl','Fruit','Fruit','bowl')",[product,org]);
 manager=await w.user('worksheet-manager',{org:{id:org,role:'member'},stores:[{id:store,role:'manager'}]});
 owner=await w.user('worksheet-owner',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
 peer=await w.user('worksheet-peer',{org:{id:org,role:'member'},stores:[{id:store,role:'employee'}]});
});
afterAll(()=>w?.close());
it('manager configures PAR and employee cannot mutate it',async()=>{
 expect((await mutate(owner.id,setup())).error?.message).toBe('FORBIDDEN');
 const cfg=await success<Config>(mutate(manager.id,setup()));expect(cfg.items[0]?.par).toBe(10);
});
it('fresh store authorization rejects outsider, revoked member and public RPC calls',async()=>{
 expect((await read(w.users.adminB.id)).error?.message).toBe('NOT_FOUND');
 expect((await mutate(w.users.adminB.id,setup())).error?.message).toBe('NOT_FOUND');
 expect((await owner.client.rpc('production_read',{p_actor:manager.id,p_store:store})).error?.code).toBe('42501');
 expect((await owner.client.from('production_items').select('*')).error?.code).toBe('42501');
});
it('employee configuration and check response contain no PAR; null is uncounted',async()=>{
 const cfg=await read(owner.id,'config');expect(cfg.error).toBeNull();expect(JSON.stringify(cfg.data)).not.toContain('"par"');
 const c=await start();expect(c.items[0]).toMatchObject({have:null,make:null});expect(c.total_make).toBeNull();
 expect(JSON.stringify(c)).not.toContain('par');
 expect((await mutate(owner.id,{action:'finish',check_id:c.id,expected_revision:c.revision})).error?.message).toBe('VALIDATION_FAILED');
});
it('resumes draft on relaunch rather than losing counts',async()=>{
 let c=await start();c=await save(c,0);const resumed=await start();expect(resumed.id).toBe(c.id);expect(resumed.items[0]).toMatchObject({have:0,make:10});
 const day=(await read(owner.id)).data as {sections:Array<{in_progress:boolean}>};expect(day.sections[0]?.in_progress).toBe(true);
});
it('exact retries replay once; changed body with same key conflicts',async()=>{
 const c=await start();const key=randomUUID();const b={action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:7}]};
 const a=await success<Check>(mutate(owner.id,b,key));const replay=await success<Check>(mutate(owner.id,b,key));expect(replay).toEqual(a);
 expect((await mutate(owner.id,{...b,items:[{id:c.items[0]!.id,have:8}]},key)).error?.message).toBe('CONFLICT');
});
it('another employee cannot overwrite a count; manager can review',async()=>{
 const c=await start();expect((await mutate(peer.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:4}]})).error?.message).toBe('FORBIDDEN');
 expect((await read(manager.id,'check',c.id)).error).toBeNull();
});
it('simultaneous count saves have one winner',async()=>{
 const c=await start();const results=await Promise.all([3,4].map(have=>mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have}]})));
 expect(results.filter(x=>!x.error)).toHaveLength(1);expect(results.find(x=>x.error)?.error?.message).toBe('CONFLICT');
});
it('rejects authority injection, fractions, negative quantities and duplicate rows',async()=>{
 const c=await start();for(const have of [-1,1.5,10000])expect((await mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have}]})).error?.message).toBe('VALIDATION_FAILED');
 expect((await mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:1,par:500}]})).error?.message).toBe('VALIDATION_FAILED');
 expect((await mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:1},{id:c.items[0]!.id,have:2}]})).error?.message).toBe('VALIDATION_FAILED');
});
it('PAR changes do not change an existing check; direct snapshot edits are blocked',async()=>{
 let c=await start();const cfg=(await read(manager.id,'config')).data as Config;const i=cfg.items[0]!;
 await success(mutate(manager.id,setup({item_id:i.id,expected_revision:i.revision,par:12})));
 c=await save(c,7);expect(c.total_make).toBe(3);
 await expect(w.db.query('update public.production_counts set par_snapshot=99 where id=$1',[c.items[0]!.id])).rejects.toThrow('IMMUTABLE');
 await finish(c);
});
it('latest finished section replaces earlier shortage; draft does not replace it',async()=>{
 let day=(await read(owner.id)).data as {total_make:number;complete:boolean;sections:unknown[]};expect(day.total_make).toBe(3);expect(day.complete).toBe(false);expect(day.sections).toHaveLength(4);
 let c=await start();c=await save(c,10);expect(c.total_make).toBe(2);
 expect(((await read(owner.id)).data as {total_make:number}).total_make).toBe(3);
 await finish(c);expect(((await read(owner.id)).data as {total_make:number}).total_make).toBe(2);
});
it('same-day section moves cannot double-count a product',async()=>{
 const cfg=(await read(manager.id,'config')).data as Config;const i=cfg.items[0]!;
 expect((await mutate(manager.id,setup({item_id:i.id,expected_revision:i.revision,section:'salad_mobile'}))).error?.message).toBe('VALIDATION_FAILED');
 expect(((await read(owner.id)).data as {total_make:number}).total_make).toBe(2);
});
it('finished records refuse all later edits and over-PAR produces zero',async()=>{
 let c=await start();c=await save(c,20);expect(c.total_make).toBe(0);c=await finish(c);
 expect((await mutate(owner.id,{action:'counts',check_id:c.id,expected_revision:c.revision,items:[{id:c.items[0]!.id,have:0}]})).error?.message).toBe('CONFLICT');
 await expect(w.db.query('update public.production_counts set have=0 where check_id=$1',[c.id])).rejects.toThrow('IMMUTABLE');
});
it('manager sees append-only count and PAR history with timestamps; employee denied',async()=>{
 expect((await read(owner.id,'events')).error?.message).toBe('FORBIDDEN');
 const data=(await read(manager.id,'events')).data as {events:Array<{kind:string;actor_id:string;created_at:string;after:Record<string,Json>}>};
 expect(data.events.some(x=>x.kind==='par.updated'&&x.actor_id===manager.id)).toBe(true);
 expect(data.events.some(x=>x.kind==='count.updated'&&x.actor_id===owner.id&&x.after.have===7)).toBe(true);
 expect(data.events.every(x=>Number.isFinite(Date.parse(x.created_at)))).toBe(true);
 await expect(w.db.query('delete from public.production_events where store_id=$1',[store])).rejects.toThrow('IMMUTABLE');
});
it('shared displays subtract cooler backup once and wait for both finished sections',async()=>{
 const shared=randomUUID();
 await w.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Shared watermelon','Shared','Fruit','Bowl')",[shared,org]);
 for(const [section,par] of [['fruit_mobile',10],['fruit_case',36]] as const)await success(mutate(manager.id,setup({product_id:shared,section,par})));
 let a=await start();let b=await success<Check>(mutate(owner.id,{action:'start',section:'fruit_case'}));
 type SharedItem={id:string;product_id:string;backup_required:boolean;shared_size:number;make:number|null};
 const ai=(a.items as unknown as SharedItem[]).find(i=>i.product_id===shared)!;const bi=(b.items as unknown as SharedItem[])[0]!;
 const sharedConfig=(await read(manager.id,'config')).data as {items:Array<{id:string;product_id:string;section:string;revision:number}>};
 const sibling=sharedConfig.items.find(i=>i.product_id===shared&&i.section==='fruit_case')!;
 expect((await mutate(manager.id,setup({product_id:shared,item_id:sibling.id,expected_revision:sibling.revision,section:'fruit_case',par:36,active:false}))).error?.message).toBe('VALIDATION_FAILED');
 expect(ai.backup_required).toBe(true);expect(bi.backup_required).toBe(false);expect(ai.shared_size).toBe(2);
 expect((await mutate(owner.id,{action:'counts',check_id:b.id,expected_revision:b.revision,items:[{id:bi.id,have:28,backup:5}]})).error?.message).toBe('VALIDATION_FAILED');
 a=await success<Check>(mutate(owner.id,{action:'counts',check_id:a.id,expected_revision:a.revision,items:a.items.map(i=>({id:i.id,have:i.id===ai.id?7:20}))}));
 expect((await mutate(owner.id,{action:'finish',check_id:a.id,expected_revision:a.revision})).error?.message).toBe('VALIDATION_FAILED');
 const sharedBody={action:'counts',check_id:a.id,expected_revision:a.revision,items:[{id:ai.id,have:7,backup:5}]};const sharedKey=randomUUID();
 a=await success<Check>(mutate(owner.id,sharedBody,sharedKey));expect(await success<Check>(mutate(owner.id,sharedBody,sharedKey))).toEqual(a);
 await finish(a);
 let day=(await read(owner.id)).data as {total_make:number;complete:boolean;sections:Array<{items:SharedItem[]}>};
 expect(day.sections.flatMap(s=>s.items).find(i=>i.product_id===shared)?.make).toBeNull();expect(day.complete).toBe(false);
 b=await success<Check>(mutate(owner.id,{action:'counts',check_id:b.id,expected_revision:b.revision,items:[{id:bi.id,have:28}]}));await finish(b);
 day=(await read(owner.id)).data as typeof day;
 expect(day.sections.flatMap(s=>s.items).filter(i=>i.product_id===shared).reduce((n,i)=>n+(i.make??0),0)).toBe(6);
 expect(day.total_make).toBe(6);
 await expect(w.db.query('update public.production_counts set backup=100 where id=$1',[ai.id])).rejects.toThrow('IMMUTABLE');
});
it('live-token membership revocation removes access on next request',async()=>{
 await w.db.query('update public.store_memberships set active=false where store_id=$1 and user_id=$2',[store,owner.id]);
 expect((await read(owner.id)).error?.message).toBe('NOT_FOUND');
});
