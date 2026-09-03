import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mail.tm API Client
const mailTmApi = axios.create({ baseURL: 'https://api.mail.tm' });

const getExecutablePath = () => {
    const paths = [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
};

async function getMailTmDomain() {
    const res = await mailTmApi.get('/domains');
    return res.data['hydra:member'][0].domain;
}

async function createTempAccount(provider) {
    try {
        let address = '';
        let token = '';
        
        console.log(`[Info] Meminta alamat email dari ${provider}...`);
        
        if (provider === 'tempmail_lol') {
            const res = await axios.get('https://api.tempmail.lol/v2/inbox/create', { headers: {'User-Agent': 'Mozilla/5.0'} });
            address = res.data.address;
            token = res.data.token;
        } 
        else if (provider === 'tempmail_io') {
            const res = await axios.post('https://api.internal.temp-mail.io/api/v3/email/new', { min_name_length: 10, max_name_length: 10 }, { headers: {'User-Agent': 'Mozilla/5.0'} });
            address = res.data.email;
            token = address; // temp-mail.io uses the email address as the identifier
        }
        else if (provider === 'tempmail_plus') {
            const domains = ['mailto.plus', 'fexpost.com', 'fexbox.org', 'mailbox.in.ua'];
            const domain = domains[Math.floor(Math.random() * domains.length)];
            const username = crypto.randomBytes(5).toString('hex');
            address = `${username}@${domain}`;
            token = address;
        }

        const password = crypto.randomBytes(8).toString('hex') + 'Aa1!';
        return { address, password, token, provider };
    } catch (e) {
        console.error(`Error create ${provider}:`, e.message);
        // Fallback
        const res = await axios.get('https://api.tempmail.lol/v2/inbox/create', { headers: {'User-Agent': 'Mozilla/5.0'} });
        return { 
            address: res.data.address, 
            password: crypto.randomBytes(8).toString('hex') + 'Aa1!', 
            token: res.data.token,
            provider: 'tempmail_lol'
        };
    }
}

async function getVerificationLink(mailAcc) {
    console.log(`[Info] Menunggu email verifikasi dari Cloudflare di ${mailAcc.provider}...`);
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            let emails = [];
            
            if (mailAcc.provider === 'tempmail_lol') {
                const res = await axios.get(`https://api.tempmail.lol/v2/inbox?token=${mailAcc.token}`, { headers: {'User-Agent': 'Mozilla/5.0'} });
                emails = res.data.emails || [];
            } 
            else if (mailAcc.provider === 'tempmail_io') {
                const res = await axios.get(`https://api.internal.temp-mail.io/api/v3/email/${mailAcc.token}/messages`, { headers: {'User-Agent': 'Mozilla/5.0'} });
                emails = res.data || [];
            }
            else if (mailAcc.provider === 'tempmail_plus') {
                const res = await axios.get(`https://tempmail.plus/api/mails?email=${mailAcc.token}&limit=20&epin=`, { headers: {'User-Agent': 'Mozilla/5.0'} });
                emails = res.data.mail_list || [];
            }
            
            if (emails.length > 0) {
                for (const msg of emails) {
                    const subject = msg.subject || msg.mail_subject || '';
                    if (subject.includes('Verify your email address')) {
                        let content = '';
                        if (mailAcc.provider === 'tempmail_lol') {
                            content = (msg.body || '') + ' ' + (msg.html || '');
                        } 
                        else if (mailAcc.provider === 'tempmail_io') {
                            content = (msg.body_text || '') + ' ' + (msg.body_html || '');
                        }
                        else if (mailAcc.provider === 'tempmail_plus') {
                            const detailRes = await axios.get(`https://tempmail.plus/api/mails/${msg.mail_id}?email=${mailAcc.token}&epin=`, { headers: {'User-Agent': 'Mozilla/5.0'} });
                            content = detailRes.data.text || detailRes.data.html || '';
                        }
                        
                        const match = content.match(/(https:\/\/dash\.cloudflare\.com\/email-verification\?[^\s"'>]+)/);
                        if (match) return match[1];
                        
                        const altMatch = content.match(/(https:\/\/dash\.cloudflare\.com\/[^\s"'>]*verify[^\s"'>]*)/i);
                        if (altMatch) return altMatch[1];
                    }
                }
            }
        } catch (e) {}
    }
    return null;
}

const generateCfPassword = () => crypto.randomBytes(6).toString('hex') + 'Abc@123';

async function autoCreateCloudflare(accCsv, tokenCsv, provider, instanceIndex = 0) {
    console.log('\n[Info] Memulai pembuatan akun temp email...');
    let mailAcc;
    try {
        mailAcc = await createTempAccount(provider);
    } catch (e) {
        console.error('[Error] Gagal membuat akun temp email:', e.message);
        return false;
    }
    
    const cfPassword = generateCfPassword();
    console.log(`[Info] Email Temp: ${mailAcc.address}`);
    console.log(`[Info] CF Password: ${cfPassword}`);

    const userDataDir = path.resolve(`./profiles/temp_${Date.now()}`);
    const browser = await puppeteer.launch({
        userDataDir,
        executablePath: getExecutablePath(),
        headless: false,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            // Background mode: pojok kanan-bawah monitor utama (1920x1080), cascade 300px per instance
            // (offset 40px terlalu kecil — window 1280x720 tumpuk 95%, yang lain ketutup)
            `--window-position=${560 + (instanceIndex % 3) * 300},${280 + Math.floor(instanceIndex / 3) * 220}`,
            '--window-size=1280,720',
            '--disable-infobars',
            '--proxy-server=socks5://127.0.0.1:40000'
        ]
    });

    // Background mode: jaga z-order window tetap di belakang semua window lain
    // (tetap kelihatan di pojok, tapi gak popup/steal fokus). Chrome activate
    // window saat navigasi (signup->dashboard->verifikasi), jadi push sekali
    // gak cukup — interval guard jalan sampai browser mati.
    // Pakai -EncodedCommand agar tidak menulis file .ps1 (anti AV delete).
    let lowerTimer = null;
    try {
        const psLower = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$p = Get-Process -Id ${browser.process().pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) { [W]::SetWindowPos($p.MainWindowHandle, [IntPtr]1, 0, 0, 0, 0, 0x0001 -bor 0x0002) | Out-Null }
`;
        const pushLower = () => {
            try {
                execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(psLower, 'utf16le').toString('base64')}`, { stdio: 'ignore' });
            } catch (e) {
                if (lowerTimer) { clearInterval(lowerTimer); lowerTimer = null; } // chrome mati, stop guard
            }
        };
        lowerTimer = setInterval(pushLower, 5000);
        console.log(`[Info-${instanceIndex}] Z-order guard aktif (push ke belakang tiap 5 detik).`);
    } catch (e) {
        console.log(`[Warn-${instanceIndex}] Gagal setup z-order guard: ${e.message}`);
    }

    try {
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        


        await page.setViewport({ width: 1280, height: 720 });
        
        console.log('[Info] Membuka Cloudflare Sign Up...');
        await page.goto('https://dash.cloudflare.com/sign-up', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log(`[Warn] Gagal load sign-up: ${e.message}, lanjut...`));

        // Tunggu input selector dengan toleransi ID dinamis
        console.log('[Info] Mengisi formulir pendaftaran Cloudflare...');
        const emailInput = await page.waitForSelector('input[type="email"], input[autocomplete="email"], input[name="email"]', { timeout: 20000 });
        await emailInput.focus();
        await emailInput.evaluate(el => el.value = '');
        await emailInput.type(mailAcc.address, { delay: 100 });

        const passwordInput = await page.waitForSelector('input[type="password"], input[autocomplete="new-password"], input[name="password"]', { timeout: 20000 });
        await passwordInput.focus();
        await passwordInput.evaluate(el => el.value = '');
        await passwordInput.type(cfPassword, { delay: 100 });

        await new Promise(r => setTimeout(r, 2000));

        // Auto click Turnstile Captcha jika ada
        try {
            console.log('[Info] Mencari elemen berdasar label teks "Let us know you are human"...');
            
            let labelBox = null;
            // Tunggu hingga elemen label muncul (maks 15 detik)
            for (let i = 0; i < 15; i++) {
                labelBox = await page.evaluate(() => {
                    const els = Array.from(document.querySelectorAll('*'));
                    const label = els.find(el => el.textContent && el.textContent.trim() === 'Let us know you are human');
                    if (label) {
                        const rect = label.getBoundingClientRect();
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                    return null;
                });
                
                if (labelBox && labelBox.x > 0) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (labelBox) {
                console.log(`[Info] Label CAPTCHA ditemukan! Scroll ke bawah dan menyiapkan auto-click (anti-bot)...`);
                
                // Scroll ke bawah mentok agar kotak CAPTCHA terlihat jelas di layar
                await page.evaluate(() => {
                    window.scrollBy({ top: 800, behavior: 'smooth' });
                });
                await new Promise(r => setTimeout(r, 1000)); // Tunggu animasi scroll selesai
                
                // Karena kita baru saja men-scroll halaman, koordinat Y (vertical) relatif terhadap viewport
                // berubah. Puppeteer mouse.move bekerja berdasarkan koordinat viewport (bukan koordinat absolut dokumen).
                // Sehingga kita perlu menghitung ulang posisi boundingBox setelah di-scroll.
                const updatedLabelBox = await page.evaluate(() => {
                    const els = Array.from(document.querySelectorAll('*'));
                    const label = els.find(el => el.textContent && el.textContent.trim() === 'Let us know you are human');
                    if (label) {
                        const rect = label.getBoundingClientRect();
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                    return null;
                });
                
                if (!updatedLabelBox) {
                     console.log('[Info] Gagal menemukan ulang kordinat setelah scroll.');
                } else {
                    const clickX = updatedLabelBox.x + 25;
                    const clickY = updatedLabelBox.y + 80; 
                    
                    // Gerak acak di sekitar target dulu
                    await page.mouse.move(clickX - 80, clickY - 40, { steps: 15 });
                    await new Promise(r => setTimeout(r, 150 + Math.random() * 100));
                    await page.mouse.move(clickX + 30, clickY + 20, { steps: 15 });
                    await new Promise(r => setTimeout(r, 150 + Math.random() * 100));
                
                // Mendarat di target
                await page.mouse.move(clickX, clickY, { steps: 20 });
                
                // Jeda acak 4-7 detik agar CAPTCHA termuat sempurna & terlihat seperti manusia yang ragu-ragu
                const preClickDelay = Math.floor(Math.random() * 3000) + 4000;
                console.log(`[Info] Menunggu jeda acak (${(preClickDelay/1000).toFixed(1)} detik) agar CAPTCHA termuat sempurna...`);
                await new Promise(r => setTimeout(r, preClickDelay));
                
                // Klik fisik dengan durasi acak
                await page.mouse.down();
                await new Promise(r => setTimeout(r, Math.random() * 120 + 60)); 
                await page.mouse.up();
                
                // Gerak menjauh setelah klik (sangat manusiawi)
                await new Promise(r => setTimeout(r, 200));
                await page.mouse.move(clickX + 150, clickY + 100, { steps: 20 });
                
                console.log('[Info] ✅ Auto-click fisik Turnstile berhasil dikirim!');
                }
            } else {
                console.log('[Info] Turnstile CAPTCHA tidak terdeteksi langsung (mungkin Anda lolos jalur cepat).');
            }
            
            console.log('[Info] Menunggu hasil verifikasi Turnstile...');
            let isTurnstileSolved = false;
            for (let t = 0; t < 15; t++) {
                try {
                    isTurnstileSolved = await page.evaluate(() => {
                        const el = document.querySelector('[name="cf_challenge_response"], [name="cf-turnstile-response"]');
                        return el && el.value && el.value.length > 10;
                    });
                } catch (e) {}
                
                if (isTurnstileSolved) {
                    console.log('[Sukses] ✅ Token Turnstile didapatkan!');
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (err) {
            console.log(`[Peringatan] Gagal auto-click CAPTCHA: ${err.message}`);
        }

        // Auto click Sign up button
        try {
            const randomDelay = Math.floor(Math.random() * 5000) + 5000; // 5000ms - 10000ms
            console.log(`[Info] Menunggu jeda acak manusiawi (${(randomDelay/1000).toFixed(1)} detik) sebelum klik Sign up...`);
            await new Promise(r => setTimeout(r, randomDelay));
            
            console.log('[Info] Mencoba auto-click tombol Sign up...');
            const submitBtn = await page.waitForSelector('button[type="submit"]', { timeout: 5000 }).catch(() => null);
            if (submitBtn) {
                await submitBtn.click();
                console.log('[Info] Tombol Sign up berhasil diklik.');
            } else {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const signUpBtn = btns.find(b => {
                        const txt = (b.textContent || '').trim().toLowerCase();
                        return txt === 'sign up' || txt.includes('sign up');
                    });
                    if (signUpBtn && !signUpBtn.disabled) {
                        signUpBtn.click();
                    }
                });
                console.log('[Info] Alternatif tombol Sign up diklik.');
            }
        } catch (err) {
            console.log(`[Peringatan] Gagal auto-click tombol Sign up: ${err.message}`);
        }

        console.log('\x1b[33m%s\x1b[0m', '[PENTING] Menunggu proses sign up selesai...');
        console.log('\x1b[31m%s\x1b[0m', '>> JIKA BOT GAGAL/TERTAHAN, SILAKAN SELESAIKAN CAPTCHA & KLIK SIGN UP SECARA MANUAL! <<');

        // Wait for login success
        let isLoggedIn = false;

        for (let i = 0; i < 180; i++) { // Wait up to 180s for signup success (diperpanjang)
            await new Promise(r => setTimeout(r, 1000));

            const url = page.url();
            if (url.includes('dash.cloudflare.com') && !url.includes('sign-up') && !url.includes('login')) {
                isLoggedIn = true;
                break;
            }
        }

        if (!isLoggedIn) {
            console.log('[Warn] Timeout sign up Cloudflare (180 detik terlampaui).');
            return false;
        }
        
        console.log('[Sukses] Berhasil masuk dashboard CF!');
        fs.appendFileSync(accCsv, `${mailAcc.address},${cfPassword}\n`);

        // Check & verify email
        const verifyLink = await getVerificationLink(mailAcc);
        if (verifyLink) {
            console.log(`\n[Info-${instanceIndex}] Link verifikasi ditemukan. Mengunjungi link...`);
            await page.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
                console.log(`[Warn-${instanceIndex}] Timeout navigasi verifikasi (${e.message}), namun akan melanjutkan...`);
            });
            
            console.log(`\x1b[33m%s\x1b[0m`, `[PENTING] Jika muncul CAPTCHA di halaman verifikasi, SILAKAN KLIK MANUAL!`);
            
            // Tunggu sampai redirect ke dashboard (menandakan verifikasi selesai)
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const currentUrl = page.url();
                // Jika URL sudah tidak mengandung 'email-verification', berarti sukses
                if (currentUrl.includes('dash.cloudflare.com') && !currentUrl.includes('email-verification')) {
                    break;
                }
            }
            
            // Reload untuk memastikan session cookie status verified terbaca
            await page.goto('https://dash.cloudflare.com/?verified=true', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 5000));
            console.log(`[Sukses] Email berhasil diverifikasi di Cloudflare.`);
        } else {
            console.log(`[Warn] Link verifikasi tidak ditemukan di email.`);
        }

        // Get IDs & Poll for Email Verification Status
        await page.goto('https://dash.cloudflare.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        
        let cfId = 'TIDAK_DITEMUKAN';
        let userId = 'TIDAK_DITEMUKAN';
        let isVerified = false;
        
        console.log(`[Info] Memastikan status email terverifikasi di backend...`);
        for (let i = 0; i < 15; i++) {
            try {
                const check = await page.evaluate(async () => {
                    const resAcc = await fetch('/api/v4/accounts');
                    const dataAcc = await resAcc.json();
                    const resUser = await fetch('/api/v4/user');
                    const dataUser = await resUser.json();
                    
                    // Terkadang butuh reload data agar cache Cloudflare hilang
                    const resUserRefresh = await fetch('/api/v4/user', { headers: { 'Cache-Control': 'no-cache' }});
                    const dataUserRefresh = await resUserRefresh.json();
                    
                    return {
                        account: (dataAcc.result && dataAcc.result.length > 0) ? dataAcc.result[0].id : null,
                        user: (dataUser.result) ? dataUser.result.id : null,
                        verified: dataUserRefresh.result && dataUserRefresh.result.email ? !dataUserRefresh.result.email.includes('verify') : true // atau kita berasumsi true jika tidak error
                    };
                });
                
                if (check.account) cfId = check.account;
                if (check.user) userId = check.user;
                
                // Kalau API ini sukses diakses, kita anggap sudah siap
                isVerified = true;
                break;
            } catch (e) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        console.log(`[Info] Account ID: ${cfId} | User ID: ${userId}`);

        // ===================================================
        // STRATEGI UTAMA: Intercept RESPONSE dari CF API
        // Ketika dashboard klik "Create Token", CF server kirim 
        // response JSON berisi token value — kita tangkap itu!
        // ===================================================
        console.log(`[Info] Setup response interception untuk /user/tokens...`);
        
        let cfAuthKey = null;
        let cfBearerToken = null;
        let interceptedToken = null;
        
        // Listen response SEBELUM navigasi
        const responseHandler = async (response) => {
            const url = response.url();
            const method = response.request().method();
            if ((url.includes('/user/tokens') || url.includes('/api/v4/user/tokens')) && method === 'POST') {
                try {
                    const status = response.status();
                    const body = await response.json();
                    console.log(`[Info] 🎯 Intercept response /user/tokens - status: ${status}`);
                    if (body.success && body.result?.value) {
                        interceptedToken = body.result.value;
                        console.log(`[Sukses] ✅ TOKEN TERTANGKAP dari response!`);
                    } else {
                        console.log(`[Info] Response token gagal:`, JSON.stringify(body.errors || body));
                    }
                } catch(e) {
                    console.log(`[Info] Error parse response token: ${e.message}`);
                }
            }
        };
        page.on('response', responseHandler);
        
        // Setup request interception untuk menangkap auth headers
        await page.setRequestInterception(true);
        const requestHandler = (req) => {
            const url = req.url();
            const headers = req.headers();
            
            if (url.includes('cloudflare.com') && (url.includes('/client/v4/') || url.includes('/api/v4/'))) {
                // Coba tangkap cross-site-security (CSRF token)
                if (headers['x-cross-site-security'] && !cfAuthKey) {
                    cfAuthKey = headers['x-cross-site-security'];
                    console.log(`[Info] ✅ Intercepted X-Cross-Site-Security CSRF Token!`);
                }
                if (headers['authorization'] && !cfBearerToken && !headers['authorization'].includes('undefined')) {
                    cfBearerToken = headers['authorization'];
                    console.log(`[Info] ✅ Intercepted Authorization Bearer!`);
                }
            }
            
            if (!req.isInterceptResolutionHandled()) req.continue();
        };
        page.on('request', requestHandler);
        
        // Navigasi ke API tokens page
            await page.goto('https://dash.cloudflare.com/profile/api-tokens', { 
                waitUntil: 'domcontentloaded', timeout: 45000 
            }).catch(e => console.log(`[Warn-${instanceIndex}] Timeout load tokens page, lanjut...`));
            await new Promise(r => setTimeout(r, 5000));
            
            // Disable request interception (response listener tetap aktif)
            page.off('request', requestHandler);
            await page.setRequestInterception(false);
            
            console.log(`[Info-${instanceIndex}] Auth status - CSRF Token: ${!!cfAuthKey}, Bearer: ${!!cfBearerToken}`);
        
        // Update account ID dari URL baru jika ada
        const newUrl = page.url();
        const newIdMatch = newUrl.match(/([a-z0-9]{32})/);
        if (newIdMatch && cfId === 'TIDAK_DITEMUKAN') cfId = newIdMatch[1];
        
        const tokenName = mailAcc.address.split('@')[0];
        let apiToken = null;
        
        // ===================================================
        // METHOD A: Internal Dashboard API (CSRF + Session)
        // DIBUAT DENGAN RETRY LOOP KARENA CLOUDFLARE BACKEND SERING DELAY VERIFIKASI!
        // ===================================================
        async function attemptCreateTokenViaInternalApi(maxRetries = 6) {
            if (!cfAuthKey) return false;
            console.log(`[Info-${instanceIndex}] Mencoba Method A: Internal Dashboard API...`);
            for (let retry = 1; retry <= maxRetries; retry++) {
                try {
                    const result = await page.evaluate(async ({ csrfToken, name, accountId, userId }) => {
                        try {
                            const res = await fetch('https://dash.cloudflare.com/api/v4/user/tokens', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-cross-site-security': csrfToken,
                                },
                                body: JSON.stringify({
                                    name: name,
                                    policies: [
                                        {
                                            effect: 'allow',
                                            resources: { 
                                                'com.cloudflare.api.account.*': '*'
                                            },
                                            permission_groups: [
                                                { id: '8d28297797f24fb8a0c332fe0866ec89', name: 'Pages Write' },
                                                { id: 'e086da7e2179491d91ee5f35b3ca210a', name: 'Workers Scripts Write' }
                                            ]
                                        },
                                        {
                                            effect: 'allow',
                                            resources: {
                                                [`com.cloudflare.api.user.${userId}`]: '*'
                                            },
                                            permission_groups: [
                                                { id: '8acbe5bb0d54464ab867149d7f7cf8ac', name: 'User Details Read' }
                                            ]
                                        }
                                    ]
                                })
                            });
                            const data = await res.json();
                            return { success: data.success, value: data.result?.value, errors: data.errors };
                        } catch(e) {
                            return { success: false, error: e.message };
                        }
                    }, { csrfToken: cfAuthKey, name: tokenName, accountId: cfId, userId: userId });
                    
                    if (result.success && result.value) {
                        apiToken = result.value;
                        console.log(`[Sukses-${instanceIndex}] ✅ Token dibuat via Internal API!`);
                        return true;
                    } else {
                        const errStr = JSON.stringify(result.errors || result.error);
                        console.log(`[Info-${instanceIndex}] Internal API gagal (Try ${retry}/${maxRetries}):`, errStr);
                        if (errStr.includes('Please verify your email') || errStr.includes('1211')) {
                            console.log(`[Info-${instanceIndex}] Cloudflare backend belum sinkron status verifikasinya. Menunggu 15 detik...`);
                            await new Promise(r => setTimeout(r, 15000));
                        } else {
                            break; // Error lain
                        }
                    }
                } catch(e) {
                    console.log(`[Info-${instanceIndex}] Internal API error: ${e.message}`);
                    break;
                }
            }
            return false;
        }

        let isTokenSuccess = await attemptCreateTokenViaInternalApi(6);

        // FALLBACK: Resend Email
        if (!isTokenSuccess && !apiToken && cfAuthKey) {
            console.log(`[Peringatan-${instanceIndex}] Gagal verifikasi email (Error 1211) setelah batas waktu. Mencoba RESEND EMAIL...`);
            try {
                // Ke beranda untuk klik resend
                await page.goto('https://dash.cloudflare.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>{});
                await new Promise(r => setTimeout(r, 3000));
                
                await page.evaluate(() => {
                    // Cari tombol/link resend email (seringkali ada di banner alert atas)
                    const links = Array.from(document.querySelectorAll('a, button'));
                    const resend = links.find(l => (l.textContent||'').toLowerCase().includes('send verification email') || (l.textContent||'').toLowerCase().includes('resend'));
                    if (resend) resend.click();
                });
                
                console.log(`[Info-${instanceIndex}] Telah klik Resend Email. Menunggu email baru...`);
                const newLink = await getVerificationLink(mailAcc);
                
                if (newLink) {
                    console.log(`[Info-${instanceIndex}] Link verifikasi BARU ditemukan. Mengunjungi...`);
                    await page.goto(newLink, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>{});
                    await new Promise(r => setTimeout(r, 5000));
                    
                    // Kembali ke tokens
                    await page.goto('https://dash.cloudflare.com/profile/api-tokens', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>{});
                    await new Promise(r => setTimeout(r, 3000));
                    
                    // Coba buat token lagi
                    isTokenSuccess = await attemptCreateTokenViaInternalApi(4);
                } else {
                    console.log(`[Warn-${instanceIndex}] Tidak mendapat link verifikasi baru.`);
                }
            } catch(e) {
                console.log(`[Warn-${instanceIndex}] Gagal melakukan resend email fallback:`, e.message);
            }
        }
        
        // ===================================================
        // METHOD B: Bearer Token dari session  
        // ===================================================
        if (!apiToken && cfBearerToken) {
            console.log(`[Info] Mencoba Method B: Bearer Token API...`);
            try {
                const result = await page.evaluate(async ({ bearer, name, accountId }) => {
                    try {
                        const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': bearer,
                            },
                            body: JSON.stringify({
                                name: name,
                                policies: [
                                    {
                                        effect: 'allow',
                                        resources: { 
                                            [`com.cloudflare.api.account.${accountId}`]: '*'
                                        },
                                        permission_groups: [
                                            { id: 'e086da7e2179491d91ee5f35b3ca210a', name: 'Workers Scripts Write' },
                                            { id: '82e64a83756745bbbb1c9c2701bf816b', name: 'DNS Write' },
                                            { id: 'c8fed203ed3043cba015a93ad1616f1f', name: 'Zone Read' },
                                        ]
                                    }
                                ]
                            })
                        });
                        const data = await res.json();
                        return { success: data.success, value: data.result?.value, errors: data.errors };
                    } catch(e) {
                        return { success: false, error: e.message };
                    }
                }, { bearer: cfBearerToken, name: tokenName, accountId: cfId });
                
                if (result.success && result.value) {
                    apiToken = result.value;
                    console.log(`[Sukses] ✅ Token dibuat via Bearer API!`);
                } else {
                    console.log(`[Info] Method B gagal:`, JSON.stringify(result.errors || result.error));
                }
            } catch(e) {
                console.log(`[Info] Method B error: ${e.message}`);
            }
        }
        
        // ==========================================
        // UI FALLBACK (FULL AUTO)
        // ==========================================
        if (!apiToken) {
            console.log(`[Info] Memulai AUTO UI form... (Lepas mouse kamu!)`);
            
            const clickBtnByText = async (text, partial = false) => {
                return await page.evaluate(({ t, p }) => {
                    const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                    const btn = els.find(b => {
                        const c = (b.textContent || '').trim();
                        return p ? c.startsWith(t) || c === t : c === t;
                    });
                    if (btn && !btn.disabled) { btn.scrollIntoView(); btn.click(); return true; }
                    return false;
                }, { t: text, p: partial });
            };
            
            // 1. Buka form token
            await clickBtnByText('Create Token');
            await new Promise(r => setTimeout(r, 4000));
            
            // 2. Pilih template
            await clickBtnByText('Get started', true);
            await new Promise(r => setTimeout(r, 5000));
            
            // 3. Isi nama token (React Setter Hack)
            await page.evaluate((val) => {
                let input = document.querySelector('input[name="tokenName"]');
                if (!input) {
                    const labels = Array.from(document.querySelectorAll('label'));
                    const tLabel = labels.find(l => l.textContent.includes('Token name'));
                    if (tLabel) {
                        const id = tLabel.getAttribute('for');
                        if (id) input = document.getElementById(id);
                        if (!input && tLabel.parentElement) input = tLabel.parentElement.querySelector('input');
                    }
                }
                if (!input) {
                    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[id^="cf-form-input"]'));
                    input = inputs[0]; 
                }
                if (input) {
                    input.focus();
                    input.value = val;
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    if (nativeInputValueSetter) nativeInputValueSetter.call(input, val);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, tokenName);
            console.log(`[Info] Nama token diisi: ${tokenName}`);
            await new Promise(r => setTimeout(r, 2000));
            
            // 4. Pilih All accounts
            await page.evaluate(() => {
                const selects = Array.from(document.querySelectorAll('div[class*="react-select"], div[class*="Select-control"]'));
                if (selects.length > 1) { 
                    const resourceSelect = selects[1]; 
                    resourceSelect.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                }
            });
            await new Promise(r => setTimeout(r, 1000));
            await page.evaluate(() => {
                const options = Array.from(document.querySelectorAll('div[role="option"]'));
                const allAccounts = options.find(o => (o.textContent || '').includes('All accounts'));
                if (allAccounts) allAccounts.click();
            });
            await new Promise(r => setTimeout(r, 2000));
            
            // 5. Submit
            await page.evaluate(() => {
                const els = Array.from(document.querySelectorAll('button[type="submit"], button[type="button"]'));
                const btn = els.find(b => (b.textContent || '').trim().includes('Continue') || (b.textContent || '').trim().includes('Create'));
                if (btn) { btn.scrollIntoView(); btn.click(); }
            });
            await new Promise(r => setTimeout(r, 4000));
            
            // 6. Konfirmasi akhir
            await clickBtnByText('Create Token');
            
            console.log(`[Info] Menunggu Token...`);
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (interceptedToken) {
                    apiToken = interceptedToken;
                    break;
                }
                // Cek DOM (di code block atau input readonly)
                const domToken = await page.evaluate(() => {
                    const spans = Array.from(document.querySelectorAll('span, code, pre'));
                    for (const s of spans) {
                        const t = s.textContent.trim();
                        if (t.length >= 37 && t.length <= 43 && /^[A-Za-z0-9_-]+$/.test(t)) return t;
                    }
                    const inputs = Array.from(document.querySelectorAll('input'));
                    for (const inp of inputs) {
                        if (inp.value && inp.value.length >= 37 && /^[A-Za-z0-9_-]+$/.test(inp.value)) return inp.value;
                    }
                    return null;
                });
                if (domToken) {
                    apiToken = domToken;
                    break;
                }
            }
        }
        
        page.off('response', responseHandler);
        if (!apiToken && interceptedToken) apiToken = interceptedToken;
        
        // ===================================================
        // SIMPAN HASIL
        // ===================================================
        if (apiToken && apiToken.length >= 35) {
            console.log(`[Sukses-${instanceIndex}] ✅ Token: ${apiToken.substring(0, 8)}...${apiToken.substring(apiToken.length - 4)}`);
            fs.appendFileSync(tokenCsv, `${mailAcc.address},${cfId},${apiToken.trim()}\n`, 'utf8');
            console.log(`[Sukses-${instanceIndex}] Tersimpan di ${tokenCsv}!`);
            return true;
        } else {
            console.log(`[Peringatan-${instanceIndex}] Gagal dapat token otomatis.`);
            return false;
        }

    } catch(e) {
        console.error(`[Error-${instanceIndex}] Terjadi kesalahan: ${e.message}`);
        return false;
    } finally {
        await browser.close();
        // Bersihkan temp folder
        try {
            if (fs.existsSync(userDataDir)) {
                fs.rmSync(userDataDir, { recursive: true, force: true });
            }
        } catch(err) {
            console.log(`[Warn] Gagal menghapus profil sementara: ${err.message}`);
        }
    }
}

