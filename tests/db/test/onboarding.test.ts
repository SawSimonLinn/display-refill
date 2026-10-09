import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createWorld, type World, type TestUser } from '../src/world';

// Feature 16 unit 2: access code, create-or-join store and manager store settings.
let w:World; let org:string; let admin:TestUser; let code:string;
type Onboarding={state:string;organization:{organization_id:string;role:string}|null;stores:Array<{store_id:string;role:string}>};
type Joined={created:boolean;role:string;store:{store_id:string;name:string;store_number:string;timezone:string}};
const state=async(u:TestUser)=>{const r=await w.service.rpc('onboarding_read',{p_actor:u.id});expect(r.error).toBeNull();return r.data as unknown as Onboarding;};
const redeem=(u:TestUser,c:string)=>w.service.rpc('redeem_access_code',{p_actor:u.id,p_code:c});
const store=(u:TestUser,number:string,name:string|null=null,tz:string|null=null)=>w.service.rpc('onboarding_store',{p_actor:u.id,p_store_number:number,p_name:name as string,p_timezone:tz as string});
async function ok<T>(op:PromiseLike<{data:unknown;error:unknown}>):Promise<T>{const r=await op;expect(r.error).toBeNull();return r.data as T;}

beforeAll(async()=>{
 w=await createWorld();org=randomUUID();
 await w.db.query("insert into public.organizations(id,name) values($1,'Onboarding test')",[org]);
 admin=await w.user('onboard-admin',{org:{id:org,role:'admin'}});
});
afterAll(()=>w?.close());

it('only admins see and rotate the code; rotation replaces it and audit omits it',async()=>{
 expect((await ok<{code:string|null;active:boolean}>(w.service.rpc('access_code_read',{p_actor:admin.id,p_org:org}))).code).toBeNull();
 const member=await w.user('onboard-member',{org:{id:org,role:'member'}});
 expect((await w.service.rpc('access_code_read',{p_actor:member.id,p_org:org})).error?.message).toBe('FORBIDDEN');
 expect((await w.service.rpc('access_code_mutate',{p_actor:w.users.adminB.id,p_org:org,p_action:'rotate'})).error?.message).toBe('NOT_FOUND');
 expect((await w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'disable'})).error?.message).toBe('VALIDATION_FAILED');
 const first=await ok<{code:string;active:boolean}>(w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'rotate'}));
 expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);expect(first.active).toBe(true);
 const second=await ok<{code:string}>(w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'rotate'}));
 expect(second.code).not.toBe(first.code);code=second.code;
 const outsider=await w.user('onboard-old-code');
 expect((await redeem(outsider,first.code)).error?.message).toBe('VALIDATION_FAILED');
 const audit=await w.db.query("select metadata::text m from public.audit_events where organization_id=$1 and event_type like 'organization.access_code_%'",[org]);
 expect(audit.rows.length).toBe(2);expect(audit.rows.every(r=>!r.m.includes(code.replace('-',''))&&!r.m.includes(code))).toBe(true);
 expect((await member.client.from('organization_access_codes').select('code')).error?.code).toBe('42501');
 expect((await member.client.rpc('redeem_access_code',{p_actor:member.id,p_code:code})).error?.code).toBe('42501');
});

it('a new account redeems the code as member, never admin; wrong or disabled codes fail alike',async()=>{
 const u=await w.user('onboard-new');
 expect((await state(u)).state).toBe('access_code');
 const wrong=(await redeem(u,'NOPE-NOPE')).error;expect(wrong?.message).toBe('VALIDATION_FAILED');
 await ok(w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'disable'}));
 const disabled=(await redeem(u,code)).error;expect([disabled?.message,disabled?.details]).toEqual([wrong?.message,wrong?.details]);
 await ok(w.service.rpc('access_code_mutate',{p_actor:admin.id,p_org:org,p_action:'enable'}));
 const joined=await ok<Onboarding>(redeem(u,` ${code.toLowerCase().replace('-',' ')} `));
 expect(joined.state).toBe('store');expect(joined.organization).toMatchObject({organization_id:org,role:'member'});
 expect((await ok<Onboarding>(redeem(u,code))).state).toBe('store');
 const rows=await w.db.query('select role,active from public.organization_memberships where user_id=$1',[u.id]);
 expect(rows.rows).toEqual([{role:'member',active:true}]);
 // Belongs to another organization already: refused.
 expect((await redeem(w.users.employeeA1,code)).error?.message).toBe('VALIDATION_FAILED');
});

