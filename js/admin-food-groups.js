// Food Groups panel only. Shared editor utilities, RPC wrappers and lifecycle
// safeguards remain controller dependencies; current data is read per render.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    isEditing,
    can,
    field,
    foodCategoriesSorted,
    claimedQuantity,
    foodItemName,
    formActions,
    restoreDraft,
    formFeedback,
    managementRpc,
    reload,
    show,
    cleanSave,
  }) {
    const $ = R.byId;
    function render() {
      const store = getStore();
      let host = $("foodGroupsHost");
      if (!host) {
        host = R.dom("section", {
          id: "foodGroupsHost",
          class: "panel food-management-box",
        });
        $("foodCategoriesHost").before(host);
      }
      host.replaceChildren();
      host.append(
        R.dom(
          "p",
          { class: "micro" },
          T("interface.messages.admin_group_commitment"),
        ),
      );
      const editor = (group) => {
        const details = R.dom("details", {
          class: "admin-management edit-only",
        });
        details.append(
          R.dom(
            "summary",
            {},
            group
              ? T("interface.messages.edit") + " · " + group.name
              : T("interface.messages.add_food_group"),
          ),
        );
        const form = R.dom("form", { class: "form-grid" });
        form.dataset.formKey = "food-group:" + (group?.id || "new");
        const language = window.RSVP_I18N.language || "en";
        const name = field(
          form,
          T("interface.messages.name"),
          language === "en"
            ? group?.name || ""
            : group?.translations?.[language] || group?.name || "",
        );
        name.required = true;
        name.maxLength = 120;
        const category = field(
          form,
          T("interface.messages.category"),
          group?.category || "",
          [
            ["", T("interface.messages.uncategorized")],
            ...foodCategoriesSorted().map((c) => [c.name, c.path || c.name]),
          ],
        );
        const list = R.dom("fieldset", { class: "span-2 food-group-options" });
        list.append(
          R.dom("legend", {}, T("interface.messages.group_items")),
          R.dom("p", { class: "micro" }, T("interface.messages.group_choose")),
        );
        for (const item of store.food.filter(
          (f) => !f.food_group_id || f.food_group_id === group?.id,
        )) {
          const label = R.dom("label", { class: "checkbox-label" }),
            input = R.dom("input", {
              type: "checkbox",
              value: item.id,
              checked: item.food_group_id === group?.id && !!group,
            });
          input.checked = !!group && item.food_group_id === group.id;
          input.disabled = claimedQuantity(item) > 0;
          label.append(input, document.createTextNode(foodItemName(item)));
          list.append(label);
        }
        form.append(list);
        const save = R.dom(
            "button",
            { class: "btn", type: "submit" },
            T("interface.messages.save"),
          ),
          cancel = R.dom(
            "button",
            { class: "btn secondary", type: "button" },
            T("interface.messages.cancel"),
          );
        cancel.dataset.discard = "true";
        formActions(form, save, cancel);
        cancel.addEventListener("click", () => {
          restoreDraft(form);
          details.open = false;
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!isEditing() || !can("food", "edit")) return;
          form.setAttribute("aria-busy", "true");
          form.cleanSaveUpdate();
          formFeedback(form, "saving");
          try {
            await managementRpc("admin_save_food_group", {
              p_id: group?.id || null,
              p_name:
                language === "en"
                  ? name.value.trim()
                  : group?.name || name.value.trim(),
              p_translations: {
                ...group?.translations,
                ...(language === "en" ? {} : { [language]: name.value.trim() }),
              },
              p_category: category.value || null,
              p_item_ids: [...list.querySelectorAll("input:checked")].map(
                (i) => i.value,
              ),
              p_expected_updated: group?.updated_at || null,
            });
            formFeedback(form, "saved");
            await reload();
            show(T("interface.messages.food_group_saved"), "success");
          } catch (error) {
            formFeedback(form, "error", R.safeError(error));
          } finally {
            form.removeAttribute("aria-busy");
            form.cleanSaveUpdate();
          }
        });
        details.append(form);
        cleanSave(form);
        return details;
      };
      for (const group of store.foodGroups || []) {
        const row = R.dom("div", { class: "food-group-admin" });
        row.append(
          R.dom(
            "strong",
            {},
            window.RSVP_I18N.resolve({
              en: group.name,
              ...group.translations,
            }) || group.name,
          ),
          R.dom(
            "p",
            { class: "micro" },
            store.food
              .filter((i) => i.food_group_id === group.id)
              .map(foodItemName)
              .join(" + "),
          ),
        );
        if (can("food", "edit")) {
          row.append(editor(group));
          const remove = R.dom(
            "button",
            { type: "button", class: "text-button edit-only" },
            T("interface.messages.group_delete"),
          );
          remove.addEventListener("click", async () => {
            if (
              !isEditing() ||
              !confirm(T("interface.messages.group_delete_confirm"))
            )
              return;
            remove.disabled = true;
            try {
              await managementRpc("admin_delete_food_group", {
                p_id: group.id,
                p_expected_updated: group.updated_at,
              });
              await reload();
            } catch (error) {
              show(R.safeError(error), "error");
            } finally {
              remove.disabled = false;
            }
          });
          row.append(remove);
        }
        host.append(row);
      }
      let addHost = $("foodAddGroupHost");
      if (!addHost) {
        addHost = R.dom("div", { id: "foodAddGroupHost" });
        $("foodGroupsSection").querySelector(".panel").prepend(addHost);
      }
      addHost.replaceChildren();
      if (can("food", "edit")) addHost.append(editor(null));
    }

    return { render };
  }
  window.RSVP_ADMIN_FOOD_GROUPS = { create };
})();
