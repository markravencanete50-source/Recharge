import { buildAnalytics, type AnalyticsSnapshot, type AnalyticsPeriod } from './analytics';
import { reportPresentation } from './report-presentation';

// Scoped Home analytics palettes. All visual elements follow the selected theme.
export const todayColors = {
  // The Home hero is a deep forest panel in both themes, echoing the green
  // header; tiles use the same earthy family as the departments.
  light:{
    heroStart:'#1F3D38',heroEnd:'#2B5448',heroText:'#FAF7F0',heroMuted:'#D3E0D8',heroBorder:'#3E6658',
    trendBg:'#183530',mint:'#A7D9C1',spark:'#A7D9C1',unfavourable:'#F3C27A',
    ringBg:'#183530',ringTrack:'#3B5C52',grid:'#79998C',gridOpacity:0.45,
    selectionLine:'#D3E0D8',chipBg:'#25483F',selectedBg:'#335E52',dot:'#FAF7F0',
    waitingBg:'#F3E7CF',waitingBorder:'#E3CFA6',waitingIcon:'#875A1C',waitingFill:'#9A6418',propertyBg:'#DCEAE4',propertyBorder:'#BFD6CC',propertyIcon:'#1F5F55',
  },
  dark:{
    heroStart:'#1B3E38',heroEnd:'#24503F',heroText:'#FAF7F0',heroMuted:'#D3E0D8',heroBorder:'#3E6658',
    trendBg:'#132C27',mint:'#A7D9C1',spark:'#A7D9C1',unfavourable:'#FFD08A',
    ringBg:'#132C27',ringTrack:'#3B5C52',grid:'#79998C',gridOpacity:0.45,
    selectionLine:'#D3E0D8',chipBg:'#22463D',selectedBg:'#2E5A4E',dot:'#FAF7F0',
    waitingBg:'#3A2C15',waitingBorder:'#E8C27D47',waitingIcon:'#E8C27D',waitingFill:'#E8C27D',propertyBg:'#173A33',propertyBorder:'#8FD3C247',propertyIcon:'#8FD3C2',
  },
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
