// The actual stack is rendered before the wrapper moves. Never animate a second
// set of card images: the revealed stack stays mounted throughout the transition.
export function packagingGeometry(bounds, origin, naturalWidth, naturalHeight) {
  const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : (origin?.width / origin?.height || 400 / 720);
  // Cover the entire stack (including its offset lower cards) with one uniform
  // scale. Never stretch a narrow wrapper into the card's aspect ratio.
  const width = Math.max(bounds.width * 1.22, bounds.height * 1.18 * ratio);
  const height = width / ratio;
  const left = bounds.left + (bounds.width - width) / 2;
  const top = bounds.top + (bounds.height - height) / 2;
  const sourceWidth = origin ? Math.min(origin.width, origin.height * ratio) : width;
  const sourceHeight = sourceWidth / ratio;
  const sourceLeft = origin ? origin.left + (origin.width - sourceWidth) / 2 : left;
  const sourceTop = origin ? origin.top + (origin.height - sourceHeight) / 2 : top;
  return {width,height,left,top,dx:sourceLeft-left,dy:sourceTop-top,scale:sourceWidth/width};
}
export async function unwrapPack({ wrapper, stage, reveal, reducedMotion = false }) {
  const art=wrapper.querySelector?.('.pack-artwork');
  const origin=art?.getBoundingClientRect();
  const shell = wrapper.cloneNode(true);
  shell.removeAttribute('role');shell.removeAttribute('tabindex');
  shell.setAttribute('aria-hidden','true');
  shell.classList.add('unwrapping-shell');
  let overlay;
  try {
    stage.classList.add('unwrapping');stage.classList.add('pack-approaching');stage.inert=true;
    await reveal();
    if (reducedMotion || !stage.isConnected) return;
    const stack = stage.querySelector('.card-stack');
    if (!stack) return;
    const bounds = stack.getBoundingClientRect();
    const geometry=packagingGeometry(bounds,origin,art?.naturalWidth,art?.naturalHeight);
    overlay = document.createElement('div');overlay.className='pack-opening-overlay';
    overlay.setAttribute('aria-hidden','true');
    const rect = stage.getBoundingClientRect();
    overlay.style.cssText=`left:${geometry.left-rect.left}px;top:${geometry.top-rect.top}px;width:${geometry.width}px;height:${geometry.height}px`;
    overlay.append(shell);stage.append(overlay);
    // Lock gestures, not image preparation; the real cards are already beneath.
    stage.inert=true;stage.classList.add('unwrapping');
    if (typeof shell.animate === 'function') {
      const {dx,dy,scale}=geometry;
      shell.style.transformOrigin='top left';
      stage.classList.add('pack-approaching');
      const approach=shell.animate([
        {transform:`translate(${dx}px,${dy}px) scale(${scale})`,opacity:1},
        {transform:'translate(0px,-12px) scale(1)',opacity:1,offset:.8},
        {transform:'translate(0px,0px) scale(1)',opacity:1}
      ],{duration:750,easing:'cubic-bezier(.22,.7,.25,1)',fill:'forwards'});
      await approach.finished.catch(()=>{});
      // The full stack is now visible beneath the physical wrapper; no wipe or
      // clip animation competes with the wrapper's downward movement.
      stage.classList.remove('pack-approaching');
      const animation=shell.animate([
        {transform:'translateY(0%)',opacity:1,offset:0},
        {transform:'translateY(3%)',opacity:1,offset:.2},
        {transform:'translateY(115%)',opacity:1,offset:.8},
        {transform:'translateY(145%)',opacity:0,offset:1}
      ],{duration:1450,easing:'cubic-bezier(.45,0,.25,1)',fill:'forwards'});
      await animation.finished.catch(()=>{});
      approach.cancel?.();animation.cancel?.();
    }
  } finally {
    overlay?.remove();stage.inert=false;stage.classList.remove('unwrapping');stage.classList.remove('pack-approaching');
  }
}

export function foilStrength(level) { return ({low:.28,medium:.52,high:.72})[level] ?? .52; }
export function foilPreset(preset='sheen') { return ['prism','sheen','holographic','traditional'].includes(preset) ? preset : 'sheen'; }