it('a revoked member cannot rejoin with the code',async()=>{
 const u=await w.user('onboard-revoked',{org:{id:org,role:'member',active:false}});
 expect((await state(u)).state).toBe('removed');
 expect((await redeem(u,code)).error?.message).toBe('FORBIDDEN');
});

it('first account creates the store as manager; coworkers join by number as employees',async()=>{
 const first=await w.user('onboard-first');const second=await w.user('onboard-second');const third=await w.user('onboard-third');
 expect((await store(first,'615')).error?.message).toBe('FORBIDDEN');
 for(const u of [first,second,third])await ok(redeem(u,code));
 expect((await store(first,'615','FM 615',null)).error?.message).toBe('VALIDATION_FAILED');
 expect((await store(first,'615','FM 615','Mars/Base')).error?.details).toContain('IANA');
 const created=await ok<Joined>(store(first,'615','FM 615 University Place','America/Los_Angeles'));
 expect([created.created,created.role,created.store.timezone]).toEqual([true,'manager','America/Los_Angeles']);
 expect((await ok<Joined>(store(first,'615'))).role).toBe('manager');
 // Different case/whitespace in the number joins the same store; name/timezone are ignored.
 const [a,b]=await Promise.all([ok<Joined>(store(second,' 615 ','Other name','UTC')),ok<Joined>(store(third,'615'))]);
 expect([a.created,a.role,a.store.store_id,a.store.name]).toEqual([false,'employee',created.store.store_id,'FM 615 University Place']);
 expect([b.role,b.store.store_id]).toEqual(['employee',created.store.store_id]);
 expect((await state(second)).state).toBe('complete');
 const managers=await w.db.query("select count(*)::int n from public.store_memberships where store_id=$1 and role='manager'",[created.store.store_id]);
 expect(managers.rows[0].n).toBe(1);
 // New store starts with every active display type and the employee can read its sections.
 const cfg=await ok<{sections:Array<{code:string;selected:boolean}>}>(w.service.rpc('production_read',{p_actor:second.id,p_store:created.store.store_id,p_view:'config'}));
 expect(cfg.sections.filter(s=>s.selected).map(s=>s.code)).toEqual(['fruit_mobile','salad_mobile','fruit_case','veggie_case']);
 // Employee cannot choose types; manager can.
 const types=await w.db.query("select id from public.display_types where organization_id=$1 and code='fruit_case'",[org]);
 expect((await w.service.rpc('store_display_types_set',{p_actor:second.id,p_store:created.store.store_id,p_type_ids:[types.rows[0].id]})).error?.message).toBe('FORBIDDEN');
 await ok(w.service.rpc('store_display_types_set',{p_actor:first.id,p_store:created.store.store_id,p_type_ids:[types.rows[0].id]}));
 const audit=await w.db.query("select event_type,metadata->>'via' via from public.audit_events where store_id=$1 order by created_at",[created.store.store_id]);
 expect(audit.rows.map(r=>`${r.event_type}:${r.via}`)).toEqual(['store.created:onboarding','membership.joined:store_number','membership.joined:store_number','store.display_types_updated:null']);
});

it('managers rename their store and change its timezone; employees and other stores cannot',async()=>{
 const m=await w.user('onboard-settings-m');const e=await w.user('onboard-settings-e');
 await ok(redeem(m,code));await ok(redeem(e,code));
 const s=(await ok<Joined>(store(m,'S-9','Settings store','UTC'))).store;await ok(store(e,'S-9'));
 const rev=async()=>(await w.db.query('select revision from public.stores where id=$1',[s.store_id])).rows[0].revision as number;
 const update=(u:TestUser,revision:number,name:string,tz:string)=>w.service.rpc('store_settings_update',{p_actor:u.id,p_store:s.store_id,p_expected_revision:revision,p_name:name,p_timezone:tz});
 expect((await update(e,await rev(),'Hacked','UTC')).error?.message).toBe('FORBIDDEN');
 expect((await update(w.users.managerA1,await rev(),'Hacked','UTC')).error?.message).toBe('NOT_FOUND');
 expect((await update(m,(await rev())+1,'New name','UTC')).error?.message).toBe('CONFLICT');
 const changed=await ok<{name:string;timezone:string;store_number:string}>(update(m,await rev(),'New name','America/Chicago'));
 expect([changed.name,changed.timezone,changed.store_number]).toEqual(['New name','America/Chicago','S-9']);
});
