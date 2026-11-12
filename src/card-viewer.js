import { inventory, priceOf } from './simulator.js';
import { binderLocations } from './interactions-model.js';
import { artists } from './collection-model.js';
import { applyFoil } from './foil.js';
import { createTraditionalFoil, attachViewerTilt } from './traditional-foil.js';
export function createCardViewer(getState, remove) {
  const dialog=document.createElement('dialog');dialog.className='card-viewer';document.body.append(dialog);
  let previous,renderer=null,detach=null;
  function cleanup(){detach?.();detach=null;renderer?.dispose();renderer=null;}
  dialog.addEventListener('close',()=>{cleanup();previous?.focus();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  return function view(card,finish='nonfoil',source=null){
    cleanup();previous=document.activeElement;dialog.replaceChildren();
    const close=document.createElement('button');close.textContent='Close ×';close.onclick=()=>dialog.close();
    const photo=document.createElement('img');photo.alt=card.name;if(/^https:\/\//.test(card.image??''))photo.src=card.image;
    const info=document.createElement('section'), title=document.createElement('h2');title.textContent=card.name;info.append(title);
    dialog.setAttribute('aria-label',card.name);
    const inv=inventory(getState().history), key=`${card.id}:${finish}`, price=priceOf(card,finish);
    for(const text of [`${card.set?.toUpperCase()} #${card.collector_number} · ${card.rarity} · ${finish} · ${card.lang??'en'}`,artists(card).join(', ')||'Artist metadata unavailable — refresh this set',`${inv[key]?.quantity??0} copies · ${price==null?'Price unavailable':`$${price.toFixed(2)} (saved estimate)`}`,...binderLocations(getState(),key).map(l=>`${l.name} · pocket ${l.slot} · ${l.finish}`)]){const p=document.createElement('p');p.textContent=text;info.append(p);}
    if(card.backImage){const flip=document.createElement('button');flip.textContent='Other face';let back=false;flip.onclick=()=>{back=!back;photo.src=back?card.backImage:card.image;};info.append(flip);}
    if(/^https:\/\/scryfall.com\//.test(card.scryfall_uri??'')){const link=document.createElement('a');link.href=card.scryfall_uri;link.target='_blank';link.rel='noopener';link.textContent='View on Scryfall';info.append(link);}
    if(source){const button=document.createElement('button');button.textContent='Remove from binder';button.className='danger';button.onclick=async()=>{button.disabled=true;try{await remove(source,key);dialog.close();}catch(error){button.disabled=false;alert(error.message);}};info.append(button);}
    photo.dataset.cardFinish=finish;
    dialog.append(close,photo,info);applyFoil(dialog,getState().settings);if(!dialog.open)dialog.showModal();close.focus();
    let surface=photo.parentElement;
    if(surface===dialog){surface=document.createElement('span');surface.className='viewer-card-surface';photo.before(surface);surface.append(photo);}
    surface.classList.add('viewer-tilt');
    if(finish==='foil'&&getState().settings?.foilPreset==='traditional')renderer=createTraditionalFoil(surface,photo,getState().settings?.foilIntensity);
    detach=attachViewerTilt(surface,(x,y)=>renderer?.update(x,y));
    const hint=document.createElement('p');hint.textContent='Drag across the card to tilt it and move the light. Traditional WebGL is used here when supported; otherwise the CSS finish remains.';info.append(hint);
  };
}