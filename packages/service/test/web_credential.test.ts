/**
 * web cgi 凭证层的纯函数单测。
 *
 * `computeBkn` 的唯一实现现在在 TS 侧（`credential.ts`）；原先 native 里的
 * `computeBkn` 已随 `protocol/service` 一并移除。这里钉死 djb2 → 31-bit 的
 * 公式和几个金标准值。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  computeBkn,
  cookieHeader,
  fetchWebTokens,
  WebCredentialProvider,
  type WebCredential,
  type WebNative,
} from '../src/account/web/credential';

function ptLoginNative() {
  return {
    sendOidbPacket: vi.fn(async () => {
      throw new Error('packet transport must not be used');
    }),
    probePtLoginPort: vi.fn(() => ({ success: true, port: 4301, msg: '' })),
    ptFetchSkey: vi.fn(async () => ({ success: true, skey: 'test-skey', msg: '' })),
    ptFetchPskey: vi.fn(async () => ({ success: true, pskey: 'test-pskey', msg: '' })),
  } satisfies WebNative;
}

describe('pt_login without native injection', () => {
  it('preserves the hook-first fallback used by other platforms', async () => {
    const nt = ptLoginNative();
    await expect(
      fetchWebTokens(nt, '10001', 42, 'qzone.qq.com', { transport: 'hook-first' }),
    ).resolves.toEqual({ skey: '', pskey: 'test-pskey' });
    expect(nt.sendOidbPacket).toHaveBeenCalled();
    expect(nt.ptFetchPskey).toHaveBeenCalledTimes(1);
  });

  it('fetches web tokens without invoking the unavailable packet channel', async () => {
    const nt = ptLoginNative();
    await expect(
      fetchWebTokens(nt, '10001', 42, 'qzone.qq.com', {
        needSkey: true,
        transport: 'pt-login',
      }),
    ).resolves.toEqual({ skey: 'test-skey', pskey: 'test-pskey' });
    expect(nt.sendOidbPacket).not.toHaveBeenCalled();
    expect(nt.ptFetchPskey).toHaveBeenCalledWith(4301, '10001', 'qzone.qq.com');
  });

  it('caches credentials and remints them after a web authentication rejection', async () => {
    const nt = ptLoginNative();
    let pid = 42;
    const provider = new WebCredentialProvider(nt, '10001', () => pid, 'pt-login');
    const first = await provider.forDomain('qzone.qq.com');
    expect(first.cookie).toContain('p_skey=test-pskey');
    await provider.forDomain('qzone.qq.com');
    expect(nt.ptFetchPskey).toHaveBeenCalledTimes(1);
    pid = 43;
    provider.invalidate('qzone.qq.com');
    await provider.forDomain('qzone.qq.com');
    expect(nt.probePtLoginPort).toHaveBeenLastCalledWith(43);
    expect(nt.ptFetchPskey).toHaveBeenCalledTimes(2);
    expect(nt.sendOidbPacket).not.toHaveBeenCalled();
  });

  it('fails unsupported domains without attempting injection', async () => {
    const nt = ptLoginNative();
    const provider = new WebCredentialProvider(nt, '10001', () => 42, 'pt-login');
    await expect(provider.forDomain('ti.qq.com')).rejects.toThrow('pt_login');
    expect(nt.sendOidbPacket).not.toHaveBeenCalled();
    expect(nt.probePtLoginPort).not.toHaveBeenCalled();
  });

  it('returns no credentials when local quick login is unavailable', async () => {
    const nt = ptLoginNative();
    nt.probePtLoginPort.mockReturnValue({ success: false, port: 0, msg: 'offline' });
    await expect(
      fetchWebTokens(nt, '10001', 42, 'qzone.qq.com', { transport: 'pt-login' }),
    ).resolves.toEqual({ skey: '', pskey: '' });
    expect(nt.sendOidbPacket).not.toHaveBeenCalled();
  });
});

describe('computeBkn', () => {
  it.each([
    // 金标准：公式 hash += (hash<<5) + c，最后 & 0x7fffffff
    ['5381 起始的空串', '', 5381 & 0x7fffffff],
    ['常见 skey 形状', '@abcDEF123', 890803408],
  ])('%s', (_label, key, want) => {
    expect(computeBkn(key)).toBe(want);
  });

  it('手算一致性：djb2 变体逐步复算', () => {
    const key = 'test';
    let hash = 5381;
    for (const c of key) hash += (hash << 5) + c.charCodeAt(0);
    expect(computeBkn(key)).toBe(hash & 0x7fffffff);
  });

  it('结果总是非负 31-bit', () => {
    for (const key of ['a', '很长的一串中文skey', '\u00ff\u0100']) {
      const v = computeBkn(key);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

describe('cookieHeader', () => {
  it('有完整 jar 时优先透传', () => {
    const cred: WebCredential = {
      uin: '12345',
      skey: 's',
      pskey: 'p',
      cookie: 'uin=o12345; RK=xyz; ptcz=abc',
    };
    expect(cookieHeader(cred)).toBe('uin=o12345; RK=xyz; ptcz=abc');
  });

  it('无 jar → 四字段拼装，uin 带 o 前缀', () => {
    const cred: WebCredential = { uin: '12345', skey: 'SK', pskey: 'PSK' };
    expect(cookieHeader(cred)).toBe('uin=o12345; skey=SK; p_uin=o12345; p_skey=PSK');
  });

  it('空 token 被丢弃', () => {
    const cred: WebCredential = { uin: '12345', skey: 'SK', pskey: '' };
    expect(cookieHeader(cred)).toBe('uin=o12345; skey=SK; p_uin=o12345');
  });
});
