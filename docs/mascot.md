# 红发女孩 Yew 出图清单

界面里的红发女孩名字也叫 Yew，对外不叫吉祥物（蓝图第十二节）；代码和素材目录沿用 mascot 这个内部名。本文写她的设定、姿势和立绘、出图和入库的做法。

最早的 10 个姿势都是正面半身。2026-11-18 创始人说：「我觉得目前可能也有目前看板娘动作太少的原因，此外目前的图也都很相似，都是站着正面镜头，可以再多生成一些」。所以 11-18 这一批换角度、换动作，动作和 Yew 的功能对上，共 28 张，加一张高清立绘，都已入库。

## 一、最早的 10 个姿势

文件是 `web/public/mascot/<姿势>.webp`，都在同一块 373×400 的透明画布上，人物居中、贴着底边，换姿势时位置不跳。

| 姿势 | 样子 | 现在用在 |
| --- | --- | --- |
| `greeting` | 招手 | 首页、开场；侧栏：有事等你处理、刚打开时问候 |
| `thinking` | 手指点着下巴想，带问号 | 侧栏：会话在干活 |
| `happy` | 双手合在胸前笑，带几道线 | 审批中心空着；侧栏：没事 |
| `sleepy` | 趴在胳膊上睡，带 Zz | 定时任务空着；侧栏：夜里 |
| `writing` | 拿本子写 | 产物空着；侧栏：会话在干活 |
| `shush` | 手指放在嘴前，眨眼 | 暂未使用 |
| `sorry` | 双手合十道歉 | 页面出错；侧栏：会话出错 |
| `waking` | 打哈欠、举拳，带太阳 | 登录页 |
| `gift` | 双手捧着一颗红果 | 关于页；侧栏：做完了等你核对 |
| `lost` | 疑惑，带问号 | 暂未使用 |

## 二、角色设定

参考图：上面 10 张，加上角色设定图 `~/Pictures/素材/Yew/Yew_character_sheet.png`（全身正面和四分之三侧，原始稿按规范 23.4.1 不进仓库）。

- **外形**：红发，齐肩，蓬松、有点乱，侧分刘海，头顶一撮呆毛；大眼睛，红褐色；脸颊淡淡的红晕。
- **发饰**：头左侧（画面右侧）别着红豆杉：一颗圆润发亮的红果，正面有个深色小孔，后面衬一小枝深绿针叶。新图里发饰一定要在这一侧。所以侧身和四分之三侧的姿势都让她朝画面左边转，发饰那一侧对着看的人。
- **衣着**：米色麻花毛衣，高领带荷叶边，袖子略长；外面一件带兜帽的深绿短披肩，边上一道米色细线，绣着米色小叶枝，领口系红色大蝴蝶结。露出下半身时照设定图：深绿长裙，裙摆上方一道红边，下面露出米色荷叶边；棕色系带短靴，红鞋带。送信时斜挎设定图里的棕色皮质小包。
- **画风**：Q 版比例（露出全身时约 2.5 头身），深棕色干净线稿，平涂加一层柔和阴影和小高光，人物单独成图的贴纸风。现有十张没有白色描边，入库时白边也要去掉，所以提示词直接要无描边、透明底。
- **符号**：现有图里只有 `happy` 的线、`thinking` 和 `lost` 的问号、`sleepy` 的 Zz、`waking` 的太阳留着。新图默认不带，`nap` 例外。

## 三、技术要求

- 透明底 PNG；做不到时用纯蓝底（`#0000FF`，她身上没有这个颜色），由处理脚本抠图。
- 边长 1024 像素以上；人物和手里的东西都完整，四周留空，不出框（`peek` 例外，见下）。
- 不带文字、数字和标志，不带别的角色和动物，不带别的作品和品牌的元素；信、清单这类道具上只画几道线。
- 不带背景、地面和投影。

## 四、出图办法

在 ChatGPT 里新开一个对话：

1. 上传参考图：角色设定图和 `greeting.webp`、`gift.webp`。
2. 第一条消息发下面的「开场」，之后每张图发一段姿势提示词，一条消息一张。
3. 每张下载原图 PNG，按姿势名命名（如 `stamp.png`），放进 `~/Pictures/素材/Yew/poses/`。
4. 发饰换了边、衣服变了、多了文字或别的东西，就重出这一张。

