(function () {
    'use strict';

    // Utility: read cookie by name
    function readCookie(name) {
        const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
        return m ? decodeURIComponent(m[1]) : null;
    }

    function setText(el, txt) { if (el) el.textContent = txt; }

    // Pricing toggle
    const pricingToggle = document.getElementById('pricingToggle');
    const monthlyLabels = document.querySelectorAll('.toggle-label.monthly');
    const yearlyLabels = document.querySelectorAll('.toggle-label.yearly');
    const monthlyPrices = document.querySelectorAll('.monthly-price');
    const yearlyPrices = document.querySelectorAll('.yearly-price');
    if (pricingToggle) {
        pricingToggle.addEventListener('change', function () {
            if (this.checked) {
                monthlyLabels.forEach(l => l.classList.remove('active'));
                yearlyLabels.forEach(l => l.classList.add('active'));
                monthlyPrices.forEach(p => p.style.display = 'none');
                yearlyPrices.forEach(p => p.style.display = 'flex');
            } else {
                monthlyLabels.forEach(l => l.classList.add('active'));
                yearlyLabels.forEach(l => l.classList.remove('active'));
                monthlyPrices.forEach(p => p.style.display = 'flex');
                yearlyPrices.forEach(p => p.style.display = 'none');
            }
        });
    }

    // FAQ toggle
    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', () => {
            const ans = q.nextElementSibling;
            const ic = q.querySelector('.faq-icon');
            if (!ans) return;
            ans.classList.toggle('active');
            if (ic) ic.classList.toggle('rotated');
            document.querySelectorAll('.faq-question').forEach(other => {
                if (other !== q) {
                    const oa = other.nextElementSibling;
                    const oi = other.querySelector('.faq-icon');
                    if (oa) oa.classList.remove('active');
                    if (oi) oi.classList.remove('rotated');
                }
            });
        });
    });

    // Smooth anchors
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', function (e) {
            e.preventDefault();
            const id = this.getAttribute('href');
            if (!id || id === '#') return;
            const el = document.querySelector(id);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // Burger / sidebar
    const burgerMenu = document.getElementById('burgerMenu');
    const sidebarMenu = document.getElementById('sidebarMenu');
    const closeSidebar = document.getElementById('closeSidebar');
    if (burgerMenu && sidebarMenu) {
        burgerMenu.addEventListener('click', e => { e.stopPropagation(); sidebarMenu.classList.add('active'); });
    }
    if (closeSidebar && sidebarMenu) {
        closeSidebar.addEventListener('click', e => { e.stopPropagation(); sidebarMenu.classList.remove('active'); });
    }
    document.addEventListener('click', e => {
        if (!sidebarMenu) return;
        const inside = sidebarMenu.contains(e.target) || (burgerMenu && burgerMenu.contains(e.target));
        if (!inside) sidebarMenu.classList.remove('active');
    });

    // Promo UI & hardened logic
    const promoToggle = document.getElementById('promoToggle');
    const promoInput = document.getElementById('promoInput');
    const promoCode = document.getElementById('promoCode');
    const promoApply = document.getElementById('promoApply');
    const promoMsg = document.getElementById('promoMsg');

    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    function safeShowMessage(txt, type) {
        setText(promoMsg, txt);
        if (!promoMsg) return;
        if (type === 'ok') promoMsg.style.color = 'var(--secondary)';
        else if (type === 'warn') promoMsg.style.color = 'var(--warning)';
        else promoMsg.style.color = 'var(--danger)';
    }

    function addActivatedBadge() {
        const featured = document.querySelector('.pricing-plan.featured');
        if (featured && !featured.querySelector('.promo-activated')) {
            const badge = document.createElement('div');
            badge.className = 'promo-activated';
            badge.textContent = 'Activated';
            featured.prepend(badge);
        }
    }

    // Verify server-side pro status
    async function verifyProStatus() {
        try {
            const resp = await fetch('/api/account', { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } });
            if (!resp.ok) return false;
            const j = await resp.json();
            if (j && j.pro === true) {
                localStorage.setItem('scalpel_pro', 'true');
                addActivatedBadge();
                if (promoToggle) promoToggle.style.display = 'none';
                return true;
            }
        } catch (e) { /* don't leak */ }
        return false;
    }

    function getCsrfToken() { return readCookie('XSRF-TOKEN') || ''; }

    async function applyPromo() {
        if (!promoCode || !promoApply || !promoMsg) return;
        if (attempts >= MAX_ATTEMPTS) { safeShowMessage('Too many attempts. Try later.', 'err'); return; }

        const code = (promoCode.value || '').trim();
        if (!code) { safeShowMessage('Please enter a code.', 'warn'); return; }
        if (!/^[A-Za-z0-9\-_]{3,64}$/.test(code)) { safeShowMessage('Invalid code format.', 'warn'); return; }

        attempts += 1;
        promoApply.disabled = true;
        safeShowMessage('Verifying...', 'warn');

        const csrf = getCsrfToken();
        try {
            const resp = await fetch('/api/redeem-promo', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Accept': 'application/json' },
                body: JSON.stringify({ promoCode: code })
            });
            let result = null;
            try { result = await resp.json(); } catch (err) { /* ignore parse error */ }

            if (resp.ok && result && result.success) {
                const verified = await verifyProStatus();
                if (verified) safeShowMessage('Pro access granted!', 'ok');
                else safeShowMessage('Promo accepted. Verifying account...', 'ok');
            } else {
                const msg = result && result.message ? result.message : 'Invalid code or already used.';
                safeShowMessage(msg, 'err');
                const backoff = Math.min(30000, 1000 * Math.pow(2, attempts));
                setTimeout(() => { promoApply.disabled = false; }, backoff);
            }
        } catch (e) {
            safeShowMessage('Network or server error. Try again later.', 'err');
        } finally {
            promoApply.disabled = false;
        }
    }

    if (promoToggle && promoInput) {
        promoToggle.addEventListener('click', () => {
            promoToggle.style.display = 'none';
            promoInput.classList.add('visible');
            promoInput.setAttribute('aria-hidden', 'false');
            promoToggle.setAttribute('aria-expanded', 'true');
            setTimeout(() => promoCode && promoCode.focus(), 150);
        });
    }

    if (promoApply && promoCode) {
        promoApply.addEventListener('click', applyPromo);
        promoCode.addEventListener('keyup', e => { if (e.key === 'Enter') applyPromo(); });
    }

    // On load verify cached pro state with server
    (function init() {
        if (localStorage.getItem('scalpel_pro') === 'true') {
            verifyProStatus().then(v => { if (!v) localStorage.removeItem('scalpel_pro'); });
        } else {
            verifyProStatus();
        }
    })();

    async function applyPromo() {
        if (!promoCode || !promoApply || !promoMsg) return;
        if (attempts >= MAX_ATTEMPTS) {
            safeShowMessage('Too many attempts. Please try again later.', 'err');
            return;
        }

        const code = (promoCode.value || '').trim();
        if (!code) {
            safeShowMessage('Please enter a code.', 'warn');
            return;
        }

        // Basic client-side validation
        if (!/^[A-Za-z0-9\-_]{3,64}$/.test(code)) {
            safeShowMessage('Invalid code format.', 'warn');
            return;
        }

        attempts += 1;
        promoApply.disabled = true;
        safeShowMessage('Verifying...', 'warn');

        const csrf = getCsrfToken();

        try {
            const resp = await fetch('/api/redeem-promo', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ promoCode: code })
            });

            let result = null;
            try { result = await resp.json(); } catch (_) { /* ignore parse errors */ }

            if (resp.ok && result && result.success) {
                const verified = await verifyProStatus();
                if (verified) {
                    safeShowMessage('Pro access granted!', 'ok');
                } else {
                    safeShowMessage('Promo accepted. Verifying account...', 'ok');
                }
            } else {
                const msg = result && result.message ? result.message : 'Invalid code or already used.';
                safeShowMessage(msg, 'err');
                const backoffMs = Math.min(30000, 1000 * Math.pow(2, attempts));
                setTimeout(() => { promoApply.disabled = false; }, backoffMs);
            }
        } catch (e) {
            safeShowMessage('Network or server error. Try again later.', 'err');
        } finally {
            promoApply.disabled = false;
        }
    }

    if (promoToggle && promoInput) {
        promoToggle.addEventListener('click', () => {
            promoToggle.style.display = 'none';
            promoInput.classList.add('visible');
            promoInput.setAttribute('aria-hidden', 'false');
            promoToggle.setAttribute('aria-expanded', 'true');
            setTimeout(() => promoCode && promoCode.focus(), 150);
        });
    }

    if (promoApply && promoCode) {
        promoApply.addEventListener('click', applyPromo);
        promoCode.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') applyPromo();
        });
    }

    // On load: if local flag exists, verify with server before trusting it
    (function initProState() {
        if (localStorage.getItem('scalpel_pro') === 'true') {
            // verify server-side
            verifyProStatus().then(verified => {
                if (!verified) {
                    localStorage.removeItem('scalpel_pro');
                }
            });
        } else {
            // no local flag, still check server in case session already has pro
            verifyProStatus();
        }
    })();

})(); 
