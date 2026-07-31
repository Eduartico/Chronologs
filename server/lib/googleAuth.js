import { existsSync, readFileSync, writeFileSync } from 'fs';
import { google } from 'googleapis';
import { secretsPath } from './paths.js';

const PORT = process.env.PORT || 3001;
const REDIRECT_URI = `http://localhost:${PORT}/api/google/callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function credentialsFile() {
  return secretsPath('google', 'credentials.json');
}

function tokenFile() {
  return secretsPath('google', 'token.json');
}

export function saveCredentials({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new Error('clientId and clientSecret are required');
  writeFileSync(
    credentialsFile(),
    JSON.stringify({ clientId, clientSecret }, null, 2),
    'utf-8'
  );
}

export function hasCredentials() {
  return existsSync(credentialsFile());
}

export function hasToken() {
  return existsSync(tokenFile());
}

export function getOAuthClient() {
  if (!hasCredentials()) throw new Error('Google credentials not configured');
  const { clientId, clientSecret } = JSON.parse(readFileSync(credentialsFile(), 'utf-8'));
  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  if (hasToken()) {
    client.setCredentials(JSON.parse(readFileSync(tokenFile(), 'utf-8')));
  }
  // Persist refreshed tokens so the connection survives restarts.
  client.on('tokens', (tokens) => {
    const current = hasToken() ? JSON.parse(readFileSync(tokenFile(), 'utf-8')) : {};
    writeFileSync(tokenFile(), JSON.stringify({ ...current, ...tokens }, null, 2), 'utf-8');
  });
  return client;
}

export function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function handleCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  writeFileSync(tokenFile(), JSON.stringify(tokens, null, 2), 'utf-8');
  return tokens;
}

export function getStatus() {
  return { hasCredentials: hasCredentials(), connected: hasToken() };
}
