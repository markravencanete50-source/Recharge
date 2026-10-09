-- A property with no area gets one from its address (the same rules as lib/regions.ts, first match
-- wins), so properties arriving from the channel manager are counted by area without anyone
-- typing it in. A region someone has set is never replaced. An address that matches nothing stays blank.
create or replace function private.workspace_infer_region(address text) returns text
language sql immutable set search_path = '' as $$
 select case
  when address ~* 'leith|portobello|musselburgh|edinburgh|balerno|kirkliston' then 'Edinburgh'
  when address ~* 'glasgow' then 'Glasgow'
  when address ~* 'aberdeenshire|moray|elgin|huntly|alford|peterhead|buckie|portgordon|cruden bay|ellon|inverurie|stonehaven|banchory|fraserburgh|forres|turriff' then 'Aberdeenshire and Moray'
  when address ~* 'aberdeen' then 'Aberdeen'
  when address ~* 'dundee' then 'Dundee'
  when address ~* 'inverness|highland|skye|fort william|aviemore|portree|ullapool|nairn|dingwall|thurso' then 'Inverness and Highlands'
  when address ~* 'fife|st andrews|kirkcaldy|dunfermline' then 'Fife'
  when address ~* 'perth|kinross|pitlochry' then 'Perth and Kinross'
  when address ~* 'stirling|falkirk' then 'Stirling and Falkirk'
  when address ~* 'east lothian|north berwick|dunbar|haddington|prestonpans|port seton|tranent' then 'East Lothian'
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

create or replace function private.workspace_property_region_default() returns trigger
language plpgsql set search_path = '' as $$
begin
 if btrim(coalesce(new.region, '')) = '' then new.region := private.workspace_infer_region(coalesce(new.address, '')); end if;
 return new;
end $$;
revoke all on function private.workspace_infer_region(text), private.workspace_property_region_default() from public, anon, authenticated;

drop trigger if exists workspace_property_region_default on public.workspace_properties;
create trigger workspace_property_region_default before insert or update of address, region on public.workspace_properties
 for each row execute function private.workspace_property_region_default();

-- Properties already here with no area.
update public.workspace_properties set region = private.workspace_infer_region(address) where btrim(coalesce(region, '')) = '';
