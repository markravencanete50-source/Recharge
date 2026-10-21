import fs from 'node:fs/promises';
// Build output only. No secrets, D1 placeholders, R2 subscriptions or remote bindings.
const source=JSON.parse(await fs.readFile('dist/server/wrangler.json','utf8'));
if(source.main!=='index.js'||!source.compatibility_flags?.includes('nodejs_compat'))throw Error('Unexpected build layout');
const config={name:'recharge-backend',main:'index.js',compatibility_date:source.compatibility_date,compatibility_flags:source.compatibility_flags,no_bundle:true,rules:source.rules,
 assets:{directory:'../client',binding:'ASSETS',run_worker_first:true},
 vars:{BACKEND_ONLY:'true',SUPABASE_URL:'https://brixfalrrmzqoioggvfx.supabase.co'},
 // Workers AI, for guest messages translated into English (lib/guest-translation-server.ts). No key: it is billed to the Cloudflare account.
 ai:{binding:'AI'},
 triggers:{crons:['* * * * *']},
 dev:{ip:'127.0.0.1',local_protocol:'http'},observability:{enabled:true,head_sampling_rate:1}};
// Attach the app to its own address only when asked. The domain's DNS must already be on Cloudflare,
// or the deploy is refused. Example: BACKEND_CUSTOM_DOMAIN=app.rechargegroup.co.uk npm run backend:config
const domain=process.env.BACKEND_CUSTOM_DOMAIN?.trim();
if(domain){
 if(!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain))throw Error('BACKEND_CUSTOM_DOMAIN must be a plain host name such as app.example.com');
 config.routes=[{pattern:domain,custom_domain:true}];
}
await fs.writeFile('dist/server/wrangler.backend.json',JSON.stringify(config,null,2)+'\n');
console.log('Prepared recharge-backend deployment config. Production credentials are intentionally absent.');
