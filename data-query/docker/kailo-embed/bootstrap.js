(function () {
  var page = location.pathname;
  var query = new URLSearchParams(location.search);
  var meta = function (name) {
    var node = document.querySelector('meta[name="' + name + '"]');
    return node ? node.getAttribute('content') || '' : '';
  };
  var allowed = meta('kailo-origins').split(/\s+/).filter(Boolean);
  var embedded = window.top !== window.self;
  var inner = function (name) {
    try {
      return new URL(query.get('returnTo') || '/', location.origin).searchParams.get(name);
    } catch (error) {
      return null;
    }
  };
  var english = /^en/i.test(query.get('kailo_locale') || inner('kailo_locale') || navigator.language || '');
  var text = english
    ? { expired: 'Your session has ended. Sign in again to continue.', signin: 'Sign in', out: 'You have signed out.', back: 'Back' }
    : { expired: '登录状态已失效，请重新登录后继续。', signin: '重新登录', out: '已退出登录。', back: '返回' };
  document.documentElement.lang = english ? 'en' : 'zh-CN';
  var local = function (value) {
    return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' && !/[\\\u0000- \u007f]/.test(value) ? value : '/';
  };
  var kailo = function (value) {
    try {
      var url = new URL(value);
      return allowed.indexOf(url.origin) >= 0 ? url.href : null;
    } catch (error) {
      return null;
    }
  };
  var host = function () {
    var candidates = [];
    if (location.ancestorOrigins && location.ancestorOrigins.length) candidates.push(location.ancestorOrigins[0]);
    try {
      if (document.referrer) candidates.push(new URL(document.referrer).origin);
    } catch (error) {}
    if (allowed.length === 1) candidates.push(allowed[0]);
    for (var i = 0; i < candidates.length; i++) if (allowed.indexOf(candidates[i]) >= 0) return candidates[i];
    return null;
  };
  var tell = function (type, detail) {
    var origin = host();
    if (!embedded || !origin) return;
    window.parent.postMessage({ source: 'kailo-native-page', component: 'data-query', type: type, detail: detail || {} }, origin);
  };
  var show = function (message, label, href, onClick) {
    var box = document.getElementById('m');
    document.getElementById('t').textContent = message;
    var link = document.getElementById('l');
    link.textContent = label;
    link.setAttribute('href', href);
    if (onClick) {
      link.setAttribute('target', '_blank');
      link.addEventListener('click', onClick);
    }
    box.style.display = 'block';
  };
  var probe = function (done) {
    var settled = false;
    var frame = document.createElement('iframe');
    var finish = function (ok) {
      if (settled) return;
      settled = true;
      frame.remove();
      done(ok);
    };
    frame.style.display = 'none';
    frame.addEventListener('load', function () {
      var path = null;
      try {
        path = frame.contentWindow.location.pathname;
      } catch (error) {}
      finish(path === '/kailo-embed/auth-ok');
    });
    setTimeout(function () {
      finish(false);
    }, 15000);
    frame.src = '/auth/login?returnTo=' + encodeURIComponent('/kailo-embed/auth-ok');
    document.body.appendChild(frame);
  };
  if (page === '/kailo-embed/signin') {
    var target = local(query.get('returnTo'));
    if (!embedded) {
      location.replace('/auth/login?returnTo=' + encodeURIComponent(target));
      return;
    }
    var popupLogin = '/auth/login?returnTo=' + encodeURIComponent('/kailo-embed/popup-done');
    window.addEventListener('message', function (event) {
      if (event.origin === location.origin && event.data && event.data.source === 'kailo-native-page' && event.data.type === 'signed-in') location.replace(target);
    });
    probe(function (ok) {
      if (ok) {
        location.replace(target);
        return;
      }
      tell('auth-required', { returnTo: target });
      show(text.expired, text.signin, popupLogin, function (event) {
        var popup = window.open(popupLogin, 'kailo-native-signin', 'popup,width=520,height=680');
        if (popup) event.preventDefault();
      });
    });
  } else if (page === '/kailo-embed/popup-done') {
    if (window.opener) {
      try {
        window.opener.postMessage({ source: 'kailo-native-page', type: 'signed-in' }, location.origin);
      } catch (error) {}
      window.close();
    } else {
      location.replace('/');
    }
  } else if (page === '/kailo-embed/return') {
    location.replace(kailo(query.get('to') || '') || '/');
  } else if (page === '/kailo-embed/signed-out') {
    tell('signed-out');
    var logout = meta('kailo-logout-url');
    if (!embedded && logout) {
      location.replace(logout);
      return;
    }
    var origin = host() || allowed[0];
    show(text.out, text.back, origin ? origin + '/' : '/');
  }
})();
