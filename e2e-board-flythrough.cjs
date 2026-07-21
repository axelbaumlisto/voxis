const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const dir = 'landing-screenshots';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Loading landing...');
  await page.goto('https://voxis-landing.vercel.app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/v-hero.png` });

  // Find the architecture section and its scrollable height (md:h-[600vh]).
  const arch = await page.evaluate(() => {
    const el = document.getElementById('architecture');
    const rect = el.getBoundingClientRect();
    return { top: window.scrollY + rect.top, height: el.offsetHeight };
  });
  console.log('Architecture:', arch);

  // Walk the fly-through in fractions so every layer becomes the focused one.
  const fractions = [0.02, 0.14, 0.30, 0.46, 0.62, 0.78, 0.92];
  for (let i = 0; i < fractions.length; i++) {
    const f = fractions[i];
    const y = arch.top + arch.height * f;
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
    await page.waitForTimeout(1200);
    const name = `${dir}/v-board-${String(i + 1).padStart(2, '0')}-f${Math.round(f * 100)}.png`;
    await page.screenshot({ path: name });
    console.log('Captured', name);
  }

  await browser.close();
  console.log('Done.');
})();
