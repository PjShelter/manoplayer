# manoplayer

这是一个基于 `Tauri + React + TypeScript` 的 `webgal_mano` 模型播放器和编辑器。

这个 README 重点解释一件事：

`webgal_mano` 模型到底是什么，它和普通“很多 PNG 的立绘文件夹”有什么区别，以及 `model.char.json` 里每个字段到底在控制什么。

---

# 1. 什么是 `webgal_mano` 模型

`webgal_mano` 不是单张立绘格式，而是一套“分层立绘运行时模型”。

它的本质是：

1. 一组按层拆开的图片资源
2. 一份描述这些图片如何组织、如何切换、如何组合的 JSON
3. 一个运行时渲染器，根据 JSON 规则决定哪些图层应该显示

也就是说，`webgal_mano` 模型不是“图片本身”，而是：

- `图片资源`
- `图层结构`
- `控制规则`

这三者组合后的结果。

在运行时，`webgal_mano` 会把所有图层先加载成 sprite，然后根据控制器规则决定每个图层当前是否可见。

你可以把它理解成：

- `assets.layers` 定义“有哪些零件”
- `controller` 定义“这些零件怎么组合成姿势、表情和差分”

---

# 2. 一个 `webgal_mano` 模型包含什么

一个最典型的模型目录大概像这样：

```text
example/Sherry/
  model.char.json
  Angle01/
    Body.png
    ArmL/
      ArmL01.png
      ArmL02.png
    ArmR/
      ArmR01.png
      ArmR02.png
    Facial/
      Eyes/
      Mouth/
      Cheeks/
```

其中：

- `model.char.json` 是模型主文件
- 其他 PNG/WebP 是图层资源

`webgal_mano` 真正读取的是 `model.char.json`。图片只是它引用的外部资源。

---

# 3. `model.char.json` 的完整结构


```ts
interface CharacterLayer {
  id: string;
  group: string;
  name: string;
  order: number;
  path: string;
}

interface CharacterModel {
  version: string;
  metadata: {
    name: string;
    exportedAt?: string;
    author?: string;
    description?: string;
  };
  settings: {
    basePath: string;
  };
  assets: {
    layers: CharacterLayer[];
  };
  controller: {
    baseLayers: string[];
    defaultPoses: string[];
    poses: Record<string, string[]>;
  };
}
```

这就是 `webgal_mano` 模型的核心数据协议。

---

# 4. 顶层字段逐项解释

## 4.1 `version`

示例：

```json
"version": "1.0.0"
```

含义：

- 模型格式版本
- 目前更多是描述性字段
- 播放器通常不会基于它做复杂分支逻辑，但保留它是必要的

建议：

- 新模型统一写 `1.0.0`

---

## 4.2 `metadata`

示例：

```json
"metadata": {
  "name": "Sherry",
  "exportedAt": "2026-01-15T15:59:31.074Z"
}
```

含义：

- 模型的元信息
- 不直接参与渲染
- 主要用于编辑器、管理界面、导出记录

字段说明：

- `name`
  - 模型名
  - 通常显示在 UI 里

- `exportedAt`
  - 导出时间
  - 通常用于追踪模型来源和版本

- `author`
  - 作者名
  - 可选

- `description`
  - 模型说明
  - 可选

这些字段不影响图层显示，只是描述信息。

---

## 4.3 `settings`

