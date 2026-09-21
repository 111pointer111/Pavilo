# Pavilo / 语亭视觉标识

Pavilo 的标志以 `pavilo-concept-generated.png` 为造型母本，将“开放的亭子”和“对话空间”压缩成一个连续剪影：左右两片亭檐在顶端相接，中央留出开放拱门，左下缺口与底部收口形成含蓄的对话气泡尾。右上角的珊瑚色圆点代表在线状态和真实的人，让理性的几何结构保留一点温度。

## 品牌气质

- **开放但克制**：没有封闭的边框，呼应浏览器即开即用和低门槛进入。
- **本地且可信**：亭子是临时聚集的空间，对应局域网、私有网络和自托管；也可以按需成为产品里的讨论空间。
- **轻量但完整**：主体只有一个连贯剪影和一个圆点，缩小时仍能保留清晰轮廓。
- **安静而有人味**：青绿色负责可靠感，珊瑚圆点只承担“有人在线”的情绪焦点。

## 色彩

| 名称 | 色值 | 用途 |
| --- | --- | --- |
| Pavilion Deep | `#075D5D` | 亭檐、深色强调 |
| Local Teal | `#0F7772` | 对话空间、主品牌色 |
| Presence Coral | `#E86F57` | 在线状态圆点，只作少量强调 |
| Mist | `#EEF4F2` | 浅色背景 |
| Ink | `#182D32` | 字标与单色版本 |

这些颜色直接沿用 Pavilo 界面的现有设计变量，使仓库、应用和分享图片保持一致。标准彩色版保留生成稿柔和的青绿与珊瑚渐变；favicon 和应用内小尺寸标志使用同轮廓的纯色版本，确保边缘清楚。

## 文件与用途

- `pavilo-mark.svg`：透明背景的标准彩色图形标，优先用于产品界面和文档。
- `pavilo-mark-mono.svg`：单色图形标，用于单色印刷、雕刻或低色彩场景。
- `pavilo-lockup.svg`：横向中英文组合，适合 README、网站页眉和介绍材料。
- `pavilo-lockup-1520x440.png`：固定字形的高清横向组合图。
- `pavilo-favicon.svg`：针对 16–64 px 优化、带浅色底板的浏览器图标。
- `pavilo-favicon-64.png`：浏览器、桌面快捷方式等场景的 64 px 位图。
- `pavilo-social.svg` / `pavilo-social-1280x640.png`：仓库 Open Graph 和社交分享封面。
- `pavilo-mark-1024.png`：透明背景高清位图，用于不支持 SVG 的平台。
- `pavilo-concept-generated.png`：通过 OpenAI 内置图像生成制作的造型探索稿，仅作为设计过程记录，不作为标准 Logo 源文件。

## 使用规范

- 图形标四周至少保留一个珊瑚圆点直径的留白。
- 标准图形标数字场景建议不小于 20 px；更小尺寸使用 `pavilo-favicon.svg`。
- 浅色背景使用标准彩色版；复杂或受限背景使用单色版。
- 不拉伸、不旋转、不添加阴影或描边，不单独改变珊瑚圆点颜色。
- 正式导出以 SVG 为准。横向组合中的字标使用系统字体栈，不同平台可能略有差异；固定视觉稿请使用提供的 PNG。

## 生成与定稿过程

造型探索使用了 `imagegen` 内置模式。最终 SVG 直接提取生成稿的实际透明轮廓，减少位图边缘噪点后转成平滑贝塞尔曲线，并保留原稿的渐变方向；它不是另一套重新设计的简化图标。最终采用的生成提示词为：

```text
Use case: logo-brand
Asset type: refined logo symbol concept
Primary request: refine the Pavilo symbol while preserving its core idea: welcoming pavilion canopy, open arch / conversation-space negative area, and one coral online-presence dot. Make the lower negative space read as a subtle speech-bubble tail and simplify the outline for crisp recognition at 16px.
Style/medium: exact flat vector-friendly mark, solid fills only, precise geometric curves, editorial and premium
Color palette: deep teal #075D5D and teal #0F7772, one coral dot #E86F57; transparent background
Constraints: no text, letters, mockup, 3D or watermark; avoid generic messaging-app bubble shapes.
```

`pavilo-concept-generated.png` 是造型参考，`pavilo-mark.svg` 是可缩放、可交付的唯一标准图形母版；两者轮廓保持一致。
