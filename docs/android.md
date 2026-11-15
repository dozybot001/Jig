# Jig 安卓版

状态（2026-11-15）：功能写完（含 1.0.0 加的「产物」入口），能构建，单元测试通过，在 Android 17 和 Android 8.0 两台模拟器上走查过（第 6 节）。签名密钥 11-15 02:07 已生成，02:27 做了备份和恢复演练（7.2）。1.0.1 已于 11-15 放到 GitHub 和 Gitee 的 Releases（7.5）。还没做：真机、扫码的实测、发布。安卓版不卡 v1 的验收（蓝图第十三节）。

安卓版原来由「Jig 安卓 · 开发」会话负责。创始人 2026-11-15 定一个产品只留一个开发会话（总办转达，原话：「不要分出一个安卓开发，全都并入主开发，保持一个会话」），从这天起安卓端的事归 Jig · 开发，下面的「交接」是那个会话留下的。

## 交接（2026-11-15）

### 现状

- 已放出：1.0.2，Releases 上的 `Jig-1.0.2.apk`（7.5）。本机留着同一个文件：`android/build/release/Jig-1.0.2.apk` 和 `SHA256SUMS`（不进 git，`./gradlew clean` 不会删它，但再跑一次 `release.sh` 会）。
- main 上没有比 1.0.2 新、还没发出去的安卓改动。
- 创始人的 Redmi（序列号 `89DEU8ZDBEB6VWRO`）上装着 Releases 的 1.0.1，已经和他电脑上的 Jig 配对（6.4）。手机上有他的真实数据，没有他明说不装包、不操作。
- 没有未提交的改动，没有还在跑的模拟器和测试进程。本机多出来的东西：两台模拟器 `jig37`、`jig26`（`~/.android/avd/`，用的是已有镜像）。

### 进行中的事

1. **经中继的传输慢**（创始人在真机上最明显的问题，6.4）：Jig · 开发查到原因不在服务器带宽和中继代码，是创始人电脑的出口在新加坡，到国内中继的线路绕道欧洲，TCP 建连就要 0.33 秒，每个字节走两段这样的线路。回应压缩电脑端（35c86b4）、iPhone 和安卓（eade64a）三端都已接上；握手慢是线路的事，压缩帮不上。要生效，创始人电脑上的 `jig serve` 得重启，手机得装 1.0.2。给手机一份精简的记录先不做，等创始人反馈还慢再说。压缩后量过一次（11-15，内存里的临时电脑加测试手机，经 `wss://relay.tenonai.cn`，读 118 KB 的会话列表）：不压缩 8.4、8.5、11.4 秒，压缩 2.7、2.3、1.7 秒；握手约 2.5 秒。会话记录的压缩率比列表低，真机上没量。
2. **真机上还没验证的**（6.4、6.5）：在手机上授权、回答提问、处理决定卡；锁屏和放久以后前台服务还在不在；小米的自启动和后台限制；二维码识别（相机权限是允许的，但我没看到扫码的过程）；「更早的记录」对着有多页记录的会话点一次。
3. **测试留下的一条提问**：我用 `jig send` 给创始人的「UI」会话发过一条测试请求，它改成向他提问，这条提问 16:00 时还挂在他的审批中心里，要他回一句或撤掉。测试文件在我的临时目录里，没被删，不用管。

### 还没定的问题、正在问创始人的问题

- 1.0.2 已放出，创始人可以自己从 Releases 装；由我们往他的手机上装包仍要他明说。
- **没定**：`npm run check` 要不要带上安卓的单元测试；官网地址三端都写的是 tenon.asia，产品规范 1.1 说已迁到 tenonai.cn；`backup-signing-key.sh` 的提示文字里还提到密码管理器、纸质和 iCloud 云盘（脚本对使用者的通用提示，安全组审过脚本、只要求改文档，要不要也改等它一句话）；设置页的通知开关只在手机本地生效，没有去改电脑上的 `devices.push`。

### 签名密钥、备份和发布：在哪、怎么用

口令和密钥内容不在仓库里，也不在任何会话里。

