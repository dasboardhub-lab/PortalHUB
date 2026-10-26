import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

let db,install,baseline;
const admin="11111111-1111-4111-8111-111111111111",viewer="22222222-2222-4222-8222-222222222222",outsider="33333333-3333-4333-8333-333333333333",inactive="44444444-4444-4444-8444-444444444444";
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid stable language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  install=await readFile(new URL("../setup-supabase.sql",import.meta.url),"utf8");
  await db.exec(install);
  const initial=await db.query("select count(*)::int count from public.hub_portal_members");
  assert.equal(initial.rows[0].count,0,"Installer must never create a default or first-user administrator");
  for(const [id,email] of [[admin,"admin@example.test"],[viewer,"viewer@example.test"],[outsider,"other@example.test"],[inactive,"inactive@example.test"]])await db.query("insert into auth.users(id,email) values($1,$2)",[id,email]);
  await db.query("insert into public.hub_portal_members(user_id,role,active) values($1,'admin',true),($2,'viewer',true),($3,'viewer',false)",[admin,viewer,inactive]);
});
after(async()=>{await db?.close();});
async function as(role,id,task){
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||""]);
  try{return await task();}finally{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub','',false)");}
}
async function snapshot(){return(await db.query("select public.hub_portal_snapshot() result")).rows[0].result;}
async function mutate(value){return(await db.query("select public.hub_portal_mutate($1::jsonb) result",[JSON.stringify(value)])).rows[0].result;}

test("RLS protects all tables; exposed functions run as invoker",async()=>{
  const rows=(await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname like 'hub_portal_%' and relkind='r'")).rows;
  assert.equal(rows.length,5);assert.ok(rows.every(row=>row.relrowsecurity));
  const functions=(await db.query("select proname,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname in ('hub_portal_snapshot','hub_portal_mutate')")).rows;
  assert.equal(functions.length,2);assert.ok(functions.every(row=>!row.prosecdef));
  await as("anon",null,async()=>{await assert.rejects(snapshot,/permission denied/);await assert.rejects(()=>db.query("select * from public.hub_portal_links"),/permission denied/);});
});
test("only approved active members see portal data",async()=>{
  await as("authenticated",outsider,async()=>{assert.equal((await snapshot()).approved,false);assert.equal((await db.query("select count(*)::int count from public.hub_portal_links")).rows[0].count,0);});
  await as("authenticated",inactive,async()=>assert.equal((await snapshot()).approved,false));
  await as("authenticated",viewer,async()=>{
    const data=await snapshot();assert.equal(data.approved,true);assert.equal(data.canManage,false);assert.equal(data.links.length,33);assert.equal(data.categories.length,5);
    assert.equal((await db.query("select count(*)::int count from public.hub_portal_members")).rows[0].count,1);
  });
});
test("viewer cannot self-promote or write through RPC or tables",async()=>{
  await as("authenticated",viewer,async()=>{
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({user_metadata:{role:"admin"}})]);
    await assert.rejects(()=>mutate({operation:"delete-link",id:"aware"}),/Hanya admin/);
    await assert.rejects(()=>db.query("update public.hub_portal_members set role='admin'"),/permission denied/);
    await assert.rejects(()=>db.query("update public.hub_portal_links set title='changed'"),/permission denied/);
    assert.equal((await snapshot()).canManage,false);
  });
});
test("admin saves multiple URL actions and malformed URLs are rejected",async()=>{
  await as("authenticated",admin,async()=>{
    const data=await snapshot();assert.equal(data.canManage,true);baseline={format:"portal-hub-v1",links:data.links,categories:data.categories};
    const link={...data.links[0],id:"test-link",title:"Tes integrasi",actions:[{label:"Master",url:"https://example.com/master"},{label:"Dashboard",url:"https://example.com/dashboard"}]};
    assert.equal((await mutate({operation:"save-link",link})).ok,true);
    assert.equal((await snapshot()).links.find(l=>l.id==="test-link").actions.length,2);
    for(const url of ["javascript:alert(1)","data:text/html,test","https://user:secret@example.com/"]){await assert.rejects(()=>mutate({operation:"save-link",link:{...link,actions:[{label:"Invalid",url}]}}),/http/);}
    assert.equal((await snapshot()).links.find(l=>l.id==="test-link").actions.length,2);
    await mutate({operation:"delete-link",id:"test-link"});
  });
});
test("category CRUD and nonempty category protection",async()=>{
  await as("authenticated",admin,async()=>{
    await mutate({operation:"save-category",category:{id:"test-category",name:"Tes kategori",icon:"grid",sortOrder:98}});
    await mutate({operation:"save-category",category:{id:"test-category",name:"Tes diubah",icon:"grid",sortOrder:98}});
    assert.equal((await snapshot()).categories.find(c=>c.id==="test-category").name,"Tes diubah");
    await assert.rejects(()=>mutate({operation:"delete-category",id:"apps"}),/Pindahkan/);
    await mutate({operation:"delete-category",id:"test-category"});
  });
});
test("backup restoration is atomic and cannot replace account membership",async()=>{
  await as("authenticated",admin,async()=>{
    await mutate({operation:"delete-link",id:baseline.links[0].id});
    assert.equal((await snapshot()).links.length,32);
    await mutate({operation:"restore",backup:{...baseline,members:[{user_id:viewer,role:"admin"}]}});
    assert.equal((await snapshot()).links.length,33);
    const bad={...baseline,categories:baseline.categories.map((c,i)=>({...c,name:i===0?"":c.name}))};
    await assert.rejects(()=>mutate({operation:"restore",backup:bad}),/constraint/);
    assert.equal((await snapshot()).links.length,33);assert.equal((await snapshot()).categories.length,5);
    await assert.rejects(()=>mutate({operation:"restore",backup:{...baseline,links:[...baseline.links,baseline.links[0]]}}),/berulang/);
  });
  await as("authenticated",viewer,async()=>assert.equal((await snapshot()).canManage,false));
});
test("last category cannot be deleted",async()=>{
  await as("authenticated",admin,async()=>{
    await mutate({operation:"restore",backup:{format:"portal-hub-v1",links:[],categories:[{id:"only",name:"Satu",description:"",icon:"grid",sortOrder:0}]}});
    await assert.rejects(()=>mutate({operation:"delete-category",id:"only"}),/setidaknya satu/);
    await mutate({operation:"restore",backup:baseline});
  });
});
test("running setup again keeps edits and deliberately deleted templates",async()=>{
  await as("authenticated",admin,async()=>{
    await mutate({operation:"save-settings",settings:{title:"Portal Tim",area:"KALSULAMP",announcementTitle:"Informasi diperbarui",announcement:"Informasi baru"}});
    await mutate({operation:"delete-link",id:"aware"});
  });
  await db.exec(install);
  await as("authenticated",admin,async()=>{
    const data=await snapshot();assert.equal(data.settings.title,"Portal Tim");assert.equal(data.settings.announcement,"Informasi baru");assert.ok(!data.links.some(l=>l.id==="aware"));assert.equal(data.links.length,32);assert.equal(data.canManage,true);
  });
});
