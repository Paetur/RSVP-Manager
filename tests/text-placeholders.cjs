const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const context = { window: { RSVP: { invitationURL: c => "https://example.test/?"+c, timeOptions: () => ({hourCycle:"h23"}) }, RSVP_I18N: { t: s => s } }, Intl, Date };
vm.runInNewContext(fs.readFileSync("js/household-name.js","utf8"), context);
vm.runInNewContext(fs.readFileSync("js/text-placeholders.js","utf8"), context);
const P = context.window.RSVP_PLACEHOLDERS;
const h={id:"h",household_name:"Example household",language:"de",invite_code:"ABCDEFGH"};
const store={settings:{event_name:"Example event",event_date:"2027-06-20",event_time:"14:30",timezone:"Europe/Berlin",organizer_name:"Example organizers",organizer_email:"organizer@example.test",organizer_phone:"+00 123456789",rsvp_deadline:"2027-03-27T23:30:00Z",food_deadline:"2027-06-17T16:00:00Z",food_stage:"selection",is_published:false},guests:[{id:"a",household_id:"h",first_name:"Alex"},{id:"b",household_id:"h",first_name:"Sam"}],locations:[{id:"v",name:"Garden",address:"Sample street",map_url:"https://example.test/map",timezone:"Europe/Berlin"}],sessions:[{id:"s1",name:"Lunch",location_id:"v",is_active:true,requires_rsvp:true,starts_at:"2027-06-20T12:00:00Z",ends_at:"2027-06-20T14:00:00Z"},{id:"s2",name:"Dinner",location_id:"v",is_active:true,requires_rsvp:true,starts_at:"2027-06-20T16:00:00Z"}],defaults:[{household_id:"h",session_id:"s1",is_invited:true},{household_id:"h",session_id:"s2",is_invited:true}],responses:[{guest_id:"a",session_id:"s1",rsvp_status:"attending"}],content:[{content_key:"session:s1:name",language_code:"de",content_value:"Mittagessen"}]};
const c=P.context(store,{household:h,language:"de",sessionId:"s1"});
assert.equal(c.values.guest_count,"2");assert.equal(c.values.session_name,"Mittagessen");assert.equal(c.values.session_start,"14:00");assert.equal(c.values.unanswered_guest_count,"2");assert.equal(c.values.event_time,"14:30");
assert.equal(P.fill("{rsvp_deadline:+5}",c.values,{...c.options,language:"en"}),"2 April 2027","offset is calendar days in event timezone across DST");
assert.equal(P.fill("{event_date}",c.values,{...c.options,language:"en"}),"20 June 2027");
assert.equal(P.context(store,{household:h}).values.session_name,null,"multiple invited sessions need explicit context");
assert.equal(P.fill("{session_name}",P.context(store,{household:h}).values),"{session_name}");
assert.equal(P.fill("{invitation_link}",c.values),"{invitation_link}","unpublished links remain unresolved");
store.settings.is_published=true;assert.match(P.context(store,{household:h}).values.invitation_link,/ABCDEFGH/);
assert.equal(P.context(store,{household:h,sessionId:"not-invited"}).values.session_name,null);
assert.equal(P.context(store,{household:h,sessionId:"s1",venueId:"other"}).values.session_name,null);
for(const token of P.tokens())assert.equal(P.validate(token),token);
assert.ok(P.tokens("delivery").includes("{contact_salutation}"));
assert.equal(P.fill("Dear {contact_salutation}", { contact_salutation: "Mom" }, { scope: "delivery" }), "Dear Mom");
for (const scope of [undefined, "event", "venue"]) {
  assert.ok(!P.tokens(scope).includes("{contact_salutation}"));
  assert.throws(() => P.validate("{contact_salutation}", scope));
}
for(const text of ["{invite-deadline}","{unknown}","{rsvp_deadline:+367}","{event_name:+1}","{rsvp_deadline:5}"])assert.throws(()=>P.validate(text));
assert.throws(()=>P.validate("{guest_names}","event"));
const empty=P.context({settings:{}},{});assert.equal(P.fill("{organizer_email}",empty.values),"{organizer_email}");
assert.equal(P.fill("{guest_count}",{guest_count:0}),"0");
console.log("PASS scoped placeholders: complete registry, DST/date/time/list localization, explicit session context, unpublished/missing values, old spelling rejection and zero-value preservation.");