- **密钥库**：`~/.tenon-keys/android/jig/jig-release.p12`（目录 0700、文件 0600），别名 `jig`。口令在登录钥匙串里：服务 `tenon-android-signing`，账户 `jig`。证书指纹和公钥在 7.2 节和 `android/release/`。
- **备份**：已做并通过恢复演练（7.2）；位置和口令的保管方式不写在公开仓库里，在安全组的内部文档。每年做一次恢复演练：创始人在能直接打字的终端里运行 `android/scripts/backup-signing-key.sh <文件夹>`，映像口令由他自己输入。
- **出正式包**：在 `android/` 下运行 `scripts/release.sh`（7.3）。它要求 `android/`、`package.json`、`src/shared/policy.ts` 没有未提交的改动，先查 OSV，再跑测试和 lint、构建、签名、核对，产物在 `android/build/release/`。它不发布。
- **升级依赖**：见第 3 节（锁文件、校验值、`dependencies.ts`、`check-vulnerabilities.ts` 要一起更新）。隐私政策改了以后跑 `node android/scripts/sync-policy.ts`。
- **不要做的**：不要重新生成密钥（`create-signing-key.sh` 发现已有密钥库会停）；不要把密钥库、口令或备份映像复制到别处，导出和另做备份要创始人确认（15.6.4）。

### 和别的组约定过的

- **安全组**：生成、备份、发布三个脚本它都审过；以后改这些脚本先给它看再运行（15.6.4）。每次对外发包前把候选包发它验，上传后从 GitHub 和 Gitee 各下载一次核对校验值并告诉它（15.6.7）。打标签要指向出包的那个提交。怀疑密钥泄露就停止发布并告诉它。公开仓库里不写备份放在哪、有几份、口令怎么保管（15.6.5）。
- **法务组**：依赖清单它核过（当时 145 个，guava 升版本后是 143 个，没有新增许可证，已请 Jig · 开发转告）；应用里的「开源许可」页由脚本生成，libyuv 的归属它确认过（4.4）；隐私政策里安卓的内容在 2.1 已并入；自带 Bouncy Castle，上应用商店时出口合规按「用了非系统的标准加密算法」填（4.5）；App 备案推后到上架国区时统一办（7.5），包名、证书 MD5 指纹和公钥已交给它。
- **平台组**：只收到过一条通知（「Tenon 待办」页停用，要创始人定的事照旧发总办），没有别的约定。
- **PassBy 安卓会话**：这台 Mac 上两边都用模拟器，`adb` 一律带序列号，Jig 的模拟器固定用端口 5570、5572（第 3 节，含我误关它模拟器的那一次）。

### 只能创始人本人接着做的事

1. 回掉或撤掉审批中心里那条测试留下的提问（UI 会话在等）。
2. 在手机 Jig 的设置里点「允许 Jig 在后台运行」，并在小米的系统设置里允许 Jig 自启动；否则锁屏久了可能收不到通知。
3. 确认签名密钥备份的映像口令自己取得到（安全组和我都核对不了）。
4. 每年一次的备份恢复演练：要他在终端里自己输入映像口令。
5. 真机验证要他拿着手机配合：授权、回答提问、处理决定卡、扫码。
6. 定要不要往他手机上装带新改动的包；以后每次往真机上装包、每次首次对外放出新版本，也要他明说。
7. App 备案由他在腾讯云提交，推后到上架国区时统一办。

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
| `check-vulnerabilities.ts` | 拿进安装包的库去查 OSV 漏洞库，只发库名和版本；有结果就以 1 退出。`release.sh` 每次出包都跑 |
| `test-computer.ts` | 一台测试用的电脑：本机中继加内存里的 Jig 接口、四个产物和通知，不碰 `~/.jig` 和系统钥匙串。用法见文件开头 |
| `dependencies.ts` | 从锁文件和 Gradle 缓存里各库的 POM 和包，生成 `android/DEPENDENCIES.md`（进安装包的每个库的名称、版本和许可证）和应用里「开源许可」页的内容 `app/src/main/assets/licenses.txt`。升级依赖后跑一次，不跑的话 `PolicyTest` 会失败 |

依赖（都来自 Google Maven 和 Maven Central，版本锁在 `app/gradle.lockfile`）：Compose 和 AndroidX、CameraX（扫码的相机）、ZXing core（识别二维码）、OkHttp（到中继的 WebSocket）、Bouncy Castle（X25519 和 ChaCha20-Poly1305：系统自带的要到 API 31 和 28 才有）、kotlinx.coroutines、kotlinx.serialization-json。没有统计、崩溃上报、推送和 Google 服务的库。全部 143 个库（多数是 AndroidX 和 Kotlin 的传递依赖）列在 [android/DEPENDENCIES.md](../android/DEPENDENCIES.md)：142 个 Apache-2.0，1 个 Bouncy Castle 许可证（MIT 式）。法务组 11-15 核过当时的 145 个，可以；之后 guava 升了版本（见 4.7），带走了 checker-qual（MIT）和另一个注解库，没有新增许可证。

