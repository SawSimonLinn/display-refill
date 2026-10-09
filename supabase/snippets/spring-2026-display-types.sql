-- Display cases the stores actually have (Spring 2 POGs, effective 05.06.2026):
--   4ft Fruit, 8ft Fruit                      created here
--   M2 Salad Destination (8ft)                created here (Mobile Merchandiser layout)
--   6ft Fruit (fruit_case), 4ft Veg (veggie_case), M1 Bunker (fruit_mobile) and
--   Salad Destination (salad_mobile, the M1 salad case)                      unchanged
-- One-off data load for one organization; safe to re-run (existing types, products and
-- items are left alone). Set the organization below, then run in psql or the SQL editor.
--
-- Each line under a type is: S<shelf> <wide>[x<high>] <product name>. Default PAR is
-- wide x high summed over every shelf the product is on; high defaults per product below
-- (3 when unlisted). Admins can change PAR on the Display types page afterwards.
-- Types are not selected for any store; stores pick them in the app.

set app.seed_org = '16b26bdf-3313-4674-a5c3-95db78530778';

do $$
declare
 v_org uuid := current_setting('app.seed_org')::uuid;
 v_actor uuid;
 v_spec text := $spec$
# fruit_4ft | 4ft Fruit | Fruit | 50
S6 1 STRAWBERRY & WHIPPED TOPPING
S6 1 PINEAPPLE, STRAWBERRY & KIWI
S6 1 MANDARIN, STRAWBERRY & KIWI
S6 1 STRAWBERRY, GRAPE & MANDARIN
S6 1 GRAPES, CHEESE & PRETZELS
S6 1 STRAWBERRY, CHEESE & GRAPE
S6 1 TURKEY BITES, CHEESE & GRAPES
S6 1 MANGO & PAPAYA
S6 1 WHIP TOPPING
S5 1 PINEAPPLE CUP
S5 1 WATERMELON CUP
S5 1 MIXED MELON CUP
S5 1 CANTALOUPE CUP
S5 1 MIXED BERRIES CUP
S5 1 STRAWBERRY CUP
S5 1 PINEAPPLE, KIWI & PAPAYA
S5 1 WATERMELON SPEARS
S5 1 PINEAPPLE SPEARS
S4 1 $5 WATERMELON
S4 1 $5 MIXED MELONS
S4 1 $5 MIXED MELON W/ GRAPES
S4 1 $5 MANGOS
S4 1 $5 MANDARIN BOWL
S4 1 $5 RAINBOW MIX BOWL
S4 1 $5 MIXED FRUIT W/ BERRY BOWL
S3 1 $5 CANTALOUPE BOWL
S3 1 $5 HONEYDEW BOWL
S3 1 $5 MIXED GRAPE BOWL
S3 1 $5 PINEAPPLE
S3 1 $5 PINEAPPLE KIWI STRAWBERRY
S3 1 $5 TROPICAL FRUIT MIX BOWL
S3 1 $5 MIXED BERRYS
S2 1 $10 WATERMELON
S2 1 $10 MIXED MELON
S2 1 $10 CANTALOUPE
S2 1 $10 PINEAPPLE
S2 1 $10 STRAWBERRY/PINEAPPLE/BLUEBERRY
S1 1 WATERMELON SLICES
S1 1 WATERMELON QUARTERS
S1 1 MIXED FRUIT 60oz
S1 1 SMALL PARTY TRAY
S1 1 LARGE TRAY
# fruit_8ft | 8ft Fruit | Fruit | 60
S6 2 STRAWBERRY & WHIPPED TOPPING
S6 2 PINEAPPLE, STRAWBERRY & KIWI
S6 2 MANDARIN, STRAWBERRY & KIWI
S6 2 STRAWBERRY, GRAPE & MANDARIN
S6 1 GRAPES, CHEESE & PRETZELS
S6 1 STRAWBERRY, CHEESE & GRAPE
S6 1 TURKEY BITES, CHEESE & GRAPES
S6 1 MANGO & PAPAYA
S6 1 PARFAIT STRAWBERRY
S6 1 PARFAIT BLUEBERRY
S6 1 PARFAIT MIXED BERRY
S6 2 WHIP TOPPING
S5 2 WATERMELON CUP
S5 2 MIXED MELON CUP
S5 1 CANTALOUPE CUP
S5 2 PINEAPPLE CUP
S5 1 TROPICAL FRUIT CUP
S5 2 MIXED BERRIES CUP
S5 1 BERRY/KIWI CUP
S5 1 DRAGON FRUIT/KIWI CUP
S5 1 STRAWBERRY CUP
S5 1 PINEAPPLE, KIWI & PAPAYA
S5 2 WATERMELON SPEARS
S5 2 PINEAPPLE SPEARS
S4 2 $5 WATERMELON
S4 2 $5 MIXED MELONS
S4 2 $5 CANTALOUPE BOWL
S4 1 $5 PINEAPPLE
S4 1 $5 MANDARIN BOWL
S4 1 $5 MIXED GRAPE BOWL
S4 1 $5 MANGOS
S4 1 $5 MIXED BERRYS
S4 1 $5 HONEYDEW BOWL
S4 1 $5 MIXED FRUIT W/ BERRY BOWL
S4 1 $5 RAINBOW MIX BOWL
S3 2 $5 WATERMELON
S3 2 $5 MIXED MELONS
S3 2 $5 CANTALOUPE BOWL
S3 1 $5 PINEAPPLE
S3 1 $5 MANDARIN BOWL
S3 1 $5 MIXED GRAPE BOWL
S3 1 $5 MANGOS
S3 1 $5 MIXED BERRYS
S3 1 $5 MIXED MELON W/ GRAPES
S3 1 $5 PINEAPPLE KIWI STRAWBERRY
S3 1 $5 TROPICAL FRUIT MIX BOWL
S2 2 WATERMELON 60oz
S2 2 $10 WATERMELON
S2 1 $10 MIXED MELON
S2 1 $10 CANTALOUPE
S2 1 $10 PINEAPPLE
S2 1 $10 STRAWBERRY/PINEAPPLE/BLUEBERRY
S2 1 $10 MIXED FRUIT W/ BERRIES
S2 1 $10 MIXED BERRIES
S1 4 WATERMELON SLICES
S1 1 WATERMELON QUARTERS
S1 2 MIXED FRUIT 60oz
S1 1 SMALL PARTY TRAY
S1 1 LARGE TRAY
S1 1 LARGE TRAY W/ DIP
$spec$;
 r record; t record; v_type uuid; v_product uuid; v_line text; v_m text[];
 v_code text; v_sort integer := 0; v_new_types integer := 0; v_new_items integer := 0;
