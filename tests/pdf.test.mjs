import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePdf,FILE_LIMIT} from '../src/pdf-validation.ts';
test('PDF validation rejects renamed HTML, wrong MIME, empty and oversized files',async()=>{
 await validatePdf(new File(['%PDF-1.7\nfixture'],'sop.pdf',{type:'application/pdf'}));
 await assert.rejects(()=>validatePdf(new File(['<html>not a pdf</html>'],'sop.pdf',{type:'application/pdf'})),/bukan PDF/);
 await assert.rejects(()=>validatePdf(new File(['%PDF-1.7'],'sop.txt',{type:'text/plain'})),/Pilih file/);
 await assert.rejects(()=>validatePdf(new File([],'empty.pdf',{type:'application/pdf'})),/Ukuran/);
 await assert.rejects(()=>validatePdf(new File([new Uint8Array(FILE_LIMIT+1)],'large.pdf',{type:'application/pdf'})),/maksimal 25 MB/);
});
