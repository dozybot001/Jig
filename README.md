<p align="center">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/web/public/icons/yew-mark.svg" width="80" height="80" alt="The Yew Harness logo: a red yew berry and a leaf">
</p>

<h1 align="center">Yew Harness</h1>

<p align="center">An AI-native multi-agent workbench</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tenonai/yew"><img src="https://img.shields.io/npm/v/@tenonai/yew?label=npm" alt="npm version"></a>
  <a href="https://github.com/dozybot001/Yew/releases"><img src="https://img.shields.io/github/v/release/dozybot001/Yew?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933" alt="Requires Node.js 24 or later">
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-approval-en-dark.png">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-approval-en-light.png" alt="The approval center: a session asks to push to a remote repository, and a decision card asks how long a sign-in should last, with a recommended option">
</picture>

Agent sessions organized the Session Engineering way: you deal only with the main conversation, and everything that needs your approval or decision comes to the approval center.

Every session has a name, a responsibility, a workspace, a model and permissions, and sessions are organized in teams. Standing sessions own an area for the long run; a task session is opened for one job, reports back when it is done, and can then be archived. Sessions hand out work and report back through letters. They run in the Yew Harness service on your computer and keep working while the web page is closed.

Yew Harness is open source under the MIT license; the current version is 1.6.1. What it can do is in the [changelog](CHANGELOG.md); why it is built this way is in the [product blueprint](docs/blueprint.md) (in Chinese). The iPhone app's source is in `ios/` and is not in the App Store yet; the Android app's source is in `android/`, and its package is described under [Phone apps](#phone-apps).

## Born for Session Engineering

Built on the idea and tuned for it throughout.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-main-en-dark.png">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-main-en-light.png" alt="The main conversation: the person asks the coordinator to ship a home page redesign and fix a sign-out bug; the coordinator writes letters to two sessions and sums up their reports">
</picture>

## Multi-agent collaboration done well

Agents talk through A2A, an asynchronous mailbox, and you hardly notice it happening.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-letters-en-dark.png">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-letters-en-light.png" alt="The letters in the approval center: requests, reports and notices passed between the coordinator and the Backend, Website and Content sessions">
</picture>

## Take the boss’s chair for real

Approvals and decisions all sit in the approval center, and only your actions carry real authority.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-permission-en-dark.png">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-permission-en-light.png" alt="The Website session waits for permission to run git push origin main, with Allow and Decline; a push asks every time">
</picture>

## Anywhere, anytime, off the desk

Approve from your phone. Away from the computer, approvals and decisions still get handled.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-phone-en-dark.png">
    <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-phone-en-light.png" width="300" alt="The phone app’s approvals: the push request with Allow and Decline, and the decision on how long a sign-in should last">
  </picture>
</p>

## Your choice of model

Model access is built on the open-source pi-ai library, with a huge range of model providers supported.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-models-en-dark.png">
  <img src="https://raw.githubusercontent.com/dozybot001/Yew/main/docs/assets/yew-models-en-light.png" alt="A session’s model provider menu: Chinese providers such as DeepSeek, Moonshot AI and Qwen, then other providers">
</picture>

## Quick start

You need macOS or Linux, Node.js 24 or later, and ripgrep (macOS: `brew install ripgrep`). On Linux, also install bubblewrap and socat (Debian, Ubuntu: `sudo apt install ripgrep bubblewrap socat`). On Windows, use WSL.

1. Install: `npm install -g @tenonai/yew`.
2. Save an API key for a model provider (DeepSeek is the default): `yew key set deepseek`. The key goes into the system keychain only.
3. Start the service: `yew serve --open`. The browser opens the web interface. For a new sign-in link later, run `yew open`.
4. Optional: `yew service install` starts Yew Harness when you log in; on macOS, `yew app install` puts a Yew Harness icon in Applications.

From source: clone the repository, then run `npm install`, `npm run build:web` and `npm link`.

## Phone apps

The phone app connects only to the Yew Harness on your own computer: the computer shows a QR code, the phone scans it to pair, and from then on you can follow sessions and handle the approval center on the phone. The two talk through a relay with end-to-end encryption; by default it is the relay Tenon AI runs, and you can run your own (see `relay/`).

- Android: the package (apk) is in the Releases on [GitHub](https://github.com/dozybot001/Yew/releases) and [Gitee](https://gitee.com/dozybot/yew/releases), signed by 长沙榫卯人工智能科技有限公司 (Tenon AI). The SHA-256 fingerprint of the signing certificate is `9F:F5:6E:EA:A8:3C:DC:01:BA:66:D8:79:23:9C:DE:5A:2A:69:C3:AE:D2:60:5C:D8:E1:B9:34:8D:BF:28:61:B2`; it is also published on the [Yew Harness page of the website](https://tenonai.cn/products/yew/#android) for comparison, and each release's notes give the package's SHA-256. If the system reports a signature mismatch when you update, do not install.
- iPhone: not in the App Store yet; it will come through TestFlight and the App Store.

## Documentation

The documents are written in Chinese.

- [Product blueprint](docs/blueprint.md): why, what, what not, and how it is accepted
- [External introduction](docs/introduction.md): the definition, summary and capabilities used on the website, in stores and elsewhere
- Implementation plans: [M1](docs/archive/m1-plan.md), [M2](docs/archive/m2-plan.md), [M3](docs/archive/m3-plan.md)
- [Open-source projects worth learning from](docs/prior-art.md)
- [Data inventory](docs/data-inventory.md): what Yew Harness keeps on your computer, and how to delete it
- [iPhone app in the App Store](docs/app-store.md): what the listing says, and where it stands
- [Changelog](CHANGELOG.md)
- [Development conventions](AGENTS.md)

## Where your data goes

Yew Harness collects no data and contains no analytics, telemetry or reporting code. Sessions, messages and settings stay on your computer, and API keys stay in the system keychain. The model providers you choose receive the conversations sent to them; their privacy policies cover that part.

## Security

Sessions' commands and the MCP servers you add run in a system sandbox. It is Anthropic's open-source [sandbox-runtime](https://github.com/anthropics/sandbox-runtime) (Apache-2.0), on Seatbelt on macOS and on bubblewrap on Linux. In the sandbox, a command:

- can neither read nor change Yew Harness's data folder (your decisions, sign-in tokens and logs), and cannot read the keychain's items;
- writes only in the session's workspace, temporary folders and the sandbox's own caches, not in files such as `~/.zshrc` or `~/.gitconfig`, nor in a repository's hooks and settings;
- cannot change Yew Harness's program or what starts at login, and cannot reach its local port, other local ports or the local network;
- reaches only the usual package registries, GitHub, Gitee and the model providers that have a key; for any other site you are asked first;
- cannot read credential files such as `~/.ssh`, `~/.aws` or `~/.netrc`, nor use ssh-agent, unless you allow it under Startup in the settings;
- cannot read the folders listed under Default settings → Folders sessions cannot read, which sessions' file tools cannot read either;
- on Linux, cannot reach local Unix sockets, the D-Bus session bus included.

On Linux, a repository made while a command runs is not protected until the command ends; then Yew Harness moves any new hook aside, so git does not run it, and says so in the command's output.

A command that has to run outside the sandbox (a `git push` with credentials from the keychain, creating or cloning a repository, a dev server that listens on a local port, an Xcode build) asks you every time, and git run outside runs no repository hooks. The built-in browser and computer control do not run in the sandbox: the browser can reach only its own empty folder, cannot open `file://` pages, and cannot reach Yew Harness's port. When Yew Harness runs from its source folder, that folder cannot be written in the sandbox; to change Yew Harness with Yew Harness, run the version installed from npm.

If the sandbox cannot start, Yew Harness runs without it and says why in the output of `yew serve` and under Startup in the settings: a program it needs is missing (ripgrep on macOS; bubblewrap, socat and ripgrep on Linux), the system does not let bubblewrap create user namespaces (the default from Ubuntu 24.04; sandbox-runtime's documentation says how to allow it), or `yew serve` was started with `YEW_SANDBOX=off`. Then, with Ask when needed and Full access, commands that run without asking run as your user account and can do what you can do in a terminal, including changing Yew Harness's own records (decisions and permissions among them) and reading the API keys it keeps. The Linux sandbox has passed the everyday tests in a Debian 12 container and has not been tested on a real machine yet.

Letters from other sessions, web pages, mail and what MCP servers return are only data to Yew Harness and cannot approve anything for you. For a session that handles such outside content, Ask each time is still the better mode: every command asks you first.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). The third-party packages used at run time and in the web interface are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Names, logos and the character: the Yew Harness, Yew and Tenon AI names and logos, including the icons in `web/public/icons/` and `ios/Yew/Assets.xcassets/`, and the design and images of the character Yew, including the images in `web/public/mascot/` and `android/app/src/main/res/drawable-nodpi/` and the Mascot images in `ios/Yew/Assets.xcassets/`, are not licensed under the MIT License. You may refer to the names as they are to say that you use Yew Harness or that your work is based on it, but do not use the names or logos as the name or logo of your own product, do not use the character's design or images in your own product, and do not suggest that your product comes from or is endorsed by Tenon AI.

---

Made by 榫卯 Tenon AI · [tenonai.cn](https://tenonai.cn/)
