import { isWorkspaceAdmin } from "@/lib/modules";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { getTeamStructure, removeTeamPerson, removeTeamRole, removeTeamSchedule, saveTeamAssignments, saveTeamPerson, saveTeamRole, saveTeamSchedule, SCOTLAND_REGIONS } from "@/lib/team";

const department=z.enum(["leadership","stays","cleans","ready","marketing","accounts"]);
const action=z.discriminatedUnion("action",[
  z.object({action:z.literal("save_role"),id:z.string().uuid().optional(),name:z.string().trim().min(2).max(80),description:z.string().trim().max(500),department,responsibilities:z.array(z.string().trim().min(1).max(240)).max(30),regions:z.array(z.enum(SCOTLAND_REGIONS)).max(SCOTLAND_REGIONS.length),parentRoleId:z.union([z.string().uuid(),z.literal("")]).optional()}),
  z.object({action:z.literal("remove_role"),id:z.string().uuid()}),
  z.object({action:z.literal("save_assignments"),email:z.string().email(),roleIds:z.array(z.string().uuid()).max(30),regions:z.array(z.enum(SCOTLAND_REGIONS)).max(SCOTLAND_REGIONS.length)}),
  z.object({action:z.literal("save_person"),id:z.string().uuid().optional(),fullName:z.string().trim().max(120),email:z.union([z.string().email(),z.literal("")]).optional(),department,responsibilities:z.string().trim().max(2000),status:z.enum(["active","vacancy"]),roleIds:z.array(z.string().uuid()).max(30),regions:z.array(z.enum(SCOTLAND_REGIONS)).max(SCOTLAND_REGIONS.length)}),
  z.object({action:z.literal("remove_person"),id:z.string().uuid()}),
  z.object({action:z.literal("save_schedule"),department,title:z.string().trim().min(2).max(120),scheduleDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startTime:z.string().regex(/^\d{2}:\d{2}$/),endTime:z.string().regex(/^\d{2}:\d{2}$/),assignedEmail:z.string().trim().max(160),note:z.string().trim().max(1000)}),
  z.object({action:z.literal("remove_schedule"),id:z.string().uuid()}),
]);
async function actor(){const user=await getChatGPTUser();if(!user)return null;return getAccessProfile(user.email,user.displayName);}
export async function GET(){const profile=await actor();if(!profile||profile.role==="client")return NextResponse.json({error:"Team access required"},{status:403});try{return NextResponse.json({data:await getTeamStructure()});}catch(error){console.error("Team structure load failed",error);return NextResponse.json({error:"Team roles could not be loaded"},{status:500});}}
export async function POST(request:Request){const profile=await actor();if(!profile||!isWorkspaceAdmin(profile.role))return NextResponse.json({error:"Admin access required"},{status:403});const parsed=action.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||"Check the team details"},{status:400});try{const input=parsed.data;if(input.action==="save_person"&&input.status==="active"&&input.fullName.length<2)return NextResponse.json({error:"Enter the team member's name"},{status:400});if(input.action==="save_role")await saveTeamRole(input);else if(input.action==="remove_role")await removeTeamRole(input.id);else if(input.action==="save_assignments")await saveTeamAssignments(input.email,input.roleIds,input.regions);else if(input.action==="save_person")await saveTeamPerson(input);else if(input.action==="remove_person")await removeTeamPerson(input.id);else if(input.action==="save_schedule")await saveTeamSchedule(profile.email,input);else await removeTeamSchedule(input.id);return NextResponse.json({data:await getTeamStructure()});}catch(error){console.error("Team structure update failed",error);return NextResponse.json({error:error instanceof Error?error.message:"The team update could not be saved"},{status:400});}}
