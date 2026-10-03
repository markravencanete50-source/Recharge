import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { allocateReceipt, autoMatch, canUseOwnerStatements, createOwnerStatement, getOwnerStatementsData, importReceipts, issueOwnerStatement, syncOwnerBookings } from "@/lib/owner-statements";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("sync_hostaway")}), z.object({action:z.literal("auto_match")}),
  z.object({action:z.literal("import_receipts"),rows:z.array(z.object({channel:z.string().min(1).max(80),reference:z.string().min(1).max(160),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amountPence:z.number().int().min(1)})).min(1).max(1000)}),
  z.object({action:z.literal("allocate"),receiptId:z.string().uuid(),bookingId:z.string().uuid(),amountPence:z.number().int().min(1)}),
  z.object({action:z.literal("create_statement"),propertyId:z.string().uuid(),month:z.string().regex(/^\d{4}-\d{2}$/)}), z.object({action:z.literal("issue_statement"),id:z.string().uuid()}),
]);
async function access(){const user=await getChatGPTUser(); if(!user)return null; const profile=await getAccessProfile(user.email,user.displayName); return profile&&canUseOwnerStatements(profile)?profile:null;}
export async function GET(){const profile=await access(); if(!profile)return NextResponse.json({error:"Accounts access required"},{status:403}); return NextResponse.json({data:await getOwnerStatementsData()});}
export async function POST(request:Request){const profile=await access(); if(!profile)return NextResponse.json({error:"Accounts access required"},{status:403}); const parsed=schema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Check the reconciliation details."},{status:400}); try{const input=parsed.data; if(input.action==="sync_hostaway")await syncOwnerBookings(); else if(input.action==="auto_match")await autoMatch(profile); else if(input.action==="import_receipts")await importReceipts(profile,input.rows); else if(input.action==="allocate")await allocateReceipt(profile,input.receiptId,input.bookingId,input.amountPence); else if(input.action==="create_statement")await createOwnerStatement(profile,input.propertyId,input.month); else await issueOwnerStatement(input.id); return NextResponse.json({data:await getOwnerStatementsData()});}catch(error){console.error("Owner statement action failed",error); return NextResponse.json({error:error instanceof Error?error.message:"The update could not be saved."},{status:400});}}
