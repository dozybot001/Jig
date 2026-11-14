# Jig 安卓版

状态（2026-11-15）：功能写完（含 1.0.0 加的「产物」入口），能构建，单元测试通过，在 Android 17 和 Android 8.0 两台模拟器上走查过（第 6 节）。签名密钥 11-15 02:07 已生成，还没备份（7.2）。还没做：真机、扫码的实测、发布。安卓版不卡 v1 的验收（蓝图第十三节）。

由「Jig 安卓 · 开发」会话负责，只动 `android/` 和本文件；电脑端、中继和协议归 Jig 的主开发会话。

## 1. 做什么

功能和 iPhone 应用一样（M3 计划第七节），只做离开电脑时要你做的事：

- 未配对时：说明、扫电脑上的二维码配对、粘贴配对链接、「看演示」（内置演示数据，不连电脑）。
- 底部四个入口：会话（列表、会话记录、回复、停下）、审批（授权、提问、决定卡、待放行的信）、信件、产物（文档、数据、图表、页面，看最新一版）。
- 右上角设置：配对的电脑和连接状态、通知、后台运行、断开配对、关于（版本和构建号、出品方、官网、隐私政策、用户协议、开源许可、反馈）。
- 通知：有事要你处理、会话出错、任务做完时通知，点开进对应的会话或审批；电脑上处理掉的，通知跟着撤下。
- 中英双语（跟随系统，Android 13 起可以在系统设置里单独给 Jig 选语言），深浅色跟随系统。

技术选择：Kotlin 加 Jetpack Compose，包名 `cn.tenonai.apps.jig`（调试版加 `.debug`），最低 Android 8.0（API 26），目标 API 37，只做手机、竖屏。版本号在构建时从仓库根的 `package.json` 读，关于页的构建号是构建时的短提交号。

## 2. 工程结构

`android/app/src/main/kotlin/cn/tenonai/apps/jig/`：

| 位置 | 内容 |
| --- | --- |
| `remote/Noise.kt` | Noise IK（`Noise_IK_25519_ChaChaPoly_SHA256`）手机一侧、分块的帧，对照 `src/remote/noise.ts` |
| `remote/RelayChannel.kt` | 经中继的加密通道：握手、请求、事件流、掉线后下次请求时重连 |
| `remote/Pairing.kt` | 读 `jig://pair?…` 配对链接 |
| `remote/PushCrypto.kt` | 打开为这台手机加密的通知（`src/remote/push.ts` 的格式）。安卓现在不走这条路，见第 4 节 |
| `api/` | 电脑端接口的模型和解析（`JigApi.kt`）、请求和事件流（`JigClient.kt`）、演示数据（`Demo.kt`） |
| `data/Vault.kt` | 手机私钥和配对信息的存放 |
| `notify/` | 通知的文字和显示（`Notifier.kt`）、保持连接的前台服务和开机后恢复（`LinkService.kt`） |
| `AppModel.kt` | 应用的状态和操作，界面和前台服务共用一份 |
| `ui/` | 界面。图标是自己画的线条图标，不带图标库；图表也是自己画的 |

`android/scripts/`（都在仓库根目录用 Node 运行）：

| 脚本 | 做什么 |
| --- | --- |
| `noise-vectors.ts` | 用电脑端的 `src/remote/noise.ts` 和固定的测试密钥生成 `app/src/test/resources/noise-vectors.json` |
| `sync-policy.ts` | 从 `src/shared/policy.ts` 生成两种语言的 `res/values*/policy.xml`。隐私政策改了以后跑一次，不跑的话 `PolicyTest` 会失败 |
| `test-computer.ts` | 一台测试用的电脑：本机中继加内存里的 Jig 接口、四个产物和通知，不碰 `~/.jig` 和系统钥匙串。用法见文件开头 |
| `dependencies.ts` | 从锁文件和 Gradle 缓存里各库的 POM 和包，生成 `android/DEPENDENCIES.md`（进安装包的每个库的名称、版本和许可证）和应用里「开源许可」页的内容 `app/src/main/assets/licenses.txt`。升级依赖后跑一次，不跑的话 `PolicyTest` 会失败 |

