-- Synthetic seed for local development and RLS integration tests.
-- No identities or passwords: tests provision users through the Auth admin
-- API with random passwords and attach memberships themselves.
-- IDs are fixed so tests can reference them (tests/db/seed-ids.ts).
-- Product names follow context/examples/pog-draft.json and are illustrative.

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000000a', 'Synthetic Org A'),
  ('10000000-0000-4000-8000-00000000000b', 'Synthetic Org B');

insert into public.stores (id, organization_id, name, store_number, timezone) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'A Store 1', 'A-001', 'America/Los_Angeles'),
  ('20000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'A Store 2', 'A-002', 'America/Los_Angeles'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'B Store 1', 'B-001', 'America/New_York');

insert into public.products (id, organization_id, name, short_name, category, container_type, active) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Individual Cobb Salad', 'Cobb', 'salad', 'clamshell', true),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Individual Garden Salad', 'Garden', 'salad', 'clamshell', true),
  ('30000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-00000000000a', 'Retired Fruit Cup', 'Fruit cup', 'fruit', 'cup', false),
  ('30000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-00000000000a', 'Draft-only Wrap', 'Wrap', 'sandwich', 'sleeve', true),
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'B Caesar Salad', 'Caesar', 'salad', 'bowl', true);

insert into public.pogs (id, organization_id, name) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Mobile 2'),
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'B Case 1');

-- Versions start as drafts; slots are added; the UPDATE to published runs the
-- same validation trigger used by publish_pog_version().
-- Seed references stand in for validated uploads (no image objects exist).
insert into public.pog_versions (id, organization_id, pog_id, version_number, reference_path, reference_width, reference_height, reference_validated_at) values
  ('50000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-0000000000a1', 1,
   '10000000-0000-4000-8000-00000000000a/40000000-0000-4000-8000-0000000000a1/50000000-0000-4000-8000-0000000000a1/reference.jpg', 1600, 1200, now()),
  ('50000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-0000000000a1', 2,
   null, null, null, null),
  ('50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-0000000000b1', 1,
   '10000000-0000-4000-8000-00000000000b/40000000-0000-4000-8000-0000000000b1/50000000-0000-4000-8000-0000000000b1/reference.jpg', 1600, 1200, now());

insert into public.pog_slots (id, organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order) values
  -- Org A v1 (published below)
  ('60000000-0000-4000-8000-0000000a1001', '10000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-0000000000a1', 'A1',
   '30000000-0000-4000-8000-0000000000a1', 0.05, 0.1, 0.4, 0.8, 3, 1, 1),
  ('60000000-0000-4000-8000-0000000a1002', '10000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-0000000000a1', 'A2',
   '30000000-0000-4000-8000-0000000000a2', 0.55, 0.1, 0.4, 0.8, 3, null, 2),
  -- Org A v2 (draft): uses a product no published layout uses
  ('60000000-0000-4000-8000-0000000a2001', '10000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-0000000000a2', 'A1',
   '30000000-0000-4000-8000-0000000000a4', 0.05, 0.1, 0.4, 0.8, 4, 2, 1),
  -- Org B v1
  ('60000000-0000-4000-8000-0000000b1001', '10000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-0000000000b1', 'B1',
   '30000000-0000-4000-8000-0000000000b1', 0.1, 0.1, 0.8, 0.8, 5, 2, 1);

update public.pog_versions
   set state = 'published', published_at = now()
 where id in ('50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000b1');

insert into public.displays (id, organization_id, store_id, name, active_pog_version_id) values
  ('70000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', 'A1 Mobile 2', '50000000-0000-4000-8000-0000000000a1'),
  ('70000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a2', 'A2 Mobile 2', '50000000-0000-4000-8000-0000000000a1'),
  ('70000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', 'A1 Unassigned case', null),
  ('70000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-0000000000b1', 'B1 Case 1', '50000000-0000-4000-8000-0000000000b1');
