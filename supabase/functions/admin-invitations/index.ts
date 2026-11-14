import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { invitationHandler } from "./handler.mjs";
Deno.serve(
  invitationHandler({
    createClient,
    origin: Deno.env.get("RSVP_SITE_ORIGIN"),
    siteUrl: Deno.env.get("RSVP_SITE_URL"),
    url: Deno.env.get("SUPABASE_URL"),
    serviceKey:
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Object.values(
        JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"),
      )[0],
  }),
);
