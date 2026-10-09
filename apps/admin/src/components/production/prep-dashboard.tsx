"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest, type ApiFailure } from "@/lib/api-client";
type Item = { product_id: string; product_name: string; category: string; product_type: string; ready: boolean; made: number; remaining: number | null; oldest_count: string; locations: {section:string;display_need:number}[]; activity:{name:string;quantity:number;at:string}[] };
type Board = {items:Item[];missing_sections:string[]};
const labels:Record<string,string>={fruit_mobile:"M · M1 BUNKER (FRUIT)",salad_mobile:"M · SALAD DESTINATION",fruit_case:"D · 6FT FRUIT",veggie_case:"D · Veggie display case"};
/** Standard sections keep their M/D labels; other display case types use their names. */
const sectionLabel=(code:string,names:Record<string,string>)=>labels[code]??names[code]??code;
const field="min-h-11 w-full rounded-lg border border-input bg-background px-3";
export function PrepDashboard({storeId,zone,sectionNames={}}:{storeId:string;zone:string;sectionNames?:Record<string,string>}) {
 const [board,setBoard]=useState<Board|null>(null);
 const [failure,setFailure]=useState<ApiFailure|null>(null);
 const [category,setCategory]=useState("");const [type,setType]=useState("");const [sort,setSort]=useState("quantity");const [completed,setCompleted]=useState(false);
 const [updated,setUpdated]=useState<Date|null>(null);
 useEffect(()=>{
  let live=true;let timer:ReturnType<typeof setTimeout>;
  async function load(){
   if(document.visibilityState==='visible'){
    const r=await apiRequest<Board>(`/prep/${storeId}`,{method:"GET"});
    if(!live)return;
    if(r.ok){setBoard(r.data);setFailure(null);setUpdated(new Date());}else{setFailure(r.failure);if(r.failure.kind==='session'||r.failure.kind==='forbidden'||r.failure.kind==='not_found')setBoard(null);}
   }
   if(live)timer=setTimeout(()=>void load(),5000);
  }
  void load();return()=>{live=false;clearTimeout(timer);};
 },[storeId]);
 const time=(raw:string|Date)=>new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:zone}).format(new Date(raw));
 const rows=(board?.items??[]).filter(i=>(completed||i.remaining!==0)&&(!category||i.category===category)&&(!type||i.product_type===type)).sort((a,b)=>sort==='quantity'?(b.remaining??-1)-(a.remaining??-1)||a.product_name.localeCompare(b.product_name):a.product_name.localeCompare(b.product_name));
 return <section className="flex min-w-0 flex-col gap-5">
  <div className="rounded-lg border border-border p-5"><h2 className="text-lg font-semibold">Shared Prep List</h2><p className="my-2 text-4xl font-semibold">{board?.items.reduce((n,i)=>n+(i.remaining??0),0)??"—"} <span className="text-base">containers remaining</span></p><p>Matching products are combined across displays. Staff record partial preparation or Done in the iPhone app.</p>{updated&&<p className="mt-2 text-sm text-muted-foreground">Updated {time(updated)} · refreshes every 5 seconds while visible</p>}</div>
  {failure&&<div role="alert"><p>{failure.message} Counts may be out of date.</p>{failure.kind==='session'&&<Link href="/sign-in?next=%2Fproduction">Sign in again</Link>}</div>}
  {!board&&!failure&&<p role="status">Loading preparation…</p>}
  {!!board?.missing_sections.length&&<p>Partial list · no saved count for {board.missing_sections.map(s=>sectionLabel(s,sectionNames)).join(', ')}.</p>}
  <p className="text-sm text-muted-foreground">Counts carry forward until replaced. Check their timestamps. New counts must include previously made containers. Recount all locations of a shared product after moving stock; sales are reflected when staff update counts.</p>
  <div className="grid gap-3 sm:grid-cols-3">
   <label>Category<select className={field} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(board?.items.map(i=>i.category).filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Type<select className={field} value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{[...new Set(board?.items.map(i=>i.product_type).filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Order<select className={field} value={sort} onChange={e=>setSort(e.target.value)}><option value="quantity">Largest amount first</option><option value="name">Product name</option></select></label>
  </div>
  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={completed} onChange={e=>setCompleted(e.target.checked)}/>Show completed items</label>
  <p>Shown: {rows.reduce((n,i)=>n+(i.remaining??0),0)} containers</p>
  <ul className="flex flex-col gap-4">{rows.map(i=><li key={i.product_id} className="min-w-0 rounded-lg border border-border p-4"><h3 className="break-words font-semibold">{i.product_name}</h3>{i.ready?<><p className="text-2xl">{i.remaining} remaining</p><p>{i.made} made since this count</p></>:<p>Count this product in Stock Check to see how many to make.</p>}<p className="text-sm">Oldest count: {time(i.oldest_count)}</p><details className="mt-3"><summary className="cursor-pointer">Locations & recent preparation</summary><p className="text-sm">Amounts needed at count time, before later preparation:</p>{i.locations.map(l=><p key={l.section}>{sectionLabel(l.section,sectionNames)}: {l.display_need}</p>)}{i.activity.map((a,n)=><p key={n}>{a.name} made {a.quantity} · {time(a.at)}</p>)}</details></li>)}</ul>
  {board&&!rows.length&&<p>No items to make in this selection. Uncounted sections are excluded.</p>}
 </section>;
}
