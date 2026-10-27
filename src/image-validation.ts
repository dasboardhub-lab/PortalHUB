export const MAX_IMAGE_BYTES=5*1024*1024;
export const MAX_UPDATE_IMAGES=4;
export async function validateImageFile(file:Pick<File,'size'|'type'|'slice'>){
 if(!file.size)throw new Error('File gambar kosong. Pilih gambar lain.');
 if(file.size>MAX_IMAGE_BYTES)throw new Error('Ukuran gambar maksimal 5 MB per file.');
 const h=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>h[i]===v);
 const jpeg=h[0]===255&&h[1]===216&&h[2]===255;
 const webp=String.fromCharCode(...h.slice(0,4))==='RIFF'&&String.fromCharCode(...h.slice(8,12))==='WEBP';
 const mime=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;
 if(!mime||file.type&&file.type!==mime)throw new Error('Pilih gambar JPG, PNG, atau WebP yang valid.');
 return {mime,extension:mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'};
}
export function validateImageDimensions(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>24000000)throw new Error('Resolusi gambar maksimal 24 megapiksel dan sisi terpanjang 12.000 piksel.');
}