function runWarpCmd(cmd, desc) {
    try {
        execSync(`warp-cli ${cmd}`, { stdio: 'ignore', timeout: 15000 });
        return true;
    } catch (e) {
        console.log(`[WARP] ${desc} gagal (${e.message}). Coba start service...`);
        try {
            execSync('net start CloudflareWARP 2>nul || sc start CloudflareWARP 2>nul', { stdio: 'ignore', timeout: 10000 });
        } catch (_) {}
        return false;
    }
}

function ensureWarpReady() {
    // Cek apakah WARP CLI bisa jalan
    try {
        execSync('warp-cli status', { stdio: 'pipe', timeout: 5000 });
        console.log('[WARP] CLI tersedia.');
        return true;
    } catch (e) {
        console.log('[WARP] CLI error. Coba start service...');
        
        // Coba start service
        const svcNames = ['CloudflareWARP', 'CloudflareWarp', 'WarpService'];
        for (const svc of svcNames) {
            try {
                execSync(`net start ${svc}`, { stdio: 'ignore', timeout: 10000 });
                break;
            } catch (_) {}
        }
        
        // Coba launch exe langsung
        const warpPaths = [
            'C:\\Program Files\\Cloudflare\\Cloudflare WARP\\Cloudflare WARP.exe',
            'C:\\Program Files (x86)\\Cloudflare\\Cloudflare WARP\\Cloudflare WARP.exe',
            process.env.LOCALAPPDATA + '\\Cloudflare\\Cloudflare WARP\\Cloudflare WARP.exe'
        ];
        for (const wp of warpPaths) {
            try {
                if (fs.existsSync(wp)) {
                    execSync(`start "" "${wp}"`, { stdio: 'ignore', timeout: 5000, shell: 'cmd.exe' });
                    break;
                }
            } catch (_) {}
        }
        
        // Tunggu CLI siap
        for (let i = 0; i < 30; i++) {
            try {
                execSync('warp-cli status', { stdio: 'pipe', timeout: 3000 });
                console.log('[WARP] CLI siap setelah start.');
                return true;
            } catch (_) {
                execSync('ping -n 2 127.0.0.1 >nul', { stdio: 'ignore' });
            }
        }
        
        console.log('[ERROR] WARP tidak bisa dinyalakan. Buka manual, lalu ulang.');
        return false;
    }
}

