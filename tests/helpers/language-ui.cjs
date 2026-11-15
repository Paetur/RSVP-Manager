const {openBox}=require('./local-edit-ui.cjs');
async function selectContentTranslation(page,category){
 if(await page.locator('#settingsToggle').getAttribute('aria-pressed')==='true')await page.locator('#mainSectionToggle').click();
 await page.locator('[data-tab="language"]').click();
 const group=['food','food-category','food-types'].includes(category)?'food':category;
 await page.locator('#contentTranslationTabs [data-translation-tab="'+group+'"]').click();
 if(group==='food')await page.locator('#foodTranslationTabs [data-translation-tab="'+category+'"]').click();
 const pencil=page.locator('#foodTranslationGrid [data-local-edit]:visible');if(await pencil.count())await pencil.first().click();
}
async function openWordingEditor(page,language,key){
 if(await page.locator('#settingsToggle').getAttribute('aria-pressed')!=='true')await page.locator('#settingsToggle').click();
 await page.locator('[data-settings-tab="languages"]').click();
 await page.locator('#interfaceLanguageTabs [data-translation-tab="'+language+'"]').click();
 const source=await page.evaluate(key=>Object.entries(window.RSVP_I18N.catalog).find(([,entry])=>entry.key===key)[0],key);
 if(!await page.locator('#translationSearch').isVisible())await page.locator('#translationSearchToggle').click();
 await page.locator('#translationSearch').fill(source);
 const row=page.locator('[data-wording-key="'+key+'"]');
 await row.locator('.wording-summary button').click();
 return row;
}
async function openInterfacePreferences(page){if(await page.locator('#settingsToggle').getAttribute('aria-pressed')!=='true')await page.locator('#settingsToggle').click();await page.locator('[data-settings-tab="checklist"]').click();await openBox(page,'personal-preferences');}
async function selectWorkTab(page,name){if(!await page.locator('.admin-main-tabs').isVisible())await page.locator('#mainSectionToggle').click();await page.locator('[data-tab="'+name+'"]').click();}
async function openRecordEditor(scope){const form=scope.locator('form.reading-editor').first();if(!await form.isVisible())await scope.locator('[data-record-pencil]').click();return form;}
module.exports={openRecordEditor,selectContentTranslation,openWordingEditor,openInterfacePreferences,selectWorkTab};
