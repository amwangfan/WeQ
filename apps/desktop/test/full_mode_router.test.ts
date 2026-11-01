// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { accountRouter } from '../src/main/ipc/routers/account';
import { bootstrapRouter } from '../src/main/ipc/routers/bootstrap';
import { fullModeAllowed, clearFullMode } from '../src/main/context/full_mode';
const f = vi.hoisted(() => {
  const settings = { autoAttachQq: false };
  const ssoReady = { value: false };
  const services = {
    accountConfig: {
      getRecord: () => ({ uin: '10001', configId: 'synthetic-live', qqPid: ssoReady.value ? 4242 : null }),
    },
  };
  const host = {
    account: { context: { uin: '10001' } },
    bootstrap: {
      userConfig: {
        getSettings: () => settings,
        setSettings: (patch: Partial<typeof settings>) => Object.assign(settings, patch),
      },
    },
    applyFullModePolicy: vi.fn(),
    refreshRkeysNow: vi.fn(),
    services,
  };
  return { host, settings, services, ssoReady };
});
vi.mock('../src/main/context/app_context', () => ({
  getAppContext: () => f.host,
  requireBootstrap: () => f.host.bootstrap,
  requirePlatform: () => ({
    native: { ntHelper: { hasSsoSession: async () => f.ssoReady.value } },
  }),
}));
beforeEach(() => {
  clearFullMode(f.host);
  f.host.account = { context: { uin: '10001' } };
  f.host.services = f.services;
  f.settings.autoAttachQq = false;
  f.host.applyFullModePolicy.mockClear();
  f.host.refreshRkeysNow.mockReset().mockResolvedValue(true);
});
const input = { expectedAccountUin: '10001', expectedAccountConfigId: 'synthetic-live' };
it('真实路由只记录当前宿主运行请求，不写持久偏好且不宣称凭据就绪', async () => {
  expect(fullModeAllowed(f.host)).toBe(false);
  expect(await accountRouter.createCaller({}).requestFullMode(input)).toEqual({ requested: true });
  expect(fullModeAllowed(f.host)).toBe(true);
  expect(f.host.bootstrap.userConfig.getSettings().autoAttachQq).toBe(false);
});
it('窗口/Web 查询共同读取宿主运行态；关闭自动策略仍保留手动请求', async () => {
  const caller = bootstrapRouter.createCaller({});
  expect(await caller.getFullModeState()).toEqual({ allowed: false, ready: false });
  await accountRouter.createCaller({}).requestFullMode(input);
  expect(await caller.getFullModeState()).toEqual({ allowed: true, ready: false });
  await caller.setAutoAttachQq({ enabled: false });
  expect(f.host.applyFullModePolicy).toHaveBeenCalledOnce();
  expect(await caller.getFullModeState()).toEqual({ allowed: true, ready: false });
  expect(f.settings.autoAttachQq).toBe(false);
});
// whale-io 部署线：ready 只在「允许 + 有在线 pid + SSO 会话已登记」时为真。
it('ready 反映 SSO 会话登记状态，不只是策略门', async () => {
  const caller = bootstrapRouter.createCaller({});
  await accountRouter.createCaller({}).requestFullMode(input);
  // 允许但无 SSO 登记 → 未就绪
  expect(await caller.getFullModeState()).toEqual({ allowed: true, ready: false });
  // 登记完成（夹具带上 qqPid 且 hasSsoSession 为真）→ 就绪
  f.ssoReady.value = true;
  expect(await caller.getFullModeState()).toEqual({ allowed: true, ready: true });
  // 关窗后即便登记仍在，策略不允许也就绪失败
  await caller.setAutoAttachQq({ enabled: false });
  clearFullMode(f.host);
  expect(await caller.getFullModeState()).toEqual({ allowed: false, ready: false });
});
it.each([
  { ...input, expectedAccountUin: '10002' },
  { ...input, expectedAccountConfigId: 'synthetic-backup' },
])('旧账号或同号旧来源不能授权当前来源', async (stale) => {
  await expect(accountRouter.createCaller({}).requestFullMode(stale)).rejects.toThrow('已切换');
  expect(fullModeAllowed(f.host)).toBe(false);
});
it('拒绝来源缺失或未经授权的请求', async () => {
  await expect(accountRouter.createCaller({}).requestFullMode(JSON.parse('{}'))).rejects.toThrow();
  await expect(
    accountRouter
      .createCaller({
        authorize: () => {
          throw new Error('合成拒绝');
        },
      })
      .requestFullMode(input),
  ).rejects.toThrow('合成拒绝');
  expect(fullModeAllowed(f.host)).toBe(false);
});
it('刷新凭据前验证完整来源，等待后不把旧成功交给新实例', async () => {
  await expect(
    accountRouter
      .createCaller({})
      .refreshRkeys({ ...input, expectedAccountConfigId: 'synthetic-old' }),
  ).rejects.toThrow('已切换');
  expect(f.host.refreshRkeysNow).not.toHaveBeenCalled();
  f.host.refreshRkeysNow.mockImplementationOnce(async () => {
    f.host.services = {
      accountConfig: { getRecord: () => ({ uin: '10001', configId: 'synthetic-live' }) },
    };
    return true;
  });
  await expect(accountRouter.createCaller({}).refreshRkeys(input)).rejects.toThrow('已切换');
});
