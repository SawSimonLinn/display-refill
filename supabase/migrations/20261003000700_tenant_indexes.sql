-- Feature 02 / migration 7: data-model.md requires an organization_id index
-- on every tenant table; pog_slots was the one table without it. Guarded by
-- tests/db/test/catalog.test.ts so later tables are checked automatically.

create index pog_slots_org_idx on public.pog_slots (organization_id);