依赖（都来自 Google Maven 和 Maven Central，版本锁在 `app/gradle.lockfile`）：Compose 和 AndroidX、CameraX（扫码的相机）、ZXing core（识别二维码）、OkHttp（到中继的 WebSocket）、Bouncy Castle（X25519 和 ChaCha20-Poly1305：系统自带的要到 API 31 和 28 才有）、kotlinx.coroutines、kotlinx.serialization-json。没有统计、崩溃上报、推送和 Google 服务的库。全部 145 个库（多数是 AndroidX 和 Kotlin 的传递依赖）列在 [android/DEPENDENCIES.md](../android/DEPENDENCIES.md)：143 个 Apache-2.0，1 个 MIT（checker-qual），1 个 Bouncy Castle 许可证（MIT 式）；法务组 11-15 核过，可以。

## 3. 构建和运行

要有 JDK 21 和 Android SDK（平台 API 37、build-tools 37.0.0）。SDK 的位置写在 `android/local.properties` 的 `sdk.dir` 里，这个文件不进 git。命令都在 `android/` 下跑：

| 命令 | 做什么 |
| --- | --- |
| `./gradlew :app:testDebugUnitTest` | 单元测试 |
| `./gradlew :app:lintDebug` | lint |
| `./gradlew :app:assembleDebug` | 调试包 `app/build/outputs/apk/debug/app-debug.apk`，用调试密钥签，只用于测试 |
| `./gradlew :app:assembleRelease` | 正式构建 `app/build/outputs/apk/release/app-release-unsigned.apk`，开了 R8，没有签名 |

升级依赖：改 `gradle/libs.versions.toml`，跑 `./gradlew --write-locks :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug`，把锁文件的改动一起提交。

调试版才有的启动参数（模拟器上用，正式构建里没有）：`--es jig.pair '<配对链接>'` 像扫码一样配对，`--ez jig.demo true` 打开演示，`--es jig.tab approvals|letters|artifacts` 选入口。调试版允许连本网络里 `ws://` 的测试中继，正式构建只连 `wss://`。

连本机的测试电脑：

```bash
node android/scripts/test-computer.ts /tmp/jig-android    # 配对链接写在 /tmp/jig-android/link.txt
adb reverse tcp:8791 tcp:8791
adb shell am start -n cn.tenonai.apps.jig.debug/cn.tenonai.apps.jig.MainActivity --es jig.pair "'$(cat /tmp/jig-android/link.txt)'"
echo "ask git push origin main" > /tmp/jig-android/cmd      # 电脑端出现一个待授权的操作，手机收到通知
echo settle > /tmp/jig-android/cmd                          # 电脑端处理掉，手机上的通知撤下
```

## 4. 设计

### 4.1 存储

- 手机的 Noise 私钥和配对信息（中继地址、电脑的标识和公钥、电脑的名称、这台手机在电脑上的编号）是一个文件 `no_backup/vault.bin`，用 AES-256-GCM 加密；加密用的密钥在 Android Keystore 里生成，不能导出。这把密钥不要求每次解锁，前台服务在锁屏时也要读。
- 整个应用关掉系统备份和换机传输（`allowBackup="false"`，`data_extraction_rules.xml` 里全部排除）。换手机后重新配对。
- 断开配对时文件和 Keystore 里的密钥都删掉，下次配对用新的私钥。
- 另有一个普通的偏好文件，记通知的开关、是否问过通知权限、上次看到的待办的编号（只有编号，没有内容）。

### 4.2 通知

创始人 2026-11-15 定：「应用自己保持一条到中继的连接」，不接 FCM 和手机厂商的推送通道。

