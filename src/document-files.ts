export const DOCUMENT_LIMIT=25*1024*1024;
const FORMATS={
 pdf:{mime:'application/pdf',label:'PDF',kind:'pdf'},
 doc:{mime:'application/msword',label:'DOC',kind:'word'},
 docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',label:'DOCX',kind:'word'},
 xls:{mime:'application/vnd.ms-excel',label:'XLS',kind:'excel'},
 xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',label:'XLSX',kind:'excel'},
 jpg:{mime:'image/jpeg',label:'JPG',kind:'image'},
 jpeg:{mime:'image/jpeg',label:'JPG',kind:'image'},
 png:{mime:'image/png',label:'PNG',kind:'image'},
 webp:{mime:'image/webp',label:'WEBP',kind:'image'},
 gif:{mime:'image/gif',label:'GIF',kind:'image'},
} as const;
export const DOCUMENT_ACCEPT=Object.entries(FORMATS).flatMap(([extension,format])=>['.'+extension,format.mime]).join(',');
export const DOCUMENT_FORMATS='PDF, Word (.doc/.docx), Excel (.xls/.xlsx), JPG, PNG, WebP, atau GIF';
export function documentFormat(name:string){
 const extension=name.toLowerCase().split('.').at(-1)||'';
 if(!Object.hasOwn(FORMATS,extension))return null;
 return {...FORMATS[extension as keyof typeof FORMATS],extension:extension==='jpeg'?'jpg':extension};
}
const text=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
function officeEntries(bytes:Uint8Array):Set<string>{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const invalid=()=>new Error('Isi file Word/Excel tidak valid atau tidak didukung. Simpan ulang sebagai DOCX atau XLSX.');
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}}
 if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw invalid();
 const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(!count||count>10000||view.getUint16(end+8,true)!==count||start+length!==end)throw invalid();
 const names=new Set<string>();let offset=start;
 for(let i=0;i<count;i++){
  if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw invalid();
  const nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
  if((view.getUint16(offset+8,true)&1)||offset+46+nameLength+extraLength+commentLength>end||local+30>start||view.getUint32(local,true)!==0x04034b50)throw invalid();
  const name=text(bytes.subarray(offset+46,offset+46+nameLength));
  if(!name||name.startsWith('/')||name.includes('..')||name.includes('\\')||name.includes('\0')||names.has(name)||/vbaProject\.bin$/i.test(name))throw invalid();
  names.add(name);offset+=46+nameLength+extraLength+commentLength;
 }
 if(offset!==end||!names.has('[Content_Types].xml')||!names.has('_rels/.rels'))throw invalid();
 return names;
}
export async function validateDocument(file:File){
 const format=documentFormat(file.name);
 if(!format)throw new Error('Pilih file '+DOCUMENT_FORMATS+'.');
 if(!file.size||file.size>DOCUMENT_LIMIT)throw new Error('Ukuran file harus lebih dari 0 dan maksimal 25 MB.');
 // Some phones identify Office files as ZIP or a generic binary stream.
 const mime=file.type.toLowerCase().split(';')[0];
 const generic=!mime||mime==='application/octet-stream'||(['docx','xlsx'].includes(format.extension)&&['application/zip','application/x-zip-compressed'].includes(mime));
 if(!generic&&mime!==format.mime)throw new Error('Jenis file tidak sesuai dengan ekstensi. Pilih file asli dari perangkat.');
 const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
 let valid=false;
 switch(format.extension){
  case 'pdf':valid=text(header.subarray(0,5))==='%PDF-';break;
  case 'doc':case 'xls':valid=[208,207,17,224,161,177,26,225].every((n,i)=>header[i]===n);break;
  case 'docx':case 'xlsx':{
   const entries=officeEntries(new Uint8Array(await file.arrayBuffer()));
   valid=entries.has(format.extension==='docx'?'word/document.xml':'xl/workbook.xml');break;
  }
  case 'jpg':valid=header[0]===255&&header[1]===216&&header[2]===255;break;
  case 'png':valid=[137,80,78,71,13,10,26,10].every((n,i)=>header[i]===n);break;
  case 'webp':valid=text(header.subarray(0,4))==='RIFF'&&text(header.subarray(8,12))==='WEBP';break;
  case 'gif':valid=['GIF87a','GIF89a'].includes(text(header.subarray(0,6)));break;
 }
 if(!valid)throw new Error('Isi file tidak sesuai dengan format '+format.label+'. Pilih file asli yang dapat dibuka.');
 return format;
}
