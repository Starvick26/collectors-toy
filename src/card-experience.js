import { attachGesture } from './gestures.js';
import { valueTier, pendingCards, availableCopies, placeCard, swipeAction, binderLocations } from './interactions-model.js';
import { inventory, cardKey, priceOf } from './simulator.js';
import { prepareImage } from './image-loader.js';
import { foilStrength } from './pack-opening.js';
import { applyFoil } from './foil.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const picture = (card,finish='nonfoil') => `<img draggable="false" data-card-finish="${esc(finish)}" src="${/^https:\/\//.test(card.image ?? '') ? esc(card.image) : ''}" alt="${esc(card.name)}">`;
export function createExperience({ getState, commit, getOpening, advance, rewind, refresh, report }) {
  let locked = false, activeBinder = null, selected = null, ghost = null, target = null;
  let filterPending = true;
  const celebrated=new Set();let lastReveal=-2;
  let arrangeMode = false;
  const inspect=(card,finish,source)=>document.dispatchEvent(new CustomEvent('view-card',{detail:{card,finish,source}}));
  document.addEventListener('select-binder-card',event=>{selected={key:event.detail.key};filterPending=false;render();});
  const stackImages=new Map();
  function duplicateText(key) {
    const locations=binderLocations(getState(),key);
    return locations.length?`Already in binder: ${locations.map(l=>`${l.name} · pocket ${l.slot} (${l.finish}${l.exact?' · same finish':''})`).join('; ')}`:'';
  }
  const settings = document.createElement('details'); settings.className = 'gesture-settings';
  settings.innerHTML = '<summary>Interaction settings</summary><label>Swipe towards binder <select id="binderSide"><option value="right">Right (default)</option><option value="left">Left</option></select></label><label>Effects <select id="effectLevel"><option value="full">Full</option><option value="subtle">Subtle</option><option value="off">Off</option></select></label><label>Foil intensity <select id="foilIntensity"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label><input id="foilMotion" type="checkbox"> Animated foil</label><p>Opposite direction keeps the card in your collection. Arrow keys work too. Cards are already saved; decisions only sort them.</p>';
  settings.querySelector('#foilIntensity').innerHTML='<option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>';
  const styleLabel=document.createElement('label');styleLabel.innerHTML='Foil style <select id="foilPreset"><option value="prism">Prism · colour facets</option><option value="sheen">Sheen · moving stripe</option><option value="holographic">Holographic · fine rainbow grain</option></select>';
  settings.querySelector('#foilIntensity').closest('label').before(styleLabel);
  settings.querySelector('#foilPreset').insertAdjacentHTML('beforeend','<option value="traditional">Traditional · WebGL 2 viewer</option>');
  settings.querySelector('#foilPreset').onchange=async event=>{try{const next=structuredClone(getState());next.settings.foilPreset=event.target.value;await commit(next);refresh();}catch(e){report(e.message);}};
  settings.querySelector('#foilIntensity').onchange=async event=>{try{const next=structuredClone(getState());next.settings.foilIntensity=event.target.value;await commit(next);refresh();}catch(e){report(e.message);}};
  settings.querySelector('#effectLevel').onchange=async event=>{try{const next=structuredClone(getState());next.settings.effects=event.target.value;await commit(next);refresh();}catch(e){report(e.message);}};
  settings.querySelector('#foilMotion').onchange=async event=>{try{const next=structuredClone(getState());next.settings.foilMotion=event.target.checked;await commit(next);refresh();}catch(e){report(e.message);}};
  document.querySelector('.controls').after(settings);
  settings.querySelector('select').onchange = async event => {
    try { const next = structuredClone(getState()); next.settings.binderSide = event.target.value; await commit(next); refresh(); }
    catch (error) { report(error.message); }
  };
  const dock = document.createElement('aside'); dock.className = 'binder-dock'; dock.setAttribute('aria-label','Binder preview'); document.body.append(dock);
  const workspace = document.createElement('section'); workspace.className = 'sorting-workspace';
  document.getElementById('bindersList').before(workspace);
  async function decide(action) {
    const opening = getOpening();
    if (locked || !opening?.item || document.querySelector('.swipe-card.image-pending')) return;
    locked = true;
    try {
      const next = structuredClone(getState());
      const decisionId = `${opening.pack.id}/${opening.index}`;
      if (next.decisions[decisionId] !== 'placed') next.decisions[decisionId] = action;
      next.activeOpening = { id: opening.pack.id, index: opening.index + 1 };
      const card = document.querySelector('.swipe-card');
      if (card) {
        card.closest('.card-stack')?.style.setProperty('--lift','1');
        const right = (action === 'binder') === (next.settings.binderSide === 'right');
        card.classList.add('flying'); card.style.transform = `translateX(${right ? 650 : -650}px) rotate(${right ? 25 : -25}deg)`; card.style.opacity = '0';
      }
      await commit(next);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve,220));
      advance();
    } catch (error) { report(error.message); decorate(); }
    finally { dock.classList.remove('visible'); locked = false; }
  }
  async function undo() {
    const opening = getOpening();
    if (locked || !opening || opening.index <= 0) return;
    const id = `${opening.pack.id}/${opening.index - 1}`;
    if (getState().decisions[id] === 'placed') { report('Remove this card from its binder before changing that decision.'); return; }
    locked = true;
    try { const next = structuredClone(getState()); delete next.decisions[id]; next.activeOpening = {id:opening.pack.id,index:opening.index-1}; await commit(next); rewind(); }
    catch(error) { report(error.message); } finally { locked = false; }
  }
  function decorate() {
    const opening = getOpening();
    if (!opening) return;
    const stage = document.getElementById('openingStage');
    if(opening.index<0 && lastReveal>=0)celebrated.clear();
    lastReveal=opening.index;
    if (!opening.item) {
      if (opening.index >= opening.pack.cards.length && !stage.querySelector('.sort-now')) {
        const button = document.createElement('button'); button.className='primary sort-now';
        button.textContent=`Arrange binder cards (${pendingCards(getState()).length} pending)`;
        button.onclick=()=> { document.querySelector('[data-view="binders"]').click(); filterPending=true; render(); workspace.scrollIntoView({behavior:'smooth',block:'start'}); };
        stage.append(button);
        if (pendingCards(getState()).some(item => item.id.startsWith(`${opening.pack.id}/`))) {
          document.querySelector('[data-view="binders"]').click(); filterPending=true; render();
        }
      }
      return;
    }
    const card = stage.querySelector('.card-image');
    if (!card) return;
    if (card.classList.contains('swipe-card')) { card.classList.remove('flying');card.style.transform='';card.style.opacity='';return; }
    const { item } = opening, tier = valueTier(priceOf(item.card,item.finish));
    card.dataset.finish=item.finish;
    card.style.setProperty('--foil-strength',foilStrength(getState().settings.foilIntensity));
    const stack=document.createElement('div');stack.className='card-stack';
    card.before(stack);stack.append(card);
    const layers=[];
    for(let offset=2;offset>=1;offset--){
      const next=opening.pack.cards[opening.index+offset];if(!next)continue;
      const layer=document.createElement('div');layer.className=`stack-under stack-depth-${offset}`;layer.setAttribute('aria-hidden','true');
      const id=`${opening.pack.id}/${opening.index+offset}`;
      let preview=stackImages.get(id);
      if(!preview){preview=document.createElement('img');preview.alt='';preview.draggable=false;preview.src=next.card.image??'';stackImages.set(id,preview);}
      layer.append(preview);stack.prepend(layer);layers.push(layer);
      prepareImage(next.card.image).then(ok=>{if(ok)layer.classList.add('ready');});
    }
    const topId=`${opening.pack.id}/${opening.index}`;
    if(stackImages.has(topId)) {const reused=stackImages.get(topId);reused.alt=item.card.name;card.querySelector('img').replaceWith(reused);stackImages.delete(topId);}
    while(stackImages.size>4)stackImages.delete(stackImages.keys().next().value);
    const photo=card.querySelector('img');photo.classList.remove('revealed');
    card.classList.add('image-pending');
    const waiting=document.createElement('span');waiting.className='image-waiting';waiting.textContent='Preparing card…';card.append(waiting);
    stage.querySelectorAll('.find-effects').forEach(effect=>effect.remove());
    stage.dataset.effects=getState().settings.effects??'full';
    card.classList.toggle('foil-static',getState().settings.foilMotion===false);
    function celebrate(){
      if(!card.isConnected)return;
      card.classList.remove('image-pending');waiting.remove();
      const eventId=`${opening.pack.id}/${opening.index}`;
      if(!tier.level||getState().settings.effects==='off'||celebrated.has(eventId))return;
      celebrated.add(eventId);
      const layer=document.createElement('div');layer.className=`find-effects find-${tier.level}`;layer.setAttribute('aria-hidden','true');
      layer.innerHTML=`<div class="find-ring"></div><div class="find-rays"></div><span class="find-banner">${esc(tier.label)}</span>${Array.from({length:Math.min(28,tier.level*5)},(_,i)=>`<i style="--angle:${i*137.5}deg;--distance:${55+(i%5)*22}px;--delay:${i%4*.045}s"></i>`).join('')}`;
      stage.append(layer);setTimeout(()=>layer.remove(),1800);
    }
    prepareImage(item.card.image).then(ok=>{if(!card.isConnected)return;if(ok)celebrate();else{waiting.textContent='Image unavailable · tap to retry';waiting.style.pointerEvents='auto';waiting.onclick=()=>{waiting.textContent='Retrying…';prepareImage(item.card.image).then(ready=>{if(ready){photo.src=item.card.image;celebrate();}else waiting.textContent='Image unavailable · tap to retry';});};}});
    stage.dataset.valueTier = tier.level;
    card.classList.add('swipe-card',`value-${tier.level}`); card.tabIndex=0; card.setAttribute('aria-label','Swipe card or use left and right arrow keys');
    card.insertAdjacentHTML('beforeend', '<span class="swipe-stamp"></span>');
    const price = stage.querySelector('.price');
    const duplicates=duplicateText(cardKey(item.card,item.finish));
    if(duplicates){const note=document.createElement('p');note.className='binder-duplicate';note.setAttribute('role','status');note.textContent=duplicates;stage.querySelector('.card-details h3').after(note);}
    price.className=`price tier-label value-${tier.level}`;
    price.textContent=`${tier.label ? tier.label+' · ' : ''}${priceOf(item.card,item.finish) == null ? 'Price unavailable' : '$'+priceOf(item.card,item.finish).toFixed(2)}`;
    const side = getState().settings.binderSide;
    const controls = stage.querySelector('.reveal-actions');
    // Keep a single DOM layout for desktop and mobile; CSS places the header
    // above the full-width card on narrow screens.
    const heading = document.createElement('div'); heading.className = 'opening-card-heading';
    const product = document.createElement('div'); product.className = 'opening-product-name';
    product.textContent = `${opening.pack.setName} · ${opening.pack.productName}`;
    heading.append(product, stage.querySelector('.progress'));
    stage.querySelector('.stage-card').prepend(heading);
    controls.innerHTML = `<button class="secondary swipe-left">← ${side==='left'?'Binder':'Collection'}</button><button class="primary swipe-right">${side==='right'?'Binder':'Collection'} →</button><button class="quiet undo-card">Undo</button>${item.card.backImage ? '<button class="quiet flip-face">Other face</button>' : ''}`;
    const inspectButton=document.createElement('button');inspectButton.className='quiet';inspectButton.textContent='View card';inspectButton.onclick=()=>inspect(item.card,item.finish);controls.append(inspectButton);
    controls.querySelector('.swipe-left').onclick=()=>decide(side==='left'?'binder':'collection');
    controls.querySelector('.swipe-right').onclick=()=>decide(side==='right'?'binder':'collection');
    controls.querySelector('.undo-card').onclick=undo;
    controls.querySelector('.undo-card').disabled=opening.index===0;
    const flip=controls.querySelector('.flip-face'); if(flip) flip.onclick=()=> { const img=card.querySelector('img'); img.src=img.src===item.card.backImage?item.card.image:item.card.backImage; };
    const hint=document.createElement('p'); hint.className='gesture-hint'; hint.textContent='Drag to sort · Release near the center to keep inspecting · Ctrl/⌘ Z to undo'; controls.after(hint);
    attachGesture(card, {
      hover(event) { const rect=card.getBoundingClientRect(), x=(event.clientX-rect.left)/rect.width, y=(event.clientY-rect.top)/rect.height; card.style.setProperty('--shine-x',`${x*100}%`); card.style.setProperty('--shine-y',`${y*100}%`); card.style.transform=`perspective(900px) rotateY(${(x-.5)*18}deg) rotateX(${(.5-y)*12}deg)`; },
      move({dx,dy}) {
        if(locked)return;
        stack.style.setProperty('--lift',String(Math.min(1,Math.abs(dx)/150)));
        card.style.transform=`perspective(900px) translate(${dx}px,${dy*.35}px) rotateY(${Math.max(-20,Math.min(20,dx/10))}deg) rotateZ(${dx/22}deg)`;
        card.style.setProperty('--shine-x',`${50+dx/5}%`);
        const action=(dx>0?'right':'left')===side?'binder':'collection';
        const stamp=card.querySelector('.swipe-stamp'); stamp.textContent=action==='binder'?'BINDER':'COLLECTION'; stamp.style.opacity=Math.min(1,Math.abs(dx)/90); stamp.dataset.action=action;
        if(action==='binder' && Math.abs(dx)>35) { dock.classList.add('visible'); dock.dataset.side=side; dock.innerHTML=`<h3>Save for binder</h3><p>Arrange after this pack</p>${getState().binders.map(b=>`<div>▣ ${esc(b.name)} · ${b.slots.filter(s=>!s).length} empty</div>`).join('') || '<p>Create a binder after opening.</p>'}`; } else dock.classList.remove('visible');
      },
      end({dx,dy,cancelled}) { dock.classList.remove('visible'); const action=cancelled?null:swipeAction(dx,dy,card.offsetWidth,side); if(action)decide(action); else {stack.style.setProperty('--lift','0');card.style.transform='';card.querySelector('.swipe-stamp').style.opacity=0;} }
    });
  }
  function clearDrag() { ghost?.remove();ghost=null; target?.classList.remove('drop-ready');target=null;document.body.classList.remove('card-dragging'); }
  function render() {
    const state=getState(); if(!state)return;
    settings.querySelector('select').value=state.settings.binderSide;
    settings.querySelector('#effectLevel').value=state.settings.effects??'full';
    settings.querySelector('#foilMotion').checked=state.settings.foilMotion!==false;
    settings.querySelector('#foilPreset').value=state.settings.foilPreset??'sheen';
    settings.querySelector('#foilIntensity').value=state.settings.foilIntensity==='normal'?'medium':(state.settings.foilIntensity??'medium');
    const inv=inventory(state.history), pending=pendingCards(state);
    activeBinder=state.binders.some(b=>b.id===activeBinder)?activeBinder:state.binders[0]?.id;
    const binder=state.binders.find(b=>b.id===activeBinder);
    const items=filterPending?pending:Object.entries(inv).filter(([key])=>availableCopies(state,key)>0).map(([key,item])=>({key,...item}));
    workspace.innerHTML=`<div class="sorting-heading"><div><div class="eyebrow">YOUR SORTING TABLE</div><h3>${pending.length} cards waiting for a binder</h3><p>Drag a card into a pocket. On mobile, tap a card then tap an empty pocket.</p></div><label>Cards<select class="tray-filter"><option value="pending">Saved for binder</option><option value="all">All unassigned cards</option></select></label></div><div class="sorting-layout"><div class="card-tray">${items.map(item=>`<button class="tray-card ${selected?.key===item.key?'selected':''} value-${valueTier(priceOf(item.card,item.finish)).level}" data-key="${esc(item.key)}" data-pending="${esc(item.id??'')}" aria-label="Select ${esc(item.card.name)}">${picture(item.card)}<small>${esc(item.finish)} · ${availableCopies(state,item.key)} available</small></button>`).join('')||'<p>No cards in this tray.</p>'}</div><div class="pocket-area"><div class="binder-tabs">${state.binders.map(b=>`<button class="secondary ${b.id===activeBinder?'chosen':''}" data-binder-tab="${esc(b.id)}">▣ ${esc(b.name)}</button>`).join('')}</div>${binder?`<h3>${esc(binder.name)}</h3><div class="sorting-pockets">${binder.slots.map((key,i)=>`<button class="sorting-pocket" data-pocket="${i}" data-binder-id="${esc(binder.id)}" aria-label="Pocket ${i+1}${key?', occupied':', empty'}">${key&&inv[key]?picture(inv[key].card):`<span>＋<small>${i+1}</small></span>`}</button>`).join('')}</div><button class="secondary more-pockets">+ Add page</button>`:'<p>Create a binder using New binder above.</p>'}<button class="quiet return-collection" ${!selected?'disabled':''}>Keep selected card in collection</button><p class="placement-status" role="status">${selected?'Card selected — choose an empty pocket.':'Choose a card to start.'}</p></div></div>`;
    workspace.querySelector('.tray-filter').value=filterPending?'pending':'all';
    workspace.querySelectorAll('.tray-card').forEach(button=>{button.querySelector('img').dataset.cardFinish=inv[button.dataset.key].finish;});
    workspace.querySelectorAll('[data-pocket] img').forEach(image=>{image.dataset.cardFinish=inv[binder.slots[Number(image.closest('[data-pocket]').dataset.pocket)]].finish;});
    applyFoil(workspace,state.settings);
    workspace.querySelectorAll('.tray-card').forEach(button=>{const text=duplicateText(button.dataset.key);if(text){const badge=document.createElement('span');badge.className='binder-duplicate';badge.textContent='Already in binder';badge.title=text;button.append(badge);}});
    workspace.classList.toggle('arrange-mode', arrangeMode);
    const modeBar=document.createElement('div'); modeBar.className='arrange-toolbar';
    modeBar.innerHTML=`<button class="secondary arrange-toggle" aria-pressed="${arrangeMode}">${arrangeMode?'Done arranging':'Arrange · drag cards'}</button><p>${arrangeMode?'Drag cards freely. Use Done arranging to scroll over cards again.':'Swipe vertically to scroll. Tap a card, then a pocket — or enable Arrange to drag.'}</p>`;
    workspace.querySelector('.sorting-heading').after(modeBar);
    modeBar.querySelector('button').onclick=()=>{clearDrag();arrangeMode=!arrangeMode;render();};
    if(binder){const remove=document.createElement('button');remove.className='quiet danger';remove.textContent='Delete binder';remove.onclick=async()=>{if(!confirm('Delete this binder? Cards stay in your collection.'))return;try{const next=structuredClone(getState());next.binders=next.binders.filter(b=>b.id!==binder.id);selected=null;await commit(next);}catch(error){report(error.message);}};modeBar.append(remove);}
    workspace.querySelector('.tray-filter').onchange=e=>{filterPending=e.target.value==='pending';selected=null;render();};
    workspace.querySelectorAll('[data-binder-tab]').forEach(button=>button.onclick=()=>{activeBinder=button.dataset.binderTab;render();});
    const more=workspace.querySelector('.more-pockets'); if(more)more.onclick=async()=>{try{const next=structuredClone(getState());next.binders.find(b=>b.id===activeBinder).slots.push(...Array(9).fill(null));await commit(next);}catch(e){report(e.message);}};
    workspace.querySelector('.return-collection').onclick=async()=>{try{if(!selected)return;const next=structuredClone(getState());if(selected.source)next.binders.find(b=>b.id===selected.source.id).slots[selected.source.position]=null;const id=selected.pendingId??pending.find(i=>i.key===selected.key)?.id;if(id)next.decisions[id]='collection';selected=null;await commit(next);}catch(e){report(e.message);}};
    async function drop(payload, pocket) {
      if(!payload.source){const warning=duplicateText(payload.key);if(warning&&!confirm(`${warning}\n\nPlace another copy here?`))return;}
      try { const next=placeCard(getState(),payload.key,pocket.dataset.binderId,Number(pocket.dataset.pocket),payload.source,payload.pendingId);selected=null;await commit(next);report('Card slipped into its pocket.'); }
      catch(error){report(error.message);}
    }
    function bindDrag(element,payload,tap) {
      attachGesture(element, {tap,allowDrag: event => event.pointerType === 'mouse' || arrangeMode,move({x,y}) {
        if(!ghost){ghost=document.createElement('div');ghost.className='drag-card-ghost';ghost.innerHTML=picture(inv[payload.key].card);document.body.append(ghost);document.body.classList.add('card-dragging');}
        ghost.style.left=`${x}px`;ghost.style.top=`${y}px`;
        target?.classList.remove('drop-ready');target=document.elementFromPoint(x,y)?.closest('[data-pocket]');target?.classList.add('drop-ready');
        if(y>innerHeight-65)window.scrollBy(0,12);if(y<90)window.scrollBy(0,-12);
      },end({cancelled}){const pocket=target;clearDrag();if(!cancelled&&pocket)drop(payload,pocket);} });
    }
    workspace.querySelectorAll('.tray-card').forEach(button=>{const payload={key:button.dataset.key,pendingId:button.dataset.pending||null};bindDrag(button,payload,()=>{selected=payload;render();});button.onclick=event=>{if(event.detail===0){selected=payload;render();}};});
    workspace.querySelectorAll('[data-pocket]').forEach(button=>{
      const key=binder.slots[Number(button.dataset.pocket)];
      if(key&&inv[key]) {
        bindDrag(button,{key,source:{id:binder.id,position:Number(button.dataset.pocket)}},()=>{
          if(selected){drop(selected,button);return;}
          if(!arrangeMode){inspect(inv[key].card,inv[key].finish,{id:binder.id,position:Number(button.dataset.pocket)});return;}
          selected={key,source:{id:binder.id,position:Number(button.dataset.pocket)}};
          workspace.querySelector('.placement-status').textContent='Choose a pocket to move or swap this card.';
          workspace.querySelector('.return-collection').disabled=false;
          workspace.querySelectorAll('[data-pocket]').forEach(p=>p.classList.toggle('selected',p===button));
        });
        button.onclick=event=>{if(event.detail===0){if(selected)drop(selected,button);else inspect(inv[key].card,inv[key].finish,{id:binder.id,position:Number(button.dataset.pocket)});}};
      } else button.onclick=()=>{if(selected)drop(selected,button);};
    });
    // Legacy binder pages remain available for deletion/removal; the sorting table
    // is the primary placement workflow and supports both touch and desktop.
  }
  document.addEventListener('keydown', event=>{
    if(document.getElementById('openingStage').classList.contains('unwrapping'))return;
    if(document.querySelector('dialog[open]'))return;
    if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName))return;
    if(!document.getElementById('openView').classList.contains('active'))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const side=event.key==='ArrowLeft'?'left':'right';decide(side===getState().settings.binderSide?'binder':'collection');}
    if(event.code==='Space' && getOpening()?.item){event.preventDefault();decide('collection');}
    if((event.ctrlKey||event.metaKey)&&event.key==='z'){event.preventDefault();undo();}
  });
  return { decorate, render, decide };
}