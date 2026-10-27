import {supabase,explain} from './data';
import {newId} from './id';
import {saveUpdate,type PortalUpdate} from './updates-data';
import {validateImageFile,validateImageDimensions,MAX_UPDATE_IMAGES} from './image-validation';
export type UpdateImage={path:string;name:string;size:number;width:number;height:number;caption:string};
export type EditorImage=UpdateImage&{file?:File;preview?:string};
const bucket=()=>supabase().storage.from('hub-portal-images');
export async function prepareUpdateImage(file:File):Promise<EditorImage>{
 await validateImageFile(file);
 const preview=URL.createObjectURL(file);
 try{
  const dimensions=await new Promise<{width:number;height:number}>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error('Gambar tidak dapat dibaca. Pilih file gambar lain.'));image.src=preview;});
  validateImageDimensions(dimensions.width,dimensions.height);
  return {path:`pending:${newId()}`,name:file.name.slice(0,180),size:file.size,...dimensions,caption:'',file,preview};
 }catch(e){URL.revokeObjectURL(preview);throw e;}
}
export async function updateImageUrls(paths:string[]):Promise<Record<string,string>>{
 const unique=[...new Set(paths)].filter(Boolean);if(!unique.length)return {};
 const {data,error}=await bucket().createSignedUrls(unique,300);
 if(error)throw new Error('Gambar belum dapat dimuat. Periksa koneksi lalu coba lagi.');
 return Object.fromEntries(data.filter(item=>item.path&&item.signedUrl).map(item=>[item.path!,item.signedUrl!]));
}
export async function saveUpdateWithImages(row:PortalUpdate,isNew:boolean,photos:EditorImage[],onProgress:(message:string)=>void){
 if(photos.length>MAX_UPDATE_IMAGES)throw new Error('Maksimal 4 gambar per informasi.');
 const uploaded:string[]=[];const images:UpdateImage[]=[];let committed=false;
 try{
  for(const [index,photo] of photos.entries()){
   if(!photo.file){const {path,name,size,width,height,caption}=photo;images.push({path,name,size,width,height,caption});continue;}
   onProgress(`Mengunggah gambar ${index+1} dari ${photos.length}…`);
   const {mime,extension}=await validateImageFile(photo.file);validateImageDimensions(photo.width,photo.height);
   const path=`${row.id}/${newId()}.${extension}`;
   const {error}=await bucket().upload(path,photo.file,{contentType:mime,upsert:false,cacheControl:'300'});
   if(error)throw new Error('Gambar belum dapat diunggah. Periksa koneksi dan ukuran file, lalu coba lagi.');
   uploaded.push(path);images.push({path,name:photo.name,size:photo.file.size,width:photo.width,height:photo.height,caption:photo.caption.trim()});
  }
  onProgress('Menyimpan informasi…');const item=await saveUpdate({...row,images},isNew);committed=true;
  const removed=(row.images||[]).map(image=>image.path).filter(path=>!images.some(image=>image.path===path));
  if(removed.length){const {error}=await bucket().remove(removed);if(error)return {item,cleanupWarning:true};}
  return {item,cleanupWarning:false};
 }catch(e){
  if(!committed&&uploaded.length){try{await bucket().remove(uploaded);}catch{}}
  if(e instanceof Error)throw e;throw explain(e as {code?:string;message?:string});
 }
}