- 电脑端在加密通道里提供 `GET /api/notes`（主开发会话 4a82f3a 加的）：一条事件流，电脑端的 `Notifier` 决定通知什么、什么时候通知（你在电脑前先不发、10 秒内合成一条），和发给 iPhone 的是同一份内容。通道本身端到端加密，所以这里是明文 JSON，不再另外加密。
- 手机上的前台服务（类型 `remoteMessaging`）保持通道并听这条流，收到后发本地通知。通知的文字照 `src/server/push.ts` 的 `Note` 和 iPhone 的 `NotificationService.swift`：标题是会话或事项的名称，正文是发生了什么。点开进对应的会话，没有会话的进审批。电脑端发来撤下的编号时，对应的通知取消。
- 系统要求前台服务有一条常驻通知，写着现在连没连上电脑；它在单独的通知类别里，可以在系统设置里把这一类关掉。
- 掉线后重试：3 秒起，每次加倍，最长 1 分钟；网络恢复时马上重试。连续 3 次被电脑拒绝（这台手机已在电脑上移除）就停止服务。
- 手机不在线时电脑端不为它保存通知（电脑端会在 10 分钟内重发还没送达的待办）。重连后手机读一次审批中心，有没见过的待办、而且电脑端没有重发时，发一条汇总通知。
- 开机后和应用更新后，服务自己恢复，不用打开应用。
- 收不到通知的情况，设置页上照实写了：系统为了省电停掉 Jig，或者在最近任务里划掉它（部分手机）时，通知收不到，再打开 Jig 后恢复。设置页显示 Jig 是否受电池优化限制，有按钮调出系统的「不受电池优化限制」对话框；国产系统上还要在系统设置里允许自启动和后台运行，这一步应用代办不了，写了提示。

### 4.3 产物

- 列表读 `GET /api/artifacts`，内容读 `GET /api/artifacts/:id/versions/:n`（纯文本），只看最新一版。文档按行内 Markdown 显示，数据排版成缩进的 JSON，图表（柱状或折线）自己画，黑白灰，系列之间用深浅区分。
- HTML 产物放在封闭的网页视图里（蓝图 6.6 第 19 条）：没有自己的地址，不加载网络和文件，页面发出的每个请求都得到空的回应，链接点了不跳转，页面里另加一条内容安全策略；不开本地存储。页面自己的脚本能跑，但碰不到 Jig、电脑和网络。

### 4.4 开源许可页

关于页里的「开源许可」随安装包走，内容由 `dependencies.ts` 生成，不手写（法务组 11-15 的要求）：

- 143 个 Apache-2.0 的库的名称和版本，后面附一份 Apache-2.0 全文（取自 AndroidX 包里的 `LICENSE.txt`）。
- Bouncy Castle 和 checker-qual 各自包里的许可原文，带版权行。
- `androidx.camera:camera-core` 的 POM 另写了 BSD-3-Clause。它的包里没有这部分的声明文字。这是它本地图像处理库里编进去的 libyuv，页面上放的是 libyuv 自己的许可（`scripts/notices/libyuv.txt`，全仓库只有这一份是手放的）。法务组 11-15 确认了归属，依据有两处：AndroidX 源码 `camera/camera-core/build.gradle` 的库说明写着「This library includes code from libyuv, which is licensed under the BSD-3-Clause license」，并用 `extraLicense` 声明了 BSD-3-Clause；libyuv 仓库根目录的 `LICENSE`。升级 camera 版本时对着这两处复核，出处也写在 `dependencies.ts` 的注释里。
- 各库包里带的 NOTICE 文件：只有 `jakarta.inject:jakarta.inject-api` 有一份，照原文放。
- 脚本遇到不认识的许可证，或者 MIT 一类的库包里找不到许可原文，就报错，不会悄悄漏掉。

### 4.5 加密

安卓版自带 Bouncy Castle 做 X25519 和 ChaCha20-Poly1305，不是系统加密（系统自带的要到 API 31 和 28 才有，应用从 26 起）；SHA-256、HMAC 和存储用的 AES-GCM 是系统的。法务组 11-15：直接发安装包没有申报手续；以后上应用商店，出口合规按「用了非系统的标准加密算法」填。iPhone 版只用系统的 CryptoKit，两端的填法不同。

