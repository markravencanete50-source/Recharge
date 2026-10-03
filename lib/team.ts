import { env } from "cloudflare:workers";

export const SCOTLAND_REGIONS = [
  "General",
  "Aberdeen & Aberdeenshire", "Angus & Dundee", "Argyll & Bute", "Ayrshire", "Borders",
  "Dumfries & Galloway", "Edinburgh & Lothians", "Fife", "Glasgow & Clyde", "Highlands & Islands",
  "Lanarkshire", "Moray", "Perth & Kinross", "Stirling & Falkirk",
] as const;

export type TeamCustomRole = { id:string; name:string; description:string; department:string; responsibilities:string[]; regions:string[]; parentRoleId:string|null; memberEmails:string[] };
export type TeamCoverage = { email:string; regions:string[] };
export type TeamScheduleItem = { id:string; department:string; title:string; scheduleDate:string; startTime:string; endTime:string; assignedEmail:string; note:string };
export type TeamDirectoryPerson = { id:string; fullName:string; email:string; department:string; responsibilities:string; status:"active"|"vacancy"; roleIds:string[]; regions:string[] };
export type TeamStructureData = { roles:TeamCustomRole[]; coverage:TeamCoverage[]; regions:readonly string[]; schedules:TeamScheduleItem[]; people:TeamDirectoryPerson[] };
function db(){if(!env.DB)throw new Error("Team database is unavailable");return env.DB;}

export async function getTeamStructure():Promise<TeamStructureData>{
  const database=db();
  const [roles,assignments,coverage,schedules,people]=await Promise.all([
    database.prepare("SELECT id, name, description, department, responsibilities, regions, parent_role_id FROM team_roles ORDER BY department, name COLLATE NOCASE").all<any>(),
    database.prepare("SELECT role_id, email FROM team_role_assignments ORDER BY email").all<any>(),
    database.prepare("SELECT email, region FROM team_coverage_areas ORDER BY email, region").all<any>(),
    database.prepare("SELECT id, department, title, schedule_date, start_time, end_time, assigned_email, note FROM team_department_schedules ORDER BY schedule_date, start_time").all<any>(),
    database.prepare("SELECT id, full_name, email, department, responsibilities, status, role_ids, regions FROM team_directory_people ORDER BY department, status, full_name COLLATE NOCASE").all<any>(),
  ]);
  return {roles:roles.results.map((role:any)=>({id:role.id,name:role.name,description:role.description,department:role.department,responsibilities:parseArray(role.responsibilities),regions:parseArray(role.regions),parentRoleId:role.parent_role_id||null,memberEmails:assignments.results.filter((item:any)=>item.role_id===role.id).map((item:any)=>item.email)})),coverage:Array.from(new Set(coverage.results.map((item:any)=>item.email))).map(email=>({email:String(email),regions:coverage.results.filter((item:any)=>item.email===email).map((item:any)=>item.region)})),regions:SCOTLAND_REGIONS,schedules:schedules.results.map((item:any)=>({id:item.id,department:item.department,title:item.title,scheduleDate:item.schedule_date,startTime:item.start_time,endTime:item.end_time,assignedEmail:item.assigned_email,note:item.note})),people:people.results.map((item:any)=>({id:item.id,fullName:item.full_name,email:item.email||"",department:item.department,responsibilities:item.responsibilities||"",status:item.status==="vacancy"?"vacancy":"active",roleIds:parseArray(item.role_ids),regions:parseArray(item.regions)}))};
}

function parseArray(value:string){try{const parsed=JSON.parse(value||"[]");return Array.isArray(parsed)?parsed.map(String):[];}catch{return [];}}

export async function saveTeamRole(input:{id?:string;name:string;description:string;department:string;responsibilities:string[];regions:string[];parentRoleId?:string|null}){
  const database=db(); const now=Math.floor(Date.now()/1000); const id=input.id||crypto.randomUUID();
  await database.prepare("INSERT INTO team_roles (id, name, description, department, responsibilities, regions, parent_role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, department=excluded.department, responsibilities=excluded.responsibilities, regions=excluded.regions, parent_role_id=excluded.parent_role_id, updated_at=excluded.updated_at").bind(id,input.name.trim(),input.description.trim(),input.department,JSON.stringify(input.responsibilities),JSON.stringify(input.regions.length?input.regions:["General"]),input.parentRoleId||null,now,now).run();
}

export async function saveTeamSchedule(profileEmail:string,input:{department:string;title:string;scheduleDate:string;startTime:string;endTime:string;assignedEmail:string;note:string}){const database=db();const now=Math.floor(Date.now()/1000);await database.prepare("INSERT INTO team_department_schedules (id, department, title, schedule_date, start_time, end_time, assigned_email, note, created_by_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(),input.department,input.title.trim(),input.scheduleDate,input.startTime,input.endTime,input.assignedEmail.trim().toLowerCase(),input.note.trim(),profileEmail,now,now).run();}

export async function removeTeamSchedule(id:string){await db().prepare("DELETE FROM team_department_schedules WHERE id=?").bind(id).run();}

export async function saveTeamPerson(input:{id?:string;fullName:string;email?:string;department:string;responsibilities:string;status:"active"|"vacancy";roleIds:string[];regions:string[]}){
  const database=db();const now=Math.floor(Date.now()/1000);const id=input.id||crypto.randomUUID();
  await database.prepare("INSERT INTO team_directory_people (id, full_name, email, department, responsibilities, status, role_ids, regions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, email=excluded.email, department=excluded.department, responsibilities=excluded.responsibilities, status=excluded.status, role_ids=excluded.role_ids, regions=excluded.regions, updated_at=excluded.updated_at").bind(id,input.fullName.trim(),(input.email||"").trim().toLowerCase(),input.department,input.responsibilities.trim(),input.status,JSON.stringify(input.roleIds),JSON.stringify(input.regions),now,now).run();
}

export async function removeTeamPerson(id:string){await db().prepare("DELETE FROM team_directory_people WHERE id=?").bind(id).run();}

export async function saveTeamAssignments(emailInput:string,roleIds:string[],regions:string[]){
  const database=db(); const email=emailInput.trim().toLowerCase(); const now=Math.floor(Date.now()/1000);
  await database.batch([database.prepare("DELETE FROM team_role_assignments WHERE email=?").bind(email),database.prepare("DELETE FROM team_coverage_areas WHERE email=?").bind(email),...roleIds.map(id=>database.prepare("INSERT INTO team_role_assignments (role_id,email,created_at) VALUES (?,?,?)").bind(id,email,now)),...regions.map(region=>database.prepare("INSERT INTO team_coverage_areas (email,region,created_at) VALUES (?,?,?)").bind(email,region,now))]);
}

export async function removeTeamRole(id:string){const database=db();await database.batch([database.prepare("DELETE FROM team_role_assignments WHERE role_id=?").bind(id),database.prepare("DELETE FROM team_roles WHERE id=?").bind(id)]);}
