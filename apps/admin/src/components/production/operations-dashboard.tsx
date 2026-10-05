"use client";
import { useEffect, useState } from "react";
import { apiRequest, type ApiFailure } from "@/lib/api-client";
type Store = { store_id: string; name: string; store_number: string; timezone: string };
type Product = { product_id: string; product_name: string; family: string; category: string; made: number; wasted: number };
type Report = { business_date: string; start_date: string; end_date: string; timezone: string; made: number; wasted: number; products: Product[]; entries: {id:string;product_name:string;quantity:number;reason:string;note:string;business_date:string;created_at:string;actor_name:string;voided:boolean}[] };
const field = "min-h-11 w-full rounded-lg border border-input bg-background px-3";
export function OperationsDashboard({ stores }: { stores: Store[] }) {
 const [storeId,setStoreId]=useState(stores[0]?.store_id??"");
 const [period,setPeriod]=useState("day");const [day,setDay]=useState("");const [family,setFamily]=useState("");const [order,setOrder]=useState("catalog");
 const [report,setReport]=useState<Report|null>(null);const [failure,setFailure]=useState<ApiFailure|null>(null);const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!storeId)return;
  let live=true;let timer:ReturnType<typeof setTimeout>;
  async function load(){
   const query=new URLSearchParams({period});if(day)query.set("day",day);
   const result=await apiRequest<Report>(`/operations/${storeId}?${query}`,{method:"GET"});
   if(!live)return;
   if(result.ok){setReport(result.data);setFailure(null);}else{setReport(null);setFailure(result.failure);}
   if(live)timer=setTimeout(()=>{if(document.visibilityState==="visible")void load();else timer=setTimeout(()=>void load(),5000);},5000);
  }
  void load();return()=>{live=false;clearTimeout(timer);};
 },[storeId,period,day,retry]);
 if(!stores.length)return <p>No stores assigned.</p>;
 const rows=(report?.products??[]).filter(p=>(p.made>0||p.wasted>0)&&(!family||p.family===family));
 if(order!=="catalog")rows.sort((a,b)=>order==="made"?b.made-a.made||a.product_name.localeCompare(b.product_name):b.wasted-a.wasted||a.product_name.localeCompare(b.product_name));
 return <section className="flex min-w-0 flex-col gap-5" aria-label="Made and waste reports">
  <div className="grid gap-3 sm:grid-cols-3">
   <label>Store<select className={field} value={storeId} onChange={e=>{setStoreId(e.target.value);setReport(null);setFailure(null);}}>{stores.map(s=><option key={s.store_id} value={s.store_id}>{s.store_number} · {s.name}</option>)}</select></label>
   <label>Period<select className={field} value={period} onChange={e=>{setPeriod(e.target.value);setReport(null);setFailure(null);}}><option value="day">Day</option><option value="week">Week · Sunday–Saturday</option><option value="month">Month</option></select></label>
   <label>Date<input type="date" className={field} value={day} onChange={e=>{setDay(e.target.value);setReport(null);setFailure(null);}}/><span className="text-xs text-muted-foreground">Blank uses today in the store’s timezone.</span></label>
  </div>
  {failure&&<div role="alert"><p>{failure.message}</p><button className={field} onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
  {!report&&!failure&&<p role="status">Loading report…</p>}
  {report&&<>
   <p className="text-sm text-muted-foreground">{report.start_date} – {report.end_date} · {report.timezone}</p>
   <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-border bg-card p-4"><p>Made</p><p className="text-3xl font-semibold">{report.made}</p></div><div className="rounded-xl border border-border bg-card p-4"><p>Wasted</p><p className="text-3xl font-semibold">{report.wasted}</p></div></div>
   <p className="text-sm text-muted-foreground">Recorded containers. Sales tracking is not connected.</p>
   <div className="grid gap-3 sm:grid-cols-2"><label>Group<select className={field} value={family} onChange={e=>setFamily(e.target.value)}><option value="">All groups</option>{["Fruit","Vegetables","Salads","Other"].map(v=><option key={v}>{v}</option>)}</select></label><label>Order<select className={field} value={order} onChange={e=>setOrder(e.target.value)}><option value="catalog">Fruit first · $5 bowls</option><option value="made">Most made</option><option value="wasted">Most wasted</option></select></label></div>
   <div className="overflow-hidden rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-left">Product</th><th className="p-3 text-right">Made</th><th className="p-3 text-right">Wasted</th></tr></thead><tbody>{rows.map(p=><tr key={p.product_id} className="border-t border-border"><td className="break-words p-3">{p.product_name}</td><td className="p-3 text-right tabular-nums">{p.made}</td><td className="p-3 text-right tabular-nums">{p.wasted}</td></tr>)}</tbody></table>{!rows.length&&<p className="p-4">No made or waste entries in this selection.</p>}</div>
   <details><summary className="cursor-pointer py-3 font-medium">Recent waste entries</summary><ul className="divide-y divide-border">{report.entries.map(e=><li key={e.id} className="py-3"><div className="flex justify-between gap-3"><span className="font-medium">{e.product_name}</span><span>{e.voided?"Undone":e.quantity}</span></div><p className="text-sm text-muted-foreground">{e.business_date} · {e.reason} · {e.actor_name} · {new Intl.DateTimeFormat("en-US",{timeStyle:"short",timeZone:report.timezone}).format(new Date(e.created_at))}</p>{e.note&&<p className="text-sm">{e.note}</p>}</li>)}</ul>{!report.entries.length&&<p>No waste entries.</p>}{report.entries.length===200&&<p>Latest 200 entries shown. Totals include all entries.</p>}</details>
  </>}
 </section>;
}
