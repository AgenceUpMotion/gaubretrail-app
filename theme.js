export const DEFAULT_BRANDING = Object.freeze({primaryColor:'#333399',secondaryColor:'#d900ae'});
const DEFAULT_LOGO='./assets/logo-gaubretrail.svg';
const validColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const validLogo=value=>{
  if(typeof value!=='string')return false;
  const match=/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  return !!match&&match[1].length%4===0&&match[1].length*3/4-(match[1].match(/=+$/)?.[0].length||0)<=300000;
};

export function brandLogoUrl(settings){
  const logo=settings?.branding?.logo;
  return validLogo(logo)?logo:DEFAULT_LOGO;
}

export function applyBranding(settings){
  const branding=settings?.branding||{};
  const primary=validColor(branding.primaryColor)?branding.primaryColor:DEFAULT_BRANDING.primaryColor;
  const secondary=validColor(branding.secondaryColor)?branding.secondaryColor:DEFAULT_BRANDING.secondaryColor;
  const root=document.documentElement.style;
  root.setProperty('--gt-indigo',primary);
  root.setProperty('--gt-indigo-dark',`color-mix(in srgb, ${primary} 48%, #171535)`);
  root.setProperty('--gt-magenta',secondary);
  root.setProperty('--gt-gradient',`linear-gradient(71.32deg, ${primary} -1.7%, ${secondary} 100%)`);
  root.setProperty('--gt-gradient-soft',`linear-gradient(135deg, color-mix(in srgb, ${primary} 9%, white), color-mix(in srgb, ${secondary} 9%, white))`);
  root.setProperty('--gt-soft',`color-mix(in srgb, ${primary} 9%, white)`);
  root.setProperty('--gt-line',`color-mix(in srgb, ${primary} 12%, #e6e1ed)`);
  const logo=brandLogoUrl(settings);
  for(const image of document.querySelectorAll('[data-brand-logo]'))image.src=logo;
}

export function applySeasonTheme(season='summer'){
  const winter=season==='winter';
  document.body.classList.remove('edition-winter');
  document.body.classList.add('edition-summer');
  document.documentElement.dataset.season=winter?'winter':'summer';
  document.documentElement.style.colorScheme='light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#ffffff');
}
