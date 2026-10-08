import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// What a chat request may carry, and how message times read.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {chatActionSchema,chatReadSchema,chatTime}=await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const {backendRouteAllowed}=await vite.ssrLoadModule('/worker/backend-route-policy.ts');
after(()=>vite.close());
const id='11111111-1111-4111-8111-111111111111';

test('chat requests are strict',()=>{
 assert.ok(chatReadSchema.safeParse({section:'messages',conversationId:id}).success);
 assert.ok(!chatReadSchema.safeParse({section:'messages'}).success,'a conversation is required');
 assert.ok(chatReadSchema.safeParse({section:'clientRelations',from:'2026-10-01',to:'2026-10-08'}).success);
 assert.ok(chatActionSchema.safeParse({action:'send',requestId:id,conversationId:id,body:'Hello'}).success);
 assert.ok(!chatActionSchema.safeParse({action:'send',requestId:id,conversationId:id,body:'   '}).success,'no empty messages');
 assert.ok(!chatActionSchema.safeParse({action:'send',requestId:id,conversationId:id,body:'x'.repeat(4001)}).success);
 assert.ok(!chatActionSchema.safeParse({action:'startGroup',title:'Team',userIds:[]}).success,'a group needs people');
 assert.ok(!chatActionSchema.safeParse({action:'startDirect',userId:id,extra:true}).success,'no unexpected fields');
 for(const path of ['/api/workspace/chat','/api/mobile/chat','/api/workspace/notifications'])assert.ok(backendRouteAllowed(path),path);
});

test('message times read naturally in UK time',()=>{
 const now=new Date('2026-10-08T15:00:00Z');
 assert.equal(chatTime('2026-10-08T13:05:00Z',now),'14:05');
 assert.equal(chatTime('2026-10-06T13:05:00Z',now),'Tue');
 assert.equal(chatTime('2026-09-20T13:05:00Z',now),'20 Sept');
});
