import type {PortalLink} from './types';
export function menuGroups(links:PortalLink[],category:string):string[]{
 return [...new Set(links.filter(l=>l.category===category).map(l=>l.group).filter(Boolean))].sort((a,b)=>{
  const order=['Daily','Inbound','Outbound'];const ai=order.indexOf(a),bi=order.indexOf(b);
  if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);
  return a.localeCompare(b,'id');
 });
}
