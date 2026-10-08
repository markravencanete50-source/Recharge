import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// The exact requests the app sends must pass the server's checks, not only the database's.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {operationsActionSchema}=await vite.ssrLoadModule('/lib/operations-policy.ts');
after(()=>vite.close());
const id=()=>crypto.randomUUID();

test('a clean submitted with photos of the post passes the server check',()=>{
 const base={action:'updateOperation',requestId:id(),workId:id(),version:3,step:'submitCleaning'};
 const data={checks:['Kitchen','Wi-Fi and broadband working'],report:'Kitchen cleaned, router checked.',photoIds:[id()],mailAction:'photograph',mailNote:'Two letters',mailPhotoIds:[id(),id()]};
 assert.ok(operationsActionSchema.safeParse({...base,data}).success);
 assert.ok(operationsActionSchema.safeParse({...base,data:{...data,mailPhotoIds:undefined}}).success,'without post photos');
 assert.equal(operationsActionSchema.safeParse({...base,data:{...data,mailPhotoIds:[]}}).success,false,'an empty list is not sent');
 assert.equal(operationsActionSchema.safeParse({...base,data:{...data,mailPhotoIds:['not-an-id']}}).success,false);
});
