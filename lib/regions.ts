// Scotland's areas as Recharge groups its portfolio, so counts don't split on spelling.
export const SCOTTISH_REGIONS = [
  'Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness and Highlands', 'Fife', 'Perth and Kinross', 'Stirling and Falkirk',
  'East Lothian', 'Midlothian', 'West Lothian', 'Scottish Borders', 'Ayrshire', 'Dumfries and Galloway', 'Argyll and Bute',
  'Aberdeenshire and Moray', 'Angus', 'Lanarkshire', 'Renfrewshire and Inverclyde', 'Dunbartonshire', 'Scottish islands', 'Outside Scotland',
] as const;
const ALIASES: [RegionMatch, string][] = [
  [/\bleith\b|portobello|musselburgh|edinburgh|balerno|kirkliston/i, 'Edinburgh'], [/glasgow/i, 'Glasgow'], [/aberdeenshire|moray|elgin|huntly|alford|peterhead|buckie|portgordon|cruden bay|ellon|inverurie|stonehaven|banchory|fraserburgh|forres|turriff/i, 'Aberdeenshire and Moray'], [/aberdeen/i, 'Aberdeen'],
  [/dundee/i, 'Dundee'], [/inverness|highland|skye|fort william|aviemore|portree|ullapool|nairn|dingwall|thurso/i, 'Inverness and Highlands'], [/fife|st andrews|kirkcaldy|dunfermline/i, 'Fife'],
  [/perth|kinross|pitlochry/i, 'Perth and Kinross'], [/stirling|falkirk/i, 'Stirling and Falkirk'], [/east lothian|north berwick|\bdunbar\b|haddington|prestonpans|port seton|tranent/i, 'East Lothian'],
  [/midlothian|dalkeith|polton|lasswade|bonnyrigg|penicuik|loanhead/i, 'Midlothian'], [/west lothian|livingston|linlithgow|bathgate|armadale|blackridge|whitburn|broxburn/i, 'West Lothian'], [/borders|peebles|melrose|kelso|hawick|galashiels|selkirk|jedburgh|innerleithen/i, 'Scottish Borders'],
  [/ayr|prestwick|kilmarnock|irvine|troon|largs|saltcoats|ardrossan/i, 'Ayrshire'], [/dumfries|galloway/i, 'Dumfries and Galloway'], [/argyll|oban|bute/i, 'Argyll and Bute'], [/angus|arbroath|montrose/i, 'Angus'],
  [/lanark|hamilton|motherwell|rutherglen|east kilbride|cambuslang|airdrie|coatbridge|wishaw|bellshill/i, 'Lanarkshire'], [/renfrew|paisley|inverclyde|greenock/i, 'Renfrewshire and Inverclyde'], [/dunbarton|clydebank|dumbarton|alexandria|helensburgh|bearsden|milngavie|kirkintilloch|balloch/i, 'Dunbartonshire'],
  [/island|orkney|shetland|lewis|harris|mull|islay|arran/i, 'Scottish islands'],
];
// Leith and Dunbar are whole words only: inside a word they are other places (Innerleithen is in the
// Borders, and "dunbar" starts Dunbartonshire). The database twin is private.workspace_infer_region.
type RegionMatch = RegExp;
// A free-text region (or address) as one of the areas above; blank when nothing matches.
export function normaliseRegion(region: string, address = ''): string {
  const exact = SCOTTISH_REGIONS.find(r => r.toLowerCase() === region.trim().toLowerCase());
  if (exact) return exact;
  for (const text of [region, address]) for (const [pattern, area] of ALIASES) if (pattern.test(text)) return area;
  return region.trim();
}
