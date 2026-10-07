import fs from 'node:fs/promises';
// Build output only. No secrets, D1 placeholders, R2 subscriptions or remote bindings.
const source=JSON.parse(await fs.readFile('dist/server/wrangler.json','utf8'));
if(source.main!=='index.js'||!source.compatibility_flags?.includes('nodejs_compat'))throw Error('Unexpected build layout');
const config={name:'recharge-backend',main:'index.js',compatibility_date:source.compatibility_date,compatibility_flags:source.compatibility_flags,no_bundle:true,rules:source.rules,
 assets:{directory:'../client',binding:'ASSETS',run_worker_first:true},
 vars:{BACKEND_ONLY:'true',SUPABASE_URL:'https://brixfalrrmzqoioggvfx.supabase.co'},
 triggers:{crons:['*/15 * * * *']},
 dev:{ip:'127.0.0.1',local_protocol:'http'},observability:{enabled:true,head_sampling_rate:0.1}};
await fs.writeFile('dist/server/wrangler.backend.json',JSON.stringify(config,null,2)+'\n');
console.log('Prepared recharge-backend deployment config. Production credentials are intentionally absent.');