开场：

```text
The attached pictures show Yew, the red-haired girl of our app: a character sheet and two stickers. In this chat, every picture I ask for is a new sticker of exactly this girl. Keep her the same in every picture:

- Crimson-red hair, shoulder length, fluffy and a little messy, side-swept bangs, one ahoge loop on top. Large red-brown eyes, light pink blush.
- Hair ornament on the left side of her head (the viewer's right): one glossy round red yew berry with a small dark hole on its front, backed by a short sprig of dark green needles. It always stays on that side.
- Cream cable-knit sweater with a ruffled high collar and long, slightly oversized sleeves. Over it a short dark green hooded capelet with a thin cream trim line and small cream leaf-sprig embroidery, closed at the neck with a big red ribbon bow.
- When her legs show: a long dark green skirt with a red band near the hem and a cream frill below it, brown lace-up ankle boots with red laces.

Style: chibi proportions (about 2.5 heads tall when the whole body shows), clean dark-brown line art of even weight, flat colors with one soft shadow tone and small glossy highlights, like the attached stickers.

Every picture: square, 1024×1024 or larger, PNG with a transparent background. Only her and what she holds: no background, floor, ground shadow or drop shadow, no white sticker outline, no text, letters, numbers, logos or watermark, no other characters or animals, nothing from other games, anime or brands, and no emotion marks, motion lines or sparkles unless I ask. Keep her whole figure and everything she holds inside the frame with some space around it, unless I say otherwise.

Reply "OK" and wait for the first pose.
```

## 五、新姿势

第一批 16 张，按用途分组，创始人 11-18 全部选用。「侧栏」是她在侧栏里用这个姿势的情况（`web/src/companion.ts`）；没写的已入库，留给界面别处用。

### 等你处理

**1. `stamp` 盖章**：四分之三侧。用在审批：有请求等你批准。侧栏：等你处理。

```text
Waist-up, three-quarter view turned toward the viewer's left. She stands behind a small wooden counter whose top runs across the bottom of the picture, and presses a big wooden rubber stamp down onto a sheet of paper on it with both hands. A round red stamp mark shows on the paper. Bright, determined little smile, eyes on the paper.
```

**2. `pointing` 指着旁边**：正面，手伸向画面右边。侧栏里气泡在她右边，她指着气泡说有事等你。侧栏：等你处理。

```text
Waist-up, facing the viewer. She stretches her left arm out to the viewer's right and points with her index finger at something beside her, looking at the viewer with a bright "over here!" smile, mouth open. Her right hand rests on her chest.
```

**3. `letter-run` 拿着信跑**：侧身全身。用在送信：会话之间寄信、信箱。

```text
Full body, side view facing the viewer's left, running with light skipping steps: one boot forward, one kicked back, hair and skirt swinging behind her. Her left hand holds a sealed cream envelope up high (a small red wax seal, nothing written on it). A small brown leather satchel bounces at her hip with two more envelopes sticking out. Eager, cheerful face.
```

**4. `reading` 读信**：躺着，全身。用在读信：打开一封信、信箱里有新信。

```text
Full body, lying on her stomach, propped up on her elbows, lower legs raised and crossed at the ankles, seen from a three-quarter front angle with her head toward the viewer's left and her boots toward the right. She holds an open letter in both hands and reads it with a soft, happy smile. The letter shows only a few faint wavy lines.
```

### 干活

**5. `typing` 抱着电脑打字**：坐着，四分之三侧。用在一个会话在干活。侧栏：干活。

```text
She sits on the floor with her knees drawn up, three-quarter view turned toward the viewer's left. A small open laptop rests on her knees, held close with both arms, and she types on it with a focused face, lips pressed together. We see the plain back of the screen, with no logo.
```

**6. `clipboard` 拿夹板打勾**：四分之三侧。用在几个会话在干活。侧栏：干活。

