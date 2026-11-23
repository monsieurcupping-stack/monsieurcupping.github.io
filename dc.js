/* Monsieur Cupping : moteur d'affichage léger (sans dépendance). */
(function () {
  'use strict';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u) {
    var p = typeof u === 'function' ? u(this.state, this.props) : u;
    if (!p) return;
    this.state = Object.assign({}, this.state, p);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  var comp, root, tplRoot, queued = false, mounted = false;
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function resolve(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function str(v) { return v == null || v === false ? '' : String(v); }
  function interp(s, scope) { return s.replace(HOLE, function (_, e) { return str(resolve(e, scope)); }); }

  var BOOL = { autoplay: 1, muted: 1, loop: 1, playsinline: 1, checked: 1, required: 1, disabled: 1, selected: 1, hidden: 1, open: 1 };

  /* Construit un arbre virtuel léger : {t:'#text',v} ou {t,ns,a:{},ev:{},ref,c:[]} */
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      var v = node.nodeValue;
      out.push({ t: '#text', v: v.indexOf('{{') < 0 ? v : interp(v, scope) });
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'template' && node.hasAttribute('data-for')) {
      var list = resolve(node.getAttribute('data-for'), scope) || [];
      var as = node.getAttribute('data-as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope); s[as] = list[i]; s.$index = i;
        kids(node.content, s, out);
      }
      return;
    }
    if (tag === 'template' && node.hasAttribute('data-if')) {
      if (resolve(node.getAttribute('data-if'), scope)) kids(node.content, scope, out);
      return;
    }
    var el = { t: tag, ns: node.namespaceURI, a: {}, ev: {}, ref: null, c: [] };
    for (var j = 0; j < node.attributes.length; j++) {
      var at = node.attributes[j], name = at.name, raw = at.value, m = raw.match(WHOLE);
      if (name.indexOf('hint-') === 0) continue;
      var val = m ? resolve(m[1], scope) : (raw.indexOf('{{') < 0 ? raw : interp(raw, scope));
      if (/^on[a-z]/i.test(name) && name.length > 2) {
        var evn = name.slice(2).toLowerCase();
        if (evn === 'change') {
          var ty = (node.getAttribute('type') || '').toLowerCase();
          evn = (tag === 'select' || ty === 'checkbox' || ty === 'radio') ? 'change' : 'input';
        }
        if (typeof val === 'function') el.ev[evn] = val;
        continue;
      }
      if (name === 'ref') { if (typeof val === 'function') el.ref = val; continue; }
      if (name === 'classname') name = 'class';
      if (name === 'htmlfor') name = 'for';
      el.a[name] = val;
    }
    kids(tag === 'template' ? node.content : node, scope, el.c);
    out.push(el);
  }
  function kids(parent, scope, out) {
    for (var n = parent.firstChild; n; n = n.nextSibling) build(n, scope, out);
  }

  function setAttr(dom, name, val) {
    if (BOOL[name]) {
      var on = !!val && val !== 'false';
      if (name === 'checked' || name === 'muted' || name === 'selected') dom[name] = on;
      if (on) dom.setAttribute(name, ''); else dom.removeAttribute(name);
      return;
    }
    if (name === 'value' && (dom.tagName === 'INPUT' || dom.tagName === 'SELECT' || dom.tagName === 'TEXTAREA')) {
      var sv = str(val);
      if (dom.value !== sv && !(document.activeElement === dom && dom.tagName !== 'SELECT')) dom.value = sv;
      dom.__val = sv;
      return;
    }
    if (val == null || val === false) dom.removeAttribute(name);
    else dom.setAttribute(name, val === true ? '' : String(val));
  }

  function create(v, refs) {
    if (v.t === '#text') return document.createTextNode(v.v);
    var dom = v.ns && v.ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(v.ns, v.t) : document.createElement(v.t);
    for (var k in v.a) if (k !== 'value') setAttr(dom, k, v.a[k]);
    dom.__a = v.a;
    bindEvents(dom, v.ev);
    for (var i = 0; i < v.c.length; i++) dom.appendChild(create(v.c[i], refs));
    if ('value' in v.a) setAttr(dom, 'value', v.a.value);
    if (v.ref) refs.push([dom, v.ref]);
    return dom;
  }
  function bindEvents(dom, ev) {
    if (!dom.__h) dom.__h = {};
    var h = dom.__h;
    for (var k in h) if (!ev[k]) h[k] = null;
    for (var e in ev) {
      if (!(e in h)) {
        (function (type) {
          dom.addEventListener(type, function (evt) { var f = dom.__h[type]; if (f) f(evt); });
        })(e);
      }
      h[e] = ev[e];
    }
  }
  function same(dom, v) {
    if (v.t === '#text') return dom.nodeType === 3;
    return dom.nodeType === 1 && dom.localName === v.t;
  }
  function patch(dom, v, refs) {
    if (v.t === '#text') { if (dom.nodeValue !== v.v) dom.nodeValue = v.v; return; }
    var old = dom.__a || {};
    for (var k in old) if (!(k in v.a)) dom.removeAttribute(k);
    for (var n in v.a) if (n !== 'value' && old[n] !== v.a[n]) setAttr(dom, n, v.a[n]);
    if (n === 'checked') {}
    dom.__a = v.a;
    bindEvents(dom, v.ev);
    patchKids(dom, v.c, refs);
    if ('value' in v.a) setAttr(dom, 'value', v.a.value);
    if ('checked' in v.a) dom.checked = !!v.a.checked;
    if (v.ref) refs.push([dom, v.ref]);
  }
  function patchKids(parent, vs, refs) {
    var nodes = parent.childNodes, i = 0;
    for (; i < vs.length; i++) {
      var cur = nodes[i];
      if (cur && same(cur, vs[i])) patch(cur, vs[i], refs);
      else if (cur) parent.replaceChild(create(vs[i], refs), cur);
      else parent.appendChild(create(vs[i], refs));
    }
    while (parent.childNodes.length > vs.length) parent.removeChild(parent.lastChild);
  }

  function render() {
    queued = false;
    var vals = comp.renderVals() || {};
    var out = [], refs = [];
    kids(tplRoot, vals, out);
    patchKids(root, out, refs);
    for (var i = 0; i < refs.length; i++) { try { refs[i][1](refs[i][0]); } catch (e) {} }
    if (!mounted) {
      mounted = true;
      if (comp.componentDidMount) comp.componentDidMount();
      if (location.hash) {
        var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t) setTimeout(function () { t.scrollIntoView(); }, 60);
      }
    } else if (comp.componentDidUpdate) comp.componentDidUpdate();
  }
  function schedule() {
    if (queued || !mounted) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(render);
  }

  window.addEventListener('DOMContentLoaded', function () {
    tplRoot = document.getElementById('dc-tpl').content;
    root = document.getElementById('dc-root');
    /* eslint-disable no-undef */
    comp = new Component({});
    render();
  });
})();