begin
 select m.user_id into v_actor from public.organization_memberships m
  where m.organization_id=v_org and m.role='admin' and m.active order by m.created_at limit 1;
 if v_actor is null then raise exception 'no active admin in organization %', v_org; end if;

 -- Products on these POGs that the catalog does not have yet (Supreme item code as SKU).
 for r in select * from (values
  ('TROPICAL FRUIT CUP','Fruit','85004567797'),
  ('GO SNACKS CHICKEN BITES 6PK','Salads',null),
  ('FRESH CUT CHICKEN','Salads',null),
  ('FRESH CUT EGGS','Salads',null)) p(name,category,sku)
 loop
  if not exists(select 1 from public.products where organization_id=v_org and upper(name)=upper(r.name)) then
   perform public.create_product(v_actor,v_org,r.name,left(r.name,60),r.category,'Sellable package',r.sku);
  end if;
 end loop;

 drop table if exists pg_temp.seed_lines;
 create temp table seed_lines(code text,name text,family text,type_sort int,shelf int,wide int,high int,product text,pos int) on commit drop;
 for v_line in select btrim(l) from regexp_split_to_table(v_spec,E'\n') l where btrim(l)<>'' loop
  if v_line like '#%' then
   v_m:=regexp_split_to_array(btrim(substr(v_line,2)),'\s*\|\s*');
   v_code:=v_m[1]; v_sort:=0;
   insert into seed_lines(code,name,family,type_sort) values(v_m[1],v_m[2],v_m[3],v_m[4]::int);
  else
   v_m:=regexp_match(v_line,'^S(\d) (\d+)(?:x(\d+))? (.+)$');
   if v_m is null then raise exception 'bad line: %', v_line; end if;
   insert into seed_lines(code,shelf,wide,high,product,pos) values(v_code,v_m[1]::int,v_m[2]::int,
    coalesce(v_m[3]::int,case v_m[4]
     when 'WATERMELON QUARTERS' then 1
     when 'CHOPPED WHITE ONIONS' then 4 when 'CHOPPED RED ONIONS' then 4 when 'TRI-PEPPERS' then 4
     when 'DICED PEPPERS W/ ONIONS' then 4 when 'CHOPPED CILANTRO W/ ONIONS' then 4 when 'PICO & GUAC' then 4
     when 'MIXED FRUIT 60oz' then 2 when 'WATERMELON 60oz' then 2 when 'LARGE TRAY' then 2 when 'LARGE TRAY W/ DIP' then 2
     when 'FRUIT/VEG TRAY' then 2 when 'LRG VEGGIE BOWL W/ RANCH' then 2 when 'LRG VEGGIE BOWL W/O RANCH' then 2
     else 3 end),v_m[4],v_sort);
   v_sort:=v_sort+1;
  end if;
 end loop;

 -- Fail before writing anything if a name does not match the catalog.
 for r in select distinct s.product from seed_lines s where s.product is not null
  and not exists(select 1 from public.products p where p.organization_id=v_org and p.active and upper(p.name)=upper(s.product)) loop
  raise exception 'product not in catalog: %', r.product;
 end loop;

 for t in select code,name,family,type_sort from seed_lines where product is null order by type_sort loop
  select id into v_type from public.display_types where organization_id=v_org and code=t.code;
  if v_type is null then
   perform public.display_type_mutate(v_actor,v_org,jsonb_build_object('action','save_type','code',t.code,'name',t.name,'family',t.family,'sort_order',t.type_sort));
   select id into v_type from public.display_types where organization_id=v_org and code=t.code;
   v_new_types:=v_new_types+1;
  end if;
  -- A product on several shelves is one item: PAR sums its facings, shelf is where it first appears.
  for r in select s.product,sum(s.wide*s.high)::int par,min(s.pos) pos,(array_agg(s.shelf order by s.pos))[1] shelf
   from seed_lines s where s.code=t.code and s.product is not null group by s.product order by min(s.pos) loop
   select id into v_product from public.products where organization_id=v_org and active and upper(name)=upper(r.product) order by created_at limit 1;
   if not exists(select 1 from public.display_type_items where display_type_id=v_type and product_id=v_product) then
    perform public.display_type_mutate(v_actor,v_org,jsonb_build_object('action','save_item','display_type_id',v_type,'product_id',v_product,
     'par',r.par,'category','Shelf '||r.shelf,'product_type','Sellable package','sort_order',r.pos));
    v_new_items:=v_new_items+1;
   end if;
  end loop;
 end loop;

 -- M2 Salad Destination (8ft): the Mobile Merchandiser case, left to right. PAR is an
 -- estimate from the case photo.
 select id into v_type from public.display_types where organization_id=v_org and code='salad_m2';
 if v_type is null then
  perform public.display_type_mutate(v_actor,v_org,jsonb_build_object('action','save_type','code','salad_m2',
   'name','M2 Salad Destination (8ft)','family','Salads','sort_order',25));
  select id into v_type from public.display_types where organization_id=v_org and code='salad_m2';
  v_new_types:=v_new_types+1;
 end if;
 for r in select * from (values
  (0,'Protein',6,'GO SNACKS CHICKEN BITES 6PK'),
  (1,'Protein',2,'FRESH CUT CHICKEN'),
  (2,'Protein',3,'FRESH CUT EGGS'),
  (3,'Family salads',2,'FAMLY SIZED COBB'),
  (4,'Family salads',2,'FAMILY BLT'),
  (5,'Family salads',2,'FAMILY SIZED GARDEN'),
  (6,'Individual salads',5,'COBB'),
  (7,'Individual salads',5,'GARDEN'),
  (8,'Individual salads',3,'SOUTHWEST'),
  (9,'Individual salads',3,'CEASER'),
  (10,'Individual salads',2,'BLT'),
  (11,'Individual salads',2,'BERRY'),
  (12,'Snacks & veg',2,'$5 MIXED GRAPES'),
  (13,'Snacks & veg',2,'$5 CLEMATINE'),
  (14,'Snacks & veg',2,'BBY CARROTS & SNAP PEAS W/RNCH'),
  (15,'Snacks & veg',2,'CARROTS & CUCUMBERS W/RNCH'),
  (16,'Snacks & veg',2,'BROC/CAL/RNCH'),
  (17,'Snacks & veg',2,'BABY CARROTS - GRP TOMS - BROCCOLI'),
  (18,'Snacks & veg',2,'CUT SQUASH'),
  (19,'Snacks & veg',2,'BUTTERNUT SQUASH'),
  (20,'Snacks & veg',4,'SOUP BASE')) x(pos,category,par,product)
 loop
  select id into v_product from public.products where organization_id=v_org and active and upper(name)=upper(r.product) order by created_at limit 1;
  if v_product is null then raise exception 'product not in catalog: %', r.product; end if;
  if not exists(select 1 from public.display_type_items where display_type_id=v_type and product_id=v_product) then
   perform public.display_type_mutate(v_actor,v_org,jsonb_build_object('action','save_item','display_type_id',v_type,'product_id',v_product,
    'par',r.par,'category',r.category,'product_type','Sellable package','sort_order',r.pos));
   v_new_items:=v_new_items+1;
  end if;
 end loop;
 raise notice 'created % display types and % items', v_new_types, v_new_items;
end $$;
