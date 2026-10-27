import type {Category,PortalLink} from './types';
export function menuGroups(links:PortalLink[],category:string,categories:Category[]=[]):string[]{
 const stored=categories.find(c=>c.id===category)?.submenus||[];
 const legacy=['handover','docs'].includes(category)?[]:links.filter(l=>l.category===category).map(l=>l.group);
 const additions=[...new Set(legacy.filter(n=>n&&!stored.includes(n)))].sort((a,b)=>{
  const order=category==='reports'?['Daily','Inbound','Outbound']:[];const ai=order.indexOf(a),bi=order.indexOf(b);
  if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);
  return a.localeCompare(b,'id');
 });
 return [...new Set(stored.filter(Boolean)),...additions];
}
export function groupMenuItems<T>(items:T[],names:string[],getGroup:(item:T)=>string):T[]{
 const positions=new Map(names.map((name,index)=>[name,index]));
 return [...items].sort((a,b)=>(positions.get(getGroup(a))??names.length)-(positions.get(getGroup(b))??names.length));
}
