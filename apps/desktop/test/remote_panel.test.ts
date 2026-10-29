import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemotePanel,
  type RemoteStatus,
} from '../src/renderer/src/components/settings/RemotePanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('电脑端远程连接面板', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const noop = () => {};
  const base: RemoteStatus = {
    available: true,
    helperInstalled: true,
    enabled: true,
    network: { state: 'online', addresses: ['https://192.168.1.8:7691'] },
    invitationExpiresAt: null,
    pending: [],
    devices: [],
  };
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  async function render(data: RemoteStatus, extra = {}) {
    await act(async () =>
      root.render(
        createElement(RemotePanel, {
          data,
          qr: null,
          busy: false,
          error: null,
          onToggle: noop,
          onLogin: noop,
          onInvite: noop,
          onDecide: noop,
          onRevoke: noop,
          ...extra,
        }),
      ),
    );
  }

  it('未安装辅助程序时不能开启，离线时不能生成配对码', async () => {
    await render({
      ...base,
      helperInstalled: false,
      enabled: false,
      network: { state: 'offline' },
    });
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('生成配对码'))
        ?.disabled,
    ).toBe(true);
  });

  it('待批准请求显示校验码，确认与撤销使用设备 ID', async () => {
    const onDecide = vi.fn();
    const onRevoke = vi.fn();
    await render(
      {
        ...base,
        pending: [{ id: 'claim', name: '测试手机', code: '123456', expiresAt: Date.now() + 10000 }],
      },
      { onDecide },
    );
    expect(container.textContent).toContain('123456');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('允许配对'))
        ?.click(),
    );
    expect(onDecide).toHaveBeenCalledWith('claim', true);
    await render(
      { ...base, devices: [{ id: 'device', name: '测试手机', approvedAt: 1, lastSeenAt: null }] },
      { onRevoke },
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="撤销 测试手机"]')?.click(),
    );
    expect(onRevoke).toHaveBeenCalledWith('device');
  });

  it('过期和已消费的二维码不再展示', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const qr = { qr: 'data:image/png;base64,fixture', expiresAt: 3000 };
    await render({ ...base, invitationExpiresAt: 3000 }, { qr });
    expect(container.querySelector('img')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('配对码已失效');
    await render(base, { qr });
    expect(container.querySelector('img')).toBeNull();
  });

  it('只有有效邀请才展示复制配对链接入口', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const onCopy = vi.fn();
    const qr = {
      qr: 'data:image/png;base64,fixture',
      expiresAt: 3000,
      pairingURL: 'weq-remote://pair?fixture=ui-only',
    };
    await render({ ...base, invitationExpiresAt: 3000 }, { qr, onCopy });
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('复制配对链接'),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(onCopy).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).not.toContain('复制配对链接');
  });

  it('Tailscale 界面已剥离：无复选框、无 Key 弹窗、无跨网络说明与启停控件', async () => {
    const onTailscale = vi.fn();
    await render(
      {
        ...base,
        tailscaleEnabled: true,
        network: {
          state: 'online',
          address: 'http://100.64.0.10:7691',
          addresses: ['https://192.168.1.8:7691', 'https://100.64.0.99:7691'],
        },
      },
      { onTailscale },
    );
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('#weq-remote-auth-key')).toBeNull();
    expect(container.textContent).not.toContain('Tailscale');
    expect(container.textContent).not.toContain('内网穿透');
    expect(container.textContent).not.toContain('100.64.0.10');
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent?.includes('启动服务') || b.textContent?.includes('停止服务'),
      ),
    ).toBe(false);
    expect(onTailscale).not.toHaveBeenCalled();
    // 局域网入口照常可用
    expect(container.textContent).toContain('192.168.1.8');
    expect(
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('生成配对码'))
        ?.disabled,
    ).toBe(false);
  });

  it('局域网直接生成配对码，不出现模式、地址选择器或 Tailscale 控件', async () => {
    const onInvite = vi.fn(),
      onTailscale = vi.fn();
    await render({ ...base, mode: 'lan' }, { onInvite, onTailscale });
    expect(container.querySelector('#weq-remote-auth-key')).toBeNull();
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('生成配对码'))
        ?.click(),
    );
    expect(onInvite).toHaveBeenCalledWith(undefined);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[aria-label="连接方式"]')).toBeNull();
    expect(container.querySelector('[aria-label="手机上的 Tailscale"]')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('启动服务')),
    ).toBeUndefined();
    expect(onTailscale).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('内网穿透');
  });

  it('只展示局域网地址；WeQ 专用节点地址与启停不再出现', async () => {
    const onTailscale = vi.fn();
    await render(
      {
        ...base,
        tailscaleEnabled: true,
        network: {
          state: 'online',
          address: 'http://100.64.0.10:7691',
          addresses: ['https://192.168.1.8:7691', 'https://100.64.0.99:7691'],
        },
      },
      { onTailscale },
    );
    expect(container.textContent).toContain('192.168.1.8');
    expect(container.textContent).not.toContain('100.64.0.99');
    expect(container.textContent).not.toContain('100.64.0.10');
    expect(
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('停止服务')),
    ).toBeUndefined();
    expect(onTailscale).not.toHaveBeenCalled();
  });
});
