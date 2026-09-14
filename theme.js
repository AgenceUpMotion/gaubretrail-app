export function applySeasonTheme(season='summer'){
  const winter=season==='winter';
  document.body.classList.remove('edition-winter');
  document.body.classList.add('edition-summer');
  document.documentElement.dataset.season=winter?'winter':'summer';
  document.documentElement.style.colorScheme='light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#ffffff');
}
