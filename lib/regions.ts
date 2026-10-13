// Scotland's areas as Recharge groups its portfolio, so counts don't split on spelling.
export const SCOTTISH_REGIONS = [
  'Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness and Highlands', 'Fife', 'Perth and Kinross', 'Stirling and Falkirk',
  'East Lothian', 'Midlothian', 'West Lothian', 'Scottish Borders', 'Ayrshire', 'Dumfries and Galloway', 'Argyll and Bute',
  'Aberdeenshire and Moray', 'Angus', 'Lanarkshire', 'Renfrewshire and Inverclyde', 'Dunbartonshire', 'Scottish islands', 'Outside Scotland',
] as const;

// The names that place an address in an area. `councils` are council and county names that only ever mean
// that area ("West Dunbartonshire", "Perthshire"); `places` are towns, districts and short names that can
// also be a street ("Huntly Terrace, Paisley", "Moray Place, Edinburgh"). Every name matches as whole words
// only, so "dunbar" is not found inside "Dunbartonshire" and "leith" not inside "Innerleithen".
// Rule (regionFromText): a council name wins over any place; among names of the same kind, the one furthest
// to the right wins, because an address runs street, town, council; at the same spot the longer name wins,
// then the earlier area in this list. The database twin is private.workspace_infer_region (migration
// 20261014200000_region_whole_words.sql); tests/property-region-database.test.mjs checks they agree.
export type RegionRule = { area: (typeof SCOTTISH_REGIONS)[number]; councils: readonly string[]; places: readonly string[] };
export const REGION_RULES: readonly RegionRule[] = [
  { area: 'Edinburgh', councils: ['city of edinburgh'], places: ['edinburgh', 'leith', 'portobello', 'musselburgh', 'balerno', 'kirkliston'] },
  { area: 'Glasgow', councils: ['glasgow city'], places: ['glasgow'] },
  { area: 'Aberdeenshire and Moray', councils: ['aberdeenshire', 'morayshire', 'banffshire', 'kincardineshire'], places: ['moray', 'elgin', 'huntly', 'alford', 'peterhead', 'buckie', 'portgordon', 'cruden bay', 'ellon', 'inverurie', 'stonehaven', 'banchory', 'fraserburgh', 'forres', 'turriff'] },
  { area: 'Aberdeen', councils: ['aberdeen city', 'city of aberdeen'], places: ['aberdeen'] },
  { area: 'Dundee', councils: ['dundee city', 'city of dundee'], places: ['dundee'] },
  { area: 'Inverness and Highlands', councils: ['highland council', 'inverness-shire', 'ross-shire', 'nairnshire'], places: ['inverness', 'highland', 'highlands', 'skye', 'fort william', 'aviemore', 'portree', 'ullapool', 'nairn', 'dingwall', 'thurso'] },
  { area: 'Fife', councils: ['fife council', 'kingdom of fife'], places: ['fife', 'st andrews', 'kirkcaldy', 'dunfermline'] },
  { area: 'Perth and Kinross', councils: ['perth and kinross', 'perthshire', 'kinross-shire'], places: ['perth', 'kinross', 'pitlochry'] },
  { area: 'Stirling and Falkirk', councils: ['stirlingshire', 'clackmannanshire'], places: ['stirling', 'falkirk', 'alloa'] },
  { area: 'East Lothian', councils: ['east lothian'], places: ['north berwick', 'dunbar', 'haddington', 'prestonpans', 'port seton', 'tranent'] },
  { area: 'Midlothian', councils: ['midlothian', 'mid lothian'], places: ['dalkeith', 'polton', 'lasswade', 'bonnyrigg', 'penicuik', 'loanhead'] },
  { area: 'West Lothian', councils: ['west lothian'], places: ['livingston', 'linlithgow', 'bathgate', 'armadale', 'blackridge', 'whitburn', 'broxburn'] },
  { area: 'Scottish Borders', councils: ['scottish borders', 'berwickshire', 'roxburghshire', 'peeblesshire', 'selkirkshire'], places: ['borders', 'peebles', 'melrose', 'kelso', 'hawick', 'galashiels', 'selkirk', 'jedburgh', 'innerleithen'] },
  { area: 'Ayrshire', councils: ['ayrshire'], places: ['ayr', 'prestwick', 'kilmarnock', 'irvine', 'troon', 'largs', 'saltcoats', 'ardrossan'] },
  { area: 'Dumfries and Galloway', councils: ['dumfries and galloway', 'dumfriesshire', 'kirkcudbrightshire', 'wigtownshire'], places: ['dumfries', 'galloway'] },
  { area: 'Argyll and Bute', councils: ['argyll and bute', 'argyllshire', 'buteshire'], places: ['argyll', 'oban', 'bute'] },
  { area: 'Angus', councils: ['angus council', 'forfarshire'], places: ['angus', 'arbroath', 'montrose'] },
  { area: 'Lanarkshire', councils: ['lanarkshire'], places: ['lanark', 'hamilton', 'motherwell', 'rutherglen', 'east kilbride', 'cambuslang', 'airdrie', 'coatbridge', 'wishaw', 'bellshill'] },
  { area: 'Renfrewshire and Inverclyde', councils: ['renfrewshire', 'inverclyde'], places: ['renfrew', 'paisley', 'greenock'] },
  { area: 'Dunbartonshire', councils: ['dunbartonshire', 'dumbartonshire'], places: ['dunbarton', 'dumbarton', 'clydebank', 'alexandria', 'helensburgh', 'bearsden', 'milngavie', 'kirkintilloch', 'balloch'] },
  { area: 'Scottish islands', councils: ['orkney islands', 'shetland islands', 'na h-eileanan siar', 'western isles'], places: ['island', 'islands', 'orkney', 'shetland', 'lewis', 'harris', 'mull', 'islay', 'arran', 'hebrides', 'stornoway'] },
];

// One pattern per area and kind: "^(everything before)(the last whole-word name)". Greedy, so the first group
// is as long as it can be and the second is the right-most name.
const lastName = (names: readonly string[]) => new RegExp('^([\\s\\S]*)\\b(' + names.join('|') + ')\\b', 'i');
const PATTERNS = REGION_RULES.map((rule, order) => ({ area: rule.area, order, councils: lastName(rule.councils), places: lastName(rule.places) }));

// The area an address (or a typed region) points to, or '' when no name in it is known.
export function regionFromText(text: string): string {
  for (const kind of ['councils', 'places'] as const) {
    let best: { area: string; at: number; length: number; order: number } | null = null;
    for (const p of PATTERNS) {
      const m = p[kind].exec(text);
      if (!m) continue;
      const hit = { area: p.area, at: m[1].length, length: m[2].length, order: p.order };
      if (!best || hit.at > best.at || (hit.at === best.at && (hit.length > best.length || (hit.length === best.length && hit.order < best.order)))) best = hit;
    }
    if (best) return best.area;
  }
  return '';
}

// A free-text region (or address) as one of the areas above; blank when nothing matches.
export function normaliseRegion(region: string, address = ''): string {
  const exact = SCOTTISH_REGIONS.find(r => r.toLowerCase() === region.trim().toLowerCase());
  if (exact) return exact;
  for (const text of [region, address]) { const area = regionFromText(text); if (area) return area; }
  return region.trim();
}
