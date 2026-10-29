// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import type { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { tokenHash } from '../src/main/remote/pairing';
import { RemoteRuntime } from '../src/main/remote/runtime';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeChild(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    exitCode: null,
    kill: vi.fn(function (this: EventEmitter) {
      this.emit('exit', 0);
      return true;
    }),
  }) as unknown as ChildProcessWithoutNullStreams;
}

async function send(child: ChildProcessWithoutNullStreams, event: object): Promise<void> {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`));
  await setImmediate();
}

const ONLINE = {
  state: 'online',
  address: 'https://192.168.1.8:7691',
  addresses: ['https://192.168.1.8:7691', 'https://100.64.0.99:7691'],
  fingerprint: 'f'.repeat(64),
} as const;

describe('远程服务的故障关闭（whale-io 专用线：Tailscale 已剥离）', () => {
  it('启用 Tailscale 被拒绝且不拉进程；局域网入口、配对与已批准设备不受影响', async () => {
    const children: ChildProcessWithoutNullStreams[] = [];
    const launch = vi.fn(() => {
      const child = fakeChild();
      children.push(child);
      return child;
    });
    const runtime = new RemoteRuntime(launch as typeof spawn);
    const dir = mkdtempSync(join(tmpdir(), 'weq-stripped-runtime-'));
    runtime.configure({ helper: process.execPath, stateDir: dir });
    try {
      await runtime.start();
      expect(launch).toHaveBeenCalledTimes(1); // 仅局域网辅助进程
      await send(children[0], ONLINE);
      expect(runtime.status().network.addresses).toEqual(['https://192.168.1.8:7691']);

      await expect(runtime.setTailscaleEnabled(true)).rejects.toThrow('已移除 Tailscale');
      await expect(runtime.setMode('tailscale')).rejects.toThrow('已移除 Tailscale');
      await expect(runtime.setMode('existing')).rejects.toThrow('已移除 Tailscale');
      await expect(runtime.changeNetwork()).rejects.toThrow('已移除 Tailscale');
      expect(launch).toHaveBeenCalledTimes(1); // 保险丝未拉起任何 Tailscale 进程
      expect(runtime.status().tailscaleEnabled).toBe(false);

      // 嵌入 Tailscale Key 的邀请被拒绝（专用节点永不在线）
      await expect(runtime.invite({ authKey: `tskey-auth-${'k'.repeat(40)}` })).rejects.toThrow(
        'Tailscale',
      );

      // 关闭是幂等的，不动局域网子进程
      await runtime.setTailscaleEnabled(false);
      expect(children[0].kill).not.toHaveBeenCalled();

      // 局域网配对与批准照常
      const lanInvite = await runtime.invite();
      expect(lanInvite.qr).toMatch(/^data:image\/png;base64,/);
      const secret = new URL(lanInvite.pairingURL).searchParams.get('invitation')!;
      const claim = runtime.pairing.claim({
        invitation: secret,
        name: '局域网手机',
        tokenHash: tokenHash('d'.repeat(64)),
      });
      runtime.pairing.decide(claim.id, true);
      expect(runtime.status().devices).toHaveLength(1);
      expect(runtime.status().enabled).toBe(true);
      expect(runtime.status().network.addresses).toEqual(['https://192.168.1.8:7691']);
    } finally {
      runtime.stop();
      for (const child of children) {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('没有辅助程序时拒绝启动，不生成邀请或假报在线', async () => {
    const runtime = new RemoteRuntime();
    expect(runtime.status().available).toBe(false);
    await expect(runtime.start()).rejects.toThrow('尚未安装');
    await expect(runtime.invite()).rejects.toThrow('请先完成网络登录');
    expect(runtime.status().enabled).toBe(false);
    expect(runtime.status().network.state).toBe('offline');
    runtime.stop();
    runtime.stop();
    expect(runtime.status().devices).toEqual([]);
  });

  it('辅助程序异常退出会关闭监听，但保留长期设备授权（局域网路径）', async () => {
    const child = fakeChild();
    const launch = (() => child) as typeof spawn;
    const runtime = new RemoteRuntime(launch);
    const dir = mkdtempSync(join(tmpdir(), 'weq-runtime-'));
    runtime.configure({ helper: process.execPath, stateDir: dir });
    try {
      await runtime.start();
      expect(runtime.status().network.state).toBe('starting');
      await send(child, ONLINE);
      expect(runtime.status().network.state).toBe('online');

      const invite = await runtime.invite();
      const pairingURL = new URL(invite.pairingURL);
      expect(pairingURL.protocol).toBe('weq-remote:');
      expect(pairingURL.searchParams.getAll('endpoint')).toContain('https://192.168.1.8:7691');
      expect(invite.qr).toMatch(/^data:image\/png;base64,/);
      expect(JSON.stringify(runtime.status())).not.toContain('tskey-');

      const request = runtime.pairing.claim({
        invitation: pairingURL.searchParams.get('invitation')!,
        name: '手机',
        tokenHash: tokenHash('a'.repeat(64)),
        scope: 'web:access',
      });
      runtime.pairing.decide(request.id, true);
      expect(runtime.status().devices).toHaveLength(1);

      child.emit('exit', 1);
      expect(runtime.status().enabled).toBe(false);
      expect(runtime.status().network.state).toBe('error');
      expect(runtime.status().devices).toHaveLength(1);
    } finally {
      runtime.stop();
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
