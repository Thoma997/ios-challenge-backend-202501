const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
}).fields([
  { name: 'audio', maxCount: 1 },
  { name: 'config', maxCount: 1 },
]);

// Supported audio formats (M4A, WAV)
const SUPPORTED_AUDIO_TYPES = [
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
];

// In-memory store for uploads
const uploads = new Map();

// Simulate random failures and delays
const CONFIG = {
  uploadFailureRate: 0.15,      // 15% chance of upload failure
  timeoutRate: 0.1,             // 10% chance of timeout on status check
  processingFailureRate: 0.1,   // 10% chance transcription fails
  minProcessingTime: 5000,      // Min 5 seconds to complete
  maxProcessingTime: 20000,     // Max 20 seconds to complete
};

// GET / - API information
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'Transcription API',
    description: 'Simulated audio transcription service for testing',
    baseUrl,
    version: '1.0.0',
    endpoints: [
      {
        method: 'GET',
        path: '/',
        description: 'API information (this document)',
      },
      {
        method: 'POST',
        path: '/uploads',
        description: 'Upload audio file for transcription',
        body: {
          audio: 'multipart/form-data (required, max 1GB). Supported formats: M4A, WAV',
          config: 'multipart/form-data JSON (optional, max 1 file)',
          language: 'string (optional, default: en)',
          speakerCount: 'number (optional, default: 1)',
        },
        supportedAudioFormats: ['M4A', 'WAV'],
      },
      {
        method: 'GET',
        path: '/uploads/:id/status',
        description: 'Check transcription status and get transcript when completed',
      },
      {
        method: 'GET',
        path: '/uploads',
        description: 'List all uploads (for debugging)',
      },
    ],
    failureSimulation: {
      description: 'Random failures for testing client resilience',
      uploadFailureRate: `${CONFIG.uploadFailureRate * 100}%`,
      uploadTimeoutRate: `${CONFIG.timeoutRate * 100}% (POST /uploads, 504 Gateway timeout)`,
      statusTimeoutRate: `${CONFIG.timeoutRate * 100}% (GET /uploads/:id/status, 504 Gateway timeout)`,
      processingFailureRate: `${CONFIG.processingFailureRate * 100}%`,
      slowResponseRate: '20% (POST /uploads and GET /uploads/:id/status, 1-3s extra delay)',
    },
  });
});

// POST /uploads - Upload audio file with metadata
app.post('/uploads', uploadAudio, async (req, res) => {
  // Simulate random gateway timeout
  if (Math.random() < CONFIG.timeoutRate) {
    await new Promise(resolve => setTimeout(resolve, 35000)); // Force timeout
    return res.status(504).json({ error: 'Gateway timeout' });
  }

  // Simulate random upload failure
  if (Math.random() < CONFIG.uploadFailureRate) {
    const errors = [
      { status: 500, message: 'Internal server error' },
      { status: 503, message: 'Service temporarily unavailable' },
    ];
    const error = errors[Math.floor(Math.random() * errors.length)];
    return res.status(error.status).json({ error: error.message });
  }

  // Simulate occasional slow response
  if (Math.random() < 0.2) {
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  }

  // 1. Validate file exists
  const files = req.files;
  if (!files || !files.audio || !files.audio[0]) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }
  const audioFile = files.audio[0];

  // 2. Validate audio format
  if (!SUPPORTED_AUDIO_TYPES.includes(audioFile.mimetype)) {
    return res.status(400).json({
      error: `Unsupported audio format: ${audioFile.mimetype}. Supported formats: M4A, WAV`,
    });
  }

  let metadata = {
    language: req.body.language || 'en',
    speakerCount: req.body.speakerCount || 1,
    ...req.body,
  };
  const configFile = req.files?.config?.[0];
  if (configFile?.buffer) {
    try {
      const config = JSON.parse(configFile.buffer.toString('utf8'));
      metadata = { ...metadata, ...config };
    } catch (_) {
      // Ignore invalid config JSON
    }
  }

  const uploadId = randomUUID();
  const now = Date.now();
  const processingTime = CONFIG.minProcessingTime +
    Math.random() * (CONFIG.maxProcessingTime - CONFIG.minProcessingTime);

  const uploadRecord = {
    id: uploadId,
    filename: audioFile.originalname,
    mimeType: audioFile.mimetype,
    size: audioFile.size,
    metadata,
    status: 'queued',
    progress: 0,
    createdAt: now,
    completesAt: now + processingTime,
    willFail: Math.random() < CONFIG.processingFailureRate,
    transcript: null,
    error: null,
  };

  uploads.set(uploadId, uploadRecord);

  // Start processing simulation
  simulateProcessing(uploadId);

  res.status(202).json({
    uploadId,
    status: 'queued',
    message: 'Upload accepted and queued for transcription',
  });
});

