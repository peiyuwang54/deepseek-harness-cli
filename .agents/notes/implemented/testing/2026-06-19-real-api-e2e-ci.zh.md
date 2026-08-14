# Agent Note: 在 CI 中对外部 DeepSeek API 运行真实 API e2e 测试

Status: implemented

[English](2026-06-19-real-api-e2e-ci.md) | 中文

## 问题

harness 依赖真实 API 测试，因为无密钥套件证明的是管线，而不是线上产品。[ACP（Agent Client Protocol）inject 事故复盘（postmortem）](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)记录了常设示例：178 项无密钥测试保持绿色时，真实 ACP 客户端会话却立即崩溃。真实 API e2e 套件（`pnpm run test:e2e`）通过线上 DeepSeek 模型调用、工具、多轮会话、恢复和 ACP-over-stdio 弥合这一缺口。

默认的 [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)刻意无密钥，并允许 fork 运行。`test:e2e` 在缺少 `DEEPSEEK_API_KEY` 时自行跳过，因此放入该工作流可能在没有调用提供方时报告绿色。真实 API 证据需要一个独立、携带 secret 且在缺少 secret 时明确失败的工作流。

## 决策

专用的 [.github/workflows/e2e.yml](../../../../.github/workflows/e2e.yml)使用仓库 secret 对 DeepSeek 公开 API 运行且仅运行 `pnpm run test:e2e`。预检查会把缺少 Key 转换为可见失败，而不是误报成功。[私有 fork 触发策略](2026-08-14-private-fork-manual-real-api-e2e.md)约定该工作流何时运行；本说明约定工作流分离、凭据处理、预检查和执行范围。

### 独立工作流，而非 ci.yml 中的一个 job

ci.yml 保持无密钥并允许 fork 运行。将消费 secret 的测试保留在另一个文件中，可以把凭据可用性和权限与普通质量检查隔离，使贡献者无需在该工作流中放置 API Key 就能运行完整的无密钥信号。

### 预检查：明确失败，绝不误报成功

只要请求真实 API 运行，工作流就要求 `DEEPSEEK_API_KEY_EXTERNAL`。空值会在构建和测试执行前退出，并通过注解指出缺少的 secret。如果没有该检查，每个真实套件都会自行跳过，而作为实时提供方证据发起的运行会报告错误的成功结果。

### Secret 映射与卫生

仓库 secret `DEEPSEEK_API_KEY_EXTERNAL` 映射到适配器和测试读取的 `DEEPSEEK_API_KEY` 环境变量。工作流按以下方式限制凭据访问：

- **步骤级 secret。** 只有预检查和 e2e 步骤接收 `DEEPSEEK_API_KEY`；checkout、setup、依赖安装和构建都不会接收。
- **`permissions: contents: read`。** 工作流可以读取仓库，但不能使用 `GITHUB_TOKEN` 写入内容、评论或状态。
- **固定端点。** e2e 步骤把 `DEEPSEEK_BASE_URL` 设为 `https://api.deepseek.com`，因此仓库 `.env` 无法重定向运行。
- **不输出 secret。** 预检查只报告 Key 存在，绝不报告其值或长度。

### 范围与运行时

job 使用 Node 24，构建仓库后通过有界 worker、逐测试重试和 job 超时运行真实 API 套件。无密钥门禁和 Node 版本兼容性仍由 ci.yml 负责。DeepSeek 原生 `web_search` 探测继续跳过，因为成功的线上响应不一定可靠地包含结构化来源块；单元测试继续覆盖响应解析。

## 安全性

手动运行只能选择已评审的 ref。任何拥有仓库写权限的人都能修改工作流或测试代码，也本来就能编写读取仓库 secret 的工作流；限制写权限并评审所选 ref，是该信任集合的控制措施。

仅手动启动可避免把 Key 自动交给 PR 代码。仓库公开后，工作流日志也会公开，因此禁止输出 secret 的规则仍然是强制要求。添加自动 PR 触发器，尤其是 `pull_request_target`，必须先重新评审威胁模型，才能接收此 secret。

## 考虑过的替代方案

**把消费 secret 的 job 放入 ci.yml。** 否决，因为这会把可 fork 的无密钥检查与凭据可用性、权限和不同的运维生命周期耦合起来。

**缺少 Key 时允许套件自行跳过。** 否决，因为请求的真实 API 运行可能在没有发出任何提供方请求时通过。

**针对仓库事件自动运行。** 私有 fork 的选择和取舍由[手动触发 Agent Note](2026-08-14-private-fork-manual-real-api-e2e.md)约定。

## 后果

仓库保留了一个诚实、可复现的实时提供方检查，同时不会削弱无密钥 CI。请求的运行要么获得预期凭据并执行套件，要么在声称覆盖之前失败。

该工作流需要维护一个外部 API Key，并要求 runner 能访问 `https://api.deepseek.com`。在当前触发策略下，只有维护者主动启动时，它才提供实时提供方信号。