### 4.6 权限

合并后的清单里只有这些（`aapt2 dump badging` 核对过）：`INTERNET`、`ACCESS_NETWORK_STATE`、`CAMERA`（只在扫码时用，没有相机的手机可以粘贴链接）、`POST_NOTIFICATIONS`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_REMOTE_MESSAGING`、`RECEIVE_BOOT_COMPLETED`、`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，以及 `androidx.core` 给应用自己声明的 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`。

## 5. 和 iPhone 版不同的地方

| 事 | iPhone | 安卓 |
| --- | --- | --- |
| 通知怎么送到 | APNs，内容为这台手机加密，通知扩展解密 | 应用自己保持到中继的连接，经加密通道收；被系统停掉时收不到 |
| 角标 | 应用图标上是审批中心的待办数 | 没有统一的角标接口，只把数字交给通知（部分桌面会显示） |
| 称呼 | Mac、iPhone | 电脑、手机（Jig 也能跑在 Linux 上） |
| 配对说明 | 「添加 iPhone」 | 电脑端的按钮现在叫「添加 iPhone」，说明里照实写了这个名字，加了一句安卓也用它 |
| 调试版的直连本机 | 有（粘贴 `jig open` 的链接） | 没有，用 `test-computer.ts` 的本机中继 |
| 隐私政策和用户协议 | 同一份文字 | 同一份文字（`src/shared/policy.ts`，现在是 2.0）。里面写的还是 iPhone、iOS 钥匙串和 Apple 的推送，没有安卓的内容 |
| 密钥存放 | iOS 钥匙串，应用和通知扩展共用 | Keystore 加密的文件，见 4.1 |

## 6. 验证记录

2026-11-15，在这台 Mac 上。模拟器是 AOSP 的 arm64 镜像，没有 Google 服务。

### 6.1 单元测试

15 个全部通过。

- `NoiseTest`（9 个）：公钥、握手的两条消息、握手哈希、请求和回应的帧、三块的长消息，和电脑端代码生成的向量逐字节一致；改过一个字节的帧和握手回应被拒绝，计数器不动；全零的公钥被拒绝；配对链接按电脑端写的样子读出来；`test/push.test.ts` 的固定向量（通知密钥和密文）解得开，改过的、换了密钥的解不开。
- `ApiTest`（4 个）：事件流按任意分片切成事件；会话记录变成消息、信件和一行工具摘要；审批中心的两种提问格式；通知的文字。
- `PolicyTest`（2 个）：应用里的隐私政策和用户协议与 `src/shared/policy.ts` 两种语言逐段相同；「开源许可」页写到了锁文件里进安装包的每一个库。

### 6.2 构建产物

- 调试包 19.9 MB；正式构建（R8，未签名）2.4 MB。lint 没有问题。构建产物不留：验证完跑 `./gradlew clean`。
- `aapt2 dump badging`（正式构建）：包名 `cn.tenonai.apps.jig`，版本 1.0.0（10000），目标 API 37，语言是英文和简体中文，不可调试，权限如 4.6。

### 6.3 模拟器走查

Android 17（API 37），调试包，连 `test-computer.ts`：

| 项目 | 结果 |
| --- | --- |
| 首页、看演示、退出演示 | 通过 |
| 演示里的会话列表、会话记录、审批四类卡片、提问页、决定页、信件列表和信件、设置、关于、隐私政策 | 通过，中英文、深浅色都看过 |
| 用配对链接经本机中继配对 | 通过，会话列表是电脑端的两个会话 |
| 配对后请求通知权限 | 系统对话框弹出，允许后前台服务启动（类型 `remoteMessaging`） |
| 应用在后台时电脑端出现待授权的操作 | 约 2 秒后手机出通知：标题是会话名，正文「要你授权：git push origin main」 |
| 点通知 | 打开应用，进审批页 |
| 电脑端处理掉这件事 | 手机上的通知撤下 |
| 电脑端关掉 | 提示条「连不上」，常驻通知改成连不上、会一直重试 |
| 电脑端换了身份（旧的标识不在线） | 提示条「电脑不在线」 |
| 断开配对（电脑连不上时） | 确认后约 5 秒回到首页，配对和私钥已删 |
| 电脑端主动断开通道后 | 手机自己重连，之后的通知照常收到，没有重复 |
| 接口拒绝请求 | 弹出「没有办成」和电脑端给的原因 |
| 关于页的「开源许可」 | 打开后能从库的清单一直滚到最后的 NOTICE |
| 产物：文档、数据、折线图、页面各一个 | 都显示出来。页面里的脚本去取外网地址，结果是取不到；外网图片不加载 |

Android 8.0（API 26）：调试包的演示、配对、会话列表、后台收通知都通过。正式构建用调试密钥签了装上：能启动，演示能走；粘贴 `ws://` 的配对链接按预期配对不成（正式构建只连 `wss://`），生成密钥和握手的第一条消息都跑过，没有崩溃。

