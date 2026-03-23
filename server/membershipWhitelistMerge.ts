/**
 * 资料中「在期」的付费档位（vip / 简历畅改 / 全局畅享）优先于邮箱白名单，
 * 避免老 VIP 在到期前被白名单里的 special 等档位覆盖而遭误拦。
 * 白名单 pro 仍为最高档（全开放）。
 */
export const PAID_PROFILE_TIERS = new Set(['vip', 'resume_pass', 'full_monthly']);

export type WhitelistType = 'vip' | 'special' | 'pro';

export interface WhitelistEntryLike {
  whitelist_type: WhitelistType;
}

export function mergeWhitelistIntoPaidProfile(
  membershipType: string,
  vipExpiresAt: string | null,
  whitelistEntry: WhitelistEntryLike | null,
): { membershipType: string; vipExpiresAt: string | null } {
  if (!whitelistEntry) {
    return { membershipType, vipExpiresAt };
  }
  if (whitelistEntry.whitelist_type === 'pro') {
    return { membershipType: 'pro', vipExpiresAt: null };
  }
  if (membershipType === 'pro') {
    return { membershipType, vipExpiresAt };
  }
  if (PAID_PROFILE_TIERS.has(membershipType)) {
    return { membershipType, vipExpiresAt };
  }
  return {
    membershipType: whitelistEntry.whitelist_type,
    vipExpiresAt: null,
  };
}
