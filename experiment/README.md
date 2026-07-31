# 歌词-音频强制对齐实验

## 目标

用 CTC Forced Alignment 替代当前 Whisper ASR + 全局字符对齐方案，实现逐行歌词时间轴匹配，目标精度 ±0.5s。

## 环境

- Python 3.13 + CUDA 12.4
- RTX 4050 Laptop (6GB VRAM)
- 虚拟环境: `experiment/.venv`

激活环境:

```powershell
cd C:\Users\Administrator\Desktop\项目\link-audio\experiment
.venv\Scripts\activate
```

---

## 实验流程

### 第一步: 数据准备

#### 1.1 收集数据

准备 20 首歌曲的 MP3 + LRC 文件，放入 `experiment/data/` 目录:

```
experiment/data/
├── song001.mp3
├── song001.lrc
├── song002.mp3
├── song002.lrc
└── ...
```

LRC 格式要求: 标准带时间戳的 LRC 文件，如:
```
[00:12.35]春风吹过山岗
[00:16.80]你说你不会忘
```

#### 1.2 人声分离 (Demucs)

用 Demucs 从 MP3 中提取人声，去除伴奏干扰:

```powershell
# 对单首歌曲分离
demucs --two-stems=vocals -o experiment/data/separated experiment/data/song001.mp3

# 输出在 experiment/data/separated/htdemucs/song001/vocals.wav
```

批量处理:

```powershell
# 对 data/ 下所有 mp3 批量分离
demucs --two-stems=vocals -o experiment/data/separated experiment/data/*.mp3
```

#### 1.3 解析 LRC 时间戳

从 LRC 中提取每行的 `(start_time, text)` 作为训练标签和评估真值。

---

### 第二步: 特征提取验证 (单首歌)

用 MERT-95M 对一首歌提取帧级声学特征，验证流程跑通。

#### 2.1 下载 MERT 模型

```python
from transformers import AutoModel, AutoFeatureExtractor

model_name = "m-a-p/MERT-v1-95M"
feature_extractor = AutoFeatureExtractor.from_pretrained(model_name)
model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
```

模型会自动缓存到 `~/.cache/huggingface/`。

#### 2.2 提取特征

```python
import torch
import librosa
import soundfile as sf

# 加载人声音频
waveform, sr = sf.read("data/separated/htdemucs/song001/vocals.wav")

# 重采样到 24kHz (MERT 要求)
if sr != 24000:
    import torchaudio
    waveform = torchaudio.functional.resample(
        torch.tensor(waveform).float(), sr, 24000
    ).numpy()
    sr = 24000

# 提取特征: 每帧约 75ms (24kHz / 320 stride ≈ 75fps)
inputs = feature_extractor(waveform, sampling_rate=sr, return_tensors="pt")
with torch.no_grad():
    outputs = model(**inputs)
    # last_hidden_state: [1, T, 768] — T 帧, 每帧 768 维
    frame_features = outputs.last_hidden_state
```

#### 2.3 确认帧率

MERT 的帧率是 `sample_rate / stride = 24000 / 320 = 75 fps`，即每帧约 13.3ms。这对逐行歌词对齐绰绰有余。

---

### 第三步: CTC 模型微调

#### 3.1 模型结构

```
MERT-95M 编码器 (冻结前 8 层, 微调后 4 层)
  → Linear(768, vocab_size + 1)  # +1 for CTC blank
  → log_softmax
  → CTCLoss
```

词汇表: 歌词中出现的所有汉字 + 常用标点 + 空白符 (约 4000-5000 个 token)。

#### 3.2 训练数据格式

每条训练样本:

```python
{
    "audio_path": "data/separated/htdemucs/song001/vocals.wav",
    "lyrics_text": "春风吹过山岗你说你不会忘..."  # 整首歌歌词拼接
}
```

CTC 训练不需要时间标签，只需要音频和对应的文本序列。

#### 3.3 训练参数

| 参数 | 值 | 说明 |
|---|---|---|
| batch_size | 2 | 6GB VRAM 限制 |
| gradient_accumulation | 4 | 有效 batch = 8 |
| learning_rate | 3e-5 | 微调用较小学习率 |
| epochs | 20-30 | 20 首数据少，多跑几轮 |
| max_audio_length | 30s | 长音频切片训练 |
| optimizer | AdamW | weight_decay=0.01 |
| warmup_ratio | 0.1 | 10% warmup |
| lr_scheduler | cosine | 余弦退火 |

