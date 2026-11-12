export function applyFoil(root, settings = {}) {
  for (const image of root.querySelectorAll('img[data-card-finish]')) {
    if (!['foil','etched'].includes(image.dataset.cardFinish)) continue;
    let surface=image.parentElement;
    if (!surface.classList.contains('foil-surface')) {
      surface=document.createElement('span');surface.className='foil-surface';
      image.before(surface);surface.append(image);
      surface.addEventListener('pointermove',event=>{
        const rect=surface.getBoundingClientRect();
        surface.style.setProperty('--shine-x',`${(event.clientX-rect.left)/rect.width*100}%`);
        surface.style.setProperty('--shine-y',`${(event.clientY-rect.top)/rect.height*100}%`);
      });
    }
    surface.dataset.finish=image.dataset.cardFinish;
    surface.classList.toggle('foil-static',settings.foilMotion===false);
  }
  document.documentElement.dataset.foilPreset=['prism','sheen','holographic','traditional'].includes(settings.foilPreset)?settings.foilPreset:'sheen';
  document.documentElement.dataset.foilIntensity=['low','medium','high'].includes(settings.foilIntensity)?settings.foilIntensity:'medium';
  document.documentElement.dataset.foilMotion=settings.foilMotion===false?'off':'on';
}