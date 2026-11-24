// Four people: alice (Workspace owner, platform administrator), bob and carol (members), dave (outsider, another
// domain so no auto-join). Fresh accounts through the internal accounts API, then a real Keycloak login each (zh-CN).
export default {
  id: '00-accounts',
  title: '四个测试账号开通并经 Keycloak 登录（zh-CN）',
  covers: ['环①：Keycloak 登录'],
  after: [],
  locks: {},
  est: 90,
  async run(h) {
    h.S.runStart = h.S.runStart || new Date().toISOString();
    const people = [['alice', '安', '林'], ['bob', '博', '周'], ['carol', '可', '陈'], ['dave', '达', '王']];
    if (!people.every(([n]) => h.acc[n])) {
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const dom = h.cfg.accountDomain || `tg-${ts}.kailo-acceptance.test`;
      h.S.domain = dom;
      for (const [n, first, last] of people) if (!h.acc[n]) await h.provision(n, n === 'dave' ? `dave@x${dom}` : `${n}@${dom}`, first, last);
    } else {
      h.S.domain = h.S.domain || h.acc.alice.email.split('@')[1];
      h.log('reusing accounts of', h.S.domain);
    }
    for (const [n] of people) {
      const x = await h.login(n);
      await h.shot(x.page, `${n}-after-login`);
      // A first sign-in lands on onboarding, which Kailo renders in place at /app/login (features/auth/auth.tsx);
      // a returning person goes straight into the app. Either way the session must be real.
      const url = x.page.url();
      const onboarding = /\/app\/login/.test(url) && /创建你的工作区|开始使用/.test(await h.text(x.page));
      const ws = await h.api(n, 'GET', '/auth/team/workspaces');
      h.check(`${n} 登录后进入 /app（首次登录在原地进入引导）`, new URL(url).pathname.startsWith('/app') && (!/\/login/.test(url) || onboarding) && ws.status === 200,
        `${url} onboarding=${onboarding} workspaces=${ws.status}`);
    }
  },
};
