import * as SQLite from 'expo-sqlite';
import bcrypt from 'bcryptjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, Paths } from 'expo-file-system';

let opening;
function database() {
  if (!opening) opening = (async () => {
    const db = await SQLite.openDatabaseAsync('mistletunes-accounts.db');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY NOT NULL DEFAULT ('local-' || lower(hex(randomblob(16)))),
        username TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        passwordHash TEXT NOT NULL, photo TEXT
      );
      CREATE TABLE IF NOT EXISTS session (
        slot INTEGER PRIMARY KEY CHECK(slot = 1),
        accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS removedLibraries (id TEXT PRIMARY KEY NOT NULL);
    `);
    return db;
  })().catch(error => { opening = undefined; throw error; });
  return opening;
}

const profileColumns = 'accounts.id, username, email, photo';
export async function currentAccount() {
  const db = await database();
  return db.getFirstAsync('SELECT ' + profileColumns + ' FROM accounts JOIN session ON session.accountId = accounts.id');
}

async function passwordHash(db, password, confirmation) {
  if (password !== confirmation) throw new Error('Passwords must match.');
  if (password.length < 8 || bcrypt.truncates(password)) throw new Error('Use at least 8 characters and at most 72 bytes for your password.');
  const { salt } = await db.getFirstAsync('SELECT randomblob(16) AS salt');
  return bcrypt.hash(password, '$2b$10$' + bcrypt.encodeBase64(salt, 16));
}

export async function saveAccount(id, values) {
  const username = values.username.trim();
  const email = values.email.trim().toLowerCase();
  if (!username) throw new Error('Enter a username.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  const db = await database();
  const hash = !id || values.password || values.confirmation
    ? await passwordHash(db, values.password, values.confirmation) : null;
  try {
    if (id) {
      await db.runAsync('UPDATE accounts SET username=?, email=?, photo=?, passwordHash=COALESCE(?, passwordHash) WHERE id=?',
        username, email, values.photo, hash, id);
    } else {
      await db.runAsync('INSERT INTO accounts(username,email,photo,passwordHash) VALUES (?,?,?,?)',
        username, email, values.photo, hash);
    }
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: accounts.email')) throw new Error('An account already uses that email.');
    throw error;
  }
  return { id, username, email, photo: values.photo };
}

export async function login(email, password) {
  const db = await database();
  const row = await db.getFirstAsync('SELECT ' + profileColumns + ', passwordHash FROM accounts WHERE email=?', email.trim().toLowerCase());
  if (!row || bcrypt.truncates(password) || !await bcrypt.compare(password, row.passwordHash)) throw new Error('Incorrect email or password.');
  await db.runAsync('INSERT OR REPLACE INTO session(slot, accountId) VALUES (1,?)', row.id);
  return { id: row.id, username: row.username, email: row.email, photo: row.photo };
}

export async function logout() {
  await (await database()).runAsync('DELETE FROM session');
}

export async function deleteAccount(id) {
  const db = await database();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT OR IGNORE INTO removedLibraries(id) VALUES (?)', id);
    await db.runAsync('DELETE FROM accounts WHERE id=?', id);
  });
}

// Retry interrupted cleanup on launch. Only generated account directories are eligible.
export async function cleanRemovedLibraries() {
  const db = await database();
  for (const { id } of await db.getAllAsync('SELECT id FROM removedLibraries')) {
    if (!/^local-[0-9a-f]{32}$/.test(id)) continue;
    for (const root of ['MusicPlayer', 'AlbumCovers']) {
      const directory = new Directory(Paths.document, root, id);
      if (directory.exists) await directory.delete();
    }
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('music-player.') && key.split(':')[1] === id);
    if (keys.length) await AsyncStorage.multiRemove(keys);
    await db.runAsync('DELETE FROM removedLibraries WHERE id=?', id);
  }
}
