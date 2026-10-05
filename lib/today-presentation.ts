import { buildAnalytics, type AnalyticsSnapshot, type AnalyticsPeriod } from './analytics';
import { reportPresentation } from './report-presentation';

// Scoped Home analytics palettes. All visual elements follow the selected theme.
export const todayColors = {
  light:{
    heroStart:'#FAF7F0',heroEnd:'#E0E7D9',heroText:'#152D28',heroMuted:'#4E6259',heroBorder:'#CCC8B8',
    trendBg:'#EFE9DB',mint:'#177A41',spark:'#177A41',unfavourable:'#974200',
    ringBg:'#FAF7F0',ringTrack:'#D4DDCF',grid:'#697A6D',gridOpacity:0.35,
    selectionLine:'#4E6259',chipBg:'#E0E7D9',selectedBg:'#D4DDCF',dot:'#152D28',
    waitingBg:'#FFF0D6',waitingBorder:'#F6DCA8',waitingIcon:'#B45309',waitingFill:'#B56800',propertyBg:'#E8EEFF',propertyBorder:'#CBD7FF',propertyIcon:'#3457D5',
  },
  dark:{
    heroStart:'#182C26',heroEnd:'#213A32',heroText:'#FAF7F0',heroMuted:'#C7CBBE',heroBorder:'#345347',
    trendBg:'#0F1E1A',mint:'#86EFAC',spark:'#A7D9C1',unfavourable:'#FFD08A',
    ringBg:'#182C26',ringTrack:'#42564E',grid:'#79998C',gridOpacity:0.4,
    selectionLine:'#C7CBBE',chipBg:'#213A32',selectedBg:'#254538',dot:'#FAF7F0',
    waitingBg:'#3A2A12',waitingBorder:'#FFB54747',waitingIcon:'#FFB547',waitingFill:'#FFB547',propertyBg:'#1F2B55',propertyBorder:'#A9BAFF47',propertyIcon:'#A9BAFF',
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
