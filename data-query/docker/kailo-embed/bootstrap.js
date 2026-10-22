(function () {
  var page = location.pathname;
  var query = new URLSearchParams(location.search);
  var meta = function (name) {
    var node = document.querySelector('meta[name="' + name + '"]');
    return node ? node.getAttribute('content') || '' : '';
  };
  var origins = meta('kailo-web-origin').split(/\s+/).filter(function (value) {
    try {
      var url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
    } catch (error) {
      return false;
    }
  });
  var embedded = window.top !== window.self;
  var stored = {};
  try {
    stored = JSON.parse(window.sessionStorage.getItem('kailo-embed-presentation') || '{}') || {};
  } catch (error) {}
  var inner = function (name) {
    try {
      return new URL(query.get('returnTo') || '/', location.origin).searchParams.get(name);
    } catch (error) {
      return null;
    }
  };
  var locale = query.get('kailo_locale') || inner('kailo_locale') || stored.locale || 'zh-CN';
  var dark = (query.get('kailo_theme') || inner('kailo_theme') || stored.theme) === 'dark';
  var english = locale === 'en';
  document.documentElement.lang = english ? 'en' : 'zh-CN';
  if (dark) document.documentElement.setAttribute('data-kailo-theme', 'dark');
  var text = english
    ? { expired: 'Your session has ended. Sign in to Kailo again to continue.', out: 'You have signed out.', back: 'Back to Kailo' }
    : { expired: '登录状态已失效，请重新登录 Kailo 后继续。', out: '已退出登录。', back: '返回 Kailo' };
  var local = function (value) {
    return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' && !/[\\\u0000- \u007f]/.test(value) ? value : '/';
  };
  var post = function (type) {
    if (!embedded) return;
    for (var i = 0; i < origins.length; i++) window.parent.postMessage({ source: 'kailo-embed', version: 1, type: type }, origins[i]);
  };
  var show = function (message, href) {
    document.getElementById('t').textContent = message;
    var link = document.getElementById('l');
    if (href) {
      link.textContent = text.back;
      link.setAttribute('href', href);
    } else {
      link.style.display = 'none';
    }
    document.getElementById('m').style.display = 'block';
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
    probe(function (ok) {
      if (ok) {
        location.replace(target);
        return;
      }
      post('auth-required');
      show(text.expired, null);
    });
  } else if (page === '/kailo-embed/signed-out') {
    var logout = meta('kailo-logout-url');
    if (!embedded && logout) {
      location.replace(logout);
      return;
    }
    show(text.out, embedded ? null : origins[0] ? origins[0] + '/' : null);
  }
})();
