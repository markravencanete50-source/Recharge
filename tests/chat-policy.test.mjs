import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// What a chat request may carry, and how message times read.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {chatActionSchema,chatReadSchema,chatTime,channelsFirst,conversationSchema,CHANNEL_ORDER}=await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
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

test('team channels: the open request is strict, and channels list first in their own order',()=>{
 assert.ok(chatActionSchema.safeParse({action:'openTeams'}).success);
 assert.ok(!chatActionSchema.safeParse({action:'openTeams',department:'ready'}).success);
 const make=(n,department)=>({id:'22222222-2222-4222-8222-22222222222'+n,kind:'group',department,title:String(n),subtitle:null,propertyId:null,workId:null,propertyName:null,lastMessageAt:'2026-10-10T09:00:00Z',unread:0,last:null});
 const parsed=conversationSchema.parse({...make(1,null),department:undefined});
 assert.equal(parsed.department,null,'an older reply without a department is a normal conversation');
 const list=[make(1,null),make(2,'accounts'),make(3,null),make(4,'all'),make(5,'cleaning')];
 assert.deepEqual(channelsFirst(list).map(c=>c.title),['4','5','2','1','3'],'Everyone, Cleaning, Accounts, then the rest as they were');
 assert.deepEqual([...CHANNEL_ORDER],['all','management','guest_relations','client_relations','cleaning','ready','accounts']);
 assert.ok(!conversationSchema.safeParse(make(1,'finance')).success);
});

test('photos, videos, reactions, groups and profiles: strict requests and their routes', () => {
 assert.ok(chatActionSchema.safeParse({action:'send',requestId:id,conversationId:id,body:'',attachments:[id]}).success,'photos with no words');
 assert.ok(!chatActionSchema.safeParse({action:'send',requestId:id,conversationId:id,body:''}).success,'never nothing');
 assert.ok(!chatActionSchema.safeParse({action:'react',messageId:id,emoji:'🍕'}).success,'only the listed reactions');
 assert.ok(chatActionSchema.safeParse({action:'prepareFiles',conversationId:id,files:[{name:'a.mp4',mime:'video/mp4',bytes:50*1024*1024}]}).success);
 assert.ok(!chatActionSchema.safeParse({action:'prepareFiles',conversationId:id,files:[{name:'a.mp4',mime:'video/mp4',bytes:50*1024*1024+1}]}).success,'50 MB at most');
 assert.ok(!chatActionSchema.safeParse({action:'prepareFiles',conversationId:id,files:[{name:'a.svg',mime:'image/svg+xml',bytes:10}]}).success,'photos and videos only');
 assert.ok(chatActionSchema.safeParse({action:'startGroup',userIds:[id]}).success,'a group needs no name');
 assert.ok(chatActionSchema.safeParse({action:'addMembers',conversationId:id,userIds:[id]}).success);
 assert.ok(chatReadSchema.safeParse({section:'members',conversationId:id}).success);
 for(const path of ['/api/workspace/chat-files','/api/mobile/chat-files','/api/workspace/profile','/api/mobile/profile'])assert.ok(backendRouteAllowed(path),path);
});
