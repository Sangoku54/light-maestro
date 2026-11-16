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

  // Bouton flottant téléchargement sur toutes les pages (sauf telecharger* qui l'a déjà en dur)
  if(!document.querySelector('.dl-float')){
    const wrap = document.createElement('div');
    wrap.className = 'dl-float';
    const isEn = document.documentElement.lang === 'en';
    wrap.innerHTML = `<a href="./${isEn ? 'telecharger-en.html' : 'telecharger.html'}">${isEn ? 'Download for free' : 'Télécharger gratuitement'}</a>`;
    document.body.appendChild(wrap);
  }

  // ── Lightbox : agrandir les captures d’écran au clic ──
  const galleryImgs = document.querySelectorAll('img[src*="capture-"]');
  if(galleryImgs.length > 0){
    // Créer l'overlay une seule fois
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <button class="lightbox-close" aria-label="Fermer">✕</button>
      <img class="lightbox-img" src="" alt="">
    `;
    document.body.appendChild(overlay);

    const lightboxImg = overlay.querySelector('.lightbox-img');
    const closeBtn = overlay.querySelector('.lightbox-close');

    const open = (src, alt) => {
      lightboxImg.src = src;
      lightboxImg.alt = alt || '';
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    };

    galleryImgs.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        open(img.src, img.alt);
      });
    });

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }
});