### 6.4 还没验证的

- 真机，尤其是国产系统：前台服务能活多久、自启动和后台限制、通知在各家系统上的表现。
- 扫码：相机预览和二维码识别的代码写了，模拟器上没有能对准二维码的相机，没实测；配对都是用链接做的。
- 正式构建经 `wss://` 的完整握手：`relay.tenonai.cn` 今天刚上线，没有配对着的电脑可连。
- 离开超过 10 分钟后重连时的汇总通知：模拟器上没能造出这种情况，只验证了短暂断线后不重复通知。
- 开机后服务自己恢复、Doze 下的表现、长时间挂着的耗电。
- 读屏（TalkBack）和大字体下的逐页检查。
- 产物在 Android 8.0 上没看（只在 Android 17 上看过）；旧版本系统自带的网页视图对内容安全策略的支持没核对，联网是靠网页视图自己的设置挡住的。
- 依赖文件的校验值（`gradle/verification-metadata.xml`）还没生成，现在只锁了版本。

## 7. 签名和发布

都还没做。**拿到 App 备案号之前，安卓安装包不公开放出，官网和 Releases 都不放**（法务组 11-15）。

发安装包之前要齐的：

| 事 | 状态 |
| --- | --- |
| 应用里的「开源许可」页 | 做了（4.4），法务组 11-15 核过 |
| 隐私政策里安卓的内容 | 草稿见 7.1，法务组 11-15 对照代码核过，措辞不用改。现在不并进 `src/shared/policy.ts`：等发安卓安装包那一次，由主开发会话并入并升版本，再跑 `sync-policy.ts`。**安装包里的 `policy.xml` 必须是带安卓段落的那一版**，现在这份只写了 iPhone，不能带着发 |
| App 备案 | 包名、证书 MD5 指纹和公钥 11-15 发给了主开发会话转法务组。Jig 手机端联网、默认连我们的中继，要先用公司主体办备案，iPhone 和安卓一起报，由创始人在腾讯云提交（法务组已发总办排期）。备案要填包名 `cn.tenonai.apps.jig`、签名证书的 MD5 指纹和公钥 |
| 签名密钥 | 2026-11-15 生成，见 7.2。还没备份；生成脚本还没给安全组看 |
| 发布脚本 | 没写。Gradle 只出未签名的正式构建；签名、核对证书指纹和权限的脚本到生成密钥时写 |
| 首次放出 | 请创始人在本会话确认（规范 17.10） |

### 7.1 隐私政策里安卓的段落（草稿，法务组 2026-11-15 核过）

放在「手机访问」那段里 iPhone 的句子后面。并入时主开发会话同时把两个平台都适用的「iPhone」改成「手机」，只有 iPhone 才有的仍写 iPhone。

中文：

