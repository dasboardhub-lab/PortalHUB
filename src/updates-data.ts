import {supabase,explain} from './data';
export type PortalUpdate={id:string;title:string;body:string;kind:'info'|'important'|'maintenance'|'update';status:'draft'|'published'|'archived';source:'manual'|'system';category_id:string|null;url:string;pinned:boolean;published_at:string|null;created_at:string;updated_at:string};
export type UpdateResult={items:PortalUpdate[];total:number};
export type UpdateFilters={limit?:number;offset?:number;status?:PortalUpdate['status'];source?:'all'|'manual'|'system';query?:string};
export async function listUpdates(filters:UpdateFilters={}):Promise<UpdateResult>{
 const {data,error}=await supabase().rpc('hub_portal_update_list',{p_limit:filters.limit??20,p_offset:filters.offset??0,p_status:filters.status??'published',p_source:filters.source??'all',p_query:(filters.query||'').trim().slice(0,150)});
 if(error)throw explain(error);return data;
}
export async function saveUpdate(row:PortalUpdate,isNew:boolean):Promise<PortalUpdate>{
 const {data,error}=await supabase().rpc('hub_portal_update_save',{payload:{id:row.id,title:row.title,body:row.body,kind:row.kind,status:row.status,category_id:row.category_id,url:row.url,pinned:row.pinned},is_new:isNew,expected_updated_at:row.updated_at||null});
 if(error)throw explain(error);if(!data?.ok)throw new Error('Informasi belum dapat disimpan.');return data.item;
}
export function onUpdateChange(callback:()=>void){
 const db=supabase();const channel=db.channel('portal-public-updates').on('postgres_changes',{event:'*',schema:'public',table:'hub_portal_updates'},callback).subscribe();
 return()=>{void db.removeChannel(channel);};
}
export function updateShareText(item:Pick<PortalUpdate,'title'|'body'|'url'>,portalUrl:string){return `*${item.title}*\n\n${item.body}${item.url?`\n\nTautan terkait: ${item.url}`:''}\n\nBuka Portal HUB: ${portalUrl}`;}
