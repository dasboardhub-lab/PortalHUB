import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const validationUrl=moduleUrl(await readFile(new URL('../supabase/functions/_shared/team-validation.ts',import.meta.url),'utf8'));
const validation=await import(validationUrl);
const handlerSource=(await readFile(new URL('../supabase/functions/hub-portal-team/handler.ts',import.meta.url),'utf8')).replace('../_shared/team-validation.ts',validationUrl);
const {teamHandler}=await import(moduleUrl(handlerSource));
const userId='11111111-1111-4111-8111-111111111111';
function service({role='admin',active=true,authenticated=true,rpcError=null,legacy=false}={}){const calls=[];const client={calls,auth:{getUser:async()=>({data:{user:authenticated?{id:userId}:null},error:null}),admin:{getUserById:async()=>({data:{user:{id:userId,email:'admin@example.test'}},error:null}),createUser:async data=>{calls.push(['create',data]);return {data:{user:{id:'22222222-2222-4222-8222-222222222222'}},error:null};},deleteUser:async id=>{calls.push(['delete',id]);return {data:{},error:null};},updateUserById:async(id,data)=>{calls.push(['password',id,data]);return {data:{},error:null};}}},from:()=>({select:fields=>({eq:()=>({maybeSingle:async()=>({data:fields==='staff_id'?{staff_id:legacy?null:'mks01'}:{role,active},error:null})})})}),rpc:async(name,payload)=>{calls.push(['rpc',name,payload]);return {data:{},error:rpcError};}};return client;}
const createPayload={action:'create',account:{name:'PIC MKS',staff_id:'MKS01',hub:'MKS',role:'member',active:true,password:'TEST-ONLY-password-123'}};
const request=(body,authorized=true)=>new Request('https://example.test/team',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer fixture-token'}:{})},body:JSON.stringify(body)});
test('NIK/ID normalization and account validation reject invalid roles and HUBs',()=>{
 assert.equal(validation.staffEmail(' MKS01 '),'staff-mks01@portalhub.invalid');
 for(const value of ['a','id with spaces','<script>','x@example.com','a'.repeat(51)])assert.throws(()=>validation.staffEmail(value));
 assert.throws(()=>validation.validateAccount({...createPayload.account,role:'owner'},true),/pengguna/);
 assert.throws(()=>validation.validateAccount({...createPayload.account,hub:'ALL'},true),/HUB/);
 assert.throws(()=>validation.validateAccount({...createPayload.account,password:'12'},true),/3–128/);
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

test('three-character passwords work for member/admin creation and reset without sending raw passwords to Auth',async()=>{
 for(const role of ['member','admin']){
  const client=service();const response=await teamHandler(client)(request({...createPayload,account:{...createPayload.account,role,password:'123'}}));assert.equal(response.status,200);
  const credential=client.calls[0][1].password;assert.equal(credential,await validation.deriveAuthPassword('staff-mks01@portalhub.invalid','123'));assert.equal(credential.length,68);assert.notEqual(credential,'123');
 }
 const client=service();assert.equal((await teamHandler(client)(request({action:'password',user_id:userId,password:'123'}))).status,200);assert.equal(client.calls[0][2].password,await validation.deriveAuthPassword('staff-mks01@portalhub.invalid','123'));
 for(const short of ['', '1', '12'])assert.throws(()=>validation.validatePassword(short),/3–128/);assert.equal(validation.validatePassword('123'),'123');assert.throws(()=>validation.validatePassword('x'.repeat(129)),/3–128/);
});
test('versioned password derivation is stable across runtimes and separated by account and full password',async()=>{
 const a=await validation.deriveAuthPassword('staff-mks01@portalhub.invalid','123');
 assert.equal(a,await validation.deriveAuthPassword(' STAFF-MKS01@PORTALHUB.INVALID ','123'));
 assert.notEqual(a,await validation.deriveAuthPassword('staff-mks02@portalhub.invalid','123'));
 assert.notEqual(a,await validation.deriveAuthPassword('staff-mks01@portalhub.invalid','124'));
 assert.notEqual(await validation.deriveAuthPassword('a@b.test','x'.repeat(72)+'1'),await validation.deriveAuthPassword('a@b.test','x'.repeat(72)+'2'));
});
test('new NIK accounts sign in with derived credentials while existing NIK/email accounts retain their passwords',async()=>{
 const email='staff-mks01@portalhub.invalid';const derived=await validation.deriveAuthPassword(email,'123');
 for(const [id,secret,expected,attempts] of [[email,'123',derived,1],[email,'legacy-password','legacy-password',2],['admin@example.test','legacy-password','legacy-password',1],['admin@example.test','123',await validation.deriveAuthPassword('admin@example.test','123'),2]]){
  const calls=[];const auth={signInWithPassword:async p=>{calls.push(p);return {error:p.password===expected?null:{code:'invalid_credentials',status:400}};}};
  assert.equal((await validation.signInCompatible(auth,id,secret)).error,null);assert.equal(calls.length,attempts);
 }
});
test('password compatibility never retries rate limits, network errors, or unconfirmed accounts',async()=>{
 for(const error of [{code:'over_request_rate_limit',status:429},{code:'invalid_credentials',status:429},{code:'email_not_confirmed',status:400},{code:'network_error',status:0}]){
  let attempts=0;const auth={signInWithPassword:async()=>{attempts++;return {error};}};
  assert.equal((await validation.signInCompatible(auth,'admin@example.test','123')).error,error);assert.equal(attempts,1);
 }
});

test('existing email admin accounts can set a three-character portal password without changing their identity',async()=>{
 const client=service({legacy:true});const response=await teamHandler(client)(request({action:'password',user_id:userId,password:'123'}));assert.equal(response.status,200);assert.equal(client.calls[0][0],'password');assert.equal(client.calls[0][1],userId);assert.equal(client.calls[0][2].password,await validation.deriveAuthPassword('admin@example.test','123'));assert.ok(!(await response.text()).includes('123'));
});