async function runJob(count = 1, parallel = 1) {
    // Pastikan WARP jalan — WAJIB, tanpa WARP script berhenti
    if (!ensureWarpReady()) {
        console.log('[ERROR] WARP tidak bisa dinyalakan. Buka Cloudflare WARP manual, lalu jalankan ulang.');
        process.exit(1);
    }

    try {
        execSync('warp-cli mode proxy', { stdio: 'ignore' });
    } catch (e) {
        console.log('[ERROR] Gagal set WARP mode proxy:', e.message);
        process.exit(1);
    }

    // Connect WARP — tanpanya SOCKS5 gak akan listen
    try {
        execSync('warp-cli connect', { stdio: 'ignore' });
        console.log('[Info] WARP connect.');
    } catch (e) {
        console.log('[ERROR] Gagal connect WARP:', e.message);
        process.exit(1);
    }

    // Tunggu SOCKS5 port benar-benar listen
    console.log('[Info] Menunggu SOCKS5 proxy 127.0.0.1:40000...');
    for (let i = 0; i < 20; i++) {
        try {
            execSync('netstat -an | findstr ":40000" | findstr LISTENING', { stdio: 'pipe', timeout: 3000 });
            console.log('[Info] WARP SOCKS5 proxy ready.');
            break;
        } catch (_) {
            if (i === 19) {
                console.log('[ERROR] Port 40000 tidak kunjung listen setelah 20 detik.');
                process.exit(1);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const args = process.argv.slice(2);
    
    const countIndex = args.indexOf('--count');
    if (countIndex !== -1 && args[countIndex + 1]) {
        count = parseInt(args[countIndex + 1], 10);
    }
    
    const parallelIndex = args.indexOf('--parallel');
    if (parallelIndex !== -1 && args[parallelIndex + 1]) {
        parallel = parseInt(args[parallelIndex + 1], 10);
    }

    const providers = ['tempmail_lol'];
    const chosenProvider = providers[Math.floor(Math.random() * providers.length)];

    console.log(`[Info] Akan membuat ${count} akun Cloudflare dengan provider ${chosenProvider}.`);
    console.log(`[Info] Konfigurasi Parallel: ${parallel} browser per batch.\n`);
    
    // Buat nama file dinamis dengan tanggal
    const dateObj = new Date();
    const dateStr = dateObj.getFullYear() +
                    String(dateObj.getMonth() + 1).padStart(2, '0');
                    
    const ACC_CSV = path.join(__dirname, `cf-account-ALL-${dateStr}.csv`);
    const TOKEN_CSV = path.join(__dirname, `cf-token-ALL-${dateStr}.csv`);
    
    if (!fs.existsSync(ACC_CSV)) {
        fs.writeFileSync(ACC_CSV, 'Email,Password\n', 'utf8');
    }
    if (!fs.existsSync(TOKEN_CSV)) {
        fs.writeFileSync(TOKEN_CSV, 'Email,AccountID,APIToken\n', 'utf8');
    }
    
    console.log(`[Info] File Output:`);
    console.log(`       - Accounts: ${ACC_CSV}`);
    console.log(`       - Tokens:   ${TOKEN_CSV}\n`);

    const numBatches = Math.ceil(count / parallel);
    let accountsProcessed = 0;
    
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let b = 0; b < numBatches; b++) {
        const batchSize = Math.min(parallel, count - accountsProcessed);
        console.log(`\n=== Memproses Batch ${b + 1}/${numBatches} (Berisi ${batchSize} Akun) ===`);
        
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
            promises.push(autoCreateCloudflare(ACC_CSV, TOKEN_CSV, chosenProvider, i));
        }
        
        // Wait for all browsers in this batch to finish
        const results = await Promise.allSettled(promises);
        
        // Cek hasil (true jika sukses buat akun/token)
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value === true) {
                totalSuccess++;
            } else {
                totalFailed++;
            }
        }
        
        accountsProcessed += batchSize;
        
        if (accountsProcessed < count) {
            console.log(`\n[Info] Jeda 10 detik sebelum batch berikutnya untuk rotasi IP...`);
            await new Promise(r => setTimeout(r, 10000));
            
            // Auto Rotate IP dengan WARP (SATU KALI PER BATCH)
            console.log(`\n======================================================`);
            console.log(`[WARP] Batch selesai. Memutar IP dengan WARP...`);
            console.log(`======================================================`);
            if (ensureWarpReady()) {
                try {
                    console.log(`[WARP] Memutus koneksi...`);
                    execSync('warp-cli disconnect', { stdio: 'ignore' });
                    await new Promise(r => setTimeout(r, 3000));
                    
                    console.log(`[WARP] Menyambung kembali...`);
                    execSync('warp-cli connect', { stdio: 'ignore' });
                    
                    console.log(`[WARP] Menunggu 10 detik agar IP baru stabil...`);
                    await new Promise(r => setTimeout(r, 10000)); 
                    console.log(`[WARP] Rotasi IP selesai! Melanjutkan batch berikutnya...`);
                } catch (err) {
                    console.log(`[Peringatan] Gagal merotasi IP WARP: ${err.message}`);
                }
            } else {
                console.log(`[Peringatan] WARP tidak bisa dinyalakan, lanjut tanpa rotasi IP.`);
            }
        }
    }
    
    console.log('\n=======================================================');
    console.log('PROSES SELESAI');
    console.log('=======================================================');
    console.log(`[Report] Total Target  : ${count} akun`);
    console.log(`[Report] Sukses        : ${totalSuccess} akun`);
    console.log(`[Report] Gagal         : ${totalFailed} akun`);
    console.log(`[Report] File Akun     : ${ACC_CSV}`);
    console.log(`[Report] File API Token: ${TOKEN_CSV}`);
    console.log('=======================================================\n');
}