#### 3.4 训练脚本骨架

```python
import torch
import torch.nn as nn
from transformers import AutoModel, AutoFeatureExtractor

class LyricsAlignModel(nn.Module):
    def __init__(self, mert_name, vocab_size):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(mert_name, trust_remote_code=True)
        # 冻结前 8 层
        for layer in self.encoder.encoder.layers[:8]:
            for p in layer.parameters():
                p.requires_grad = False
        self.proj = nn.Linear(768, vocab_size + 1)  # +1 blank

    def forward(self, input_values):
        out = self.encoder(input_values).last_hidden_state  # [B, T, 768]
        log_probs = torch.nn.functional.log_softmax(self.proj(out), dim=-1)  # [B, T, V]
        return log_probs

# 训练循环
# for batch in dataloader:
#     log_probs = model(batch["audio"])       # [B, T, V]
#     loss = ctc_loss(
#         log_probs.transpose(0, 1),          # [T, B, V]
#         batch["labels"],                     # [sum(label_lens)]
#         batch["input_lengths"],              # [B]
#         batch["label_lengths"]               # [B]
#     )
#     loss.backward()
#     optimizer.step()
```

---

### 第四步: 对齐推理

训练完成后，用 CTC 分段算法将歌词文本对齐到音频帧:

```python
from ctc_segmentation import ctc_segmentation, CtcSegmentationParameters

# 1. 模型推理得到帧级概率
log_probs = model(vocal_features)  # [1, T, V]

# 2. 配置
config = CtcSegmentationParameters()
config.char_list = vocab  # 你的字符列表

# 3. 将歌词按行拆分，插入分隔符
lines = ["春风吹过山岗", "你说你不会忘", ...]
ground_truth = list("|".join(lines))  # 用 | 分隔行

# 4. 执行对齐
segments = ctc_segmentation(config, log_probs[0].numpy(), ground_truth)

# 5. 聚合为行级时间戳
# 每个 segment: (start_time, end_time, confidence)
```

---

### 第五步: 评估

用 LRC 中原有的行时间戳作为真值，计算对齐精度:

```python
import numpy as np

# lrc_times: LRC 中每行的起始时间 (真值)
# pred_times: 模型预测的每行起始时间

mae = np.mean(np.abs(np.array(lrc_times) - np.array(pred_times)))
print(f"平均绝对误差: {mae:.2f}s")

# 统计误差分布
within_03 = np.mean(np.abs(np.array(lrc_times) - np.array(pred_times)) < 0.3) * 100
within_05 = np.mean(np.abs(np.array(lrc_times) - np.array(pred_times)) < 0.5) * 100
print(f"±0.3s 内: {within_03:.1f}%")
print(f"±0.5s 内: {within_05:.1f}%")
```

目标: MAE < 0.5s, ±0.5s 内命中率 > 80%。

---

### 第六步: 对比旧方案

将新模型结果与当前 Whisper + NW 对齐方案对比:

| 指标 | 旧方案 (Whisper+NW) | 新方案 (CTC FA) |
|---|---|---|
| MAE | 待测 | 待测 |
| ±0.5s 命中率 | 待测 | 待测 |
| 重复歌词处理 | 容易错位 | CTC 单调约束 |
| 未匹配行 | 需插值 | 每行有直接时间 |
| 推理速度 | 待测 | 待测 |

---

### 第七步: 工程集成

确认效果后，将模型打包集成到 LinkAudio:

1. 导出模型为 ONNX 或 TorchScript
2. 替换 `ai/align_lyrics.py` 中的 Whisper + NW 逻辑
3. 保留 `ctc-segmentation` 做推理对齐
4. 更新 `src/main/ai-lyrics-service.ts` 的调用方式

---

## 风险与备选

| 风险 | 备选方案 |
|---|---|
| 20 首数据不够 | 增加到 50-100 首; 或用数据增强 (变速、变调) |
| MERT-95M 效果不好 | 尝试 wav2vec2-large-xlsr-53-chinese |
| 6GB VRAM 不够 | 减少 max_audio_length 到 15s; 或用 gradient checkpointing |
| CTC 对齐不够精细 | 在行内再做一次字符级对齐 |
| 歌唱识别率低 | 先做人声分离再训练，比混合音频效果好很多 |