// GET /uploads/:uploadId/status - Check transcription status
app.get('/uploads/:uploadId/status', async (req, res) => {
  // Simulate random timeout
  if (Math.random() < CONFIG.timeoutRate) {
    await new Promise(resolve => setTimeout(resolve, 35000)); // Force timeout
    return res.status(504).json({ error: 'Gateway timeout' });
  }

  // Simulate occasional slow response
  if (Math.random() < 0.2) {
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  }

  const upload = uploads.get(req.params.uploadId);

  if (!upload) {
    return res.status(404).json({ error: 'Upload not found' });
  }

  const response = {
    uploadId: upload.id,
    status: upload.status,
    progress: upload.progress,
    filename: upload.filename,
    metadata: upload.metadata,
    createdAt: new Date(upload.createdAt).toISOString(),
  };

  if (upload.status === 'completed') {
    response.transcript = upload.transcript;
    response.completedAt = new Date(upload.completedAt).toISOString();
  }

  if (upload.status === 'failed') {
    response.error = upload.error;
  }

  res.json(response);
});

// GET /uploads - List all uploads (helpful for debugging)
app.get('/uploads', (req, res) => {
  const list = Array.from(uploads.values()).map(u => ({
    uploadId: u.id,
    filename: u.filename,
    status: u.status,
    progress: u.progress,
    createdAt: new Date(u.createdAt).toISOString(),
  }));
  res.json(list);
});

// Simulate transcription processing
function simulateProcessing(uploadId) {
  const upload = uploads.get(uploadId);
  if (!upload) return;

  const totalTime = upload.completesAt - upload.createdAt;
  const updateInterval = 1000;

  const interval = setInterval(() => {
    const record = uploads.get(uploadId);
    if (!record) {
      clearInterval(interval);
      return;
    }

    const elapsed = Date.now() - record.createdAt;
    const progress = Math.min(100, Math.round((elapsed / totalTime) * 100));

    if (record.status === 'queued' && progress > 5) {
      record.status = 'processing';
    }

    record.progress = progress;

    if (progress >= 100) {
      clearInterval(interval);

      if (record.willFail) {
        record.status = 'failed';
        record.error = 'Transcription failed: Unable to process audio';
        record.progress = record.progress; // Keep last progress
      } else {
        record.status = 'completed';
        record.progress = 100;
        record.completedAt = Date.now();
        record.transcript = generateMockTranscript();
      }
    }
  }, updateInterval);
}

function generateMockTranscript() {
  const sentences = [
    "Hello and welcome to this recording.",
    "Today we'll be discussing some important topics.",
    "Let me start by introducing the main points.",
    "First, we need to consider the background.",
    "The key insight here is quite interesting.",
    "Moving on to the next section.",
    "This brings us to our conclusion.",
    "Thank you for listening.",
  ];
  return sentences.slice(0, 3 + Math.floor(Math.random() * 5)).join(' ');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Transcription API listening on http://localhost:${PORT}`);
});
