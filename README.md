# DSH GPT Fast Mode

[简体中文](README.zh-CN.md) · English

A DeepSeek Harness (DSH) Web plugin that adds a **Speed** menu next to the model picker. Choose **Default**, **Fast**, or **Ultrafast** for models whose IDs begin with `gpt-`, regardless of the provider's name. Changing the speed tier does not change the model, endpoint, or reasoning effort.

## Installation

With `pnpm` available on `PATH`, install the plugin directly from GitHub into the DSH Web profile:

```sh
dsh plugin --profile web add github:tlsneo/dsh-gpt-fastmode
```

If you launch DSH through `npx`, use the same DSH version you normally run. For example:

```sh
npx @deepseek-ai/dsh plugin --profile web add github:tlsneo/dsh-gpt-fastmode
```

**Compatibility:** Tested with DSH Web `0.2.2-rc.5`. Other versions have not been verified. This release declares the tested version in `engines.dsh`, which DSH checks at installation.

The plugin ships as plain JavaScript and needs no build step. After installing or upgrading, restart the **DSH Web process**, then refresh the page. If you use a profile other than `web`, install into that profile instead.

## Usage

1. Select a model with an ID beginning with `gpt-` in DSH Web.
2. Open **Speed** beside the model picker. By default, the change applies to **This conversation**. To apply it more widely, select **All conversations** first.
3. Click **Default**, **Fast**, or **Ultrafast** to save the tier. Changing the scope alone does not save it. After sending a message, reopen the menu to see the tier reported by the provider, if available. A returned tier of `default` means that request did not use an accelerated tier.

**All conversations** applies to existing and new conversations using the same exact model ID on compatible, already configured routes. It replaces earlier individual settings for that model; you can still override it in one conversation afterward. To remove all plugin speed settings for a model, select **All conversations → Default**. Speed choices are kept in memory and reset when DSH restarts.

Slash commands are also available: `/fast` and `/ultrafast` change the current conversation only, `/fast status` checks the setting without calling the model, and `/fast off` stops requesting an accelerated tier in that conversation.

## How it works

The toolbar saves the speed preference through DSH's authenticated connection. The plugin then sets the top-level `service_tier` field in eligible requests through DSH's pi-ai adapter, rather than adding instructions to the prompt or reducing reasoning effort.

| Choice | Request behavior |
| --- | --- |
| Default | The plugin does not add a service-tier override. The provider or gateway's default still applies. |
| Fast | Sends `service_tier: "priority"` on supported Responses or Chat Completions routes. OpenAI accepts `priority` as an alias for `fast`. |
| Ultrafast | Sends `service_tier: "ultrafast"` on supported Responses routes. On standard OpenAI Responses routes it also sends `OpenAI-Service-Tier: ultrafast`. It is unavailable on Chat Completions. |

The plugin requests a tier; it cannot guarantee that the provider will use it. Availability depends on the model, account, and route. Faster tiers may cost more. See OpenAI's [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode), [Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode), and [API pricing](https://developers.openai.com/api/docs/pricing) for details.
