// Shared record lifecycle controls. Food/Other inspect current server bindings;
// household/guest/contact actions retain their original guards and RPCs.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    isEditing,
    can,
    iconAction,
    managementRpc,
    reload,
    show,
  }) {
    function lifecycleControls(entity, record, onDone) {
      const store = getStore();
      const section = entity === "food_items" ? "food" : "other";
      if (!can(section, "edit")) return null;
      const host = R.dom("span", { class: "item-lifecycle-actions edit-only" }),
        bound =
          entity === "food_items"
            ? !!record.food_group_id ||
              store.claims.some((c) => c.food_item_id === record.id)
            : !!record.assigned_to?.trim() || record.status !== "open";
      const name =
        record.name_en || record.item || T("interface.messages.item");
      const run = async (button, restore = false) => {
        if (!isEditing()) return;
        button.disabled = true;
        try {
          const info = await managementRpc("admin_item_lifecycle", {
            p_entity: entity,
            p_id: record.id,
            p_action: "inspect",
          });
          if (info.archived && info.bound && !restore)
            throw Error(T("interface.messages.archived_record_linked"));
          const action = restore
            ? "restore"
            : info.bound
              ? "archive"
              : "delete";
          const prompt =
            action === "delete"
              ? T("Permanently delete {name}?", { name })
              : T(
                  action === "archive"
                    ? "Archive this record? It can be restored later."
                    : "Restore this record?",
                );
          if (
            !await window.RSVP_INLINE.confirm((info.bound && action === "archive"
                ? T("interface.messages.archived_record_linked") + "\n"
                : "") + prompt, { action: action === "delete" ? "Delete" : action === "archive" ? "Archive" : "Restore" })
          )
            return;
          await managementRpc("admin_item_lifecycle", {
            p_entity: entity,
            p_id: record.id,
            p_action: action,
            p_expected_updated_at: record.updated_at || info.updated_at,
          });
          onDone?.();
          await reload();
          show(
            T(
              action === "delete"
                ? "interface.messages.record_deleted"
                : action === "archive"
                  ? "interface.messages.record_archived"
                  : "interface.messages.record_restored",
            ),
            "success",
          );
        } catch (error) {
          show(R.safeError(error), "error");
        } finally {
          button.disabled = false;
        }
      };
      const remove = R.dom(
        "button",
        { type: "button", class: "btn secondary" + (bound ? "" : " danger") },
        T(
          bound ? "interface.messages.archive" : "interface.messages.delete",
        ).trim(),
      );
      remove.addEventListener("click", () => run(remove));
      host.append(remove);
      if (record.archived_at) {
        const restore = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T("interface.messages.restore").trim(),
        );
        restore.addEventListener("click", () => run(restore, true));
        host.append(restore);
      }
      return host;
    }

    function archiveButton(entity, record) {
      const restoring = !!record.archived_at;
      return iconAction(
        restoring ? "restore" : "archive",
        T(
          (restoring ? "Restore " : "Archive ") +
            (entity === "households"
              ? "household"
              : entity === "guests"
                ? "guest"
                : "contact"),
        ),
        async () => {
          if (!isEditing()) return;
          const message = restoring
            ? T("interface.messages.restore_this_record")
            : entity === "households"
              ? T(
                  "interface.messages.archive_this_household_and_disable_its_invitation_link_records_an",
                )
              : T(
                  "interface.messages.archive_this_record_it_can_be_restored_later",
                );
          if (!await window.RSVP_INLINE.confirm(message, { action: restoring ? "Restore" : "Archive" })) return;
          await managementRpc("admin_set_archived", {
            p_entity: entity,
            p_id: record.id,
            p_archived: !restoring,
          });
          await reload();
          show(
            restoring
              ? T("interface.messages.record_restored")
              : T("interface.messages.record_archived"),
            "success",
          );
        },
        false,
        "edit-only",
      );
    }
    function deleteRecordButton(entity, record) {
      return iconAction(
        "delete",
        T(
          record.archived_at
            ? entity === "households"
              ? "Delete archived household"
              : "Delete archived guest"
            : entity === "households"
              ? "Delete household"
              : "Delete guest",
        ),
        async () => {
          if (
            !isEditing() ||
            (!record.archived_at && getStore().settings?.is_published)
          )
            return;
          const name =
            entity === "households"
              ? R.householdName(record)
              : [record.first_name, record.last_name].filter(Boolean).join(" ");
          if (!await window.RSVP_INLINE.confirm(T("Permanently delete {name}?", { name }), { action: "Delete" })) return;
          try {
            await managementRpc("admin_delete_archived_record", {
              p_entity: entity,
              p_id: record.id,
            });
          } catch (error) {
            throw new Error(T(R.safeError(error)));
          }
          await reload();
          show(T("Record deleted."), "success");
        },
        false,
        "edit-only danger",
      );
    }

    return { lifecycleControls, archiveButton, deleteRecordButton };
  }
  window.RSVP_ADMIN_LIFECYCLE = { create };
})();
