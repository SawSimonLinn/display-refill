import { z } from "zod";
export const ProductionSection = z.enum(["fruit_mobile", "salad_mobile", "fruit_case", "veggie_case"]);
export const ProductionAction = z.discriminatedUnion("action", [
 z.strictObject({action:z.literal("configure"),item_id:z.uuid().optional(),product_id:z.uuid(),section:ProductionSection,
 par:z.int().min(0).max(9999),category:z.string().trim().max(100),product_type:z.string().trim().max(100),
 sort_order:z.int().min(0).max(999),active:z.boolean(),expected_revision:z.int().positive().optional()})
 .refine(x=>!x.item_id || x.expected_revision!==undefined,{message:"Revision is required when editing",path:["expected_revision"]}),
 z.strictObject({action:z.literal("start"),section:ProductionSection}),
 z.strictObject({action:z.literal("counts"),check_id:z.uuid(),expected_revision:z.int().positive(),
 items:z.array(z.strictObject({id:z.uuid(),have:z.int().min(0).max(9999).nullable(),backup:z.int().min(0).max(9999).nullable().optional()})).min(1).max(200)})
 .refine(x=>new Set(x.items.map(i=>i.id)).size===x.items.length,{message:"Duplicate rows",path:["items"]}),
 z.strictObject({action:z.literal("restart"),check_id:z.uuid(),expected_revision:z.int().positive()}),
 z.strictObject({action:z.literal("finish"),check_id:z.uuid(),expected_revision:z.int().positive()})
]);
export const ProductionQuery = z.strictObject({view:z.enum(["config","day","check","events"]).default("day"),check_id:z.uuid().optional()})
 .refine(x=>x.view!=="check" || x.check_id!==undefined,{message:"Check ID required",path:["check_id"]});
