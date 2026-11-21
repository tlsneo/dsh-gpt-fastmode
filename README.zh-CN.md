# DSH GPT Fast Mode

简体中文 · [English](README.md)

这是一个 DeepSeek Harness（DSH）Web 插件，在聊天输入栏的模型选择器旁添加**速度**菜单。只要模型 ID 以 `gpt-` 开头，就会显示这个菜单，不按提供方名称筛选。你可以选择**默认、Fast 或 Ultrafast**，不改变模型、接口地址或 `Xhigh` 等推理强度。

## 安装

确认终端能运行 `pnpm` 后，从 GitHub 直接安装到 DSH 的 `web` 配置：

```sh
dsh plugin --profile web add github:tlsneo/dsh-gpt-fastmode
```

如果平时用 `npx` 启动 DSH，安装时沿用平时启动的 DSH 版本。例如：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:tlsneo/dsh-gpt-fastmode
```

**兼容性：**已在 DSH Web `0.2.2-rc.5` 上测试，其他版本尚未验证。此发行版在 `engines.dsh` 中声明了测试过的版本，DSH 安装时会检查该声明。

插件已包含可直接运行的 JavaScript，无需构建。安装或升级后，重启 **DSH Web 进程**，再刷新页面。如果你使用的不是 `web` 配置，请把命令中的 `web` 换成实际配置名。

## 使用

1. 在 DSH Web 选择一个 ID 以 `gpt-` 开头的模型。
2. 打开模型选择器旁的**速度**。生效范围默认是**仅当前会话**；要让其他会话也生效，先选**所有会话**。
3. 点击**默认、Fast 或 Ultrafast** 保存。只点范围不会保存。发送消息后，再次打开菜单可以查看服务端回报的实际档位；如果回报 `default`，表示该请求没有使用加速档位。

**所有会话**只影响使用同一模型 ID 的现有和新会话，且这些会话的路由必须已经配置并支持所选档位。应用时会覆盖该模型之前的单会话设置，之后仍可单独为某条会话改档。选择**所有会话 → 默认**，可关闭插件为该模型添加的所有加速设置。档位只保存在运行内存中，重启 DSH 后会重置。

也可以使用斜杠命令：`/fast` 和 `/ultrafast` 只修改当前会话；`/fast status` 查看状态，不发模型请求；`/fast off` 停止为当前会话请求加速。

## 实现原理

菜单通过 DSH 自带的认证连接保存档位偏好。发送推理请求时，插件在 DSH 的 pi-ai 适配器中为符合条件的请求设置顶层 `service_tier` 字段，不往提示词里插入指令，也不降低推理强度。

| 选择 | 请求行为 |
| --- | --- |
| 默认 | 插件不额外设置服务档位，继续沿用提供方或网关的默认配置。 |
| Fast | 在支持的 Responses 或 Chat Completions 路由发送 `service_tier: "priority"`。OpenAI 将 `priority` 和 `fast` 视为等效请求值。 |
| Ultrafast | 在支持的 Responses 路由发送 `service_tier: "ultrafast"`。标准 OpenAI Responses 路由还会发送 `OpenAI-Service-Tier: ultrafast`。Chat Completions 不支持此档位。 |

插件只能**请求**档位，不能保证服务端一定采用。是否可用取决于模型、账号和路由；加速档位可能额外计费。详细规则见 OpenAI 官方的 [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)、[Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode)和 [API 定价](https://developers.openai.com/api/docs/pricing)。
