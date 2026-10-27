import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateImageFile,validateImageDimensions,MAX_IMAGE_BYTES} from '../src/image-validation.ts';
const file=(bytes,type='')=>new File([new Uint8Array(bytes)],'gambar.png',{type});
test('image uploads recognize JPG, PNG and WebP signatures instead of trusting file names',async()=>{
 assert.equal((await validateImageFile(file([137,80,78,71,13,10,26,10],'image/png'))).extension,'png');
 assert.equal((await validateImageFile(file([255,216,255,224],'image/jpeg'))).extension,'jpg');
 assert.equal((await validateImageFile(new File(['RIFF1234WEBPVP8 '],'gambar.webp',{type:'image/webp'}))).extension,'webp');
 await assert.rejects(()=>validateImageFile(new File(['<svg onload="alert(1)"/>'],'gambar.png',{type:'image/png'})),/JPG, PNG/);
 await assert.rejects(()=>validateImageFile(file([137,80,78,71,13,10,26,10],'image/jpeg')),/valid/);
});
test('image limits reject empty files, oversized payloads and excessive dimensions',async()=>{
 await assert.rejects(()=>validateImageFile(file([])),/kosong/);
 await assert.rejects(()=>validateImageFile({size:MAX_IMAGE_BYTES+1,type:'image/png',slice(){throw new Error('must not read oversized file');}}),/5 MB/);
 validateImageDimensions(6000,4000);assert.throws(()=>validateImageDimensions(6001,4000),/24 megapiksel/);assert.throws(()=>validateImageDimensions(12001,1),/12.000/);assert.throws(()=>validateImageDimensions(0,100),/Resolusi/);
});
