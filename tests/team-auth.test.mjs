import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const validationUrl=moduleUrl(await readFile(new URL('../supabase/functions/_shared/team-validation.ts',import.meta.url),'utf8'));
const validation=await import(validationUrl);
const handlerSource=(await readFile(new URL('../supabase/functions/hub-portal-team/handler.ts',import.meta.url),'utf8')).replace('../_shared/team-validation.ts',validationUrl);
const {teamHandler}=await import(moduleUrl(handlerSource));
const userId='11111111-1111-4111-8111-111111111111';
function service({role='admin',active=true,authenticated=true,rpcError=null}={}){const calls=[];const client={calls,auth:{getUser:async()=>({data:{user:authenticated?{id:userId}:null},error:null}),admin:{createUser:async data=>{calls.push(['create',data]);return {data:{user:{id:'22222222-2222-4222-8222-222222222222'}},error:null};},deleteUser:async id=>{calls.push(['delete',id]);return {data:{},error:null};},updateUserById:async(id,data)=>{calls.push(['password',id,data]);return {data:{},error:null};}}},from:()=>({select:fields=>({eq:()=>({maybeSingle:async()=>({data:fields==='staff_id'?{staff_id:'mks01'}:{role,active},error:null})})})}),rpc:async(name,payload)=>{calls.push(['rpc',name,payload]);return {data:{},error:rpcError};}};return client;}
const createPayload={action:'create',account:{name:'PIC MKS',staff_id:'MKS01',hub:'MKS',role:'member',active:true,password:'TEST-ONLY-password-123'}};
const request=(body,authorized=true)=>new Request('https://example.test/team',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer fixture-token'}:{})},body:JSON.stringify(body)});
test('NIK/ID normalization and account validation reject invalid roles and HUBs',()=>{
 assert.equal(validation.staffEmail(' MKS01 '),'staff-mks01@portalhub.invalid');
 for(const value of ['a','id with spaces','<script>','x@example.com','a'.repeat(51)])assert.throws(()=>validation.staffEmail(value));
 assert.throws(()=>validation.validateAccount({...createPayload.account,role:'owner'},true),/pengguna/);
 assert.throws(()=>validation.validateAccount({...createPayload.account,hub:'ALL'},true),/HUB/);
 assert.throws(()=>validation.validateAccount({...createPayload.account,password:'short'},true),/10–128/);
});
test('account endpoint rejects unauthenticated, inactive and non-admin requests before Auth mutations',async()=>{
 for(const [opts,authorized,expected] of [[{},false,401],[{authenticated:false},true,401],[{role:'member'},true,403],[{active:false},true,403]]){
  const client=service(opts);assert.equal((await teamHandler(client)(request(createPayload,authorized))).status,expected);assert.equal(client.calls.length,0);
 }
});
test('create uses server Auth, auto-confirms identity, never stores or returns password in profile',async()=>{
 const client=service();const result=await teamHandler(client)(request(createPayload));assert.equal(result.status,200);const output=await result.text();assert.ok(!output.includes(createPayload.account.password));
 assert.equal(client.calls[0][1].email,'staff-mks01@portalhub.invalid');assert.equal(client.calls[0][1].email_confirm,true);assert.ok(!('password' in client.calls[1][2].p_payload));assert.equal(client.calls[1][2].p_actor,userId);
});
test('failed profile provisioning cleans up the newly created Auth user',async()=>{
 const client=service({rpcError:{code:'23505'}});const result=await teamHandler(client)(request(createPayload));assert.equal(result.status,400);assert.equal(client.calls.at(-1)[0],'delete');
});
test('password reset is admin-only and never returns credentials',async()=>{
 const client=service();const response=await teamHandler(client)(request({action:'password',user_id:userId,password:'TEST-ONLY-reset-123'}));assert.equal(response.status,200);assert.equal(client.calls[0][0],'password');assert.ok(!(await response.text()).includes('TEST-ONLY-reset'));
});
