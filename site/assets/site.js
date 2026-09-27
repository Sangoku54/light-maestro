// Light Maestro — site vitrine
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('[data-menu]');
  const panel = document.querySelector('[data-menu-panel]');
  if(btn && panel){
    btn.addEventListener('click', () => {
      const open = panel.getAttribute('data-open') === '1';
      panel.setAttribute('data-open', open ? '0' : '1');
      panel.style.display = open ? 'none' : 'block';
    });
  }
  // year
  const y = document.querySelector('[data-year]');
  if(y) y.textContent = String(new Date().getFullYear());
});
