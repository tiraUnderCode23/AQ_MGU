'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1000},deviceScaleFactor:1});
 const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
 await page.goto((process.env.MDRIVE_PREVIEW_URL||'http://localhost:8077')+'/?panel=bottom');
 await page.waitForTimeout(4000);
 await page.locator('#settings [data-key=skin]').selectOption({label:'iDrive 8 - G87'});
 await page.locator('#settings [data-key=demo]').selectOption({label:'Demo - no vehicle commands'});
 const stage=page.locator('#stage');
 const rect=await stage.boundingBox();
 const tap=async(x,y)=>{await page.mouse.click(rect.x+(71+x*1.164)*rect.width/1920,rect.y+(75+y*1.164)*rect.height/720);await page.waitForTimeout(60);};
 await tap(201,484); // Map 2
 await tap(769,484); // Open flap
 await tap(1173,484); // Max cooling On
 await stage.screenshot({path:'preview/m-drive-pressed.png'});
 await page.waitForTimeout(5000);
 const samples=[];for(let i=0;i<5;i++){await page.waitForTimeout(1100);samples.push(await page.locator('#rstats').innerText());}console.log('ID8 samples:',JSON.stringify(samples));
 await stage.screenshot({path:'preview/m-drive.png'});
 await page.locator('#settings [data-key=skin]').selectOption({label:'iDrive 7 - G80'});
 await page.waitForTimeout(2500);
 await stage.screenshot({path:'preview/m-drive-id7.png'});
 const samples7=[];for(let i=0;i<5;i++){await page.waitForTimeout(1100);samples7.push(await page.locator('#rstats').innerText());}console.log('ID7 samples:',JSON.stringify(samples7));
 await page.locator('#settings [data-key=skin]').selectOption({label:'iDrive 8 - G87'});
 await stage.focus();await page.keyboard.press(']');await page.keyboard.press('Enter');
 await page.waitForTimeout(200);
 await page.locator('#settings [data-key=units]').selectOption({label:'Fahrenheit'});
 await page.locator('#settings [data-key=layout]').selectOption({label:'Standard'});
 await page.waitForTimeout(600);
 await stage.screenshot({path:'preview/m-drive-standard.png'});
 await page.locator('#settings [data-key=layout]').selectOption({label:'Full screen'});
 await page.locator('#settings [data-key=units]').selectOption({label:'Celsius'});
 const logs=await page.locator('body').innerText();
 if(/TypeError|ReferenceError|loop MAIN.*Error/.test(logs))errors.push('App runtime error in log');
 await page.screenshot({path:'preview/m-drive-emulator.png',fullPage:true});
 console.log('Page errors:',JSON.stringify(errors));
 await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
