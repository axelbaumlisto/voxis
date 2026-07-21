const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  if (!fs.existsSync('landing-screenshots')) {
    fs.mkdirSync('landing-screenshots');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("Loading landing page...");
  await page.goto('https://voxis-landing.vercel.app/', { waitUntil: 'networkidle' });

  console.log("Taking Hero screenshot...");
  await page.screenshot({ path: 'landing-screenshots/1-hero.png' });

  console.log("Scrolling to Layer 1...");
  await page.evaluate(() => {
    document.getElementById('architecture').scrollIntoView({ behavior: 'instant' });
    window.scrollBy(0, 100); 
  });
  await page.waitForTimeout(1500); 
  await page.screenshot({ path: 'landing-screenshots/2-layer1.png' });

  console.log("Scrolling to Layer 2...");
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'landing-screenshots/3-layer2.png' });

  console.log("Scrolling to Layer 3...");
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'landing-screenshots/4-layer3.png' });

  await browser.close();
  console.log("Screenshots captured!");
})();
