import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {teamHandler} from './handler.ts';
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const adminKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!adminKey)throw new Error('Server account configuration is missing.');
const service=createClient(Deno.env.get('SUPABASE_URL')!,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
// Gateway JWT verification is disabled because this handler verifies the access
// token with Auth.getUser and checks active admin membership on every request.
Deno.serve(teamHandler(service));
