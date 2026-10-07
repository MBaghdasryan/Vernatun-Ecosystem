// Navigation only; the API remains the authority for every read and mutation.
export const communitySections:Record<string,readonly [string,string]>={
 ownership:['ownership.read',''],analytics:['expenses.read','finance'],
 scorecard:['workorders.accept','handover'],budgets:['expenses.read','finance'],
 works:['requests.read','requests'],assets:['assets.read','maintenance'],
 meters:['meters.manage','meters'],announcements:['announcements.read','community'],
 meetings:['meetings.read','community'],documents:['documents.read','documents'],
};
export function canOpenCalendar(c:{role_key:string;permissions:readonly string[];modules?:readonly string[]}){
 return ['manager','dispatcher','technician'].includes(c.role_key)&&
  (!c.modules||c.modules.includes('requests'))&&
  c.permissions.some(p=>p==='requests.read'||p==='workorders.assigned');
}
export function canOpenCommunitySection(
 key:string,
 c:{permissions:readonly string[];modules?:readonly string[]},
){
 const rule=communitySections[key];
 return !!rule&&c.permissions.includes(rule[0])&&(!rule[1]||!c.modules||c.modules.includes(rule[1]));
}
