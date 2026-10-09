import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createWorld, type World, type TestUser } from '../src/world';
import type { Json } from '@display-refill/server';

// Feature 16 unit 1: admin display case types, store selection and PAR defaults/overrides.
let w:World; let org:string; let storeA:string; let storeB:string; let bowl:string; let cup:string;
let admin:TestUser; let managerA:TestUser; let managerB:TestUser; let employeeA:TestUser;
type Item={id:string;product_id:string;section:string;par?:number;par_overridden?:boolean;default_par?:number;active:boolean;revision:number};
type Section={id:string;code:string;name:string;family:string;selected:boolean};
type Config={sections:Section[];items:Item[]};
type TypeItem={id:string;product_id:string;par:number;revision:number};
type Types={can_manage:boolean;types:Array<{id:string;code:string;name:string;active:boolean;revision:number;store_count:number;items:TypeItem[]|null}>};
const typesMutate=(actor:string,body:Record<string,Json>)=>w.service.rpc('display_type_mutate',{p_actor:actor,p_org:org,p_body:body});
const select=(actor:string,store:string,ids:string[])=>w.service.rpc('store_display_types_set',{p_actor:actor,p_store:store,p_type_ids:ids});
const config=async(actor:string,store:string)=>{const r=await w.service.rpc('production_read',{p_actor:actor,p_store:store,p_view:'config'});expect(r.error).toBeNull();return r.data as unknown as Config;};
const production=(actor:string,store:string,body:Record<string,Json>)=>w.service.rpc('production_mutate',{p_actor:actor,p_store:store,p_body:body,p_key:randomUUID()});
async function ok<T>(op:PromiseLike<{data:unknown;error:unknown}>):Promise<T>{const r=await op;expect(r.error).toBeNull();return r.data as T;}
const typeOf=(t:Types,code:string)=>t.types.find(x=>x.code===code)!;
const item=(c:Config,product:string,section:string)=>c.items.find(i=>i.product_id===product&&i.section===section);

beforeAll(async()=>{
 w=await createWorld();org=randomUUID();storeA=randomUUID();storeB=randomUUID();bowl=randomUUID();cup=randomUUID();
 await w.db.query("insert into public.organizations(id,name) values($1,'Display types test')",[org]);
 await w.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$3,'Type A','TA','America/Los_Angeles'),($2,$3,'Type B','TB','America/New_York')",[storeA,storeB,org]);
 await w.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$3,'Type bowl','Bowl','Fruit','Bowl'),($2,$3,'Type cup','Cup','Fruit','Cup')",[bowl,cup,org]);
 admin=await w.user('types-admin',{org:{id:org,role:'admin'}});
 managerA=await w.user('types-manager-a',{org:{id:org,role:'member'},stores:[{id:storeA,role:'manager'}]});
 managerB=await w.user('types-manager-b',{org:{id:org,role:'member'},stores:[{id:storeB,role:'manager'}]});
 employeeA=await w.user('types-employee-a',{org:{id:org,role:'member'},stores:[{id:storeA,role:'employee'}]});
});
afterAll(()=>w?.close());

it('a new organization starts with the four standard types and new stores use all of them',async()=>{
 const t=await ok<Types>(w.service.rpc('display_types_read',{p_actor:admin.id,p_org:org}));
 expect(t.can_manage).toBe(true);
 expect(t.types.map(x=>x.code)).toEqual(['fruit_mobile','salad_mobile','fruit_case','veggie_case']);
 expect(t.types.every(x=>x.store_count===2)).toBe(true);
 const c=await config(employeeA.id,storeA);
 expect(c.sections.map(s=>[s.code,s.selected])).toEqual([['fruit_mobile',true],['salad_mobile',true],['fruit_case',true],['veggie_case',true]]);
 const member=await ok<Types>(w.service.rpc('display_types_read',{p_actor:employeeA.id,p_org:org}));
 expect(member.can_manage).toBe(false);expect(member.types[0]!.items).toBeNull();
 expect((await w.service.rpc('display_types_read',{p_actor:w.users.adminB.id,p_org:org})).error?.message).toBe('NOT_FOUND');
});

it('only organization admins edit types; browser roles cannot read or write the tables',async()=>{
 const fm=typeOf(await ok<Types>(w.service.rpc('display_types_read',{p_actor:admin.id,p_org:org})),'fruit_mobile');
 const body={action:'save_item',display_type_id:fm.id,product_id:bowl,par:10,category:'Bowls',product_type:'Bowl',sort_order:0,active:true};
 expect((await typesMutate(managerA.id,body)).error?.message).toBe('FORBIDDEN');
 expect((await w.service.rpc('display_type_mutate',{p_actor:w.users.adminB.id,p_org:org,p_body:body})).error?.message).toBe('NOT_FOUND');
 expect((await managerA.client.from('display_types').select('id')).error?.code).toBe('42501');
 expect((await managerA.client.from('store_display_types').insert({organization_id:org,store_id:storeA,display_type_id:fm.id})).error?.code).toBe('42501');
 expect((await managerA.client.rpc('display_type_mutate',{p_actor:managerA.id,p_org:org,p_body:body})).error?.code).toBe('42501');
});