## 3. 构建和运行

要有 JDK 21 和 Android SDK（平台 API 37、build-tools 37.0.0）。SDK 的位置写在 `android/local.properties` 的 `sdk.dir` 里，这个文件不进 git。命令都在 `android/` 下跑：

| 命令 | 做什么 |
| --- | --- |
| `./gradlew :app:testDebugUnitTest` | 单元测试 |
| `./gradlew :app:lintDebug` | lint |
| `./gradlew :app:assembleDebug` | 调试包 `app/build/outputs/apk/debug/app-debug.apk`，用调试密钥签，只用于测试 |
| `./gradlew :app:assembleRelease` | 正式构建 `app/build/outputs/apk/release/app-release-unsigned.apk`，开了 R8，没有签名 |

依赖的版本锁在 `app/gradle.lockfile` 和 `settings-gradle.lockfile`；每个依赖文件的 SHA-256 记在 `gradle/verification-metadata.xml`，下载到的文件对不上，构建就失败。

升级依赖：改 `gradle/libs.versions.toml`，跑 `./gradlew --write-locks --write-verification-metadata sha256 :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug`，再跑 `dependencies.ts` 和 `check-vulnerabilities.ts`，把这几个文件的改动一起提交。

调试版才有的启动参数（模拟器上用，正式构建里没有）：`--es jig.pair '<配对链接>'` 像扫码一样配对，`--ez jig.demo true` 打开演示，`--es jig.tab approvals|letters|artifacts` 选入口。调试版允许连本网络里 `ws://` 的测试中继，正式构建只连 `wss://`。

连本机的测试电脑：

```bash
node android/scripts/test-computer.ts /tmp/jig-android    # 配对链接写在 /tmp/jig-android/link.txt
emulator -avd jig37 -port 5570 &                            # Jig 自己的模拟器，固定端口，序列号 emulator-5570
adb -s emulator-5570 reverse tcp:8791 tcp:8791
adb -s emulator-5570 shell am start -n cn.tenonai.apps.jig.debug/cn.tenonai.apps.jig.MainActivity --es jig.pair "'$(cat /tmp/jig-android/link.txt)'"
echo "ask git push origin main" > /tmp/jig-android/cmd      # 电脑端出现一个待授权的操作，手机收到通知
echo settle > /tmp/jig-android/cmd                          # 电脑端处理掉，手机上的通知撤下
```

这台 Mac 上别的会话也在用模拟器，创始人的真机也可能连着，所以：

- 每条 `adb` 命令都带 `-s <序列号>`，不用不带序列号的 `adb`，也不「关掉全部模拟器」。Jig 的两台模拟器 `jig37`、`jig26` 固定用端口 5570 和 5572（序列号 `emulator-5570`、`emulator-5572`），操作前用 `adb -s <序列号> emu avd name` 核对是自己那台，结束时只关自己那台。
- 真机（创始人的 Redmi）上有他的真实数据：没有他在本会话里明说，不往上装包、不操作。
- 2026-11-15 15:41 我犯过一次错：没核对就认定 `emulator-5554` 是自己的，其实那是 PassBy 会话的 `passby37`。我往它上面装了 Jig 的调试包、打开过、点了一下、截了图，然后把它关了机；没有动 PassBy 的应用和数据。自己的 `jig37` 当时起在 5556 上，被留着没关。已告诉 PassBy 会话。

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

### 4.3 回应的压缩

手机的每个请求都带 `"z": 1`。电脑端的回应正文不少于 1024 个字符时，在加密之前压缩：`res` 带 `"z": 1`，`body` 是正文 UTF-8 的 raw DEFLATE（RFC 1951，没有 zlib 头）再 base64；安卓用 `Inflater(true)` 解，解出来超过 16 MB 就拒绝。事件流不压缩；旧版电脑端不认识 `z`，照原样回，所以可以无条件带上（`src/remote/protocol.ts`，电脑端 35c86b4）。