```text
Waist-up, three-quarter view turned toward the viewer's left. She holds a wooden clipboard in her left arm and ticks a box with a pencil in her right hand. The sheet shows a short list of grey lines with red check marks and no readable writing. Brisk, capable smile.
```

**7. `magnifier` 拿放大镜**：侧身全身，弯腰。用在搜索：搜会话、搜信。侧栏：干活。

```text
Full body, side view facing the viewer's left. She leans forward from the waist and holds a big round magnifying glass up to her eye with her left hand; through the lens her eye looks huge. Her right hand rests on her knee. Curious, searching expression.
```

**8. `alarm` 拿闹钟**：正面全身。用在定时任务：定时任务页、任务到点。

```text
Full body, front view, standing with her boots together. She holds up a red twin-bell alarm clock in both hands at chest height; its face has only two hands and small tick marks, no numbers. Lively "it's time!" expression, mouth open.
```

**9. `phone` 拿手机**：四分之三侧。用在手机配对：扫码配对、手机已连上。

```text
Waist-up, three-quarter view turned toward the viewer's left. She holds a smartphone in both hands at chest height and looks down at its screen with a delighted smile, as if it just connected. We see the plain back of the phone in a dark green case.
```

### 结果

**10. `giftbox` 捧礼物**：正面全身。用在做完了、等你核对。侧栏：核对。

```text
Full body, front view, leaning a little forward on one foot, the other boot lifted behind her. She holds out a small cream gift box tied with a red ribbon toward the viewer in both hands, with a proud, warm smile and her eyes closed happily.
```

**11. `bow` 鞠躬道歉**：侧身全身。用在出错。侧栏：出错。

```text
Full body, side view facing the viewer's left. She bows deeply from the waist, about 45 degrees, hands together in front of her skirt, eyes shut, cheeks flushed: an embarrassed, sincere apology.
```

**12. `jump` 跳起来**：正面全身，腾空。用在庆祝：审批中心清空、一批会话全做完。

```text
Full body, front view, jumping high in celebration: both arms thrown up, knees bent and boots kicked back, hair and skirt flying, eyes shut in a huge open-mouthed smile.
```

### 没事和夜里

**13. `tea` 捧茶**：坐着，四分之三侧。用在没事。侧栏：没事。

```text
She sits on the floor with her legs folded to one side, three-quarter view turned toward the viewer's left. She holds a cream mug with a small red berry pattern in both hands near her chin, eyes closed, with a calm, content smile.
```

**14. `stretch` 伸懒腰**：背影回头。用在没事、早上。侧栏：没事。

```text
Waist-up, seen from behind. She stretches both arms high above her head with her fingers laced and looks back over her left shoulder at the viewer, one eye half closed, with a relaxed smile. We see the back of the capelet with its hood lying flat and its cream leaf embroidery; the hair ornament on the left side of her head is visible.
```

**15. `peek` 从边上探头**：只露出头、肩和手。侧栏里她站在最左边，像从侧栏边上探进来。侧栏：没事。

```text
Her head, shoulders and both hands lean in from the left edge of the picture, as if she is peeking around a corner; the rest of her body is hidden beyond that edge and cut off cleanly by it. Her head tilts toward the viewer's right, her hands hold the edge, and she smiles, curious and happy. In this picture the figure touches the frame, only at the left edge.
```

**16. `nap` 趴着睡**：全身，趴在大坐垫上。用在夜里。侧栏：夜里。

```text
Full body, lying on her stomach on a big round cream floor cushion, cheek resting on her folded arms, fast asleep with a peaceful smile, her boots resting behind her. Seen from the side, her head toward the viewer's left. Two small red "z" marks float above her head.
```

### 第二批：场景、形态和神态

创始人 11-18 挑了上面全部 16 张，又说：「还可以生成更多，探索更多场景、形态、神态等等」。场景用道具搭出来，不画背景。

**17. `paper-plane` 扔纸飞机**：背影四分之三侧，全身。用在信寄出去了。

```text
Full body, seen from behind at a three-quarter angle, turned toward the viewer's left, standing on tiptoe. She throws a folded cream paper airplane forward and up with her left hand; the airplane is still touching her fingertips. She glances back at the viewer over her left shoulder with a bright smile.
```