it('admin items reach every store; manager PAR edits override and admin changes skip overridden stores',async()=>{
 const fm=typeOf(await ok<Types>(w.service.rpc('display_types_read',{p_actor:admin.id,p_org:org})),'fruit_mobile');
 let t=await ok<Types>(typesMutate(admin.id,{action:'save_item',display_type_id:fm.id,product_id:bowl,par:10,category:'Bowls',product_type:'Bowl',sort_order:0,active:true}));
 let a=item(await config(managerA.id,storeA),bowl,'fruit_mobile')!;let b=item(await config(managerB.id,storeB),bowl,'fruit_mobile')!;
 expect([a.par,a.par_overridden,a.default_par]).toEqual([10,false,10]);expect(b.par).toBe(10);
 expect(item(await config(employeeA.id,storeA),bowl,'fruit_mobile')!.par).toBeUndefined();

 // Manager A overrides; a check started now keeps that snapshot.
 await ok(production(managerA.id,storeA,{action:'configure',item_id:a.id,expected_revision:a.revision,product_id:bowl,section:'fruit_mobile',par:14,category:'Bowls',product_type:'Bowl',sort_order:0,active:true}));
 const started=await ok<{id:string}>(production(managerB.id,storeB,{action:'start',section:'fruit_mobile'}));
 a=item(await config(managerA.id,storeA),bowl,'fruit_mobile')!;expect([a.par,a.par_overridden]).toEqual([14,true]);

 const ti=typeOf(t,'fruit_mobile').items!.find(i=>i.product_id===bowl)!;
 t=await ok<Types>(typesMutate(admin.id,{action:'save_item',display_type_id:fm.id,id:ti.id,expected_revision:ti.revision,product_id:bowl,par:12,category:'Bowls',product_type:'Bowl',sort_order:0,active:true}));
 a=item(await config(managerA.id,storeA),bowl,'fruit_mobile')!;b=item(await config(managerB.id,storeB),bowl,'fruit_mobile')!;
 expect([a.par,a.par_overridden,a.default_par]).toEqual([14,true,12]);expect([b.par,b.par_overridden]).toEqual([12,false]);
 const snapshot=await w.db.query('select par_snapshot from public.production_counts where check_id=$1 and product_id=$2',[started.id,bowl]);
 expect(snapshot.rows[0].par_snapshot).toBe(10);

 // Setting the default back clears the override; later admin changes apply again.
 await ok(production(managerA.id,storeA,{action:'configure',item_id:a.id,expected_revision:a.revision,product_id:bowl,section:'fruit_mobile',par:12,category:'Bowls',product_type:'Bowl',sort_order:0,active:true}));
 const stale=typeOf(t,'fruit_mobile').items!.find(i=>i.product_id===bowl)!;
 await ok(typesMutate(admin.id,{action:'save_item',display_type_id:fm.id,id:stale.id,expected_revision:stale.revision,product_id:bowl,par:8,category:'Bowls',product_type:'Bowl',sort_order:0,active:true}));
 expect((await typesMutate(admin.id,{action:'save_item',display_type_id:fm.id,id:stale.id,expected_revision:stale.revision,product_id:bowl,par:9,category:'Bowls',product_type:'Bowl',sort_order:0,active:true})).error?.message).toBe('CONFLICT');
 a=item(await config(managerA.id,storeA),bowl,'fruit_mobile')!;expect([a.par,a.par_overridden]).toEqual([8,false]);

 // A type item cannot be moved to another section by a store.
 expect((await production(managerA.id,storeA,{action:'configure',item_id:a.id,expected_revision:a.revision,product_id:bowl,section:'fruit_case',par:8,category:'Bowls',product_type:'Bowl',sort_order:0,active:true})).error?.message).toBe('VALIDATION_FAILED');
 const events=await w.db.query("select count(*)::int n from public.production_events where store_id=$1 and kind='par.updated' and after_value->>'source'='display_type'",[storeB]);
 expect(events.rows[0].n).toBeGreaterThanOrEqual(2);
});

