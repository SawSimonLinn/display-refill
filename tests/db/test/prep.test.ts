import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createWorld,type World} from '../src/world';
let w:World;
beforeAll(async()=>{w=await createWorld();});afterAll(()=>w?.close());
it('prep table and all RPCs reject direct employee access and actor spoofing',async()=>{
 const user=w.users.employeeA1;
 expect((await user.client.from('production_prep_events').select('*')).error?.code).toBe('42501');
 expect((await user.client.rpc('production_prep_read',{p_actor:w.users.adminA.id,p_store:randomUUID()})).error?.code).toBe('42501');
 expect((await user.client.rpc('production_prep_record',{p_actor:w.users.adminA.id,p_store:randomUUID(),p_product:randomUUID(),p_revision:'0'.repeat(64),p_quantity:1,p_done:false,p_key:randomUUID()})).error?.code).toBe('42501');
 expect((await user.client.rpc('production_stock_record',{p_actor:w.users.adminA.id,p_store:randomUUID(),p_product:randomUUID(),p_revision:'0'.repeat(64),p_counts:[],p_key:randomUUID()})).error?.code).toBe('42501');
 expect((await user.client.rpc('production_restart',{p_actor:w.users.adminA.id,p_store:randomUUID(),p_check:randomUUID(),p_revision:1,p_key:randomUUID()})).error?.code).toBe('42501');
});
it('new prep storage has RLS, organization index, append-only guard and scoped foreign keys',async()=>{
 expect((await w.db.query("select relrowsecurity from pg_class where oid='public.production_prep_events'::regclass")).rows[0].relrowsecurity).toBe(true);
 const indexes=(await w.db.query("select indexdef from pg_indexes where schemaname='public' and tablename='production_prep_events'")).rows.map(r=>r.indexdef).join(' ');expect(indexes).toContain('(organization_id)');
 const fks=(await w.db.query("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.production_prep_events'::regclass and contype='f'")).rows.map(r=>r.def).join(' ');expect(fks).toContain('(organization_id, store_id)');expect(fks).toContain('(organization_id, product_id)');
});
it('trigger helpers are not callable by browser roles',async()=>{
 const r=await w.db.query("select has_function_privilege('authenticated','private.production_count_prep_revision()','EXECUTE') as count,has_function_privilege('anon','private.production_finish_prep_guard()','EXECUTE') as finish");expect(r.rows[0]).toEqual({count:false,finish:false});
});
