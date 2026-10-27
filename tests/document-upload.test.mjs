import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const urlOf=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const mockUrl=urlOf("let client;export const useClient=c=>client=c;export const supabase=()=>client;export const explain=e=>new Error(e.message||'Error');");
const mock=await import(mockUrl);
const source=(await readFile(new URL('../src/operations-data.ts',import.meta.url),'utf8'))
 .replace("'./data'",JSON.stringify(mockUrl))
 .replace("'./id'",JSON.stringify(urlOf('export const newId=()=>crypto.randomUUID();')))
 .replace("'./document-files'",JSON.stringify(new URL('../src/document-files.ts',import.meta.url).href));
const {saveDocument}=await import(urlOf(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText));
const id='11111111-1111-4111-8111-111111111111';
function client({uploadError=false,saveError=false}={}){
 const calls=[];
 const query={select(){return query;},eq(){return query;},async single(){return saveError?{error:{code:'PGRST116'}}:{data:{id},error:null};}};
 return {calls,storage:{from(bucket){return {async upload(path,file,options){calls.push({operation:'upload',bucket,path,file,options});return {error:uploadError?{message:'offline'}:null};},async remove(paths){calls.push({operation:'remove',paths});return {error:null};}};}},from(table){return {insert(row){calls.push({operation:'save',table,row});return query;},update(row){calls.push({operation:'save',table,row});return query;}};}};
}
test('document uploads use the detected extension and MIME; metadata replacement removes only the old file',async()=>{
 const current=client();mock.useClient(current);
 const oldPath=id+'/22222222-2222-4222-8222-222222222222.pdf';
 const row={id,file_path:oldPath,file_name:'old.pdf',file_size:30,updated_at:'2026-10-28T00:00:00Z'};
 await saveDocument(row,false,new File([new Uint8Array([255,216,255,224])],'foto.JPEG',{type:'image/jpeg'}));
 const [upload,save,remove]=current.calls;
 assert.equal(upload.bucket,'hub-portal-documents');assert.ok(upload.path.endsWith('.jpg'));assert.notEqual(upload.path,oldPath);assert.equal(upload.options.contentType,'image/jpeg');assert.equal(upload.options.upsert,false);
 assert.equal(save.row.file_path,upload.path);assert.equal(save.row.file_name,'foto.JPEG');assert.equal(save.row.file_size,4);assert.deepEqual(remove.paths,[oldPath]);assert.equal(row.file_path,oldPath);
});
test('failed uploads and failed metadata saves preserve the existing file and clean up only the new upload',async()=>{
 const row={id,file_path:id+'/22222222-2222-4222-8222-222222222222.pdf',file_name:'old.pdf',file_size:30,updated_at:'2026-10-28T00:00:00Z'};
 const file=new File(['GIF89afixture'],'foto.gif',{type:'image/gif'});
 for(const options of [{uploadError:true},{saveError:true}]){
  const current=client(options);mock.useClient(current);
  await assert.rejects(()=>saveDocument(row,false,file),/belum dapat diunggah|sudah berubah/);
  assert.ok(current.calls.every(call=>call.operation!=='remove'||!call.paths.includes(row.file_path)));
  if(options.uploadError)assert.equal(current.calls.length,1);
  else assert.deepEqual(current.calls.at(-1).paths,[current.calls[0].path]);
 }
 const current=client();mock.useClient(current);
 await assert.rejects(()=>saveDocument(row,false,new File(['<html/>'],'bad.docx')));
 assert.equal(current.calls.length,0);
});
