(function(){
  'use strict';
  const guest=document.documentElement.hasAttribute('data-guest-page'),media=window.matchMedia('(prefers-color-scheme: dark)'),key=guest?'rsvp-guest-appearance':'event-appearance';
  let guestSettings={showToggle:false,defaultTheme:'system'},guestConfigured=false;
  let preference=null;try{const saved=localStorage.getItem(key);if(['system','light','dark'].includes(saved))preference=saved;}catch(_){}
  function apply(){const effective=guest?(guestSettings.showToggle?(preference||guestSettings.defaultTheme):guestSettings.defaultTheme):(preference||'system');const theme=effective==='system'?(media.matches?'dark':'light'):effective;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;const toggle=document.getElementById('themeToggle');if(guest&&toggle)toggle.closest('.theme-control')?.classList.toggle('hidden',!guestConfigured||!guestSettings.showToggle);if(toggle?.dataset.directToggle==='true'){const text=theme==='dark'?'Switch to light mode':'Switch to dark mode';toggle.title=window.RSVP_I18N?.t(text)||text;toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-pressed',String(theme==='dark'));toggle.innerHTML=theme==='dark'?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/></svg>';}}
  window.RSVP_THEME={setAdminPreference(value){if(guest)return;preference=['system','light','dark'].includes(value)?value:'system';try{localStorage.setItem(key,preference);}catch(_){}const select=document.getElementById('themePreference');if(select)select.value=preference;apply();},configureGuest(options){if(!guest)return;guestSettings={showToggle:options?.showToggle===true,defaultTheme:['system','light','dark'].includes(options?.defaultTheme)?options.defaultTheme:'dark'};guestConfigured=true;apply();}};
  apply();media.addEventListener('change',apply);
  window.addEventListener('storage',e=>{if(e.key===key&&!window.RSVP_ADMIN_PREFERENCES){preference=['light','dark'].includes(e.newValue)?e.newValue:'system';apply();const select=document.getElementById('themePreference');if(select)select.value=preference||'system';}});
  document.addEventListener('DOMContentLoaded',()=>{
    const host=document.querySelector('.topbar-actions');if(!host)return;
    const wrap=document.createElement('div');wrap.className='theme-control';
    const button=document.createElement('button');button.id='themeToggle';button.type='button';button.className='admin-icon-btn';button.title="Appearance";button.setAttribute('aria-label',"Appearance");button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','themeMenu');
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/></svg>';
    const menu=document.createElement('div');menu.id='themeMenu';menu.className='theme-menu hidden';
    const label=document.createElement('label');label.textContent="Appearance";const select=document.createElement('select');select.id='themePreference';select.setAttribute('aria-label',"Appearance preference");
    for(const [value,text] of [['system',"System default"],['light',"Light"],['dark',"Dark"]]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=preference||'system';label.append(select);menu.append(label);
    if(guest){button.dataset.directToggle='true';button.removeAttribute('aria-expanded');button.removeAttribute('aria-controls');wrap.append(button);host.prepend(wrap);button.addEventListener('click',()=>{preference=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,preference);}catch(_){}apply();});apply();return;}
    const preferences=document.getElementById('interfaceAppearanceHost');
    if(preferences){
      preferences.append(label);button.dataset.directToggle='true';button.removeAttribute('aria-expanded');button.removeAttribute('aria-controls');
      function set(value,immediate=false){if(window.RSVP_ADMIN_PREFERENCES){if(immediate)window.RSVP_ADMIN_PREFERENCES.save('appearance',value);else window.RSVP_ADMIN_PREFERENCES.stage('appearance',value);return;}preference=value;try{localStorage.setItem(key,preference);}catch(_){}select.value=preference||'system';apply();}
      select.addEventListener('change',()=>set(select.value));button.addEventListener('click',()=>set(document.documentElement.dataset.theme==='dark'?'light':'dark',true));
      document.getElementById('adminTopActions').append(button);apply();return;
    }
    function close(){menu.classList.add('hidden');button.setAttribute('aria-expanded','false');}
    button.addEventListener('click',()=>{const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);button.setAttribute('aria-expanded',String(opening));if(opening)select.focus();});
    select.addEventListener('change',()=>{preference=select.value;try{localStorage.setItem(key,preference);}catch(_){}apply();});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))close();});wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();}});
    wrap.append(button,menu);host.prepend(wrap);
  });
}());