**18. `books` 坐在书堆上读书**：侧身全身，坐着。用在读资料：说明文件、技能。侧栏：干活。

```text
Full body, sitting on top of a stack of three big closed books with plain covers and no titles, side view facing the viewer's left, legs dangling. She reads an open book on her lap with a curious, absorbed look.
```

**19. `branch` 坐在红豆杉树枝上**：全身，坐着。用在没事。侧栏：没事。

```text
Full body, sitting sideways on a short cut piece of yew branch with dark green needles and a few red berries (both ends of the branch visible), holding it with both hands, swinging her boots, smiling at the viewer with her head tilted.
```

**20. `mini` 迷你小人**：形态，约 1.5 头身。用在图很小的地方。

```text
A tiny super-deformed version of her, about 1.5 heads tall, with a very big head and a small round body, standing and waving both arms happily, eyes closed in a wide smile. Same hair, hair ornament and outfit, simplified.
```

**21. `pajamas` 睡衣**：形态，全身。用在夜里。侧栏：夜里。

```text
Full body, in cream pajamas with small red berry dots and a dark green nightcap with a small red pompom; her yew hair ornament is still pinned on the left side of her head. She hugs a big cream pillow with one arm and rubs one eye with the other hand, yawning, eyes half shut.
```

**22. `halt` 伸手说等一下**：四分之三侧。用在要你确认的操作：推送、删除。侧栏：等你处理。

```text
Waist-up, three-quarter view turned toward the viewer's left. She holds her left hand up, palm out, in a firm "wait a moment" gesture, with a serious, careful expression; her right hand holds a sheet of paper to her chest.
```

**23. `surprised` 吃惊**：四分之三侧。用在新信到了。

```text
Waist-up, three-quarter view turned toward the viewer's left, leaning back in surprise with both hands raised near her face, eyes wide and round, mouth open in a small "oh!", her ahoge standing straight up.
```

**24. `pout` 鼓着脸**：侧身，抱着胳膊。用在事情等你很久了。侧栏：等你处理。

```text
Waist-up, body turned toward the viewer's left, arms crossed, cheeks puffed out in a cute pout, eyes glancing sideways at the viewer, a slight blush.
```

**25. `proud` 得意**：正面全身。用在都做完了。侧栏：核对。

```text
Full body, front view, standing with her hands on her hips and her chin up, eyes closed, with a proud, satisfied smile.
```

**26. `teary` 委屈**：坐着抱膝，四分之三侧。用在连不上、出了大错。侧栏：出错。

```text
Full body, sitting on the floor hugging her knees, three-quarter view turned toward the viewer's left, big teary eyes about to cry, lips wobbling in a small pout.
```

**27. `fired-up` 干劲十足**：四分之三侧。用在开始干活。侧栏：干活。

```text
Waist-up, three-quarter view turned toward the viewer's left. She pushes up her right sleeve with her left hand and raises her right fist, with a determined grin and shining eyes.
```

**28. `dozing` 打盹**：坐着，四分之三侧。用在夜里还有会话在干活。侧栏：夜里。

```text
She sits on the floor with a small open laptop on her lap, three-quarter view turned toward the viewer's left, nodding off: head drooping, eyes closed, mouth slightly open, one hand still on the keyboard.
```

## 六、立绘

用作主界面的整幅背景，由 Yew 开发会话接进界面。入库文件是 `web/public/mascot/portrait.webp`：1108×2400，透明底，约 290 KB，原图在 `~/Pictures/素材/Yew/portrait/`。

- 长边 2400 像素以上，透明底；ChatGPT 出的图不到 2400 时，入库前放大。
- 三分之二身到全身。图里只有人物，裁到人物边缘；她朝画面左边看，适合放在界面右侧，左边留给内容。
- 可以比贴纸画得细，但必须是同一个角色、同一身衣服和同一个发饰。
- 深浅色共用一张：在白底和 `#181818` 底上看过，边缘和颜色都清楚；深色下要淡一些，由界面调不透明度。

