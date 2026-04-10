import fs from 'fs/promises';
import path from 'path';

const emptyStore = { chats: [] };

// Module-level read cache — invalidated on every write so reads within the same
// request cycle never hit the filesystem more than once.
let _cache = null;
let _cachePath = null;

// Monotonically-incrementing epoch. Incremented on every clearChats so that any
// saveChat enqueued BEFORE the clear (or finishing AFTER it) recognises the store
// was wiped and bails out, preventing cleared chats from being resurrected.
let _epoch = 0;

function invalidateCache() {
  _cache = null;
  _cachePath = null;
}

// Serializes all write operations to prevent concurrent read-modify-write data loss
let _lock = Promise.resolve();
function withLock(fn) {
  let release;
  const ticket = new Promise((resolve) => { release = resolve; });
  const prev = _lock;
  _lock = ticket;
  return prev.then(() => fn()).finally(() => release());
}

export async function ensureStoreFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(emptyStore, null, 2), 'utf8');
  }
}

export async function readStore(filePath) {
  await ensureStoreFile(filePath);
  if (_cache && _cachePath === filePath) return _cache;
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    _cache = JSON.parse(raw);
    _cachePath = filePath;
    return _cache;
  } catch {
    return { ...emptyStore };
  }
}

export async function writeStore(filePath, data) {
  invalidateCache();
  await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
  _cache = data;
  _cachePath = filePath;
}

export async function listChats(filePath) {
  const store = await readStore(filePath);
  return store.chats
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: chat.messages.length
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getChat(filePath, chatId) {
  const store = await readStore(filePath);
  return store.chats.find((chat) => chat.id === chatId) || null;
}

export function saveChat(filePath, nextChat) {
  // Snapshot epoch before entering the queue. If clearChats runs while this
  // saveChat is waiting, the epoch will have incremented and we skip the write.
  const savedEpoch = _epoch;
  return withLock(async () => {
    if (_epoch !== savedEpoch) return; // store was cleared after this save was enqueued
    const store = await readStore(filePath);
    const index = store.chats.findIndex((chat) => chat.id === nextChat.id);
    if (index >= 0) {
      store.chats[index] = nextChat;
    } else {
      store.chats.push(nextChat);
    }
    await writeStore(filePath, store);
  });
}

export function deleteChat(filePath, chatId) {
  return withLock(async () => {
    const store = await readStore(filePath);
    const before = store.chats.length;
    store.chats = store.chats.filter((chat) => chat.id !== chatId);
    await writeStore(filePath, store);
    return store.chats.length < before;
  });
}

export function clearChats(filePath) {
  return withLock(async () => {
    _epoch++; // invalidate all in-flight saveChat calls
    await writeStore(filePath, { ...emptyStore });
  });
}

// Returns the current epoch so callers can detect if clearChats ran since they
// last checked.
export function getEpoch() {
  return _epoch;
}
