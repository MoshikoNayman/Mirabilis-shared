import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  corsAllowLocalhost: String(process.env.CORS_ALLOW_LOCALHOST ?? '1') !== '0',
  trustProxy: process.env.TRUST_PROXY || 'loopback',
  apiRateLimitWindowMs: Math.max(10_000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000)),
  apiRateLimitMax: Math.max(50, Number(process.env.API_RATE_LIMIT_MAX || 300)),
  aiProvider: process.env.AI_PROVIDER || 'ollama',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  koboldBaseUrl: process.env.KOBOLD_BASE_URL || 'http://127.0.0.1:5001/v1',
  koboldModel: process.env.KOBOLD_MODEL || 'koboldcpp',
  openAIBaseUrl: process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8000/v1',
  openAIApiKey: process.env.OPENAI_API_KEY || '',
  openAIModel: process.env.OPENAI_MODEL || 'model.gguf',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  tavilySearchDepth: process.env.TAVILY_SEARCH_DEPTH || 'advanced',
  chatStorePath: process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'chats.json')
    : path.resolve(__dirname, '../data/chats.json'),
  intelLedgerStorePath: process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'intelledger.json')
    : path.resolve(__dirname, '../data/intelledger.json')
};
