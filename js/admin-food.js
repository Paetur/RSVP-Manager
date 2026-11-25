// Food list presentation. Shared editors and all persistence actions remain
// controller dependencies. Creation state is bridged explicitly, never cached.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    can,
    renderFoodGroups,
    creationState,
    foodCategoryOptions,
    foodCategoriesSorted,
    fillNewFoodTypes,
    foodMenuCategories,
    foodMenuItems,
    setDisclosure,
    claimedQuantity,
    btn,
    rpcAction,
    openFoodChoices,
    foodAccess,
    show,
    iconAction,
    deleteFoodCategory,
    registerFoodCategory,
    foodCategoryEditor,
    addFoodSubcategory,
    footerAction,
    foodItemName,
    foodTypeLabel,
    buildFoodEditor,
    foodClaimName,
    openFoodRecipe,
    foodSelections,
  }) {
    const $ = R.byId;
    const stageStatus = $("adminFoodStageStatus"),
      stageAccess = $("adminFoodAccess"),
      stageOpen = $("adminOpenFoodChoices");
    let openingChoices = false;
    function renderStage(settings) {
      const isOpen = settings?.food_stage === "selection";
      stageStatus.textContent = T(isOpen
        ? "interface.messages.food_stage_selection"
        : "interface.messages.food_stage_interest");
      stageAccess.textContent = T("food.messages.food_access");
      stageAccess.classList.toggle("hidden", !foodAccess.canView());
      stageOpen.textContent = T("interface.messages.food_stage_open");
      stageOpen.classList.toggle("hidden", isOpen || !settings ||
        settings.food_enabled === false || !can("food", "edit"));
      stageOpen.disabled = openingChoices;
    }
    stageAccess.addEventListener("click", () => foodAccess.open(stageAccess));
    stageOpen.addEventListener("click", async () => {
      if (openingChoices || stageOpen.classList.contains("hidden")) return;
      const expectedStage = getStore().settings?.food_stage || "interest";
      openingChoices = stageOpen.disabled = true;
      try {
        const open = await window.RSVP_INLINE.confirm(
          T("interface.messages.food_stage_confirm"),
          { action: "interface.messages.food_stage_open", trigger: stageOpen },
        );
        if (open && can("food", "edit") && getStore().settings?.food_enabled !== false)
          await openFoodChoices(expectedStage);
      } catch (error) {
        show(R.safeError(error), "error");
      } finally {
        openingChoices = false;
        renderStage(getStore().settings);
        if (stageOpen.classList.contains("hidden") && stageStatus.getClientRects().length)
          stageStatus.focus({ preventScroll: true });
      }
    });
    function render() {
      const store = getStore();
      renderStage(store.settings);
      R.closePopups();
      const creation = $("addFoodForm"),
        savedCategory = $("newFoodCategory").value,
        savedVenues = creationState.getCategory()
          ? creationState.readVenues()
          : null;
      $("foodCreateStaging").append(creation);
      renderFoodGroups();
      let archiveToggle = $("foodShowArchived");
      if (!archiveToggle) {
        const label = R.dom("label", {
          class: "checkbox-label archive-toggle",
        });
        archiveToggle = R.dom("input", {
          id: "foodShowArchived",
          type: "checkbox",
        });
        label.append(
          archiveToggle,
          document.createTextNode(
            T("interface.messages.show_archived_records"),
          ),
        );
        $("collapseFood").parentElement.append(label);
        archiveToggle.addEventListener("change", render);
      }
      const box = $("adminFoodList");
      box.replaceChildren();
      const categorySelect = $("newFoodCategory");
      categorySelect.replaceChildren();
      foodCategoryOptions(
        categorySelect,
        savedCategory || foodCategoriesSorted()[0]?.name || "",
      );
      fillNewFoodTypes($("newFoodType").value);
      creationState.renderVenues(savedVenues);
      const search = $("foodSearch")?.value.trim().toLowerCase() || "";
      const categories = foodCategoriesSorted(),
        menu = foodMenuCategories(),
        sections = new Map();
      const parentPicker = $("newCategoryParent"),
        priorParent = parentPicker.value;
      parentPicker.replaceChildren(
        R.dom("option", { value: "" }, T("interface.messages.none_top_level")),
      );
      for (const c of categories.filter((c) => c.depth < 7))
        parentPicker.append(R.dom("option", { value: c.id }, c.path));
      parentPicker.value = [...parentPicker.options].some(
        (o) => o.value === priorParent,
      )
        ? priorParent
        : "";
      const matches = (f) =>
        !search ||
        [
          f.name_en,
          f.category,
          categories.find((c) => c.name === f.category)?.path,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      for (const [index, category] of menu.entries()) {
        const items = foodMenuItems(category.name);
        const visible = items.filter(
          (f) => (archiveToggle.checked || !f.archived_at) && matches(f),
        );
        const descendants = category.id
          ? categories
              .filter((c) =>
                R.foodCategoryWithin(categories, c.id, category.id),
              )
              .map((c) => c.name)
          : [category.name];
        const branchItems = store.food.filter((f) =>
          descendants.includes(f.category || ""),
        );
        if (
          search &&
          !branchItems.some(
            (f) => (archiveToggle.checked || !f.archived_at) && matches(f),
          )
        )
          continue;
        const section = R.dom("details", {
          class: "food-category tree-disclosure",
        });
        section.dataset.treeKey = "food:" + category.name;
        setDisclosure(section, section.dataset.treeKey, index === 0, !!search);
        const heading = R.dom("summary", { class: "food-category-heading" });
        const title = R.dom(
          "span",
          { class: "food-category-title" },
          category.name || T("interface.messages.uncategorized"),
        );
        const childCount = category.id
          ? categories.filter((c) => c.parent_id === category.id).length
          : 0;
        const totals = items.reduce(
          (sum, item) => ({
            claimed: sum.claimed + claimedQuantity(item),
            capacity: sum.capacity + item.quantity_needed,
          }),
          { claimed: 0, capacity: 0 },
        );
        const summary = [];
        if (items.length)
          summary.push(
            T(
              items.length === 1
                ? "interface.messages.1_item"
                : "interface.messages.count_items",
              { count: items.length },
            ),
          );
        if (totals.claimed || totals.capacity)
          summary.push(T("Quantity: {claimed}/{capacity}", totals));
        if (childCount)
          summary.push(
            T(
              childCount === 1
                ? "interface.messages.food_count_subcategory"
                : "interface.messages.food_count_subcategories",
              { count: childCount },
            ),
          );
        heading.append(
          title,
          R.dom("small", { class: "tree-count" }, summary.join(" · ")),
        );
        const controls = R.dom("span", { class: "food-heading-actions" });
        if (category.registered) {
          const siblings = categories.filter(
              (c) => (c.parent_id || null) === (category.parent_id || null),
            ),
            pos = siblings.findIndex((c) => c.id === category.id);
          controls.append(
            btn(
              "↑",
              T("interface.messages.move_category_up"),
              () =>
                rpcAction(
                  "admin_move_food_category",
                  { p_category_id: category.id, p_direction: -1 },
                  T("interface.messages.category_order_saved"),
                ),
              pos <= 0,
            ),
          );
          controls.append(
            btn(
              "↓",
              T("interface.messages.move_category_down"),
              () =>
                rpcAction(
                  "admin_move_food_category",
                  { p_category_id: category.id, p_direction: 1 },
                  T("interface.messages.category_order_saved"),
                ),
              pos >= siblings.length - 1,
            ),
          );
          const add = iconAction(
            "add",
            T("Add item or sub-category"),
            null,
            !can("food", "edit"),
            "edit-only",
          );
          add.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          const choices = R.dom("div", { class: "food-category-add-options" });
          for (const [label, action, disabled] of [
            [
              "Add item",
              () => {
                creationState.setCategory(category.name);
                section.open = true;
                $("newFoodCategory").value = category.name;
                section.querySelector(".food-inline-add-host").append(creation);
                $("newFoodName").focus();
              },
              false,
            ],
            [
              "Add sub-category",
              () => addFoodSubcategory(category),
              (category.depth || 0) >= 7,
            ],
          ]) {
            const option = R.dom(
              "button",
              { type: "button", class: "btn secondary" },
              T(label),
            );
            option.disabled = disabled || !can("food", "edit");
            option.addEventListener("click", () => {
              R.closePopups();
              action();
            });
            choices.append(option);
          }
          controls.append(R.iconPopup(add, choices));
          controls.append(
            iconAction(
              "edit",
              T("food.messages.rename_food_category"),
              () => {
                section.open = true;
                const editor = section.querySelector(
                  ".food-category-name-form",
                );
                editor.classList.toggle("hidden");
                if (!editor.classList.contains("hidden"))
                  editor.querySelector("input").focus();
              },
              false,
              "edit-only",
            ),
          );
          controls.append(
            iconAction(
              "delete",
              T("Delete category"),
              () => deleteFoodCategory(category),
              false,
              "edit-only danger",
            ),
          );
        } else {
          controls.append(
            R.dom(
              "span",
              { class: "tag pending" },
              T("interface.messages.not_registered"),
            ),
          );
          if (category.name)
            controls.append(
              btn(
                T("interface.messages.register_category"),
                T("interface.messages.register_existing_category"),
                () => registerFoodCategory(category, categories.length),
              ),
            );
        }
        heading.append(controls);
        section.append(heading);
        section.dataset.foodCategoryId = category.id || "";
        if (category.registered) {
          const editor = foodCategoryEditor(category);
          section.append(editor);
          footerAction(editor, controls.querySelector("button.danger"));
        }
        const addHost = R.dom("div", { class: "food-inline-add-host" });
        section.append(addHost);
        if (creationState.getCategory() === category.name)
          addHost.append(creation);
        const itemList = R.dom("div", { class: "food-category-items" });
        for (const f of visible) {
          const claims = store.claims.filter((c) => c.food_item_id === f.id);
          const claim = claims.reduce((total, c) => total + c.quantity, 0),
            pos = items.findIndex((x) => x.id === f.id);
          const wrapper = R.dom("details", {
            class: "food-manage-item food-compact-item",
          });
          wrapper.dataset.treeKey = "food:item:" + f.id;
          setDisclosure(wrapper, wrapper.dataset.treeKey, false, !!search);
          const main = R.dom("summary", { class: "food-manage-main" });
          const info = R.dom("div", { class: "food-item-info" });
          const title = R.dom("strong", {}, foodItemName(f));
          title.append(
            R.dom(
              "small",
              { class: "food-item-status muted" },
              " (" +
                T(
                  f.archived_at
                    ? "interface.messages.archived"
                    : !f.active
                      ? "interface.messages.hidden_status"
                      : f.quantity_needed <= claim
                        ? "interface.messages.fully_assigned"
                        : "interface.messages.available",
                ) +
                ")",
            ),
          );
          const identity = R.dom("span", { class: "food-item-title" });
          identity.append(title);
          if (claim || f.quantity_needed)
            identity.append(
              R.dom(
                "small",
                { class: "muted food-quantity-summary" },
                T("interface.messages.quantity_claimed_needed_type", {
                  needed: f.quantity_needed,
                  claimed: claim,
                  type: foodTypeLabel(
                    f.quantity_type || "Piece(s)",
                    f.quantity_needed,
                  ),
                }),
              ),
            );
          info.append(identity);
          const buttons = R.dom("div", { class: "food-item-actions" });
          buttons.append(
            btn(
              "↑",
              T("food.messages.move_food_item_up"),
              () =>
                rpcAction(
                  "admin_move_food_item",
                  { p_food_item_id: f.id, p_direction: -1 },
                  T("food.messages.food_order_saved"),
                ),
              pos <= 0,
            ),
          );
          buttons.append(
            btn(
              "↓",
              T("food.messages.move_food_item_down"),
              () =>
                rpcAction(
                  "admin_move_food_item",
                  { p_food_item_id: f.id, p_direction: 1 },
                  T("food.messages.food_order_saved"),
                ),
              pos === items.length - 1,
            ),
          );
          const edit = buildFoodEditor(f);
          edit.classList.add("edit-only");
          wrapper.addEventListener("toggle", () => {
            if (!wrapper.open) edit.classList.add("hidden");
          });
          buttons.append(
            btn(
              T("interface.messages.edit"),
              T("food.messages.edit_food_item"),
              () => {
                if (!wrapper.open) {
                  wrapper.open = true;
                  edit.classList.remove("hidden");
                } else edit.classList.toggle("hidden");
                if (!edit.classList.contains("hidden"))
                  edit.querySelector("input")?.focus();
              },
            ),
          );
          main.append(info);
          if (claims.length) {
            const commitments = R.dom("small", {
              class: "food-claim-summary muted",
            });
            for (const c of claims)
              commitments.append(
                R.dom("span", {}, foodClaimName(c) + " · " + c.quantity),
              );
            main.append(commitments);
          }
          const detail = R.dom("div", { class: "food-expanded" }),
            comments = R.dom("span", { class: "food-comment-grid" });
          for (const [label, value] of [
            ["Guest", f.description_en],
            ["Admin", f.admin_comment],
          ])
            if (value?.trim())
              comments.append(
                R.dom("span", { class: "small" }, T(label) + ": " + value),
              );
          detail.dataset.hasComments = String(!!comments.children.length);
          if (comments.children.length) {
            main.append(comments);
            requestAnimationFrame(() => {
              const long = [f.description_en, f.admin_comment].some(
                (value) =>
                  value && (value.length > 160 || value.split("\n").length > 2),
              );
              if (!long) return;
              comments.classList.add("comment-preview");
              const more = R.dom(
                "button",
                { type: "button", class: "text-button comment-more" },
                T("Show more"),
              );
              more.setAttribute("aria-expanded", "false");
              more.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const expanded = more.getAttribute("aria-expanded") !== "true";
                more.setAttribute("aria-expanded", String(expanded));
                comments.classList.toggle("comment-preview", !expanded);
                more.textContent = T(expanded ? "Show less" : "Show more");
              });
              main.append(more);
            });
          }
          const links = R.dom("span", { class: "food-item-links" });
          const hasRecipe = !!f.recipe_text?.trim();
          if (hasRecipe || can("food", "edit")) {
            const recipeButton = R.dom(
              "button",
              {
                type: "button",
                class:
                  "text-button food-inline-link" +
                  (hasRecipe ? "" : " edit-only"),
              },
              (hasRecipe ? "" : "+ ") + T("food.messages.recipe"),
            );
            if (hasRecipe) {
              const tick = R.dom("span", { class: "edit-only" }, "✓ ");
              tick.setAttribute("aria-hidden", "true");
              recipeButton.prepend(tick);
            }
            recipeButton.setAttribute("aria-haspopup", "dialog");
            recipeButton.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              openFoodRecipe(f, recipeButton);
            });
            links.append(recipeButton);
          }
          const headerActions = R.dom("span", { class: "food-header-actions" });
          const meta = R.dom("span", { class: "food-header-meta" });
          meta.append(links);
          headerActions.append(buttons, meta);
          info.append(headerActions);
          detail.append(foodSelections(f, claims, claim), edit);
          wrapper.append(main, detail);
          itemList.append(wrapper);
        }
        section.append(itemList);
        const children = R.dom("div", { class: "food-subcategories" });
        section.append(children);
        sections.set(category.id, { section, children });
        const parent = sections.get(category.parent_id);
        (parent ? parent.children : box).append(section);
      }
      if (!box.children.length)
        box.append(
          R.dom(
            "p",
            { class: "muted" },
            T("food.messages.no_matching_food_items"),
          ),
        );
    }

    return { render };
  }
  window.RSVP_ADMIN_FOOD = { create };
})();