```text
A large standing illustration of the same girl: more detailed than the stickers, but clearly the same character, hair ornament and outfit (follow the full-body views on the character sheet). Normal anime proportions, about 6 heads tall. Full body, three-quarter view turned toward the viewer's left, standing in a relaxed pose with her weight on one leg. Her left hand holds a small sprig of yew with two red berries near her chest; her right hand rests on the strap of her brown leather satchel. She looks toward the viewer's left with a gentle smile; a light breeze lifts her hair, capelet and skirt a little. Clean line art, soft cel shading with gentle gradients, warm light. Tall portrait picture (2:3) at the largest size you can make, PNG with a transparent background, the whole figure inside the frame, no ground, no shadow, no text, no other characters.
```

第一版的发饰画成了宽叶子，裙子短到膝盖；照设定图改成针叶、长到小腿的裙子后重出，入库的是第二版。

## 七、处理和入库

原图都不进仓库（规范 23.4.1）：姿势的原图在 `~/Pictures/素材/Yew/poses/<姿势>.png`，立绘的在 `~/Pictures/素材/Yew/portrait/`。入库用 `scripts/mascot.ts`，在仓库根目录运行：

```bash
node scripts/mascot.ts --preview ~/Desktop/yew-poses.png
```

```bash
node scripts/mascot.ts --portrait ~/Pictures/素材/Yew/portrait/portrait-2.png
```

- 不写姿势名时处理原图文件夹里的全部 PNG；写了只处理那几个。`--preview` 把结果画在 Yew 的浅色、深色底上，入库前看一遍。
- 去底：真透明的图把半透明的身体收实，边缘的淡雾去掉。纯色底的图按底色抠：纯蓝这种她身上没有的颜色整张抠；白、灰、黑只抠和边框连着的部分，再处理两个像素宽的软边，眼睛里的白和深色线稿不受影响。
- 只留人物：比她小很多的零散小块（情绪符号、碎点）去掉，`nap` 留着 Zz。
- 放进 373×400 的透明画布：裁到人物边缘，居中，站在底边上，能放多大放多大；`peek` 贴着左边。拿 `greeting`、`gift`、`thinking` 的原图试过，结果的位置和大小与现有文件一致。
- 输出 WebP，质量取 50 KB 以内最高的一档；立绘裁到人物后放大到长边 2400，限 300 KB。
- 处理和编码都在 Google Chrome 里做（无头，用 `~/.yew/mcp-builtin/node_modules` 里的 playwright-core，和 `scripts/screenshots.ts` 一样），不用另装工具。

侧栏里按情况轮换的姿势（`web/src/companion.ts` 的 `POSES`，每十分钟换一个）：

| 情况 | 姿势 |
| --- | --- |
| 有事等你处理 | `greeting`、`stamp`、`pointing`、`halt`、`pout` |
| 会话出错 | `sorry`、`bow`、`teary` |
| 做完了等你核对 | `gift`、`giftbox`、`proud` |
| 会话在干活 | `thinking`、`writing`、`typing`、`clipboard`、`magnifier`、`books`、`fired-up` |
| 没事 | `happy`、`tea`、`stretch`、`peek`、`branch` |
| 夜里没事 | `sleepy`、`nap`、`pajamas`、`dozing` |

`letter-run`、`reading`、`alarm`、`phone`、`jump`、`paper-plane`、`mini`、`surprised` 已入库，侧栏不用，用处见第五节。

## 八、出图时要查的地方

这一批遇到过、重出过的问题，下次出图时逐张查：

- 手和胳膊：数清是两只手、两条腿。`pajamas` 第一版抱枕头的那只手来路不对（创始人看出来），重出了。
- 衣服走样：同一个对话出到二十张左右，开始出现短裙、黑袜、毛边靴、米色鞋带，发饰的针叶变成宽叶子。提示词里重申设定图的衣服和针叶发饰；`proud`、`teary` 因此重出过。
- 尺寸和底色：`nap` 第一版出成 2:1 的黑底图，人物在侧栏里太小，抠黑底也会伤到深色线稿，要求方形透明底重出。
- 拼图：有时会把前几张拼进同一张图再用代码裁（`mini`），裁出来的图偏软；提示词写明「只出这一张」。
