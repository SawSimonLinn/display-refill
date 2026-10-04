#!/usr/bin/env node
// Real iOS UI tests; all services and fixtures are local/synthetic. No credentials logged.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
const root = fileURLToPath(new URL('..', import.meta.url));
const developer = process.env.DEVELOPER_DIR;
if (!developer) throw new Error('Set DEVELOPER_DIR to full Xcode.');
const raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {cwd: root, encoding:'utf8', stdio:['ignore','pipe','pipe']});
const status = JSON.parse(raw.slice(raw.indexOf('{')));
for (const key of ['API_URL','DB_URL']) if (!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(status[key]).hostname)) throw new Error('Only loopback Supabase allowed.');
const env = {...process.env, SUPABASE_URL:status.API_URL, SUPABASE_SERVICE_ROLE_KEY:status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
 NEXT_PUBLIC_SUPABASE_URL:status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.PUBLISHABLE_KEY ?? status.ANON_KEY,
 APP_ORIGIN:'http://localhost:3100', NEXT_TELEMETRY_DISABLED:'1', LOG_LEVEL:'warn'};
const next = `${root}/node_modules/.bin/next`;
const checked = async promise => {const r = await promise; if(r.error) throw new Error([r.error.code, r.error.message].filter(Boolean).join(' ') || 'Fixture operation failed'); return r.data;};
const service = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const ids = Object.fromEntries(['org','store','product','pog','version','display'].map(k=>[k,randomUUID()]));
const email = `simulator-${randomUUID()}@example.com`, password = randomBytes(24).toString('base64url'), controlKey=randomBytes(24).toString('base64url');
const device=process.env.SIMULATOR_ID??'C5F3DEA0-0C84-4ED2-84D8-60D0933463CC';
const devices=JSON.parse(execFileSync('xcrun',['simctl','list','devices','available','-j'],{encoding:'utf8'}));
const selected=Object.values(devices.devices).flat().find(d=>d.udid===device);
if(!selected)throw new Error('Requested simulator is unavailable.');
if(selected.state!=='Booted')execFileSync('xcrun',['simctl','boot',device]);
execFileSync('xcrun',['simctl','bootstatus',device,'-b'],{stdio:'inherit'});
const reportedSize=execFileSync('xcrun',['simctl','ui',device,'content_size'],{encoding:'utf8'}).trim();
const originalSize=['unknown','unsupported',''].includes(reportedSize)?'large':reportedSize;
execFileSync('xcrun',['simctl','ui',device,'content_size','large']);
let actor, colleague, server, proxy, worker, workerScenario, fault=false;
const ledger=[];
async function snapshot() {
 const scans=await checked(service.from('scans').select('*,scan_slots(*)').eq('created_by',actor).order('created_at',{ascending:false}).limit(1));
 const scan=scans[0];
 return scan ? {scan_id:scan.id,status:scan.status,revision:scan.revision,total_refill:scan.total_refill,completed_by:scan.completed_by,
   source:scan.source,
   slots:scan.scan_slots.sort((a,b)=>a.slot_label_snapshot.localeCompare(b.slot_label_snapshot)).map(s=>({label:s.slot_label_snapshot,accepted:s.accepted_quantity,final:s.final_quantity,refill:s.refill_quantity,ai:s.ai_quantity,review_state:s.review_state})),
   corrections:await corrections(scan),ledger} : null;
}
async function corrections(scan) {
 const labels=Object.fromEntries(scan.scan_slots.map(s=>[s.id,s.slot_label_snapshot]));
 const rows=await checked(service.from('scan_corrections').select('*').eq('scan_id',scan.id).order('created_at'));
 return rows.map(c=>({label:labels[c.scan_slot_id],previous:c.previous_quantity,corrected:c.corrected_quantity,original_ai:c.original_ai_quantity,reason:c.reason,verified:c.verified}));
}
try {
 for (const port of [3100,3101]) {
   try { await fetch(`http://localhost:${port}`,{signal:AbortSignal.timeout(500)}); throw new Error(`Port ${port} is occupied.`); }
   catch(error) { if(error.message.includes('occupied')) throw error; }
 }
 execFileSync(next,['build'],{cwd:`${root}/apps/admin`,env,stdio:'inherit'});
 execFileSync('npm',['run','build:worker'],{cwd:root,env:process.env,stdio:'inherit'});
 server=spawn(next,['start','-p','3100','-H','localhost'],{cwd:`${root}/apps/admin`,env,stdio:'ignore'});
 const deadline=Date.now()+60_000;
 while(true) {
   try {if((await fetch('http://localhost:3100/api/v1/health')).ok)break;} catch{}
   if(Date.now()>deadline)throw new Error('Local API startup failed.');
   await new Promise(r=>setTimeout(r,500));
 }
 actor=(await checked(service.auth.admin.createUser({email,password,email_confirm:true}))).user.id;
 await checked(service.from('organizations').insert({id:ids.org,name:'Simulator synthetic'}));
 await checked(service.from('organization_memberships').insert({organization_id:ids.org,user_id:actor,role:'member'}));
 await checked(service.from('stores').insert({id:ids.store,organization_id:ids.org,name:'Simulator Store',store_number:'SIM',timezone:'UTC'}));
 await checked(service.from('store_memberships').insert({organization_id:ids.org,store_id:ids.store,user_id:actor,role:'employee'}));
 // A second employee of the same store owns seeded history, so snapshots of the actor's own latest scan are unaffected.
 colleague=(await checked(service.auth.admin.createUser({email:`simulator-colleague-${randomUUID()}@example.com`,password:randomBytes(24).toString('base64url'),email_confirm:true}))).user.id;
 await checked(service.from('organization_memberships').insert({organization_id:ids.org,user_id:colleague,role:'member'}));
 await checked(service.from('store_memberships').insert({organization_id:ids.org,store_id:ids.store,user_id:colleague,role:'employee'}));
 await checked(service.from('products').insert({id:ids.product,organization_id:ids.org,name:'Synthetic Garden Salad',short_name:'Garden',category:'fixture',container_type:'tub'}));
 await checked(service.from('pogs').insert({id:ids.pog,organization_id:ids.org,name:'Simulator POG'}));
 await checked(service.from('pog_versions').insert({id:ids.version,organization_id:ids.org,pog_id:ids.pog,version_number:1,reference_path:`${ids.org}/${ids.pog}/synthetic.jpg`,reference_width:100,reference_height:100,reference_validated_at:new Date().toISOString(),slots_need_review:false}));
 for(const [index,target,trigger] of [[0,3,1],[1,4,null]]) await checked(service.from('pog_slots').insert({organization_id:ids.org,pog_version_id:ids.version,product_id:ids.product,label:`A${index+1}`,x:index*.5,y:0,width:.5,height:1,target_quantity:target,refill_threshold:trigger,sort_order:index}));
 await checked(service.from('pog_versions').update({state:'published',published_at:new Date().toISOString()}).eq('id',ids.version));
 const photo=await sharp({create:{width:800,height:400,channels:3,background:'#88aa44'}}).jpeg().toBuffer();
 await checked(service.storage.from('pog-images').upload(`${ids.org}/${ids.pog}/synthetic.jpg`,photo,{contentType:'image/jpeg'}));
 if(process.env.PHOTO_TESTS==='1'||process.env.REVIEW_TESTS==='1'){writeFileSync('/tmp/feature08-import.jpg',photo);execFileSync('xcrun',['simctl','addmedia',device,'/tmp/feature08-import.jpg']);}
 await checked(service.from('displays').insert({id:ids.display,organization_id:ids.org,store_id:ids.store,name:'Simulator Display',active_pog_version_id:ids.version}));
 proxy=createServer(async(req,res)=>{
   try {
    const chunks=[]; for await(const chunk of req) chunks.push(chunk); const body=Buffer.concat(chunks);
    if(req.url.startsWith('/control/')) {
      if(req.headers.authorization!==`Bearer ${controlKey}`){res.writeHead(403).end();return;}
      if(req.url==='/control/large-type'||req.url==='/control/normal-type'){execFileSync('xcrun',['simctl','ui',device,'content_size',req.url.endsWith('large-type')?'accessibility-extra-extra-extra-large':'large']);res.writeHead(200).end('{}');return;}
      if(req.url==='/control/reset-ledger'){ledger.length=0;res.writeHead(200).end('{}');return;}
      if(req.url==='/control/fail-next-save'){fault=true;res.writeHead(200).end('{}');return;}
      // Tests that need an idle queue stop any worker an earlier test started in this run.
      if(req.url==='/control/stop-worker'){
       if(worker){const w=worker;worker=undefined;await new Promise(r=>{w.once('exit',r);w.kill('SIGTERM');});}
       res.writeHead(200).end('{}');return;
      }
      if(req.url.startsWith('/control/start-worker')){
       const scenario=new URL(req.url,'http://localhost').searchParams.get('scenario')??'mixed';
       if(worker&&workerScenario!==scenario){worker.kill('SIGTERM');worker=undefined;}
       workerScenario=scenario;
       // Shared local database: park other organizations' due work so this worker only analyses the fixture scan.
       await checked(service.from('scan_jobs').update({available_at:new Date(Date.now()+86_400_000).toISOString()}).neq('organization_id',ids.org).eq('state','queued'));
       await checked(service.from('scan_jobs').update({lease_until:new Date(Date.now()+86_400_000).toISOString()}).neq('organization_id',ids.org).eq('state','running'));
       worker??=spawn(process.execPath,[`${root}/workers/scan-worker/dist/main.js`],{cwd:`${root}/workers/scan-worker`,stdio:'ignore',
        env:{...process.env,SUPABASE_URL:status.API_URL,SUPABASE_SERVICE_ROLE_KEY:status.SECRET_KEY??status.SERVICE_ROLE_KEY,DATABASE_URL:status.DB_URL,VISION_PROVIDER:'mock',VISION_MOCK_SCENARIO:scenario,LOG_LEVEL:'warn'}});
       res.writeHead(200).end('{}');return;
      }
      if(req.url==='/control/seed-history'){
       const rpc=async(name,args)=>{const d=await checked(service.rpc(name,args));return Array.isArray(d)?d[0]:d;};
       const create=async source=>(await rpc('create_scan',{p_actor:colleague,p_display_id:ids.display,p_source:source,p_expected_pog_version_id:ids.version})).scan_id;
       const slots=async id=>Object.fromEntries((await checked(service.from('scan_slots').select('pog_slot_id,slot_label_snapshot').eq('scan_id',id))).map(x=>[x.slot_label_snapshot,x.pog_slot_id]));
       const counts=async(id,revision,action,items)=>(await rpc('mutate_scan_counts',{p_actor:colleague,p_scan_id:id,p_expected_revision:revision,p_action:action,p_items:items,p_key:randomUUID(),p_request_id:randomUUID()})).payload.revision;
       for(let i=0;i<26;i++)await create('manual');
       // Taken-over photo check, confirmed, whose photo retention has since removed (simulates the Feature 12 job).
       const removed=await create('photo');
       const taken=(await rpc('scan_analysis_action',{p_actor:colleague,p_action:'takeover',p_scan:removed,p_expected_revision:1,p_key:randomUUID(),p_request_id:randomUUID()})).payload.revision;
       await checked(service.from('scans').update({image_path:`${ids.org}/${ids.store}/${removed}/validated-${"0".repeat(64)}.jpg`,captured_at:new Date().toISOString(),image_deleted_at:new Date().toISOString()}).eq('id',removed));
       let s1=await slots(removed);
       let rev=await counts(removed,taken,'counts',[{slot_id:s1.A1,quantity:1,verified:true,reason:'manual_count'},{slot_id:s1.A2,quantity:4,verified:true,reason:'manual_count'}]);
       await counts(removed,rev,'confirm',null);
       // Completed manual check with a correction trail (A2 counted 2, then corrected to 1).
       const completed=await create('manual');
       s1=await slots(completed);
       rev=await counts(completed,1,'counts',[{slot_id:s1.A1,quantity:0,verified:true,reason:'manual_count'},{slot_id:s1.A2,quantity:2,verified:true,reason:'manual_count'}]);
       rev=await counts(completed,rev,'counts',[{slot_id:s1.A2,quantity:1,verified:true,reason:'count_corrected'}]);
       rev=await counts(completed,rev,'confirm',null);
       await rpc('manual_scan_workflow',{p_actor:colleague,p_action:'complete',p_resource:completed,p_expected_revision:rev,p_key:randomUUID(),p_request_id:randomUUID()});
       const {count}=await service.from('scans').select('id',{count:'exact',head:true}).eq('store_id',ids.store);
       res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({completed,removed,total:count}));return;
      }
      if(req.url==='/control/stale') {
       const s=await snapshot();
       const slots=await checked(service.from('scan_slots').select('pog_slot_id').eq('scan_id',s.scan_id));
       await checked(service.rpc('mutate_scan_counts',{p_actor:actor,p_scan_id:s.scan_id,p_expected_revision:s.revision,p_action:'counts',p_items:slots.map(x=>({slot_id:x.pog_slot_id,quantity:1,verified:true,reason:'manual_count'})),p_key:randomUUID(),p_request_id:randomUUID()}));
      }
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(await snapshot()));return;
    }
    const headers={...req.headers};delete headers.host; delete headers['content-length']; delete headers.connection;
    const response=await fetch(`http://localhost:3100${req.url}`,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(req.method==='PATCH'&&req.url.endsWith('/counts')){
     ledger.push({key:req.headers['idempotency-key'],body:JSON.parse(body.toString()),status:response.status});
     if(fault&&response.ok){fault=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:{code:'DEPENDENCY_UNAVAILABLE',message:'Synthetic lost response',field_errors:{}},request_id:randomUUID()}));return;}
    }
    res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store'}).end(bytes);
   }catch(error){console.error('Harness proxy/control failure:',error?.message??'unknown');res.writeHead(500).end('{}');}
 });
 await new Promise(resolve=>proxy.listen(3101,'localhost',resolve));
 const fixture=`${root}/apps/ios/Verification/LocalFixture.json`;
 writeFileSync(fixture,JSON.stringify({email,password,controlKey,controlURL:'http://localhost:3101',actor}),{mode:0o600});
 execFileSync('xcodegen',['generate'],{cwd:`${root}/apps/ios`,env:process.env,stdio:'inherit'});
 const args=['-scheme','DisplayRefill','-destination',`platform=iOS Simulator,id=${device}`,
 '-derivedDataPath','/tmp/feature07-ios-derived','-resultBundlePath',`/tmp/feature07-ios-${Date.now()}.xcresult`,
 '-parallel-testing-enabled','NO',...(process.env.PHOTO_TESTS==='1'?['-only-testing:DisplayRefillUITests/ManualWorkflowUITests/testPhotoImportCropAndRecovery','-only-testing:DisplayRefillCoreTests']:[]),
 ...(process.env.HISTORY_TESTS==='1'?['-only-testing:DisplayRefillUITests/ManualWorkflowUITests/testHistoryPaginationRecordAndRemovedPhoto','-only-testing:DisplayRefillCoreTests']:[]),
 ...(process.env.REVIEW_TESTS==='1'?['-only-testing:DisplayRefillUITests/ManualWorkflowUITests/testEstimateReviewCorrectionAndTakeover','-only-testing:DisplayRefillCoreTests']:[]),'CODE_SIGN_IDENTITY=-','API_BASE_URL=http://localhost:3101',`SUPABASE_URL=${status.API_URL}`,
 `SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY??status.ANON_KEY}`,'test'];
 const code=await new Promise(resolve=>{
  const child=spawn('xcodebuild',args,{cwd:`${root}/apps/ios`,env:process.env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{let text=chunk.toString();for(const value of [password,controlKey,status.SECRET_KEY,status.SERVICE_ROLE_KEY])if(value)text=text.split(value).join('[redacted]');process.stdout.write(text);});
  child.on('error',()=>resolve(1)); child.on('exit',c=>resolve(c??1));
 });
 console.log('Simulator verification exit:',code);process.exitCode=code;
}finally{
 try{execFileSync('xcrun',['simctl','ui',device,'content_size',originalSize]);}catch{}
 try{unlinkSync(`${root}/apps/ios/Verification/LocalFixture.json`);}catch{}
 if(actor){await service.from('store_memberships').update({active:false}).eq('user_id',actor);await service.from('organization_memberships').update({active:false}).eq('user_id',actor);await service.auth.admin.updateUserById(actor,{ban_duration:'876000h'});}
 if(colleague){await service.from('store_memberships').update({active:false}).eq('user_id',colleague);await service.from('organization_memberships').update({active:false}).eq('user_id',colleague);await service.auth.admin.updateUserById(colleague,{ban_duration:'876000h'});}
 if(worker)worker.kill('SIGTERM');
 if(proxy)await new Promise(r=>proxy.close(r)); if(server)server.kill('SIGTERM');
}
