import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { unstable_dev } from 'wrangler';
import { fileURLToPath } from 'node:url';
import { backendRouteAllowed } from '../worker/backend-route-policy.ts';

test('live backend excludes legacy D1 handlers, sample pages and unconfigured integrations',()=>{
 for(const path of ['/','/team','/tool/property-onboarding','/api/analytics','/api/maintenance','/api/communications/hostaway/sync','/api/onboarding/files','/api/mobile/unknown'])assert.equal(backendRouteAllowed(path),false,path);
 for(const path of ['/sign-in','/api/session/password','/api/workspace','/api/mobile/workspace','/api/mobile/reports/export','/api/access'])assert.equal(backendRouteAllowed(path),true,path);
});
test('prepared Worker has no D1, R2, privileged keys or public sample data',async()=>{
 const configPath=fileURLToPath(new URL('../dist/server/wrangler.backend.json',import.meta.url));
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));
 assert.equal(config.name,'recharge-backend');assert.equal(config.vars.BACKEND_ONLY,'true');assert.equal(config.assets.run_worker_first,true);
 for(const key of ['d1_databases','r2_buckets','services','secrets_store_secrets'])assert.equal(config[key],undefined);
 assert.equal(config.vars.SUPABASE_SECRET_KEY,undefined);assert.equal(config.vars.AUTH_RATE_LIMIT_SECRET,undefined);
 process.env.WRANGLER_SEND_METRICS='false';
 const worker=await unstable_dev(fileURLToPath(new URL('../dist/server/index.js',import.meta.url)),{config:configPath,local:true,ip:'127.0.0.1',port:0,persist:false,logLevel:'error',experimental:{disableExperimentalWarning:true,watch:false,disableDevRegistry:true}});
 try{
  const origin=`http://${worker.address}:${worker.port}`;
  for(const path of ['/','/api/maintenance','/api/unknown','/api/onboarding/files']){const response=await worker.fetch(origin+path,{redirect:'manual'});assert.equal(response.status,404,path);assert.equal((await response.json()).error,'This endpoint is not available on the live backend');}
  const health=await worker.fetch(origin+'/health');assert.equal(health.status,503);assert.equal((await health.json()).configured,false);
  const api=await worker.fetch(origin+'/api/mobile/workspace');assert.equal(api.status,503);assert.match(api.headers.get('cache-control'),/no-store/);assert.equal(api.headers.get('access-control-allow-origin'),null);
 }finally{await worker.stop();}
});
