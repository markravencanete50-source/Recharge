import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Team beta onboarding: with owner accounts switched off, the team takes a property from enquiry to
// inspection on the owner's behalf. A property with an owner account keeps its owner-only steps.
const db=new PGlite();
const users=['31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000004'];
const roles=['super_admin','stays','client','stays'];
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 const id=users[i],session=id.replace('31000000','41000000');
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`team-onboarding${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,id]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session,id]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[id,roles[i]]);
 for(const m of ['property-onboarding','client-dashboard','new-property-inspection-board'])await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing',[id,m]);
}
// The owner above was let in before the beta started; from now on no owner can be.
await db.query('update private.workspace_beta_mode set team_only=true');
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:users[i].replace('31000000','41000000')})]);await db.exec('set role authenticated');}
const action=async input=>(await db.query('select public.workspace_journey_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const read=async id=>(await db.query('select public.workspace_journey_read($1) result',[id||null])).rows[0].result;
const enquiry={action:'createEnquiry',name:'Holmhead flat',address:'2 Holmhead Place, Glasgow',propertyType:'Flat',bedrooms:2,bathrooms:1};
const contact={contactName:'Morag Example',email:'morag@example.com',phone:'07700 900123',companyName:'',existingClient:false,wcs:2,parking:'Free on street',garden:'Shared',photoLink:'https://photos.example.com/album'};
const form={businessName:'Morag Example',bankAccountName:'M Example',bankAccountNumber:'12345678',bankSortCode:'12-34-56',accessDate:'2026-10-01',accessInfo:'Keybox by the door, code given by phone',utilitiesConnected:true,prepaymentMeters:false,broadbandConnected:true,hasGarden:false,mailPreference:'photograph',warrantyDetails:'',preferredRepairContact:'',repairLimitMinor:20000,fullRepairPermission:false,furnishingChoice:'self',licensingRequired:false,gasElectricMeters:'Both connected, smart meters',operatingStatus:'Two bookings in November'};
let j;
after(()=>db.close());

test('the team starts an enquiry without an owner account, with the enquirer\'s details',async()=>{
 await as(0);
 await assert.rejects(action({...enquiry,enquiry:{phone:'07700 900123'}}),/contact's name and an email or phone/);
 await assert.rejects(action({...enquiry,enquiry:{contactName:'Morag'}}),/contact's name and an email or phone/);
 await assert.rejects(action({...enquiry,enquiry:{...contact,email:'not-an-email'}}),/valid email/);
 await assert.rejects(action({...enquiry,enquiry:{...contact,photoLink:'http://insecure.example.com'}}),/https/);
 await assert.rejects(action({...enquiry,enquiry:{...contact,unexpected:'x'}}),/./);
 j=await action({...enquiry,enquiry:contact});
 assert.equal(j.stage,'enquiry');assert.equal(j.clientId,null);assert.equal(j.ownerAccount,false);
 assert.equal(j.enquiry.contactName,'Morag Example');assert.equal(j.enquiry.wcs,2);assert.equal(j.enquiry.existingClient,false);
 assert.equal('companyName' in j.enquiry,false,'blank answers are left out');
 await db.exec('reset role');
 assert.equal((await db.query("select region from public.workspace_properties where id=$1",[j.propertyId])).rows[0].region,'Glasgow','the area comes from the address');
 assert.equal((await db.query("select count(*)::int n from public.workspace_property_assignments where property_id=$1 and assignment='client'",[j.propertyId])).rows[0].n,0);
});

test('a Stays team member can start one too; the onboarding team shares it, owners never see it',async()=>{
 await as(1);const mine=await action({...enquiry,name:'Stays enquiry',enquiry:{contactName:'Ali Example',phone:'+44 7700 900456'}});
 assert.equal((await read(mine.propertyId)).length,1);
 await as(3);assert.equal((await read(mine.propertyId)).length,1,'the rest of the onboarding team is added');
 await as(2);assert.deepEqual(await read(mine.propertyId),[],'an owner never sees a property that is not theirs');
});

test('the team records the owner\'s steps, then the invoice handled outside the app',async()=>{
 await as(0);
 j=await action({action:'publishEstimate',propertyId:j.propertyId,version:j.version,lowRateMinor:9000,mediumRateMinor:11000,highRateMinor:14000,comparables:[]});
 await as(2);await assert.rejects(action({action:'decideEstimate',propertyId:j.propertyId,version:j.version,decision:'proceed'}),/Owner estimate decision required|access denied/);
 await as(0);j=await action({action:'decideEstimate',propertyId:j.propertyId,version:j.version,decision:'proceed'});assert.equal(j.stage,'agreement');
 j=await action({action:'publishAgreement',propertyId:j.propertyId,version:j.version,agreement:'Management agreement signed on paper, kept on file.'});
 j=await action({action:'signAgreement',propertyId:j.propertyId,version:j.version,agreementRevision:j.agreementRevision,signedName:'Morag Example',consent:true});
 assert.equal(j.stage,'form');
 await db.exec('reset role');
 assert.equal((await db.query("select count(*)::int n from private.workspace_domain_details d join public.workspace_work_items w on w.id=d.work_id where w.property_id=$1 and d.kind='onboarding_invoice'",[j.propertyId])).rows[0].n,0,'no in-app invoice task without an owner to send it to');
 await as(0);
 await assert.rejects(action({action:'submitForm',propertyId:j.propertyId,version:j.version,form:{...form,gasElectricMeters:5}}),/Invalid onboarding/);
 j=await action({action:'submitForm',propertyId:j.propertyId,version:j.version,form});
 assert.equal(j.stage,'invoice');assert.equal(j.form.gasElectricMeters,'Both connected, smart meters');assert.equal(j.form.operatingStatus,'Two bookings in November');
 assert.equal(j.form.bankAccountNumber,undefined,'bank details never come back in the journey');
 await db.exec('reset role');
 const bank=(await db.query('select owner_id,account_number from private.workspace_bank_details where property_id=$1',[j.propertyId])).rows[0];
 assert.equal(bank.owner_id,null);assert.equal(bank.account_number,'12345678');
 await as(1);await assert.rejects(action({action:'recordInvoiceOutside',propertyId:j.propertyId,version:j.version,note:'Xero INV-1'}),/./,'only an administrator records the invoice');
 await as(0);await assert.rejects(action({action:'bookInspection',propertyId:j.propertyId,version:j.version,inspectionOn:'2026-10-02'}),/Paid invoice/);
 j=await action({action:'recordInvoiceOutside',propertyId:j.propertyId,version:j.version,note:'Xero INV-0123, paid'});
 assert.equal(j.stage,'inspection_to_book');assert.ok(j.invoiceOutsideAt);assert.equal(j.invoiceOutsideNote,'Xero INV-0123, paid');
 await assert.rejects(action({action:'recordInvoiceOutside',propertyId:j.propertyId,version:j.version,note:'again'}),/without an owner account/);
 j=await action({action:'bookInspection',propertyId:j.propertyId,version:j.version,inspectionOn:'2026-10-02'});
 assert.equal(j.stage,'inspection_booked');
});

test('a property with an owner account keeps the owner-only steps',async()=>{
 await db.exec('reset role');await db.query('update private.workspace_beta_mode set team_only=false');
 await as(2);let own=await action({...enquiry,name:'Owner flat'});
 assert.equal(own.ownerAccount,true);
 await as(0);own=await action({action:'publishEstimate',propertyId:own.propertyId,version:own.version,lowRateMinor:9000,mediumRateMinor:11000,highRateMinor:14000,comparables:[]});
 await assert.rejects(action({action:'decideEstimate',propertyId:own.propertyId,version:own.version,decision:'proceed'}),/Owner estimate decision required/);
 await assert.rejects(action({action:'recordInvoiceOutside',propertyId:own.propertyId,version:own.version,note:'Xero INV-2'}),/without an owner account/);
 await as(2);own=await action({action:'decideEstimate',propertyId:own.propertyId,version:own.version,decision:'proceed'});
 assert.equal(own.stage,'agreement');
});
