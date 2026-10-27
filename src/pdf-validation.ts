export const FILE_LIMIT=25*1024*1024;
export async function validatePdf(file:File){
 if(!file.name.toLowerCase().endsWith('.pdf')||(file.type&&file.type!=='application/pdf'))throw new Error('Pilih file PDF (.pdf).');
 if(file.size===0||file.size>FILE_LIMIT)throw new Error('Ukuran PDF harus lebih dari 0 dan maksimal 25 MB.');
 if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('Isi file bukan PDF yang valid.');
}