示例，见 [example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json#L7)：

```json
"settings": {
  "basePath": "./"
}
```

含义：

- 资源根路径配置
- `assets.layers[].path` 会相对这个路径去解析

### `basePath`

作用：

- 指定资源文件的基础目录

例如：

- `basePath = "./"`
- `path = "Angle01/Body.png"`

最终会解析成：

```text
./Angle01/Body.png
```

在本项目里，Tauri 后端会进一步把它映射到本地文件服务 URL。

注意：

- `basePath` 不等于模型文件所在目录本身，但通常会设成相对于模型目录的 `./`
- 如果你把图片路径写成绝对路径，移植性会很差
- 推荐始终使用相对路径

---

## 4.4 `assets.layers`

这是最重要的数据区之一。

它定义：

- 模型有哪些图层
- 每个图层属于哪个组
- 名称是什么
- 显示顺序是什么
- 图片文件在哪里

示例，见 [example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json#L10)：

```json
{
  "id": "Angle01/Body",
  "group": "Angle01",
  "name": "Body",
  "order": 1,
  "path": "Angle01/Body.png"
}
```

每一个 `layer` 都是一个可以单独开关的图片图层。

---

# 5. `CharacterLayer` 每个字段的含义

## 5.1 `id`

示例：

```json
"id": "Angle01/Facial/Mouth/Mouth_Normal_Open"
```

含义：

- 图层唯一标识
- 运行时内部主要通过它识别图层
- `setLayerVisible(layerId, visible)` 也是用这个字段

要求：

- 必须唯一
- 同一个模型里不能重复

最佳实践：

- 用带层级感的路径式命名
- 一般采用 `组路径/图层名`

例如：

- `Angle01/ArmL/ArmL01`
- `Angle01/Facial/Mouth/Mouth_Normal_Open`

---

## 5.2 `group`

示例：

```json
"group": "Angle01/Facial/Mouth"
```

含义：

- 图层所属的控制组
- `webgal_mano` 的控制语法本质上是“按组控制”

这是整个模型设计里最关键的概念之一。

你可以把 `group` 理解成：

- 一个“槽位”
- 一个“参数通道”
- 一个“互斥或可叠加的控制域”

比如：

- `Angle01/ArmL` 表示左手组
- `Angle01/ArmR` 表示右手组
- `Angle01/Facial/Eyes` 表示眼睛组
- `Angle01/Facial/Mouth` 表示嘴巴组

然后不同的 `name` 是这个组里的具体选项。

重要结论：

- 没有 `group`，控制器就很难表达这张图层
- 所以模型设计时，图层必须有明确组结构

这也是为什么本项目后来修了 `psd2mano`：顶层叶子图层如果导出成空组，`webgal_mano` 的控制器语法就不完整。

---

## 5.3 `name`

示例：

```json
"name": "Mouth_Normal_Open"
```

含义：

- 组内名字
- 配合 `group` 一起组成控制目标

例如：

- `group = Angle01/Facial/Mouth`
- `name = Mouth_Normal_Open`

控制命令就可以写成：

```text
Angle01/Facial/Mouth>Mouth_Normal_Open
```

---

## 5.4 `order`

示例：

```json
"order": 21
```

含义：

- 图层绘制顺序
- 数字越小越早绘制，越像底层
- 数字越大越后绘制，越像上层

直觉上：

- 身体通常在下层
- 头发遮罩、脸部细节、特效通常在上层

如果顺序错了，常见问题是：

- 头发跑到脸后面
- 腮红被皮肤遮住
- 手臂挡住不该挡的部位

所以 `order` 不是描述性字段，而是实际影响视觉结果。

---

## 5.5 `path`

示例：

```json
"path": "Angle01/Facial/Mouth/Mouth_Normal_Open.png"
```

含义：

- 这张图层对应的图片路径

解析方式：

- 先取 `settings.basePath`
- 再拼接 `path`
- 最终得到可加载资源地址

注意：

- `path` 指向图片文件
- `id` 是逻辑标识
- 这两个字段通常长得很像，但不是一回事

推荐：

- `id` 和目录层级尽量同步
- 但逻辑上永远把 `id` 看成“控制器用的名字”，把 `path` 看成“资源文件地址”

---

# 6. `controller` 是什么

如果说 `assets.layers` 定义的是“零件库”，那么 `controller` 定义的就是“装配规则”。

`controller` 由三部分组成：

- `baseLayers`
- `defaultPoses`
- `poses`

运行时更新顺序见 [node_modules/webgal_mano/dist/CharacterPlayer.js](/G:/git/manoplayer/node_modules/webgal_mano/dist/CharacterPlayer.js#L172)：

1. 先应用 `baseLayers`
2. 再叠加当前激活的 `poses`
3. 最后叠加手动覆盖 `manual overrides`

这个顺序非常重要。

---

# 7. `controller.baseLayers`

示例，见 [example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json#L637)：

```json
"baseLayers": [
  "Angle01+Body",
  "Angle01/ArmL+ArmL01",
  "Angle01/ArmR+ArmR01"
]
```

含义：

- 模型默认常驻图层
- 不依赖姿势选择，初始就会生效

典型用途：

- 身体底图
- 默认头发
- 默认阴影
- 默认手臂初始态
- 基础遮罩

你可以把它理解为：

- “角色出生时先穿上的那一层”

### `baseLayers` 的设计建议

适合放进 `baseLayers` 的东西：

- 永远存在的底图
- 默认姿势前提层
- 遮罩和基础混合层

不适合放进 `baseLayers` 的东西：

- 明显属于可切换 pose 的内容
- 容易和其他状态冲突的表情层

如果把太多可变东西塞进 `baseLayers`，后续 pose 控制会很混乱。

---

# 8. `controller.defaultPoses`

示例，见 [example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json#L729)：

```json
"defaultPoses": [
  "ArmL1",
  "ArmR1",
  "Default"
]
```

含义：

- 模型在 `resetToDefault()` 后默认激活的 pose 列表

这不是图层命令，而是：

- pose 名称
- 它们会去 `poses` 里查对应定义

设计意图：

- 把角色恢复到“标准站姿 + 标准表情”
- 支持多组 pose 同时激活

例如：

- `ArmL1` 控制左手
- `ArmR1` 控制右手
- `Default` 控制脸部表情

三者叠加后才得到完整默认立绘。

这就是 `webgal_mano` 和“单一 pose 切整张图”的最大区别之一：

- 它的 pose 是可组合的
- 左手、右手、表情、特效可以分开管

---

# 9. `controller.poses`

这是所有姿势和表情预设的定义表。

结构：

```json
"poses": {
  "ArmL1": ["Angle01/ArmL>ArmL01"],
  "ArmL2": ["Angle01/ArmL>ArmL02"],
  "Default": [
    "Angle01/Facial/Eyes>Eyes_Normal_Open01",
    "Angle01/Facial/Mouth>Mouth_Normal_Closed"
  ]
}
```

含义：

- key 是 pose 名称
- value 是命令数组

这些命令数组最终会被解析成图层显隐状态。

---

# 10. 控制命令语法

`webgal_mano` 的命令解析规则在 [node_modules/webgal_mano/dist/Parser.js](/G:/git/manoplayer/node_modules/webgal_mano/dist/Parser.js#L7)。

支持三种核心操作符：

- `+`
- `-`
- `>`

## 10.1 `group+name`

含义：

- 打开某个组里的某个图层

示例：

```text
Angle01/Facial/Cheeks+Cheeks_Flushed
```

效果：

- 把 `Cheeks_Flushed` 设为可见
- 不会自动关闭同组其他图层

适用场景：

- 同组允许多层并存
- 叠加类效果
- 特效类细节

---

## 10.2 `group-name`

含义：

- 关闭某个组里的某个图层

示例：

```text
Angle01/Facial/Cheeks-Cheeks_Normal
```

效果：

- 只关闭该图层

适用场景：

- 精确地关闭某一层

---

## 10.3 `group-`

含义：

- 关闭整个组的所有图层

示例：

```text
Angle01/Facial/Sweat-
```

效果：

- 把 `Angle01/Facial/Sweat` 组里的全部图层都设为不可见

适用场景：

- 先清组，再重建该组状态
- 做兼容迁移时非常有用

---

## 10.4 `group>name`

含义：

- 互斥切换到该组中的某一个图层

示例：

```text
Angle01/ArmL>ArmL11
```

效果：

- 该组内只有 `ArmL11` 保持可见
- 同组其他图层全部关闭

适用场景：

- 手臂动作切换
- 嘴型切换
- 眼型切换
- 任何“一个组同一时间只该有一个选项”的地方

这是最常用的姿势命令。

---

## 10.5 具体到一个真实例子：`后发>后发`、`后发+后发`、`后发-后发`、`后发-`

假设你的模型里有这样一个组：

```json
{
  "id": "后发/后发",
  "group": "后发",
  "name": "后发"
}
```

那么下面四条指令的意思分别是：

### `后发>后发`

含义：

- 把 `后发` 这个组切换到 `后发` 这一项
- 同组其他图层会全部关闭

适合：

- `后发` 是单选组
- 同组里可能有多个候选后发版本，但同一时间只该显示一个

如果组里还有：

- `后发/后发A`
- `后发/后发B`
- `后发/后发C`

那么执行：

```text
后发>后发B
```

最终效果是：

- `后发B = 显示`
- `后发A = 关闭`
- `后发C = 关闭`

---

### `后发+后发`

含义：

- 打开 `后发/后发` 这一张图层
- 不会自动关闭同组其他图层

适合：

- 这一组允许多层叠加
- 或者你只是想显式把某一层打开，而不影响其他层

如果组里还有别的图层已经开着，那么 `+` 不会帮你清掉它们。

---

### `后发-后发`

含义：

- 关闭 `后发/后发` 这一张图层
- 只影响这一层

适合：

- 精确关闭某一层
- 不想影响同组其他层

---

### `后发-`

含义：

- 关闭整个 `后发` 组里的所有图层

适合：

- 先把整个组清空
- 然后再用 `+` 或 `>` 重建状态

例如：

```text
后发-
后发+后发
```

意思就是：

1. 先把 `后发` 组全部关掉
2. 再只打开 `后发/后发`

---

### 这四条命令最核心的区别

`后发>后发`

- 单选切换
- 会关闭同组其他图层

`后发+后发`

- 只是打开这一层
- 不会关闭同组其他图层

`后发-后发`

- 只是关闭这一层

`后发-`

- 清空整个组

---

### 当组里只有这一张图时会怎样

如果 `后发` 组里实际上只有一个图层 `后发/后发`，那么：

- `后发>后发` 和 `后发+后发` 在显示结果上通常看起来一样，都会把它显示出来
- `后发-后发` 和 `后发-` 在显示结果上通常也很像，都会把它关掉

但它们的建模语义仍然不同：

- `>` 表示“这是单选组控制”
- `+` 表示“这是显式叠加开启”
- `-name` 表示“关闭某一项”
- `-` 表示“清空整个组”

所以即使结果暂时一样，建模时也最好按真实意图去写。

---

# 11. 如何理解 `+` 和 `>` 的区别

这是建模最容易混淆的地方。

## 用 `>`

当这个组是单选组时用。

例如：

- 左手只能是一个姿势
- 右手只能是一个姿势
- 嘴巴只能有一个主嘴型

这时应该用：

```text
Angle01/ArmL>ArmL01
Angle01/ArmL>ArmL02
```

## 用 `+`

当这个组允许多层共存时用。

例如：

- 腮红可以和眼泪同时存在
- 汗水可以叠加在默认脸部上

这时应该用：

```text
Angle01/Facial/Cheeks+Cheeks_Flushed
Angle01/Facial/Sweat+Sweat01
```

一句话：

- `>` 是“单选切换”
- `+` 是“叠加开启”

---

# 12. pose 可以引用 pose

解析器里 `resolvePose()` 会递归展开 pose，见 [node_modules/webgal_mano/dist/Parser.js](/G:/git/manoplayer/node_modules/webgal_mano/dist/Parser.js#L55)。

这意味着：

- 一个 pose 的命令数组里
- 不仅可以放命令
- 还可以放另一个 pose 的名字

例如：

```json
"poses": {
  "BaseFace": [
    "Angle01/Facial/Eyes>Eyes_Normal_Open01",
    "Angle01/Facial/Mouth>Mouth_Normal_Closed"
  ],
  "Smile": [
    "BaseFace",
    "Angle01/Facial/Mouth>Mouth_Smile_Closed"
  ]
}
```

这样做的好处：

- 避免重复写大量共同命令
- 可以做 pose 继承和组合

注意：

- 递归循环引用会被跳过
- 不要写成互相无限套娃

---

# 13. `CharacterPlayer` 在运行时怎么工作

`webgal_mano` 对外暴露的是 `CharacterPlayer`，类型见 [node_modules/webgal_mano/dist/CharacterPlayer.d.ts](/G:/git/manoplayer/node_modules/webgal_mano/dist/CharacterPlayer.d.ts#L1)。

核心能力有：

- `setPose(poseName)`
- `addPose(poseName)`
- `removePose(poseName)`
- `setLayerVisible(layerId, visible)`
- `clearGroupOverrides(groupName)`
- `resetToDefault()`

## 13.1 `resetToDefault()`

作用：

- 清空当前激活姿势
- 清空手动覆盖
- 重新应用 `defaultPoses`

这是“回到初始状态”的标准入口。

## 13.2 `setPose(poseName)`

作用：

- 切换某个 pose
- 并自动替换掉和它冲突的同组 pose

比如当前已经激活 `ArmL1`，再 `setPose('ArmL11')`，通常就会替换掉原本的左手 pose。

## 13.3 `addPose(poseName)`

作用：

- 直接叠加一个 pose
- 不主动处理冲突

适合特殊组合场景，但更容易弄乱状态。

## 13.4 `setLayerVisible(layerId, visible)`

作用：

- 手动强制控制某个图层
- 优先级高于 pose

这很适合编辑器里的微调开关。

## 13.5 `clearGroupOverrides(groupName)`

作用：

- 清除某一组的手动覆盖
- 让控制权重新回到 pose

---

# 14. 渲染优先级

这一点非常重要。

最终某张图层显不显示，不是只看某一个字段，而是看三层规则叠加：

1. `baseLayers`
2. 当前激活 `poses`
3. 手动覆盖 `manual overrides`

优先级从低到高就是这个顺序。

也就是说：

- `baseLayers` 打开了某层
- pose 又关掉了它
- 手动覆盖再打开它

最终结果是：

- 这层会显示

因为手动覆盖最高。

---

# 15. 示例模型 `Sherry` 怎么读

这个仓库的 [example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json) 是理解 `webgal_mano` 最好的参考。

## 15.1 图层区

它把资源拆成：

- `Angle01/Body`
- `Angle01/ArmL/*`
- `Angle01/ArmR/*`
- `Angle01/Facial/Eyes/*`
- `Angle01/Facial/Mouth/*`
- `Angle01/Facial/Cheeks/*`
- `Angle01/Facial/Pale/*`
- `Angle01/Facial/Sweat/*`

这就是典型的“分组 + 组内候选项”建模方式。

## 15.2 baseLayers

示例里 `baseLayers` 不是只写很少几条，而是显式写了很多正负命令。

这样做的目的不是冗余，而是：

- 把初始状态定义得非常明确
- 避免某个组因为默认值不明确而出现脏状态

## 15.3 defaultPoses

示例里：

```json
"defaultPoses": ["ArmL1", "ArmR1", "Default"]
```

意味着默认状态由三块拼起来：

- 左手默认
- 右手默认
- 脸部默认

这非常符合 `webgal_mano` 的参数化思路。

## 15.4 poses

示例里的 `ArmL1` 到 `ArmL14`、`ArmR1` 到 `ArmR19` 基本都是标准单组选项：

```text
Angle01/ArmL>ArmL01
Angle01/ArmR>ArmR01
```

而 `Default` 这类 pose 往往是一组脸部组合命令。

---

# 16. 什么样的模型不是合法的 `webgal_mano` 模型

下面这些情况最常见，也最容易导致“图片都 200，但画面是空的”。

## 16.1 图层没有 `group`

如果叶子图层导出成：

```json
{
  "group": "",
  "id": "纸张",
  "name": "纸张"
}
```

那控制器就很难表达它，因为 `webgal_mano` 的命令语法是按组工作的。

## 16.2 `controller` 里写的是裸 layer id

错误示例：

```json
"baseLayers": ["动作1/下半身", "动作1/常服"]
```

这不是 `webgal_mano` 原生控制命令。

正确做法通常应该是：

```json
"baseLayers": [
  "动作1-",
  "动作1+下半身",
  "动作1+常服"
]
```

或者在单选场景下：

```json
"poses": {
  "动作1常服": [
    "动作1-",
    "动作1+下半身",
    "动作1+常服"
  ]
}
```

## 16.3 组设计不清晰

比如把：

- 腮红
- 脸部底图
- 汗水
- 黑眼圈

都塞进同一个必须单选的组里

那就会出现：

- 开腮红会把脸关掉
- 开汗水会把脸红覆盖掉

这不是渲染器问题，是建模问题。

---

# 17. 如何设计一个好的 `webgal_mano` 模型

建议按下面思路拆：

## 17.1 先拆“永远有的层”

例如：

- 身体
- 基础头发
- 基础脸
- 固定配饰

这些通常放 `baseLayers`

## 17.2 再拆“互斥组”

例如：

- 左手动作
- 右手动作
- 主嘴型
- 主眼型

这些通常用 `group>name`

## 17.3 最后拆“叠加组”

例如：

- 腮红
- 汗水
- 眼泪
- 发白
- 受伤特效

这些通常用 `group+name`

如果从一开始就按这个思路分 PSD 图层，后面的模型编辑器工作会轻松很多。

---

# 18. 本仓库里的 `psd2mano` 当前做了什么

本仓库自带的 `utils/psd2mano` 负责把 PSD 导出成基础 `mano` 模型。

当前策略是：

- 导出图片资源
- 生成 `assets.layers`
- 生成基础 `model.char.json`
- `controller` 默认留空，方便你在编辑器里补

同时，针对早期模型有两点兼容处理：

1. 导出器现在不会再把顶层叶子图层导出成空组
2. 播放器加载旧模型时，会尝试把裸 layer id 迁移成兼容命令

这能减少“模型图片存在，但完全不显示”的问题。

---

# 19. 在本项目里如何理解“编辑模型”

编辑器本质上不是在改图片，而是在改：

- 图层组织方式
- pose 命名
- 默认 pose 组合
- 每个 pose 包含哪些命令

所以编辑 `mano` 模型，实质上是在编排一个“图层控制脚本”。

你每加一条命令，都是在定义：

- 哪个组被切换
- 哪个图层被打开
- 哪个图层被关闭
- 哪些状态可以共存

---

# 20. 一个最小可工作的模型长什么样

下面是一个极简示例：

```json
{
  "version": "1.0.0",
  "metadata": {
    "name": "Demo"
  },
  "settings": {
    "basePath": "./"
  },
  "assets": {
    "layers": [
      {
        "id": "Body/Body",
        "group": "Body",
        "name": "Body",
        "order": 1,
        "path": "Body.png"
      },
      {
        "id": "Mouth/Smile",
        "group": "Mouth",
        "name": "Smile",
        "order": 2,
        "path": "Smile.png"
      },
      {
        "id": "Mouth/Neutral",
        "group": "Mouth",
        "name": "Neutral",
        "order": 3,
        "path": "Neutral.png"
      }
    ]
  },
  "controller": {
    "baseLayers": [
      "Body+Body"
    ],
    "defaultPoses": [
      "Default"
    ],
    "poses": {
      "Default": [
        "Mouth>Neutral"
      ],
      "Smile": [
        "Mouth>Smile"
      ]
    }
  }
}
```

这个例子已经具备了：

- 基础常驻层
- 一个可切换组
- 一个默认 pose

这就是 `webgal_mano` 的最小闭环。

---

# 21. 常见误区总结

## 误区 1：`id` 就是图片路径

不对。

- `id` 是逻辑标识
- `path` 是资源路径

它们可以类似，但职责不同。

## 误区 2：pose 名称必须对应图层名

不对。

pose 名称是逻辑名字，例如：

- `Default`
- `Smile`
- `ArmL1`

它并不要求和某张图层同名。

## 误区 3：所有组都应该用 `>`

不对。

有些组是单选，有些组是叠加。

如果把叠加组也都做成 `>`，你会不停地把自己想显示的细节互相挤掉。

## 误区 4：只要图片存在，模型就一定能显示

不对。

如果：

- `group` 设计错了
- `controller` 命令格式错了
- `defaultPoses` 没有激活任何有效状态

那图片虽然都加载成功，结果仍然是空白。

---

# 22. 对这个项目最重要的结论

如果你只记住三件事，记这三件：

1. `webgal_mano` 模型 = 图片资源 + 图层表 + 控制器
2. `group` 是模型能否被正确控制的核心
3. `controller` 写的不是“图层列表”，而是“控制命令”

---

# 23. 相关参考文件

如果你要继续深入，优先看这几个本地文件：

- 示例模型：[example/Sherry/model.char.json](/G:/git/manoplayer/example/Sherry/model.char.json)
- 库类型定义：[node_modules/webgal_mano/dist/types.d.ts](/G:/git/manoplayer/node_modules/webgal_mano/dist/types.d.ts)
- 解析器实现：[node_modules/webgal_mano/dist/Parser.js](/G:/git/manoplayer/node_modules/webgal_mano/dist/Parser.js)
- 播放器更新逻辑：[node_modules/webgal_mano/dist/CharacterPlayer.js](/G:/git/manoplayer/node_modules/webgal_mano/dist/CharacterPlayer.js)
- 本仓库 PSD 导出器：[utils/psd2mano/scripts/export-psd.ts](/G:/git/manoplayer/utils/psd2mano/scripts/export-psd.ts)

---

# 24. 这份 README 的使用方式

推荐这样看：

1. 先读第 3 到第 10 节，理解数据格式和命令语法
2. 再对照 `example/Sherry/model.char.json`
3. 然后回到编辑器里试着改 `baseLayers` 和 `poses`
4. 最后再看自己的 PSD 分层，判断哪些该是单选组，哪些该是叠加组

这样你会很快知道一个模型为什么能显示，为什么不能显示，以及应该怎么改。
