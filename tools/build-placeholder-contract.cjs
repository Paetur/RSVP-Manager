// Generate SQL validation from the same scoped token names used by browser editors.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context={window:{}};vm.runInNewContext(fs.readFileSync('js/text-placeholders.js','utf8'),context);
const P=context.window.RSVP_PLACEHOLDERS, array=names=>'ARRAY['+[...names].map(x=>"'"+x+"'").join(',')+']::text[]';
const sql=`-- BEGIN GENERATED PLACEHOLDER CONTRACT\nCREATE FUNCTION app_private.valid_placeholder_text(value text, scope text DEFAULT 'invitation') RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE names text[]:=CASE scope WHEN 'event' THEN ${array(P.scopeNames('event'))} WHEN 'venue' THEN ${array(P.scopeNames('venue'))} WHEN 'delivery' THEN ${array(P.scopeNames('delivery'))} ELSE ${array(P.names)} END; item text[]; rest text:=coalesce(value,'');
BEGIN
 IF length(rest)>12000 THEN RETURN false;END IF;
 FOR item IN SELECT regexp_matches(rest,'\\{([a-z][a-z0-9_]*)(:([+-][0-9]{1,3}))?\\}','g') LOOP
  IF NOT item[1]=ANY(names) OR (item[3] IS NOT NULL AND (NOT item[1]=ANY(${array(P.dates)}) OR abs(item[3]::integer)>366)) THEN RETURN false;END IF;
 END LOOP;
 RETURN regexp_replace(rest,'\\{([a-z][a-z0-9_]*)(:([+-][0-9]{1,3}))?\\}','','g') !~ '[{}]';
END $$;
REVOKE ALL ON FUNCTION app_private.valid_placeholder_text(text,text) FROM PUBLIC,anon,authenticated,service_role;
-- END GENERATED PLACEHOLDER CONTRACT`;
const file='supabase/migrations/20261114034908_baseline.sql';const source=fs.readFileSync(file,'utf8');const next=/-- BEGIN GENERATED PLACEHOLDER CONTRACT[\s\S]*?-- END GENERATED PLACEHOLDER CONTRACT/.test(source)?source.replace(/-- BEGIN GENERATED PLACEHOLDER CONTRACT[\s\S]*?-- END GENERATED PLACEHOLDER CONTRACT/,()=>sql):source+'\n'+sql+'\n';
if(process.argv.includes('--check'))assert.equal(next,source,'Placeholder SQL contract is stale');else fs.writeFileSync(file,next);
console.log('PASS shared scoped browser/SQL placeholder contract');