验证：单元测试用电脑端 `zlib.deflateRawSync` 压出来的数据；新包在模拟器上连本机的测试电脑端（带压缩的代码），配对、会话列表和产物列表都读得出。实际收到的回应里有没有压缩过的，我没有逐条确认；真机和正式中继上没试。

### 4.3a 产物

- 列表读 `GET /api/artifacts`，内容读 `GET /api/artifacts/:id/versions/:n`（纯文本），只看最新一版。文档按行内 Markdown 显示，数据排版成缩进的 JSON，图表（柱状或折线）自己画，黑白灰，系列之间用深浅区分。
- HTML 产物放在封闭的网页视图里（蓝图 6.6 第 19 条）：没有自己的地址，不加载网络和文件，页面发出的每个请求都得到空的回应，链接点了不跳转，页面里另加一条内容安全策略；不开本地存储。页面自己的脚本能跑，但碰不到 Jig、电脑和网络。

### 4.4 开源许可页

关于页里的「开源许可」随安装包走，内容由 `dependencies.ts` 生成，不手写（法务组 11-15 的要求）：

- 142 个 Apache-2.0 的库的名称和版本，后面附一份 Apache-2.0 全文（取自 AndroidX 包里的 `LICENSE.txt`）。
- Bouncy Castle 包里的许可原文，带版权行。（checker-qual 在 guava 升版本后不再进安装包。）
- `androidx.camera:camera-core` 的 POM 另写了 BSD-3-Clause。它的包里没有这部分的声明文字。这是它本地图像处理库里编进去的 libyuv，页面上放的是 libyuv 自己的许可（`scripts/notices/libyuv.txt`，全仓库只有这一份是手放的）。法务组 11-15 确认了归属，依据有两处：AndroidX 源码 `camera/camera-core/build.gradle` 的库说明写着「This library includes code from libyuv, which is licensed under the BSD-3-Clause license」，并用 `extraLicense` 声明了 BSD-3-Clause；libyuv 仓库根目录的 `LICENSE`。升级 camera 版本时对着这两处复核，出处也写在 `dependencies.ts` 的注释里。
- 各库包里带的 NOTICE 文件：只有 `jakarta.inject:jakarta.inject-api` 有一份，照原文放。
- 脚本遇到不认识的许可证，或者 MIT 一类的库包里找不到许可原文，就报错，不会悄悄漏掉。

### 4.5 加密

安卓版自带 Bouncy Castle 做 X25519 和 ChaCha20-Poly1305，不是系统加密（系统自带的要到 API 31 和 28 才有，应用从 26 起）；SHA-256、HMAC 和存储用的 AES-GCM 是系统的。法务组 11-15：直接发安装包没有申报手续；以后上应用商店，出口合规按「用了非系统的标准加密算法」填。iPhone 版只用系统的 CryptoKit，两端的填法不同。

### 4.6 依赖的校验和漏洞检查

安全组 11-15 要求在第一次对外发包前补上，已做：

- 校验值：`gradle/verification-metadata.xml`，见第 3 节。生成后清掉构建产物重新构建过，能过。
- OSV：2026-11-15 第一次查出 1 条，`com.google.guava:guava 33.3.1-android` 的 GHSA-xxph-c9ww-hj94（CVE-2026-102554，反序列化时可以被撑爆内存，33.7.2 修复）。guava 不是 Jig 自己用的，是 CameraX 经 `androidx.media3` 带进来的，Jig 也不反序列化 Java 对象；仍用依赖约束把它提到 33.8.0-android。复查：143 个库，0 条。

### 4.7 权限

