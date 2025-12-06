import express from 'express';
import cors from 'cors';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import multer from 'multer';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

// 中文语音列表
const CHINESE_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女声-温柔)', gender: 'Female' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (女声-活泼)', gender: 'Female' },
  { id: 'zh-CN-YunjianNeural', name: '云健 (男声-沉稳)', gender: 'Male' },
  { id: 'zh-CN-YunxiNeural', name: '云希 (男声-阳光)', gender: 'Male' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏 (男声-少年)', gender: 'Male' },
  { id: 'zh-CN-YunyangNeural', name: '云扬 (男声-新闻)', gender: 'Male' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北 (东北话)', gender: 'Female' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮 (陕西话)', gender: 'Female' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻 (台湾女声)', gender: 'Female' },
  { id: 'zh-TW-YunJheNeural', name: '雲哲 (台湾男声)', gender: 'Male' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼 (粤语女声)', gender: 'Female' },
  { id: 'zh-HK-WanLungNeural', name: '雲龍 (粤语男声)', gender: 'Male' },
];

app.get('/api/voices', (req, res) => {
  res.json(CHINESE_VOICES);
});

// 清理文本
function cleanTextForTTS(text) {
  return text
    .replace(/[*#@~`^|\\<>{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '')
    .replace(/[…]+/g, '。')
    .replace(/[－—–]+/g, '，')
    .replace(/\.{2,}/g, '。')
    .trim();
}

// TTS 接口
app.post('/api/tts', async (req, res) => {
  try {
    let { text, voice = 'zh-CN-XiaoxiaoNeural', rate = '+0%', pitch = '+0Hz' } = req.body;
    if (!text) return res.status(400).json({ error: '请提供文本内容' });

    text = cleanTextForTTS(text);
    console.log('TTS请求:', { text: text.substring(0, 50), voice, rate });

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // 使用 toFile 方式，收集完整音频后返回
    const { audioStream } = tts.toStream(text, { rate, pitch });

    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => {
      const audioBuffer = Buffer.concat(chunks);
      console.log('音频生成完成, 大小:', audioBuffer.length);
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
      res.send(audioBuffer);
    });
    audioStream.on('error', (err) => {
      console.error('TTS流错误:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (error) {
    console.error('TTS错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 文档解析
app.post('/api/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });

    const filePath = req.file.path;
    const fileName = req.body.fileName || req.file.originalname || '';
    const ext = path.extname(fileName).toLowerCase();
    let text = '';

    if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf-8');
    } else if (ext === '.doc' || ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === '.pdf') {
      text = '暂不支持PDF，请转为TXT或Word格式';
    } else {
      return res.status(400).json({ error: '不支持的格式' });
    }

    fs.unlinkSync(filePath);
    if (!text.trim()) return res.status(400).json({ error: '无法提取文本' });
    res.json({ text: text.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '文档转语音服务运行中' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎙️ TTS服务已启动，端口: ${PORT}`);
});