// Menu system
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, a => r(a.trim())));

async function showMenu() {
    console.log('=======================================================');
    console.log('  CLOUDFLARE AUTO ACCOUNT CREATOR');
    console.log('=======================================================');
    console.log('  1. Buat akun baru');
    console.log('  2. Lihat file akun');
    console.log('  3. Keluar');
    console.log('=======================================================');
    const choice = await ask('  Pilih [1/2/3]: ');
    
    if (choice === '1') {
        const countInput = await ask('  Jumlah akun (default 1): ');
        const parallelInput = await ask('  Parallel browser (default 1): ');
        const count = parseInt(countInput, 10) || 1;
        const parallel = parseInt(parallelInput, 10) || 1;
        
        console.log('');
        await runJob(count, parallel);
        console.log('');
        await showMenu();
    } else if (choice === '2') {
        const dateObj = new Date();
        const dateStr = dateObj.getFullYear() + String(dateObj.getMonth() + 1).padStart(2, '0');
        const accCsv = path.join(__dirname, `cf-account-ALL-${dateStr}.csv`);
        if (fs.existsSync(accCsv)) {
            const content = fs.readFileSync(accCsv, 'utf8');
            const lines = content.trim().split('\n');
            console.log(`\n  File: ${accCsv}`);
            console.log(`  Total akun: ${lines.length - 1}\n`);
            lines.slice(0, 21).forEach(l => console.log(`  ${l}`));
            if (lines.length > 21) console.log(`  ... dan ${lines.length - 21} lagi`);
        } else {
            console.log('  Belum ada file akun hari ini.');
        }
        console.log('');
        await showMenu();
    } else if (choice === '3') {
        console.log('  Keluar...');
        rl.close();
        process.exit(0);
    } else {
        console.log('  Pilihan tidak valid.\n');
        await showMenu();
    }
}

// Entry point
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
    // Direct mode: node cloudflareAuto.js --count 10 --parallel 3
    runJob().then(() => process.exit(0));
} else {
    // Interactive menu
    showMenu();
}