合并后的清单里只有这些（`aapt2 dump badging` 核对过）：`INTERNET`、`ACCESS_NETWORK_STATE`、`CAMERA`（只在扫码时用，没有相机的手机可以粘贴链接）、`POST_NOTIFICATIONS`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_REMOTE_MESSAGING`、`RECEIVE_BOOT_COMPLETED`、`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，以及 `androidx.core` 给应用自己声明的 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`。

## 5. 和 iPhone 版不同的地方

| 事 | iPhone | 安卓 |
| --- | --- | --- |
| 通知怎么送到 | APNs，内容为这台手机加密，通知扩展解密 | 应用自己保持到中继的连接，经加密通道收；被系统停掉时收不到 |
| 角标 | 应用图标上是审批中心的待办数 | 没有统一的角标接口，只把数字交给通知（部分桌面会显示） |
| 称呼 | Mac、iPhone | 电脑、手机（Jig 也能跑在 Linux 上） |
| 配对说明 | 「添加手机」 | 「添加手机」。电脑端的按钮在 e2aba33 从「添加 iPhone」改成「添加手机」，安卓的说明跟着改了，下次出包带上；已放出的安卓 1.0.1 写的还是「添加 iPhone（安卓手机也用这个按钮）」，和已发布的电脑端 1.0.x 对得上 |
| 调试版的直连本机 | 有（粘贴 `jig open` 的链接） | 没有，用 `test-computer.ts` 的本机中继 |
| 隐私政策和用户协议 | 同一份文字 | 同一份文字（`src/shared/policy.ts`，现在是 2.0）。里面写的还是 iPhone、iOS 钥匙串和 Apple 的推送，没有安卓的内容 |
| 密钥存放 | iOS 钥匙串，应用和通知扩展共用 | Keystore 加密的文件，见 4.1 |

## 6. 验证记录

2026-11-15，在这台 Mac 上。模拟器是 AOSP 的 arm64 镜像，没有 Google 服务。

### 6.1 单元测试

17 个全部通过。

- `NoiseTest`（9 个）：公钥、握手的两条消息、握手哈希、请求和回应的帧、三块的长消息，和电脑端代码生成的向量逐字节一致；改过一个字节的帧和握手回应被拒绝，计数器不动；全零的公钥被拒绝；配对链接按电脑端写的样子读出来；`test/push.test.ts` 的固定向量（通知密钥和密文）解得开，改过的、换了密钥的解不开。
- `ApiTest`（5 个）：事件流按任意分片切成事件；会话记录变成消息、信件和一行工具摘要；审批中心的两种提问格式；通知的文字；行内 Markdown 一遍切完，很长的文本也不超时；电脑端代码压出来的回应解得开，截短的和不是 base64 的被拒绝。
- `PolicyTest`（2 个）：应用里的隐私政策和用户协议与 `src/shared/policy.ts` 两种语言逐段相同；「开源许可」页写到了锁文件里进安装包的每一个库。

### 6.2 构建产物

- 调试包 19.9 MB；正式构建（R8，未签名）2.4 MB。lint 没有问题。构建产物不留：验证完跑 `./gradlew clean`。
- `aapt2 dump badging`（正式构建）：包名 `cn.tenonai.apps.jig`，版本 1.0.1（10001），目标 API 37，语言是英文和简体中文，不可调试，权限如 4.7。

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

### 6.4 真机（2026-11-15）

创始人的 Redmi Note 11T Pro+（22041216UC），Android 12，MIUI 13。装的是 Releases 上的 `Jig-1.0.1.apk`（正式签名）。

- `adb install` 一次成功，没有崩溃记录。
- 创始人在电脑的 Jig（1.0.1）里打开「手机访问」，在手机上配对成功：电脑端 `jig remote status` 显示配对的手机 1 台（Redmi Note 11T Pro+），手机上的会话列表是他真实的会话。这是正式构建第一次经 `wss://relay.tenonai.cn` 走完握手。
- 相机权限是允许的，配对应当是扫码做的；我没有看到扫码的过程，没向他确认。
- 通知权限已允许，前台服务在运行，常驻通知在。
- 系统没有把 Jig 放进电池优化的白名单（他还没在设置页里点「允许 Jig 在后台运行」）。
- 通知：我用 `jig send` 给他的「UI」会话发了一条测试请求（他同意的）。会话没有照命令行来的信去删文件，改成向他提问，这件待办约 40 秒后出现在电脑端；他说手机上收到了通知。通知到达的时刻我没有抓到。
- 他反馈：点开 UI 会话后要等很久才出现消息。查到两个原因：
  - 网络（主因，不在安卓这边）：从这台 Mac 自己经 `wss://relay.tenonai.cn` 当一台测试手机去量，握手 4–15 秒，会话列表和审批中心 0.7–1.7 秒，UI 会话最近 100 条的记录（175KB）7–14 秒，约每秒 13–25KB；直接请求中继的 `/health` 也要 1–3 秒（TCP 连接 0.33–0.7 秒）。数字已发主开发会话。
  - 安卓自己的两处，已改，随下一个版本：行内 Markdown 的解析原来按字符截取剩余文本，长回复在主线程上很慢，而且每次重绘都重算，改成一遍扫完并缓存（76 万字的文本从 44 秒到 0.14 秒）；会话记录原来一次读 100 条、读到之前屏幕是空的，改成先读最近 30 条（同一个会话是 82KB，约 4.5 秒）、顶部有「更早的记录」、读的时候显示进度。
