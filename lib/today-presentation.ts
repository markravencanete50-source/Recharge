import { buildAnalytics, type AnalyticsSnapshot, type AnalyticsPeriod } from './analytics';
import { reportPresentation } from './report-presentation';

// Scoped to the Today analytics card and its two tiles, not the app palette.
export const todayColors = {
  heroStart:'#2440B8',heroEnd:'#5B4BDB',mint:'#86EFAC',spark:'#7DD3FC',unfavourable:'#FFD08A',
  light:{waitingBg:'#FFF0D6',waitingBorder:'#F6DCA8',waitingIcon:'#B45309',waitingFill:'#B56800',propertyBg:'#E8EEFF',propertyBorder:'#CBD7FF',propertyIcon:'#3457D5'},
  dark:{waitingBg:'#3A2A12',waitingBorder:'#FFB54747',waitingIcon:'#FFB547',waitingFill:'#FFB547',propertyBg:'#1F2B55',propertyBorder:'#A9BAFF47',propertyIcon:'#A9BAFF'},
};

export function todayPresentation(snapshot:AnalyticsSnapshot,period:AnalyticsPeriod) {
  const current=buildAnalytics(snapshot,period);
  const end=Date.parse(period.to+'T00:00:00Z');
  const week=reportPresentation(snapshot,{from:new Date(end-6*86400000).toISOString().slice(0,10),to:period.to});
  const open=current.total-current.complete;
  const weekOpen=week.current.total-week.current.complete,previousOpen=week.previous.total-week.previous.complete;
  const change=weekOpen-previousOpen;
  return {current,open,waiting:current.waiting,properties:current.properties,
    percent:current.total?Math.round(current.complete/current.total*100):0,
    waitingShare:open?Math.min(1,current.waiting/open):0,
    available:week.available,partial:week.partial,
    // These are cohorts by record date and CURRENT status, not historic backlog.
    days:week.days.map(day=>({date:day.key,value:day.value-day.completed})),
    change,good:change<=0,direction:change<0?'down' as const:change>0?'up' as const:'same' as const,
    changeLabel:!week.available?'Data unavailable':change===0?'Same as last week':`${Math.abs(change)} ${change<0?'fewer':'more'} than last week`,
  };
}
