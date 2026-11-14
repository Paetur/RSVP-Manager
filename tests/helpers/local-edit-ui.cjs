// Open a specific box; tests never recreate the removed global editing mode.
async function openBox(page, key) {
  const box = page.locator('[data-editor-key="' + key + '"]');
  await page.waitForFunction((key) => {
    const box = [...document.querySelectorAll("[data-editor-key]")].find(
      (n) => n.dataset.editorKey === key,
    );
    return (
      box?.querySelector(":scope > form")?.getAttribute("aria-busy") !== "true"
    );
  }, key);
  if (
    !(await box.evaluate((node) =>
      node.classList.contains("local-editor-open"),
    ))
  )
    await page.locator('[data-local-edit="' + key + '"]').click();
  return box.locator(":scope > form");
}
module.exports = { openBox };