- 还没验证：锁屏和放久了以后服务还在不在、小米的自启动和后台限制、在手机上授权和回复、改动后的会话页在真机上的表现；「更早的记录」只编译和跑过演示，没有对着有多页记录的会话点过。

### 6.5 还没验证的

- 真机上（6.4 之外）：前台服务能活多久、自启动和后台限制、通知在各家系统上的表现。
- 扫码：模拟器上扫码页能打开，相机预览正常（guava 升版本后看的）；二维码识别没实测，模拟器的相机对不准二维码，配对都是用链接做的。
- 离开超过 10 分钟后重连时的汇总通知：模拟器上没能造出这种情况，只验证了短暂断线后不重复通知。
- 开机后服务自己恢复、Doze 下的表现、长时间挂着的耗电。
- 读屏（TalkBack）和大字体下的逐页检查。
- 产物在 Android 8.0 上没看（只在 Android 17 上看过）；旧版本系统自带的网页视图对内容安全策略的支持没核对，联网是靠网页视图自己的设置挡住的。
- guava 升到 33.8.0 以后只在模拟器上看了启动、扫码页和隐私政策页，没有重走全部页面。

## 7. 签名和发布

1.0.1 已放出（7.5）。

法务组 11-15 的结论是「拿到 App 备案号之前，安卓安装包不公开放出」。创始人 11-15 在 Jig 会话里改定手机端直接发 Releases，由主开发会话转达，原话：「手机端我们都整开源项目了，ipa 和 apk 都构建发布 release 即可」「告诉其他有移动端的会话，并且作为规范」。之后创始人又改定「算了，ipa 还是走官方路径吧，我们就分发 apk」：Release 里只放安卓的 apk。等不等备案号（总办的待办 Q125），创始人 11-15 在 Jig 会话里答了，由主开发会话转达，原话：「现在发，备案照办」。所以不等备案号。备案后来推后了：创始人 2026-11-15 在总办会话改定（总办转达）：「我们之后上架国区统一办 app 备案」，Jig 的备案「也推后」。安全组的条件没有取消：密钥的备份和恢复演练、候选包由它验过。Release 由主开发会话统一建，安卓会话不上传。

发安装包之前要齐的：

| 事 | 状态 |
| --- | --- |
| 应用里的「开源许可」页 | 做了（4.4），法务组 11-15 核过 |
| 隐私政策里安卓的内容 | 做了：主开发会话在 1.0.1 把安卓的内容并进了 `src/shared/policy.ts`（隐私政策 2.1，82d050b），应用里的已同步，模拟器上看过。当初的草稿留在 7.1 |
| App 备案 | 包名、证书 MD5 指纹和公钥 11-15 发给了主开发会话，它已请法务组提交。Jig 手机端联网、默认连我们的中继，要先用公司主体办备案，iPhone 和安卓一起报，由创始人在腾讯云提交；推后到上架国区时统一办，上 App Store 中国区或国内应用商店之前要先有备案号。备案要填包名 `cn.tenonai.apps.jig`、签名证书的 MD5 指纹和公钥 |
| 签名密钥 | 2026-11-15 生成并备份，恢复演练通过，见 7.2。安全组核对过映像和记录 |
| 备份脚本和发布脚本 | 安全组 11-15 审过（4e950bd），都可以；按它的意见改了备份脚本的检查顺序，发布脚本加了 OSV 检查（7.3） |
| 依赖的校验值和 OSV 检查 | 做了（4.6） |
| 安全组验候选包 | 11-15 验过，合格（7.4）。备份做完、它核对映像和记录后回「可以上传」 |
| 首次放出 | 创始人在 Jig 会话定了 apk 发 Releases（见上）；上传由主开发会话做，备份和恢复演练 11-15 02:27 做完，安全组核对后回了「可以上传」；主开发会话打 `v1.0.1` 标签（指向 9920519）并建两边的 Release |

