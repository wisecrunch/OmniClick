const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
(async()=>{
 const root=path.resolve(__dirname, '..');
 const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'omniclick-tabs-')),{headless:true,channel:'msedge',viewport:{width:1280,height:800},colorScheme:'light',args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 ctx.setDefaultTimeout(10000);
 try{
 const errors=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
 await worker.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.clear()});
 const html=`<!doctype html><meta charset="utf-8"><title>Inbox - demo@example.com - Gmail</title><style>body{margin:0;background:#f6f8fc;font:14px Arial;color:#263247}header{padding:24px 32px;font-size:24px}aside{float:left;width:200px;padding:12px 24px}aside a{display:block;padding:12px;color:#444746;text-decoration:none}main{margin:0 24px 0 230px;background:white;min-height:680px;border-radius:18px;overflow:hidden}.mail-body{padding:26px}h2{font-weight:400}.row{padding:18px;border-bottom:1px solid #eee}.sender{display:inline-block;width:160px}.search{font-size:14px;background:#eaf1fb;border-radius:30px;margin-left:60px;padding:15px 30px;display:inline-block;width:550px}input{font:inherit}</style><header>☰ &nbsp; Gmail <span class="search">⌕ &nbsp; Search mail</span></header><aside role="navigation"><a href="#inbox">Inbox</a><a href="#starred">Starred</a><a href="#label/Projects">Projects</a><a href="#label/Projects%2FAtlas">&nbsp; Atlas</a><a href="#label/Projects%2FAtlas%2FDesign">&nbsp; &nbsp; Design</a><a href="#label/Projects2">Projects2</a></aside><main role="main"><div class="mail-body"><h2>Your inbox</h2><p>Favorite labels and saved searches, one click away.</p><div class="row"><b class="sender">Maya Chen</b> Project Atlas - next steps</div><div class="row"><b class="sender">Alex Morgan</b> Meeting notes and attachments</div><div class="row"><b class="sender">Design team</b> Ready for review</div></div></main>`;
 await ctx.route('https://mail.google.com/**',r=>r.fulfill({contentType:'text/html',body:html}));
 const page=await ctx.newPage();await page.goto('https://mail.google.com/mail/u/0/#inbox');await page.waitForTimeout(500);
 assert.equal(await page.locator('.oc-tabs').count(),0,'default off');
 const popup=await ctx.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 const toggle=popup.getByRole('checkbox',{name:'Custom Gmail tabs',exact:true});
 assert.equal(await toggle.locator('..').getAttribute('class'),'switch');await toggle.check();
 await page.locator('.oc-tabs').waitFor();assert.equal(await page.locator('.oc-tabs-link').count(),3);
 assert.equal(await page.getByRole('link',{name:'Inbox',exact:true}).last().getAttribute('aria-current'),'page');
 // Pin label and descendants; exact OR queries exclude unrelated label prefixes.
 await page.evaluate(()=>location.hash='#label/Projects');await page.waitForTimeout(250);
 await page.getByRole('button',{name:'Save current Gmail view as a tab',exact:true}).click();
 await page.getByLabel('Tab name',{exact:true}).fill('Projects');await page.getByLabel('Include sublabels',{exact:false}).check();
 await page.getByLabel('Background',{exact:true}).fill('#dff2d8');await page.getByLabel('Text color',{exact:true}).fill('#16482b');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.oc-tabs-dialog').waitFor({state:'detached'});
 const projects=page.locator('.oc-tabs-link').filter({hasText:'Projects'});const target=decodeURIComponent(await projects.getAttribute('href'));
 assert.match(target,/label:"Projects"/);assert.match(target,/label:"Projects\/Atlas"/);assert.match(target,/label:"Projects\/Atlas\/Design"/);assert.doesNotMatch(target,/Projects2/);
 await projects.click();await page.waitForTimeout(250);assert.equal(await projects.getAttribute('aria-current'),'page');
 // Save arbitrary complex search, edit its presentation and query.
 await page.evaluate(()=>location.hash='#search/'+encodeURIComponent('from:client@example.com is:unread has:attachment'));
 await page.waitForTimeout(250);await page.getByRole('button',{name:'Save current Gmail view as a tab',exact:true}).click();
 assert.equal(await page.getByLabel('Show',{exact:true}).inputValue(),'search');
 await page.getByLabel('Tab name',{exact:true}).fill('Client follow-ups');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('.oc-tabs-dialog').waitFor({state:'detached'});
 await page.getByRole('button',{name:'Edit Client follow-ups',exact:true}).click();
 await page.getByLabel('Tab name',{exact:true}).fill('Clients');await page.getByLabel('Search query or label name',{exact:true}).fill('from:client@example.com is:unread');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.oc-tabs-dialog').waitFor({state:'detached'});
 const clients=page.locator('.oc-tabs-link').filter({hasText:/^Clients$/});
 await clients.press('Alt+ArrowLeft');await page.waitForFunction(()=>[...document.querySelectorAll('.oc-tabs-link')].at(-2)?.textContent==='Clients');
 const first=page.locator('.oc-tabs-item').filter({has:clients}),before=page.locator('.oc-tabs-item').first();await first.dragTo(before);
 await page.waitForFunction(()=>document.querySelector('.oc-tabs-link')?.textContent==='Clients');
 await page.reload();await page.locator('.oc-tabs-link').filter({hasText:/^Clients$/}).waitFor();assert.equal(await page.locator('.oc-tabs-link').count(),5);
 assert.equal(await projects.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor),'rgb(223, 242, 216)');
 if (process.env.OMNICLICK_SCREENSHOT) await page.screenshot({path:process.env.OMNICLICK_SCREENSHOT});
 // Sidebar/main rebuild reattaches one bar; no repeated mutation render loop.
 await page.evaluate(()=>{const old=document.querySelector('main'),replacement=old.cloneNode(true);replacement.querySelector('.oc-tabs').remove();old.replaceWith(replacement)});
 await page.locator('main .oc-tabs').waitFor();assert.equal(await page.locator('.oc-tabs').count(),1);
 await page.evaluate(()=>{window.mutations=0;new MutationObserver(r=>window.mutations+=r.length).observe(document.body,{childList:true,subtree:true})});
 await page.waitForTimeout(700);assert.ok(await page.evaluate(()=>window.mutations)<10);
 // Account switch uses separate settings, returning preserves the original account.
 await page.evaluate(()=>document.title='Inbox - other@example.com - Gmail');await page.waitForFunction(()=>document.querySelectorAll('.oc-tabs-link').length===3);
 await page.evaluate(()=>document.title='Inbox - demo@example.com - Gmail');await page.waitForFunction(()=>document.querySelectorAll('.oc-tabs-link').length===5);
 await page.getByRole('button',{name:'Edit Clients',exact:true}).click();await page.getByRole('button',{name:'Delete tab',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.oc-tabs-link').length===4);
 await page.locator('.oc-tabs-add').click();await page.getByLabel('Tab name',{exact:true}).fill('<img src=x onerror=alert(1)>');
 await page.getByLabel('Search query or label name',{exact:true}).fill('is:unread');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('.oc-tabs-dialog').waitFor({state:'detached'});assert.equal(await page.locator('.oc-tabs img').count(),0,'names rendered as text');
 await page.setViewportSize({width:520,height:800});assert.equal(await page.locator('.oc-tabs').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
 await page.locator('.oc-tabs-add').click();await toggle.uncheck();await page.locator('.oc-tabs').waitFor({state:'detached'});assert.equal(await page.locator('.oc-tabs-dialog').count(),0);
 await toggle.check();await page.locator('.oc-tabs').waitFor();assert.equal(await page.locator('.oc-tabs-link').count(),5,'disable preserves saved tabs');
 assert.deepEqual(errors,[]);console.log('PASS: real extension toggle, label/sublabel queries, arbitrary search, edit/colors, click navigation, drag/keyboard reorder, reload persistence, account isolation, Gmail redraw, no mutation loop, delete, safe text, narrow width, live disable cleanup.');
 }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exit(1)});
