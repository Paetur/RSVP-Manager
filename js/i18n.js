(function(){
  'use strict';
  let languages=[{language_code:'fo',display_name:'Føroyskt'},{language_code:'en',display_name:'English'},{language_code:'de',display_name:'Deutsch'}];
  let defaultLanguage='en',fallbackLanguage='en',remote=Object.create(null),loaded=null;
  const validCode=code=>typeof code==='string'&&/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)&&code.length<=16;
  const enabled=code=>languages.some(l=>l.language_code===code);
  const key='rsvp-interface-language',catalog=window.RSVP_TRANSLATIONS||{};
  const overrides=Object.create(null),textNodes=[],attributes=[],dirtyForms=new Set();
  const localeBase=new URL('../locales/',document.currentScript.src);
  const localeVersion=window.RSVP_LOCALE_CONTRACT?.catalog_version||'unversioned';
  const localeCache=new Map(),localeValues=new Map();
  const sourceByKey=new Map(Object.entries(catalog).map(([source,entry])=>[entry.key,source]));
  function flattenLocale(value,prefix='',result=Object.create(null)){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid locale catalog');
    for(const [key,child] of Object.entries(value)){
      if(['__proto__','constructor','prototype'].includes(key)||key.includes('.'))throw Error('Invalid locale key');
      const path=prefix?prefix+'.'+key:key;
      if(typeof child==='string')result[path]=child;
      else flattenLocale(child,path,result);
    }
    return result;
  }
  async function fetchCategory(code,category,id){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch(new URL(id+'.json?v='+localeVersion,localeBase),{
        cache:'default',signal:controller.signal
      });
      if(response.status===404)return;
      if(!response.ok)throw Error('Locale unavailable');
      const values=flattenLocale(await response.json());
      for(const [key,value] of Object.entries(values)){
        const source=sourceByKey.get(category+'.'+key);
        if(!source||!value.trim()||!validOverride(source,value))delete values[key];
      }
      localeValues.set(id,values);
    }catch(_){
      // Transient failures can be retried. Missing custom-language files use English.
      localeCache.delete(id);
    }finally{
      clearTimeout(timeout);
    }
  }
  function loadCategory(code,category){
    if(!validCode(code)||!['interface','food','types'].includes(category))return Promise.resolve();
    const id=code+'/'+category;
    if(!localeCache.has(id))localeCache.set(id,fetchCategory(code,category,id));
    return localeCache.get(id);
  }
  function loadCatalogs(codes=[language,fallbackLanguage,'en']){
    return Promise.all([...new Set(codes)].flatMap(code=>['interface','food','types'].map(category=>loadCategory(code,category))));
  }
  function bundled(source,code){
    const path=catalog[source]?.key;
    if(!path)return code==='en'?source:null;
    const [category,...parts]=path.split('.');
    const value=localeValues.get(code+'/'+category)?.[parts.join('.')];
    return value||(code==='en'?source:null);
  }
  let language='en',preference=false,languageReloadApproved=false;
  try{const saved=localStorage.getItem(key);if(validCode(saved)){language=saved;preference=true;}}catch(_){}
  const placeholders=s=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]).sort().join(',');
  function validOverride(source,value){return typeof value==='string'&&value.length<=12000&&placeholders(source)===placeholders(value);}
  for(const [source,values] of Object.entries(window.RSVP_INTERFACE_OVERRIDES||{})){
    if(!Object.hasOwn(catalog,source)||!values||typeof values!=='object')continue;
    overrides[source]=Object.fromEntries(Object.entries(values).filter(([lang,value])=>validCode(lang)&&validOverride(source,value)&&value.trim()));
  }
  function t(source,params={},lang=language){
    source=sourceByKey.get(source)||sourceByKey.get(window.RSVP_UNIT_KEYS?.[source])||source;
    let value=source;for(const code of [...new Set([lang,fallbackLanguage,'en'])]){const candidate=overrides[source]?.[code]||remote[source]?.[code]||bundled(source,code);if(candidate){value=candidate;break;}}
    return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(match,name)=>Object.hasOwn(params,name)?String(params[name]):match);
  }
  function paint(){
    document.documentElement.lang=language;
    for(const [node,source,before,after] of textNodes)if(node.isConnected)node.nodeValue=before+t(source)+after;
    for(const [node,name,source] of attributes)if(node.isConnected)node.setAttribute(name,t(source));
    const select=document.getElementById('interfaceLanguage');if(select){select.value=language;select.setAttribute('aria-label',t('Interface language'));}const button=document.getElementById('languageToggle');if(button){button.title=t('Interface language');button.setAttribute('aria-label',t('Interface language'));}const caption=document.getElementById('languageMenuLabel')?.firstChild;if(caption?.nodeType===Node.TEXT_NODE)caption.nodeValue=t('Interface language');
  }
  function setLanguage(next,save=true){
    if(!enabled(next))next=defaultLanguage;
    language=next;if(save){preference=true;try{localStorage.setItem(key,next);}catch(_){}}
    paint();
    const selected=language;return loadCatalogs().then(()=>{if(language===selected){paint();document.dispatchEvent(new Event('rsvp:locale-ready'));}});
  }
  async function confirmLanguageReload(ignoredForm=null){
    const unsaved=[...dirtyForms].some(form=>{
      if(!form.isConnected||form===ignoredForm)return false;
      if(form.id==='personalPreferencesForm')return window.RSVP_ADMIN_PREFERENCES?.hasUnsaved()||false;
      if(!form.cleanSaveUpdate)return true;
      return [...form.querySelectorAll('input,select,textarea')].some(control=>(control.type==='checkbox'?String(control.checked):control.value)!==control.dataset.cleanOriginal);
    })||window.RSVP_ADMIN_TOOLS?.hasUnsavedTasks()||window.RSVP_CUSTOMIZATION?.hasUnsaved()||window.RSVP_ADMIN_NOTIFICATIONS?.hasUnsaved();
    return !unsaved||await window.RSVP_INLINE.confirm(t('Changing language reloads this page. Unsaved changes will be lost. Continue?'), { action: "Discard and continue", onSave: () => window.RSVP_INLINE.saveForms([...dirtyForms].filter(form => form !== ignoredForm)) });
  }
  function reloadLanguagePage(){languageReloadApproved=true;location.reload();}
  function applyWording(source,lang,value){
    if(!Object.hasOwn(catalog,source)||!enabled(lang)||!validOverride(source,value))throw Error(t('Keep the same placeholders as the original phrase.'));
    if(!overrides[source])overrides[source]={};
    if(value.trim())overrides[source][lang]=value;else delete overrides[source][lang];
    paint();
  }
  function updateSelectors(){
    const select=document.getElementById('interfaceLanguage');
    if(select){select.replaceChildren(...languages.map(l=>{const option=document.createElement('option');option.value=l.language_code;option.textContent=l.display_name;return option;}));select.value=language;}
    const buttons=document.getElementById('languageSwitcher');
    if(buttons){buttons.replaceChildren(...languages.map(l=>{const button=document.createElement('button');button.type='button';button.dataset.language=l.language_code;button.textContent=l.language_code.toUpperCase();button.title=l.display_name;button.setAttribute('aria-pressed',String(l.language_code===language));button.classList.toggle('selected',l.language_code===language);return button;}));}
  }
  function configure(data){
    if(!data||!Array.isArray(data.languages)||!data.languages.length)return;
    const next=data.languages.filter(l=>validCode(l.language_code)&&l.enabled!==false&&typeof l.display_name==='string').sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code));if(!next.length)return;
    languages=next;defaultLanguage=enabled(data.default_language)?data.default_language:languages[0].language_code;fallbackLanguage=enabled(data.fallback_language)?data.fallback_language:'en';remote=Object.create(null);
    for(const c of data.translations||[]){if(!c.content_key?.startsWith('ui:'))continue;const source=c.content_key.slice(3);if(!Object.hasOwn(catalog,source)||!enabled(c.language_code)||!validOverride(source,c.content_value))continue;if(!remote[source])remote[source]=Object.create(null);remote[source][c.language_code]=c.content_value;}
    if(!enabled(language)||!preference)language=defaultLanguage;
    updateSelectors();paint();
  }
  function load(){
    if(loaded)return loaded;
    loaded=(async()=>{
      const initialCatalogs=loadCatalogs();
      try{
        const db=window.RSVP?.getClient();
        if(db){
          const {data,error}=await db.rpc('get_language_configuration');
          if(!error)configure(data);
        }
      }catch(_){/* English remains available if configuration cannot be reached. */}
      await Promise.all([initialCatalogs,loadCatalogs()]);
      paint();
    })();
    return loaded;
  }
  window.RSVP_I18N={isDirty:form=>dirtyForms.has(form),t,setLanguage,confirmLanguageReload,reloadLanguagePage,markClean:form=>dirtyForms.delete(form),get language(){return language;},get languageReloadApproved(){return languageReloadApproved;},hasPreference:()=>preference,
    csvContract:window.RSVP_LOCALE_CONTRACT,
    unitSource:name=>sourceByKey.get(window.RSVP_UNIT_KEYS?.[name])||name,
    locale:()=>{try{const code={fo:'fo-FO',en:'en-GB',de:'de-DE'}[language]||language;return Intl.DateTimeFormat.supportedLocalesOf(code).length?code:'en-GB';}catch(_){return 'en-GB';}},catalog,applyWording,
    get languages(){return languages;},get defaultLanguage(){return defaultLanguage;},get fallbackLanguage(){return fallbackLanguage;},enabled,configure,load,loadCategory,loadCatalogs,
    resolve:(values,lang=language)=>[...new Set([lang,fallbackLanguage,'en'])].map(code=>values?.[code]).find(value=>typeof value==='string'&&value.trim())||'',
    nativeWording:(source,lang)=>overrides[source]?.[lang]||remote[source]?.[lang]||bundled(source,lang)||'',
    wording:(source,lang)=>overrides[source]?.[lang]||remote[source]?.[lang]||'',
    source:()=> '// Public interface wording. Plain text only.\nwindow.RSVP_INTERFACE_OVERRIDES = '+JSON.stringify(overrides,null,2)+';\n'};
  document.addEventListener('DOMContentLoaded',()=>{
    // Capture only the original static document, before application data is rendered.
    const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;if(node.parentElement.closest('script,style,textarea,pre,code'))continue;
      const source=node.nodeValue.trim();if(!Object.hasOwn(catalog,source))continue;
      const before=node.nodeValue.match(/^\s*/)[0],after=node.nodeValue.match(/\s*$/)[0];textNodes.push([node,source,before,after]);
    }
    document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(node=>{
      for(const name of ['title','aria-label','placeholder']){const source=node.getAttribute(name);if(Object.hasOwn(catalog,source))attributes.push([node,name,source]);}
    });
    const host=document.querySelector('.topbar-actions');
    if(host&&!document.getElementById('languageSwitcher')){
      const select=document.createElement('select');select.id='interfaceLanguage';select.className='interface-language';
      const button=document.createElement('button');button.id='languageToggle';button.type='button';button.className='admin-icon-btn';button.title=t('Interface language');button.setAttribute('aria-label',t('Interface language'));button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/></svg>';
      const label=document.createElement('label');label.id='languageMenuLabel';label.textContent=t('Interface language');label.append(select);
      for(const l of languages){const option=document.createElement('option');option.value=l.language_code;option.textContent=l.display_name;select.append(option);}
      document.addEventListener('input',e=>{const form=e.target.closest('form');if(form&&!form.matches('.other-edit-form,.wording-edit-form')&&!['search'].includes(e.target.type))dirtyForms.add(form);});
      select.addEventListener('change',async()=>{
        if(window.RSVP_ADMIN_PREFERENCES){window.RSVP_ADMIN_PREFERENCES.stage('language',select.value);return;}
        if(!await confirmLanguageReload()){select.value=language;return;}
        await setLanguage(select.value);reloadLanguagePage();
      });const preferences=document.getElementById('interfaceLanguageHost');if(preferences)preferences.append(label);else host.prepend(window.RSVP.iconPopup(button,label));
    }
    const timeHost=document.getElementById('interfaceTimeHost');
    if(timeHost){
      const label=document.createElement('label');label.textContent=t('interface.messages.time_format');
      const select=document.createElement('select');select.id='timeFormat';
      for(const [value,key] of [['locale','time_locale'],['12','time_12'],['24','time_24']]){const option=document.createElement('option');option.value=value;option.textContent=t('interface.messages.'+key);select.append(option);}
      try{select.value=localStorage.getItem('rsvp-time-format')||'locale';}catch(_){}
      select.addEventListener('change',async()=>{if(window.RSVP_ADMIN_PREFERENCES){window.RSVP_ADMIN_PREFERENCES.stage('time',select.value);return;}try{localStorage.setItem('rsvp-time-format',select.value);}catch(_){}document.dispatchEvent(new Event('rsvp:time-format'));});label.append(select);timeHost.append(label);
    }
    paint();
  });
}());
