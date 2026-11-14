// Guest event copy editors use Languages permissions and shared translation forms.
(function () {
  "use strict";
  window.RSVP_ADMIN_GUEST_WORDING = {
    create({ ctx, I, T, rpc, renderTranslationRows, translationCard }) {
      const $ = (id) => document.getElementById(id);
      function renderExplanation() {
        const outer = $("foodTranslationGrid"),
          current = ctx.getStore().settings?.food_introduction || {};
        outer.replaceChildren();
        const host = translationCard(
          outer,
          "food-explanation",
          T("Food explanation"),
        );
        host.append(
          ctx.R.dom(
            "p",
            { class: "micro" },
            T(
              "Blank text uses the configured fallback language, then English.",
            ),
          ),
        );
        renderTranslationRows(
          host,
          [["Food explanation", "food-explanation", "textarea"]],
          (_key, language) => current[language] || "",
          async (changes, markSaved) => {
            await rpc("admin_save_food_explanation", {
              p_introduction: {
                ...current,
                ...Object.fromEntries(
                  changes.map((c) => [c.language, c.value]),
                ),
              },
              p_expected: current,
            });
            changes.forEach(markSaved);
          },
          true,
        );
        for (const input of host.querySelectorAll("textarea"))
          input.maxLength = 6000;
      }
      function renderReply() {
        const outer = $("foodTranslationGrid"),
          store = ctx.getStore(),
          records = store.guestFoodReplies || [];
        const values = (key) =>
          Object.fromEntries(
            records
              .filter((r) => r.template_key === key)
              .map((r) => [r.language_code, r.body]),
          );
        const replies = values("food-interest-reply"),
          fallbacks = values("food-interest-reply-no-deadline");
        outer.replaceChildren();
        const host = translationCard(
          outer,
          "food-interest-reply",
          T("Food Interest Reply"),
        );
        host.append(
          ctx.R.dom(
            "p",
            { class: "micro" },
            T(
              "Shown after a saved Yes in Collect interest. Use {invite-deadline:+5} for the RSVP deadline plus five calendar days in the event timezone. Blank text uses the fallback language, then English.",
            ),
          ),
        );
        renderTranslationRows(
          host,
          [
            ["Food Interest Reply", "food-interest-reply", "textarea"],
            [
              "Reply when no deadline is set",
              "food-interest-reply-no-deadline",
              "textarea",
            ],
          ],
          (key, language) =>
            (key === "food-interest-reply" ? replies : fallbacks)[language] ||
            "",
          async (changes, markSaved) => {
            const updated = { ...replies },
              updatedFallbacks = { ...fallbacks };
            for (const c of changes) {
              window.RSVP_FOOD_INTEREST_REPLY.validate(c.value);
              if (
                c.key === "food-interest-reply-no-deadline" &&
                /[{}]/.test(c.value)
              )
                throw Error(T("Invalid food interest reply placeholder"));
              (c.key === "food-interest-reply" ? updated : updatedFallbacks)[
                c.language
              ] = c.value;
            }
            await rpc("admin_save_food_interest_reply", {
              p_values: updated,
              p_fallback_values: updatedFallbacks,
              p_expected: records,
            });
            changes.forEach(markSaved);
          },
          true,
        );
        for (const row of host.querySelectorAll("[data-language-code]")) {
          const inputs = row.querySelectorAll("textarea"),
            code = row.dataset.languageCode;
          window.RSVP_PLACEHOLDER_HELP.attach(inputs[0], {
            R: ctx.R,
            T,
            kind: "food-reply",
          });
          const preview = ctx.R.dom("output", { class: "micro span-2" });
          preview.setAttribute("aria-label", T("Preview"));
          function update() {
            const current = (key) =>
              Object.fromEntries(
                [...host.querySelectorAll("[data-language-code]")].map((r) => [
                  r.dataset.languageCode,
                  r.querySelectorAll("textarea")[key].value,
                ]),
              );
            try {
              const fallback =
                I.resolve(current(1), code) ||
                I.t(
                  "Thank you! We’ll share more information about the food later.",
                  {},
                  code,
                );
              preview.textContent = window.RSVP_FOOD_INTEREST_REPLY.render(
                I.resolve(current(0), code),
                {
                  deadline: store.settings?.rsvp_deadline,
                  timezone: store.settings?.timezone || "UTC",
                  language: code,
                  fallback,
                },
              );
            } catch (_) {
              preview.textContent = T(
                "Invalid food interest reply placeholder",
              );
            }
          }
          for (const input of inputs) {
            input.maxLength = 6000;
            input.addEventListener("input", () =>
              host
                .querySelectorAll("output")
                .forEach((output) => output.updatePreview?.()),
            );
          }
          preview.updatePreview = update;
          row.append(preview);
        }
        host
          .querySelectorAll("output")
          .forEach((output) => output.updatePreview());
        const form = host.querySelector("form"),
          updateSaveState = form.updateSaveState;
        form.updateSaveState = () => {
          updateSaveState();
          host
            .querySelectorAll("output")
            .forEach((output) => output.updatePreview());
        };
      }
      return { renderExplanation, renderReply };
    },
  };
})();
