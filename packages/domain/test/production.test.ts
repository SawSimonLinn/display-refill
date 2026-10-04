import { expect,it } from 'vitest';
import { ProductionAction,ProductionQuery } from '../src/production';
const id='11111111-1111-4111-8111-111111111111';
it('requires manager item revision and prevents client calculated fields',()=>{
 const config={action:'configure',item_id:id,product_id:id,section:'fruit_mobile',par:10,category:'Fruit',product_type:'Bowl',sort_order:0,active:true};
 expect(ProductionAction.safeParse(config).success).toBe(false);
 expect(ProductionAction.safeParse({...config,expected_revision:1}).success).toBe(true);
 expect(ProductionAction.safeParse({...config,expected_revision:1,make:1}).success).toBe(false);
});
it('keeps unknown separate from explicit zero and rejects duplicate or invalid inputs',()=>{
 for(const have of [null,0,9999])expect(ProductionAction.safeParse({action:'counts',check_id:id,expected_revision:1,items:[{id,have}]}).success).toBe(true);
 for(const have of [-1,1.5,10000,'2'])expect(ProductionAction.safeParse({action:'counts',check_id:id,expected_revision:1,items:[{id,have}]}).success).toBe(false);
 expect(ProductionAction.safeParse({action:'counts',check_id:id,expected_revision:1,items:[{id,have:1},{id,have:2}]}).success).toBe(false);
});
it('requires a check ID for detail and rejects unsupported sections',()=>{
 expect(ProductionQuery.safeParse({view:'check'}).success).toBe(false);
 expect(ProductionAction.safeParse({action:'start',section:'unknown'}).success).toBe(false);
});
