// Pointer Events work with mouse, touch and pen. No HTML5 drag dependency.
export function attachGesture(element, { move, end, tap = () => {}, hover = () => {}, allowDrag = () => true }) {
  let start = null;
  element.ondragstart = event => event.preventDefault();
  element.addEventListener('click', event => { if (element.dataset.suppressClick === 'true' && event.detail !== 0) {event.preventDefault();event.stopImmediatePropagation();} }, true);
  element.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    element.dataset.suppressClick = 'false';
    const draggable = allowDrag(event);
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false, draggable };
    if (draggable) element.setPointerCapture(event.pointerId);
  };
  element.onpointermove = event => {
    if (!start) { hover(event); return; }
    if (event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 7) start.moved = true;
    if (start.moved && start.draggable) move({ dx, dy, x: event.clientX, y: event.clientY });
  };
  function finish(event, cancelled) {
    if (!start || event.pointerId !== start.id) return;
    const previous = start; start = null;
    element.dataset.suppressClick = previous.moved || cancelled ? 'true' : 'false';
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (cancelled || previous.moved) end({ dx: event.clientX - previous.x, dy: event.clientY - previous.y, x: event.clientX, y: event.clientY, cancelled: cancelled || !previous.draggable });
    else tap();
  }
  element.onpointerup = event => finish(event, false);
  element.onpointercancel = event => finish(event, true);
  element.onlostpointercapture = event => { if (start) finish(event, true); };
  element.onpointerleave = event => { if (start && !start.draggable) finish(event, true); if (!start) element.style.transform = ''; };
}