it('admin adds a new type; managers choose their types and unchosen sections stop',async()=>{
 let t=await ok<Types>(typesMutate(admin.id,{action:'save_type',code:'cold_case',name:'Cold Case',family:'Salads',sort_order:50}));
 const cold=typeOf(t,'cold_case');expect(cold.store_count).toBe(0);
 expect((await typesMutate(admin.id,{action:'save_type',code:'cold_case',name:'Again'})).error?.message).toBe('VALIDATION_FAILED');
 expect((await typesMutate(admin.id,{action:'save_type',code:'Bad Code',name:'Bad'})).error?.message).toBe('VALIDATION_FAILED');
 t=await ok<Types>(typesMutate(admin.id,{action:'save_item',display_type_id:cold.id,product_id:cup,par:6,category:'Cups',product_type:'Cup',sort_order:0,active:true}));
 expect(item(await config(managerA.id,storeA),cup,'cold_case')).toBeUndefined();

 const fm=typeOf(t,'fruit_mobile');
 expect((await select(employeeA.id,storeA,[cold.id])).error?.message).toBe('FORBIDDEN');
 expect((await select(managerB.id,storeA,[cold.id])).error?.message).toBe('NOT_FOUND');
 expect((await select(managerA.id,storeA,[])).error?.message).toBe('VALIDATION_FAILED');
 const other=await w.db.query("select id from public.display_types where organization_id<>$1 limit 1",[org]);
 expect((await select(managerA.id,storeA,[other.rows[0].id])).error?.message).toBe('NOT_FOUND');

 const c=await ok<Config>(select(managerA.id,storeA,[fm.id,cold.id]));
 expect(c.sections.filter(s=>s.selected).map(s=>s.code)).toEqual(['fruit_mobile','cold_case']);
 expect(item(c,cup,'cold_case')!.active).toBe(true);
 expect(item(c,bowl,'fruit_mobile')!.active).toBe(true);

 const check=await ok<{section:string;items:Array<{product_id:string}>}>(production(employeeA.id,storeA,{action:'start',section:'cold_case'}));
 expect(check.items.map(i=>i.product_id)).toEqual([cup]);
 expect((await production(employeeA.id,storeA,{action:'start',section:'fruit_case'})).error?.message).toBe('VALIDATION_FAILED');
 const day=await ok<{sections:Array<{section:string;name:string}>}>(w.service.rpc('production_read',{p_actor:employeeA.id,p_store:storeA,p_view:'day'}));
 expect(day.sections.map(s=>[s.section,s.name])).toEqual([['fruit_mobile','M1 Bunker (Fruit)'],['cold_case','Cold Case']]);
 const prep=await ok<{missing_sections:string[]}>(w.service.rpc('production_prep_read',{p_actor:employeeA.id,p_store:storeA}));
 expect(prep.missing_sections).toEqual(['fruit_mobile','cold_case']);

 // Store B still has the four original sections and never got the new type.
 expect((await config(managerB.id,storeB)).sections.filter(s=>s.selected).map(s=>s.code)).toEqual(['fruit_mobile','salad_mobile','fruit_case','veggie_case']);

 // Archiving a type removes it from every store; restoring brings its items back.
 t=await ok<Types>(typesMutate(admin.id,{action:'save_type',id:cold.id,expected_revision:typeOf(t,'cold_case').revision,active:false}));
 let a=await config(managerA.id,storeA);
 expect(a.sections.map(s=>s.code)).not.toContain('cold_case');expect(item(a,cup,'cold_case')!.active).toBe(false);
 await ok(typesMutate(admin.id,{action:'save_type',id:cold.id,expected_revision:typeOf(t,'cold_case').revision,active:true}));
 a=await config(managerA.id,storeA);expect(item(a,cup,'cold_case')!.active).toBe(true);
 const audit=await w.db.query("select event_type from public.audit_events where organization_id=$1 and event_type like 'display_type.%' or (store_id=$2 and event_type='store.display_types_updated')",[org,storeA]);
 expect(new Set(audit.rows.map(r=>r.event_type))).toEqual(new Set(['display_type.created','display_type.updated','display_type.item_saved','store.display_types_updated']));
});

it('a store created after its types have products starts with those products and default PAR',async()=>{
 // Regression: the creation trigger has no actor; its copies must not need one.
 const later=randomUUID();
 await w.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'Type later','TL','UTC')",[later,org]);
 const rows=await w.db.query("select section,product_id,par,par_overridden,active,template_item_id is not null linked from public.production_items where store_id=$1 order by section,product_id",[later]);
 expect(rows.rows.length).toBeGreaterThanOrEqual(2);
 expect(rows.rows.every(r=>r.linked&&!r.par_overridden&&r.active)).toBe(true);
 expect(rows.rows.find(r=>r.section==='cold_case')?.par).toBe(6);
 const events=await w.db.query("select count(*)::int n from public.production_events where store_id=$1",[later]);
 expect(events.rows[0].n).toBe(0);
 const code=await ok<{code:string}>(w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'rotate'}));
 const newcomer=await w.user('types-newcomer');
 await ok(w.service.rpc('redeem_access_code',{p_actor:newcomer.id,p_code:code.code}));
 const created=await ok<{created:boolean;store:{store_id:string}}>(w.service.rpc('onboarding_store',{p_actor:newcomer.id,p_store_number:'TL-2',p_name:'Type later 2',p_timezone:'UTC'}));
 expect(created.created).toBe(true);
 expect(item(await config(newcomer.id,created.store.store_id),cup,'cold_case')?.par).toBe(6);
});

it('POG kinds accept any active type of the organization',async()=>{
 const g=await w.service.rpc('create_pog',{p_actor:admin.id,p_org:org,p_name:'Cold layout',p_kind:'cold_case'});
 expect(g.error).toBeNull();
 expect((await w.service.rpc('create_pog',{p_actor:admin.id,p_org:org,p_name:'Nope',p_kind:'no_such_type'})).error?.message).toBe('VALIDATION_FAILED');
});
