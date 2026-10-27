import type {Category,PortalLink} from './types';
export function menuGroups(links:PortalLink[],category:string,categories:Category[]=[]):string[]{
 const stored=categories.find(c=>c.id===category)?.submenus||[];
 const legacy=['handover','docs'].includes(category)?[]:links.filter(l=>l.category===category).map(l=>l.group);
 return [...new Set([...stored,...legacy].filter(Boolean))].sort((a,b)=>{
  const order=['Daily','Inbound','Outbound'];const ai=order.indexOf(a),bi=order.indexOf(b);
  if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);
  return a.localeCompare(b,'id');
 });
}
