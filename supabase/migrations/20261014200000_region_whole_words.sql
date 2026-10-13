-- Region from address: Leith and Dunbar match whole words only (the same change as lib/regions.ts).
-- Before this, "dunbar" matched inside Dunbartonshire, so an address in West or East Dunbartonshire was
-- filed as East Lothian, and "leith" matched inside Innerleithen, so that Borders town was filed as
-- Edinburgh. Only the function changes: the trigger still fills a blank region and never replaces a set
-- one, and no stored region is touched here (properties already filed wrongly are listed in
-- docs/notes-session-B.md for a person to decide). \y is a word boundary in PostgreSQL's regular expressions.
create or replace function private.workspace_infer_region(address text) returns text
language sql immutable set search_path = '' as $$
 select case
  when address ~* '\yleith\y|portobello|musselburgh|edinburgh|balerno|kirkliston' then 'Edinburgh'
  when address ~* 'glasgow' then 'Glasgow'
  when address ~* 'aberdeenshire|moray|elgin|huntly|alford|peterhead|buckie|portgordon|cruden bay|ellon|inverurie|stonehaven|banchory|fraserburgh|forres|turriff' then 'Aberdeenshire and Moray'
  when address ~* 'aberdeen' then 'Aberdeen'
  when address ~* 'dundee' then 'Dundee'
  when address ~* 'inverness|highland|skye|fort william|aviemore|portree|ullapool|nairn|dingwall|thurso' then 'Inverness and Highlands'
  when address ~* 'fife|st andrews|kirkcaldy|dunfermline' then 'Fife'
  when address ~* 'perth|kinross|pitlochry' then 'Perth and Kinross'
  when address ~* 'stirling|falkirk' then 'Stirling and Falkirk'
  when address ~* 'east lothian|north berwick|\ydunbar\y|haddington|prestonpans|port seton|tranent' then 'East Lothian'
  when address ~* 'midlothian|dalkeith|polton|lasswade|bonnyrigg|penicuik|loanhead' then 'Midlothian'
  when address ~* 'west lothian|livingston|linlithgow|bathgate|armadale|blackridge|whitburn|broxburn' then 'West Lothian'
  when address ~* 'borders|peebles|melrose|kelso|hawick|galashiels|selkirk|jedburgh|innerleithen' then 'Scottish Borders'
  when address ~* 'ayr|prestwick|kilmarnock|irvine|troon|largs|saltcoats|ardrossan' then 'Ayrshire'
  when address ~* 'dumfries|galloway' then 'Dumfries and Galloway'
  when address ~* 'argyll|oban|bute' then 'Argyll and Bute'
  when address ~* 'angus|arbroath|montrose' then 'Angus'
  when address ~* 'lanark|hamilton|motherwell|rutherglen|east kilbride|cambuslang|airdrie|coatbridge|wishaw|bellshill' then 'Lanarkshire'
  when address ~* 'renfrew|paisley|inverclyde|greenock' then 'Renfrewshire and Inverclyde'
  when address ~* 'dunbarton|clydebank|dumbarton|alexandria|helensburgh|bearsden|milngavie|kirkintilloch|balloch' then 'Dunbartonshire'
  when address ~* 'island|orkney|shetland|lewis|harris|mull|islay|arran' then 'Scottish islands'
  else ''
 end
$$;
revoke all on function private.workspace_infer_region(text) from public, anon, authenticated;