### 7.1 隐私政策里安卓的段落（草稿，法务组 2026-11-15 核过；已在隐私政策 2.1 并入）

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
- 备份已做并通过恢复演练（2026-11-15）；备份的位置和口令的保管方式不写在公开仓库里，记在安全组的内部文档（规范 15.6.5）。备份是一个 AES-256 加密的磁盘映像，映像口令由创始人在终端里输入，没有出现在任何会话里；恢复演练用备份里的私钥真签了一次并验签，证书 SHA-256 和登记的一致。安全组核对过。之后每年做一次恢复演练。
- `hdiutil` 在 macOS 27 上提示脚本用的几个用法已弃用，现在还能用；哪年不能用了换成 `diskutil image` 的对应命令。
- 生成脚本是先运行、后送审的，顺序不对（15.6.4 要求先给安全组看）。安全组 11-15 补看后的结论：可以，不用重来；以后先看再运行。
- 怀疑泄露：停止用它发布，告诉安全组（15.6.6）。

### 7.3 备份和出正式包

两个脚本都在 `android/scripts/`，共用 `signing-common.sh`。安全组 11-15 审过，备份脚本可以对着正式密钥运行。

备份：`backup-signing-key.sh <放备份的文件夹> [<另一处> ...]`

- 要创始人在能直接打字的终端里跑：映像口令从键盘读（不回显，输两次，不少于 20 个字符），不经管道和参数，也不出现在任何会话里；不是终端就拒绝运行。
- 备份是一个 AES-256 加密的磁盘映像，里面有密钥库、密钥库的口令和写着三个指纹的说明。密钥库的口令直接写进挂载的映像，不经过普通磁盘。
- 当场做恢复演练：重新只读打开映像，用里面的口令打开密钥库，核对证书 SHA-256 和登记的一致；再用里面的私钥签一份证书请求，看到 `verify OK` 才算验签通过（系统的 LibreSSL 验签失败也返回 0），并核对请求里的公钥就是证书里的公钥。演练没过的映像会删掉。
- 演练通过后把同一个映像复制到给出的每个文件夹，逐字节比对。放哪由创始人定，这台 Mac 之外至少一份（15.6.3）；不能放在密钥目录里。哪个文件夹里已有同名文件，一开始就停，什么都不建（安全组的意见）。给出的文件夹看上去都在这台 Mac 自己的盘上时，提醒一句，不拦。
- 做完告诉安全组，它核对映像和记录。

出正式包：`release.sh`，这一步不发布任何东西。

1. `android/`、`package.json` 或 `src/shared/policy.ts` 有没提交的改动就停；应用里的隐私政策没有安卓的内容也停（7.1）。
2. 查 OSV，有已知漏洞或查不了就停；再跑单元测试、lint 和正式构建。
3. 用 `apksigner` 签名，只用 v2 和 v3。口令从钥匙串读进环境变量，不经过 Gradle。找不到正式密钥就停，不会改用别的密钥。
4. 核对，全部通过才得到正式的文件名，中途退出就删掉没核对完的文件：签名验证通过、证书 SHA-256 和登记的一致、签名者只有一个、没有 v1 签名；包名和版本号对、不可调试、关掉了明文连接和系统备份；申请和声明的权限恰好是 4.7 的名单。
5. 产物在 `android/build/release/`：`Jig-<版本>.apk` 和 `SHA256SUMS`。

2026-11-15 用一次性的测试密钥在临时目录里演练过，测试密钥、它的钥匙串条目和签出来的包都已删：

- 备份：正常流程走通（两处的副本和原件一致，恢复演练通过）；同一天重复运行、口令太短、登记的指纹对不上、不在终端里运行，都被拦下，没有留下映像。
- 出包：原样运行被「有没提交的改动」拦下；去掉这一条和隐私政策那一条后，测试密钥签的 1.0.0 走完全部核对；登记的指纹不对时被拦下，没有留下包。
- 按安全组意见改过以后又演练了备份脚本：第二处已有同名文件时一开始就停，第一处和密钥目录里什么都没留；两处都在本机盘上时出提醒，流程照常走完。发布脚本加的 OSV 那一步没有另外演练整个流程，只单独跑过检查脚本。

### 7.4 候选包（2026-11-15）

`scripts/release.sh` 对着正式密钥从头跑通，出了第一个正式签名的包。它在这台 Mac 的 `android/build/release/` 里，不进 git，**没有对外放出**。发布前代码有改动的话，要从发布的那个提交重新出包，校验值会变。

