-- Region from address, made sturdier (the same rule as lib/regions.ts, which holds the name lists).
-- Before this the first rule to match anywhere won, and names matched inside words: "dunbar" (East Lothian)
-- matched inside Dunbartonshire, so an address in West or East Dunbartonshire was filed as East Lothian;
-- "leith" matched inside Innerleithen; and a street named after a town beat the real town ("Huntly Terrace,
-- Paisley" was Aberdeenshire and Moray). Now:
--   * every name matches as whole words only (\y is a word boundary in PostgreSQL);
--   * council and county names (kind 1) win over towns and other places (kind 2);
--   * within a kind, the name furthest to the right wins (street, then town, then council); at the same
--     spot the longer name, then the earlier area.
-- Only the function changes. The trigger still fills a blank region and never replaces a set one, and no
-- stored region is touched here: properties already filed wrongly are listed in docs/notes-session-B.md for a
-- person to decide. Safe to run more than once.
create or replace function private.workspace_infer_region(address text) returns text
language sql immutable set search_path = '' as $$
 select coalesce((
  select r.area
  from (values
  (1, 1, 'Edinburgh', 'city of edinburgh'),
  (1, 2, 'Glasgow', 'glasgow city'),
  (1, 3, 'Aberdeenshire and Moray', 'aberdeenshire|morayshire|banffshire|kincardineshire'),
  (1, 4, 'Aberdeen', 'aberdeen city|city of aberdeen'),
  (1, 5, 'Dundee', 'dundee city|city of dundee'),
  (1, 6, 'Inverness and Highlands', 'highland council|inverness-shire|ross-shire|nairnshire'),
  (1, 7, 'Fife', 'fife council|kingdom of fife'),
  (1, 8, 'Perth and Kinross', 'perth and kinross|perthshire|kinross-shire'),
  (1, 9, 'Stirling and Falkirk', 'stirlingshire|clackmannanshire'),
  (1, 10, 'East Lothian', 'east lothian'),
  (1, 11, 'Midlothian', 'midlothian|mid lothian'),
  (1, 12, 'West Lothian', 'west lothian'),
  (1, 13, 'Scottish Borders', 'scottish borders|berwickshire|roxburghshire|peeblesshire|selkirkshire'),
  (1, 14, 'Ayrshire', 'ayrshire'),
  (1, 15, 'Dumfries and Galloway', 'dumfries and galloway|dumfriesshire|kirkcudbrightshire|wigtownshire'),
  (1, 16, 'Argyll and Bute', 'argyll and bute|argyllshire|buteshire'),
  (1, 17, 'Angus', 'angus council|forfarshire'),
  (1, 18, 'Lanarkshire', 'lanarkshire'),
  (1, 19, 'Renfrewshire and Inverclyde', 'renfrewshire|inverclyde'),
  (1, 20, 'Dunbartonshire', 'dunbartonshire|dumbartonshire'),
  (1, 21, 'Scottish islands', 'orkney islands|shetland islands|na h-eileanan siar|western isles'),
  (2, 1, 'Edinburgh', 'edinburgh|leith|portobello|musselburgh|balerno|kirkliston'),
  (2, 2, 'Glasgow', 'glasgow'),
  (2, 3, 'Aberdeenshire and Moray', 'moray|elgin|huntly|alford|peterhead|buckie|portgordon|cruden bay|ellon|inverurie|stonehaven|banchory|fraserburgh|forres|turriff'),
  (2, 4, 'Aberdeen', 'aberdeen'),
  (2, 5, 'Dundee', 'dundee'),
  (2, 6, 'Inverness and Highlands', 'inverness|highland|highlands|skye|fort william|aviemore|portree|ullapool|nairn|dingwall|thurso'),
  (2, 7, 'Fife', 'fife|st andrews|kirkcaldy|dunfermline'),
  (2, 8, 'Perth and Kinross', 'perth|kinross|pitlochry'),
  (2, 9, 'Stirling and Falkirk', 'stirling|falkirk|alloa'),
  (2, 10, 'East Lothian', 'north berwick|dunbar|haddington|prestonpans|port seton|tranent'),
  (2, 11, 'Midlothian', 'dalkeith|polton|lasswade|bonnyrigg|penicuik|loanhead'),
  (2, 12, 'West Lothian', 'livingston|linlithgow|bathgate|armadale|blackridge|whitburn|broxburn'),
  (2, 13, 'Scottish Borders', 'borders|peebles|melrose|kelso|hawick|galashiels|selkirk|jedburgh|innerleithen'),
  (2, 14, 'Ayrshire', 'ayr|prestwick|kilmarnock|irvine|troon|largs|saltcoats|ardrossan'),
  (2, 15, 'Dumfries and Galloway', 'dumfries|galloway'),
  (2, 16, 'Argyll and Bute', 'argyll|oban|bute'),
  (2, 17, 'Angus', 'angus|arbroath|montrose'),
  (2, 18, 'Lanarkshire', 'lanark|hamilton|motherwell|rutherglen|east kilbride|cambuslang|airdrie|coatbridge|wishaw|bellshill'),
  (2, 19, 'Renfrewshire and Inverclyde', 'renfrew|paisley|greenock'),
  (2, 20, 'Dunbartonshire', 'dunbarton|dumbarton|clydebank|alexandria|helensburgh|bearsden|milngavie|kirkintilloch|balloch'),
  (2, 21, 'Scottish islands', 'island|islands|orkney|shetland|lewis|harris|mull|islay|arran|hebrides|stornoway')
  ) as r(kind, ord, area, names)
  cross join lateral (select regexp_match(coalesce(address, ''), '^(.*)\y(' || r.names || ')\y', 'i') as m) as x
  where x.m is not null
  order by r.kind, length(x.m[1]) desc, length(x.m[2]) desc, r.ord
  limit 1), '')
$$;
revoke all on function private.workspace_infer_region(text) from public, anon, authenticated;
