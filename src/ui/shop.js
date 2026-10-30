import { formatPrice } from '../config.js';

const ICONS = {
  clock: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 28V12a7 7 0 0 1 14 0v16z"/><circle cx="16" cy="13" r="4.5"/><path d="M16 17.5V24"/><circle class="dot" cx="16" cy="24.5" r="1.6"/></svg>',
  watch: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12 3h8l1 6M12 3l-1 6M11 23l1 6h8l1-6"/><circle cx="16" cy="16" r="7.5"/><path d="M16 12v4l2.5 1.5"/><circle class="dot" cx="16" cy="16" r="1"/></svg>',
};

const RULES = {
  name: (v) => v.trim().length >= 2 || 'Enter your full name.',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Enter an email address like name@example.com.',
  phone: (v) => !v.trim() || v.replace(/\D/g, '').length >= 7 || 'Enter a phone number with at least 7 digits, or leave it empty.',
  address: (v) => v.trim().length >= 4 || 'Enter your street address.',
  city: (v) => v.trim().length >= 2 || 'Enter your city.',
  zip: (v) => /^[A-Za-z0-9 -]{3,10}$/.test(v.trim()) || 'Enter your postal code.',
  country: (v) => !!v || 'Choose your country.',
};

const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Cart state, the cart drawer and the checkout page. No backend: submitting just confirms the registration.
export class Shop {
  constructor(hooks) {
    this.hooks = hooks;
    this.items = [];
    this.drawerOpen = false;
    this.checkoutOpen = false;
    this.tried = false;
    const $ = (s) => document.querySelector(s);
    this.el = {
      drawer: $('#drawer'), scrim: $('#scrim'), list: $('#drawer-items'), total: $('#drawer-total'),
      count: $('#cart-count'), cartBtn: $('#cart-btn'), close: $('#drawer-close'),
      checkout: $('#checkout'), form: $('#checkout-form'), summary: $('#summary-items'),
      summaryTotal: $('#summary-total'), doneText: $('#done-text'), done: $('#checkout-done'),
    };
    this.el.close.addEventListener('click', () => this.hooks.onDrawerClose('close'));
    this.el.scrim.addEventListener('click', () => this.hooks.onDrawerClose('close'));
    $('#explore-btn').addEventListener('click', () => this.hooks.onDrawerClose('explore'));
    $('#checkout-btn').addEventListener('click', () => this.hooks.onCheckout());
    this.el.cartBtn.addEventListener('click', () => this.hooks.onCartButton());
    $('#done-btn').addEventListener('click', () => this.hooks.onDone());
    this.el.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (b) this.remove(Number(b.dataset.remove));
    });
    this.el.form.addEventListener('submit', (e) => this.submit(e));
    this.el.form.addEventListener('input', (e) => { if (this.tried) this.check(e.target); });
    this.el.form.addEventListener('change', (e) => { if (this.tried) this.check(e.target); });
    this.render();
  }

  get total() { return this.items.reduce((s, i) => s + i.price, 0); }

  add(category, model) {
    this.items.push({ name: model.name, type: model.type, price: model.price, kind: category.builder === 'clock' ? 'clock' : 'watch' });
    this.render();
    this.bump();
  }

  remove(i) {
    this.items.splice(i, 1);
    this.render();
    if (this.checkoutOpen) this.renderSummary();
    if (this.drawerOpen) (this.el.list.querySelector('[data-remove]') || this.el.close).focus();
  }

  clear() {
    this.items = [];
    this.render();
  }

  bump() {
    const b = this.el.cartBtn;
    b.classList.remove('is-bump');
    void b.offsetWidth;
    b.classList.add('is-bump');
  }

  render() {
    const { list, total, count, cartBtn, drawer } = this.el;
    list.textContent = '';
    this.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'drawer-item';
      li.innerHTML = `<span class="thumb">${ICONS[it.kind]}</span><div><h3></h3><p></p></div><div class="meta"><div class="price"></div><button class="remove" type="button" data-remove="${i}">Remove</button></div>`;
      li.querySelector('h3').textContent = it.name;
      li.querySelector('p').textContent = it.type;
      li.querySelector('.price').textContent = formatPrice(it.price);
      li.querySelector('.remove').setAttribute('aria-label', `Remove ${it.name} from cart`);
      list.appendChild(li);
    });
    const n = this.items.length;
    total.textContent = formatPrice(this.total);
    count.textContent = String(n);
    count.classList.toggle('is-zero', n === 0);
    cartBtn.setAttribute('aria-label', `Open cart, ${n} item${n === 1 ? '' : 's'}`);
    drawer.classList.toggle('is-empty', n === 0);
  }

  openDrawer() {
    if (this.drawerOpen) return;
    this.drawerOpen = true;
    this.lastFocus = document.activeElement;
    this.el.drawer.classList.add('is-open');
    this.el.drawer.setAttribute('aria-hidden', 'false');
    this.el.scrim.classList.add('is-on');
    setTimeout(() => this.el.close.focus(), 60);
  }

  closeDrawer() {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    this.el.drawer.classList.remove('is-open');
    this.el.drawer.setAttribute('aria-hidden', 'true');
    this.el.scrim.classList.remove('is-on');
    if (this.lastFocus && this.lastFocus.focus && !this.checkoutOpen) this.lastFocus.focus();
  }

  renderSummary() {
    const ul = this.el.summary;
    ul.textContent = '';
    for (const it of this.items) {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = it.name;
      const small = document.createElement('small');
      small.textContent = it.type;
      a.appendChild(small);
      const b = document.createElement('span');
      b.textContent = formatPrice(it.price);
      li.append(a, b);
      ul.appendChild(li);
    }
    this.el.summaryTotal.textContent = formatPrice(this.total);
  }

  openCheckout() {
    this.renderSummary();
    this.checkoutOpen = true;
    this.tried = false;
    this.el.checkout.classList.remove('is-done');
    this.el.checkout.classList.add('is-open');
    this.el.checkout.setAttribute('aria-hidden', 'false');
    this.el.checkout.scrollTop = 0;
    setTimeout(() => this.el.form.querySelector('input')?.focus(), 450);
  }

  closeCheckout() {
    this.checkoutOpen = false;
    this.el.checkout.classList.remove('is-open');
    this.el.checkout.setAttribute('aria-hidden', 'true');
  }

  check(input) {
    const rule = RULES[input.name];
    if (!rule) return true;
    const res = rule(input.value);
    const field = input.closest('.field');
    const msg = res === true ? '' : res;
    field.classList.toggle('has-error', !!msg);
    field.querySelector('.field-error').textContent = msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  submit(e) {
    e.preventDefault();
    this.tried = true;
    const inputs = [...this.el.form.elements].filter((el) => RULES[el.name]);
    const bad = inputs.filter((el) => !this.check(el));
    if (bad.length) { bad[0].focus(); return; }
    if (!this.items.length) { this.hooks.onDone(); return; }
    const data = new FormData(this.el.form);
    const first = String(data.get('name')).trim().split(/\s+/)[0];
    const names = this.items.map((i) => i.name);
    this.el.doneText.textContent = `Thanks, ${first}. Your ${listNames(names)} ${names.length > 1 ? 'are' : 'is'} registered to ${String(data.get('email')).trim()}.`;
    this.el.checkout.classList.add('is-done');
    this.el.checkout.scrollTop = 0;
    this.el.form.reset();
    this.tried = false;
    setTimeout(() => this.el.done.focus(), 60);
  }
}
