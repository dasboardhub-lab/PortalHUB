import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument,documentFormat,DOCUMENT_LIMIT} from '../src/document-files.ts';

function office(names,encrypted=false){
 const blocks=[],directory=[];let offset=0;
 for(const name of names){
  const filename=Buffer.from(name),content=Buffer.from('<xml/>');
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(encrypted?1:0,6);local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(encrypted?1:0,8);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  blocks.push(local,filename,content);directory.push(central,filename);offset+=local.length+filename.length+content.length;
 }
 const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...blocks,dir,end]);
}
const word=['[Content_Types].xml','_rels/.rels','word/document.xml'];
const excel=['[Content_Types].xml','_rels/.rels','xl/workbook.xml'];
test('document selection accepts PDF, Word, Excel and supported images with canonical MIME and extensions',async()=>{
 const samples=[['pdf','%PDF-1.7','application/pdf'],['doc',new Uint8Array([208,207,17,224,161,177,26,225]),'application/msword'],['xls',new Uint8Array([208,207,17,224,161,177,26,225]),'application/vnd.ms-excel'],['docx',office(word),'application/zip'],['xlsx',office(excel),''],['jpeg',new Uint8Array([255,216,255,224]),'image/jpeg'],['png',new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'],['webp','RIFF1234WEBP','image/webp'],['gif','GIF89a1234','image/gif']];
 for(const [ext,bytes,mime] of samples){const format=await validateDocument(new File([bytes],'Panduan.'+ext.toUpperCase(),{type:mime}));assert.equal(format.extension,ext==='jpeg'?'jpg':ext);assert.equal(format.mime,documentFormat('file.'+ext).mime);}
});
test('renamed executable content, incorrect Office archives and unsupported formats fail before upload',async()=>{
 for(const [name,bytes,mime] of [['sop.docx',office(excel),''],['data.xlsx',office(word),''],['sop.docx',office(['index.html']),''],['sop.docx',office(word,true),''],['sop.docx',office([...word,'word/vbaProject.bin']),''],['sop.docx',office(word).subarray(0,80),''],['sop.pdf','<html>evil</html>','application/pdf'],['sop.jpg','<script>bad</script>','image/jpeg'],['sop.doc','%PDF-1.7','application/msword'],['sop.svg','<svg/>','image/svg+xml'],['sop.docm',office(word),''],['sop.png',new Uint8Array([137,80,78,71,13,10,26,10]),'text/html']])await assert.rejects(()=>validateDocument(new File([bytes],name,{type:mime})),undefined,name);
});
test('empty and oversized files are rejected and 25 MB stays the document limit',async()=>{
 assert.equal(DOCUMENT_LIMIT,26214400);
 await assert.rejects(()=>validateDocument(new File([],'empty.docx')),/lebih dari 0/);
 await assert.rejects(()=>validateDocument(new File([new Uint8Array(DOCUMENT_LIMIT+1)],'large.xlsx')),/maksimal 25 MB/);
 assert.equal(documentFormat('unsafe.html'),null);
});
