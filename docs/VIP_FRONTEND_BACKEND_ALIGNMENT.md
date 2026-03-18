# 前后端 VIP 身份理解一致性说明

## 问题

付费用户看到「本月面试次数已达上限」等限制提示，但付费与 DB 状态均正确。根因是前后端对 VIP 身份及用量统计的理解不一致。

## 已做修复

### 1. 统一「有效会员类型」数据源

| 之前 | 之后 |
|------|------|
| 前端仅使用 `profiles.membership_type` | 前端调用 `GET /api/user/membership` 获取与服务端一致的 `membershipType` |
| 后端使用 profiles + `email_whitelist`（白名单覆盖） | 新 API 复用同一逻辑，返回 profiles + 白名单合并后的结果 |

- **后端**：`api/gemini/proxy.ts` 的 `authenticateUser` 使用 profiles + 白名单
- **前端**：`authService.checkUsageLimit` 通过 `GET /api/user/membership` 获取与后端相同的会员类型
- **兜底**：API 失败时退回 `getUserProfile`，保证离线或异常情况下可用

### 2. 统一月份边界（UTC）

| 之前 | 之后 |
|------|------|
| 前端：`new Date().getFullYear/getMonth()`（用户本地时区） | 前端：`Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)` |
| 后端：Vercel 服务器本地时区（多为 UTC） | 后端：显式使用 `Date.UTC(...)` 计算 |

- 前后端都按 **UTC 自然月** 统计用量
- 避免同一用户在不同时区下被计入不同月份

### 3. 新增 API

- **`GET /api/user/membership`**：要求 Bearer JWT，返回 `{ membershipType: 'free' | 'vip' | 'pro' | 'special' }`
- 逻辑与 `api/gemini/proxy.ts` 的 `authenticateUser` 保持一致

## 会员类型优先级（与后端一致）

1. **profiles.membership_type**（基础）
2. **VIP 过期**：若 `vip_expires_at < now`，视为 `free`
3. **email_whitelist**：白名单中的邮箱，覆盖为 `whitelist_type`（vip / pro / special）

## 维护建议

- 手动修改白名单时，建议同步更新 `profiles.membership_type`，避免展示与限制逻辑不一致
- 支付成功回调需正确更新 profiles，并在前端合适位置调用 `refreshProfile`，以保证 UI 展示为最新会员状态
