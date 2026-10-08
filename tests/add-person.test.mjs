import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';

// Adding people from Access control, and the set-password link they open.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {adminActionSchema}=await vite.ssrLoadModule('/lib/workspace-admin-policy.ts');
const {backendRouteAllowed}=await vite.ssrLoadModule('/worker/backend-route-policy.ts');
after(()=>vite.close());
const id='11111111-1111-4111-8111-111111111111';

test('adding a person needs a name, a real email, a role and tools for that role',()=>{
 const ok=adminActionSchema.safeParse({action:'addPerson',fullName:'  Jamie Reid ',email:'Jamie@Example.com',role:'stays',modules:['daily-pricing']});
 assert.ok(ok.success);
 assert.equal(ok.data.email,'jamie@example.com');
 assert.equal(ok.data.fullName,'Jamie Reid');
 assert.ok(adminActionSchema.safeParse({action:'addPerson',fullName:'Ali Admin',email:'ali@example.com',role:'admin',modules:[]}).success,'admins need no tools');
 for(const bad of [
  {action:'addPerson',fullName:'J',email:'j@example.com',role:'stays',modules:['daily-pricing']},
  {action:'addPerson',fullName:'Jamie Reid',email:'not-an-email',role:'stays',modules:['daily-pricing']},
  {action:'addPerson',fullName:'Jamie Reid',email:'j@example.com',role:'owner',modules:['daily-pricing']},
  {action:'addPerson',fullName:'Jamie Reid',email:'j@example.com',role:'stays',modules:[]},
  {action:'addPerson',fullName:'Jamie Reid',email:'j@example.com',role:'cleans',modules:['accounts']},
  {action:'addPerson',fullName:'Jamie Reid',email:'j@example.com',role:'stays',modules:['daily-pricing'],password:'chosen-by-admin'},
  {action:'addPerson',fullName:'Jamie Reid',email:'j@example.com',role:'stays',modules:['daily-pricing'],userId:id},
 ])assert.equal(adminActionSchema.safeParse(bad).success,false,JSON.stringify(bad));
});

test('a set-password link names only the account',()=>{
 assert.ok(adminActionSchema.safeParse({action:'passwordLink',userId:id}).success);
 assert.equal(adminActionSchema.safeParse({action:'passwordLink',userId:'me'}).success,false);
 assert.equal(adminActionSchema.safeParse({action:'passwordLink',userId:id,email:'x@example.com'}).success,false);
});

test('the set-password page is served and the link is only used on a button press',()=>{
 assert.equal(backendRouteAllowed('/auth/set-password'),true);
 assert.equal(backendRouteAllowed('/auth/recovery'),true);
 const route=readFileSync('app/auth/recovery/route.ts','utf8');
 // GET keeps the emailed PKCE code flow; the shared link's code is accepted only by a same-origin POST, as a recovery.
 assert.match(route,/export async function POST[^]*isSameOrigin\(request, config\.origin\)[^]*verifyOtp\(\{ token_hash: token, type: "recovery" \}\)/);
 assert.doesNotMatch(route.slice(0,route.indexOf('export async function POST')),/verifyOtp/);
 const page=readFileSync('app/auth/set-password/set-password-form.tsx','utf8');
 assert.match(page,/onClick=\{\(\) => void start\(\)\}/);
 assert.match(page,/fetch\("\/auth\/recovery", \{ method: "POST"/);
});

test('the server creates accounts as the super admin and never with a chosen password',()=>{
 const server=readFileSync('lib/account-invite-server.ts','utf8');
 assert.match(server,/context\.account\.role !== 'super_admin'/);
 assert.match(server,/createUser\(\{ email: input\.email, email_confirm: true, user_metadata: \{ full_name: input\.fullName \} \}\)/);
 assert.doesNotMatch(server,/password:/);
 // Access is saved through the database as the signed-in super admin, and undone if refused.
 assert.match(server,/context\.client\.rpc\('workspace_admin_action'[^]*deleteUser\(user\.id\)/);
 assert.match(server,/role === 'super_admin'\) return refuse\('Super admins set their own password/);
});