| | |
| --- | --- |
| 文件 | `Jig-1.0.1.apk`，2,455,041 字节 |
| 对应的提交 | 9920519 |
| SHA-256 | `2ad0718be8d9e217cb9a17487baad1b3d6d4554fd9d3350be9c0b12066c7a853` |
| 签名 | 只有 v2 和 v3，签名者一个，RSA 4096；证书 SHA-256 和登记的一致 |
| 包信息 | `cn.tenonai.apps.jig`，1.0.1（10001），最低 API 26，目标 API 37，不可调试，明文连接和系统备份都关着 |
| 权限 | 4.7 的 8 项加应用自己的 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` |
| 出包时的检查 | OSV 0 条；单元测试 15 个、lint 通过；隐私政策是带安卓内容的 2.1 |

在 Android 17 模拟器上装了这个包：能启动，关于页显示 1.0.1 和构建 9920519，开源许可页、演示里的产物（柱状图）和审批都正常，没有崩溃；看完已卸载。没验证的：这个包经 `wss://` 和真实电脑的配对、通知、真机。

安全组 11-15 自己验了这个包，合格：校验值和 `SHA256SUMS` 一致；签名只有 v2、v3，一个签名者，证书主体公司名完整，证书 SHA-256 和登记的一致；包名、版本、不可调试；系统备份和明文连接都关着，云备份和换机的各个域都排除了；权限恰好是名单上的；自己的组件只有启动页导出（另一个导出的是 androidx 的 `ProfileInstallReceiver`，要 `DUMP` 权限，普通应用调不了）；包里没有密钥和环境文件；密钥目录和文件的权限、钥匙串条目、仓库全部历史都查过。它的两点提醒：

- 这个包对应 9920519。打标签时指向 9920519，或者从要发布的提交重新出包，把新的 SHA-256 发安全组。
- 上传后从 GitHub 和 Gitee 各下载一次，核对和 `SHA256SUMS` 一致（15.6.7），结果告诉安全组。

### 7.5 已放出的版本

| 版本 | 日期 | 标签 | 安装包 SHA-256 |
| --- | --- | --- | --- |
| 1.0.1 | 2026-11-15 | `v1.0.1`，指向 9920519 | `2ad0718be8d9e217cb9a17487baad1b3d6d4554fd9d3350be9c0b12066c7a853` |
| 1.0.2 | 2026-11-15 | `v1.0.2`，指向 19f4cd6 | `2aca3d05f07773a95755766b106c2080236d17e3d9a63414bfe710c64b95a8ee` |

- 地址：https://github.com/dozybot001/Jig/releases/tag/v1.0.1 、https://gitee.com/dozybot/jig/releases/tag/v1.0.1 。就是 7.4 那个候选包，由主开发会话上传；它从两边各下载一次核对过校验值，已告诉安全组。
- 我另查了 GitHub 这个 Release 的附件信息（没有下载）：`Jig-1.0.1.apk` 2,455,041 字节，GitHub 记的 SHA-256 和上表一致；本地的 `v1.0.1` 标签指向 9920519。Gitee 那边我没有自己核对。
- 放出时没验证过的仍然没验证：这个包经 `wss://` 和真实电脑的配对与通知、真机、二维码识别（6.5）。
- App 备案推后（创始人 2026-11-15 在总办会话改定（总办转达）：「我们之后上架国区统一办 app 备案」，Jig 的备案「也推后」）。apk 照常在 Releases 发；上 App Store 中国区或国内应用商店之前仍要先有备案号，拿到号后关于页再补。
- 1.0.2：https://github.com/dozybot001/Jig/releases/tag/v1.0.2 、https://gitee.com/dozybot/jig/releases/tag/v1.0.2 。安全组验过候选包；上传后从两边各下载一次，校验值一致。带回应压缩、会话记录分段读取、「添加手机」。创始人对「发 1.0.2 吗」的答复是「已发」，按同意办的，并向他说明了这个理解。没验证的和 1.0.1 一样，另加：压缩在真机上的效果。
- 以后每次放出照 7.3 出包。安全组 11-15 定：清单、权限、依赖、签名脚本、联网和加密相关的代码有变化，候选包先发它验、等结论再传；只是界面、文案和不碰这些的改动不用等，传完把 SHA-256、提交号和两边下载核对的结果发它备案。

## 8. 交给别的会话的事

- 主开发会话：`npm run check` 要不要带上安卓的单元测试。
- 官网地址：应用里和 iPhone、电脑端一样写的是 tenon.asia；产品规范 1.1 说官网已迁到 tenonai.cn。三端要一起改，由主开发会话定。