> 安卓上的 Jig 把配对信息和自己的密钥存在应用的私有文件里，用 Android 密钥库里的密钥加密，只存在这台设备上，不进系统备份和换机传输。安卓上的 Jig 不使用推送服务，也没有推送令牌：打开通知后，它用一个前台服务在后台保持到中继的连接，电脑经端到端加密的通道把通知的内容发给手机，中继只转发密文；系统会为这条连接显示一条常驻通知，系统停掉 Jig 时收不到通知。扫描配对二维码时用到相机，画面只在手机上识别，不保存也不发出。手机上另记着通知的开关和已经看到的待办的编号，不含内容。

English:

> Jig on Android keeps the pairing and its own key in a private file of the app, encrypted with a key in the Android Keystore, on that device only; it is left out of system backups and device transfers. Jig on Android uses no push service and has no push token: with notifications on, a foreground service keeps a connection to the relay open in the background, and the computer sends what a notification says to the phone over the end-to-end encrypted channel; the relay only passes ciphertext along. Android shows a standing notification for this connection, and notifications do not arrive while the system has stopped Jig. Scanning the pairing QR code uses the camera; the picture is read on the phone and is neither kept nor sent. The phone also remembers whether notifications are on and the ids of the items it has already seen, without their content.

### 7.2 签名密钥

创始人 2026-11-15 在本会话确认（「确认」）后，02:07 用 `android/scripts/create-signing-key.sh` 生成，照产品规范 15.6。

| | |
| --- | --- |
| 包名 | `cn.tenonai.apps.jig` |
| 证书主体 | `CN=Jig, O="Changsha Tenon Artificial Intelligence Technology Co., Ltd.", L=Changsha, C=CN` |
| 密钥 | RSA 4096，有效期 30 年，PKCS12，别名 `jig` |
| SHA-256 | `6737325656156A54F9A8BE1735D87F4B30160653ECAEB9FD513B05969F6A4361` |
| SHA-1 | `B3E8C4CCF1F6383CBA73BE5A82A5F420314743D1` |
| MD5 | `C525CD6F71F5A1E1B23FB02C33D1A05A` |
| 公钥 | `android/release/signing-public-key.txt`（模数的十六进制，指数 65537） |

指纹和公钥不是秘密。SHA-256 另存在 `android/release/signing-certificate.sha256`，发布脚本拿它核对。

- 密钥库在仓库外的 `~/.tenon-keys/android/jig/jig-release.p12`，目录 0700、文件 0600。
- 口令由脚本随机生成，直接存进登录钥匙串（服务 `tenon-android-signing`，账户 `jig`），没有显示过，不在任何文件、命令参数、日志和会话里。
- 正式运行之前，脚本用一次性的测试密钥在临时目录里演练过一遍，测试密钥和它的钥匙串条目已删。
- **还没备份**（15.6.3）：用这把密钥签的包第一次对外发布或交给别人安装之前，要在这台 Mac 之外做好至少一份加密备份并做恢复演练，映像口令由创始人在终端里输入。在那之前这台 Mac 坏了，密钥就没了；因为还没发过包，重新生成一把、改掉这里和备案登记的指纹就行。备份脚本还没写。
- **脚本还没给安全组看**（15.6.4 要求先看）：做法和安全组 11-14 审过的 PassBy 那份相同（口令经标准输入进钥匙串、`-storepass:env`、生成后核对证书主体）。安全组有意见要重来的话，同上，重新生成并改登记。
- 怀疑泄露：停止用它发布，告诉安全组（15.6.6）。

## 8. 交给别的会话的事

- 主开发会话：发安卓安装包那一次把 7.1 的段落并进 `src/shared/policy.ts` 并升版本；电脑端「添加 iPhone」的按钮和 `jig remote` 的帮助文字要不要改成不分手机系统的说法；`npm run check` 要不要带上安卓的单元测试。
- 官网地址：应用里和 iPhone、电脑端一样写的是 tenon.asia；产品规范 1.1 说官网已迁到 tenonai.cn。三端要一起改，由主开发会话定。
