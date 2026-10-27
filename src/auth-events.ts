// Supabase may emit SIGNED_IN again when returning from a file picker or
// refocusing a tab. Only an actual identity change should reset open editors.
type AuthSession={user:{id:string}}|null;
export function createAuthChangeHandler(callback:(identityChanged:boolean)=>void){
 let previous:string|null|undefined;
 return (event:string,session:AuthSession)=>{
  const next=session?.user.id??null;
  if(event==='INITIAL_SESSION'){if(previous===undefined)previous=next;return;}
  const changed=previous!==next;previous=next;
  if(event==='SIGNED_OUT'||changed)callback(true);
  else if(event!=='TOKEN_REFRESHED')callback(false);
 };
}
