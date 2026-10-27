import {supabase,explain} from './data';
import {newId} from './id';
import {validatePdf} from './pdf-validation';
import {validateImageFile} from './image-validation';
export type TeamProfile={user_id:string;name:string;staff_id:string|null;hub:string;role:'admin'|'member'};
export type TeamUser=Omit<TeamProfile,'role'>&{role:'admin'|'member'|'viewer';active:boolean;created_at:string;updated_at:string;login_label:string};
export type TaskStatus='todo'|'in_progress'|'blocked'|'review'|'done';
export type ChecklistItem={id:string;label:string;done:boolean};
export type Task={id:string;title:string;description:string;hub:string;assignee_id:string;assignee_name:string;priority:'low'|'normal'|'high'|'urgent';due_at:string;status:TaskStatus;checklist:ChecklistItem[];progress:number;archived:boolean;created_by:string;created_at:string;updated_at:string};
export type TaskFile={path:string;name:string;size:number};
export type TaskEvent={id:string;task_id:string;actor_id:string;actor_name:string;kind:string;body:string;details:{from_status?:TaskStatus;status?:TaskStatus;from_progress?:number;progress?:number};attachments:TaskFile[];created_at:string};
export type TaskDetail={task:Task;events:TaskEvent[]};
export type TaskFilters={query:string;hub:string;status:string;archived:boolean;mine:boolean;offset:number;limit:number};
export type TaskList={items:Task[];total:number;stats:{total:number;in_progress:number;review:number;done:number;overdue:number}};
export const TASK_STATUSES:Record<TaskStatus,string>={todo:'Belum dikerjakan',in_progress:'Diproses',blocked:'Tertunda',review:'Menunggu verifikasi',done:'Selesai'};
export const TASK_PRIORITIES={low:'Rendah',normal:'Normal',high:'Tinggi',urgent:'Mendesak'};
async function rpc<T>(name:string,args?:Record<string,unknown>):Promise<T>{const {data,error}=await supabase().rpc(name,args);if(error)throw explain(error);return data as T;}
export const listTeamUsers=()=>rpc<TeamUser[]>('hub_portal_team_users');
export const listTasks=(filters:TaskFilters)=>rpc<TaskList>('hub_portal_task_list',{p_filters:filters});
export const getTask=(id:string)=>rpc<TaskDetail>('hub_portal_task_detail',{p_id:id});
export const saveTask=(task:Task,isNew:boolean)=>rpc<Task>('hub_portal_task_save',{p_payload:task,p_new:isNew});
export const saveTaskProgress=(task:Task,status:TaskStatus,checklist:ChecklistItem[],progress:number,note:string)=>rpc<Task>('hub_portal_task_progress',{p_id:task.id,p_expected:task.updated_at,p_status:status,p_checklist:checklist,p_progress:progress,p_note:note});
export const archiveTask=(task:Task,archived:boolean)=>rpc<void>('hub_portal_task_archive',{p_id:task.id,p_expected:task.updated_at,p_archived:archived});
export async function manageTeam(payload:Record<string,unknown>){
 const {data,error}=await supabase().functions.invoke('hub-portal-team',{body:payload});
 if(error){let message='Pengguna belum dapat disimpan. Periksa koneksi lalu coba lagi.';try{if(error.context instanceof Response){const body=await error.context.json();if(typeof body.error==='string')message=body.error;}}catch{}throw new Error(message);}
 if(!data?.ok)throw new Error(data?.error||'Perubahan belum tersimpan.');return data as {ok:boolean;message:string};
}
const filesBucket=()=>supabase().storage.from('hub-portal-task-files');
export async function validateTaskFile(file:File){
 if(file.size>10*1024*1024)throw new Error('Ukuran bukti maksimal 10 MB per file.');
 const header=new Uint8Array(await file.slice(0,5).arrayBuffer());
 if(String.fromCharCode(...header)==='%PDF-'){await validatePdf(file);return {mime:'application/pdf',extension:'pdf'};}
 return validateImageFile(file);
}
export async function addTaskComment(taskId:string,userId:string,body:string,files:File[],onProgress:(message:string)=>void){
 if(files.length>4)throw new Error('Maksimal 4 file bukti per catatan.');
 const uploaded:string[]=[];const attachments:TaskFile[]=[];
 try{
  for(const [index,file] of files.entries()){
   const {mime,extension}=await validateTaskFile(file);const path=`${taskId}/${userId}/${newId()}.${extension}`;
   onProgress(`Mengunggah bukti ${index+1} dari ${files.length}…`);
   const {error}=await filesBucket().upload(path,file,{contentType:mime,upsert:false,cacheControl:'300'});
   if(error)throw new Error('Bukti belum dapat diunggah. Periksa koneksi lalu coba lagi.');
   uploaded.push(path);attachments.push({path,name:file.name.slice(0,180),size:file.size});
  }
  onProgress('Menyimpan catatan…');await rpc<string>('hub_portal_task_comment',{p_id:taskId,p_body:body,p_attachments:attachments});
 }catch(error){if(uploaded.length){try{await filesBucket().remove(uploaded);}catch{}}throw error;}
}
export async function getTaskFileUrl(file:TaskFile){const {data,error}=await filesBucket().createSignedUrl(file.path,60);if(error||!data.signedUrl)throw new Error('Bukti belum dapat dibuka. Periksa akses dan koneksi Anda.');return data.signedUrl;}
